"""Prepare authentic GSE107324 count inputs; never infer Excel-damaged symbols.

The workbooks contain author statistics, twelve normalized-expression columns,
and twelve integer count columns with duplicated sample labels. Every integer
row is checked against the deposited totreads field before it is exported.
"""
from __future__ import annotations

import argparse
import collections
import csv
import datetime
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import shutil

import openpyxl
import requests

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "geo_replication/datasets/GSE107324_rnor_hypothalamus_maternal_hfd"
DISCOVERY = ROOT / "data/quality/hfd-intake-2026-09-12/discovery/GSE107324"
SAMPLE_URL = "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE107324&targ=gsm&form=text&view=full"
PAPER_URL = "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0189492"


def digest(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def relative(path):
    return path.relative_to(ROOT).as_posix()


def write_tsv(path, header, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == ".gz":
        with path.open("wb") as raw:
            with gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0) as zipped:
                with io.TextIOWrapper(zipped, encoding="utf-8", newline="") as handle:
                    writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
                    writer.writerow(header)
                    writer.writerows(rows)
    else:
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
            writer.writerow(header)
            writer.writerows(rows)


def obtain(name, url, location, fetch):
    path = DATASET / location / name
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        cached = DISCOVERY / name
        if cached.exists():
            shutil.copyfile(cached, path)
        elif fetch:
            response = requests.get(url, timeout=(30, 120))
            response.raise_for_status()
            if response.status_code != 200:
                raise ValueError("Partial or unexpected source response")
            path.write_bytes(response.content)
        else:
            raise FileNotFoundError(f"Run with --fetch to obtain {url}")
    return path, {"source_url": url, "local_path": relative(path), "bytes": path.stat().st_size,
                  "sha256": digest(path), "accessed": "2026-09-12"}


def parse_samples(path):
    result = {}
    for block in path.read_text(encoding="utf-8").split("^SAMPLE = ")[1:]:
        lines = block.splitlines()
        gsm = lines[0].strip()
        values = collections.defaultdict(list)
        for line in lines[1:]:
            if line.startswith("!") and " = " in line:
                key, value = line[1:].split(" = ", 1)
                values[key].append(value)
        chars = dict(v.split(": ", 1) for v in values["Sample_characteristics_ch1"])
        title = values["Sample_title"][0]
        assert chars["tissue"] == "Hypothalamus" and chars["age"] == "Postnatal day 10"
        assert chars["diet"] in ("control diet", "high fat diet")
        assert chars["Sex"] in ("male", "female")
        assert "raw and normalized read count and statistics" in " ".join(values["Sample_data_processing"])
        assert title not in result
        result[title] = {"gsm": gsm, "sex": chars["Sex"], "diet": chars["diet"],
                         "group": "case" if chars["diet"] == "high fat diet" else "control"}
    assert len(result) == 24
    return result


def prepare(fetch=False):
    source_records = []
    metadata, record = obtain("GSE107324.gsm.soft", SAMPLE_URL, "metadata", fetch)
    source_records.append(record)
    samples = parse_samples(metadata)
    tracks, reviews = [], []
    for sex in ("male", "female"):
        name = f"GSE107324_{sex}DifferentialCounts0_50_topTable_edgeR_tabular_processed_data.xlsx"
        url = f"https://ftp.ncbi.nlm.nih.gov/geo/series/GSE107nnn/GSE107324/suppl/{name}"
        workbook, record = obtain(name, url, "raw/source", fetch)
        source_records.append(record)
        wb = openpyxl.load_workbook(workbook, read_only=True, data_only=True)
        assert wb.sheetnames == ["Sheet1"]
        rows = iter(wb.active.values)
        header = next(rows)
        assert header[:8] == ("Name", "logFC", "logCPM", "LR", "PValue", "adj.p.value", "Dispersion", "totreads")
        assert len(header) == 32
        labels = [h.strip() for h in header[20:32]]
        assert labels == [h.strip() for h in header[8:20]] and len(set(labels)) == 12
        assert all(samples[label]["sex"] == sex for label in labels)
        assert collections.Counter(samples[label]["group"] for label in labels) == {"control": 6, "case": 6}
        gsms = [samples[label]["gsm"] for label in labels]
        matrix, mapping, author, missing_names = [], [], [], []
        totals = [0] * 12
        ids = set()
        for row_number, row in enumerate(rows, 2):
            assert len(row) == 32
            raw_name = row[0]
            if isinstance(raw_name, str) and raw_name.strip():
                gene_id = raw_name.strip()
                symbol = gene_id
                status = "deposited_symbol"
                raw_label = raw_name
            else:
                gene_id = f"__GSE107324_{sex}_XLSX_ROW_{row_number}"
                symbol = gene_id
                status = "excel_damaged_symbol_unassigned"
                raw_label = raw_name.isoformat() if isinstance(raw_name, (datetime.date, datetime.datetime)) else str(raw_name)
                missing_names.append({"row": row_number, "deposited_name": raw_label, "feature_id": gene_id})
            assert gene_id not in ids, f"Unexpected duplicate deposited symbol: {gene_id}"
            ids.add(gene_id)
            counts = row[20:32]
            assert all(isinstance(n, (int, float)) and math.isfinite(n) and n >= 0 and n == int(n) for n in counts)
            counts = [int(n) for n in counts]
            assert sum(counts) == row[7], f"Source totreads disagreement at row {row_number}"
            totals = [a + b for a, b in zip(totals, counts)]
            matrix.append([gene_id, symbol, *counts])
            mapping.append([gene_id, symbol, row_number, raw_label, status])
            # Paper Results explicitly defines negative deposited logFC as an
            # increase in HFD. Preserve source and orient HFD/control separately.
            author.append([gene_id, symbol, row_number, row[1], -float(row[1]), row[4], row[5], row[2], row[3], status])
        wb.close()
        prefix = f"GSE107324_{sex}"
        count_path = DATASET / "processed" / f"{prefix}_source_counts.tsv.gz"
        sheet_path = DATASET / "metadata" / f"{prefix}_samples.tsv"
        author_path = DATASET / "processed" / f"{prefix}_author_results.tsv"
        map_path = DATASET / "metadata" / f"{prefix}_source_gene_map.tsv"
        write_tsv(count_path, ["gene_id", "symbol", *gsms], matrix)
        write_tsv(map_path, ["gene_id", "symbol", "xlsx_row", "deposited_name", "annotation_status"], mapping)
        write_tsv(author_path, ["gene_id", "symbol", "xlsx_row", "source_logFC_control_vs_hfd", "logFC_hfd_vs_control", "pvalue", "padj", "logCPM", "LR", "annotation_status"], author)
        sample_rows = [[samples[label]["gsm"], samples[label]["group"], samples[label]["gsm"], label,
                        sex, "offspring hypothalamus; litter-level n reported", "TRUE", "", samples[label]["diet"]]
                       for label in labels]
        write_tsv(sheet_path, ["sample", "group", "gsm", "animal", "sex", "unit", "included", "litter", "source_diet"], sample_rows)
        # Reopen written values independently of the output lists.
        with gzip.open(count_path, "rt", encoding="utf-8") as handle:
            exported = list(csv.reader(handle, delimiter="\t"))
        assert exported[0][2:] == gsms
        output_totals = [sum(int(r[i]) for r in exported[1:]) for i in range(2, 14)]
        assert output_totals == totals and len(exported) - 1 == len(matrix)
        reviews.append({"sex": sex, "source": relative(workbook), "sourceSha256": digest(workbook),
                        "sourceRows": len(matrix), "samples": gsms, "groupSizes": {"control": 6, "case": 6},
                        "rawCountColumnsOneBased": list(range(21, 33)), "countValuesVerified": len(matrix) * 12,
                        "everyRowMatchesSourceTotreads": True, "sourceLibraryTotals": dict(zip(gsms, totals)),
                        "outputLibraryTotals": dict(zip(gsms, output_totals)), "countConservation": True,
                        "unassignedNames": missing_names, "matrix": relative(count_path), "matrixSha256": digest(count_path),
                        "authorResults": relative(author_path), "authorResultsSha256": digest(author_path)})
        tracks.append({"id": sex, "label": f"{sex.capitalize()} offspring hypothalamus", "matrix": relative(count_path),
                       "samplesheet": relative(sheet_path), "kind": "counts", "analysisId": prefix})
    write_tsv(DATASET / "metadata/GSE107324_source_files.tsv", list(source_records[0]),
              [[record[key] for key in source_records[0]] for record in source_records])
    review = {"accession": "GSE107324", "status": "source_verified", "reviewed": "2026-09-12", "tracks": reviews,
              "correctedPriorDecision": "Prior rejection assumed topTable filenames lacked sample inputs. The actual workbooks include per-sample raw counts; all rows match totreads exactly.",
              "sourceReview": "Final twelve workbook columns are deposited nonnegative integer counts, not reconstructed from the preceding normalized columns. The tested input universe is limited to genes present in each author workbook. Excel-damaged names retain distinct row identifiers and their counts; no symbol is inferred.",
              "replicationReview": "The paper reports six samples per sex/diet and defines n as litters. Sexes are fitted separately. GEO does not identify the litter attached to each GSM, so cross-sex litter pairing cannot be verified and sexes are not pooled.",
              "authorReview": "Paper Results explicitly defines negative deposited logFC as increased expression in HFD offspring. The source logFC is retained and negated for HFD-versus-control comparison. These are independent deposited author statistics, distinct from a rerun of this pipeline.",
              "primarySources": [SAMPLE_URL, PAPER_URL]}
    review_path = DATASET / "metadata/GSE107324_source_review.json"
    review_path.write_text(json.dumps(review, indent=2) + "\n", encoding="utf-8")
    proposal = {"accession": "GSE107324", "id": "rat_hypo_maternal_hfd_gse107324", "name": "Rat neonatal hypothalamus maternal HFD",
                "category": "Developmental programming", "region": "Whole hypothalamus", "preparation": "Bulk tissue",
                "perturbation": "Maternal high-fat diet", "organism": "Rattus norvegicus", "modality": "bulk RNA-seq",
                "note": "Maternal 43% versus 12% fat-derived energy exposure through gestation and lactation; offspring sampled at postnatal day 10. Six samples per diet are analyzed separately within each sex. The paper defines n as litters, but GEO omits sample-to-litter identifiers. Deposited workbooks include authentic per-sample raw counts; the analysis universe is restricted to their submitted rows. Excel-damaged symbols remain unassigned feature IDs.",
                "source": "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE107324", "pmid": "29240779", "doi": "10.1371/journal.pone.0189492",
                "dir": relative(DATASET), "groups": [{"key": "control", "label": "Maternal control diet"}, {"key": "case", "label": "Maternal high-fat diet"}],
                "contrasts": [{"id": "hfd_vs_control", "label": "Maternal HFD vs control", "baseline": "control", "case": "case"}], "tracks": tracks}
    DISCOVERY.mkdir(parents=True, exist_ok=True)
    (DISCOVERY / "study-proposal.json").write_text(json.dumps(proposal, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"sourceReview": relative(review_path), "tracks": [{"sex": r["sex"], "genes": r["sourceRows"], "countValuesVerified": r["countValuesVerified"], "unassignedNames": len(r["unassignedNames"])} for r in reviews]}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true", help="Download missing public sources")
    args = parser.parse_args()
    prepare(fetch=args.fetch)
