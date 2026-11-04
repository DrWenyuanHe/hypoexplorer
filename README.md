# HypoExplorer — Hypothalamic DE & Pathway Browser

> **About this repository.** This is the public source of
> [hypoexplorer.com](https://hypoexplorer.com): the application, its build and
> analysis scripts, the dataset registry, and the small authored records the app
> imports. The generated dataset bundles (about 1.2 GB) are served from
> `https://data.hypoexplorer.com` rather than committed. Raw study downloads,
> publisher supplements, KEGG-derived tables and the retained evidence ledgers
> stay with the maintainer. The full analysis tables are published separately as
> the [agent data export](docs/AGENT_EXPORT.md).
>
> To run the app locally:
>
> ```bash
> corepack enable
> pnpm install
> pnpm run fetch:query
> pnpm run fetch:expression
> pnpm dev
> ```
>
> `fetch:query` downloads the query and tracker catalogs the app is built
> against. `fetch:expression` downloads the GTEx, HPA and Allen reference atlases
> for the Expression survey (about 230 MB; without them those three collections
> show as unavailable). `.env.development` and `.env.production` point the dev
> server and `pnpm run build` at the data origin. To use another origin, set
> `VITE_BUNDLE_BASE_URL` in `.env.development.local` or `.env.production.local`,
> which Vite reads after them. Commands that rebuild
> bundles, replay evidence or check author concordance (`check:*`, `build:*`
> for data) need inputs this repository does not include. Links below into
> `data/` describe that evidence and may name files that are not here.

Interactive browser tool for exploring differential expression and pathway enrichment across hypothalamic datasets. A landing hub and dataset selector switch the whole app between **162 datasets**, grouped into 11 thematic categories:

- **Primate atlas** — macaque hypothalamus (snRNA-seq), obese vs normal across 60 cell populations: neuronal clusters (glutamatergic, GABAergic, histaminergic, oxytocin) and non-neuronal populations (astrocytes, oligodendrocytes, OPCs, microglia, ependymal cells, tanycytes, endothelial cells, fibroblasts), with GO / KEGG / Reactome pathway enrichment.
- **Diet-induced obesity** — chronic/acute HFD, HFHS, overfeeding, and DIO models (incl. mouse whole hypothalamus GSE220533 and arcuate GSE225038).
- **Aging** — direct chronological-age contrasts in mouse, rat, and macaque hypothalamus. Interventions performed *in* aged animals are filed under the category describing their actual contrast, so this stratum pools age effects only.
- **Feeding & fasting**, **Leptin, insulin & energy signaling**, **Incretin & pharmacology**, **Microbiome & gut–brain axis**, **Reproduction & development**, **Developmental programming**, **Circadian**, and **Stress, immune & disease** — the remaining bulk RNA-seq and microarray studies across supported mammalian, avian, and fish species.

Each dataset is described by a bundled registry (`src/data/datasets.ts`) that carries its organism, modality, feature type, experimental groups, and one or more comparisons (multi-contrast schema). Each entry also links out to its source (GEO / ArrayExpress accession, DOI, PubMed). Replicate counts, replicate sample IDs, group labels, and expression units are read from each dataset's own data — nothing is hardcoded. Switching datasets resets to that dataset's default track while preserving your significance / fold-change cutoffs.

**162 datasets across 11 categories, switchable from one explorer · group sizes, sample IDs & units read from the data · Hallmark / GO / KEGG / Reactome pathways (where available)**

The [September 5 intake](data/intake/september5-2026/REPORT.md) adds 14 studies with 22 tracks and 51 fitted comparisons. Its source manifests, sample exclusions, statistical models and remaining candidate holds are recorded alongside the results. `pnpm run check:intake` traces every new track and contrast to the prepared inputs and pathway provenance.

The [September 12 HFD intake](data/quality/hfd-intake-2026-09-12/README.md) adds GSE104709 (mouse ventral hypothalamus) and GSE107324 (male and female neonatal rat hypothalamus after maternal HFD), with three analysis tracks. `pnpm run check:hfd-intake` verifies source, model and public-bundle consistency. The intake report records the independent numerical replays and the limits of agreement with the original authors.

The [October 19 OXT/AVP intake](data/intake/oxt-avp-2026-10-19/README.md)
adds GSE65663, a rat SON salt-loading comparison with five independent five-rat
pools per arm, using the deposited median-baselined log2 RMA values. Separately,
the [OXT cell reference](data/expression/oxt-reference/README.md) adds 125
magnocellular and 21 parvocellular profiles to the expression survey while
preserving CENSUS estimates and source animal/pool labels. It has no synthetic DE
contrast and does not increase the registered dataset count. See
[the survey guide](docs/EXPRESSION_SURVEY.md) for source scales and eligibility.

---

## What it does

**Gene Explorer** (per-population)
- Search any gene and see its normalized CPM bar chart (mean ± SEM, individual sample dots)
- Search resolves **aliases and previous symbols** via MGI/HGNC/RGD (searching `AARS1` finds the stored `AARS`, and each suggestion says why it matched); an **Aliases** toggle lists every suggestion's other names, and a selected gene whose symbol the authority has retired carries an outdated-symbol marker
- Add multiple genes to compare side-by-side
- **Load a gene list** from a file (plain text, CSV, TSV, Excel, GMT or JSON — the format and the gene column are detected automatically) or paste one; names are matched to the dataset's own spelling and through aliases/previous symbols, and the dialog reports what was found, redirected, or not in the dataset before anything is selected. **Save the selection** as `.txt` (one symbol per line), `.csv` or `.xlsx`; the volcano's threshold-passing genes save the same way, with direction, log2FC, p and FDR
- Volcano plot with P value / FDR toggle, clickable points, adjustable thresholds, and purple diamond markers for selected genes
- Switch the volcano to a searchable, sortable table of all plotted genes; filter by thresholds, direction, or selection and add genes directly from a row
- Summary table with logFC, P value, FDR, significance stars, mean CPM per group
- Export to CSV, Excel (Summary + RawValues + Metadata sheets), or PNG. Gene CSV/Excel files retain study, contrast, units, processing/replication evidence and release identity; filenames distinguish studies and comparisons.
- **"⊞ N pathways as leading gene"** button on each selected gene's bar chart — opens a modal listing every GSEA pathway where that gene is a leading-edge contributor (DB, name, NES, FDR, p-value, size); click a row to open the full pathway detail (heatmap + enrichment + leading-edge genes) inside the same modal, then back/close to return to the Gene Explorer
- **Context-aware Excel export** pinned in the modal header — exports the pathway list (with the gene's DE context) in list view, or the full pathway data (metadata + leading-edge gene stats + raw CPM) in detail view

**Pathway Explorer** (per-population)
- Browse GO / KEGG / Reactome FGSEA pathways (4,000–4,500 per population)
- Filter by database, FDR threshold, keyword search; sort by |NES|, P value, or name
- Paginated table (25 / 50 / 100 / 250 / All rows per page)
- Click any pathway to open a detail panel with:
  - Heatmap of leading-edge gene expression with the dataset's sample counts, condition labels, and expression unit
  - For factorial designs such as the POMC maternal-diet × age study: all-condition heatmaps and gene charts, plus separate NES/FDR/P results for each declared comparison; exports include all condition values and comparison statistics
  - GSEA-style running enrichment score curve
  - "⊞ Explore leading-edge genes" — BarSEM chart grid for every leading-edge gene, sortable logFC/p-val/FDR/CPM table, export to Excel
- Export filtered pathways to Excel

**Compare tab** (cross-population)
- *Genes:* search a gene and see expression across all active populations side-by-side; undetected populations shown explicitly
- *Pathways:* compare GSEA enrichment across populations in one sortable table; detail panel shows NES bars, per-population stats, and leading-edge gene overlap
  - "Gene profiles" sub-tab — per-gene BarSEM charts per population, multi-population DE summary table, export to Excel

**Cross-dataset** (Explore all)
- *Genes:* one gene's direction and significance across every dataset, with raw P **and** FDR side by side, on one shared log2FC axis with each track's own 95% CI. **Nothing is pooled.** The corpus spans twelve species, bulk alongside single-nucleus and spatial data, and a dozen different perturbations, so a combined effect size would average questions that are not the same question — the report groups the studies into categories, lines them up, and leaves the synthesis to the reader.
- *Compare:* side-by-side per-dataset expression bar charts for one gene across datasets
- *Pathways:* one pathway's NES and significance across every pathway-capable dataset (the FGSEA analog of cross-dataset gene search), spanning mouse, rat, and macaque via shared MSigDB `gs_name`s

**Compare set** (`#/compare-set/<dataset>[:<track>],…`)
- Pick studies into a set with **＋ Compare** on any library card, table row or record, or a single macaque population from the explorer topbar (up to 12). The set persists across views and reloads; the header counts it in words, and its drawer edits it.
- **Compare N →** opens the set as columns — the single-cell Compare tab's idea with a study (or one population of one) per column. *Genes:* search or load a list, get each study's own bars (mean ± SEM, in its own unit) and a logFC / P / FDR table with a per-gene **tally** of per-study FDR calls. *Pathways:* the NES / FDR matrix ranked by the strongest |NES| in any column, with NES bars, per-study statistics and leading-edge overlap behind each row. Symbols match across species (POMC finds Pomc).
- A rail down the left lists the studies in the set; the highlighted study's **volcano** sits above the comparison, with the explorer's threshold controls and "Add all". Click a point (or add the threshold-passing set) and the gene is a row across every study right below — no switching views. Pick another study in the rail to swap volcanos; thresholds carry from one to the next.
- Every column names its own contrast and arms; a column that failed to load says so rather than reading as "not detected"; populations of one study are flagged as sharing animals. Nothing is pooled — the tally is a count, not a test. The URL names the columns, so a comparison is a link you can share; opening someone else's leaves your own set alone.

**Statistics**
- An explainer page defining every metric (log2FC, SE, 95% CI, raw p, FDR, significance stars, NES) and stating where they stop: each number belongs to one dataset, and the cross-dataset views arrange them without combining them

**Data verification** (`#/verification`)

- Three separate badges show **Pipeline QC**, **Experimental design** and **Author concordance** throughout the library, tracker and exploration views. Hover, focus or tap a badge to inspect its checks, scope and remaining limitations. Detailed author-review labels retain full-verification, unresolved, unfinished and excluded states separately.
- Open a study record from a library card or table row to see its verification summary, comparison arms, replicate counts, sample details, measurements and sources. **Full verification report** expands the detailed evidence below the study design. The Explorer's dataset information button uses the same fact table and follows the selected comparison.
- Each evidence record separates author-result availability from numerical disagreement, names the comparison scope, links the source evidence and records what is needed next. Missing author results are not labeled a failed comparison.
- The accompanying workflow explains full sign-off, source checks, author-compatible reconstructions and remaining limitations. Audit completion is not full scientific verification; see [the verification data contract and reproduction guide](data/author-validation/README.md).

**Gene nomenclature reference** (`#/nomenclature`)
- The corpus's symbol-and-authority entries are searchable by symbol, alias, previous symbol or gene name, filterable by authority and status, and downloadable as Excel. Authorities include MGI, RGD, HGNC and species-specific NCBI Gene namespaces; unmatched symbols remain explicitly unrecognized. Each symbol links into the cross-dataset gene report.
- Rows marked **Ambiguous** retain unresolved RGD candidate IDs in the source table and receive no chosen authority link or automatic alias redirect. A unique approved record can resolve collisions with provisional alternatives.
- GSE314184 retains a dataset-specific MGI classification for its historical stored symbols after the animal species correction to *Rhabdomys pumilio*. This classifies spelling only; the mouse-reference mapping remains under review.

**Changelog**
- "Changelog" button in the app header shows a dated history of all feature releases

---

## Setup

Requires [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io); `package.json`
pins the pnpm version, which Corepack installs. The data bundles under `public/datasets/` are
committed, so a fresh clone runs without a separate preprocessing step:

```bash
corepack enable pnpm   # once per machine
pnpm install
pnpm run dev
# → http://localhost:5173
```

By default the app serves its data bundles from its own origin (`public/datasets/**`,
`public/query/**`, and `public/qc/**`). To serve them off-origin (e.g. a Cloudflare R2 bucket or CDN),
set `VITE_BUNDLE_BASE_URL` to a bare origin and the loaders prepend it — no code
changes. When the base URL is set, `pnpm run build` **removes `dist/datasets/`,
`dist/query/`, and `dist/qc/` from the build output** (they are served from the bucket instead), so
run `pnpm run upload:bundles` (`scripts/upload_bundles_r2.mts`, via `wrangler`) to
mirror `public/datasets/`, `public/query/`, and `public/qc/` to R2 — and re-upload after
rebuilding the query index, or clients fall back to the slow full-download path.
The script stores text objects as brotli-11 bytes with `Content-Encoding: br` and
year-long immutable `Cache-Control` (R2 does no encoding negotiation of its own),
so production must serve the bucket through a **Cloudflare custom domain** — the
proxy transcodes br for clients that lack it and provides the edge cache; the
rate-limited `pub-*.r2.dev` URL is for dev testing only.
Copy [`.env.example`](.env.example) to `.env.local` for local testing.

The app shell (`index.html`, the hashed assets, `/nomenclature`, `/tracker`,
`pop_meta.js`) publishes to **Cloudflare Workers static assets** in one command.
There is no manual upload:

```bash
pnpm run deploy:cf     # = deploy:dist (build + precompress) && wrangler deploy && verify:deploy
```

`wrangler.jsonc` declares an assets-only Worker over `dist/`, bound to the apex as
a Custom Domain. `wrangler deploy` uploads everything in `dist/` except what
`public/.assetsignore` excludes — the `.br`/`.gz` sidecars and `.htaccess` —
because Cloudflare compresses at the edge and shipping them would mean a second,
unreachable copy of every asset. `public/_headers` carries the cache policy;
`public/_redirects` sends `/datasets/*`, `/query/*` and `/qc/*` to R2 for clients
old enough to still ask the app origin for data.

`public/.htaccess` is dormant, not deleted: it is Apache config, it no longer
reaches the apex, and it is what a rollback to Hostinger would need.

Because `verify:deploy` runs as the last step of `deploy:cf`, a bad deploy fails
the command rather than merely shipping. It probes the live site over a raw socket
and asserts the whole serving contract: that the data bundles on
`data.hypoexplorer.com` still arrive as the brotli-11 bytes `upload_bundles_r2.mts`
stored (a bundle that lost that encoding fails invisibly — the edge falls back to
its own on-the-fly brotli, so nothing 404s and the bundle just arrives ~26% larger,
measured pre-cutover at 546 KB against a 434 KB brotli-11 encode); that a gzip-only
client is never handed brotli it cannot decode; `Vary: Accept-Encoding`; the
immutable `Cache-Control` on `/datasets/**`; that the shell's own revalidating
headers really do revalidate; that the deployed build records the bundle origin it
was compiled against and that origin is the expected one; that the query manifest
is fresh for this registry; and that the deployed entry chunk matches your local
`dist/`. Sixteen checks, non-zero exit on any failure.

The app origin is held to a different compression standard than the data origin,
and the script detects which model it is looking at rather than assuming: it asks
for the `.br` sidecar URL, which is a real file under Apache and a 404 on
Cloudflare. Under the edge model it gates on the saving against identity and
reports the gap to brotli-11 as information, since Cloudflare will not match
quality 11.

The bundles themselves are kept
lean by `pnpm run optimize:bundles` (`scripts/optimize_bundles.mts`): threshold-guarded
rounding of P/FDR plus dropped derivable fields, with the same policy applied at
write time by the generators (`scripts/lib/bundleSlim.mts`).

### Regenerating data bundles

Each dataset's bundles live under `public/datasets/<id>/` (`meta.js`, `qc_global.js`,
and one `track_<id>.js` per track). They are generated from the analysis layer:

- `pnpm exec tsx scripts/migrate_macaque_bundles.mts` — builds the macaque snRNA bundles
  (`public/datasets/macaque_snrna/`) from the per-population DE + FGSEA results.
- `pnpm exec tsx scripts/build_geo_datasets.mts` — builds the bespoke GEO mouse bundles
  (`public/datasets/mouse_hypo_hfd_gse220533/`, `public/datasets/mouse_arc_hfd_gse225038/`)
  from the `geo_replication/` GEO datasets.
- `pnpm exec tsx scripts/build_explorer_bundles_batch2.mts` — generic MANIFEST-driven builder
  for the remaining GEO datasets (reads `geo_replication/config/datasets.tsv`).
- `pnpm exec tsx scripts/verify_macaque_equivalence.mts` — checks the relocated macaque
  bundles are byte-for-byte equivalent to the legacy layout.
- `Rscript scripts/run_mouse_fgsea.R` — computes FGSEA pathway enrichment for the mouse
  HFD datasets, so pathway search resolves across species (mouse + macaque share MSigDB
  `gs_name`s).
- `pnpm exec tsx scripts/build_query_index.mts` — builds the cross-dataset **query index**
  (`public/query/`): an inverted, hash-sharded index that answers "where is this gene /
  pathway differentially expressed?" in a few requests instead of downloading every
  dataset's bundles. It also carries an **expression family**
  (`query/<buildId>/expr/`, default tracks only) holding each gene's per-sample values,
  which is what the cross-dataset Compare view's bar charts need and no statistics row
  can supply — that view loads only the relevant expression shards rather than all 162 datasets' bundles.
  Shards live under an immutable `/query/<buildId>/` prefix; a missing or mismatched
  index falls back to the full-download path, never to a partial answer. `--check`
  verifies an existing index against the raw bundles instead of rebuilding, and
  `pnpm run upload:bundles` runs it before publishing.
- `pnpm run build:nomenclature` — rebuilds the **gene nomenclature table**
  (`data/nomenclature/nomenclature.tsv`, committed, plus its runtime projections under
  `public/nomenclature/`) by joining every symbol the corpus stores against MGI (mouse),
  RGD (rat), HGNC (human and human-ortholog macaque symbols), or the native NCBI Gene
  namespaces for chicken, zebrafish, pig and cattle. Dataset-specific stored-symbol
  overrides are recorded in `src/data/nomenclatureWire.ts`. **Rerun this whenever a dataset joins the corpus** — a new study
  contributes symbols, so the committed table goes stale the moment the registry grows.
  `--check` rebuilds in memory and diffs against the committed outputs (the CI guard),
  `--fetch` re-downloads the authority files first.
  For a rat-only addition, `--refresh-authority=RGD` refreshes rat decisions while
  preserving the other retained authorities; adding `--fetch` downloads only the
  two RGD source files. See the [OXT/AVP runbook](data/intake/oxt-avp-2026-10-19/README.md).

The app ships **no eager data `<script>` tags** — `index.html` loads only the JS bundle,
and all data loads on demand: the landing hub fetches the default dataset's `meta.js`
asynchronously, entering the explorer loads the active track, and other tracks, datasets,
and per-dataset QC load when first used. Cross-dataset queries are served from the
prebuilt `public/query/` index.

---

## Data

Each dataset ships as a small set of `var`-style JS bundles under
`public/datasets/<id>/` — `meta.js` (track list, labels, colors, QC flags),
`qc_global.js`, and one `track_<id>.js` per track. The shapes the app expects
(and how groups, contrasts, and units are encoded) are specified in
[docs/DATASET_CONTRACT.md](docs/DATASET_CONTRACT.md); real-world quirks of the
upstream CSVs are documented in [docs/REAL_DATA_SHAPES.md](docs/REAL_DATA_SHAPES.md).

**Macaque hypothalamus (snRNA-seq).** Generated from per-population edgeR + FGSEA
results in `data/raw/results/`:

| File | Description |
|------|-------------|
| `DE_<track>_Obese_vs_Normal_all.csv` | edgeR QL GLM results (logFC, PValue, FDR) |
| `DE_<track>_Obese_vs_Normal_normcpm.csv` | Normalized CPM matrix (6 samples) |
| `DE_<track>_Obese_vs_Normal_FGSEA_GO_fwrite.csv` | GO pathway enrichment |
| `DE_<track>_Obese_vs_Normal_FGSEA_KEGG_fwrite.csv` | KEGG pathway enrichment |
| `DE_<track>_Obese_vs_Normal_FGSEA_Reactome_fwrite.csv` | Reactome pathway enrichment |

Samples: `HCA_Macaque001_S001–S003` = Normal, `S004–S006` = Obese. Organism:
cynomolgus macaque (*Macaca fascicularis*). The expression data are a re-analysis
of Lei et al., *Cell Metab.* 2024 ([doi:10.1016/j.cmet.2024.01.003](https://doi.org/10.1016/j.cmet.2024.01.003));
MSigDB gene sets use *M. mulatta* (rhesus) as the closest supported ortholog proxy.

**Mouse HFD datasets (bulk RNA-seq).** Built by `scripts/build_geo_datasets.mts`
from the `geo_replication/` GEO datasets: whole hypothalamus (chow vs HFD, GSE220533)
and arcuate nucleus (chow vs HFD, GSE225038). Pathway enrichment (GO / KEGG /
Reactome / Hallmark, via `scripts/run_mouse_fgsea.R`) is included for both, so the
Pathway Explorer and Gene Explorer are fully available.

---

## Files

```
src/
  App.tsx                 — Top-level app shell (tabs, header, dataset + track selectors)
  appRouter.ts            — View union, navigation verbs, #/dataset/<id>[/<track>] deep-link
                            reader (hash treated as untrusted input)
  main.tsx                — React entry point
  ErrorBoundary.tsx
  hub/                    — Landing hub (tool tiles, dataset categories, physiology tiles)
  library/                — Dataset library (card grid, theme/region rail filters)
  explorer/               — CellNavigator (track sidebar: category grouping, search filter)
  gene-explorer/          — Gene search, bar charts, volcano, summary table
  pathway-explorer/       — Pathway table, detail panel, heatmap, leading-edge view,
                            pathwayTable (shared filter→sort→paginate seam)
  compare/                — Cross-track gene + pathway comparison (column-generic:
                            compareColumns, CompareGenesView, ComparePathwayView)
  compareset/             — The compare set: persistent store, toggle/indicator/drawer,
                            per-column loader, and the #/compare-set view
  crossdataset/           — "Explore all" cross-dataset gene report, cross-dataset
                            Compare, cross-dataset pathway report, forestReport
                            (shared forest-plot primitives)
  circadian/              — Circadian rhythmicity view (scan, phase map, rhythm traces)
  nomenclature/           — Gene nomenclature reference page (#/nomenclature)
  statistics/             — Statistics explainer page (per-dataset metrics + why nothing is pooled)
  qc/                     — QC tab (group sizes, replicate sample ids, low-power flags)
  acknowledgements/       — Data Sources & Acknowledgements tab
  methodology/            — Methodology page (#/methodology)
  changelog/              — Changelog modal + entries
  common/                 — Modal, Spinner, EmptyState, DatasetInfoPanel, StudyMetadata
                            (shared study record), QualityBadges, PageShell
                            (full-page report chrome), shared UI
  dataset-tracker/        — Dataset Tracker review sub-app
  pwa/                    — Version badge, update modal, service-worker refresh
  data/                   — datasets (registry), datasetMeta, datasetCategories,
                            explorerStore (per-dataset meta/QC/track cache),
                            trackData (load protocol), bundleSource (script-injection
                            transport), bundleBase, queryIndex (cross-dataset query
                            fast path), loadDatasetMeta, loadTrack, buildPopData,
                            popCache (WeakMap), crossDataset
  utils/                  — sampleValues (group→sample seam), sampleIds, datasetLinks,
                            fdr (Benjamini–Hochberg), seRecovery (per-gene SE),
                            workbook (single XLSX write path), lazyExport, mapLimit,
                            appLinks, axes, format, math, qcFlags, popGroups, excelExport
  types/                  — shared domain types
  styles/                 — shared style constants
  __tests__/              — Vitest smoke + unit tests
scripts/
  migrate_macaque_bundles.mts       — Builds public/datasets/macaque_snrna/ bundles
  build_geo_datasets.mts            — Builds the bespoke GEO mouse bundles
  build_explorer_bundles_batch2.mts — Generic MANIFEST-driven bundle builder
  verify_macaque_equivalence.mts    — Verifies relocated macaque bundles vs legacy
  run_mouse_fgsea.R                 — Computes mouse HFD FGSEA (cross-species pathways)
  build_query_index.mts             — Builds the cross-dataset inverted query index (public/query/)
  upload_bundles_r2.mts             — Mirrors public/{datasets,query,qc}/** to a Cloudflare R2 bucket
  precompress_dist.mts              — Emits .br/.gz sidecars for dist/ (run via `deploy:dist`;
                                      not uploaded to the Worker — kept for the Hostinger
                                      rollback and as verify_deploy's local baseline)
  verify_deploy.mts                 — Probes the live site: compression, encoding, cache, bundle
                                      origin, index freshness, build id (16 checks)
  build_tracker_catalog.mts         — Builds the Dataset Tracker catalog (runs in prebuild)
  build_timeseries_bundles.mts      — Builds circadian time-series bundles (`build:timeseries`)
  build_normalized_bundles.mts      — Builds normalized-expression bundles (`build:normalized`)
  build_nomenclature.mts            — Builds the gene nomenclature table + projections (`build:nomenclature`)
  check_datasets.mts                — Offline structural closure check (bundles vs registry vs tracker)
  lib/                              — Shared builder seams (bundleWriter, deTable, geneSymbol, …)
index.html                — Entry point (no eager data script tags — loads only the TS module)
vite.config.ts            — Vite config
public/datasets/<id>/     — Per-dataset data bundles (meta.js, qc_global.js, track_*.js),
                            committed for deployment
public/nomenclature/      — Runtime projections of the gene nomenclature table
                            (table.js, aliases.js), committed
```

The React UI was refactored from a single 3,083-line `e9_explorer.jsx` monolith into the feature-folder structure above in v0.2.0.0, generalized from a single macaque dataset into the dataset-registry architecture in v0.5.0.0, and migrated end-to-end to TypeScript (strict) in v0.6.0.0. In v0.7.1.0 the App shell was split into owned seams (`appRouter`, `explorerStore`, `trackData`, `bundleSource`, `datasetMeta`), retiring the `window.POP_META` global and `popColors.ts`.

---

## Build & Test

```bash
pnpm run build       # checks author evidence and internal QC, then outputs to dist/
pnpm run check:author-validation # verifies comparisons, audit, FGSEA migration/bundles, and complete sidecar
pnpm run check:quality # remeasures count conservation and checks source/replication/QC ledgers
pnpm run check:verification-advancement # checks complete author extractions and dated progress reports
pnpm run validate:author:gse285906 # reruns the pinned DESeq2 1.52 Npy author-method comparison
pnpm run typecheck   # tsc --noEmit, both configs — the type gate
pnpm test            # vitest run (smoke + unit)
pnpm run test:watch  # vitest watch mode
pnpm run lint        # biome lint
pnpm run deadcode    # knip
```

The author-validation gate is read-only and runs automatically before production builds. It checks the complete dataset/contrast evidence join, including cache-isolated FGSEA rebuilds with schema-3 provenance and checksum-verified pathway bundles. The validation panel and ledger report pathway rows added/removed and FDR < 0.05 calls gained/lost versus the pinned pre-audit local outputs; this pathway evidence does not change the scientific author-validation status.

The full gate recomputes evidence from the locally staged source and processed analysis cache, not just the public bundles. A clean checkout must stage those inputs before running `check:author-validation` or `build`, including the Git-ignored GSE281503 source workbook (approximately 95 MB) and processed directory. Missing inputs fail the gate; their absence is never treated as successful verification. The source storage and Git-ignore policy are unchanged.

Manual R integrity regressions are not required for the browser build. `Rscript scripts/test_fgsea_provenance.R` runs eight real-runner FGSEA fixture cases; `pnpm run validate:author:gse285906` reruns the deposited-count DESeq2 1.52 comparison against the published Npy result.

The automatic quality gate requires Python 3 (`python` on PATH), `openpyxl`, `pypdf`, and Rscript. It independently reopens original count sources and checks every selected count value, including the three documented rounding transformations. Set `RSCRIPT` to an executable path if Rscript is not on PATH. Original author-table extraction also runs before the author-validation gate. Missing runtimes or stale evidence fail the build. The [second verification continuation](data/quality/round2-2026-09-05/ADVANCEMENT_REPORT.md) separates new evidence from the requested correlation-or-direction acceptance rule.

The [September 11 validation continuation](data/quality/continuation-round2-2026-09-11/README.md) records subsequent source, replication and author-comparison evidence across all 159 datasets. The [QC separation report](data/quality/pipeline-separation-2026-09-11/README.md) documents the current three badges: Pipeline QC, Experimental design and Author concordance. That review recorded dataset-level pass counts of 140, 82 and 27 respectively before the September 12 intake. Each badge opens its own checklist, and the library, tracker, Explorer and exports use the same assessments. Known input and model problems still block Pipeline QC; missing replication evidence is shown separately. These counts classify existing evidence rather than represent new scientific repairs.

The quality gate freshly checks original sources, current sample identities, numerical evidence and reviewed source/model limitations. Missing or changed evidence cannot silently produce a pass. Earlier reports retain the original combined `internalQc` definition, which had 81 passes before the September 12 intake. The [completed September 5 source-unit review](data/quality/remaining-2026-09-05/ADVANCEMENT_REPORT.md), its [review index](data/quality/remaining-2026-09-05/REVIEW.md) and [validation record](data/quality/remaining-2026-09-05/VALIDATION.md) preserve the earlier original-corpus findings. The [closed fifth-round history](data/quality/round5-2026-09-05/CLOSED_HISTORY.md) retains that completed report's exact inputs.

---

## Architecture & docs

- [CONTEXT.md](CONTEXT.md) — domain + architecture vocabulary (dataset, track, group, contrast, the sample-value seam). Read this first when working on the data layer.
- [docs/DATASET_CONTRACT.md](docs/DATASET_CONTRACT.md) — the exact data shapes a dataset bundle must provide.
- [docs/REAL_DATA_SHAPES.md](docs/REAL_DATA_SHAPES.md) — quirks of the real upstream CSVs the generators must handle.
- [docs/LOCAL_DATASETS.md](docs/LOCAL_DATASETS.md) — importing, comparing and exporting results stored in your browser.
- [docs/SEO.md](docs/SEO.md) — public study pages, source attribution and search-discovery checks.
- [docs/PERF_BASELINE.md](docs/PERF_BASELINE.md) — performance-relevant design decisions and where to measure.
- [docs/REFACTOR_CHECKLIST.md](docs/REFACTOR_CHECKLIST.md) — invariants to preserve when refactoring the app.
- [DESIGN.md](DESIGN.md) — the design system (typography, color, spacing, motion).
- [PRODUCT.md](PRODUCT.md) — product register, audience, and accessibility commitments.
- [CHANGELOG.md](CHANGELOG.md) — dated release history.
