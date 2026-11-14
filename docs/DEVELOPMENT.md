# Developer guide

How to run, check and change HypoExplorer from this repository. The
[README](../README.md) has the short version.

## Setup

You need Node.js 22 or later. `package.json` pins pnpm, which Corepack installs.

```bash
corepack enable
pnpm install
pnpm run fetch:query
pnpm run fetch:expression
pnpm dev
```

- `fetch:query` downloads the query and tracker catalogs the app is built against.
  The dev server and the build need them: `vite` and `vite build` stop without
  `public/query/tracks.js`.
- `fetch:expression` downloads the GTEx, HPA and Allen reference atlases (about
  230 MB) for the Expression survey. Without them, those three collections show as
  unavailable. The unit tests need them.

### Data origin

The dataset bundles, the cross-dataset query index and the QC files are served
from `https://data.hypoexplorer.com` (Cloudflare R2 behind the edge cache).
`.env.development` and `.env.production` point the dev server and `pnpm run build`
there. To use another origin, set `VITE_BUNDLE_BASE_URL` in
`.env.development.local` or `.env.production.local`. Vite reads those after the
committed files.

The app loads all data on demand. `index.html` loads only the JavaScript bundle;
the hub fetches the default dataset's metadata, and the explorer loads a track the
first time it is opened. Cross-dataset questions are answered from the prebuilt
query index in a few requests, not by downloading every study.

### Running without the data origin

The [hypoexplorer-data](https://github.com/DrWenyuanHe/hypoexplorer-data)
releases carry the same dataset bundles and QC reports, so you can
run the app entirely from your own checkout:

```bash
pnpm install
pnpm run data:offline   # restore the pinned release, then build the query indexes
pnpm run dev:offline    # http://localhost:5173, reading public/ only
```

- `data:offline` runs `fetch:data --no-matrices` (the release in
  `data-release.json`, checked against its SHA-256 values), then
  `build:query-index` and `build:expression-index` over the restored bundles.
- `dev:offline` (`scripts/dev_offline.mjs`) starts Vite in `offline` mode with
  `VITE_BUNDLE_BASE_URL` forced empty, even if your shell sets it, so every bundle
  and index is read same-origin from `public/`. It refuses to start until
  `data:offline` has run.
- **KEGG is not included.** Each pathway bundle keeps an empty KEGG collection, so
  the app shows GO Biological Process, Hallmark and Reactome results and no KEGG
  results. `public/datasets/KEGG_NOT_INCLUDED.md` explains why;
  hypoexplorer.com still shows them.
- **Macaque per-animal values are not included.** The macaque bundles keep their
  DE and FGSEA results but not the per-animal normalized CPM, so that study's
  sample-level plots and exports are empty.
- **Never publish these bundles.** `fetch:data` writes
  `public/datasets/.public-data-release.json` beside them, and
  `pnpm run upload:bundles` refuses to upload while it finds that marker,
  `KEGG_NOT_INCLUDED.md`, an emptied macaque CPM or a corpus whose KEGG collections
  are all empty: uploading them would replace the full production bundles on R2.
  `--allow-reduced-bundles` overrides the check.
- The Dataset Tracker page is not available offline; its catalog is not in the
  release.
- The GTEx, HPA and Allen reference atlases are third-party data and are not in
  the release. Run `pnpm run fetch:expression` for them, or the Expression survey
  shows those three collections as unavailable.

## Commands that work from a fresh clone

These run after `pnpm install`. Those marked * also need `pnpm run fetch:query`
first, and `pnpm test` needs `pnpm run fetch:expression` as well.

| Command | What it does |
|---|---|
| `pnpm dev` * | Dev server on http://localhost:5173 |
| `pnpm run build` * | Production build in `dist/`, plus the static study and guide pages. It runs `vite build` only; the scientific checks are separate commands |
| `pnpm run verify:release` | Checks the built release metadata, bootstrap script, guide pages, citation version, reference atlases and tracker catalog (run `prepare:deploy` and `build` first) |
| `pnpm test` * | Vitest unit and component tests |
| `pnpm run test:smoke` | Playwright smoke tests on the built site (run `build` first; install Chromium with `pnpm exec playwright install chromium`) |
| `pnpm run lint` | Biome lint |
| `pnpm run typecheck` | TypeScript for the app, the scripts and the spend-guard Worker |
| `pnpm run test:context` | Tests for the agent-context tooling |
| `pnpm run context:check` | Checks the agent-context maps, links and reviews against the sources ([maintenance](agent-context/README.md)) |
| `pnpm run check:public-safety` | Checks every tracked file for credentials, personal information and missing third-party notices |
| `pnpm run deadcode` | knip: unused files, dependencies and exports in `src/` (run `fetch:query` first on a fresh checkout) |
| `pnpm run prepare:deploy` | Fetches whatever the production build ships but the repository does not carry (below) |

## Deploying

Deploys are manual. `pnpm run deploy:cf` needs `.env.cfdeploy` with the Cloudflare
credentials, and runs:

1. `prepare:deploy` (`scripts/prepare_deploy.mts`). It fetches the inputs a
   production build ships but this repository does not carry: the query catalog
   from the data origin, the tracker catalog from hypoexplorer.com, and any GTEx,
   HPA or Allen atlas under `public/expression/` that is missing or incomplete.
   Complete local atlases are kept. If the local `public/query/` pointers differ
   from the data origin's, it stops: the deployed app would pin an index R2 does
   not serve. Upload the index first, or pass `--refresh-query` to take the origin's.
2. `deploy:dist`: `build`, then `precompress`.
3. `verify:release`, which fails if `dist/` lacks an atlas file or the tracker
   catalog, because deploying without them removes them from the live site.
4. `wrangler deploy`, then `verify:deploy` against https://hypoexplorer.com.

`pnpm run deploy:cf:dry` runs steps 1 to 3 and `wrangler deploy --dry-run`.
Uploading dataset bundles to R2 (`pnpm run upload:bundles`) is a separate step;
see the [delivery runbook](agent-context/delivery.md).

Commands that rebuild bundles, replay evidence or compare against the authors'
results (most `build:*` and `check:*` data commands) need raw inputs that are not
in this repository. Links from the docs into `data/` describe that evidence and may
name files that are not here.

## Checks on pull requests

Every pull request to `main` must pass these checks:

| Check | Workflow | Runs |
|---|---|---|
| Lint and typecheck | `application.yml` | `lint`, `typecheck`, `deadcode`, `test:context`, `context:check` |
| Unit tests | `application.yml` | `pnpm test` with the fetched catalogs and atlases |
| Build and browser smoke | `application.yml` | `prepare:deploy`, `build`, `verify:release`, `test:smoke` against R2 |
| Public safety | `public-safety.yml` | `check:public-safety` over every tracked file |
| CodeQL (actions, javascript-typescript, python) | `security.yml` | Code scanning; `vendor/` is ignored |
| Dependency review | `security.yml` | Fails on a new dependency with a high or critical advisory |

## Where things are

| Path | What it holds |
|---|---|
| `src/hub/`, `src/library/` | The landing page and the dataset library |
| `src/explorer/` | Explorer position, track navigation and tab declarations |
| `src/gene-explorer/`, `src/pathway-explorer/` | Per-study gene and pathway views |
| `src/compare/`, `src/compareset/`, `src/crossdataset/` | Cross-track, compare-set and cross-study reports |
| `src/expression-survey/`, `src/circadian/` | Baseline expression and rhythm views |
| `src/verification/`, `src/qc/` | Evidence badges, verification records and QC tables |
| `src/nomenclature/`, `src/search/` | Symbol authority reference and unified search |
| `src/local-datasets/` | Importing your own results into the browser |
| `src/data/` | The dataset registry, bundle loading and the query index client |
| `scripts/` | Bundle builders, static page generation, deploy and verification tools |
| `workers/`, `cloudflare/` | The R2 spend guard and the edge cache and WAF rules |
| `geo_replication/` | GEO reanalysis configuration and pipeline scripts |
| `brand/` | Logo masters, exports and the Manrope font (OFL) |
| `vendor/` | A pinned SEO toolkit snapshot used by the project-local skills |

## Further reading

- [CONTEXT.md](../CONTEXT.md): domain vocabulary (dataset, track, group, contrast). Read it before changing the data layer.
- [DATASET_CONTRACT.md](DATASET_CONTRACT.md): the data shapes a dataset bundle must provide.
- [REAL_DATA_SHAPES.md](REAL_DATA_SHAPES.md): quirks of the upstream tables the builders handle.
- [LOCAL_DATASETS.md](LOCAL_DATASETS.md): importing and exporting results stored in the browser.
- [EXPRESSION_SURVEY.md](EXPRESSION_SURVEY.md): survey sources, scales and eligibility.
- [AGENT_EXPORT.md](AGENT_EXPORT.md): the full analysis-table export.
- [SEO.md](SEO.md): static study pages and source attribution.
- [PERF_BASELINE.md](PERF_BASELINE.md) and [REFACTOR_CHECKLIST.md](REFACTOR_CHECKLIST.md): what to measure and what to preserve.
- [DESIGN.md](../DESIGN.md) and [PRODUCT.md](../PRODUCT.md): the design system and product commitments.
