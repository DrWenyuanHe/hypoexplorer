"""Build the exact public NeuroSeq gene_tpm HY export using Python stdlib.

Offline build: python scripts/build_neuroseq_expression.py
Validate retained source and every emitted value: append --check
Explicitly refresh the public source: append --fetch

Original responses are archived byte-for-byte with SHA-256 hashes. The portal
API paginates at 100 genes. Its TPM values have two decimal places. No count
conversion, averaging, symbol aggregation, rescaling, or Henry substitution occurs.
"""

import argparse
import collections
import datetime
import hashlib
import io
import json
import math
import pathlib
import time
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/expression/neuroseq/source"
PUBLIC = ROOT / "public/expression/neuroseq"
BASE_PATH = "/expression/neuroseq"
API_URL = "https://neuroseq.janelia.org/heatmap/filter/gene_tpm"
ARCHIVE = SOURCE / "portal-export.zip"
RECORD = SOURCE / "portal-source-manifest.json"
GENES = 35358
SAMPLES = 54
SUPPORT_URLS = {
    "viewer.html": "https://neuroseq.janelia.org/heatmap/d/gene_tpm",
    "nseq-bb.js": "https://neuroseq.janelia.org/heatmap/static/js/nseq-bb.js",
    "webdb3-bb.js": "https://neuroseq.janelia.org/heatmap/static/js/webdb3-bb.js",
    "help.html": "https://neuroseq.janelia.org/help/",
    "scripting.html": "https://neuroseq.janelia.org/help/scripting",
}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value, pretty=False):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False,
                       indent=2 if pretty else None,
                       separators=None if pretty else (",", ":")) + "\n").encode("utf-8")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    return json.loads(path.read_bytes())


def request_bytes(url, body=None):
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, data=body,
                                             headers={"User-Agent": "HypoExplorer-source-import/1.0"})
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except (OSError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def query_body(script, page=1):
    return urllib.parse.urlencode({"q": "", "page": str(page), "script": "", "filter": script}).encode()


def deterministic_zip(entries):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(entries):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, entries[name])
    return buffer.getvalue()


def acquire(catalog):
    script = "Columns(include=" + json.dumps([s["sample_label"] for s in catalog["samples"]]) + ")"

    def get_page(page):
        name = f"pages/page-{page:03d}.json"
        raw = request_bytes(API_URL, query_body(script, page))
        parsed = json.loads(raw)
        require(parsed.get("page") == page, f"Unexpected API page: {page}")
        require(parsed.get("hits") == GENES, "Source gene count changed; review required")
        require(parsed.get("message") == "", f"API error: {parsed.get('message')}")
        return name, raw

    first_name, first_bytes = get_page(1)
    first = json.loads(first_bytes)
    entries = {first_name: first_bytes}
    with ThreadPoolExecutor(max_workers=3) as executor:
        for name, raw in executor.map(get_page, range(2, first["total"] + 1)):
            entries[name] = raw
    for name, url in SUPPORT_URLS.items():
        entries[name] = request_bytes(url)
    sentinel_script = ('Find(["Lepr","Agrp","Pomc"], filter_type="fname")\n'
                       'Columns(include=["HY.ARH_glu_Pomc-GFP_m51_383",'
                       '"HY.ARH_GABA_NPY-hrGFP_m46_100"])')
    entries["sentinel-response.json"] = request_bytes(API_URL, query_body(sentinel_script))
    archive_bytes = deterministic_zip(entries)
    source_record = {
        "schemaVersion": 1, "retrievedDate": datetime.date.today().isoformat(),
        "apiUrl": API_URL, "method": "POST (read-only public expression query)",
        "contentType": "application/x-www-form-urlencoded",
        "parameters": {"q": "", "script": "", "filter": script, "page": "1..354"},
        "pageCount": first["total"], "geneCount": first["hits"], "sampleCount": SAMPLES,
        "sourcePrecision": "JSON TPM numbers at two decimal places",
        "portalDatasetLabel": "Gene level NeuroSeq dataset (TPM from counts quantified by HTSeq, Gencode.vM4)",
        "archive": {"file": ARCHIVE.name, "bytes": len(archive_bytes), "sha256": sha256(archive_bytes)},
        "catalog": {"file": "catalog.json", "sha256": sha256((SOURCE / "catalog.json").read_bytes()),
                    "sampleMetadataUrl": catalog["sources"]["sample_metadata"],
                    "sampleMetadataSha256": catalog["metadata_sha256"]},
        "entries": [{"file": name, "bytes": len(raw), "sha256": sha256(raw),
                     "url": SUPPORT_URLS.get(name, API_URL)} for name, raw in sorted(entries.items())],
        "sentinelFilter": sentinel_script,
        "acquisition": "Public client MatrixSearch POST, Columns(include=sample labels), unscaled and unstandardized; all pages retained.",
    }
    ARCHIVE.write_bytes(archive_bytes)
    RECORD.write_bytes(json_bytes(source_record, pretty=True))
    print(f"Retained {len(entries)} original responses ({len(archive_bytes):,} compressed bytes)")


def validate_source(catalog, record):
    raw = ARCHIVE.read_bytes()
    require(sha256(raw) == record["archive"]["sha256"], "Source archive hash mismatch")
    require(len(raw) == record["archive"]["bytes"], "Source archive byte count mismatch")
    require(sha256((SOURCE / "catalog.json").read_bytes()) == record["catalog"]["sha256"], "Catalog hash mismatch")
    archive = zipfile.ZipFile(io.BytesIO(raw))
    require(set(archive.namelist()) == {e["file"] for e in record["entries"]}, "Archive inventory mismatch")
    for entry in record["entries"]:
        data = archive.read(entry["file"])
        require(len(data) == entry["bytes"] and sha256(data) == entry["sha256"],
                f"Original response bytes changed: {entry['file']}")
    require("HTSeq, Gencode.vM4" in archive.read("viewer.html").decode(), "Portal processing label changed")
    require(len(catalog["samples"]) == SAMPLES, "Catalog sample count mismatch")
    require(len(catalog["source_groups"]) == 17, "Catalog source-group count mismatch")
    require(len(catalog["display_populations"]) == 15, "Catalog population count mismatch")
    ids = {str(s["sample_id"]) for s in catalog["samples"]}
    labels = {s["sample_label"] for s in catalog["samples"]}
    require(len(ids) == len(labels) == SAMPLES, "Duplicate catalog sample identifiers")
    for groups, key in [(catalog["source_groups"], "source_group_id"), (catalog["display_populations"], "display_label")]:
        memberships = [str(s) for g in groups for s in g["sample_ids"]]
        require(set(memberships) == ids and len(memberships) == SAMPLES, f"Incomplete {key} membership")
        assignments = {str(sample_id): group[key] for group in groups for sample_id in group["sample_ids"]}
        sample_field = "group" if key == "source_group_id" else "group_label"
        require(all(assignments[str(sample["sample_id"])] == sample[sample_field] for sample in catalog["samples"]),
                f"Sample {key} assignments differ from group membership")
    require(sum(s["allenregion"] == "SFO" for s in catalog["samples"]) == 3, "SFO scope changed")
    return archive


def iter_source_genes(archive, catalog, record):
    labels = [s["sample_label"] for s in catalog["samples"]]
    all_ids = set()
    for page in range(1, record["pageCount"] + 1):
        response = json.loads(archive.read(f"pages/page-{page:03d}.json"))
        matrix = response["matrix"]
        require(response["page"] == page and response["hits"] == GENES, f"Page identity mismatch: {page}")
        require(response["total"] == record["pageCount"], "Inconsistent pagination")
        require(response["status"].startswith("SUCCESS: Columns(") and response["message"] == "", f"Failed filter: {page}")
        require(matrix["info"] == {"dtype": "gene", "genome_version": "mm10", "species": "mm"}, "Source genome changed")
        require(set(matrix["sample2idx"]) == set(labels), f"Sample labels differ: {page}")
        require(sorted(matrix["sample2idx"].values()) == list(range(SAMPLES)), f"Bad sample indices: {page}")
        expected_populations = {p["display_label"]: set(p["sample_ids"]) for p in catalog["display_populations"]}
        actual_populations = {name: {int(label.rsplit("_", 1)[1]) for label in members} for name, members in matrix["groups"]}
        require(actual_populations == expected_populations, f"Population catalog differs: {page}")
        size = len(matrix["annot"])
        require(size == min(100, GENES - (page - 1) * 100), f"Truncated page: {page}")
        require(sorted(matrix["geneid2idx"].values()) == list(range(size)), f"Bad gene indices: {page}")
        require(set(matrix["geneid2idx"]) == set(matrix["geneid2label"]), "Gene label/ID mismatch")
        require(len(matrix["data"]) == SAMPLES and all(len(v) == size for v in matrix["data"]), f"Bad matrix shape: {page}")
        data_rows = {"id" + str(row[0]): row for row in response["data"]["aaData"]}
        for gene_id, index in sorted(matrix["geneid2idx"].items(), key=lambda entry: entry[1]):
            require(gene_id not in all_ids, f"Repeated gene ID: {gene_id}")
            all_ids.add(gene_id)
            annotation = dict(zip(matrix["annotflds"], matrix["annot"][index], strict=True))
            symbol = matrix["geneid2label"][gene_id]
            require(symbol == annotation["symbol"] == data_rows[gene_id][1], "Symbol alignment mismatch")
            values = [matrix["data"][matrix["sample2idx"][label]][index] for label in labels]
            require(all(type(v) in (int, float) and math.isfinite(v) and v >= 0 for v in values), f"Invalid TPM: {gene_id}")
            require(all(abs(v * 100 - round(v * 100)) < 1e-7 for v in values), f"Source precision changed: {gene_id}")
            yield {"id": gene_id, "symbol": symbol, "ensemblId": annotation["egid"],
                   "description": annotation["description"].strip(), "values": values}
    require(len(all_ids) == GENES, "Incomplete source gene coverage")


def build_catalog(catalog):
    overlaps = {r["neuroseq_sample_id"]: r for r in catalog["henry_overlap_candidates"]}
    samples = []
    for row in catalog["samples"]:
        fed = ".fed_" in row["group"]
        overlap = overlaps.get(row["sample_id"])
        samples.append({
            "id": str(row["sample_id"]), "label": row["sample_label"],
            "sourceGroupId": row["group"], "populationId": row["group_label"],
            "region": row["allenregion"], "sourceRegion": row["region"], "driver": row["mouseline"],
            "transmitter": row["transmitter"], "sex": row["sex"], "ageDays": row["age_(day)"],
            "pooledCellCount": row["num_cells"], "feedingState": "fed" if fed else "not-reported",
            "feedingEvidence": "Published source group contains .fed" if fed else "Feeding state not specified in retained source metadata",
            "referenceEligible": fed, "atlasReference": True,
            "geo": row.get("geo", {}).get("geo_accession"),
            "isolation": "Manually picked fluorescent neurons", "rnaCompartment": "Total RNA",
            "henryOverlapCandidate": {"henryColumn": overlap["henry_column"], "henryGeo": overlap["henry_geo_accession"],
                                       "status": overlap["status"]} if overlap else None,
        })
    groups = [{"id": r["source_group_id"], "label": r["display_label"], "populationId": r["display_label"],
               "region": r["region"], "transmitter": r["transmitter"], "sampleIds": [str(i) for i in r["sample_ids"]]}
              for r in catalog["source_groups"]]
    populations = [{"id": r["display_label"], "label": r["display_label"], "region": r["region"],
                    "sourceGroupIds": r["source_group_ids"], "sampleIds": [str(i) for i in r["sample_ids"]]}
                   for r in catalog["display_populations"]]
    return samples, groups, populations


def build_products(catalog, record, archive):
    samples, groups, populations = build_catalog(catalog)
    records = list(iter_source_genes(archive, catalog, record))
    shards = collections.defaultdict(dict)
    index = []
    for row in records:
        shard = sha256(row["id"].encode())[:2]
        shards[shard][row["id"]] = row
        index.append({key: row[key] for key in ("id", "symbol", "ensemblId")} |
                     {"shard": f"{BASE_PATH}/shards/{shard}.json"})
    index.sort(key=lambda row: (row["symbol"].casefold(), row["id"]))
    products = {f"shards/{key}.json": json_bytes({"schemaVersion": 1, "genes": rows}) for key, rows in sorted(shards.items())}
    products["gene-index.json"] = json_bytes({"schemaVersion": 1, "genes": index})
    counts = collections.Counter(row["symbol"] for row in records)
    duplicates = {symbol: count for symbol, count in counts.items() if count > 1}
    casefold_groups = collections.defaultdict(list)
    for row in records:
        casefold_groups[row["symbol"].casefold()].append({"id": row["id"], "symbol": row["symbol"], "ensemblId": row["ensemblId"]})
    casefold_collisions = {symbol: rows for symbol, rows in casefold_groups.items() if len(rows) > 1}
    by_symbol = {row["symbol"]: row for row in records if counts[row["symbol"]] == 1}
    labels = [s["label"] for s in samples]
    browser_checks = []
    for checkpoint in catalog["browser_checkpoints"]:
        row = by_symbol[checkpoint["gene"]]
        value = row["values"][labels.index(checkpoint["sample_label"])]
        expected = checkpoint["tpm"]
        require(value == expected, f"Browser checkpoint failed: {checkpoint['gene']}")
        browser_checks.append({"gene": checkpoint["gene"], "geneId": row["id"], "sampleLabel": checkpoint["sample_label"],
                               "portalDisplayedTpm": expected, "importedTpm": value, "absoluteError": abs(value - expected),
                               "status": "matched-at-source-displayed-precision"})
    sentinel = json.loads(archive.read("sentinel-response.json"))["matrix"]
    for gene_id, gene_index in sentinel["geneid2idx"].items():
        row = by_symbol[sentinel["geneid2label"][gene_id]]
        require(row["id"] == gene_id, "Separate sentinel query gene-ID mismatch")
        for label, sample_index in sentinel["sample2idx"].items():
            require(row["values"][labels.index(label)] == sentinel["data"][sample_index][gene_index], "Sentinel query mismatch")
    validation = {
        "schemaVersion": 1, "status": "verified", "sourceDate": record["retrievedDate"],
        "sourceArchiveSha256": record["archive"]["sha256"],
        "scope": "Exact fidelity to the public NeuroSeq gene_tpm API export; three browser display checkpoints. Not an independent reanalysis of raw counts.",
        "geneCount": len(records), "sampleCount": len(samples), "sourceGroupCount": len(groups),
        "populationCount": len(populations), "sourcePageCount": record["pageCount"],
        "valueCount": len(records) * len(samples), "fullSourceEquality": True,
        "sourcePrecisionDecimalPlaces": 2, "maximumAbsoluteImportError": 0, "duplicateSymbols": duplicates,
        "caseInsensitiveSymbolCollisions": casefold_collisions,
        "missingValues": 0, "zeroValues": sum(v == 0 for row in records for v in row["values"]),
        "sampleIdAlignment": "exact", "sourceGroupMembership": "exact partition of 54 libraries",
        "populationMembership": "matches all 15 portal groups on every source page", "browserCheckpoints": browser_checks,
        "independentSentinelQueryValues": 6, "referenceEligibleSampleCount": sum(s["referenceEligible"] for s in samples),
        "unknownFeedingStateSampleCount": sum(s["feedingState"] == "not-reported" for s in samples),
        "henryOverlapCandidates": len(catalog["henry_overlap_candidates"]),
        "limitations": [
            "Portal export values are already rounded to two decimals; original unrounded TPM parity is not established.",
            "Ten Henry fed libraries are metadata-supported overlap candidates, not independent validation samples.",
            "Only 13 libraries have a fed source-group label; feeding state is not reported for the other 41.",
            "The source HY classification includes three subfornical organ (SFO) libraries.",
            "Source groups are retained separately even when their display population labels coincide.",
        ],
    }
    validation.update({
        "comparedValues": validation["valueCount"], "exactMatches": validation["valueCount"],
        "maxAbsoluteDifference": 0, "precision": "Two decimal places, as published by the NeuroSeq gene_tpm API",
        "sourceUrl": SUPPORT_URLS["viewer.html"], "notes": validation["limitations"],
        "checkpoints": [{"gene": check["gene"], "sampleId": check["sampleLabel"].rsplit("_", 1)[1],
                         "expected": check["portalDisplayedTpm"], "actual": check["importedTpm"], "passed": True}
                        for check in browser_checks],
    })
    products["validation.json"] = json_bytes(validation, pretty=True)
    manifest = {
        "schemaVersion": 1, "id": "neuroseq_gene_tpm_hy", "title": "NeuroSeq hypothalamic populations",
        "unit": "TPM", "organism": "Mus musculus", "processing": "NeuroSeq gene_tpm; HTSeq; Gencode.vM4; mm10",
        "geneCount": len(records), "sampleCount": len(samples), "populationCount": len(populations), "sourceGroupCount": len(groups),
        "geneIndexPath": f"{BASE_PATH}/gene-index.json", "validationPath": f"{BASE_PATH}/validation.json",
        "samples": samples, "sourceGroups": groups, "populations": populations,
        "source": {"portalUrl": SUPPORT_URLS["viewer.html"], "paperUrl": catalog["sources"]["paper"],
                   "sampleMetadataUrl": catalog["sources"]["sample_metadata"], "geoUrl": catalog["sources"]["geo"],
                   "apiUrl": API_URL, "retrievedDate": record["retrievedDate"], "archiveSha256": record["archive"]["sha256"],
                   "precisionDecimalPlaces": 2}, "notes": validation["limitations"],
    }
    products["manifest.json"] = json_bytes(manifest, pretty=True)
    return products, validation


def verify_emitted(products, archive, catalog, record):
    """Reread every emitted JSON number and its aligned identity against source."""
    decoded = {name: json.loads(data) for name, data in products.items() if name.startswith("shards/")}
    comparisons = 0
    source_ids = set()
    for source in iter_source_genes(archive, catalog, record):
        shard = sha256(source["id"].encode())[:2]
        emitted = decoded[f"shards/{shard}.json"]["genes"][source["id"]]
        require(source == emitted, f"Emitted record differs: {source['id']}")
        comparisons += len(emitted["values"])
        source_ids.add(source["id"])
    index = json.loads(products["gene-index.json"])["genes"]
    require({row["id"] for row in index} == source_ids and len(index) == GENES, "Index coverage mismatch")
    for row in index:
        actual = decoded[row["shard"].removeprefix(BASE_PATH + "/")]["genes"][row["id"]]
        require(row["symbol"] == actual["symbol"] and row["ensemblId"] == actual["ensemblId"], "Index annotation mismatch")
    require(comparisons == GENES * SAMPLES, "Full source comparison incomplete")
    return comparisons


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true", help="Refresh the public portal source explicitly")
    parser.add_argument("--check", action="store_true", help="Verify source and emitted files without writing")
    args = parser.parse_args()
    require(not (args.check and args.fetch), "--check cannot refresh sources")
    catalog = read_json(SOURCE / "catalog.json")
    if args.fetch:
        acquire(catalog)
    record = read_json(RECORD)
    with validate_source(catalog, record) as archive:
        products, validation = build_products(catalog, record, archive)
        if args.check:
            files = {str(path.relative_to(PUBLIC)).replace("\\", "/") for path in PUBLIC.rglob("*.json")}
            require(files == set(products), "Product inventory changed")
            for name, expected in products.items():
                require((PUBLIC / name).read_bytes() == expected, f"Stale or changed product: {name}")
        else:
            for name, content in products.items():
                target = PUBLIC / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
        compared = verify_emitted({name: (PUBLIC / name).read_bytes() for name in products}, archive, catalog, record)
    print(f"NeuroSeq {'check' if args.check else 'build'} passed: {validation['geneCount']:,} genes, "
          f"54 libraries, 17 source groups, 15 display populations; "
          f"{compared:,} source values identical; 3/3 browser checkpoints matched.")


if __name__ == "__main__":
    main()
