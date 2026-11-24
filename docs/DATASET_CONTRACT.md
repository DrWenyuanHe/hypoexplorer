# Dataset contract

This page covers the rules for adding a dataset that the code cannot state for
itself: what the design decisions are, which invariants every bundle keeps, and
the order to work in. Field lists and signatures live in the code and are not
repeated here:

- Types: `Dataset`, `Contrast`, `ResolvedContrast`, `DatasetMeta`, `RawTrack`,
  `GeneDERecord` and `PathwaySibling` in `src/types/index.ts`.
- Manifest constructors: `defineDataset` and `defineBulkStudy` in
  `src/data/datasets.ts`. The bundle file names and global keys derive from the
  dataset `id` there and in `src/data/bundleLocators.ts`.
- Writer: `writeDatasetBundles` in `scripts/lib/bundleWriter.mts`, with the
  wire-size policy in `scripts/lib/bundleSlim.mts`.
- Readers: `src/data/rawTrack.ts` (contrast and pathway resolution),
  `src/data/buildPopData.ts`, `src/data/contrasts.ts` and the sample-value
  seam in `src/utils/sampleValues.ts`.
- Tests that pin these rules: `bundleWriter.test.ts`, `bundleSlim.test.ts`,
  `rawTrack.test.ts`, `buildPopData.test.ts`, `sampleValues.test.ts` and
  `datasetsRegistry.test.ts` under `src/__tests__/`.

For the upstream analysis tables the builders read, see
[real data shapes](REAL_DATA_SHAPES.md).

## Terms

- A dataset is one study and modality, declared once in `DATASETS`.
- A track is what a user selects inside a dataset: a cell population for
  single-cell data, or one tissue or region for bulk data.
- A group is an experimental arm. A dataset may declare any number of groups.
- A contrast is a precomputed pairwise baseline-to-case comparison between two
  group keys. A multi-level design is several pairwise contrasts, usually
  against a shared baseline. Selecting a contrast switches which baked table is
  shown; nothing computes DE in the browser.
- A feature is the row entity, a gene or a miRNA. It is always stored under the
  `gene` key; `featureType` and `featureLabel` only change the UI label.

## Manifest decisions

- Exactly one dataset is `isDefault`. Each dataset marks one contrast
  `isDefault`; readers fall back to the first contrast when none is marked.
- `supportsPathways: false` hides the Pathway tab. The tab follows this flag, not
  an empty pathway list, because an empty list can also mean "still loading".
- `exploratory: true` marks a contrast the source study never ran, or one whose
  re-fit cannot support gene-level significance (GSE87544: `~ batch + group` on
  seven units leaves one residual degree of freedom). `description` must say
  which. The flag is never inferred from `description`, because a description
  also annotates faithful re-fits that must not be labelled exploratory.
  `defineBulkStudy` sets both through `contrastNote`.
- `group` buckets contrasts in the selector and in the across-comparisons
  matrix. Only adjacent contrasts with the same value merge, so manifest order is
  the grouping order.
- The contrast selector appears only when a dataset has more than one contrast.
  Switching contrast keeps the active track and the selected genes.

## Bundle invariants

Each dataset writes `meta.js`, `qc_global.js`, one `track_<trackId>.js` per
track, and, when it supports pathways, a `track_<trackId>.pathways.js` sibling per
track and one `pathways_index.js`. Only `meta.js` is tracked in this repository;
the rest are served from the data origin.

Sample values:

- `cpm[feature]` is an array positionally aligned to `meta.sampleOrder`, with
  `null` for a dropped sample. It is never group-keyed.
- Group membership lives only in `meta.groupSamples`. `getGroupedValues` maps
  group to sample id to column, so unbalanced and N-sample designs need no code
  changes. Nothing may assume six samples or a 3+3 split.
- Values are in the dataset's `expressionUnit`, which must name the unit actually
  stored. Count data are TMM-normalized CPM from the DE fit's own TMM factors; for a
  multi-contrast track that is one whole-track fit over every included sample, while
  each contrast's DE is fitted on its own subset (rule C2 in `de_common.R`). Matrix
  data are stored on the scale the fit used, which is not always the deposited
  unit: a linear deposit such as GSE157077's FPKM is stored as `log2(x + 1)`
  (`de_gse157077_r460.R`, `build_normalized_bundles.mts`).

Contrasts:

- `de` holds the registered default contrast's table. `deByContrast` holds only
  the non-default contrasts and deliberately does not repeat the default.
- A non-default contrast must be present in `deByContrast`. If it is missing,
  `buildPopData` returns an empty table and warns; it never substitutes the
  default's numbers, because that would show one contrast's results under
  another contrast's labels. A validator must not require an entry for the
  default contrast (the shipped GSE135639 bundle has none, by design).

Pathways:

- Enrichment ships only in the sibling file, so a view that does not need it can
  say so and skip the download. Loaders state the policy: the main explorer store,
  Compare, the compare set and pathway previews include the sibling; the gene-effect
  preview omits it (`src/data/trackColumns.ts`, `src/data/explorerStore.ts`). A single-contrast sibling is the plain
  `{ GO_BP, HALLMARK, KEGG, REACTOME }` block; a multi-contrast sibling is
  `{ default, byContrast }`, split the same way as `de` and `deByContrast`.
- Consumers unwrap a sibling through `src/data/rawTrack.ts`, never by checking
  `'byContrast' in v` at the call site. Views use the permissive accessors. The
  cross-dataset pathway query and `scripts/build_query_index.mts` use
  `strictSiblingPathwaysFor`, which allows the default-block fallback only for the
  registered default contrast and reports how each block resolved, so the index
  can audit attributions it cannot verify.
- `pathways_index.js` is the sorted union of pathway names across every block,
  so search reaches a pathway that appears only in a non-default contrast.

Metadata:

- `meta.groupN` is required for factorial designs. The pooled `qcFlags` pair
  names different arms than a factorial default contrast does, and the browse
  views (library card, study record, query index) have no track bundle to count
  from. `defaultArmCounts` in `src/data/contrasts.ts` reads `groupN` and falls
  back to the pooled pair.

Wire size: `scripts/lib/bundleSlim.mts` rounds probabilities and effects, drops
`rankPos` (it always equals array position) and drops null `logCPM`. Builders
must write through `writeDatasetBundles` so a rebuild cannot undo that.

## Loading

`index.html` has no data script tags. The app fetches the default dataset's
`meta.js` on mount. Tracks, pathway siblings and QC load on demand through
`src/data/bundleSource.ts`, which caches by URL and deduplicates in-flight
requests.

## Adding a dataset

1. Write a builder that calls `writeDatasetBundles`. Start from
   `scripts/build_normalized_bundles.mts` (multi-contrast, factorial, `groupN`)
   or `scripts/build_explorer_bundles_batch2.mts`. Do not copy
   `scripts/migrate_macaque_bundles.mts`, which writes an older format. The
   DE-table header contract shared by builders is `scripts/lib/deTable.mts`.
2. Add the manifest entry to `DATASETS` in `src/data/datasets.ts`.
3. For a multi-level design, declare the groups and labelled contrasts and emit
   `deByContrast` for every non-default contrast.
4. For a factorial design, also list the design-cell groups in
   `meta.groupSamples` beside the pooled arms (a sample belongs to both), emit
   `meta.groupN`, mark contrasts the source study never ran as `exploratory`,
   and give each design axis a `group` label.
5. Rebuild the corpus-wide derivations, which go stale silently when the
   registry grows: `pnpm exec tsx scripts/build_query_index.mts` (`--check`
   verifies value-level closure) and `pnpm run build:nomenclature`. Then run
   `pnpm exec tsx scripts/check_datasets.mts` (add `--all-tracks` to parse every
   track). Neither `tsc` nor the test suite notices a missed rebuild.
