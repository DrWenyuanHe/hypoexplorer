#!/usr/bin/env python3
"""Prepare the GSE281503 vehicle-matched LPS contrast from the GEO workbook.

The deposited XLSX declares worksheet dimension A1 even though its worksheet
contains 417 columns.  Generic workbook readers therefore expose a 1x1 sheet.
This adapter deliberately streams the underlying OOXML worksheet and extracts
the explicitly labelled per-sample ``Total gene reads`` columns together with
the complete author EDGE result for the registered contrast.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import io
import math
import re
import zipfile
from collections import OrderedDict
from decimal import Decimal, InvalidOperation
from pathlib import Path
from xml.etree import ElementTree as ET


ACCESSION = "GSE281503"
FETCHED = "2026-08-31"
WORKBOOK_NAME = "GSE281503_Effects_of_daridorexant_on_LPS-induced_mice.xlsx"
SOFT_NAME = "GSE281503_family.soft.gz"
WORKSHEET = "xl/worksheets/sheet1.xml"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

EXPECTED_SOURCES = {
    WORKBOOK_NAME: (
        95_577_716,
        "be9f583938d504ee73d122534881f731cc5de597c4022c9f3c603735befe1ad5",
        "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE281nnn/GSE281503/suppl/"
        + WORKBOOK_NAME,
    ),
    SOFT_NAME: (
        3_501,
        "6103c960b5b1ada071850d2f6037ca1c257031621562a2bb18432861724c0457",
        "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE281nnn/GSE281503/soft/"
        + SOFT_NAME,
    ),
}

# Keep the vehicle arm fixed and vary only the inflammatory challenge.
SAMPLES = [
    ("Saline_Vehi1", "control", "saline_vehicle"),
    ("Saline_Vehi2", "control", "saline_vehicle"),
    ("Saline_Vehi3", "control", "saline_vehicle"),
    ("Saline_Vehi4", "control", "saline_vehicle"),
    ("LPS_Vehi1", "case", "lps_vehicle"),
    ("LPS_Vehi2", "case", "lps_vehicle"),
    ("LPS_Vehi3", "case", "lps_vehicle"),
    ("LPS_Vehi4", "case", "lps_vehicle"),
]

AUTHOR_RESULT_COLUMNS = OrderedDict(
    [
        (
            "pvalue",
            "EDGE test: Saline_Vehi vs LPS_Vehi, tagwise dispersions - P-value",
        ),
        (
            "signed_fold_change",
            "EDGE test: Saline_Vehi vs LPS_Vehi, tagwise dispersions - Fold change",
        ),
        (
            "weighted_difference",
            "EDGE test: Saline_Vehi vs LPS_Vehi, tagwise dispersions - Weighted difference",
        ),
        (
            "padj",
            "EDGE test: Saline_Vehi vs LPS_Vehi, tagwise dispersions - FDR p-value correction",
        ),
    ]
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def check_source(path: Path) -> tuple[int, str, str]:
    expected_bytes, expected_sha, url = EXPECTED_SOURCES[path.name]
    observed_bytes = path.stat().st_size
    observed_sha = sha256(path)
    if observed_bytes != expected_bytes:
        raise RuntimeError(
            f"{path.name}: expected {expected_bytes} bytes, observed {observed_bytes}"
        )
    if observed_sha != expected_sha:
        raise RuntimeError(
            f"{path.name}: expected SHA256 {expected_sha}, observed {observed_sha}"
        )
    return observed_bytes, observed_sha, url


def read_soft_samples(path: Path) -> dict[str, dict[str, object]]:
    samples: dict[str, dict[str, object]] = {}
    current: dict[str, object] | None = None
    with gzip.open(path, "rt", encoding="utf-8", errors="replace") as handle:
        for raw in handle:
            line = raw.rstrip("\r\n")
            if line.startswith("^SAMPLE = "):
                gsm = line.split(" = ", 1)[1]
                current = {"gsm": gsm, "characteristics": []}
            elif current is not None and line.startswith("!Sample_title = "):
                title = line.split(" = ", 1)[1]
                current["title"] = title
                samples[title] = current
            elif current is not None and line.startswith("!Sample_source_name_ch1 = "):
                current["source"] = line.split(" = ", 1)[1]
            elif current is not None and line.startswith("!Sample_characteristics_ch1 = "):
                characteristics = current["characteristics"]
                assert isinstance(characteristics, list)
                characteristics.append(line.split(" = ", 1)[1])

    if len(samples) != 16:
        raise RuntimeError(f"expected 16 GEO samples, observed {len(samples)}")
    for title, _, _ in SAMPLES:
        if title not in samples:
            raise RuntimeError(f"retained GEO title not found in SOFT: {title}")
        block = samples[title]
        evidence = " ".join(
            [str(block.get("source", "")), *map(str, block["characteristics"])]
        ).lower()
        if "hypothalamus" not in evidence or "sex: male" not in evidence:
            raise RuntimeError(f"unexpected tissue/sex metadata for {title}: {evidence}")
        expected_treatment = "treatment: lps" if title.startswith("LPS") else "treatment: saline"
        if expected_treatment not in evidence:
            raise RuntimeError(f"unexpected treatment metadata for {title}: {evidence}")
    return samples


def cell_text(cell: ET.Element) -> str:
    inline = "".join(node.text or "" for node in cell.iter(NS + "t"))
    if inline:
        return inline
    value = cell.find(NS + "v")
    return "" if value is None or value.text is None else value.text


def column_ref(cell_ref: str) -> str:
    match = re.match(r"^([A-Z]+)", cell_ref)
    if not match:
        raise RuntimeError(f"invalid OOXML cell reference: {cell_ref}")
    return match.group(1)


def workbook_name(title: str) -> tuple[str, str]:
    match = re.match(r"^(.*?)([1-4])$", title)
    if not match:
        raise RuntimeError(f"cannot derive workbook sample name from {title}")
    group, replicate = match.groups()
    return group, f"{group}_{replicate}"


def integer_count(text: str, row_number: int, sample: str) -> int:
    if text == "":
        raise RuntimeError(f"missing count at worksheet row {row_number}, sample {sample}")
    try:
        value = Decimal(text)
    except InvalidOperation as exc:
        raise RuntimeError(
            f"non-numeric count at worksheet row {row_number}, sample {sample}: {text}"
        ) from exc
    if not value.is_finite() or value < 0 or value != value.to_integral_value():
        raise RuntimeError(
            f"count is not a nonnegative integer at row {row_number}, sample {sample}: {text}"
        )
    return int(value)


def result_number(text: str, row_number: int, field: str) -> float | str:
    if text in {"", "NaN", "nan", "Infinity", "-Infinity"}:
        return ""
    try:
        value = float(text)
    except ValueError as exc:
        raise RuntimeError(
            f"non-numeric author result at worksheet row {row_number}, "
            f"field {field}: {text!r}"
        ) from exc
    if not math.isfinite(value):
        return ""
    return value


def extract_counts(
    path: Path,
) -> tuple[list[str], list[list[int]], list[list[object]], list[int], int, int]:
    genes: list[str] = []
    merged: OrderedDict[str, list[int]] = OrderedDict()
    author_results: list[list[object]] = []
    source_totals = [0] * len(SAMPLES)
    source_rows = 0

    with zipfile.ZipFile(path) as workbook:
        if WORKSHEET not in workbook.namelist():
            raise RuntimeError(f"missing OOXML worksheet: {WORKSHEET}")
        info = workbook.getinfo(WORKSHEET)
        if info.file_size != 941_776_894:
            raise RuntimeError(
                f"unexpected uncompressed worksheet size: {info.file_size}"
            )
        with workbook.open(WORKSHEET) as worksheet:
            header: dict[str, str] | None = None
            gene_columns: list[str] = []
            count_columns: list[str] = []
            feature_column = ""
            author_columns: OrderedDict[str, str] = OrderedDict()
            selected_columns: set[str] = set()

            for _, row in ET.iterparse(worksheet, events=("end",)):
                if row.tag != NS + "row":
                    continue
                row_number = int(row.attrib["r"])
                values = {
                    column_ref(cell.attrib["r"]): cell_text(cell)
                    for cell in row.findall(NS + "c")
                }

                if header is None:
                    header = values
                    if len(header) != 417 or header.get("A") != "Feature ID":
                        raise RuntimeError(
                            f"unexpected workbook header: {len(header)} cells, A={header.get('A')!r}"
                        )
                    reverse = {label: column for column, label in header.items()}
                    feature_column = reverse["Feature ID"]
                    for title, _, _ in SAMPLES:
                        group, workbook_sample = workbook_name(title)
                        gene_label = f"{group} - {workbook_sample} - Gene ID"
                        count_label = f"{group} - {workbook_sample} - Total gene reads"
                        if gene_label not in reverse or count_label not in reverse:
                            raise RuntimeError(
                                f"missing required workbook columns for {title}: "
                                f"{gene_label!r}, {count_label!r}"
                            )
                        gene_columns.append(reverse[gene_label])
                        count_columns.append(reverse[count_label])
                    for field, label in AUTHOR_RESULT_COLUMNS.items():
                        if label not in reverse:
                            raise RuntimeError(
                                f"missing required author-result column: {label!r}"
                            )
                        author_columns[field] = reverse[label]
                    selected_columns = set(
                        gene_columns
                        + count_columns
                        + list(author_columns.values())
                        + [feature_column]
                    )
                    row.clear()
                    continue

                selected = {column: values.get(column, "") for column in selected_columns}
                row_genes = [selected[column] for column in gene_columns]
                if not row_genes[0] or any(gene != row_genes[0] for gene in row_genes[1:]):
                    raise RuntimeError(
                        f"sample gene-ID columns disagree at worksheet row {row_number}: {row_genes}"
                    )
                gene = row_genes[0]
                if not re.fullmatch(r"ENSMUSG\d+", gene):
                    raise RuntimeError(
                        f"unexpected Ensembl gene ID at worksheet row {row_number}: {gene!r}"
                    )
                feature_id = selected[feature_column]
                if not feature_id:
                    raise RuntimeError(
                        f"missing Feature ID at worksheet row {row_number}"
                    )
                counts = [
                    integer_count(selected[column], row_number, SAMPLES[index][0])
                    for index, column in enumerate(count_columns)
                ]
                author_results.append(
                    [
                        gene,
                        feature_id,
                        *[
                            result_number(selected[column], row_number, field)
                            for field, column in author_columns.items()
                        ],
                    ]
                )
                for index, count in enumerate(counts):
                    source_totals[index] += count
                source_rows += 1

                if gene not in merged:
                    merged[gene] = counts
                    genes.append(gene)
                else:
                    merged[gene] = [
                        old + new for old, new in zip(merged[gene], counts, strict=True)
                    ]
                row.clear()

    if source_rows < 20_000:
        raise RuntimeError(f"implausibly few gene rows extracted: {source_rows}")
    matrix = [merged[gene] for gene in genes]
    merged_totals = [sum(row[i] for row in matrix) for i in range(len(SAMPLES))]
    if merged_totals != source_totals:
        raise RuntimeError(
            f"count conservation failed: source={source_totals}, merged={merged_totals}"
        )
    if len(author_results) != source_rows:
        raise RuntimeError(
            f"author-result row count mismatch: {len(author_results)} versus {source_rows}"
        )
    missing_author_values = sum(
        value == "" for row in author_results for value in row[2:]
    )
    if missing_author_values:
        raise RuntimeError(
            f"complete author result has {missing_author_values} missing statistics"
        )
    author_paper_calls = sum(
        float(row[5]) < 0.05 and abs(float(row[3])) >= 2
        for row in author_results
    )
    if author_paper_calls != 265:
        raise RuntimeError(
            f"expected 265 complete-result paper-rule calls, observed {author_paper_calls}"
        )
    return genes, matrix, author_results, source_totals, source_rows, len(genes)


def write_tsv(path: Path, header: list[str], rows: list[list[object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(header)
        writer.writerows(rows)


def write_gzip_tsv(path: Path, header: list[str], rows: list[list[object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
            with io.TextIOWrapper(compressed, encoding="utf-8", newline="") as text:
                writer = csv.writer(text, delimiter="\t", lineterminator="\n")
                writer.writerow(header)
                writer.writerows(rows)


def main() -> None:
    repo = Path(__file__).resolve().parents[1]
    dataset = repo / "geo_replication" / "datasets" / "GSE281503_mmus_hypo_lps"
    raw_dir = dataset / "raw"
    metadata_dir = dataset / "metadata"
    processed_dir = dataset / "processed"
    validation_dir = repo / "data" / "author-validation" / "derived"
    workbook_path = raw_dir / WORKBOOK_NAME
    soft_path = metadata_dir / SOFT_NAME

    source_records = [
        (path.name, *check_source(path)) for path in (workbook_path, soft_path)
    ]
    soft_samples = read_soft_samples(soft_path)
    genes, matrix, author_results, libraries, source_rows, merged_rows = extract_counts(
        workbook_path
    )

    sample_names = [sample for sample, _, _ in SAMPLES]
    output_rows = [[gene, *counts] for gene, counts in zip(genes, matrix, strict=True)]
    output_path = raw_dir / "GSE281503_lps_vs_saline_vehicle_counts.tsv.gz"
    write_gzip_tsv(output_path, ["Ensembl_gene_id", *sample_names], output_rows)
    write_gzip_tsv(
        validation_dir / "GSE281503_author_EDGE.generated.tsv.gz",
        ["Ensembl_gene_id", "feature_id", *AUTHOR_RESULT_COLUMNS.keys()],
        author_results,
    )

    samplesheet_rows: list[list[object]] = []
    qc_rows: list[list[object]] = []
    for index, (sample, group, treatment) in enumerate(SAMPLES):
        block = soft_samples[sample]
        gsm = str(block["gsm"])
        group_prefix, workbook_sample = workbook_name(sample)
        source_column = f"{group_prefix} - {workbook_sample} - Total gene reads"
        detected = sum(row[index] > 0 for row in matrix)
        merged_total = sum(row[index] for row in matrix)
        samplesheet_rows.append([sample, group, gsm, sample, treatment])
        qc_rows.append(
            [
                sample,
                group,
                gsm,
                source_column,
                source_rows,
                libraries[index],
                detected,
                merged_rows,
                merged_total,
                merged_total - libraries[index],
                "TRUE",
                "TRUE",
                "TRUE",
                "TRUE",
                "TRUE",
            ]
        )

    write_tsv(
        metadata_dir / "GSE281503_samplesheet.tsv",
        ["sample", "group", "gsm", "title", "treatment"],
        samplesheet_rows,
    )
    write_tsv(
        processed_dir / "GSE281503_preprocessing_qc.tsv",
        [
            "sample",
            "group",
            "gsm",
            "source_workbook_column",
            "source_gene_rows",
            "source_library_size",
            "detected_genes",
            "merged_gene_rows",
            "merged_library_size",
            "count_conservation_delta",
            "integer_counts",
            "nonnegative_counts",
            "gene_id_match",
            "metadata_match",
            "analysis_keep",
        ],
        qc_rows,
    )
    write_tsv(
        metadata_dir / "GSE281503_source_files.tsv",
        ["file", "bytes", "sha256", "source", "fetched"],
        [[name, size, digest, url, FETCHED] for name, size, digest, url in source_records],
    )

    if not all(math.isfinite(float(value)) for value in libraries):
        raise RuntimeError("non-finite library size")
    print(
        f"GSE281503 prepared: {merged_rows} genes ({source_rows} source rows) x "
        f"{len(SAMPLES)} independent mice; control=4 LPS=4; libraries "
        f"{min(libraries) / 1e6:.2f}M-{max(libraries) / 1e6:.2f}M; exact conservation"
    )


if __name__ == "__main__":
    main()
