"""Create audit summary/hash manifest after validate_GSE128148_author.R."""
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

root = Path(__file__).resolve().parents[1]
directory = root / "data/author-validation/continued-sources/GSE128148"
dataset = root / "geo_replication/datasets/GSE128148_mmus_arc_corticosterone"
author_path = dataset / "metadata/GSE128148_2019_Wray_4week_normalised_outliers_excluded.txt.gz"
raw_path = dataset / "raw/GSE128148_2019_Wray_4week_raw_counts.txt.gz"
assert hashlib.sha256(author_path.read_bytes()).hexdigest() == "4cab6f64c93427b71fee49a00c821c01fbb1019dcf9d075018fec6fcecb9cfab"
assert hashlib.sha256(raw_path.read_bytes()).hexdigest() == "ca50e73c04c6605b35df65323c0a73b41ba5846719876777c82ea5a6464636db"
author = pd.read_csv(author_path, sep="\t")
local = pd.read_csv(directory / "author_vs_local.generated.tsv", sep="\t")
refit = pd.read_csv(directory / "author_vs_DESeq2.generated.tsv", sep="\t")
fits = pd.read_csv(directory / "DESeq2_sensitivity.generated.tsv", sep="\t")
normalization = pd.read_csv(directory / "normalization_comparison.generated.tsv", sep="\t")
# Observed-author-universe diagnostic: apply BH only to genes whose deposited
# author padj is non-NA. This uses actual author metadata, not a tuned threshold.
# It diagnoses multiplicity scope but does not recover the unknown original filter rule.
prior = refit[(refit.scope == "all_source_beta_prior_sensitivity") & refit.independentFiltering].copy()
prior["author_universe_BH_padj"] = np.nan
valid = prior.padj_author.notna() & prior.pvalue_refit.notna()
pvalues = prior.loc[valid, "pvalue_refit"].to_numpy()
order = np.argsort(pvalues)
adjusted_sorted = np.minimum.accumulate((pvalues[order] * len(pvalues) / np.arange(1, len(pvalues)+1))[::-1])[::-1]
adjusted = np.empty(len(pvalues))
adjusted[order] = np.minimum(adjusted_sorted, 1)
prior.loc[valid, "author_universe_BH_padj"] = adjusted
prior.to_csv(directory / "author_multiplicity_universe_diagnostic.generated.tsv", sep="\t", index=False, float_format="%.15g")
author_set = set(prior.loc[prior.padj_author < .1, "gene_id"])
diagnostic_set = set(prior.loc[prior.author_universe_BH_padj < .1, "gene_id"])
universe_diagnostic = {
    "label": "Diagnostic using observed author non-NA padj universe; not a discovered author filtering algorithm",
    "author_universe_rows": int(prior.padj_author.notna().sum()),
    "current_finite_pvalues_in_author_universe": int(valid.sum()),
    "significant_FDR_lt_01": len(diagnostic_set),
    "significant_overlap_with_author": len(author_set & diagnostic_set),
    "author_only_significant": sorted(author_set - diagnostic_set),
    "diagnostic_only_significant": sorted(diagnostic_set - author_set),
    "max_padj_difference": float((prior.author_universe_BH_padj-prior.padj_author).abs().max()),
    "median_padj_difference": float((prior.author_universe_BH_padj-prior.padj_author).abs().median()),
}
compared = local[local.local_tested]
author_sig = local[local.padj_author < .1]
fit_summaries = []
for _, fit in fits.iterrows():
    table = refit[(refit.scope == fit.scope) & (refit.independentFiltering == fit.independentFiltering)]
    aset = set(table.loc[table.padj_author < .1, "gene_id"])
    rset = set(table.loc[table.padj_refit < .1, "gene_id"])
    common = table[table.pvalue_author.notna() & table.pvalue_refit.notna()]
    record = fit.to_dict()
    record.update({
        "author_significant_ids_present": len(aset),
        "significant_overlap": len(aset & rset),
        "author_significant_not_refit_significant": len(aset - rset),
        "refit_significant_not_author_significant": len(rset - aset),
        "pvalue_comparable_rows": len(common),
        "minus_log10_pvalue_pearson": float((-np.log10(common.pvalue_author)).corr(-np.log10(common.pvalue_refit))),
        "pvalue_max_absolute_difference": float((common.pvalue_author-common.pvalue_refit).abs().max()),
    })
    fit_summaries.append(record)
summary = {
    "schemaVersion": 1,
    "accession": "GSE128148",
    "reviewedAt": "2026-09-04",
    "recommendedStatus": "review_required",
    "authorResultAvailability": "available",
    "authorResultScope": "Complete deposited gene-wide results for four-week corticosterone versus vehicle after explicit author exclusions",
    "cohort": "Seven independent male ARC libraries, three vehicle and four corticosterone; same retained libraries as author table",
    "source": "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE128nnn/GSE128148/suppl/GSE128148_2019_Wray_4week_normalised_outliers_excluded.txt.gz",
    "paper": "https://pmc.ncbi.nlm.nih.gov/articles/PMC6667392/",
    "sourceIntegrity": "R assertions verify all 22,048 by seven prepared integer counts equal exact author source values and retained cohort columns match author table",
    "authorVersion": "Not specified in inspected paper; no exact version assumed",
    "authorRows": len(author),
    "authorFinitePvalueRows": int(author.pvalue.notna().sum()),
    "authorFinitePadjRows": int(author.padj.notna().sum()),
    "authorSignificantFDRlt01": int((author.padj < .1).sum()),
    "authorSignificantUp": int(((author.padj < .1) & (author.log2FoldChange > 0)).sum()),
    "authorSignificantDown": int(((author.padj < .1) & (author.log2FoldChange < 0)).sum()),
    "localComparedRows": len(compared),
    "localSignificantFDRlt01": int((compared.padj_local < .1).sum()),
    "localEffectPearson": float(compared.log2FoldChange.corr(compared.logFC)),
    "localEffectSpearman": float(compared.log2FoldChange.corr(compared.logFC, method="spearman")),
    "localDirectionMatches": int((np.sign(compared.log2FoldChange) == np.sign(compared.logFC)).sum()),
    "localMedianAbsoluteEffectDifference": float((compared.log2FoldChange-compared.logFC).abs().median()),
    "localMaximumAbsoluteEffectDifference": float((compared.log2FoldChange-compared.logFC).abs().max()),
    "authorSignificantLocallyTested": int(author_sig.local_tested.sum()),
    "authorSignificantLocalDirectionMatches": int(author_sig.direction_match.fillna(False).sum()),
    "authorSignificantAlsoLocalSignificant": int((author_sig.padj_local < .1).sum()),
    "authorSignificantNotLocallyTested": author_sig.loc[~author_sig.local_tested, ["gene_id", "symbol_author", "padj_author"]].to_dict(orient="records"),
    "normalizationMaximumSizeFactorAbsoluteDifference": float((normalization.current_DESeq2_size_factor-normalization.author_inferred_size_factor).abs().max()),
    "normalizationMaximumWithinSampleFactorRange": float(normalization.ratio_range.max()),
    "figureCaution": "Figure 2C labels Npy adjusted P=1.75e-7, which equals deposited raw P; deposited adjusted P=0.00046317. Treat as source reporting inconsistency and benchmark deposited result table.",
    "refitSummaries": fit_summaries,
    "authorMultiplicityUniverseDiagnostic": universe_diagnostic,
    "interpretation": "Method and filtering settings affect significance substantially. Same aggregate count is not sufficient: compare gene sets, direction split and numerical statistics. Do not label registered edgeR output fully verified unless remaining discrepancies are scientifically reconciled.",
}
(directory / "review-evidence.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
input_paths = [author_path, raw_path, dataset / "processed/GSE128148_analysis_matrix.tsv.gz",
               dataset / "processed/GSE128148_DE.tsv", dataset / "metadata/GSE128148_samplesheet.tsv",
               root / "scripts/validate_GSE128148_author.R", Path(__file__)]
paths = sorted(p for p in directory.iterdir() if p.is_file() and p.name != "manifest.json") + input_paths
manifest = {"schemaVersion": 1, "files": [{"path": p.relative_to(root).as_posix(),
    "bytes": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths]}
(directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary, indent=2))
