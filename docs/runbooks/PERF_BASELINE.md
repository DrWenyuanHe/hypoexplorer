# Performance baseline

Reference for the performance-relevant design decisions in the HypoExplorer app
(`src/`). It records *what* is optimized and *where* to measure, not fixed timing
numbers (those depend on machine + dataset). Re-check these when touching the hot paths.

## Hot paths & current strategy

- **Volcano point cloud** (`src/gene-explorer/VolcanoPlot.tsx`): rendered to a
  `<canvas>` (not thousands of SVG `<circle>`s) — the macaque default plots ~12.6k
  points. Hit-testing uses a 40px **spatial grid** so a hover inspects only the 9
  cells around the cursor, not every point. The canvas backing store is sized by
  `devicePixelRatio` (tracked in state) so a monitor switch / zoom repaints crisply.
- **Transformed popData cache** (`src/data/popCache.ts`): `popDataFor` (in
  `src/data/trackData.ts`) memoizes `buildPopData` per (raw track, dataset, contrast)
  in a `WeakMap`, so Compare's per-render fan-out doesn't re-transform. Relies on the
  "raw track never replaced" invariant in `loadTrack.ts`.
- **Track loading** (`src/data/bundleSource.ts` → `src/data/trackData.ts` →
  `src/data/explorerStore.ts`): bundles are lazy-loaded by injecting a `<script>`;
  in-flight loads are de-duplicated at **both** the transport layer (`bundleSource`'s
  URL-keyed cache) and the React layer (`explorerStore`). Compare lazy-loads only the
  tracks the user selected (not all 60), and the cross-dataset Compare fan-out — now
  the FALLBACK path only, see the expression index below — runs through an 8-way
  `mapLimit` budget instead of an unbounded `Promise.all`.
- **Cross-dataset queries** (`src/data/queryIndex.ts`): served from a prebuilt
  inverted index (`public/query/`, built by `scripts/build_query_index.mts`) — one
  gene/pathway lookup costs 2 requests (~98 KB) instead of downloading every dataset's
  bundles (~284.5 MB / ~1 GB heap). Falls back to the full-download path when the
  index is missing or its build id mismatches.
- **Cross-dataset Compare** (`src/data/crossDatasetCompare.ts`): the bar-chart view
  needs a gene's PER-SAMPLE values, which no gene-index row carries, so it went on
  downloading every dataset's default track in full. Measured on the 43-dataset
  corpus: **43 requests / 148.4 MB**. It now reads an EXPRESSION family in the same
  index (`query/<buildId>/expr/e<NNN>.js`, default tracks only) plus the per-dataset
  sample scaffolding carried in the manifest, and builds each chart's `PopData`
  through the ordinary `buildPopData` transform from a one-gene `RawTrack`. Measured
  in the browser: **4 requests / ~720 KB uncompressed**, of which 242 KB is the
  charts (manifest + gene shard + expr shard) and 478 KB is the `gene_names.js`
  autocomplete union, loaded independently so it never delays a bar. A gene switch
  costs 2 more shards. Same fallback contract as above: a stale, absent or
  unvalidatable index degrades to the 148 MB path, never to a wrong chart.
- **Pathway / leading-edge tables**: paginated (page-size picker) and leading-edge
  gene-profile grids are **capped** (e.g. `PROFILE_CAP` / `GENE_CAP` = 50) with a
  "show all" escape hatch, so a 200–300-gene GO pathway doesn't render unbounded.
- **Sort comparators**: precompute the sort key once (e.g. `_maxAbsNES`) instead of
  recomputing inside the comparator on every compare.

## Where to measure

- React renders / wasted work: React DevTools Profiler on the Gene + Compare tabs
  while switching tracks and dragging the volcano thresholds.
- Volcano paint cost: the `useEffect` canvas paint in `VolcanoPlot.tsx` (deps:
  point arrays, `svgSize`, `dpr`).
- Bundle / load size: `npm run build` output. Since v0.7.1.0 `index.html` ships **no
  eager data `<script>` tags** (was 3.78 MB of parser-blocking script), and `xlsx`,
  `html2canvas`, and `recharts`+`d3` sit behind dynamic imports — watch that new
  imports don't pull them back into the eager graph.

## Regressions to watch

- Re-introducing per-point SVG rendering, or hit-testing every point on mousemove.
- Dropping the `WeakMap` transform cache or the in-flight de-dup (causes redundant
  `buildPopData` / `setState` storms when entering Compare).
- Unbounded rendering of leading-edge gene grids.
- Re-adding an eager data `<script>` tag to `index.html`, or importing `xlsx` /
  `html2canvas` / `recharts` statically from an eagerly-loaded module.
- Regressing a cross-dataset query onto the full-download path (a stale query index
  degrades to slow, never to wrong — but it should be rebuilt, not tolerated).
