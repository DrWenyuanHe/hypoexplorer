# Human Protein Atlas 25 hypothalamus reference

Retained sources for the expression survey's four HPA sources. All are pinned to
`v25.proteinatlas.org`, whose downloads were byte-identical to the current site on
2026-10-29.

| Source id | Data | Values |
| --- | --- | --- |
| `hpa-human-hypothalamic-subregions` | 20,162 genes × 8 subregions: arcuate, dorsomedial, lateral hypothalamic area, mammillary body, paraventricular, preoptic, supraoptic, ventromedial | One published nTPM per subregion (summary) |
| `hpa-human-hypothalamus-snrna-clusters` | 19,580 genes × 26 HPA clusters from 134,430 hypothalamic nuclei (HPA credits Siletti et al.) | One published nCPM per cluster (summary) |
| `hpa-mouse-hypothalamus` | 22,246 Ensembl mouse genes × 4 animals (F 1, F 2, M 1, M 2) | Per-animal nTPM |
| `hpa-pig-hypothalamus` | 22,063 Ensembl pig genes × 4 animals | Per-animal nTPM |

HPA's single "hypothalamus" region value equals the maximum of the eight subregion
values for every gene. The build verifies this and does not ship the region value.

## Files

The `.hypothalamus.tsv.gz` files hold the header plus every unmodified row of the
original zip member that passes the filter recorded in `source-manifest.json`, in
source order, gzip level 9. Small tables (`rna_brain_hpa_subregions`,
`rna_single_nuclei_brain_datasets`) are retained whole.
`hpa-api-checkpoints.json` holds the HPA search API's hypothalamus nTPM for POMC,
HCRT, AGRP and OXT. The v25 host redirects that API to the current site, which
served version 25 at retrieval.

Symbols for the per-animal sources are not in HPA's files, which give Ensembl IDs
only. They come from two committed tables, each pinned by hash:

- Mouse: `scripts/lib/mmus_ens2sym.json`, the repository's MGI MRK_ENSEMBL table.
  It covers 22,106 of 22,246 genes.
- Pig: `Sus_scrofa.gene_info.gz` retained for GSE281726. Only unique Ensembl
  cross-references are used, covering 17,084 of 22,063 genes.

Unmapped genes stay searchable by Ensembl ID. HPA 25 uses its own Ensembl
release, while these tables are current at their retrieval. The Ensembl ID is
therefore the authoritative identity.

## Commands

```bash
pnpm exec tsx scripts/build_hpa_reference.mts           # verify sources, write products, replay every value
pnpm exec tsx scripts/build_hpa_reference.mts --check   # byte-compare existing products instead
pnpm exec tsx scripts/build_hpa_reference.mts --fetch   # re-download pinned originals; refuses any byte change
```

`--fetch --record` deliberately re-acquires and rehashes. Products under
`public/expression/hpa/` (about 21 MB) are gitignored build artifacts written by
`pnpm run build:expression-external`.

## What the build checks

- Retained hashes match the manifest; zip members are CRC-checked on `--fetch`.
- The subregion filter equals HPA's own hypothalamus membership table.
- Each gene has exactly one value per subregion, cluster or animal. Clusters
  `c-0`…`c-25` keep one cluster type each, and animals are exactly F 1, F 2, M 1,
  M 2.
- Every value is plain non-negative decimal text. All 847,612 emitted values are
  read back and compared.
- The region value is the subregion maximum for all 20,162 genes, and the HPA API
  hypothalamus nTPM agrees for each checkpoint gene.

## Interpretation limits

Human subregion and cluster values are published summaries. The survey shows them
as stated, with no sample count and no computed mean. The 26 cluster-type labels
are HPA's whole-brain labels as published, and some are cortical names (for
example "deep-layer intratelencephalic"); they are not hypothalamic cell-type
assignments. Age and husbandry of the mouse and pig animals are described in HPA's
brain methods, not in these files. Feeding state is not reported, so no group is
reference-eligible.

## Attribution

Sjöstedt E, et al. An atlas of the protein-coding genes in the human, pig, and
mouse brain. Science 2020;367(6482):eaay5947, DOI 10.1126/science.aay5947.
Human Protein Atlas version 25 (v25.proteinatlas.org), CC BY 4.0. The
single-nucleus clusters derive from Siletti K, et al., Science
2023;382(6667):eadd7046, DOI 10.1126/science.add7046. Third-party data inside HPA
keeps its own terms; HPA's GTEx-derived brain tables are not imported, because
GTEx is imported directly.
