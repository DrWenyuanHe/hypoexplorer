# Upstream analysis tables

This page describes the analysis tables that the bundle builders read, and the
conventions those tables follow. The bundle format itself is in the
[dataset contract](DATASET_CONTRACT.md). The rules live in code, so this page
names the owner of each rule rather than restating it:

- R producers and their shared rules: `scripts/lib/de_common.R`. The current
  producers are the jobs in `scripts/regenerate_bulk_de_current.R`;
  `data/quality/regeneration-r460-2026-09-25/README.md` records the September
  regeneration, which predates the GSE135007 serialization successor.
- The DE-table header contract, the NA rule and `rank_score`:
  `scripts/lib/deTable.mts`.
- Reading the regenerated tables in builders: `scripts/lib/regenTables.mts`.
- Symbol normalization: `scripts/lib/geneSymbol.mts` (`normalizeGene`), with an
  R copy used by the producers.

These analysis outputs are
[not tracked in this repository](PROJECT_GUIDANCE.md#files-not-in-this-repository).
`pnpm run fetch:data` restores their redistributable part.

## Producer outputs

Bulk producers write to `geo_replication/datasets/<dir>/processed/`, one
`<stem>` per DE table. The GSE135007 serialization successor is the exception: it
refuses to run without `HYPO_OUT_ROOT` and writes there, so its results are staged
and verified before explicit adoption (`run_gse135007_serialized_r460.R`).

| File | Content |
|---|---|
| `<stem>_DE.tsv` | One row per published symbol. Builders require `symbol, logFC, stat, pvalue, padj, method` (`REQUIRED_DE_COLUMNS`). `stat` is `sign(logFC) × F` for edgeR-QL and the moderated *t* for limma. |
| `<stem>_SE.tsv` | `id, se`: the coefficient standard error from the fit itself: the QL-adjusted Wald SE from a refit of the same model for edgeR, the moderated SE (`stdev.unscaled × sqrt(s2.post)`) for limma producers that write one (`run_oxt_avp_r460.R`). |
| `<stem>_feature_map.tsv.gz` | One row per input feature with its public symbol and mapping status. HFD and September 5 intake tracks keep their map in `metadata/<base>_gene_map.tsv` instead. |
| `<stem>_CPM_TMM.tsv.gz` | Count data: TMM-normalized CPM using the DE fit's own TMM factors (for a multi-contrast track, the whole-track fit described below). This is what the browser shows. |
| `<stem>_CPM_raw.tsv.gz` | Count data: raw-library CPM. Written for comparison and gitignored. |
| `<stem>_cpm_normalization.tsv` | Per-sample library sizes, TMM factor and effective library size. |
| `<stem>_expression.tsv.gz` | Matrix data (limma): the values on the scale the fit used, aggregated by symbol. That is the deposited unit for log-scale deposits; a linear deposit is written as `log2(x + 1)` (GSE157077's FPKM, `de_gse157077_r460.R`). The registry's `expressionUnit` names what is stored. |
| `<stem>_provenance.tsv`, `<stem>_sessionInfo.txt` (and `_SE_` variants) | The run record: script and package versions, rule strings, design, samples, feature counts and input/output SHA-256. |
| `<stem>_FGSEA_<DB>.tsv`, `<stem>_FGSEA_provenance.tsv` | Enrichment per collection and its provenance. |

Text outputs use LF line endings on every platform, and the recorded SHA-256
values are of those bytes. Fractional count estimates (Salmon, RSEM,
ArrayStudio) reach edgeR unrounded. For a multi-contrast track, `_CPM_TMM` comes
from one fit over all of the track's included samples, while each contrast's DE is
fitted on that contrast's own sample subset (rule C2 in `de_common.R`;
`run_september5_r460.R`).

A persisted standard error always wins over a recovered one, because it came from
the fit. Without one, an SE may be recovered only from limma's moderated *t*
(`|logFC| / |t|`); an edgeR QL *F* cannot reconstruct a Wald SE, so for edgeR and
every other method a missing SE stays missing (`seFromStat` in
`src/utils/seRecovery.ts`).

The macaque atlas writes the same information in its own layout under
`data/raw/results/<population>/` (`de/DE_all.csv`, `de/normcpm.csv`,
`qc/library_sizes.csv`, the provenance files and `sessionInfo.txt`), with the
run record in `_global/RUN_provenance.tsv`. Its per-animal pseudobulk counts are
in `data/raw/pseudobulk/`.

## Conventions and why they hold

Duplicate symbols are settled in the R producers before the test, never after
(rules A3.1 and M1 in `de_common.R`; the full rule strings are in every
provenance file). Distinct stable IDs annotated to one symbol, and repeats of one
non-date label, are combined on the scale where summing is meaningful: counts and
linear matrices summed, log-scale matrices averaged, and `log2(x + 1)` matrices
inverse-transformed, summed and re-logged. Distinct labels that collide only after
normalization (repeated Excel-date labels, distinct symbol-type labels) are not
combined: each is fitted as its own row, and only a feature whose label equals
the symbol exactly is published. Ambiguous labels, such as Excel-converted
`1-Mar` / `2-Mar`, also stay in the fit as their own rows and are published only
when another column of the source row resolves them. Unmapped features also stay in the fit, so filtering,
normalization, the priors and the BH family see the whole library. Keeping the
strongest row per symbol after testing is not allowed. Builders therefore never
meet a duplicate, and `bundleWriter.mts` refuses a table that lists a gene twice.

A missing statistic is never 0. R writes NA as an empty cell, and `numCell`
reads empty, `NA` and `NaN` as NaN, which serializes as JSON `null`. Readers
must guard `null` FDR; the volcano in `buildPopData.ts` plots it at zero
height. Small designs (2v2, 2v3) often produce null or uniformly high FDR.

`rank_score` is the signed, capped `-log10(FDR)`, computed once in
`rankScore` (`deTable.mts`). A bundle's DE table is stored in rank order, and
the app takes rank from array position.

Modalities differ in three ways that the format absorbs without new fields:

- miRNA features are miRBase IDs (`mmu-miR-122-5p`) stored under the `gene` key,
  with `featureType: 'miRNA'`. Collapse probes per miR before the test, by the
  same rule as gene symbols.
- Array and other matrix data hold normalized intensities or deposited values,
  not CPM. They are still stored under `cpm`, and `expressionUnit` names the
  real unit for axes and exports.
- Modalities without enrichment (miRNA arrays) set `supportsPathways: false`
  and write no pathway sibling.

Features are gene symbols under each species' symbol authority
(`scripts/build_nomenclature.mts` names them: HGNC for human, MGI for mouse, RGD
for rat, and so on). An identifier that does not resolve to a symbol is dropped
from publication by the symbol gate (`normalizeGene`), never shown as a raw
Ensembl ID. Three things are kept distinct for the macaque atlas: the study
organism in the manifest is *Macaca fascicularis*; its symbols are the human
orthologs of the source analysis, governed by HGNC; and its enrichment uses
*Macaca mulatta* gene sets as the closest msigdbr proxy (`run_atlas_r460.R`).
