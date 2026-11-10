# Repository guidance

Read [project guidance](docs/PROJECT_GUIDANCE.md) for this repository's project structure, data provenance,
and validation commands.

## SEO skills

The SEO suite is installed only in this repository, under `.agents/skills/`.
Use it when the current task requires SEO work or the user explicitly invokes an
SEO skill. Ordinary code changes, page reviews, and content edits do not trigger
the suite by themselves. Read only the relevant `SKILL.md` and supporting files.

For broad SEO work, start with `.agents/skills/seo/SKILL.md`. For a focused task,
load the matching `seo-*` skill directly. Shared upstream files are in
`vendor/claude-seo/`; run tools through `python scripts/seo_runtime.py` from this
repository's root and keep any requested dependency setup local to this repository.
Installation, updates and recovery are in [SEO tooling](docs/seo-tooling.md).

## Context maintenance

Read the task's detailed map and canonical runbook before changing code. After a
branch switch or context recovery, reread this map and run `pnpm run context:check`.
Maintain source, authored context, generated maps and reviewed fingerprints together;
follow [the maintenance procedure](docs/agent-context/README.md).

<!-- agent-context:start -->
## Startup context map

HypoExplorer: 162 registered datasets in 11 categories; 27 source areas, 15 application views and 5 explorer tabs. Counts describe checked-in declarations.

Directories:
- `brand/`: Approved logo masters, reusable exports and licensed companion typography.
- `src/`: React explorer and shared TypeScript domain model.
- `scripts/`: Dataset builders, evidence checks and maintenance tools.
- `public/`: Static assets and generated browser data bundles.
- `data/`: Analysis inputs, retained evidence and reviewed assessments.
- `geo_replication/`: Tracked study inputs and analysis outputs.
- `workers/`: Scheduled R2 spend guard for the data origin.
- `cloudflare/`: Edge cache, WAF and rate-limit rule payloads for the data host.
- `docs/`: Data contracts, runbooks and maintained context.
- `vendor/`: Pinned Claude SEO toolkit snapshot behind the project-local SEO skills.

Source areas:
- `__tests__`: App, data-contract and regression tests.
- `acknowledgements`: Study sources and attribution.
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
- `local-datasets`: On-device result import, storage and exploration.
- `methodology`: Methodology reference page for the collection.
- `nomenclature`: Symbol and authority reference interface.
- `pathway-explorer`: Enrichment tables, leading edges and pathway plots.
- `pwa`: Service-worker updates and version handling.
- `qc`: Track-level QC tables and enrichment diagnostics.
- `search`: Unified gene and pathway search, synonym dictionary and results portal.
- `statistics`: Statistical definitions and interpretation limits.
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
- [Change local result imports](docs/agent-context/workflows.md#local-import).
- [Build and verify site delivery](docs/agent-context/workflows.md#delivery).

[Code map](docs/agent-context/generated/codebase.md) · [Dataset map](docs/agent-context/generated/datasets.md) · [Shared contracts](docs/agent-context/generated/contracts.md) · [Maintenance](docs/agent-context/README.md).
<!-- agent-context:end -->
