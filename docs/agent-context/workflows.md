# Task routes

## dataset-change

Start with the [dataset contract](../DATASET_CONTRACT.md),
[real shapes](../REAL_DATA_SHAPES.md) and [dataset map](generated/datasets.md).
Inputs are the study identity, source files, sample design, contrasts and
analysis outputs. Inspect `src/data/datasets.ts`, registered sidecars and the
appropriate builder; shared writes use `scripts/lib/bundleWriter.mts` and script
reads use `scripts/lib/bundleReader.mts` (`readJsonp` for published bytes,
`listDiskCorpus` to sweep `public/datasets`, `readDatasetFromDisk` for what the
explorer shows). A directory the registry does not name is reported, never read.
A builder passes every track of a study to one `writeDatasetBundles` call, which
writes the merged study files and derives QC counts (nSig is FDR<0.05). Sidecar
intakes build through `buildIntakeStudies` in `scripts/lib/intakeStudies.mts`
(staged publish, `--check`, `--only`), as the September 5 builder does.
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
ledgers that dated verification reports pin. Those pins are replayed in the
maintainer's checkout (its `check:verification-advancement`), which this
repository does not carry; record the replay as pending in a GitHub issue (see
[verification](#verification)). Context generation does not rebuild scientific data.

The registry's `expressionUnit` is authoritative for display: `buildPopData`,
`loadTimeSeries` and the agent export (through `resolveExpressionUnit`) prefer it to the unit stamped in a bundle, and the bundle
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

Expression-only sources follow the [survey runbook](../runbooks/EXPRESSION_SURVEY.md)
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
Run `pnpm run build:expression-external` after a source or builder change; it
needs the retained source downloads, which this repository does not carry. A
fresh checkout takes the deployed products with `pnpm run fetch:expression`, and
`pnpm run prepare:deploy` fetches any atlas a deploy would otherwise drop.
`--check` byte-compares the products. A
release update goes through `--fetch --record`, never a hand edit of the manifest.

## verification

Read the [author-verification guide](../../data/author-validation/README.md),
the [domain vocabulary](../../CONTEXT.md) and the study's retained evidence.
Inputs are source availability, reproducible inputs and the intended comparison.
Keep pipeline QC, experimental design and author concordance separate.
Inspect `src/data/datasetQualityR460.ts`, `pipelineQc.ts`,
`authorConcordanceR460.ts` and the relevant audit/builder scripts; the pinned
`datasetQuality.ts` and `authorConcordance.ts` serve sealed producers only. Use `check:author-validation` and the applicable dated intake/replay checks from
package.json; they need retained inputs that `pnpm run fetch:data` restores only
in part. The maintainer's checkout also runs `check:quality`, which is not here;
`pnpm exec tsx scripts/build_quality_report_r460.mts --check` checks the quality
report's freshness, given the same restored inputs.
Run `pnpm run check:bundle-eol` before an audit records any SHA-256 pin: pin
writers hash the working file, and a stale copy whose line endings differ from
the committed blob yields a pin that no clean checkout reproduces.
Sealed producers run through `scripts/run_historical_check.py` (in the
maintainer's repository, not here), or for the September 11 reports and
scientific snapshot `scripts/run_sealed_report_check.py`.
When a sealed pin cannot be reproduced after a dataset addition or in another
checkout or shell, add a verified projection to the runner, as
`data/internal-qc/hfd-intake-2026-09-12/HISTORICAL_COMPATIBILITY.md` describes
(restored by `pnpm run fetch:data`, not tracked); never edit the pin or the producer. Outputs replaced by the R 4.6.0
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
staging root and fits the exact reread canonical matrix. Read the maintainer's serialization runbook
(`data/quality/gse135007-serialization-2026-10-23/README.md`, which neither this
repository nor the public data release carries) before adopting a new product.
The current September intake audit is
`scripts/audit_september5_intake_current.mts`, checked by `pnpm run check:intake`;
its earlier audit remains a historical record.

`scripts/historical_native_runtime.py` relocates only its three allow-listed
native replay invocations after verifying code, executable and package identity;
follow the [native runtime runbook](../runbooks/HISTORICAL_NATIVE_RUNTIME.md). It and its
tests (`scripts/test_historical_native_runtime.py`) are in the maintainer's
repository, not here.
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

Read the [refactor checklist](../runbooks/REFACTOR_CHECKLIST.md),
[code map](generated/codebase.md), [shared contracts](generated/contracts.md)
and [CONTEXT.md](../../CONTEXT.md). Inputs are the requested view/route and its
dataset, track and contrast state. Routing uses appRouter/appLinks, and what a
route means (registry checks, refusals, the default track, the page it opens) is
decided once in `src/routeLanding.ts` for boot and every later URL. The router
runs one navigation attempt at a time with its own history write policy, so a
new shell control that moves the explorer calls the router's `supersede()`
before `navigate`, and a value a view reports back starts an attempt only when
it actually changes; every explorer
move (track, Compare, tab, contrast, an open from another view) is a navigation
intent applied by src/explorer/explorerPosition.ts, which owns the tab rule and
the reset/load each move costs, so no caller sets that state directly. A view
that loads tracks outside the main explorer uses `src/data/trackColumns.ts`
(per-column loading, failed and Retry states); every download names itself and
writes its Metadata through `src/utils/exportProvenance.ts`; every CSV is written
by `src/utils/csv.ts` (escaping, formula guard, BOM/CRLF, per-row provenance for
long tables, and a metadata JSON split down its column under Excel's cell limit);
multi-file downloads are stored ZIPs from `src/utils/zip.ts`; every gene picker is
`GenePicker` over `src/explorer/geneVocabulary.ts`; a table that lists tracks by
significance reads each row's `tier` (set once by `geneRow` / `pathwayRow` from
`src/statistics/policy.ts`), takes what leads, the order and the counts from
`listCrossStudy` in `src/statistics/crossStudyListing.ts`, its mode words and nominal caveat from `src/statistics/listingWords.ts` and any direction-coloured text from `directionTextColor` in `src/statistics/direction.ts`, for the mode
`listingModeStore` holds (with its `ListingModeToggle`), and decides only how
much to show and what starts folded; it labels rows with
`src/statistics/TierLabel.tsx`, explains q / FDR / padj columns with `QTerm`,
and keeps counts on the FDR call in both modes; sample
values and export labels use sampleValues; what a Compare column says about a
gene (unavailable, not detected or measured, with per-arm n / mean / SEM) comes
from `src/compare/compareCell.ts`; bundle loading uses trackData.
Header identity uses BrandLink and the shared brand asset constants. For logo,
favicon or typography changes, read the [brand guide](../../brand/README.md);
check the app headers and prerendered public pages at desktop and mobile sizes.
Typography uses `public/fonts/typography.css` for Hanken Grotesk text and
headings (600), with Source Sans 3 as the fallback for Greek, Cyrillic and
missing symbols, and `--font-mono` (Geist Mono, then IBM Plex Mono) for figures;
inline styles use the constants in `src/styles/constants.ts`, where `FONT_MONO`
stays a literal list so exported SVG figures keep their font. Preserve explicit
monospace data labels.
App renders every view except the landing hub through `src/appViews.tsx`:
each page, explorer tab, the dataset info modal and the study-details
verification body is a `lazyView` (`src/common/lazyView.tsx`) in its own chunk,
with its own Suspense fallback. A new view joins that list rather than being
imported into App, or the hub's first paint pays for it again. App warms the
likely next chunk on idle (the results page from the hub, the reports from the
results page). A test that renders App awaits `preloadAppViews()` in a
`beforeAll`, so its synchronous queries still find the view. A module the hub
or the results page imports must not reach the evidence ledgers
(`internalQc.ts`, `authorValidation.ts`) statically; `csv.ts` takes its
provenance columns from `exportProvenanceFormat.ts` for that reason. Export
provenance reads the internal QC ledger through `exportEvidence()` in
`src/utils/lazyExport.ts`, which loads it on the first export and throws if it
is not loaded. Run every new export entry point inside `withExportEvidence()`
(it runs synchronously once the ledger is loaded), and load it with
`loadExportEvidence()` in a test that calls an export builder directly.
Expected outputs are the requested behavior and relevant regression coverage.
Run the app and script TypeScript checks documented in
[project guidance](../PROJECT_GUIDANCE.md) and focused Vitest tests. Use a browser
for navigation, loading, accessibility or layout changes. The built-site browser
smoke (`scripts/smoke/`, `pnpm run test:smoke`) opens every view and explorer tab on
a desktop and a phone and fails on page errors, failed requests or sideways
overflow. A new view or tab needs an entry in `scripts/smoke/viewLinks.ts` and a
ready check in `views.smoke.spec.ts`; `smokeViewLinks.test.ts` fails without the
link. A renamed label or heading those specs query is changed there too.

Circadian changes also follow [the numerical validation runbook](../runbooks/CIRCADIAN_VALIDATION.md).
Keep effective JTK period families, unsupported-design reasons, missing-value
handling and within-gene versus gene-wise corrections explicit in the UI and
exports. A matched numerical reference does not establish biological calibration
or measured human usability. `CircadianTab.tsx` owns state, the per-arm scan
queue (`scan.ts`, every arm scanned, the selected arm first) and selection;
controls, notes, the results table and the per-arm statistics strip are their
own components. Any display, plot, sort or announcement of a peak time uses
`hasEstimablePeak` in `src/circadian/peak.ts`; p, q, period and amplitude keep
their own field rules. Statements about attainable p-values (the Lomb–Scargle
floor) appear only when the code can verify them for every scored sampling
pattern. Raw-value exports cover every listed gene; the workbook is built and
serialised in `circadianWorkbook.worker.ts` (ES-module worker, `worker.format`
in vite.config.ts), with the same builder as an in-thread fallback.

HypoMap views in `src/search/hypomap/` sit behind two build flags that stay off in
hosted builds: `VITE_HYPOMAP_EXPRESSION` adds the atlas preview under the gene
report's expression lanes, and `VITE_HYPOMAP_COEXPRESSION` replaces the
co-expression placeholder. The preview reads the export pinned in
`hypomap-release.json` (installed by `pnpm run fetch:hypomap`); co-expression needs
the loopback service in `services/hypomap/`, reached only through the offline dev
server's proxy and only via the client `src/search/hypomap/codetection.ts`, which
fails closed when the service's export hash disagrees with the pin and keeps
unsupported datasets visible; `services/hypomap/codetection_wire.json` pins the
wire for both the Python and vitest tests. Hosted builds read the atlas from R2 under `/hypomap/<tag>/`.
`src/data/dataOriginLayout.ts` defines the atlas file shape for the data host's
path rule and the uploader; `scripts/lib/hypomapAtlas.mts` verifies an installed
release before `upload:bundles --hypomap-only` publishes it. The path rule names the
pinned tag, so a tag change regenerates the Cloudflare payloads. The manual rule,
CORS and upload steps are in [delivery](delivery.md#hypomap-atlas); until they are
done, the flags stay off in hosted builds.

Responsive layouts share the 900px breakpoint in `useCompactLayout` and
`src/styles/responsive.css`. `ResponsiveSidebar` keeps cell navigation and
compare-set studies in a desktop rail or a mobile dialog, using the shared Modal
for focus trapping, Escape and focus restoration. The dataset library has no
rail: `LibraryToolbar` puts a view menu, sort, active-filter chips and an
add-filter menu (with the same disjunctive facet counts) above a table-first
record grid, and its chips scroll sideways on phones, where (600px and under)
the library starts on cards instead. A study opens as a record
page (`StudyRecord`, `#/library/<id>`) in place of the hidden list: header
actions, a fact strip, Overview/Verification tabs and a details panel that
stacks below them under 900px; Escape and the breadcrumb return to the list. Selection and filters
remain owned by their existing views. The explorer shows the study as one
compact line (name, organism, modality, arm pills and any exploratory-contrast
warning) at every width; with more than one dataset registered the name is the
button that opens the library at that study. Region, preparation and the dataset
verification record sit behind its "Study details & verification" toggle. The
volcano toolbar is one row at rest (search and Gene list ▾, view, statistic,
a thresholds summary that opens the cutoff inputs, and an "N pass ▾" menu;
`src/common/ToolbarPopover.tsx`); its counts and key are the plot's top line,
and the view buttons appear beside the selection count. Nothing is folded on
phones: the row wraps to two lines. Compare's link carries its view
(`/compare[/pathways]?pops=…&genes=…`, parsed in `src/utils/appLinks.ts`), so a
refresh, Back or a copied link reopens the same comparison; its summary table
reads down, one row per gene × population. Compare keeps its population chips to one line
("+N more" expands them), scrolls as one column under 900px or 700px tall, and
offers long-format data (Excel with Compare, Values and Metadata sheets: one row
per gene × population and one per animal; matching CSVs) and charts (one stitched
PNG, or a ZIP of per-chart PNG or SVG drawn from each chart's own SVG through
`src/compare/compareFigureExport.ts`) from one Download menu. The selected population, comparison
and Plot/Table switch remain visible. Mobile pages use document scrolling and a
minimum chart height; wide result tables scroll within their own containers,
except the gene page's differential-expression table and the pathway page's
forest rows, which restack each track under 640px so the change, q/FDR and
actions stay on screen. On phones the hub nav stays one line that scrolls
sideways beside the compare pill, and the explorer's header controls form an
even 3 × 2 grid. The explorer header has no breadcrumb: the logo and the
header utilities (`src/common/headerControl.css`, 28px on desktop) share one
row at desktop widths. A scroller that holds absolutely positioned screen-reader
labels (`.portal-table-wrap`) is itself positioned, or the labels escape it and
widen the page. When changing these layouts, check 320px and 390px phones,
768px tablets and a 1024px laptop, including a short landscape viewport, dialog
dismissal, filtering, cell selection and rotation across the breakpoint. On a
phone, also confirm `window.innerWidth` equals the device width after load: a
mobile browser widens the layout viewport (zooming the page out) to fit any
overflow, even with `overflow-x: hidden` on the body. Volcano taps hit-test the
tap coordinates directly, without requiring a previous hover.

The compare-set view uses a left sidebar to select studies, with no study cards above the results.
Selecting a study changes the volcano; every study remains in the comparison.
Contrast labels stay visible, while each study's Details disclosure contains
sample counts, verification evidence and its explorer link.

The hub is search-first: the logo, `HubSearch` and one list of entry rows
(library, expression survey and, when the atlas study is registered, the macaque
atlas with its own Compare button); a top nav and the footer route to every
other tool. Search
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
vocabulary loads when a pointer first reaches the box or it is first focused, so
the hub fetches no query data until a visitor reaches for the search. The box's
suggestions follow `subscribeSearchVocabulary`: named genes show as soon as the
same-origin `names.js` lands, and the data origin's symbol and pathway indexes
fold in when they arrive. The results page waits for the full vocabulary
(`loadSearchVocabulary`), so its counts never shift under the reader.
The same builder
writes `public/nomenclature/renames.js`, the rename groups (`src/data/symbolRenames.ts`,
CONTEXT.md): members of a group are always each other's search aliases, a
retired placeholder member gets its own row, and an alias its own authority
uses as another stored gene's current symbol is dropped. The gene report and
search summaries read a study under another member of the queried symbol's
group in that study's authority (`queryGeneViaIndex` and the full-download
path in `src/data/crossDataset.ts`, one row per track by `pickStoredMember`),
mark such rows `storedAs`, and the gene page names those studies above the
table and tags each row; the expression preview looks the row up under its
stored symbol. Compare and the compare set pass the table to `compareCell`.
A direct gene match leads the page as one featured
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
there while it loads or when the selection is empty. The header keeps Share
analysis and the compare-set button. The condition-pathways card (`loadConditionPathways` in
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
reports stay one click away. The hub's search box is its only gene and pathway
search; the hub nav has no separate Genes or Pathways entrance. A report always
names its term (`#/gene/<symbol>`, `#/pathway/<id>`) and carries its study
filters in a collapsed Study filters section. The term-less `#/gene`,
`#/gene/in/<cats>` and `#/pathway` landings are retired:
`isRetiredSearchLanding` in `src/utils/appLinks.ts` sends them, with or without
a saved `?analysis=`, to the empty results page (`#/search`), and the router
replaces such a history entry rather than stacking it.

Study selection is one module, `src/crossdataset/studySelection.ts`,
parameterized by report kind. Its value (`{ categories, datasetIds, filters }`)
is stored by the router, one per report kind, and App passes it with the
router's setter straight to GeneReport or PathwayReport. `useStudySelection`
derives catalog readiness, eligibility, the selected studies, the typed query
(`{ term, datasets }`), the visible result groups and the reset;
`useReportQuery` keeps request loading and cancellation. Both reports render
`StudySelectionPanel` and key their error boundary on the term alone.
`selectionFromLink` / `selectionLink` are the selection's URL form, used by
boot, Back/Forward and the URL writer alike. The value and its URL form live in
`src/crossdataset/studySelectionLink.ts` because the router is in the entry
bundle: it must not import `studySelection.ts`, whose catalog and quality
imports pull in both evidence ledgers. `src/__tests__/lazyChunkBoundaries.test.ts`
fails if the entry graph reaches either ledger.

A sample-count filter waits for the catalog request to settle, including
registry-only fallback, then excludes unknown counts. Without that filter,
queries may start from registry cards. Gene/pathway categories narrow the
requested studies. Pathway selection always excludes studies
without pathway support. Preserve incoming term spelling in gene/pathway
queries and uppercase it for bars. Selection rules, parameterized by report
kind, and the link form are tested at the module's interface in
`src/__tests__/studySelection.test.tsx`; the App scope tests keep one copied-link
smoke per report and the check that a category toggle does not remount a report.

Gene and Pathway Explorer's suggested-search cards select study categories without
supplying or submitting a search term. Categories combine as a union; sample-size and quality
filters narrow that union, followed by the expandable individual-study selection.
No filters means all applicable datasets; Pathway Explorer includes only studies
with pathway results. All datasets resets every filter, while an explicit
empty individual selection remains empty. The router retains each report's whole
selection independently through report remounts. Gene categories are also the
gene route's path scope; pathway categories travel in the analysis snapshot.
Query identity includes the selected dataset IDs so the loader requests the
selected corpus.

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
population and contrast. Previews load on demand through the track-column module
(`useTrackColumn` in `src/data/trackColumns.ts`) with pathways omitted and the
report's own track id trusted, so neither meta.js nor QC is requested; unavailable
sample values are reported without drawing zero bars.

Pathway score previews use the existing RunningScorePlot and retain its leading-edge
approximation label. They load through `useTrackColumn` with pathways included,
wait for the pathway sibling to settle, then read popData at the report's exact
contrast and match the pathway database and name. Missing pathway data or usable ranks remain
unavailable, with a retry action; no QC bundle is requested. Large studies initially
show significant populations, with the full list available on request. About enrichment
scores keeps the ranking explanation in a disclosure beneath the results.

## delivery

Read the [delivery runbook](delivery.md). Inputs are the intended source revision,
build configuration, matching scientific bundles and deployment authorization.
Inspect package scripts, Vite configuration, worker configuration, the deploy
preparation and verify scripts. The gitignored deploy inputs (query catalog,
tracker catalog, reference atlases) come from `pnpm run prepare:deploy`, and
`upload:bundles` refuses bundles restored from the public data release.
Expected outputs are a validated build and, when explicitly requested,
a verified deployment. Retrieve current deployment and edge rule state during the
task; generated context contains no live operational state.
