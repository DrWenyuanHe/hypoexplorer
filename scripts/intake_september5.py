"""Reproducible source intake for the September 5 discovery batch.

Discovery evidence is immutable. Downloaded inputs and downstream decisions live
in dataset-local folders and a separate intake ledger.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import csv
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import time
import urllib.parse
import requests

ROOT = Path(__file__).resolve().parents[1]
DISCOVERY = ROOT / "nar-research/dataset-survey/browser-routes-2026-09-05"
OUT = ROOT / "data/intake/september5-2026"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def soft_records(path):
    text = gzip.open(path, "rt", encoding="utf-8").read() if path.suffix == ".gz" else path.read_text(encoding="utf-8")
    rows = []
    for line in text.splitlines():
        if line.startswith("^"):
            kind, accession = line[1:].split(" = ", 1)
            rows.append({"kind": kind, "accession": accession})
        elif line.startswith("!") and " = " in line and rows:
            key, value = line[1:].split(" = ", 1)
            rows[-1].setdefault(key, []).append(value)
    return rows


def dataset_dir(accession):
    return ROOT / "geo_replication/datasets" / (accession.replace("-", "") + "_discovery_20260905")


def metadata_path(record):
    rel = record.get("sample_metadata_path", "")
    if not rel:
        return None
    for base in (DISCOVERY, DISCOVERY / "extensive/geo"):
        path = base / rel
        if path.exists():
            return path
    raise FileNotFoundError(rel)


def inventory():
    records = []
    for r in read_json(DISCOVERY / "extensive/geo/supported-candidates.json"):
        acc = r["accession"]
        records.append({
            "accession": acc, "title": r["title"], "organism": r["species"],
            "discoveryDisposition": r["final_disposition"],
            "discoveryReason": r["decision_reason"],
            "biologicalReplication": r.get("biological_n"),
            "source": r["primary_url"], "bioproject": r.get("bioproject"),
            "pubmed": r.get("pubmed_ids", []),
            "metadata": str(metadata_path(r).relative_to(ROOT)),
            "files": r.get("file_inventory", []),
            "status": "already_integrated" if acc == "GSE214683" else "intake_pending",
        })
    for r in read_json(DISCOVERY / "extensive/secondary/sample-adjudicated-candidates.json"):
        if r.get("status") != "new_sample_adjudicated_candidate":
            continue
        records.append({"accession": r["id"], "title": r["title"],
                        "discoveryDisposition": r["status"],
                        "discoveryReason": r.get("notes"),
                        "biologicalReplication": r["independent_unit_evidence"],
                        "sources": r["source_urls"], "status": "intake_pending"})
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "ledger.json"
    if path.exists():
        previous = {r["accession"]: r for r in read_json(path)["records"]}
        records = [previous.get(r["accession"], r) for r in records]
    for record in records:
        if record['accession']=='GSE135007':
            record['metadata']=(DISCOVERY/'extensive/secondary/GSE135007-family.soft').relative_to(ROOT).as_posix()
    path.write_text(json.dumps({"batch": "2026-09-05", "records": records}, indent=2) + "\n", encoding="utf-8")
    return records


def download(url, path):
    url = url.replace("ftp://", "https://")
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        partial = path.with_name(path.name + ".part")
        for attempt in range(3):
            try:
                with requests.get(url, stream=True, timeout=(30, 120)) as response:
                    response.raise_for_status()
                    # A cached range response is not a complete input.
                    if response.status_code == 206:
                        raise ValueError("unexpected partial HTTP response")
                    expected = int(response.headers.get("Content-Length", 0))
                    with partial.open("wb") as handle:
                        # Preserve deposited bytes even if a server marks an
                        # already-gzipped scientific file Content-Encoding:gzip.
                        for chunk in response.raw.stream(1024 * 1024, decode_content=False):
                            handle.write(chunk)
                    if expected and partial.stat().st_size != expected:
                        raise ValueError(f"download length mismatch: expected {expected}, received {partial.stat().st_size}")
                    partial.replace(path)
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2 * (attempt + 1))
    digest = hashlib.file_digest(path.open("rb"), "sha256").hexdigest()
    print(f"downloaded {path.name}: {path.stat().st_size:,} bytes", flush=True)
    return {"source_url": url, "local_path": path.relative_to(ROOT).as_posix(),
            "bytes": path.stat().st_size, "sha256": digest, "accessed": "2026-09-05"}


def fetch(accessions):
    records = {r["accession"]: r for r in inventory()}
    tasks = []
    for acc in accessions:
        r = records[acc]
        ds = dataset_dir(acc)
        (ds / "metadata").mkdir(parents=True, exist_ok=True)
        if "metadata" in r:
            source = ROOT / r["metadata"]
            shutil.copy2(source, ds / "metadata" / source.name)
        urls = r.get("files", [])
        if acc in ("GSE337822", "GSE314184", "GSE281701", "GSE135007") and "metadata" in r:
            samples = [s for s in soft_records(ROOT / r["metadata"]) if s["kind"] == "SAMPLE"]
            if acc == "GSE281701":
                samples = [s for s in samples if 'hypothalamus' in str(s.get('Sample_title', [])).lower()]
            if acc == "GSE135007":
                samples = [s for s in samples if 'hypothalamus' in str(s.get('Sample_source_name_ch1', [])).lower() or 'hypothalamus' in str(s.get('Sample_characteristics_ch1', [])).lower()]
            urls = [url for s in samples for key,values in s.items()
                    if key.startswith("Sample_supplementary_file") for url in values if url.startswith('ftp') or url.startswith('http')]
        if acc == "GSE262407":
            urls = [url for url in urls if any(url.endswith(s) for s in ('_counts.mtx.gz','_features.tsv.gz','_barcodes.tsv.gz','_metadata.csv.gz')) and '_hto_' not in url]
        if acc.startswith("E-MTAB"):
            prefixes = read_json(DISCOVERY / "extensive/secondary/count-prefix-verification.json")
            urls = [x["url"] for x in prefixes if x["accession"] == acc]
            for source in (DISCOVERY / "extensive/secondary").glob(acc + "*.tsv"):
                if "sdrf" in source.name:
                    shutil.copy2(source, ds / "metadata" / source.name)
        for url in urls:
            name = urllib.parse.unquote(url.rsplit("/", 1)[1])
            # Explicit count inputs for the first bulk intake. Other assays
            # have their own import paths and never enter this filter by guess.
            if acc in ("GSE317867", "GSE309435", "GSE278158", "GSE148252"):
                if not any(x in name.lower() for x in ("count", "conts")) or name.endswith("RData.gz"):
                    continue
            tasks.append((acc, url, ds / "raw" / name))
    manifest = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(download, url, path): acc for acc, url, path in tasks}
        for future in concurrent.futures.as_completed(futures):
            acc = futures[future]
            try:
                result = future.result()
                manifest.setdefault(acc, []).append(result)
            except Exception as e:
                print(f"FAILED {acc}: {e}", flush=True)
    for acc, files in manifest.items():
        path = dataset_dir(acc) / "metadata" / (acc + "_source_files.tsv")
        old = list(csv.DictReader(path.open(encoding="utf-8"), delimiter="\t")) if path.exists() else []
        merged = {x["local_path"]: x for x in old + files}
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(files[0]), delimiter="\t")
            writer.writeheader()
            writer.writerows(merged.values())


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["inventory", "fetch", "samples"])
    parser.add_argument("accessions", nargs="*")
    args = parser.parse_args()
    if args.action == "inventory":
        for r in inventory():
            print(r["accession"], r["discoveryDisposition"], r["status"])
    elif args.action == "fetch":
        fetch(args.accessions)
    else:
        for r in inventory():
            if r["accession"] not in args.accessions or "metadata" not in r:
                continue
            print(r["accession"])
            for s in soft_records(ROOT / r["metadata"]):
                if s["kind"] == "SAMPLE":
                    print(s["accession"], s.get("Sample_title"), s.get("Sample_characteristics_ch1"), s.get("Sample_supplementary_file", []))
