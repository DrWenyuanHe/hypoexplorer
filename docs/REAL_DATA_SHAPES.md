# Real data shapes for future HypoExplorer datasets

Status: design spec, written before the real datasets landed, plus a record of
what the producers write since the R 4.6.0 regeneration of 2026-09-25 (see
"Committed analysis outputs" below). It documents the
conventions that real analysis outputs are expected to follow so the dataset
abstraction (`src/data/datasets.js`, `loadTrack`, `buildPopData`,
`getGroupedValues`) and the test-only synthetic fixtures are designed against
realistic inputs rather than guesses.

The authoritative *shape* contract (manifest + track-bundle object layout) lives
in `docs/DATASET_CONTRACT.md`. This file is the *upstream-analysis* companion: it
says what the lab's edgeR / array / FGSEA outputs actually look like, where they
are messy, and how the generator (`data/scripts/preprocess_multi.py`) must
normalise them into the bundle contract.

Two things every dataset carries (recap from the contract):

- **Track** — the unit selected within a dataset. Single-cell datasets have many
  tracks (one per cell population, e.g. `e9`, `Ast1`). Bulk / array
  whole-tissue datasets typically have **one** track (`whole`) or a handful of
  anatomical regions.
- **Group** / **Contrast** — groups are experimental arms
  (`{key, label, color}`); a contrast is a `baseline -> case` pair referencing
  two group keys and owns the DE table (and, when `supportsPathways`, a pathway
  table).

The row entity is a **feature**. It is stored under the existing `gene` key in
the DE table regardless of modality (no mass rename); `featureType` /
`featureLabel` in the manifest drive the UI label ("Gene" vs "miRNA").

---

## Reference: the macaque snRNA-seq shapes (dataset #1, already real)

This is the shape the rest of the spec generalises from. A track bundle's `de`
array is a list of edgeR quasi-likelihood rows:

| Column      | Type   | Meaning                                                    |
|-------------|--------|------------------------------------------------------------|
| `gene`      | string | Feature symbol (the row id; see "Gene symbols" below)      |
| `logFC`     | number | log2 fold change, case vs baseline                          |
| `logCPM`    | number | log2 counts-per-million, average expression                 |
| `PValue`    | number | raw p-value (edgeR QL F-test)                               |
| `FDR`       | number | Benjamini-Hochberg adjusted p-value                         |
| `rank_score`| number | signed ranking statistic used to seed FGSEA                 |
| `rankPos`   | number | 1-based position after sorting by `rank_score`             |

`cpm` is per-feature per-sample expression. Pathways are keyed by the four
`DB_NAMES` (`GO_BP`, `HALLMARK`, `KEGG`, `REACTOME`) — see
`src/data/constants.js` — and each pathway entry is
`{ pathway, pval, padj, NES, size, leadingEdge:[features] }`.

Every real dataset below must funnel into the same `de` / `cpm` / `pathways`
object layout. The differences are in **which columns the upstream tool emits**,
**what a feature id looks like**, **whether pathways exist at all**, and **how
small-n statistics degrade**.

---

## 1. Bulk RNA-seq (HFD-vs-chow, fasted/fed, insulin) — edgeR DE

The most common future input: whole-hypothalamus (or a few regions) bulk
RNA-seq, one or two contrasts, run through the **same edgeR QL pipeline** as the
macaque data. Because it shares the engine, its DE table is the closest to the
reference shape.

### Expected DE columns

The generator should map upstream column names to the canonical names above:

| Upstream (edgeR `topTags`) | Canonical bundle column | Notes                          |
|----------------------------|-------------------------|--------------------------------|
| row name / `gene` / `symbol` | `gene`                | feature id                     |
| `logFC`                    | `logFC`                 | direct                         |
| `logCPM`                   | `logCPM`                | direct                         |
| `PValue`                   | `PValue`                | direct                         |
| `FDR`                      | `FDR`                   | direct (edgeR already BH-adjusts) |

`rank_score` / `rankPos` are **derived by the generator**, not emitted by edgeR.
Compute `rank_score` from the signed F-statistic (sign of `logFC` × ranking
metric) exactly as the macaque pipeline does, then sort and assign `rankPos`, so
FGSEA seeding is identical across datasets.

### Gene symbols

- Features are **gene symbols** (HGNC for human, MGI for mouse). The UI treats
  them as opaque strings and sorts them with a natural-order comparator.
- **Mixed identifiers happen.** Some upstream tables ship Ensembl IDs
  (`ENSG…` / `ENSMUSG…`) or `symbol|ensembl` composites. The generator must
  resolve to a single display symbol and keep it stable; do not ship raw
  Ensembl IDs as the visible feature id unless no symbol exists.
- Cross-species pathway mapping: the macaque data already maps to
  *Macaca mulatta* as the closest msigdbr ortholog proxy. Mouse bulk maps to
  *Mus musculus* directly. Record the mapping organism in the manifest
  `organism` field; it is user-facing in the Data Sources tab.

### Duplicate symbols

Real tables routinely contain the **same symbol on multiple rows** (multiple
Ensembl genes collapsing to one symbol, or readthrough / paralog annotation).
Downstream code keys DE by `gene` (`deByGene = Object.fromEntries(de.map(...))`),
so a duplicate symbol would silently overwrite.

Since the R 4.6.0 regeneration this is settled in the R producers, before the
test (rules A3.1 and M1 in `scripts/lib/de_common.R`; the full rule strings are
in every `<stem>_provenance.tsv`):

- Every feature is mapped to its final public symbol: the organism annotation,
  then an R copy of `normalizeGene` (`scripts/lib/geneSymbol.mts`). Both turn a
  zero-padded Excel month number into its plain number (`Sep-01` → Septin1).
- Features that share a symbol are summed before the fit only when they are
  distinct stable IDs annotated to that symbol, or repeats of one identical
  label that is not an Excel date. Counts are summed (`rowsum`), log-scale
  matrices averaged (`limma::avereps`), linear-scale normalized matrices summed
  on the linear scale.
- Other collisions are fitted as separate rows: repeated Excel-date labels, and
  distinct symbol-type labels that meet only after normalization. Only the
  feature whose label is exactly the symbol is published.
- A 1-Mar or 2-Mar label (any format) can mean MARCHF1/2 or MTARC1/2 and is
  hidden, even when it occurs once, unless another column of the same source
  row resolves it: a stable-ID column, the official or previous official gene
  name (exact, or at least 50% vs at most 20% word overlap with the same gene
  number), or the chromosome.
- Features without a symbol, and unresolved ones, stay in the fit as their own
  rows, so `filterByExpr`, TMM, the dispersion / eBayes priors and the BH family
  see the whole library. They are left out of every published table.
- Nothing is de-duplicated after testing. Keeping the strongest row per symbol,
  which some older producers did, is no longer allowed.

A builder therefore never receives a duplicated symbol from a regenerated
table. Builders read these tables through `scripts/lib/regenTables.mts` and do
not deduplicate or sum anything; `scripts/lib/bundleWriter.mts` refuses a DE
table that lists a gene twice.

### Missing / unreliable FDR on small n

Bulk designs are often small (2v2, 3v3) and sometimes unbalanced (2v3). With few
replicates:

- `FDR` may be `NA` for genes filtered by edgeR's independent filtering, or `1`
  across the board when nothing survives multiple testing. Serialize `NA` as
  JSON `null`, **not** the string `"NA"` and **not** `NaN` (which is not valid
  JSON).
- The volcano transform does `-log10(FDR + 1e-300)`; a `null` FDR must be
  guarded by the consumer (skip the point or fall back to raw `PValue`) rather
  than producing `NaN`. Document this so chart code does not assume FDR is always
  finite.
- For very small n, prefer surfacing `PValue` ranking and clearly labelling FDR
  as unreliable rather than hiding it.

### Groups, contrasts, and `groupSamples`

- HFD-vs-chow: `groups: [{key:'chow',…}, {key:'hfd',…}]`,
  `contrasts: [{id:'hfd_vs_chow', baseline:'chow', case:'hfd', isDefault:true}]`.
- **Fasted/fed** and **insulin** are likewise **two-group contrasts**:
  - fasted/fed: `groups: [{key:'fasted'}, {key:'fed'}]`,
    `contrast hfd? -> fed_vs_fasted (baseline fasted, case fed)`.
  - insulin: `groups: [{key:'vehicle'}, {key:'insulin'}]`,
    `contrast insulin_vs_vehicle (baseline vehicle, case insulin)`.
- A dataset MAY carry more than one contrast in `contrasts[]` (e.g. a design
  that is both fasted/fed and ±insulin). v1 of the app renders only the
  `isDefault` contrast; the extra contrasts are stored but not yet selectable.
- `meta.groupSamples` lists the **real sample IDs per group**, e.g.
  `{ chow: ['C1','C2','C3'], hfd: ['H1','H2'] }`. Unbalanced designs simply list
  fewer ids in one group — there is no positional 6-slot array and no null
  padding. `cpm[feature]` is parallel to `meta.sampleOrder` (or group-keyed per
  the contract), so `getGroupedValues` maps each sample id to its column and
  reports a real per-group `n`.

### Pathways

Bulk RNA-seq runs FGSEA the same way as the macaque data, so
`supportsPathways: true` and `pathways` carries the four `DB_NAMES`. Same entry
shape (`pathway, pval, padj, NES, size, leadingEdge`).

---

## 2. miRNA microarray (±HFD whole hypothalamus)

A different modality with three structural differences from RNA-seq.

### Feature ids are miRNA names

- Features are **miRBase miR IDs**, e.g. `mmu-miR-122-5p`, `hsa-let-7a-3p`. They
  are case-sensitive and contain hyphens; treat them as opaque strings exactly
  like gene symbols. Stored under the same `gene` key in the `de` rows.
- The manifest sets `featureType: 'miRNA'`, `featureLabel: 'miRNA'` so the UI
  column header and search placeholder read "miRNA" instead of "Gene".
- Probe-to-miR collapsing: arrays often have **multiple probes per miR**. Collapse
  to one row per miR id before the test, by the same rule as gene symbols
  (average on the log scale; do not pick a single probe after testing).

### Intensities, not CPM

- The per-sample value matrix holds **normalised log2 array intensities**, not
  CPM. It is still stored under the `cpm` key (no rename), but it is intensity.
  `logCPM` in the DE table becomes **average log2 intensity**; keep the column
  name but understand the unit differs. Document the unit in the manifest /
  methodology so axis labels and tooltips can be made accurate later.
- DE for arrays usually comes from **limma**, not edgeR. The generator maps
  limma's `topTable` columns to the canonical names:

  | limma column | canonical | notes                                    |
  |--------------|-----------|------------------------------------------|
  | `logFC`      | `logFC`   | direct                                   |
  | `AveExpr`    | `logCPM`  | average log2 intensity (renamed slot)    |
  | `P.Value`    | `PValue`  | direct                                   |
  | `adj.P.Val`  | `FDR`     | BH adjusted                              |

  `t` / `B` are dropped; `rank_score` / `rankPos` are derived from the signed
  moderated-t exactly as for RNA-seq.

### No pathways

- miRNA gene-set enrichment is not part of this resource. The manifest sets
  **`supportsPathways: false`**, the track bundle **omits the `pathways` key
  entirely**, and `buildPopData` returns `allPathways: []`. The app hides the
  Pathway tab based on the `supportsPathways` flag — **not** on
  `allPathways.length === 0` (an empty array could otherwise be a transient load
  state). This is the canonical modality-difference test in the suite.

### Groups / contrasts

Two-group ±HFD, same structure as bulk: `groups: [{key:'chow'}, {key:'hfd'}]`,
`contrasts: [{id:'hfd_vs_chow', baseline:'chow', case:'hfd', isDefault:true}]`.

---

## Committed analysis outputs (R 4.6.0, since 2026-09-25)

Every bulk producer writes to `geo_replication/datasets/<dir>/processed/`
under one `<stem>` per DE table. The rules and the provenance writer are shared
through `scripts/lib/de_common.R`; the producers are listed in
`data/quality/regeneration-r460-2026-09-25/README.md`.

| File | Content |
|---|---|
| `<stem>_DE.tsv` | `id, symbol, logFC, stat, pvalue, padj, method, direction`. `id` is the public symbol, equal to `symbol`; no raw Ensembl or probe ID appears. `stat` is `sign(logFC) × F` for edgeR-QL and the moderated *t* for limma. |
| `<stem>_SE.tsv` | `id, se`: the QL-adjusted Wald standard error from a refit of the same model (count data only) |
| `<stem>_feature_map.tsv.gz` | `feature_id, symbol, status`, one row per input feature. `status` is one of: `mapped` (published under `symbol`, alone or summed); `disambiguated_by_stable_id`, `disambiguated_by_name` or `disambiguated_by_chr` (a 1-Mar / 2-Mar label resolved by that column and published); `ambiguous_symbol` (fitted as its own row, not published); `dropped_no_symbol` (no public symbol; fitted, not published). HFD and September 5 intake tracks record their feature-to-symbol map in `metadata/<base>_gene_map.tsv` (`gene_id, symbol`, no status column). |
| `<stem>_CPM_TMM.tsv.gz` | Count data: `gene_id` then one column per sample. count / (filtered library size × TMM factor) × 10^6, with the DE fit's own TMM factors. This is what the browser shows, labelled "CPM (TMM-normalized)". |
| `<stem>_CPM_raw.tsv.gz` | Count data: count / raw input column total × 10^6. Written for comparison but not committed (`.gitignore`); it is kept in the frozen staging archive. |
| `<stem>_cpm_normalization.tsv` | Per sample: raw, fit, published and filtered library sizes, TMM factor and effective library size |
| `<stem>_expression.tsv.gz` | Matrix data (limma): the deposited values in their deposited unit, aggregated by symbol |
| `<stem>_provenance.tsv`, `<stem>_SE_provenance.tsv` | Key/value record: generator and `de_common.R` SHA-256, R, edgeR, limma and annotation versions, the rule strings (`rule_duplicates`, `rule_mar_disambiguation`, `rule_fractional`, `rule_cpm`), `mar_resolution`, `text_output_policy`, design and coefficient, sample lists, feature counts (`n_unmapped_in_fit`, `n_features_collapsed`, `n_unmapped_tested`), and input and output SHA-256 |
| `<stem>_sessionInfo.txt`, `<stem>_SE_sessionInfo.txt` | R `sessionInfo()` of the run |
| `<stem>_FGSEA_<DB>.tsv`, `<stem>_FGSEA_provenance.tsv` | Enrichment per collection and its schema-3 provenance |

Every text file is written with LF line endings on every platform, and the
recorded SHA-256 values are of those LF bytes. Fractional count estimates
(Salmon, RSEM, ArrayStudio) reach edgeR unrounded.
For multi-contrast tracks, `_CPM_TMM` comes from one fit over all included
samples of the track.

The macaque atlas writes the same information in its own layout under
`data/raw/results/<population>/`: `de/DE_all.csv`, `de/normcpm.csv` (TMM CPM,
what the browser shows), `qc/library_sizes.csv`,
`de/DE_provenance.tsv`, `fgsea/FGSEA_provenance.tsv` and `sessionInfo.txt`,
with `_global/RUN_provenance.tsv` for the run. Its `de/rawcpm.csv` is written
but not committed. The per-animal pseudobulk counts are in `data/raw/pseudobulk/`.

---

## Generator normalisation checklist

When `data/scripts/preprocess_multi.py` (or a per-modality variant) ingests a new
real dataset, it must, before writing `track_<id>.js`:

1. Rename upstream DE columns to the canonical set
   (`gene, logFC, logCPM, PValue, FDR`).
2. Derive `rank_score` (signed ranking metric) and `rankPos` (1-based after sort)
   — these are app conventions, not tool output.
3. Resolve feature ids to a single stable display symbol / miR id. Duplicates
   are handled before the test by the R producer (rule A3.1 above); a builder
   must refuse, not silently overwrite, a duplicate it still meets.
4. Serialise missing statistics as JSON `null` (never `"NA"`, never `NaN`).
5. Emit `meta.groupSamples` with real per-group sample id arrays (unbalanced is
   fine) and a `meta.sampleOrder` (or group-keyed `cpm`) that the value matrix is
   parallel to.
6. Include `pathways` (four `DB_NAMES`) **iff** the dataset supports them; omit
   the key otherwise and set `supportsPathways: false` in the manifest.
7. Assign the dataset-namespaced global
   (`HX_<DATASET>_<TRACKID>`) and write to the scoped path
   (`/datasets/<datasetId>/track_<id>.js`).

---

## Edge cases the contract must survive (and the tests assert)

| Edge case                              | Where it bites                  | Handling                                                        |
|----------------------------------------|---------------------------------|-----------------------------------------------------------------|
| Unbalanced design (2v3, 5v4)           | per-sample bars / exports       | `getGroupedValues` reads `groupSamples`; per-group `n` shown    |
| Missing FDR on small n                 | volcano `-log10(FDR)`           | `null` FDR guarded; fall back to `PValue` / skip point          |
| Duplicate feature symbol               | `deByGene` overwrite            | R producer aggregates before the fit; builder refuses duplicates |
| Non-CPM value units (array intensity)  | axis labels / tooltips          | stored under `cpm` key; unit recorded in manifest/methodology   |
| Modality without pathways (miRNA)      | Pathway tab visibility          | `supportsPathways:false`; tab hidden by flag, not array length  |
| limma vs edgeR column names            | DE table ingestion              | generator renames to canonical columns                          |
| Single-track whole-tissue dataset      | sidebar grouping                | `defaultTrack` = lone track; grouping skipped (one category)    |
| Multiple contrasts in one dataset      | contrast selection              | only `isDefault` rendered in v1; others stored                  |
