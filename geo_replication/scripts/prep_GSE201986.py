#!/usr/bin/env python3
"""Prepare the GSE201986 macaque arcuate-nucleus sex contrast.

The official XLSX contains FPM values at transcript-ID resolution. February is
excluded symmetrically because its male ARC profile is a severe low-complexity
outlier; the five remaining months form a balanced month-blocked 5-vs-5 contrast.
Only Python's standard library is used, and gzip output has mtime=0 so reruns
are byte-identical.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import html
import io
import math
import os
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
import zipfile


SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent
DS = ROOT / "datasets" / "GSE201986_mmul_arc_sex_season"
XLSX = DS / "raw" / "GSE201986_ARC.xlsx"
SOFT = DS / "metadata" / "GSE201986_family.soft.gz"
PAPER = DS / "metadata" / "PMC12037758.xml"

SOURCES = [
    {
        "path": XLSX,
        "bytes": 5_987_944,
        "sha256": "0482dfdb31c2abed495d81f148b576c7cb7565ff084a78f2be215de736e43d61",
        "url": "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE201nnn/GSE201986/suppl/GSE201986_ARC.xlsx",
    },
    {
        "path": SOFT,
        "bytes": 49_519,
        "sha256": "bff2e62caa4b6c2e365423bec96c6f40f32b56a6a33142a2e80ed6f215707dad",
        "url": "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE201nnn/GSE201986/soft/GSE201986_family.soft.gz",
    },
    {
        "path": PAPER,
        "bytes": 277_751,
        "sha256": "562679652faa6a400c97d2dbea79f154b62e3683f1505a598ce8560a436c033a",
        "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC12037758/?report=xml",
    },
]

ALL_COLUMNS = [
    "M_OCT_ARC", "M_DEC_ARC", "M_FEB_ARC", "M_APR_ARC", "M_JUN_ARC", "M_AUG_ARC",
    "F_OCT_ARC", "F_DEC_ARC", "F_FEB_ARC", "F_APR_ARC", "F_JUN_ARC", "F_AUG_ARC",
]
RETAINED = [
    "M_OCT_ARC", "M_DEC_ARC", "M_APR_ARC", "M_JUN_ARC", "M_AUG_ARC",
    "F_OCT_ARC", "F_DEC_ARC", "F_APR_ARC", "F_JUN_ARC", "F_AUG_ARC",
]
MONTH_INFO = {
    "OCT": ("October", 2019), "DEC": ("December", 2019), "FEB": ("February", 2020),
    "APR": ("April", 2020), "JUN": ("June", 2020), "AUG": ("August", 2020),
}
EXPECTED_GSM = {
    "F_APR_ARC": "GSM6085438", "F_AUG_ARC": "GSM6085515", "F_DEC_ARC": "GSM6085592",
    "F_FEB_ARC": "GSM6085669", "F_JUN_ARC": "GSM6085746", "F_OCT_ARC": "GSM6085822",
    "M_APR_ARC": "GSM6085899", "M_AUG_ARC": "GSM6085976", "M_DEC_ARC": "GSM6086053",
    "M_FEB_ARC": "GSM6086130", "M_JUN_ARC": "GSM6086207", "M_OCT_ARC": "GSM6086285",
}


def fail(message: str) -> None:
    raise RuntimeError(message)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def pin_sources() -> list[tuple[int, str]]:
    observed: list[tuple[int, str]] = []
    for source in SOURCES:
        path = source["path"]
        if not path.is_file():
            fail(f"required authoritative source is missing: {path}")
        record = (path.stat().st_size, sha256(path))
        if record != (source["bytes"], source["sha256"]):
            fail(f"source bytes/SHA-256 differ from reviewed input: {path.name}")
        observed.append(record)
    return observed


def parse_soft() -> dict[str, dict[str, str]]:
    with gzip.open(SOFT, "rt", encoding="utf-8", errors="strict") as handle:
        lines = [line.rstrip("\r\n") for line in handle]
    design = [x.split(" = ", 1)[1] for x in lines if x.startswith("!Series_overall_design = ")]
    if len(design) != 1 or "collected every 2 months from male and female NHP rhesus macaques" not in design[0]:
        fail("GEO series design no longer matches the seasonal male/female macaque atlas")
    starts = [i for i, line in enumerate(lines) if line.startswith("^SAMPLE = ")]
    ends = starts[1:] + [len(lines)]
    by_title: dict[str, dict[str, str]] = {}
    for start, end in zip(starts, ends):
        block = lines[start:end]
        gsm = block[0].split(" = ", 1)[1]
        values: dict[str, list[str]] = {}
        for line in block[1:]:
            if " = " in line:
                key, value = line.split(" = ", 1)
                values.setdefault(key, []).append(value)
        title = values.get("!Sample_title", [""])
        if len(title) != 1:
            fail(f"{gsm}: expected exactly one title")
        if title[0] not in ALL_COLUMNS:
            continue
        if title[0] in by_title:
            fail(f"duplicate GEO title: {title[0]}")
        sex = title[0][0]
        month_code = title[0].split("_")[1]
        month, year = MONTH_INFO[month_code]
        required = {"tissue: arcuate nucleus", f"Sex: {sex}", f"sampling point: {month}, {year}"}
        chars = set(values.get("!Sample_characteristics_ch1", []))
        relations = values.get("!Sample_relation", [])
        biosamples = [x.rsplit("/", 1)[-1] for x in relations if x.startswith("BioSample: ")]
        if gsm != EXPECTED_GSM[title[0]] or values.get("!Sample_source_name_ch1") != ["arcuate nucleus"]:
            fail(f"{title[0]}: GSM/source_name changed in GEO")
        if not required.issubset(chars) or len(biosamples) != 1:
            fail(f"{title[0]}: required GEO sex/month/tissue/BioSample metadata missing")
        by_title[title[0]] = {"gsm": gsm, "biosample": biosamples[0], "month": month, "year": str(year), "sex": sex}
    if set(by_title) != set(ALL_COLUMNS):
        fail("GEO family SOFT does not contain the exact 12 ARC sex-by-month samples")
    if len({x["biosample"] for x in by_title.values()}) != 12:
        fail("ARC libraries do not resolve to 12 distinct GEO BioSamples")
    return by_title


def verify_independent_animals() -> None:
    paper = html.unescape(PAPER.read_text(encoding="utf-8", errors="strict"))
    required = [
        "Twenty six adult rhesus macaques",
        "one male and one female every 2 months from October 2019 to August 2020",
        "on the day of euthanasia",
        "Gene expression was presented as the fragments per million (FPM)",
    ]
    if not all(phrase in paper for phrase in required):
        fail("pinned primary article no longer establishes independent euthanized animals, sampling schedule, and FPM scale")


NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def column_number(cell_reference: str) -> int:
    match = re.match(r"^([A-Z]+)[0-9]+$", cell_reference)
    if not match:
        fail(f"invalid XLSX cell reference: {cell_reference}")
    number = 0
    for character in match.group(1):
        number = number * 26 + ord(character) - 64
    return number - 1


def shared_strings(archive: zipfile.ZipFile) -> list[str]:
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    return ["".join(node.text or "" for node in item.iter(NS + "t")) for item in root.findall(NS + "si")]


def cell_value(cell: ET.Element, strings: list[str]) -> str | float | None:
    kind = cell.get("t")
    value = cell.find(NS + "v")
    if kind == "inlineStr":
        return "".join(node.text or "" for node in cell.iter(NS + "t"))
    if value is None or value.text is None:
        return None
    if kind == "s":
        return strings[int(value.text)]
    return float(value.text)


class DeterministicGzipText:
    def __init__(self, path: Path):
        self.raw = path.open("wb")
        self.gz = gzip.GzipFile(filename="", mode="wb", fileobj=self.raw, mtime=0)
        self.text = io.TextIOWrapper(self.gz, encoding="utf-8", newline="")

    def __enter__(self) -> io.TextIOWrapper:
        return self.text

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        self.text.close()


def fmt(value: float) -> str:
    return format(value, ".17g")


def write_tsv_atomic(path: Path, rows: list[list[object]]) -> None:
    temporary = path.with_name(path.name + ".tmp")
    try:
        with temporary.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
            writer.writerows(rows)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def process_workbook() -> tuple[int, list[dict[str, float | int]]]:
    output = DS / "raw" / "GSE201986_ARC_female_vs_male_log2fpm.tsv.gz"
    temporary = output.with_name(output.name + ".tmp")
    sums = [0.0] * 12
    detected = [0] * 12
    fractional = [0] * 12
    log_sums = [0.0] * 12
    transform_delta = [0.0] * 12
    retained_indices = [ALL_COLUMNS.index(name) for name in RETAINED]
    seen_ids: set[str] = set()
    identifier_classes = {"ensembl_transcript": 0, "refseq": 0, "custom_tu": 0, "other": 0}
    row_count = 0
    try:
        with zipfile.ZipFile(XLSX) as archive:
            workbook = ET.fromstring(archive.read("xl/workbook.xml"))
            sheets = workbook.findall(".//" + NS + "sheet")
            if len(sheets) != 1 or sheets[0].get("name") != "ARC":
                fail("XLSX workbook no longer contains exactly one ARC sheet")
            strings = shared_strings(archive)
            with archive.open("xl/worksheets/sheet1.xml") as sheet, DeterministicGzipText(temporary) as handle:
                writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
                writer.writerow(["TranscriptID", *RETAINED])
                for _, element in ET.iterparse(sheet, events=("end",)):
                    if element.tag != NS + "row":
                        continue
                    row_number = int(element.get("r", "0"))
                    values: list[str | float | None] = [None] * 13
                    for cell in element.findall(NS + "c"):
                        index = column_number(cell.get("r", ""))
                        if index >= 13:
                            fail("unexpected column beyond M in ARC worksheet")
                        values[index] = cell_value(cell, strings)
                    if row_number == 1:
                        if values != ["TranscriptID", *ALL_COLUMNS]:
                            fail("ARC XLSX header changed")
                        element.clear()
                        continue
                    if row_number != row_count + 2:
                        fail("ARC XLSX row numbers are not contiguous")
                    transcript = values[0]
                    if not isinstance(transcript, str) or not transcript.strip() or re.search(r"[\t\r\n]", transcript):
                        fail(f"row {row_number}: blank or malformed source feature ID")
                    if transcript in seen_ids:
                        fail(f"duplicate transcript ID: {transcript}")
                    seen_ids.add(transcript)
                    if re.fullmatch(r"ENSMMUT[0-9]+", transcript):
                        identifier_classes["ensembl_transcript"] += 1
                    elif re.fullmatch(r"(?:XM|XR|NM|NR)_[0-9]+(?:[.][0-9]+)?(?:_[0-9]+)?", transcript):
                        identifier_classes["refseq"] += 1
                    elif re.match(r"^TU", transcript):
                        identifier_classes["custom_tu"] += 1
                    else:
                        identifier_classes["other"] += 1
                    numeric: list[float] = []
                    for value in values[1:]:
                        if not isinstance(value, float) or not math.isfinite(value) or value < 0:
                            fail(f"row {row_number}: FPM value is missing, nonfinite, or negative")
                        numeric.append(value)
                    transformed = [math.log2(value + 1.0) for value in numeric]
                    for i, (source, logged) in enumerate(zip(numeric, transformed)):
                        sums[i] += source
                        detected[i] += int(source > 0)
                        fractional[i] += int(source != round(source))
                        log_sums[i] += logged
                        transform_delta[i] = max(transform_delta[i], abs((2.0**logged - 1.0) - source))
                    writer.writerow([transcript, *[fmt(transformed[i]) for i in retained_indices]])
                    row_count += 1
                    element.clear()
        if row_count != 54_213 or len(seen_ids) != 54_213:
            fail("ARC worksheet no longer has 54,213 unique transcript features")
        if identifier_classes != {"ensembl_transcript": 35432, "refseq": 9307, "custom_tu": 5008, "other": 4466}:
            fail("mixed Ensembl/RefSeq/custom feature-ID composition changed")
        feb = ALL_COLUMNS.index("M_FEB_ARC")
        if any(abs(total - 1_000_000) > 1 for total in sums):
            fail("one or more official ARC profiles no longer have the documented FPM-total signature")
        if detected[feb] != 6_784 or any(detected[i] < 20_000 for i in range(12) if i != feb):
            fail("reviewed M_FEB_ARC low-complexity outlier signature changed; reassess the balanced exclusion")
        if any(sums[i] <= 0 or detected[i] < 1_000 for i in retained_indices):
            fail("a retained ARC sample has an implausibly empty FPM profile")
        if any(transform_delta[i] > 1e-10 for i in retained_indices):
            fail("log2(FPM+1) transform reversibility check failed")
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)

    with gzip.open(output, "rt", encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle, delimiter="\t")
        header = next(reader)
        written_rows = sum(1 for _ in reader)
    if header != ["TranscriptID", *RETAINED] or written_rows != row_count:
        fail("written matrix round-trip dimensions/header failed")
    metrics = [
        {
            "source_fpm_sum": sums[i], "detected_transcripts": detected[i],
            "source_fractional_values": fractional[i], "log2_expression_sum": log_sums[i],
            "transform_max_abs_delta": transform_delta[i],
        }
        for i in range(12)
    ]
    return row_count, metrics


def main() -> int:
    observed = pin_sources()
    metadata = parse_soft()
    verify_independent_animals()
    feature_count, metrics = process_workbook()

    samplesheet = [[
        "sample", "group", "geo_accession", "biosample", "sex", "month", "year",
        "tissue", "biological_replicate",
    ]]
    replicate = {"M": 0, "F": 0}
    for name in RETAINED:
        sex_code = name[0]
        replicate[sex_code] += 1
        record = metadata[name]
        samplesheet.append([
            name, "control" if sex_code == "M" else "case", record["gsm"], record["biosample"],
            "male" if sex_code == "M" else "female", record["month"], record["year"],
            "arcuate nucleus", replicate[sex_code],
        ])
    if [sum(row[1] == arm for row in samplesheet[1:]) for arm in ("control", "case")] != [5, 5]:
        fail("retained samplesheet is no longer 5 control versus 5 case")
    write_tsv_atomic(DS / "metadata" / "GSE201986_samplesheet.tsv", samplesheet)

    qc = [[
        "sample", "group", "geo_accession", "biosample", "analysis_keep", "exclusion_reason",
        "source_rows", "source_nonfinite_values", "source_negative_values", "source_fractional_values",
        "source_fpm_sum", "detected_transcripts", "log2_expression_sum", "transform_max_abs_delta",
        "written_output_rows",
    ]]
    for i, name in enumerate(ALL_COLUMNS):
        keep = name in RETAINED
        reason = ""
        if name == "M_FEB_ARC":
            reason = "low-complexity official ARC profile: 6,784 of 54,213 features detected"
        elif name == "F_FEB_ARC":
            reason = "paired month excluded because male counterpart is a low-complexity outlier"
        record = metadata[name]
        metric = metrics[i]
        qc.append([
            name, "control" if name.startswith("M_") else "case", record["gsm"], record["biosample"],
            "TRUE" if keep else "FALSE", reason, feature_count, 0, 0,
            metric["source_fractional_values"], fmt(metric["source_fpm_sum"]), metric["detected_transcripts"],
            fmt(metric["log2_expression_sum"]), fmt(metric["transform_max_abs_delta"]), feature_count if keep else "",
        ])
    write_tsv_atomic(DS / "processed" / "GSE201986_preprocessing_qc.tsv", qc)

    manifest = [["file", "bytes", "sha256", "source", "fetched"]]
    for source, (size, digest) in zip(SOURCES, observed):
        manifest.append([Path(source["path"]).name, size, digest, source["url"], "2026-08-31"])
    write_tsv_atomic(DS / "metadata" / "GSE201986_source_files.tsv", manifest)
    retained_sums = [metrics[ALL_COLUMNS.index(name)]["source_fpm_sum"] for name in RETAINED]
    print(f"[GSE201986] wrote {feature_count} transcript features x 10 samples (male=5, female=5; month-blocked; February excluded)")
    print(f"[GSE201986] retained FPM sums: {min(retained_sums):.6f}-{max(retained_sums):.6f}; independent-animal and transform checks passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise
