"""Scope-aware comparison of original GSE299412 and GSE301692 supplements.

Never infer full-universe FDR or negative calls from these selected excerpts.
The PDF text-column order is checked against rendered pages 20 and 21.
"""
from pathlib import Path
import csv
import hashlib
import json
import re
import numpy as np
from scipy.stats import pearsonr, spearmanr
from openpyxl import load_workbook
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data/author-validation/continued-sources/final-numerical-batch-d"

def tsv(path):
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f, delimiter="\t"))

def write_rows(name, rows):
    with (OUT / name).open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]), delimiter="\t")
        w.writeheader()
        w.writerows(rows)

def corr(rows, a, b):
    return {"pearson": float(pearsonr([r[a] for r in rows], [r[b] for r in rows]).statistic),
            "spearman": float(spearmanr([r[a] for r in rows], [r[b] for r in rows]).statistic)}

fish = ROOT / "geo_replication/datasets/GSE299412_drer_hypothalamus"
fish_de = tsv(fish / "processed/GSE299412_DE.tsv")
local = {r["id"]: r for r in fish_de}
mapping = {r["source_symbol"]: r for r in tsv(fish / "metadata/GSE299412_identifier_mapping.tsv")}
book = load_workbook(OUT / "JNC-169-0-s006.xlsx", read_only=True, data_only=True)
values = list(book.active.values)
header = values[0]
idx = {v: i for i, v in enumerate(header)}
comparison = "Adult_Hypo_male_ko vs Adult_Hypo_male_wt"
fish_rows = []
for row in values[1:]:
    if all(v is None for v in row):
        continue
    symbol = row[0]
    source_map = mapping.get(symbol)
    mapped_id = source_map["output_label"] if source_map else ""
    own = local.get(mapped_id)
    code = row[idx[comparison]]
    if code not in {"UP", "DOWN", "-"}:
        raise ValueError(f"Unknown author direction flag: {code}")
    fish_rows.append({
        "author_source_symbol": symbol, "local_id": mapped_id,
        "mapping_status": source_map["mapping_status"] if source_map else "no_exact_source_symbol",
        "local_tested": own is not None, "author_selected_direction": code,
        "author_wt_mean_rlog": row[idx["Adult_Hypo_male_wt"]],
        "author_ko_mean_rlog": row[idx["Adult_Hypo_male_ko"]],
        "author_mean_rlog_difference_not_unshrunk_logFC": row[idx["Adult_Hypo_male_ko"]] - row[idx["Adult_Hypo_male_wt"]],
        "local_logFC": float(own["logFC"]) if own else None,
        "local_p": float(own["pvalue"]) if own else None,
        "local_padj": float(own["padj"]) if own else None,
    })
book.close()
matched = [r for r in fish_rows if r["local_tested"]]
selected = [r for r in fish_rows if r["author_selected_direction"] != "-"]
selected_matched = [r for r in selected if r["local_tested"]]
fish_summary = {
    "dataset": "GSE299412", "scope": "703-gene union across 12 comparisons; male-hypothalamus flags selected separately; no author P or FDR columns",
    "author_union_rows": len(fish_rows), "author_selected_rows": len(selected),
    "author_selected_up": sum(r["author_selected_direction"] == "UP" for r in selected),
    "author_selected_down": sum(r["author_selected_direction"] == "DOWN" for r in selected),
    "local_tested_rows": len(fish_de), "matched_union_rows": len(matched),
    "matched_selected_rows": len(selected_matched),
    "selected_direction_matches": sum((r["local_logFC"] > 0) == (r["author_selected_direction"] == "UP") for r in selected_matched),
    "selected_mapped_local_fdr05": sum(r["local_padj"] < .05 for r in selected_matched),
    "local_all_fdr05": sum(float(r["padj"]) < .05 for r in fish_de),
    "local_all_fdr05_fc1_5": int(sum(float(r["padj"]) < .05 and abs(float(r["logFC"])) > np.log2(1.5) for r in fish_de)),
    "selected_rlog_difference_vs_local_effect": corr(selected_matched, "author_mean_rlog_difference_not_unshrunk_logFC", "local_logFC"),
    "unmatched_selected": [r["author_source_symbol"] for r in selected if not r["local_tested"]],
    "opposite_selected": [r for r in selected_matched if (r["local_logFC"] > 0) != (r["author_selected_direction"] == "UP")],
    "caution": "rlog-mean differences and edgeR logFC are distinct estimators; significant-only/union coverage cannot establish full tested-universe agreement"
}
write_rows("GSE299412_author_union_comparison.tsv", fish_rows)

organoid = ROOT / "geo_replication/datasets/GSE301692_hsap_hypothalamus_pituitary_organoid"
organoid_de = tsv(organoid / "processed/GSE301692_DE.tsv")
local = {r["id"]: r for r in organoid_de}
reader = PdfReader(OUT / "mmc1.pdf")
assert len(reader.pages) == 22
assert "day 15" in reader.pages[20].extract_text()
rows = []
for line in reader.pages[19].extract_text().splitlines():
    if "ENSG" not in line:
        continue
    fields = line.split()
    assert len(fields) == 7 and re.fullmatch(r"ENSG\d{11}", fields[-1]), line
    padj, p, stat, se, fc, mean = map(float, fields[:6])
    gene = fields[-1]
    own = local.get(gene)
    rows.append({"id": gene, "author_baseMean": mean, "author_logFC": fc,
                 "author_lfcSE": se, "author_stat": stat, "author_p": p, "author_padj": padj,
                 "local_tested": own is not None,
                 "local_logFC": float(own["logFC"]) if own else None,
                 "local_p": float(own["pvalue"]) if own else None,
                 "local_padj": float(own["padj"]) if own else None})
assert len(rows) == 56 and len({r["id"] for r in rows}) == 56
matched = [r for r in rows if r["local_tested"]]
organoid_summary = {
    "dataset": "GSE301692", "scope": "56-row day-15 Table S4 PDF excerpt, ordered by ascending raw P; not a gene-wide result",
    "orientation": "Author numeric effects agree with success minus failure; heading alone does not explicitly define subtraction order",
    "author_rows": len(rows), "local_rows": len(organoid_de), "matched_rows": len(matched),
    "direction_matches": sum(r["local_logFC"] * r["author_logFC"] > 0 for r in matched),
    "effect_correlation": corr(matched, "author_logFC", "local_logFC"),
    "median_abs_effect_difference": float(np.median([abs(r["local_logFC"] - r["author_logFC"]) for r in matched])),
    "author_excerpt_fdr05": sum(r["author_padj"] < .05 for r in rows),
    "author_excerpt_padj_values": sorted({r["author_padj"] for r in rows}),
    "local_all_fdr05": sum(float(r["padj"]) < .05 for r in organoid_de),
    "unmatched_ids": [r["id"] for r in rows if not r["local_tested"]],
    "caution": "Do not interpret the Table S4 title as 56 significant genes or infer full-universe validation from joint zero calls. All author excerpt adjusted P values are 0.992850493."
}
write_rows("GSE301692_TableS4_comparison.tsv", rows)
summary = {"GSE299412": fish_summary, "GSE301692": organoid_summary}
(OUT / "comparison.summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary, indent=2))
