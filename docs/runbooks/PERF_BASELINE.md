# Performance baseline

The performance decisions on the app's hot paths, and where to measure them.
Timings depend on the machine and the corpus, so none are recorded here.
Re-check these when you change the files named below.

## Hot paths

- Volcano (`src/gene-explorer/VolcanoPlot.tsx`) draws points to a `<canvas>`
  rather than one SVG element per point, because the macaque default plots about
  12,600 points. Hover hit-testing uses a spatial grid (`GRID_CELL`) so a
  mousemove inspects only nearby cells. The backing store follows
  `devicePixelRatio`, so a monitor change or zoom repaints at full resolution.
- `popDataFor` (`src/data/trackData.ts`) memoizes `buildPopData` in a `WeakMap`
  keyed by the raw track (`src/data/popCache.ts`), so views that fan out over
  tracks do not re-transform on every render. This depends on a loaded raw track
  never being replaced.
- Bundles load by script injection through `src/data/bundleSource.ts`.
  In-flight loads are deduplicated twice: by URL in `bundleSource` and again in
  `src/data/explorerStore.ts`. Compare loads only the tracks the user selected.
- Cross-dataset gene and pathway queries read the prebuilt inverted index
  (`src/data/queryIndex.ts`, written by `scripts/build_query_index.mts`): one
  lookup is a few small shards instead of every dataset's bundles. When the index
  is missing or its build id does not match, `src/data/crossDataset.ts` falls
  back to downloading bundles, through an 8-way `mapLimit`. A stale index makes
  queries slow, never wrong.
- Leading-edge gene grids are capped at 50 (`PROFILE_CAP` in
  `src/compare/ComparePathwayView.tsx`, `GENE_CAP` in
  `src/pathway-explorer/LeadingEdgeGenesView.tsx`) with a "show all" control,
  because GO pathways can have 200 to 300 genes.
- Sort keys are computed once before sorting (for example `maxAbsNES` in
  `ComparePathwayView.tsx`), not inside the comparator.
- `index.html` has no eager data script tags. `xlsx` and `html2canvas` load
  through `src/utils/lazyExport.ts`, and the charting libraries sit behind
  dynamic imports, so they stay out of the first-paint bundle.

## Where to measure

- Wasted renders: the React DevTools Profiler on the Gene and Compare tabs while
  switching tracks and dragging the volcano thresholds.
- Volcano paint cost: the canvas paint effect in `VolcanoPlot.tsx`.
- Load size: the `pnpm run build` output. Check that a new import has not pulled
  `xlsx`, `html2canvas` or the chart libraries into the eager graph.

## Regressions to watch

- Per-point SVG rendering, or hit-testing every point on mousemove.
- Losing the transform cache or the in-flight deduplication. Entering Compare
  then triggers repeated `buildPopData` and `setState` calls.
- Uncapped leading-edge grids.
- An eager data script tag in `index.html`, or a static import of `xlsx`,
  `html2canvas` or the chart libraries from an eagerly loaded module.
- A cross-dataset query that silently runs on the fallback path. Rebuild the
  index rather than tolerating it.

The query index still builds an expression family (`expr/` shards). Since the
"Compare as bars" view was removed on 2026-11-20, its reader `loadExprRows` has
no caller outside `queryWire.test.ts`. Either remove the family or give it a
consumer.
