"""Evidence-only comparison. Run after followup_GSE306829_fit.R, or --check."""
import gzip
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import pearsonr, spearmanr

ROOT = Path(__file__).resolve().parents[1]
DS = ROOT / "geo_replication/datasets/GSE306829_mmus_mpoa_pnoc_bactrap"
OUT = ROOT / "data/author-validation/continued-sources/five-dataset-followup-2026-09-04/GSE306829"
CHECK = "--check" in sys.argv
DATASET = "mouse_mpoa_pnoc_bactrap_gse306829"
SOURCE_URL = "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE306nnn/GSE306829/suppl/GSE306829_IPvsInput_deg.txt.gz"
SOFT_URL = "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE306nnn/GSE306829/soft/GSE306829_family.soft.gz"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def clean(x):
    if isinstance(x, dict):
        return {str(k): clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [clean(v) for v in x]
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.floating, float)):
        return float(x) if np.isfinite(x) else None
    if isinstance(x, np.bool_):
        return bool(x)
    return x


def encoded(x):
    return (json.dumps(clean(x), indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode()


def measure(x, y, tolerance, log_p=False):
    x, y = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    ok = np.isfinite(x) & np.isfinite(y)
    delta = np.abs(x[ok] - y[ok])
    result = {"pairedFinite": sum(ok), "authorMissing": sum(~np.isfinite(x)),
              "comparisonMissing": sum(~np.isfinite(y)), "bothMissing": sum(~np.isfinite(x) & ~np.isfinite(y)),
              "pearson": pearsonr(x[ok], y[ok]).statistic if sum(ok) > 2 else None,
              "spearman": spearmanr(x[ok], y[ok]).statistic if sum(ok) > 2 else None,
              "medianAbsoluteDelta": np.median(delta), "maximumAbsoluteDelta": max(delta),
              "withinAbsoluteTolerance": sum(delta <= tolerance), "absoluteTolerance": tolerance}
    if log_p:
        positive = ok & (x > 0) & (y > 0)
        logs = np.abs(np.log10(x[positive]) - np.log10(y[positive]))
        result.update({"pairedPositiveForLogComparison": sum(positive),
                       "authorNumericalZeros": sum(ok & (x == 0)), "comparisonNumericalZeros": sum(ok & (y == 0)),
                       "medianAbsoluteNegativeLog10Delta": np.median(logs),
                       "maximumAbsoluteNegativeLog10Delta": max(logs)})
    else:
        result["matchingDirections"] = sum(np.sign(x[ok]) == np.sign(y[ok]))
        strong = ok & (np.abs(x) >= 0.5)
        result["strongAuthorEffectGenes"] = sum(strong)
        result["strongAuthorMatchingDirections"] = sum(np.sign(x[strong]) == np.sign(y[strong]))
    return result


def calls(author, compared):
    finite = author.notna() & compared.notna()
    aset = set(author.index[author < .05])
    bset = set(compared.index[compared < .05])
    union = aset | bset
    return {"threshold": "FDR < 0.05; descriptive, not a manuscript-specific rule",
            "rows": len(author), "pairedFiniteAdjustedP": sum(finite),
            "authorSignificant": len(aset), "comparisonSignificant": len(bset),
            "overlap": len(aset & bset), "jaccard": len(aset & bset) / len(union) if union else None,
            "authorOnly": sorted(aset - bset), "comparisonOnly": sorted(bset - aset),
            "authorSignificantButComparisonMissing": int(((author < .05) & compared.isna()).sum()),
            "comparisonSignificantButAuthorMissing": int(((compared < .05) & author.isna()).sum())}


original = DS / "raw/GSE306829_IPvsInput_deg.txt.gz"
soft = DS / "metadata/GSE306829_family.soft.gz"
assert sha(original) == "2f8a9797e72032e1d32776d8f766e4a170c3e34be7f1c5a0aef8ed0cb9773a74"
assert sha(soft) == "59927900d46b0c27ae3e9193b7abc5cec9d64105a9e0986fc5e3e6e2560b49b9"
assert sha(soft) == sha(OUT / "GSE306829_family.current.soft.gz")
author = pd.read_csv(original, sep="\t").set_index("gene_id")
local = pd.read_csv(DS / "processed/GSE306829_DE.tsv", sep="\t").set_index("id")
sample = pd.read_csv(DS / "metadata/GSE306829_samplesheet.tsv", sep="\t")
prepared = pd.read_csv(DS / "raw/GSE306829_PNOC_IP_vs_input_counts.tsv.gz", sep="\t").set_index("gene_id")
coverage = pd.read_csv(OUT / "coverage-audit.tsv", sep="\t").set_index("gene_id")
assert author.index.is_unique and local.index.is_unique and len(author) == 27884
assert list(prepared.index) == list(author.index)
assert list(prepared.columns) == list(sample["sample"])
assert np.array_equal(prepared.to_numpy(), author[sample.source_column].to_numpy())
assert set(local.index) <= set(author.index)
assert int((~coverage.retained_by_edgeR_filter).sum()) == 7926
assert int((coverage.retained_by_edgeR_filter & ~coverage.in_explorer).sum()) == 6
source_text = gzip.open(soft, "rt", encoding="utf-8").read()
assert "three animals per replicate, three replicates total" in source_text
assert "Input (total) RNA from each sample was processed in parallel as control" in source_text
assert "!Series_pubmed_id" not in source_text

products = {}
summary = {"datasetId": DATASET, "accession": "GSE306829", "reviewedAt": "2026-09-04",
           "target": "evidence_only_sensitivity_not_explorer_replacement",
           "cohort": {"independentPools": 3, "animalsPerPool": 3, "totalAnimals": 9, "libraries": 6,
                      "pairingVerifiedFromGEO": True, "samples": sample.to_dict("records")},
           "sourceRows": len(author), "sourceFiniteRawP": author.pvalue.notna().sum(),
           "sourceFiniteAdjustedP": author.padj.notna().sum(), "sourceFdr005": int((author.padj < .05).sum()),
           "exactSourceCountConservation": True, "sourceCountsCompared": int(prepared.size),
           "coverage": {"sourceGenes": len(author), "explorerGenes": len(local),
                        "excludedByRegisteredExpressionFilter": int((~coverage.retained_by_edgeR_filter).sum()),
                        "authorSignificantExcludedByExpressionFilter": int(((author.padj < .05) & ~coverage.retained_by_edgeR_filter).sum()),
                        "authorSignificantRetainedByFilterButAbsentAfterProjection": int(((author.padj < .05) & coverage.retained_by_edgeR_filter & ~coverage.in_explorer).sum()),
                        "retainedByExpressionFilterButAbsentAfterProjection": list(coverage.index[coverage.retained_by_edgeR_filter & ~coverage.in_explorer])},
           "models": {}}

for mode in ("paired", "group_only"):
    fit = pd.read_csv(OUT / f"{mode}.deseq2.tsv", sep="\t").set_index("gene_id").loc[author.index]
    joined = author[["gene_name", "log2FoldChange", "pvalue", "padj"]].add_prefix("author_").join(fit.add_prefix("fit_"))
    joined["in_explorer"] = joined.index.isin(local.index)
    joined["absolute_log2fc_delta"] = (joined.author_log2FoldChange - joined.fit_log2FoldChange).abs()
    joined["author_exported_one_where_default_fit_padj_missing"] = (joined.author_padj == 1) & joined.fit_padj_default_alpha_0_1.isna()
    joined["author_fdr005"] = joined.author_padj < .05
    # Missing significance remains NA, not a manufactured negative call.
    joined["fit_default_fdr005"] = (joined.fit_padj_default_alpha_0_1 < .05).astype("boolean").mask(joined.fit_padj_default_alpha_0_1.isna())
    products[f"{mode}.per-gene.tsv"] = joined.to_csv(sep="\t", index_label="gene_id", na_rep="NA", lineterminator="\n").encode()
    default_q = fit.padj_default_alpha_0_1
    mode_summary = {"design": "~ pair + fraction" if mode == "paired" else "~ fraction",
                    "effects": measure(author.log2FoldChange, fit.log2FoldChange, 1e-6),
                    "rawP": measure(author.pvalue, fit.pvalue, 1e-8, True),
                    "defaultAlphaAdjustedP": measure(author.padj, default_q, 1e-8, True),
                    "alpha005AdjustedP": measure(author.padj, fit.padj, 1e-8, True),
                    "noIndependentFilterAdjustedP": measure(author.padj, fit.padj_no_independent_filter, 1e-8, True),
                    "defaultAlphaWholeUniverseCalls": calls(author.padj, default_q),
                    "defaultAlphaExplorerSharedCalls": calls(author.loc[local.index, "padj"], default_q.loc[local.index]),
                    "alpha005WholeUniverseCalls": calls(author.padj, fit.padj),
                    "noIndependentFilterWholeUniverseCalls": calls(author.padj, fit.padj_no_independent_filter),
                    "authorOneWhereDefaultFitAdjustedPMissing": int(joined.author_exported_one_where_default_fit_padj_missing.sum()),
                    "effectsDeltaAbove0001Count": int((joined.absolute_log2fc_delta > .001).sum()),
                    "largestEffectDeltas": joined.nlargest(20, "absolute_log2fc_delta").reset_index().to_dict("records"),
                    "normalization": pd.read_csv(OUT / f"{mode}.normalization.tsv", sep="\t").to_dict("records")}
    summary["models"][mode] = mode_summary

default_fit = pd.read_csv(OUT / "group_only.deseq2.tsv", sep="\t").set_index("gene_id")
author_q_without_reconstructed_placeholders = author.padj.where(default_fit.padj_default_alpha_0_1.notna())
explorer = author[["gene_name", "log2FoldChange", "pvalue", "padj"]].add_prefix("author_").join(local.add_prefix("explorer_"))
explorer["in_explorer"] = explorer.index.isin(local.index)
explorer["author_modeled_adjusted_p_evaluable"] = default_fit.padj_default_alpha_0_1.notna()
explorer["author_modeled_padj"] = author_q_without_reconstructed_placeholders
explorer["author_modeled_fdr005"] = (author_q_without_reconstructed_placeholders < .05).astype("boolean").mask(author_q_without_reconstructed_placeholders.isna())
products["explorer.per-gene.tsv"] = explorer.to_csv(sep="\t", index_label="gene_id", na_rep="NA", lineterminator="\n").encode()
finite_shared = local.index[author_q_without_reconstructed_placeholders.loc[local.index].notna() & local.padj.notna()]
excluded_shared = local.index[author_q_without_reconstructed_placeholders.loc[local.index].isna()]
excluded_rows = explorer.loc[excluded_shared]
products["explorer.author-missing-tests.tsv"] = excluded_rows.to_csv(sep="\t", index_label="gene_id", na_rep="NA", lineterminator="\n").encode()
summary["explorer"] = {"effects": measure(author.loc[local.index, "log2FoldChange"], local.logFC, 1e-6),
                       "rawP": measure(author.loc[local.index, "pvalue"], local.pvalue, 1e-8, True),
                       "adjustedP": measure(author_q_without_reconstructed_placeholders.loc[local.index], local.padj, 1e-8, True),
                       "sharedUniverseCalls": calls(author.loc[finite_shared, "padj"], local.loc[finite_shared, "padj"]),
                       "sharedUniverseDefinition": "Exact shared IDs with finite Explorer adjusted P and finite reconstructed author adjusted P, excluding author-exported placeholder 1s.",
                       "excludedSharedAuthorMissingTests": {"rows": len(excluded_shared),
                           "explorerSignificantButAuthorUnevaluable": int((local.loc[excluded_shared, "padj"] < .05).sum()),
                           "authorMissingRawP": int(author.loc[excluded_shared, "pvalue"].isna().sum()),
                           "rowsWithOriginalAndModeledValues": excluded_rows.reset_index().to_dict("records")},
                       "reportedExportPlaceholderInclusiveAdjustedP": measure(author.loc[local.index, "padj"], local.padj, 1e-8, True),
                       "reportedExportPlaceholderInclusiveSharedCalls": calls(author.loc[local.index, "padj"], local.padj),
                       "reportedExportPlaceholderInclusiveWholeUniverseCalls": calls(author.padj, local.padj.reindex(author.index)),
                       "reportedExportCaveat": "These historical metrics include author-exported placeholder 1s as reported values and are not the primary tested-versus-tested inference comparison."}
assert summary["explorer"]["sharedUniverseCalls"]["rows"] == 19929
assert summary["explorer"]["sharedUniverseCalls"]["comparisonSignificant"] == 7278
assert summary["explorer"]["excludedSharedAuthorMissingTests"]["explorerSignificantButAuthorUnevaluable"] == 17
assert summary["models"]["group_only"]["defaultAlphaWholeUniverseCalls"]["overlap"] == 6642
assert summary["models"]["group_only"]["defaultAlphaWholeUniverseCalls"]["comparisonSignificant"] == 6642
assert summary["models"]["group_only"]["authorOneWhereDefaultFitAdjustedPMissing"] == 5432
products["comparison.summary.json"] = encoded(summary)

inputs = [original, soft, DS / "raw/GSE306829_PNOC_IP_vs_input_counts.tsv.gz",
          DS / "processed/GSE306829_DE.tsv", DS / "processed/GSE306829_SE.tsv", DS / "metadata/GSE306829_samplesheet.tsv",
          DS / "metadata/GSE306829_source_files.tsv", ROOT / "geo_replication/scripts/prep_GSE306829.R",
          ROOT / "geo_replication/scripts/run_dataset.R", ROOT / "geo_replication/config/datasets.tsv",
          ROOT / "scripts/followup_GSE306829_fit.R", Path(__file__), OUT / "PREDECLARATION.md",
          OUT / "GSE306829_family.current.soft.gz", OUT / "europepmc-search.json", OUT / "coverage-audit.tsv",
          OUT / "fit-session.txt", OUT / "REVIEW.md", OUT / "proposed-updates.json"] + [OUT / f"{m}.{f}.tsv" for m in ("paired", "group_only") for f in ("deseq2", "normalization")]
manifest = {"schemaVersion": 1, "datasetId": DATASET, "sources": [SOURCE_URL, SOFT_URL,
            "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=%22GSE306829%22%20OR%20%22Medial%20preoptic%20PNOC%22&format=json&pageSize=25",
            "https://bioconductor.org/packages/release/bioc/manuals/DESeq2/man/DESeq2.pdf"],
            "inputs": [{"path": p.relative_to(ROOT).as_posix(), "bytes": p.stat().st_size, "sha256": sha(p)} for p in inputs],
            "derivedOutputs": [{"path": (OUT / n).relative_to(ROOT).as_posix(), "bytes": len(b), "sha256": hashlib.sha256(b).hexdigest()} for n, b in products.items()]}
products["artifact-manifest.json"] = encoded(manifest)
for name, content in products.items():
    path = OUT / name
    if CHECK:
        assert path.read_bytes() == content, f"Reproducibility mismatch: {path}"
    else:
        path.write_bytes(content)
print(json.dumps({"check": CHECK, "sourceGenes": len(author), "explorerGenes": len(local),
                  "authorFdr005": 6642, "groupOnlyFdr005": 6642, "inputHashes": len(inputs),
                  "derivedOutputs": len(products) - 1}))
