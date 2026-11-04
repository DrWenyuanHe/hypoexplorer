#!/usr/bin/env python3
"""Independently replay XLSX XML count cells, without the preparation library."""
import csv
import gzip
import hashlib
import json
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "geo_replication/datasets/GSE107324_rnor_hypothalamus_maternal_hfd"
OUT = ROOT / "data/internal-qc/hfd-intake-2026-09-12"
NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def col_number(address):
    value = 0
    for char in address:
        if not char.isalpha():
            break
        value = 26 * value + ord(char) - ord("A") + 1
    return value


def read_xlsx_xml(path):
    with zipfile.ZipFile(path) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            shared = ["".join(node.itertext()) for node in strings.findall("x:si", NS)]
        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        result = []
        for row in sheet.findall("x:sheetData/x:row", NS):
            number = int(row.attrib["r"])
            cells = {}
            for cell in row.findall("x:c", NS):
                raw = cell.find("x:v", NS)
                if cell.attrib.get("t") == "inlineStr":
                    value = "".join(cell.find("x:is", NS).itertext())
                elif raw is None:
                    value = None
                elif cell.attrib.get("t") == "s":
                    value = shared[int(raw.text)]
                else:
                    value = float(raw.text)
                cells[col_number(cell.attrib["r"])] = value
            result.append((number, cells))
        return result


def main():
    manifest = list(csv.DictReader((BASE / "metadata/GSE107324_source_files.tsv").open(encoding="utf-8"), delimiter="\t"))
    for entry in manifest:
        assert sha(ROOT / entry["local_path"]) == entry["sha256"]
    reports = []
    for sex in ["male", "female"]:
        stem = f"GSE107324_{sex}"
        workbook = BASE / "raw/source" / f"{stem}DifferentialCounts0_50_topTable_edgeR_tabular_processed_data.xlsx"
        prepared_path = BASE / "processed" / f"{stem}_source_counts.tsv.gz"
        sheet_path = BASE / "metadata" / f"{stem}_samples.tsv"
        sample_sheet = list(csv.DictReader(sheet_path.open(encoding="utf-8"), delimiter="\t"))
        samples = {row["animal"]: row for row in sample_sheet}
        with gzip.open(prepared_path, "rt", encoding="utf-8") as handle:
            reader = csv.DictReader(handle, delimiter="\t")
            prepared_order = reader.fieldnames[2:]
            prepared = {row["gene_id"]: row for row in reader}
        xml_rows = read_xlsx_xml(workbook)
        header = xml_rows[0][1]
        assert header[1] == "Name" and header[8] == "totreads"
        labels = [header[col].strip() for col in range(21, 33)]
        assert labels == [header[col].strip() for col in range(9, 21)]
        gsms = [samples[label]["gsm"] for label in labels]
        assert gsms == prepared_order
        assert sum(samples[label]["group"] == "control" for label in labels) == 6
        assert sum(samples[label]["group"] == "case" for label in labels) == 6
        observed_ids = []
        sentinels = []
        total = [0] * 12
        for row_number, cells in xml_rows[1:]:
            raw_name = cells.get(1)
            gene = raw_name.strip() if isinstance(raw_name, str) and raw_name.strip() else f"__GSE107324_{sex}_XLSX_ROW_{row_number}"
            if gene.startswith("__GSE107324"):
                sentinels.append(gene)
            counts = [cells[col] for col in range(21, 33)]
            assert all(value >= 0 and value == int(value) for value in counts)
            assert sum(counts) == cells[8]
            row = prepared[gene]
            assert row["symbol"] == gene
            assert [int(row[gsm]) for gsm in gsms] == counts
            total = [a + int(b) for a, b in zip(total, counts, strict=True)]
            observed_ids.append(gene)
        assert len(set(observed_ids)) == len(observed_ids) == len(prepared)
        assert set(observed_ids) == set(prepared)
        reports.append(dict(track=sex, status="passed", sourceRows=len(observed_ids),
                            everyCountCellCompared=len(observed_ids) * 12, allRowTotalsMatch=True,
                            allPreparedValuesExact=True, missingSymbolsPreserved=sentinels,
                            libraryTotals=dict(zip(gsms, total)),
                            dependencies=[dict(path=p.relative_to(ROOT).as_posix(), sha256=sha(p))
                                          for p in [workbook, prepared_path, sheet_path]]))
    result = dict(accession="GSE107324", status="passed", method="Direct XLSX ZIP/XML read of raw-count columns 21-32; independent of preparation openpyxl reader", tracks=reports)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "107324-source-independent.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
