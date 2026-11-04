# Hypothalamus Dataset Tracker

> **⚠ Superseded.** The dataset tracker has been migrated **into HypoExplorer** as a
> first-class view (a "Dataset Tracker" entry on the landing hub). On the published
> site it is read-only; locally (HypoExplorer's `pnpm run dev`) the review state is
> editable and persists to `src/data/tracker/reviews.json`. See `src/dataset-tracker/`
> and `scripts/build_tracker_catalog.mts` in the repo root. This standalone app is kept
> only as a reference during the transition and will be removed once the integrated
> version is confirmed; **prefer the integrated tracker for new review work.**

An independent local web app for **reviewing and triaging** the candidate hypothalamus
datasets surfaced for HypoExplorer. Separate from the HypoExplorer app — it only reads
the dataset catalog and tracks your review status.

## Run it

```bash
cd dataset-tracker
pnpm install     # one time
pnpm run dev     # opens http://localhost:5179
```

## What it does

- Lists every candidate dataset from `../nar-research/dataset-survey/scout_master_combined.json`
  (read live, so it reflects the latest search/eval passes).
- Lets you set a **status** on each dataset, with this lifecycle:
  **New → Reviewed → In pipeline → Added**, plus **Rejected**.
- **Table view** — sortable, filterable (by status, feasibility tier, n≥3, modality,
  species, which search found it, free-text). Set status inline per row; click a row
  for the full dossier.
- **Board view** — kanban columns by status; move datasets with the ← / → / ✗ buttons.
- **Detail drawer** — full methods, source links (GEO/SRA/ENA/DOI + PubMed), feasibility
  + n≥3 detail, fit assessment, verification log, and a free-text **review note**.
- **Already-in-explorer detection** — the tracker reads HypoExplorer's own registry
  (`../src/data/datasets.ts`, the deployed source of truth) live and auto-flags any
  candidate that is already integrated. Two tiers: **● in explorer** (same accession /
  BioProject — genuinely the same dataset) and **↔ same paper** (only the DOI/PMID
  matches — same publication, likely a *different* series). The header shows an
  **In explorer** count + a **HypoExplorer has N** panel listing what's live, and a
  drift bar warns if a candidate is marked *Added* but isn't actually in the registry.
  Nothing to maintain by hand: add a dataset to `datasets.ts` and it auto-flags on reload.
- **Persistence** — every status/note change is written to `data/statuses.json` on disk
  (via a small Vite dev-server endpoint). It survives restarts, can be committed, backed
  up, or handed to collaborators. The header **Export backup** button downloads a copy.

## Files

- `data/statuses.json` — your review state, keyed by accession: `{ "GSE…": { status, note, updated } }`.
  New datasets default to `new`. Safe to commit or back up.
- `data/explorer_accessions.json` — tracker-only sidecar of **provenance accessions**
  (BioProject / CNGB / mirrors) for the integrated datasets, so a re-deposit of the
  same raw data under a *different* accession is still caught. Editing it does **not**
  touch the deployed explorer. Extend it whenever a dataset is added to `datasets.ts`.
- `vite.config.ts` — React + a tiny API plugin (`/api/catalog`, `/api/statuses`) that
  reads the catalog, reads HypoExplorer's `datasets.ts` to compute integration status,
  and reads/writes the status file.
- `src/App.tsx` — the whole app.

## Notes

- This is a local review tool (dev server), not a deployed site. No external services.
- Status is keyed by accession, so re-running dataset searches (which grow the catalog)
  preserves your existing marks; new datasets appear as `new`.
