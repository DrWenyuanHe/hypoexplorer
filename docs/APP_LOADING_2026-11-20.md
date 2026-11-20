# App shell loading — 2026-11-20

The September [data loading work](DATA_LOADING_IMPLEMENTATION_2026-09-15.md)
reduced what the views download from the data origin. This change reduces what
the app itself downloads and parses before the landing hub can paint.

## What the hub loaded

Production build of commit `462395c` (app 0.15.0); sizes are Vite's report, in
1,000-byte KB. App imported every view statically, so all of these scripts were
fetched and evaluated before first paint. hypoexplorer.com served the same
layout on this date (its `index` chunk decoded to 1,510.6 KB):

| Script | Decoded | Gzip (build) |
| --- | ---: | ---: |
| `index` (every view) | 1,450.9 KB | 367.1 KB |
| `internal-qc-evidence` | 3,882.8 KB | 220.9 KB |
| `author-validation-evidence` | 991.8 KB | 174.1 KB |
| `charts` (recharts, d3, and React) | 321.7 KB | 95.1 KB |
| `vendor` | 207.1 KB | 65.0 KB |
| **Total** | **6,855 KB** | **922 KB** |

`charts` was on the hub's path although the hub draws no chart: Rolldown's
`manualChunks` shim captures a matched module together with its dependencies,
so the recharts rule also captured React, and every chunk imported React from
`charts`. The hub's data-origin light also downloaded the 200 KB
`/query/tracks.js` manifest with `cache: 'no-store'` on every visit and every
five minutes, only to learn that the origin answered.

## Changes

- `src/appViews.tsx` defines every view except the hub as a `lazyView`
  (`src/common/lazyView.tsx`): 9 pages, 6 explorer tabs and panels, the
  dataset info modal and the study-details verification body. Each is its own
  chunk with its own Suspense fallback. A failed chunk download is retried by
  the ErrorBoundary's reset after one second, never in a loop. App warms the
  results page while the hub is idle, and the reports while the results page is.
- `vite.config.ts` replaces `manualChunks` with `codeSplitting` groups. React
  and react-dom go to `vendor` at a higher priority than recharts, and the
  `$initial` app modules form one `shell` chunk instead of 22 small preloads.
- `csv.ts` takes its provenance columns from the new
  `exportProvenanceFormat.ts`. Before, every view that could write a CSV (the
  results page among them) reached the internal QC ledger through
  `exportProvenance.ts`.
- The origin probe is a `HEAD` request, so it downloads no body.
- `public/_headers` gives `/fonts/*` and `/brand/*` `max-age=86400,
  stale-while-revalidate=604800`. They previously revalidated on every view.

## Result

Production build of this change, same data and app version:

| Hub critical path | Before | After |
| --- | ---: | ---: |
| Scripts | 6 | 4 |
| Decoded JavaScript | 6,855 KB | 546 KB (−92%) |
| Gzip JavaScript | 922 KB | 159 KB (−83%) |
| App stylesheet (gzip) | 13.2 KB | 4.4 KB |

Static closure of each view's chunk (decoded, including `vendor` and `shell`).
Before the change, every view was inside the 6,855 KB hub graph. The sizes were
measured before #50 merged the Statistics page into Methodology and removed
Compare as bars and the Data Sources tab; those views are no longer in the list:

| View | After | Evidence ledgers |
| --- | ---: | --- |
| Search results | 589 KB | none |
| Methodology, nomenclature | ~550 KB | none |
| Gene explorer, pathway explorer, compare, circadian | ~4,400 KB | internal QC |
| Gene report, pathway report, library, QC, verification | ~5,750 KB | both |

The explorer tabs still reach the internal QC ledger, because export
provenance is built synchronously from it when a file is saved. Loading the
ledger on demand would need every export handler to await it first; that is
left for a separate change.

In a local `vite preview` of the build, the hub recorded no long task, and the
library rendered 350 ms after navigation with one 130 ms long task (evaluating
both ledgers). These are single local runs, not production latency
measurements. The browser smoke pass covered the hub, search results, gene
report, explorer (gene, pathway and QC tabs, dataset info, study details,
changelog), library, methodology and verification, with no console errors.

The release identity, data URLs and scientific bundles are unchanged. Nothing
was deployed.
