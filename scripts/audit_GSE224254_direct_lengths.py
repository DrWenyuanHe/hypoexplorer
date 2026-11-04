"""Compute tximport-style gene lengths directly over all deposited transcript rows.

Contrasts direct duplicate-row TPM weights with separately documented pooled-run
weights. No source row is omitted except the existing unresolvable transcript map.
"""
from pathlib import Path
import numpy as np
import pandas as pd

root = Path(__file__).resolve().parents[1]
ds = root / "geo_replication/datasets/GSE224254_mouse_sst_neuron_sex"
out = root / "data/author-validation/continued-sources/GSE224254"
mapping = pd.read_csv(ds / "metadata/GSE224254_transcript_to_gene.tsv.gz", sep="\t")
samples = pd.read_csv(ds / "metadata/GSE224254_samplesheet.tsv", sep="\t")
prepared = pd.read_csv(ds / "raw/GSE224254_sst_neuron_gene_expected_counts.tsv.gz", sep="\t").set_index("gene_id")
retained = mapping.mapping_status.eq("retained unique release-97 mapping")
gene_ids = mapping.loc[retained, "gene_id"].to_numpy()
lengths = {}
fallbacks = []
for i, sample in samples.iterrows():
    source = pd.read_csv(ds / f"raw/{sample.geo_accession}_{3297+i}.tsv.gz", sep="\t")
    n = len(mapping)
    assert len(source) == 2*n
    assert np.array_equal(source.target_id.iloc[:n], mapping.source_transcript_id)
    assert np.array_equal(source.target_id.iloc[n:], mapping.source_transcript_id)
    assert np.array_equal(source.eff_length.iloc[:n], source.eff_length.iloc[n:])
    # This is algebraically the direct tximport rowsum across all deposited rows.
    z = pd.DataFrame({"gene_id": gene_ids,
        "counts": (source.est_counts.to_numpy()[:n] + source.est_counts.to_numpy()[n:])[retained],
        "TPM": (source.tpm.to_numpy()[:n] + source.tpm.to_numpy()[n:])[retained],
        "length": source.eff_length.to_numpy()[:n][retained]})
    z["weighted_length"] = z.TPM * z.length
    grouped = z.groupby("gene_id").sum()
    assert np.allclose(grouped.counts, prepared.loc[grouped.index, sample["sample"]], rtol=1e-10, atol=1e-8)
    lengths[sample["sample"]] = grouped.weighted_length / grouped.TPM
    fallbacks.append(z.groupby("gene_id")["length"].mean())
lengths = pd.DataFrame(lengths)
with np.errstate(divide="ignore", invalid="ignore"):
    geometric = np.exp(np.log(lengths).mean(axis=1))
fallback = pd.concat(fallbacks, axis=1).mean(axis=1)
geometric = geometric.fillna(fallback)
lengths = lengths.T.fillna(geometric).T
assert np.isfinite(lengths.to_numpy()).all() and (lengths.to_numpy() > 0).all()
lengths.index.name = "gene_id"
lengths.to_csv(out / "direct_deposited_row_gene_lengths.tsv", sep="\t", float_format="%.15g")
print(f"Verified direct deposited-row counts and computed lengths: {lengths.shape}")
