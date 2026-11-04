#!/usr/bin/env python3
"""Prepare the GSE154274 rat-hypothalamus normalized matrix for limma.

The official workbook stores log-scale per-sample expression (its G1/G2 means
and reported log2 fold change are exactly reconstructible). Values are preserved
as deposited; no counts are invented or rounded.
"""

from __future__ import annotations

import csv
import gzip
import io
import math
from pathlib import Path

from openpyxl import load_workbook


def require(ok: bool, message: str) -> None:
    if not ok:
        raise RuntimeError(message)


def write_tsv(path: Path, header: list[str], rows: list[list[object]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(header)
        writer.writerows(rows)


def write_gzip_tsv(path: Path, header: list[str], rows: list[list[object]]) -> None:
    # mtime=0 makes repeated runs byte-for-byte deterministic.
    with path.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as zipped:
            with io.TextIOWrapper(zipped, encoding="utf-8", newline="") as text:
                writer = csv.writer(text, delimiter="\t", lineterminator="\n")
                writer.writerow(header)
                writer.writerows(rows)


root = Path(__file__).resolve().parent.parent
dataset_dir = root / "datasets" / "GSE154274_rnor_hypo_pcos_offspring"
source_path = dataset_dir / "raw" / "GSE154274_hypothalamus_RNA-seq.xlsx"
soft_path = dataset_dir / "metadata" / "GSE154274_family.soft.gz"

require(source_path.is_file() and source_path.stat().st_size == 3_974_731,
        "GSE154274 hypothalamus workbook is missing or its byte size changed")
require(soft_path.is_file() and soft_path.stat().st_size == 3_720,
        "GSE154274 family SOFT is missing or its byte size changed")

samples = [
    ("C10", "control", "GSM4668275", "control_offspring"),
    ("C11", "control", "GSM4668276", "control_offspring"),
    ("C12", "control", "GSM4668277", "control_offspring"),
    ("P10", "case", "GSM4668278", "PCOS_dam_offspring"),
    ("P11", "case", "GSM4668279", "PCOS_dam_offspring"),
    ("P12", "case", "GSM4668280", "PCOS_dam_offspring"),
]
require(sum(x[1] == "control" for x in samples) == 3 and
        sum(x[1] == "case" for x in samples) == 3,
        "contrast is no longer three versus three independent offspring")

with gzip.open(soft_path, "rt", encoding="utf-8", errors="strict") as handle:
    soft = handle.read().splitlines()
starts = [i for i, line in enumerate(soft) if line.startswith("^SAMPLE = ")]
require(len(starts) == 24, "family SOFT no longer contains 24 samples")
ends = starts[1:] + [len(soft)]
blocks = {soft[start].split(" = ", 1)[1]: soft[start:end]
          for start, end in zip(starts, ends)}
for sample, group, gsm, _condition in samples:
    require(gsm in blocks, f"missing SOFT block for {gsm}")
    block = blocks[gsm]
    required = {
        f"!Sample_title = {sample}",
        "!Sample_source_name_ch1 = hypothalamus",
        "!Sample_characteristics_ch1 = strain background: Sprague-Dawley",
        "!Sample_characteristics_ch1 = tissue: hypothalamus",
        "!Sample_library_strategy = RNA-Seq",
    }
    if group == "case":
        required.add("!Sample_characteristics_ch1 = sample group: born to PCOS rats")
    require(required.issubset(block), f"SOFT metadata changed for {gsm}")

workbook = load_workbook(source_path, read_only=True, data_only=True)
require(len(workbook.sheetnames) == 1, "hypothalamus workbook sheet inventory changed")
sheet = workbook[workbook.sheetnames[0]]
require(sheet.max_row == 22_745 and sheet.max_column == 14,
        "hypothalamus workbook dimensions changed")
iterator = sheet.iter_rows(values_only=True)
header = list(next(iterator))
expected_header = [
    "Gene_ID", "Symbol", "description", "C10", "C11", "C12",
    "P10", "P11", "P12", "G1", "G2", "G2_vs_G1_log2FoldChange",
    "G2_vs_G1_Pvalue", "G2_vs_G1_FDR",
]
require(header == expected_header, "hypothalamus workbook header changed")
sample_indices = [header.index(sample[0]) for sample in samples]

gene_ids: list[str] = []
matrix_rows: list[list[float]] = []
max_group_mean_delta = 0.0
max_logfc_delta = 0.0
for row_number, row in enumerate(iterator, start=2):
    gene_id = row[0]
    require(isinstance(gene_id, str) and gene_id.startswith("ENSRNOG"),
            f"invalid Ensembl ID at workbook row {row_number}")
    values = [float(row[index]) for index in sample_indices]
    require(all(math.isfinite(value) and value >= 0 for value in values),
            f"invalid normalized expression at workbook row {row_number}")
    g1 = sum(values[:3]) / 3
    g2 = sum(values[3:]) / 3
    max_group_mean_delta = max(max_group_mean_delta,
                               abs(g1 - float(row[9])), abs(g2 - float(row[10])))
    max_logfc_delta = max(max_logfc_delta, abs((g2 - g1) - float(row[11])))
    gene_ids.append(gene_id)
    matrix_rows.append(values)

require(len(gene_ids) == 22_744 and len(set(gene_ids)) == len(gene_ids),
        "workbook gene IDs are duplicated or row count changed")
require(max_group_mean_delta < 1e-10 and max_logfc_delta < 1e-10,
        "deposited G1/G2 means or log2 fold changes no longer reconstruct")
require(max(max(row) for row in matrix_rows) < 30,
        "workbook no longer has the expected log-expression scale")

column_values = list(zip(*matrix_rows))
expected_sums = [154924.20020400337, 153029.45933394608, 154390.4491857358,
                 154874.95768105963, 154213.59750029887, 154332.62728526065]
expected_detected = [19_877, 19_394, 19_957, 19_623, 19_924, 19_806]
observed_sums = [sum(values) for values in column_values]
observed_detected = [sum(value > 0 for value in values) for values in column_values]
require(max(abs(a - b) for a, b in zip(observed_sums, expected_sums)) < 1e-8 and
        observed_detected == expected_detected,
        "pinned log-expression sums or detection counts changed")

output_rows = [[gene_id, *values] for gene_id, values in zip(gene_ids, matrix_rows)]
write_gzip_tsv(
    dataset_dir / "raw" / "GSE154274_hypothalamus_log_expression.tsv.gz",
    ["Gene_ID", *[sample[0] for sample in samples]],
    output_rows,
)
write_tsv(
    dataset_dir / "metadata" / "GSE154274_samplesheet.tsv",
    ["sample", "group", "gsm", "condition"],
    [list(sample) for sample in samples],
)

qc_rows: list[list[object]] = []
for sample, values, expression_sum, detected in zip(samples, column_values,
                                                      observed_sums, observed_detected):
    qc_rows.append([
        sample[0], sample[1], sample[2], len(gene_ids), expression_sum, detected,
        min(values), max(values), sum(not math.isfinite(v) for v in values),
        sum(v < 0 for v in values), 0.0, max_group_mean_delta, max_logfc_delta,
        True, True,
    ])
write_tsv(
    dataset_dir / "processed" / "GSE154274_preprocessing_qc.tsv",
    ["sample", "group", "gsm", "source_gene_rows", "log_expression_sum",
     "detected_genes", "min_log_expression", "max_log_expression",
     "nonfinite_values", "negative_values", "identity_transform_delta",
     "group_mean_max_abs_delta", "logfc_max_abs_delta", "metadata_match",
     "analysis_keep"],
    qc_rows,
)

print(
    f"GSE154274 prepared: {len(gene_ids)} genes x {len(samples)} independent rats; "
    f"control=3 PCOS-offspring=3; deposited log-expression sums "
    f"{min(observed_sums):.0f}-{max(observed_sums):.0f}; limma matrix"
)
