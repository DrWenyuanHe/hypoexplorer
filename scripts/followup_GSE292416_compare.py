"""Bounded, evidence-only comparison. Run after followup_GSE292416.R from repository root."""
from pathlib import Path
import gzip
import hashlib
import json
import re
import sys

import numpy as np
import pandas as pd
from scipy.stats import pearsonr, spearmanr

ROOT = Path.cwd()
OUT = ROOT / "data/author-validation/continued-sources/five-dataset-followup-2026-09-04/GSE292416"
AUTHOR = ROOT / "geo_replication/datasets/_author_de/GSE292416_deseq2_results.csv.gz"
RAW = ROOT / "geo_replication/datasets/GSE292416_mmus_arc_pnoc_bactrap/raw/GSE292416_salmon.merged.gene_counts.tsv.gz"
LOCAL = ROOT / "geo_replication/datasets/GSE292416_mmus_arc_pnoc_bactrap/processed/GSE292416_DE.tsv"
AL = "log2FoldChange_ko_vs_wt_in_ip"
AQ = "padj_ko_vs_wt_in_ip"

EXPECTED_INPUT_SHA256 = {
    AUTHOR: "17b2368a166397bc6d8ca5271538e518f71d848b8ef87d026dd98b0ee832cfe7",
    RAW: "7e0c51adbba2fa08b2b5060d45d814d47e393c2cad93bbf580ae6162a6e14cc3",
    OUT / "GSE292416_salmon.merged.gene_counts_scaled.tsv.gz": "8f8e43f54724d52756edc3fe0eae397dc7c0799d824040476d773ad6e4f08ec4",
    LOCAL: "314880b94a5dfa39a3d2c2cf3e2f46b7585ab4fe4c6a63746edf675c1b638d2a",
}
for path, expected in EXPECTED_INPUT_SHA256.items():
    assert hashlib.sha256(path.read_bytes()).hexdigest() == expected, f"Pinned input changed: {path}"

if "--check" in sys.argv:
    pinned = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))
    for entry in pinned["files"]:
        p = ROOT / entry["path"]
        assert p.is_file(), f"Missing pinned evidence: {p}"
        assert p.stat().st_size == entry["bytes"], f"Size mismatch: {p}"
        assert hashlib.sha256(p.read_bytes()).hexdigest() == entry["sha256"], f"SHA-256 mismatch: {p}"
    print(f"PASS: {len(pinned['files'])} pinned source, script, registered-target and evidence files")
    sys.exit(0)


def native(obj):
    if isinstance(obj, dict):
        return {str(k): native(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [native(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        return float(obj) if np.isfinite(obj) else None
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    return obj


def write_json(name, value):
    (OUT / name).write_text(json.dumps(native(value), indent=2, allow_nan=False) + "\n", encoding="utf-8")


def effect_metrics(a, b):
    finite = np.isfinite(a) & np.isfinite(b)
    a, b = np.asarray(a[finite]), np.asarray(b[finite])
    delta = np.abs(a - b)
    return dict(paired_finite_effects=len(a), pearson=pearsonr(a, b).statistic if len(a) > 1 else None,
                spearman=spearmanr(a, b).statistic if len(a) > 1 else None,
                median_abs_delta=np.median(delta) if len(a) else None,
                max_abs_delta=np.max(delta) if len(a) else None,
                n_abs_delta_gt_0p001=int(np.sum(delta > .001)),
                n_abs_delta_gt_0p01=int(np.sum(delta > .01)),
                same_direction=int(np.sum(np.sign(a) == np.sign(b))),
                direction_fraction=np.mean(np.sign(a) == np.sign(b)) if len(a) else None)


def compare(a, b, label):
    """a/b are complete source-indexed tables with effect and q; NA is never a negative call."""
    assert a.index.is_unique and b.index.is_unique
    both = a.rename(columns={"effect": "author_effect", "q": "author_q"}).join(
        b.rename(columns={"effect": "tested_effect", "q": "tested_q"}), how="outer")
    both["author_row_present"] = both.index.isin(a.index)
    both["tested_row_present"] = both.index.isin(b.index)
    both["paired_finite_q"] = np.isfinite(both.author_q) & np.isfinite(both.tested_q)
    both["paired_finite_effect"] = np.isfinite(both.author_effect) & np.isfinite(both.tested_effect)
    both["effect_delta_tested_minus_author"] = both.tested_effect - both.author_effect
    both["q_delta_tested_minus_author"] = both.tested_q - both.author_q
    report = dict(label=label, author_rows=len(a), tested_rows=len(b), shared_rows=len(a.index.intersection(b.index)),
                  author_finite_q=np.isfinite(a.q).sum(), tested_finite_q=np.isfinite(b.q).sum(),
                  author_finite_q_tested_not_finite=int((np.isfinite(both.author_q) & ~np.isfinite(both.tested_q)).sum()),
                  tested_finite_q_author_not_finite=int((np.isfinite(both.tested_q) & ~np.isfinite(both.author_q)).sum()),
                  paired_finite_q=both.paired_finite_q.sum(), effects=effect_metrics(both.author_effect, both.tested_effect))
    q = both.loc[both.paired_finite_q]
    report["q_residuals"] = dict(median_abs_delta=np.median(np.abs(q.author_q-q.tested_q)),
                                  max_abs_delta=np.max(np.abs(q.author_q-q.tested_q)),
                                  pearson=pearsonr(q.author_q, q.tested_q).statistic)
    report["rules"] = {}
    for threshold in (.05, .01):
        key = str(threshold)
        author_all = set(a.index[np.isfinite(a.q) & (a.q <= threshold)])
        tested_all = set(b.index[np.isfinite(b.q) & (b.q <= threshold)])
        author_shared = set(q.index[q.author_q <= threshold])
        tested_shared = set(q.index[q.tested_q <= threshold])
        union = author_shared | tested_shared
        in_calls = both.index.isin(author_shared) & both.paired_finite_effect
        report["rules"][key] = dict(
            criterion=f"FDR <= {threshold}; no effect threshold; paired-finite scope excludes all missing q",
            all_author_calls=len(author_all), all_tested_calls=len(tested_all),
            all_called_set_overlap=len(author_all & tested_all), all_author_only_called_ids=sorted(author_all-tested_all),
            all_tested_only_called_ids=sorted(tested_all-author_all),
            note="Whole called-set differences describe observed called IDs, not inferred negative outcomes for missing q or absent rows.",
            paired_finite_author_calls=len(author_shared), paired_finite_tested_calls=len(tested_shared),
            paired_finite_overlap=len(author_shared & tested_shared),
            paired_finite_author_only=len(author_shared-tested_shared), paired_finite_tested_only=len(tested_shared-author_shared),
            paired_finite_jaccard=len(author_shared & tested_shared)/len(union) if union else None,
            author_call_effect_direction_tested_n=int(in_calls.sum()),
            author_call_effect_direction_agree=int((np.sign(both.loc[in_calls, "author_effect"]) == np.sign(both.loc[in_calls, "tested_effect"])).sum()))
        both[f"author_call_{key}"] = pd.array(np.where(np.isfinite(both.author_q), both.author_q <= threshold, None), dtype="boolean")
        both[f"tested_call_{key}"] = pd.array(np.where(np.isfinite(both.tested_q), both.tested_q <= threshold, None), dtype="boolean")
    both.to_csv(OUT / f"comparison-{label}.tsv", sep="\t", na_rep="NA", index_label="feature_id")
    return report


author = pd.read_csv(AUTHOR)
raw = pd.read_csv(RAW, sep="\t")
local = pd.read_csv(LOCAL, sep="\t")
local_missing_symbol_rows = local[local.symbol.isna()].copy()
local_missing_symbol_rows.to_csv(OUT / "registered-missing-symbol-rows.tsv", sep="\t", index=False, na_rep="NA")
local = local[local.symbol.notna()].copy()
assert author.ensembl_gene_id.is_unique and raw.gene_id.is_unique and local.symbol.is_unique
a = author.set_index("ensembl_gene_id")[[AL, AQ]].rename(columns={AL:"effect", AQ:"q"})
report = {"schemaVersion": 1, "datasetId": "mouse_arc_pnoc_trap_gse292416", "date": "2026-09-04",
          "author_table_union_rows": len(author), "raw_source_rows": len(raw),
          "author_raw_P_available": False,
          "scope_note": "Author table is an outer union of four contrasts. Contrast-specific missing effects/FDR remain missing; matching its rows is not full inference coverage.",
          "diagnostics_are_not_registered_output": True, "reconstructions": {}}

for label in ("raw", "scaled"):
    fitted = pd.read_csv(OUT / f"refit-{label}-IP-only.tsv", sep="\t").set_index("ensembl_gene_id")
    for alpha in ("0p1", "0p05", "0p01"):
        b = fitted[["log2FoldChange", f"padj_alpha_{alpha}"]].rename(columns={"log2FoldChange":"effect", f"padj_alpha_{alpha}":"q"})
        name = f"{label}-IP-only-alpha-{alpha}"
        report["reconstructions"][name] = compare(a, b, name)

ambiguous = author.external_gene_name.notna() & author.external_gene_name.duplicated(keep=False)
author.loc[ambiguous].to_csv(OUT / "ambiguous-author-symbols.tsv", sep="\t", index=False, na_rep="NA")
usable = author.loc[author.external_gene_name.notna() & ~ambiguous]
ua = usable.set_index("external_gene_name")[[AL, AQ]].rename(columns={AL:"effect", AQ:"q"})
lb = local.set_index("symbol")[["logFC", "padj"]].rename(columns={"logFC":"effect", "padj":"q"})
report["registered_unique_symbol_comparison"] = compare(ua, lb, "registered-unique-symbols")
report["symbol_mapping"] = dict(author_rows_with_ambiguous_symbols=int(ambiguous.sum()),
    registered_rows_missing_symbol=len(local_missing_symbol_rows),
    ambiguous_symbols=sorted(author.loc[ambiguous, "external_gene_name"].unique()),
    author_rows_missing_symbol=int(author.external_gene_name.isna().sum()),
    rule="Exact symbols only; every occurrence of a duplicated author symbol is excluded, not first-row selected.",
    author_ensembl_ids_not_in_count_source=sorted(set(author.ensembl_gene_id)-set(raw.gene_id)))

enrichment = author.copy()
report["source_threshold_rules"] = {}
for label, threshold, lfc in (("paper", .05, .5), ("GEO", .01, np.log2(1.5))):
    enriched = ((author.padj_ip_vs_input_in_ko <= threshold) & (author.log2FoldChange_ip_vs_input_in_ko >= lfc)) | \
               ((author.padj_ip_vs_input_in_wt <= threshold) & (author.log2FoldChange_ip_vs_input_in_wt >= lfc))
    called = enriched & (author[AQ] <= threshold)
    enrichment[f"enriched_{label}"] = enriched
    enrichment[f"genotype_DE_and_enriched_{label}"] = called
    report["source_threshold_rules"][label] = dict(enrichment_q_lte=threshold, enrichment_LFC_gte=lfc,
        enriched_rows=int(enriched.sum()), enriched_finite_genotype_FDR=int((enriched & author[AQ].notna()).sum()),
        enriched_missing_genotype_FDR=int((enriched & author[AQ].isna()).sum()),
        genotype_FDR_lte=threshold, genotype_DE_and_enriched=int(called.sum()),
        genotype_DE_and_enriched_up=int((called & (author[AL] > 0)).sum()),
        genotype_DE_and_enriched_down=int((called & (author[AL] < 0)).sum()))
enrichment.to_csv(OUT / "author-source-threshold-rule-audit.tsv", sep="\t", index=False, na_rep="NA")
cols = ["log2FoldChange_ip_vs_input_in_ko", "log2FoldChange_ip_vs_input_in_wt", AL, "log2FoldChange_ko_vs_wt_in_input"]
complete = author.dropna(subset=cols)
cycle = complete[cols[0]]-complete[cols[1]]-complete[cols[2]]+complete[cols[3]]
report["four_contrast_effect_cycle"] = dict(complete_rows=len(complete), median_abs_cycle=float(np.median(np.abs(cycle))),
    max_abs_cycle=float(np.max(np.abs(cycle))), note="Nonzero cycles rule out exact algebraic equivalence of these exported effects to one unshrunken four-group coefficient vector. They do not identify the historical formula or shrinkage.")
report["author_contrast_coverage"] = {c:dict(finite=int(author[c].notna().sum()), missing=int(author[c].isna().sum()),
    q_lte_0p05=int((author[c]<=.05).sum())) for c in author if c.startswith("padj_")}
write_json("comparison-summary.json", report)

soft = gzip.open(OUT/"GSE292416_family.soft.gz", "rt", encoding="utf-8").read()
samples=[]
for block in re.split(r"(?m)^\^SAMPLE = ", soft)[1:]:
    acc=block.splitlines()[0]
    fields={}
    for line in block.splitlines()[1:]:
        if line.startswith("!Sample_") and " = " in line:
            key, val=line.split(" = ",1)
            if any(k in key for k in ("title", "source_name", "characteristics", "data_processing", "extract_protocol", "growth_protocol", "treatment_protocol")):
                fields.setdefault(key.replace("!Sample_", ""),[]).append(val)
    samples.append({"accession":acc, "fields":fields})
write_json("source-sample-metadata.json", samples)

URLS = {
    AUTHOR: "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE292nnn/GSE292416/suppl/GSE292416_deseq2_results.csv.gz",
    RAW: "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE292nnn/GSE292416/suppl/GSE292416_salmon.merged.gene_counts.tsv.gz",
    OUT/"GSE292416_salmon.merged.gene_counts_scaled.tsv.gz": "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE292nnn/GSE292416/suppl/GSE292416_salmon.merged.gene_counts_scaled.tsv.gz",
    OUT/"GSE292416_family.soft.gz": "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE292nnn/GSE292416/soft/GSE292416_family.soft.gz",
    OUT/"mpg-record.json": "https://pure.mpg.de/rest/items/item_3657048",
    OUT/"publisher-response.html": "https://www.sciencedirect.com/science/article/pii/S0092867425004039",
    OUT/"cell-response.html": "https://www.cell.com/cell/fulltext/S0092-8674(25)00403-9",
}
files = list(OUT.glob("*")) + [AUTHOR, RAW, LOCAL, ROOT/"scripts/followup_GSE292416.R", Path(__file__).resolve()]
manifest=[]
for p in sorted(set(files)):
    if not p.is_file() or p.name=="manifest.json":
        continue
    role = "source" if p in URLS else ("registered_comparison_target" if p == LOCAL else "script" if p.suffix in (".R", ".py") else "evidence_output")
    if p.name in ("publisher-response.html", "cell-response.html"):
        role="failed_access_response_HTTP_403_not_article"
    manifest.append(dict(path=p.relative_to(ROOT).as_posix(), bytes=p.stat().st_size,
        sha256=hashlib.sha256(p.read_bytes()).hexdigest(), role=role, url=URLS.get(p)))
write_json("manifest.json", {"date":"2026-09-04", "files":manifest})
compact = {k:{"effects":v["effects"], "paired_finite_q":v["paired_finite_q"],
    "q_residuals":v["q_residuals"], "rules":{rule:{field:value for field,value in metrics.items()
        if not field.endswith("_ids")} for rule,metrics in v["rules"].items()}}
    for k,v in report["reconstructions"].items()}
print(json.dumps(native({"reconstructions":compact,"source_threshold_rules":report["source_threshold_rules"],
      "symbol_mapping":report["symbol_mapping"]}),indent=2,allow_nan=False))
