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
  The dev server, the build and the tests all need them.
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

## Commands that work from a fresh clone

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server on http://localhost:5173 |
| `pnpm run build` | Production build in `dist/`, plus the static study and guide pages |
| `pnpm run verify:release` | Checks the built release metadata, bootstrap script, guide pages and citation version |
| `pnpm test` | Vitest unit and component tests |
| `pnpm run test:smoke` | Playwright smoke tests on the built site (run `build` first; install Chromium with `pnpm exec playwright install chromium`) |
| `pnpm run lint` | Biome lint |
| `pnpm run typecheck` | TypeScript for the app, the scripts and the spend-guard Worker |
| `pnpm run test:context` | Tests for the agent-context tooling |
| `pnpm run deadcode` | knip |

Commands that rebuild bundles, replay evidence or compare against the authors'
results (most `build:*` and `check:*` data commands) need raw inputs that are not
in this repository. Links from the docs into `data/` describe that evidence and may
name files that are not here.

## Checks on pull requests

Every pull request to `main` must pass these checks:

| Check | Workflow | Runs |
|---|---|---|
| Lint and typecheck | `application.yml` | `lint`, `typecheck`, `test:context` |
| Unit tests | `application.yml` | `pnpm test` with the fetched catalogs and atlases |
| Build and browser smoke | `application.yml` | `build`, `verify:release`, `test:smoke` against R2 |
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
