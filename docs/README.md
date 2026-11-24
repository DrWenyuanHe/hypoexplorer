# Documentation

Code, types and tests are the source of truth for what the system does. These
docs keep what code cannot say: decisions, invariants, provenance and procedures,
with pointers to the owning code. Core references stay at this level; procedures
live in `runbooks/`, and dated audits, plans and reviews in `records/`. Records
are frozen history, not current behaviour.

- [Project guidance](PROJECT_GUIDANCE.md): provenance, architecture and validation commands.
- [Developer guide](DEVELOPMENT.md): running, checking and changing the app.
- [Domain vocabulary](../CONTEXT.md): shared concepts and code responsibilities.
- [Dataset contract](DATASET_CONTRACT.md): rules for the public bundles and where their shapes are defined.
- [Upstream analysis tables](REAL_DATA_SHAPES.md): what the R producers emit and the quirks the builders handle.
- [Agent context](agent-context/README.md): generated maps, task routes and review maintenance.

## Runbooks

- [Refactor checklist](runbooks/REFACTOR_CHECKLIST.md): change validation.
- [Performance baseline](runbooks/PERF_BASELINE.md): optimized paths and where to measure.
- [Search discovery](runbooks/SEO.md): public document generation and sources.
- [Expression survey](runbooks/EXPRESSION_SURVEY.md): per-sample expression view and its sources.
- [Circadian validation](runbooks/CIRCADIAN_VALIDATION.md): rhythm statistics reference checks.
- [Edge protection](runbooks/EDGE_PROTECTION.md): data host cache, WAF, rate limits and spend guard.
- [Publication release](runbooks/PUBLICATION_RELEASE.md): freezing a reviewable snapshot.
- [Agent export](runbooks/AGENT_EXPORT.md): full-dataset export archive.
- [Historical native runtime](runbooks/HISTORICAL_NATIVE_RUNTIME.md): relocating sealed R replays.

## Records

- [External reference expression plan, 2026-10-29](records/EXTERNAL_REFERENCE_EXPRESSION_PLAN_2026-10-29.md)
- [App loading, 2026-11-20](records/APP_LOADING_2026-11-20.md)
- [Data loading audit, 2026-09-15](records/DATA_LOADING_AUDIT_2026-09-15.md) and [implementation](records/DATA_LOADING_IMPLEMENTATION_2026-09-15.md)
- [UI and description review, 2026-09-13](records/UI-COPY-REVIEW.md)
