"""Read the original SCN workbook; compare unique symbols without changing either analysis."""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data/author-validation/continued-sources/GSE190389"
AUTHOR = ROOT / "data/author-validation/continued-sources/GSE190389_DE_workbook.xlsx"
EXPRESSION = ROOT / "data/author-validation/continued-sources/GSE190389_TMM_workbook.xlsx"
DATASET = ROOT / "geo_replication/datasets/GSE190389_mmus_scn_trf"
LOCAL = DATASET / "processed/GSE190389_DE.tsv"
SAMPLES = DATASET / "metadata/GSE190389_samplesheet.tsv"
CHECK = argparse.ArgumentParser()
CHECK.add_argument("--check", action="store_true")
check = CHECK.parse_args().check
assert hashlib.sha256(AUTHOR.read_bytes()).hexdigest() == "98c26cdf39a18faf6c12fce64a76c6ea88313b4eddb41a4732438faed7b3f50c"

author = pd.read_excel(AUTHOR, sheet_name="SCN", engine="openpyxl")
assert list(author.columns) == ["ensembl_gene_id", "description", "external_gene_name",
                                "logFC (TRF/ALF)", "logCPM", "F", "PValue", "FDR"]
assert author.ensembl_gene_id.is_unique
author = author.rename(columns={"external_gene_name": "symbol", "logFC (TRF/ALF)": "author_logFC",
                                "FDR": "author_padj"})
local = pd.read_csv(LOCAL, sep="\t")
samples = pd.read_csv(SAMPLES, sep="\t")
assert local.id.is_unique and local.symbol.is_unique
valid_symbol = author.symbol.notna() & author.symbol.astype(str).str.strip().ne("")
ambiguous = author.loc[valid_symbol & author.symbol.duplicated(keep=False), "symbol"].unique().tolist()
unique = author.loc[valid_symbol & ~author.symbol.isin(ambiguous)].copy()
joined = unique.merge(local, on="symbol", how="inner", validate="one_to_one", suffixes=("", "_local"))
joined = joined.rename(columns={"logFC": "local_logFC", "padj": "local_padj"})
assert np.isfinite(joined[["author_logFC", "local_logFC"]].values).all()
joined["logFC_difference_local_minus_author"] = joined.local_logFC - joined.author_logFC
joined["direction_agrees"] = np.sign(joined.author_logFC) == np.sign(joined.local_logFC)
joined["author_significant"] = (joined.author_padj <= .05) & (joined.logCPM > 0)
joined["local_significant"] = joined.local_padj <= .05
evaluable = joined.loc[joined.author_padj.notna() & joined.local_padj.notna()]
both = int((evaluable.author_significant & evaluable.local_significant).sum())
either = int((evaluable.author_significant | evaluable.local_significant).sum())
author_sig = author.loc[(author.author_padj <= .05) & (author.logCPM > 0)]
strong = joined.loc[joined.author_logFC.abs() >= .5]
sig = joined.loc[joined.author_significant]
summary = {
    "schemaVersion": 1, "accession": "GSE190389", "datasetId": "mouse_scn_trf_gse190389",
    "reviewDate": "2026-09-04", "authorSheet": "SCN",
    "orientation": "TRF minus ALF in both tables; no sign flip",
    "join": "Exact unique gene symbol: local output contains symbols, not Ensembl IDs. Ambiguous and absent author symbols excluded, never arbitrarily selected.",
    "authorRule": "FDR <= 0.05 and logCPM > 0; author-wide original FDR retained",
    "localRule": "FDR <= 0.05 on the registered filterByExpr universe; original local FDR retained",
    "authorRows": len(author), "authorUniqueNamedRows": len(unique),
    "authorMissingSymbols": int((~valid_symbol).sum()), "authorAmbiguousSymbols": ambiguous,
    "localRows": len(local), "sharedUniqueSymbols": len(joined),
    "localUnmatchedSymbols": sorted(set(local.symbol) - set(joined.symbol)),
    "localBiologicalLibraries": len(samples), "localGroupCounts": samples.group.value_counts().to_dict(),
    "pearsonLogFC": float(joined.author_logFC.corr(joined.local_logFC)),
    "spearmanLogFC": float(joined.author_logFC.corr(joined.local_logFC, method="spearman")),
    "medianAbsLogFCDifference": float(joined.logFC_difference_local_minus_author.abs().median()),
    "maxAbsLogFCDifference": float(joined.logFC_difference_local_minus_author.abs().max()),
    "directionsAgree": int(joined.direction_agrees.sum()),
    "strongAuthorEffects": len(strong), "strongDirectionsAgree": int(strong.direction_agrees.sum()),
    "allAuthorSignificant": len(author_sig), "allLocalSignificant": int((local.padj <= .05).sum()),
    "sharedAuthorSignificant": len(sig), "sharedAuthorSignificantDirectionsAgree": int(sig.direction_agrees.sum()),
    "authorSignificantNotJoined": author_sig.loc[~author_sig.ensembl_gene_id.isin(joined.ensembl_gene_id), ["ensembl_gene_id", "symbol"]].fillna("").to_dict(orient="records"),
    "evaluableAdjustedP": len(evaluable), "bothSignificant": both,
    "authorOnlySignificant": int((evaluable.author_significant & ~evaluable.local_significant).sum()),
    "localOnlySignificant": int((~evaluable.author_significant & evaluable.local_significant).sum()),
    "evaluableSignificantJaccard": both / either if either else None,
    "note": "Both sources use TRF/ALF and the same 45 biological libraries after three explicit author outliers. GEO already supplies collapsed resequencings. Author edgeR 3.26.7 omits ZT; local edgeR-QL adjusts for ZT, but bounded no-ZT sensitivities do not reproduce author results. Source-expression checks identify 37 discrepant same-symbol rows separately from model differences. See source_audit.summary.json, model_sensitivity.summary.tsv and REVIEW_2026-09-04.md. Keep review_required; no local output was replaced.",
}
OUT.mkdir(parents=True, exist_ok=True)
outputs = {
    "comparison.summary.json": json.dumps(summary, indent=2, allow_nan=False) + "\n",
    "comparison.per-gene.tsv": joined.to_csv(sep="\t", index=False, float_format="%.15g", lineterminator="\n"),
}
for name, content in outputs.items():
    path = OUT / name
    if check:
        assert path.read_text(encoding="utf-8") == content, f"Stale comparison: {path}"
    else:
        path.write_text(content, encoding="utf-8")
files = [AUTHOR, EXPRESSION, LOCAL, SAMPLES,
         DATASET / "raw/GSE190389_raw.csv.gz",
         DATASET / "raw/GSE190389_SCN_TRF_vs_ALF_count_estimates.tsv.gz",
         ROOT / "geo_replication/scripts/prep_GSE190389.R", Path(__file__),
         ROOT / "scripts/audit_GSE190389_sources.py",
         ROOT / "scripts/validate_GSE190389_author.R",
         *sorted(p for p in OUT.iterdir() if p.is_file() and p.name != "artifact-manifest.json")]
manifest = {"schemaVersion": 1, "sourceUrl": "https://data.mendeley.com/public-files/datasets/wc5wy48x93/files/9c2be9b9-8713-4c15-beaa-18605da93698/file_downloaded",
            "expressionSourceUrl": "https://data.mendeley.com/public-files/datasets/wc5wy48x93/files/ad26994b-63e9-4502-9dac-3ceaedc020ed/file_downloaded",
            "files": [{"path": p.relative_to(ROOT).as_posix(), "bytes": p.stat().st_size,
                       "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                      for p in files]}
content = json.dumps(manifest, indent=2) + "\n"
if check:
    assert (OUT / "artifact-manifest.json").read_text(encoding="utf-8") == content
else:
    (OUT / "artifact-manifest.json").write_text(content, encoding="utf-8")
print(json.dumps(summary, indent=2))
