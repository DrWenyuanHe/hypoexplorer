"""Record residual differences without hiding them behind high correlation."""
import json
from pathlib import Path
import numpy as np
import pandas as pd

root = Path(__file__).resolve().parents[1]
out = root / "data/author-validation/continued-sources/GSE224254"
comparison = pd.read_csv(out / "direct_row_sensitivity.per-gene.tsv", sep="\t")
q = comparison.loc[comparison.betaPrior & comparison.independent_filter_alpha.eq(.1)].copy()
assert len(q) == 24822 and q.EnsID.is_unique
a_sig, r_sig = q.adjP.lt(.05), q.padj.lt(.05)
q["author_logFC_male_minus_female"] = -q.LogFC
q["significance_disposition"] = np.select([a_sig & ~r_sig, ~a_sig & r_sig], ["author_only", "refit_only"], default="same_call")
q["refit_adjusted_P_available"] = q.padj.notna()
q["baseMean_refit_to_author_ratio"] = q.baseMean / q.Basemean
q["absolute_raw_P_difference"] = (q["p val"] - q.pvalue).abs()
cols = ["EnsID", "Gene", "significance_disposition", "Basemean", "baseMean", "baseMean_refit_to_author_ratio",
        "author_logFC_male_minus_female", "log2FoldChange", "p val", "pvalue", "adjP", "padj", "refit_adjusted_P_available"]
q.loc[a_sig ^ r_sig, cols].to_csv(out / "residual_significance_discrepancies.tsv", sep="\t", index=False, float_format="%.15g")
# A descriptive exported-mean diagnostic, not a fitted cutoff or DEG definition.
large_mean = (q.baseMean_refit_to_author_ratio > 1.1) | (q.baseMean_refit_to_author_ratio < 1/1.1)
q.loc[large_mean, cols + ["absolute_raw_P_difference"]].sort_values("absolute_raw_P_difference", ascending=False).to_csv(
    out / "residual_normalized_mean_differences_over10percent.tsv", sep="\t", index=False, float_format="%.15g")
selected = q[q.Gene.isin(["Esr1", "Nupl1", "Gpcpd1", "Pcx", "Elk3", "Mical3", "Moxd1", "Il1rl2", "Taf1a", "Bag1"])][cols]
selected.to_csv(out / "selected_gene_resolution_and_residuals.tsv", sep="\t", index=False, float_format="%.15g")
summary = {
    "schemaVersion": 1,
    "accession": "GSE224254",
    "recommendation": "review_required",
    "authorProcessedResults": "available",
    "sensitivityNotProduction": True,
    "directRowsBetaPriorDefaultAlpha": {
        "DESeq2": "1.52.0", "formula": "~sex", "orientation": "male minus female; author FoverM negated",
        "betaPrior": True, "independentFilteringAlpha": .1, "significanceRule": "original adjusted P <0.05",
        "sharedSourceIDs": len(q), "authorSignificant": int(a_sig.sum()), "refitSignificant": int(r_sig.sum()),
        "intersection": int((a_sig & r_sig).sum()), "Jaccard": float((a_sig & r_sig).sum()/(a_sig | r_sig).sum()),
        "allAuthorSignificantDirectionsAgree": bool((np.sign(q.loc[a_sig, "author_logFC_male_minus_female"]) == np.sign(q.loc[a_sig, "log2FoldChange"])).all()),
        "authorOnly": q.loc[a_sig & ~r_sig, "EnsID"].tolist(),
        "refitOnly": q.loc[~a_sig & r_sig, "EnsID"].tolist(),
        "effectPearson": float(q.author_logFC_male_minus_female.corr(q.log2FoldChange)),
        "medianAbsoluteEffectDifference": float((q.author_logFC_male_minus_female-q.log2FoldChange).abs().median()),
        "normalizedMeansDifferOver10Percent": int(large_mean.sum()),
    },
    "missingEvidence": ["Exact original transcript-to-gene annotation and 87 absent author source IDs", "Author Galaxy history including import, gene filtering and beta-prior settings"],
    "interpretation": "Length offsets resolve the three originally opposite author-significant directions; prior shrinkage closely reconciles effects. Remaining significance and normalized-mean differences prevent full verification. High correlation is not a substitute for checking residuals.",
}
(out / "sensitivity_interpretation.summary.json").write_text(json.dumps(summary, indent=2, allow_nan=False) + "\n", encoding="utf-8")
print(json.dumps(summary, indent=2))
