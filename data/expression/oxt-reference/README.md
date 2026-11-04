# GSE147092 OXT neuron expression reference

This import preserves **28,950 source features × 146 single cells** from the
authors' processed Monocle2 CENSUS matrix. It supplies two expression-survey
sources: 125 final magnocellular and 21 final parvocellular OXT neurons from PVN.
It does not register a differential-expression dataset or manufacture a contrast.

Sources:

- [GSE147092](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE147092).
- [Official processed expression matrix](https://ftp.ncbi.nlm.nih.gov/geo/series/GSE147nnn/GSE147092/suppl/GSE147092_expression_matrix.tsv.gz).
- [Lewis et al., Neuron 2020](https://pubmed.ncbi.nlm.nih.gov/33113347/),
  *Parallel social information processing circuits are differentially impacted in autism*.
- [Author data and code](https://github.com/gofflab/OT_neuron_study_2020), pinned
  at commit `39072fc7037398a8a2fd8abf63e685243355e3d3`.

The official GEO matrix expands to the exact same bytes as the pinned author
repository matrix: 22,403,256 bytes with SHA-256
`5f001f0774895c6fe53af15934cb8b79081d692e7477b0954c4fad5e5b8a5eec`.
`expression_matrix.tsv.gz` retains the original GEO gzip bytes. Other retained
inputs are deterministic gzip containers of the original GitHub bytes, including
cell and feature annotation, the analysis notebook, the CuffNorm run record and
the repository's MIT license. `source-manifest.json` pins every compressed file,
each expanded source file, its Git blob SHA-1, URL and byte count. Compression
changes neither the retained source bytes nor the expression scale.

The compressed inputs are not part of the public repository. The upstream
repository's MIT license (Copyright (c) 2020 Goff Lab), which covers the imported
matrix and annotations, is reproduced in [`LICENSE`](LICENSE).

## Meaning and limits

The scale is **CENSUS estimated mRNA copies/cell**, as described by the
[depositor's sample record](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSM4416920)
and the author notebook. It derives from HISAT2 alignment to mm10 and CuffNorm
abundances against GENCODE vM8, followed by Monocle2 `relative2abs`. These
fractional estimates are imported directly. They are not read/UMI counts, CPM or
TPM, and the importer does not refit or renormalize them.

The displayed profiles are **cells**, not independent animal replicates. The
retained annotation has source animal/pool labels `M3`, `M4` and `M1-5`, with
48, 47 and 51 retained cells respectively. The paper reports two individual-mouse
collections and one five-mouse collection; the importer does not infer a separate
mouse identity for cells in `M1-5` or reconcile the paper's plate numbering with
the annotation. Source plate labels and Fluorogold status remain per-cell
metadata and define separate display groups inside each final population.

The final source `CellType` assignment is preserved separately from the original
`Cell_Type_guess`; neither Fluorogold staining nor provisional type replaces it.
The annotation labels all cells P25, while GEO sample records describe P23. Both
claims are disclosed. The paper describes male mice; sex is absent from the
per-cell annotation. Feeding state is unreported. Fluorogold labeling and source
metadata uncertainty mean all groups have `referenceEligible: false`; they remain
available when surveying all reported states. No genotype or feeding intervention
is inferred from the article's other experiments.

Original versioned Ensembl feature IDs and source symbols remain distinct. A
missing measurement or ambiguous symbol is not a zero and is never silently
merged with another feature. Means in the existing survey are descriptive means
of selected stored cell values; no inferential test is introduced.

## Rebuild and validation

From the repository root:

```text
npx tsx scripts/build_oxt_reference.mts
npx tsx scripts/build_oxt_reference.mts --check
```

Both commands are offline. `--fetch` explicitly restores the exact pinned
archives from their public sources; changed hashes fail instead of refreshing the
scientific source silently. The checker verifies original/archive hashes, the
pinned Git blob hashes, exact sample/feature alignment, 125/21 population counts,
the source group partition, finite nonnegative values, gene/shard closure and all
**4,226,700 emitted measurements** against the original matrix. It compares every
generated product with its current expected bytes and separately reads all shard
vectors back for the source-cell comparison. This establishes fidelity to the
published processed matrix; it does not independently reproduce CENSUS from raw
reads or certify the original experiment.

Products live under `public/expression/oxt-reference/`: a source/sample manifest,
a feature index, 256 gene shards and a validation report. Each gene vector follows
the manifest's full `samples` array. Shards are selected by the first two SHA-256
hex digits of the original feature ID. The dedicated source collection supports
gene expression without an artificial DE track.
