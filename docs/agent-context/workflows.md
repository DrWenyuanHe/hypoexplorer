# Task routes

## dataset-change

Start with the [dataset contract](../DATASET_CONTRACT.md),
[real shapes](../REAL_DATA_SHAPES.md) and [dataset map](generated/datasets.md).
Inputs are the study identity, source files, sample design, contrasts and
analysis outputs. Inspect `src/data/datasets.ts`, registered sidecars and the
appropriate builder; shared writes use `scripts/lib/bundleWriter.mts`.
Expected outputs are registry metadata, bundles and their retained evidence.
Use `pnpm exec tsx scripts/check_datasets.mts` for structural closure (`--all-tracks`
for full track coverage) and `pnpm run check:query-index` for index freshness.
Analysis runs use R 4.6.0 through the `scripts/regen-r460/` drivers and
`scripts/lib/de_common.R`, which write a session record and provenance file per
output and record the depositor's processing in
`geo_replication/config/upstream_processing.tsv` (`pnpm run check:upstream`).
Choose the intake-specific checks in package.json. Rebuild nomenclature when
the corpus changes. For the rat intake, the
[dedicated runbook](../../data/intake/oxt-avp-2026-10-19/README.md) documents
`pnpm run build:nomenclature --refresh-authority=RGD`, which refreshes rat
classifications while preserving other retained authorities. A new dataset also changes the shared quality and author
ledgers that dated verification reports pin, so run
`pnpm run check:verification-advancement`, which prebuild omits (see
[verification](#verification)). Context generation does not rebuild scientific data.

The registry's `expressionUnit` is authoritative for display: `buildPopData` and
`loadTimeSeries` prefer it to the unit stamped in a bundle, and the bundle
builders take the registry unit, so a unit relabel need not rebuild hash-pinned
bundle bytes. Changing a field of a dataset registered before the R 4.6.0 swap
needs a reviewed reason in `scripts/regen-r460/build_registry_edits.mts`
(`--write`, then `--check`). Any `src/data/datasets.ts` edit also refreshes the
fingerprints in the OXT/AVP audit (`pnpm exec tsx scripts/audit_oxt_avp_intake_r460.mts`)
and the internal QC ledger (`pnpm exec tsx scripts/build_internal_qc_r460.mts`); a unit
used by an expression-survey source needs `pnpm run build:expression-index`.
The ledger builder refuses a rebuild that loses a pass or reports more unavailable
inputs than the committed ledger. That is what happens on a checkout without the
retained audit cache. Rebuild the ledgers on the original computer instead, and pass
`--accept-downgrade` only for a reviewed scientific change.

For GSE65663 and the reviewed OXT/AVP intake, use the
[dedicated runbook](../../data/intake/oxt-avp-2026-10-19/README.md): the R4.6
producer writes isolated analyses/config, the bundle builder reads current
provenance, and `pnpm run check:oxt-avp` verifies public products and the
source/model/output audit. GSE30733 remains held and is not an admitted manifest
row. Preserve the declared pool units and deposited log-expression scale.

Expression-only sources follow the [survey runbook](../EXPRESSION_SURVEY.md)
instead of creating a contrast. GSE147092 uses
`scripts/build_oxt_reference.mts` and the
[retained source import](../../data/expression/oxt-reference/README.md).
Run `pnpm run check:expression-reference` for its source hashes, sample/feature
alignment and full-value replay. A source's descriptive cell-profile count is
not an independent-animal count; reference eligibility remains source-specific.

Reference atlases (GTEx V10, HPA 25, Allen Human Brain Atlas microarray) are
expression-only too. They use `scripts/build_gtex_reference.mts`,
`scripts/build_hpa_reference.mts` and `scripts/build_allen_human_reference.mts`,
which share `scripts/lib/externalReference.mts` and the format in
`src/expression-survey/externalReferenceFormat.ts`. Their retained sources are in
[`data/expression/gtex/`](../../data/expression/gtex/README.md) (GCT under Git
LFS), [`data/expression/hpa/`](../../data/expression/hpa/README.md) and
[`data/expression/allen-human/`](../../data/expression/allen-human/README.md)
(hypothalamic extracts of the six donor zips, expression under Git LFS). Their
products under `public/expression/{gtex,hpa,allen-human}/` are gitignored build
artifacts. Allen is probe-level: one result per probe, never collapsed.
Run `pnpm run build:expression-external` after a source or builder change, or in
a fresh checkout before a dev server. `--check` byte-compares the products. A
release update goes through `--fetch --record`, never a hand edit of the manifest.

## verification

Read the [author-verification guide](../../data/author-validation/README.md),
the [domain vocabulary](../../CONTEXT.md) and the study's retained evidence.
Inputs are source availability, reproducible inputs and the intended comparison.
Keep pipeline QC, experimental design and author concordance separate.
Inspect `src/data/datasetQualityR460.ts`, `pipelineQc.ts`,
`authorConcordanceR460.ts` and the relevant audit/builder scripts; the pinned
`datasetQuality.ts` and `authorConcordance.ts` serve sealed producers only. Use `check:author-validation`,
`check:quality` and the applicable dated intake/replay checks from package.json.
Run `pnpm run check:bundle-eol` before an audit records any SHA-256 pin: pin
writers hash the working file, and a stale copy whose line endings differ from
the committed blob yields a pin that no clean checkout reproduces.
Sealed producers run through `scripts/run_historical_check.py`, or for the
September 11 reports and scientific snapshot `scripts/run_sealed_report_check.py`.
When a sealed pin cannot be reproduced after a dataset addition or in another
checkout or shell, add a verified projection to the runner, as
[described here](../../data/internal-qc/hfd-intake-2026-09-12/HISTORICAL_COMPATIBILITY.md);
never edit the pin or the producer. Outputs replaced by the R 4.6.0
regeneration are served to sealed producers from git history through the
[supersession manifest](../../data/quality/regeneration-r460-2026-09-25/README.md);
a pinned producer that needs new behavior gets a successor file. A live cumulative report is regenerated
through its producer instead; see the
[verification-chain record](../../data/quality/verification-chain-2026-09-24/README.md).
Expected outputs are traceable evidence records and accurately qualified status;
a successful command alone does not establish scientific agreement.

Current outputs can have a separately verified successor without rewriting the
September supersession manifest. `scripts/lib/historicalEvidence.mts` checks the
bounded GSE135007 serialization and GSE157077 time-series-unit chains before
`isRecordedCurrentOutput` accepts their current bytes. Each chain retains its
predecessor and explicit verification. The current bulk entry point is
`scripts/regenerate_bulk_de_current.R`; its GSE135007 specialization requires a
staging root and fits the exact reread canonical matrix. Read the
[serialization runbook](../../data/quality/gse135007-serialization-2026-10-23/README.md)
before adopting a new product.
The current September intake audit is
`scripts/audit_september5_intake_current.mts`, checked by `pnpm run check:intake`;
its earlier audit remains a historical record.

`scripts/historical_native_runtime.py` relocates only its three allow-listed
native replay invocations after verifying code, executable and package identity;
follow the [native runtime runbook](../HISTORICAL_NATIVE_RUNTIME.md).
Run `python scripts/test_historical_native_runtime.py` for the relocation tests.
Missing source files or retrieval receipts still fail closed; the source-
relationship audit records unavailable paths explicitly instead of treating an
early unavailable reader as a verified successor chain.

The OXT/AVP intake's live evidence requires its current dedicated audit. This
checks deposited inputs, probe-to-symbol preparation, model values, group effects
and public DE/SE/pathway provenance; it does not reproduce raw-CEL normalization
or establish author-result concordance. Its `current_provenance_checked` pathway
status has no historical migration baseline. Follow the intake runbook's evidence
closure order and preserve sealed historical producers and their baseline scope.

The current QC input inventory keeps retained identity metadata separate from
current file availability. `data/internal-qc/input-availability.generated.json`
labels absent retained inputs `unavailable_not_verified`; preserving their old
expected fingerprints grants no passing check. The
[intake runbook](../../data/intake/oxt-avp-2026-10-19/README.md) records the fixed
baseline and the rules for already sealed retirements and additions. Absent
prior additions require both the previous declaration and fixed baseline
identity; new missing successor inputs are rejected. Historical
checks still require their original source files.

## ui-change

Read the [refactor checklist](../REFACTOR_CHECKLIST.md),
[code map](generated/codebase.md), [shared contracts](generated/contracts.md)
and [CONTEXT.md](../../CONTEXT.md). Inputs are the requested view/route and its
dataset, track and contrast state. Routing uses appRouter/appLinks; every explorer
move (track, Compare, tab, contrast, an open from another view) is a navigation
intent applied by src/explorer/explorerPosition.ts, which owns the tab rule and
the reset/load each move costs, so no caller sets that state directly. A view
that loads tracks outside the main explorer uses `src/data/trackColumns.ts`
(per-column loading, failed and Retry states); every download names itself and
writes its Metadata through `src/utils/exportProvenance.ts`; every gene picker is
`GenePicker` over `src/explorer/geneVocabulary.ts`; sample
values and export labels use sampleValues; bundle loading uses trackData.
Header identity uses BrandLink and the shared brand asset constants. For logo,
favicon or typography changes, read the [brand guide](../../brand/README.md);
check the app headers and prerendered public pages at desktop and mobile sizes.
Typography uses `public/fonts/typography.css` for Hanken Grotesk text and
headings (600), with Source Sans 3 as the fallback for Greek, Cyrillic and
missing symbols, and `--font-mono` (Geist Mono, then IBM Plex Mono) for figures;
inline styles use the constants in `src/styles/constants.ts`, where `FONT_MONO`
stays a literal list so exported SVG figures keep their font. Preserve explicit
monospace data labels. The standalone tracker imports the same Geist Mono, Hanken
and Source font assets and typography stylesheet.
Expected outputs are the requested behavior and relevant regression coverage.
Run the app and script TypeScript checks documented in
[project guidance](../PROJECT_GUIDANCE.md) and focused Vitest tests. Use a browser
for navigation, loading, accessibility or layout changes.

Circadian changes also follow [the numerical validation runbook](../CIRCADIAN_VALIDATION.md).
Keep effective JTK period families, unsupported-design reasons, missing-value
handling and within-gene versus gene-wise corrections explicit in the UI and
exports. A matched numerical reference does not establish biological calibration
or measured human usability.

Responsive layouts share the 900px breakpoint in `useCompactLayout` and
`src/styles/responsive.css`. `ResponsiveSidebar` keeps cell navigation and
compare-set studies in a desktop rail or a mobile dialog, using the shared Modal
for focus trapping, Escape and focus restoration. The dataset library has no
rail: `LibraryToolbar` puts a view menu, sort, active-filter chips and an
add-filter menu (with the same disjunctive facet counts) above a table-first
record grid, and its chips scroll sideways on phones. A study opens as a record
page (`StudyRecord`, `#/library/<id>`) in place of the hidden list: header
actions, a fact strip, Overview/Verification tabs and a details panel that
stacks below them under 900px; Escape and the breadcrumb return to the list. Selection and filters
remain owned by their existing views. `ResponsiveDetails` folds study
metadata and plot controls on small screens. The selected population, comparison
and Plot/Table switch remain visible. Mobile pages use document scrolling and a
minimum chart height; wide result tables scroll within their own containers.
When changing these layouts, check 320px and 390px phones, 768px tablets and a
1024px laptop, including a short landscape viewport, dialog dismissal, filtering,
cell selection and rotation across the breakpoint. Volcano taps hit-test the tap
coordinates directly, without requiring a previous hover.

The compare-set view uses a left sidebar to select studies, with no study cards above the results.
Selecting a study changes the volcano; every study remains in the comparison.
Contrast labels stay visible, while each study's Details disclosure contains
sample counts, verification evidence and its explorer link.

The hub is search-first: the logo, `HubSearch` and two cards (library and
expression survey); a top nav and the footer route to every other tool. Search
is unified: `HubSearch` and the results page share `UnifiedSearchBox`, one
combobox whose suggestions list genes and pathways in two groups, and every
submission or pick opens `SearchPage` at `#/search/<query>` (`/genes` or
`/pathways` appended for a breakdown other than the default All). Matching lives
in `src/search/searchVocabulary.ts`: symbols, authority gene names and selected
aliases from the generated `public/nomenclature/names.js`
(`pnpm run build:search-names`, built from `data/nomenclature/nomenclature.tsv`),
plus the curated common names in `searchSynonyms.ts`, so "oxytocin" resolves to
OXT; pathway ids are matched word by word against readable titles. The
names builder excludes unresolved `ambiguous` authority rows before grouping:
candidate diagnostics, aliases and dataset reach from those rows are not search
names. Valid records from other authorities can still supply names for the same
uppercase symbol; gene-index symbol search remains available.
vocabulary loads on the box's first focus, so the hub fetches no query data
until a visitor searches. A direct gene match leads the page as one featured
row, followed by "Also matching": the other genes the query matched (POMCA and
POMCB for POMC), eight under All and every one on the Genes breakdown. Every
gene row reads an index-only summary (significant datasets, tracks up and down,
the strongest change; never the per-track bundle fallback) and opens the gene
page; rows do not explain why a gene matched. The first eight rows load at once;
later rows of a long Genes list load when scrolled near. A direct pathway match
opens a portal with its enrichment summary.

The gene page (`GeneReport`) holds the gene's detail; it no longer draws a
forest plot. First, where the gene is expressed (`src/search/portalCards.tsx`): the
NeuroSeq baseline-expression card, a reserved slot for mouse single-cell atlases,
the HPA human snRNA clusters, and a wide "Human hypothalamus" card with GTEx, HPA
subregion and per-probe Allen values. Those last two read the reference-atlas
products through `loadReferenceAtlases`, each atlas in its own unit. Then "Differential expression across studies":
the tracks of the selected studies and visible categories, grouped by research
area (most significant tracks first, each area with its tally; measured areas
with none are named in one line), significant tracks only until the toggle adds
every measured one. Each area's header folds it: areas with a significant track
start open, those "Show all" adds start folded (all open when nothing is
significant), and a folded header still shows its tally and leading change. Direction is stated, never inferred: a legend says each
change is the gene in the comparison's first group relative to the second, the
first group is bold, and the change reads as a fold, "4.1× lower in Stat3 KO",
built from the contrast's `caseGroup` label (log2FC is case against baseline),
never by splitting the display label. The study cell names the population,
then the species, preparation and GEO accession from the registry; the study's
full name, which mostly restates the comparison, is its title and the Info
link's label. A bar on one shared axis shows size and sign. The change cell opens the track's expression preview, and each row
carries Info (library record), Open (explorer at that track) and the
compare-set toggle for that track. Last, the pathways enriched in the tracks where the gene is significant,
under the same scope, and a reserved co-expression slot. The study filters sit
inside the differential-expression card, above the table they narrow, and stay
there while it loads or when the selection is empty. The header keeps Compare
as bars and Share analysis. The condition-pathways card (`loadConditionPathways` in
`src/search/searchSummaries.ts`) follows at most 12 significant tracks and reads
one `trackpaths/t<NNN>.js` file per track from the query index's track-pathways
family (rows copied from the pathway shards at padj < 0.05, checked by
`build_query_index.mts --check`); a manifest without that family, or one that
fails the freshness check for those studies, keeps the reserved slot. The card
draws a matrix: one column per followed condition, grouped by the gene's
direction there and headed by the comparison's first group and the gene's
log2FC; one row per pathway; a cell filled with its NES (red above 0, blue
below) where it is enriched, and conditions without a pathway analysis kept as
marked columns. The ranking explanation sits behind "How is this ranked?". Each row
also carries the pathway's corpus base rate (tracks significant, tracks tested),
and `src/search/pathwaySpecificity.ts` ranks pathways by the hypergeometric tail
of their recurrence among the followed tracks given that rate, so ubiquitous
sets such as ribosome do not lead; raw recurrence is the tie-break and stays in
the table. This tail is a display ranking aid, not a calibrated biological
significance test across independent samples. The base rate is on the rows,
not in `tracks.js`, to keep the
manifest small; `--check` compares the rows, counts included, exactly. Full
reports stay one click away. The nav's Genes and Pathways open
`ExplorerSearchDialog` over the hub on that side, where study filters live.
Genes and Pathways tabs inside the dialog switch between the two
searches and update the route; empty `#/gene` and `#/pathway` links open the
dialog on that side. Each side mounts when first shown and stays mounted, hidden,
until the dialog closes, so typed terms and category picks survive a switch. The
shared Modal focuses the search input and handles focus trapping, Close, Escape,
backdrop dismissal and focus restoration. Only a submitted, nonempty search opens
the full results view, carrying the selected study filters.

Study selection is coordinated by `useStudySelection` in
`src/crossdataset/geneStudyScope.tsx`. GeneReport, PathwayReport and
CrossDatasetCompare use it for catalog readiness, eligibility, selected studies
and query identity. The router retains persistent gene/pathway selection state;
`useReportQuery` retains request loading and cancellation. The selection module
also coordinates resets through the existing state owners: gene/pathway reset
categories, evidence/sample filters and individual selection; bars reset only
their category display restriction.

A sample-count filter waits for the catalog request to settle, including
registry-only fallback, then excludes unknown counts. Without that filter,
queries may start from registry cards. Gene/pathway categories narrow the
requested studies; bars categories narrow the already resolved cohort locally
without changing query identity. Pathway selection always excludes studies
without pathway support. Preserve incoming term spelling in gene/pathway
queries and uppercase it for bars. Lifecycle tests live in
`src/__tests__/studySelection.test.tsx`; the App scope tests retain copied-link,
remount and cross-view verification.

Gene and Pathway Explorer's suggested-search cards select study categories without
supplying or submitting a search term. Categories combine as a union; sample-size and quality
filters narrow that union, followed by the expandable individual-study selection.
No filters means all applicable datasets; Pathway Explorer includes only studies
with pathway results. All datasets resets every filter, while an explicit
empty individual selection remains empty. App retains the sample-size, quality
and individual-study filters independently for each explorer through report
remounts. Gene categories follow the existing gene route; pathway categories stay
in App state. Query identity includes the selected dataset IDs so the
loader requests the selected corpus.

Larger groups requires at least five measured samples in each arm of the default
population and comparison, using the same catalog as the dataset library. Unknown
counts are excluded; counts may differ in other populations, and sample size is
not a statistical-power assessment. Pipeline QC, Experimental design and Author
concordance are independent optional filters. Each selected filter requires an
explicit pass in that domain; an unselected domain does not restrict the search.
A missing, not-assessed or not-applicable status does not qualify as a pass.

Gene and pathway search results keep the shared header and compare-set cart above an independently
scrolling results pane. Study filters collapse after search. Result rows show the
study, comparison and statistics; More information opens the existing library
record for sources and verification, Open enters the dataset explorer, and Compare
toggles the study's default population in the shared set (on the gene page, the
row's own population). Pathway Open links select
the dataset's Pathway tab; population links retain the row's population.
Both reports share forestReport.css and the EffectPreview interaction shell.
For gene results, hover, keyboard focus or tap on a row's log2FC opens the
existing expression bar chart for that exact
population and contrast. Previews load on demand through the explorer store with QC
and pathway requests disabled, and report unavailable sample values without drawing
zero bars. The store's pathway policy is fixed for each mounted consumer; full
explorers retain the default include policy.

Pathway score previews use the existing RunningScorePlot and retain its leading-edge
approximation label. They reuse useCompareSetColumns for on-demand population loading
and pathway-sibling settlement, then read popDataFor with the report's exact contrast
and match the pathway database and name. Missing pathway data or usable ranks remain
unavailable, with a retry action; no QC bundle is requested. Large studies initially
show significant populations, with the full list available on request. About enrichment
scores keeps the ranking explanation in a disclosure beneath the results.

## local-import

Read [local datasets](../LOCAL_DATASETS.md). Inputs are user-owned DE/pathway
tables and explicit column mappings. Inspect the importer, local storage and
matching tests under `src/local-datasets` and `src/__tests__`.
Verify preview/mapping errors, persisted data, comparison identity and exports.
Local results stay on the user's device and are not added to the public registry.

## delivery

Read the [delivery runbook](delivery.md). Inputs are the intended source revision,
build configuration, matching scientific bundles and deployment authorization.
Inspect package scripts, Vite configuration, worker configuration and verify
scripts. Expected outputs are a validated build and, when explicitly requested,
a verified deployment. Retrieve current deployment and edge rule state during the
task; generated context contains no live operational state.
