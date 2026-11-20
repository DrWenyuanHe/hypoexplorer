# Repository guidance

Read [project guidance](docs/PROJECT_GUIDANCE.md) for this repository's project structure, data provenance,
and validation commands.

## Context maintenance

Read the task's detailed map and canonical runbook before changing code. After a
branch switch or context recovery, reread this map and run `pnpm run context:check`.
Maintain source, authored context, generated maps and reviewed fingerprints together;
follow [the maintenance procedure](docs/agent-context/README.md).

<!-- agent-context:start -->
## Startup context map

HypoExplorer: 162 registered datasets in 11 categories; 26 source areas, 12 application views and 4 explorer tabs. Counts describe checked-in declarations.

Directories:
- `brand/`: Approved logo masters, reusable exports and licensed companion typography.
- `src/`: React explorer and shared TypeScript domain model.
- `scripts/`: Dataset builders, evidence checks and maintenance tools.
- `public/`: Static assets and generated browser data bundles.
- `data/`: Analysis inputs, retained evidence and reviewed assessments.
- `geo_replication/`: Tracked study inputs and analysis outputs.
- `workers/`: Scheduled R2 spend guard for the data origin.
- `services/`: Loopback HypoMap co-detection service behind the gated co-expression card.
- `cloudflare/`: Edge cache, WAF and rate-limit rule payloads for the data host.
- `docs/`: Data contracts, runbooks and maintained context.

Source areas:
- `__tests__`: App, data-contract and regression tests.
- `acknowledgements`: Software and reference citations and acknowledgements shown on How to cite.
- `changelog`: Release history shown in the explorer.
- `circadian`: Time-series displays and rhythm statistics.
- `common`: Shared study records, tables, dialogs and page chrome.
- `compare`: Within-dataset comparisons across tracks.
- `compareset`: Persistent selected studies and comparison columns.
- `crossdataset`: Gene, pathway and expression reports across studies.
- `data`: Registry, bundle loading, query indexes and evidence state.
- `dataset-tracker`: Integrated dataset intake and evidence board.
- `explorer`: Explorer position, track navigation, tab declarations and session state.
- `expression-survey`: Baseline expression by population, study condition and tissue.
- `gene-explorer`: Gene search, volcano plots and expression displays.
- `hub`: Search-first landing page and study entry points.
- `library`: Dataset discovery, filtering, study records and result summaries.
- `methodology`: Methods & statistics reference page for the collection.
- `nomenclature`: Symbol and authority reference interface.
- `pathway-explorer`: Enrichment tables, leading edges and pathway plots.
- `pwa`: Version-stamp update prompt and the opt-in service worker.
- `qc`: Track-level QC tables and enrichment diagnostics.
- `search`: Unified gene and pathway search, synonym dictionary, results portal and gated HypoMap atlas views.
- `statistics`: Significance policy and the shared FDR / p < 0.05 listing toggle.
- `styles`: Shared display constants.
- `types`: Shared registry, track, report and time-series contracts.
- `utils`: Routing, sample values, symbol handling and exports.
- `verification`: Evidence status and scientific verification guidance.

- Registry declarations identify studies; bundle loaders and transforms provide the selected track and contrast to views.
- Analysis and evidence checks govern scientific data; context checks govern navigation and reviewed documentation freshness.
- The site Worker serves assets; R2 serves bundles behind edge cache and WAF rules, and a scheduled spend guard caps R2 reads.

Task routing:
- [Add or change a public dataset](docs/agent-context/workflows.md#dataset-change).
- [Review QC and author evidence](docs/agent-context/workflows.md#verification).
- [Change navigation, views or exports](docs/agent-context/workflows.md#ui-change).
- [Build and verify site delivery](docs/agent-context/workflows.md#delivery).

[Code map](docs/agent-context/generated/codebase.md) · [Dataset map](docs/agent-context/generated/datasets.md) · [Shared contracts](docs/agent-context/generated/contracts.md) · [Maintenance](docs/agent-context/README.md).
<!-- agent-context:end -->
