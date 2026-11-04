# Expression survey

The `#/expression` view surveys per-sample expression in hypothalamic populations,
broader neuronal preparations and tissue, alongside GTEx, Human Protein Atlas and
Allen Human Brain Atlas reference atlases. It is reachable from **Expression survey**
on the home page. Its four sections are Gene survey, Population catalog, Tissue &
bulk, and Sources & validation.

The page uses a centered, bounded workspace with search and source filters in one
panel. The population picker starts collapsed; export and result-display controls
appear after a submitted survey. Interpretation notes remain available in a
disclosure below the results. Gene input starts empty, with no preset-gene buttons.

Opening the view loads the source catalog only. The Survey button or Enter in the
gene input starts expression-value requests. Up to four sources load concurrently; changing
the query or leaving a survey cancels its queued work. Shared requests already in
flight finish normally so later queries can reuse their cached values.

## Scope and interpretation

Population identity groups related preparations for discovery. Each source and
experimental group retains its own measurement scale and sample values. The module
does not calculate a cross-study mean or treat expression as differential expression.
TRAP/RiboTag measures ribosome-associated RNA; manually sorted total RNA, bulk tissue,
and single-cell/nucleus pseudobulk remain distinct preparations even when all use CPM.

All reported states are available. The eligible reference filter is curated per
source and excludes explicit interventions. A control is a reference for its own
experiment, not a universal healthy adult baseline. Unknown feeding state remains
unknown; the NeuroSeq filter retains only the 13 libraries explicitly labeled fed.
Sample counts describe expression profiles, not necessarily independent animals.
Developmental ages, pools and litter pseudobulks retain their study qualifications.

## OXT single-cell reference

The **OXT cell reference** collection adds the deposited GSE147092 CENSUS matrix
as expression-only data: 125 magnocellular and 21 parvocellular OXT cells. Cell
annotations identify P25 PVN samples (GEO describes P23; both source claims are
disclosed) and three animal/pool labels (`M3`, `M4`,
`M1-5`). These are 146 cell profiles, not 146 independent animals. Original
animal/pool labels, plate and fluorogold labeling are retained in the sample
manifest and metadata export. Feeding state is unreported, so these cells are
excluded by the eligible reference filter.

Values retain the authors' estimated mRNA molecules per cell, with no conversion
to TPM or synthetic differential-expression contrast. Source gene IDs remain
separate when symbols collide. The importer and its offline full-value check are
`scripts/build_oxt_reference.mts`; source evidence lives under
`data/expression/oxt-reference/`, and release-local products under
`public/expression/oxt-reference/`. Run `pnpm run check:expression-reference`
after changing these sources or the importer. The dedicated reader validates
source/sample alignment and fetches only the requested gene shards. JSON exports
include the original cell metadata alongside the measured values.

Means are arithmetic means of finite stored values, including measured zeroes.
For a log-transformed source, this is a mean on that stored log scale. Missing genes,
ambiguous symbols and missing measurements are never replaced with zero. Search
matches supported stable feature IDs and source symbols. NeuroSeq prefers an exact
symbol spelling before a case-insensitive fallback. Ambiguous matches require an
unambiguous ID and are never silently merged; placeholder IDs fall back to portal IDs.

## Reference atlases (GTEx, HPA, Allen)

The `external` collection holds public reference atlases imported from retained,
hash-pinned releases. They are never fetched from the providers at runtime. The
[implementation plan](EXTERNAL_REFERENCE_EXPRESSION_PLAN_2026-10-29.md) records why,
along with the Phase 0 measurements and the decisions behind this design.

| Source | Survey placement | Values |
| --- | --- | --- |
| GTEx V10 Brain - Hypothalamus | Tissue & bulk (whole hypothalamus; reference atlases) | 257 postmortem donors, per-sample TPM |
| HPA human hypothalamic subregions | Tissue & bulk (reference atlases) | 8 subregions, one published nTPM each |
| HPA human hypothalamus snRNA clusters | Population survey, "Reference atlases (HPA)" | 26 clusters, one published nCPM each |
| HPA mouse and pig hypothalamus | Tissue & bulk (whole hypothalamus; reference atlases) | 4 animals each, per-animal nTPM |
| Allen Human Brain Atlas hypothalamus microarray | Tissue & bulk (reference atlases) | 102 tissue samples from 6 donors, per-sample log2 intensity, one row per probe |

The Allen source is probe-level (`featureLevel: 'probe'`). A gene query returns one
result per probe, each carrying `probe`, and several probes of one gene are not an
ambiguity. Panels, the matrix and exports name the probe. Its groups are donors,
so n counts tissue samples within one donor. Its log2 values may be negative, which
the reader accepts only for a source whose unit is on a log scale.

Summary sources (`valueKind: 'summary'`) carry the provider's value in the group
result's `summary` field, with no samples, a null mean and n = 0. Panels show it as
"Published value" with "—" for n, and exports label it `published-summary`. Nothing
is averaged from summaries. Per-sample sources behave like every other source.

Gene lookup uses the survey's existing rule. Stable IDs match first, then the exact
symbol, then a case-insensitive symbol. A rodent symbol such as `Pomc` therefore
matches human `POMC`. Each panel then names the matched gene, its ID and the
species. Ambiguous symbols, such as GTEx's `_PAR_Y` copies, are reported and never
merged. Every provider and source credits its release, licence and required
attribution. No reference-atlas group is eligible for the fed / reference filter.

Each provider writes one directory under `public/expression/{gtex,hpa,allen-human}/`
in the format of `src/expression-survey/externalReferenceFormat.ts`: a manifest,
1,024 key-sharded lookup files and feature-sharded value files. GTEx and Allen have
2,048 value files each and HPA 1,024. One gene costs one lookup request per provider
and one value request per feature (one per Allen probe), about 10–20 KB compressed.
These directories are gitignored build artifacts (about 230 MB in 8,200 files).
`pnpm run build:expression-external` regenerates them from `data/expression/gtex/`,
`data/expression/hpa/` and `data/expression/allen-human/`; `prebuild` and the CI
artifact step run it. A missing or inconsistent provider is reported on the page,
and other sources keep working. The builders verify each retained hash, replay every
emitted value against its source, and check each provider's API against retained
checkpoints. See the [GTEx runbook](../data/expression/gtex/README.md), the
[HPA runbook](../data/expression/hpa/README.md) and the
[Allen runbook](../data/expression/allen-human/README.md).

### On the gene page

The gene page's "Where <gene> is expressed" section (`GeneExpressionCards` in
`src/search/portalCards.tsx`) reads the same products through
`loadReferenceAtlases` in `src/search/searchSummaries.ts`. It is one card with a
mouse column and a human column, then one link to this survey. The mouse column
holds the NeuroSeq populations and the reserved mouse single-cell slot. The human
column, "Human hypothalamus", holds four sources:

- GTEx: the median TPM and interquartile range across its 257 donors.
- Allen: one row per probe, with the median and range of the six donor means in
  log2, never of the pooled tissue samples.
- HPA subregions: the top four by published nTPM.
- HPA snRNA-seq clusters: the top five by published nCPM.

Each atlas keeps its own unit, its bars are scaled to its own highest value, and
published values are printed as published. When the page's symbol differs from the
human gene's (`Pomc` → `POMC`), the column names the match. A provider that cannot
be read marks only its own source.

## NeuroSeq source

- [Live gene TPM viewer](https://neuroseq.janelia.org/heatmap/d/gene_tpm).
- [Sugino et al., eLife 2019](https://elifesciences.org/articles/38619).
- [Sample metadata supplement](https://cdn.elifesciences.org/articles/38619/elife-38619-supp2-v2.xlsx).
- [GSE79238](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE79238).

The live viewer identifies its measurement as gene-level TPM from HTSeq counts,
Gencode.vM4. Its public API supplies values at two decimal places. Those processed
TPM values are imported directly, not reconstructed from the deposited raw counts.
The dedicated expression manifest is independent of the differential-expression
dataset registry: no artificial contrast is added for the atlas.

The HY catalog contains **15 display populations, 17 original source groups and 54
libraries**. SFO contributes two display populations and three libraries. These
source-defined boundary records stay in the catalog but are excluded by default
from the hypothalamus-proper survey (13 populations, 51 libraries).

Original display labels, internal source groups, sample labels, age, sex, cell counts,
GEO crosswalks and feeding evidence are retained in the manifest and source catalog.
NPY reporter samples retain that identity even when grouped with AgRP studies.
Metadata supports ten candidate shared fed libraries with Henry GSE68177; this is
not independent replication. Matching raw-read fingerprints remains a separate
question. Henry's originally deposited TPM and NeuroSeq processing also differ;
their numerical values must not be substituted for one another.

## Existing datasets

`src/expression-survey/existingCatalog.ts` curates 32 expression source records from
30 registered tracks. `existingExpression.ts` reads a dedicated lossless gene index.
The app pins its immutable manifest and fetches only the requested gene buckets;
selected sources share those requests. It never uses differential-expression logCPM
or fold changes as sample expression. `existingExpressionValues.ts` retains the
original full-track adapter as the offline numerical reference.
POMC/Drd2 arms and PNOC immunoprecipitated/input RNA have separate source identities.
The Henry GSE68177 sources are labeled manual fluorescent neuron sorting, correcting
the expression view's description without changing historical DE evidence records.
The GSE65663 SON source retains deposited median-baselined log2 RMA values from
five independent five-rat RNA pools per arm; it represents bulk tissue.

## Data delivery and validation

The existing-source index lives under `public/query/expression/<buildId>/` and uses
the configured R2 data origin in production. Its 512 shards retain exact sample
values and original identifiers, including nondefault tracks. App builds pin the
SHA-256 build ID, so they do not need to fetch a mutable discovery pointer at runtime.
Both immutable URLs and JavaScript globals include that identity; app releases do
not add cache-busting query strings to immutable expression objects. A missing or
inconsistent index fails visibly instead of downloading full tracks. Transport
failures are retryable; inconsistent data requires a corrected app/data publication.

Run `pnpm run build:expression-index` after source or catalog changes, then
`pnpm run check:expression-index`. The check compares every indexed source query to
the original adapter, independently aligns raw sample columns and verifies every
generated product. See [the lossless-index runbook](../data/expression/existing/README.md)
and [retained validation](../data/expression/existing/validation.json).

`public/expression/neuroseq/` ships same-origin, with a manifest, gene index, small
gene shards and validation report. It does not use the separate DE bundle origin.
Fetches are lazy, cached for the session, release-versioned and retryable after
failure. Source files and acquisition/build checks live under
`data/expression/neuroseq/` and the dedicated NeuroSeq builder in `scripts/`.

Run `python scripts/build_neuroseq_expression.py --check` for an offline source-byte
and full-matrix fidelity check. The default builder regenerates products from the
retained archive; `--fetch` explicitly refreshes the public source. See
[the acquisition runbook](../data/expression/neuroseq/README.md) for the original
response archive, hashes and catalog metadata. The source catalog retains original
CRLF bytes through an explicit `.gitattributes` rule.

Numerical fidelity compares every imported value to the retained public API response.
Independent browser checkpoints are Lepr 27.94 TPM in POMC sample 383, Agrp 3034.68
TPM in NPY sample 100 and Pomc 22795.34 TPM in POMC sample 383. Agreement at the
portal's published precision verifies this import; it does not validate the original
biological experiment or establish agreement with unrelated normalization pipelines.

Validation after a change includes the NeuroSeq builder's check mode, expression
adapter and route tests, both TypeScript projects, and browser tests of search,
population/condition filters, missing genes, exports and desktop/mobile layouts.
When revising the catalog, inspect the underlying sample groups and stored units.
Update this document and maintained context alongside source changes.

See [the original loading audit](DATA_LOADING_AUDIT_2026-09-15.md) and
[implemented loading changes](DATA_LOADING_IMPLEMENTATION_2026-09-15.md) for measured
request footprints, upload behavior and cache limits.

## Implementation verification — 2026-09-15

- NeuroSeq offline replay: 1,909,332 exact values, 3/3 browser checkpoints and
  6/6 values from a separate API query. Original values are published to two decimals.
- Focused app checks: 64 tests passed across expression adapters, UI, routes and the
  home tool index. The existing-source tests read every one of the 29 local tracks.
- App and script TypeScript projects passed. Focused Biome lint and a Vite production
  build passed. The Vite command checks compilation; it does not substitute for the
  broader scientific prebuild checks or a deployment check.
- Browser checks covered the home entry, NeuroSeq sample details, four-source AgRP
  comparisons, reference filtering, multigene matrices, missing genes, bulk and ARC
  tissue, the complete catalog and SFO subset, and numerical validation. A real JSON
  download contained 39 measurements for three genes across 13 eligible libraries,
  with 13 matching metadata records and no unreported feeding states. At 390 px,
  gene and validation views fit the page; data tables scroll within their panels.
- The full suite initially reported 167 passing files and six failing files. Its
  home-row-count assertion was updated for the new tool and passed in the focused
  rerun. Five historical evidence suites remain blocked by missing ignored source
  archives and pre-existing LF/CRLF fingerprint mismatches, including
  `scripts/de_gse135639.R`. The relevant tracked sources match HEAD. Three small
  missing GEO caches were restored with their recorded byte counts and SHA-256;
  historical evidence, scripts and review ledgers were not changed.

This implementation was tested locally and has not been deployed.
