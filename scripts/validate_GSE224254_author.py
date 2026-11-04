"""Compare the public author hypothalamus F/M table by exact Ensembl ID."""
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

root = Path(__file__).resolve().parents[1]
author_path = root / "data/author-validation/continued-sources/GSE224254_hypothalamus_FoverM.csv"
local_path = root / "geo_replication/datasets/GSE224254_mouse_sst_neuron_sex/processed/GSE224254_DE.tsv"
out = root / "data/author-validation/continued-sources/GSE224254"
assert hashlib.sha256(author_path.read_bytes()).hexdigest() == "022cdf99360b2b9b98fd7ae04d44ccf28a25e6028b87d8439a0eaf25795f6ed8"
author = pd.read_csv(author_path)
assert list(author.columns) == ["Gene", "EnsID", "Basemean", "LogFC", "Stderr", "Wald-stats", "p val", "adjP"]
assert author.EnsID.is_unique
local = pd.read_csv(local_path, sep="\t")
assert local.id.is_unique
author["author_logFC_male_minus_female"] = -author.LogFC
joined = author.merge(local, left_on="EnsID", right_on="id", how="inner", validate="one_to_one")
finite = joined.loc[np.isfinite(joined.author_logFC_male_minus_female) & np.isfinite(joined.logFC)].copy()
finite["direction_agrees"] = np.sign(finite.author_logFC_male_minus_female) == np.sign(finite.logFC)
finite["difference_local_minus_author"] = finite.logFC - finite.author_logFC_male_minus_female
tested = finite.loc[finite.adjP.notna() & finite.padj.notna()]
a_sig, l_sig = tested.adjP < .05, tested.padj < .05
overlap, union = int((a_sig & l_sig).sum()), int((a_sig | l_sig).sum())
summary = {
    "schemaVersion": 1, "accession": "GSE224254", "reviewedAt": "2026-09-04",
    "authorSource": "https://drive.google.com/uc?export=download&id=19wI0sPFuFvj0yurcH_Cz2exf57fBj8cd",
    "sourceChain": "Publication author code repository Leandromvelez/sex-specific-endocrine-signals -> public Datasets-used Drive folder -> hypothalamus DEGs FoverM.csv",
    "orientation": "Author female-minus-male LogFC negated to local male-minus-female; exact Ensembl IDs without fuzzy symbols",
    "threshold": "Original adjusted P <0.05, no effect threshold; missing adjusted P is not a negative call",
    "authorRows": len(author), "localRows": len(local), "sharedIds": len(joined), "sharedFiniteEffects": len(finite),
    "authorFiniteAdjustedP": int(author.adjP.notna().sum()), "sharedBothAdjustedP": len(tested),
    "localIdsAbsentAuthor": sorted(set(local.id) - set(author.EnsID)),
    "allAuthorSignificant": int((author.adjP < .05).sum()), "allLocalSignificant": int((local.padj < .05).sum()),
    "sharedAuthorSignificant": int(a_sig.sum()), "sharedLocalSignificant": int(l_sig.sum()),
    "bothSignificant": overlap, "evaluableJaccard": overlap / union if union else None,
    "authorOnlySignificant": int((a_sig & ~l_sig).sum()), "localOnlySignificant": int((~a_sig & l_sig).sum()),
    "pearsonLogFC": float(finite.author_logFC_male_minus_female.corr(finite.logFC)),
    "spearmanLogFC": float(finite.author_logFC_male_minus_female.corr(finite.logFC, method="spearman")),
    "medianAbsLogFCDifference": float(finite.difference_local_minus_author.abs().median()),
    "maxAbsLogFCDifference": float(finite.difference_local_minus_author.abs().max()),
    "directionsAgree": int(finite.direction_agrees.sum()),
    "sharedAuthorSignificantDirectionsAgree": int(tested.loc[a_sig, "direction_agrees"].sum()),
    "authorSignificantMissingLocal": author.loc[(author.adjP < .05) & ~author.EnsID.isin(local.id), ["EnsID", "Gene"]].to_dict(orient="records"),
    "authorSignificantDirectionDisagreements": tested.loc[a_sig & ~tested.direction_agrees, ["EnsID", "Gene", "author_logFC_male_minus_female", "logFC", "adjP", "padj"]].to_dict(orient="records"),
    "caution": "Registered edgeR comparison remains unchanged. Standalone current-DESeq2 sensitivities with transcript-length offsets resolve the three author-significant direction differences and improve significance overlap; optional beta-prior shrinkage closely reconciles effect magnitudes. Historical transcript mapping and Galaxy settings are not fully recovered. See REVIEW_2026-09-04.md and the model-sensitivity artifacts; do not promote this to full verification or replace production output.",
}
out.mkdir(parents=True, exist_ok=True)
(out / "comparison.summary.json").write_text(json.dumps(summary, indent=2, allow_nan=False) + "\n", encoding="utf-8")
finite.to_csv(out / "comparison.per-gene.tsv", sep="\t", index=False, float_format="%.15g")
dataset = local_path.parents[1]
files = [author_path, local_path, Path(__file__),
         root / "scripts/validate_GSE224254_author.R",
         root / "scripts/audit_GSE224254_direct_lengths.py",
         root / "scripts/validate_GSE224254_direct_rows.R",
         root / "scripts/summarize_GSE224254_sensitivity.py",
         root / "geo_replication/scripts/prep_GSE224254.R",
         dataset / "raw/GSE224254_sst_neuron_gene_expected_counts.tsv.gz",
         dataset / "metadata/GSE224254_samplesheet.tsv",
         dataset / "metadata/GSE224254_transcript_to_gene.tsv.gz",
         dataset / "metadata/GSE224254_source_files.tsv",
         dataset / "metadata/GSE224254_family.soft.gz",
         *sorted((dataset / "raw").glob("GSM*.tsv.gz")),
         *sorted(p for p in out.iterdir() if p.is_file() and p.name != "artifact-manifest.json")]
(out / "artifact-manifest.json").write_text(json.dumps({"schemaVersion": 1, "sourceUrl": summary["authorSource"], "files": [
    {"path": p.relative_to(root).as_posix(), "bytes": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
    for p in files]}, indent=2) + "\n", encoding="utf-8")
print(json.dumps({k: v for k, v in summary.items() if not isinstance(v, list)}, indent=2))
