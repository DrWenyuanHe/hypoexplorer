"""Compare author significant-only S4 via exact Ensembl IDs; do not change the cohort."""

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

root = Path(__file__).resolve().parents[1]
out = root / "data/author-validation/continued-sources/availability-batch-2026-09-04"
dataset = root / "geo_replication/datasets/GSE201408_sscr_hypothalamus_weaning"
author_path = out / "GSE201408_S4_genotype.xlsx"
assert hashlib.sha256(author_path.read_bytes()).hexdigest() == (
    "ba638af276803ec29f3c0e07112e854e626460dfe3b267db04d7c4583cff8b60"
)
author = pd.read_excel(author_path, sheet_name="Hoja1", header=1)
assert list(author.columns[1:]) == [
    "Gene", "baseMean", "log2FoldChange", "lfcSE", "stat", "pvalue", "padj"
]
author.columns = ["author_symbol", "source_ensembl", "author_baseMean",
                  "author_log2FC_crossbred_minus_iberian", "author_lfcSE",
                  "author_stat", "author_pvalue", "author_padj"]
author["source_ensembl"] = author["source_ensembl"].str.strip()
assert len(author) == 51 and author.source_ensembl.is_unique
assert (author.author_padj < 0.1).all()
author["author_log2FC_iberian_minus_crossbred"] = -author.author_log2FC_crossbred_minus_iberian
mapping_path = dataset / "metadata/GSE201408_identifier_mapping.tsv.gz"
mapping = pd.read_csv(mapping_path, sep="\t", dtype=str)
assert mapping.source_ensembl.is_unique and mapping.output_label.is_unique
local_path = dataset / "processed/GSE201408_DE.tsv"
local = pd.read_csv(local_path, sep="\t")
assert local.id.is_unique
local = local.rename(columns={c: "local_" + c for c in local.columns})
joined = author.merge(mapping, on="source_ensembl", how="left", validate="one_to_one")
joined = joined.merge(local, left_on="output_label", right_on="local_id", how="left", validate="one_to_one")
joined["comparison_status"] = np.where(joined.local_id.notna(), "compared",
    np.where(joined.output_label.notna(), "mapped_but_not_in_local_tested_universe", "not_in_source_mapping"))
ok = joined.local_id.notna() & joined.local_logFC.notna()
joined["direction_match"] = pd.Series(pd.NA, index=joined.index, dtype="boolean")
joined.loc[ok, "direction_match"] = (
    np.sign(joined.loc[ok, "local_logFC"]) == np.sign(joined.loc[ok, "author_log2FC_iberian_minus_crossbred"])
)
joined["log2FC_difference_local_minus_author"] = (
    joined.local_logFC - joined.author_log2FC_iberian_minus_crossbred
)
joined["local_meets_author_significance_rule"] = (
    (joined.local_padj < 0.1) & (joined.local_logFC.abs() >= np.log2(1.2))
)
joined["local_FDR_lt_005"] = joined.local_padj < 0.05
joined.to_csv(out / "GSE201408_author51_comparison.generated.tsv", sep="\t", index=False, float_format="%.15g")
compared = joined.loc[ok]
summary = {
    "schemaVersion": 1,
    "accession": "GSE201408",
    "classification": "review_required",
    "author_result_scope": "51 author significant genes, not all tested genes",
    "join": "exact trimmed author Ensembl gene ID to retained source_ensembl mapping to unique local output_label; no fuzzy symbol joins",
    "orientation": "author crossbred-minus-Iberian log2FC negated to local Iberian-minus-crossbred",
    "author_cohort": "9 Iberian (5F/4M), 10 crossbred (5F/5M); author excluded one male Iberian, identity not supplied by PCA image",
    "local_cohort": "10 Iberian (5F/5M), 10 crossbred (5F/5M); no exclusion performed by this script",
    "method_scope": "author DESeq2 on counts versus local sex-adjusted limma on log2(author-normalized expression+1)",
    "author_significance_rule": "BH-adjusted P < 0.1 and absolute fold change >= 1.2",
    "author_genes": len(author),
    "mapped_author_genes": int(joined.output_label.notna().sum()),
    "compared_author_genes": len(compared),
    "local_tested_genes": len(local),
    "direction_matches": int(compared.direction_match.sum()),
    "pearson_effects": float(compared.author_log2FC_iberian_minus_crossbred.corr(compared.local_logFC, method="pearson")),
    "spearman_effects": float(compared.author_log2FC_iberian_minus_crossbred.corr(compared.local_logFC, method="spearman")),
    "median_absolute_log2FC_difference": float(compared.log2FC_difference_local_minus_author.abs().median()),
    "maximum_absolute_log2FC_difference": float(compared.log2FC_difference_local_minus_author.abs().max()),
    "author_subset_local_FDR_lt_005": int(compared.local_FDR_lt_005.sum()),
    "author_subset_local_meets_author_rule": int(compared.local_meets_author_significance_rule.sum()),
    "local_all_FDR_lt_005": int((local.local_padj < 0.05).sum()),
    "local_all_meets_author_rule": int(((local.local_padj < 0.1) & (local.local_logFC.abs() >= np.log2(1.2))).sum()),
    "unmatched_author_ids": joined.loc[~ok, ["source_ensembl", "author_symbol", "comparison_status"]].to_dict(orient="records"),
    "direction_discordant": compared.loc[~compared.direction_match, ["source_ensembl", "author_symbol", "local_symbol", "author_log2FC_iberian_minus_crossbred", "local_logFC"]].to_dict(orient="records"),
    "caution": "Subset concordance is not genome-wide agreement. Significance disagreement remains unresolved; cohort and methods differ. No sample was excluded or model refitted to force agreement.",
}
(out / "GSE201408_author51_summary.generated.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary, indent=2))

# Hash retained payloads, extracted figure images and generated artifacts; never hash this manifest recursively.
inputs = [mapping_path, local_path, dataset / "metadata/GSE201408_samplesheet.tsv", Path(__file__)]
files = sorted(p for p in out.iterdir() if p.is_file() and p.name != "manifest.json") + inputs
manifest = {
    "schemaVersion": 1,
    "purpose": "Retained source-review evidence and exact-ID author significant-subset comparison",
    "files": [{"path": p.relative_to(root).as_posix(), "bytes": p.stat().st_size,
               "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in files],
}
(out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
