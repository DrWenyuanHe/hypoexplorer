// Cross-dataset gene query: one gene's differential-expression stats across
// EVERY track of EVERY registered dataset, so the gene report (the hub's
// "Explore all") can compare a single-cell population against a bulk tissue on
// one axis.
//
// Each track bundle carries the full per-gene DE table, so the first query for
// any gene warms the track cache (loadTrack memoizes); subsequent genes resolve
// from cache instantly. A track that lacks the gene (filtered upstream) yields
// no row rather than a zero, so absence reads as absence.

import { listDatasets } from './datasets';
import { getActiveContrast } from './contrasts';
import { loadDatasetMeta, peekDatasetMeta } from './loadDatasetMeta';
import { loadTrack, loadPathways, loadPathwayIndexForDataset } from './loadTrack';
import {
  loadQueryManifest, loadGeneRows, loadPathwayRows, loadPathwayNames, loadGeneNames,
  type GeneIndexRow, type PathwayIndexRow, type QueryManifest, type QueryTrackEntry,
} from './queryIndex';
import { geneRow, pathwayRow } from './crossDatasetRows';
import { manifestFreshness, REBUILD_HINT } from './indexFreshness';
import { strictDeTableFor, strictSiblingPathwaysFor } from './rawTrack';
import { isLowPower } from '../utils/qcFlags';
import { mapLimit } from '../utils/mapLimit';
import type {
  CrossDatasetGeneReport,
  CrossDatasetPathwayReport,
  Dataset,
  DatasetGroup,
  DatasetMeta,
  DbName,
  GroupSummary,
  PathwayRecord,
  PathwaySibling,
  PathwayTrackRow,
  ResolvedContrast,
  TrackRow,
} from '../types';

// Cap in-flight track/sibling <script> injections ACROSS the whole query. Each
// track is a separate network request + parse; ~8 keeps the pipe full without
// flooding the main thread when a dataset has many tracks (the 60-population
// macaque atlas).
//
// This budget is GLOBAL, not per-dataset. It used to be applied inside a
// `for (const {ds, m} of metas)` loop that awaited one dataset's entire fan-out
// before starting the next — so the 40 single-track mouse datasets ran strictly
// one after another, serialising ~40 round trips (several seconds of pure
// latency) that the concurrency budget was nowhere near saturated by. Flattening
// every (dataset, track) pair into one queue keeps 8 requests in flight from the
// first tick to the last regardless of how the tracks are distributed across
// datasets.
const FANOUT = 8;

// One unit of cross-dataset work: a track, plus the dataset/meta context needed
// to turn it into a row. Building this list up front is what lets a single
// mapLimit span every dataset.
interface TrackJob {
  ds: Dataset;
  meta: DatasetMeta;
  trackId: string;
  groupIndex: number;
}

// Resolve every dataset's meta, then flatten to a single job list.
// A meta that fails to load degrades to an empty, flagged group rather than
// aborting the whole query — and contributes no jobs.
async function planQuery(datasets: Dataset[]): Promise<{
  jobs: TrackJob[];
  groups: Array<{ dataset: Dataset; contrast: ResolvedContrast | null; error?: boolean }>;
  total: number;
}> {
  const metas = await Promise.all(
    datasets.map((ds) =>
      loadDatasetMeta(ds)
        .then((m) => ({ ds, m }))
        .catch(() => ({ ds, m: null as DatasetMeta | null })),
    ),
  );

  const jobs: TrackJob[] = [];
  const groups: Array<{ dataset: Dataset; contrast: ResolvedContrast | null; error?: boolean }> = [];
  for (const { ds, m } of metas) {
    const contrast = getActiveContrast(ds);
    const groupIndex = groups.length;
    if (!m) {
      groups.push({ dataset: ds, contrast, error: true });
      continue;
    }
    groups.push({ dataset: ds, contrast });
    for (const trackId of m.populations || []) {
      jobs.push({ ds, meta: m, trackId, groupIndex });
    }
  }
  return { jobs, groups, total: jobs.length };
}

/** What a query produces on EITHER path (runTrackQuery / runIndexQuery): the
 *  per-dataset groups, plus the counts the progress bar reports. Structurally a
 *  DatasetGroup[] / PathwayDatasetGroup[] once `Row` is bound. */
interface TrackQueryResult<Row> {
  total: number;
  loaded: number;
  groups: Array<{ dataset: Dataset; contrast: ResolvedContrast | null; error?: boolean; tracks: Row[] }>;
}

/** What a step needs beyond its job: the dataset's active contrast, and the
 *  progress tick to call once the track's data is in hand. */
interface TrackQueryContext {
  contrast: ResolvedContrast | null;
  tick: () => void;
}

/**
 * The full-download path, shared by both statistics: plan every (dataset, track)
 * pair, fan out over ONE queue, and re-group the rows back into the caller's
 * dataset order.
 *
 * Generic over the row type, the way usePathwayTable is: all this owes a query
 * is the pipeline — what a row IS, and which tracks are dropped, belong to the
 * query's own `step`. `step` returns null to drop a track (the gene/pathway is
 * absent there), and calls `tick` itself as soon as the track's data has
 * arrived, so progress advances on the LOAD — the part the user waits on —
 * rather than on the shaping that follows it.
 */
async function runTrackQuery<Row>(
  datasets: Dataset[],
  onProgress: ((loaded: number, total: number) => void) | undefined,
  step: (job: TrackJob, ctx: TrackQueryContext) => Promise<Row | null>,
): Promise<TrackQueryResult<Row>> {
  const { jobs, groups: plan, total } = await planQuery(datasets);
  let loaded = 0;
  const tick = () => { loaded++; onProgress?.(loaded, total); };

  // ONE queue across every dataset (see the FANOUT comment).
  const rows = await mapLimit(jobs, FANOUT, async (job): Promise<{ groupIndex: number; row: Row } | null> => {
    try {
      const row = await step(job, { contrast: plan[job.groupIndex].contrast, tick });
      return row === null ? null : { groupIndex: job.groupIndex, row };
    } catch {
      tick();
      return null;
    }
  });

  // Re-group. mapLimit is order-preserving and jobs were built in dataset order,
  // so each group's tracks come out in the same order the serial loop produced.
  const groups = plan.map((g) => ({ ...g, tracks: [] as Row[] }));
  for (const r of rows) if (r) groups[r.groupIndex].tracks.push(r.row);

  return { total, loaded, groups };
}

export interface QueryGeneOptions {
  datasets?: Dataset[];
  onProgress?: (loaded: number, total: number) => void;
}

// ── Index-backed fast path ──────────────────────────────────────────────────
// Both queries try the precomputed index first (2 small requests) and fall back
// to the full-download path when it is unavailable. The fallback is not a
// nicety: it is what lets this ship before public/query/** has been uploaded
// alongside the bundles, and what keeps an older deploy working.
//
// The index returns rows in MANIFEST order, which is (dataset dir name, then the
// dataset's own population order) — not the order of the DATASETS registry the
// report renders in. Rows are therefore bucketed back to the caller's dataset
// list by dataset id rather than by position.

/** Group the manifest's track indices by dataset id, once per manifest. */
function tracksByDataset(manifest: QueryManifest): Map<string, Array<{ idx: number; entry: QueryTrackEntry }>> {
  const byDs = new Map<string, Array<{ idx: number; entry: QueryTrackEntry }>>();
  manifest.tracks.forEach((entry, idx) => {
    const arr = byDs.get(entry.ds);
    if (arr) arr.push({ idx, entry });
    else byDs.set(entry.ds, [{ idx, entry }]);
  });
  return byDs;
}

/**
 * The index-backed path, shared by both statistics — the fast-path twin of
 * `runTrackQuery`: guard the manifest, fetch the key's shard rows, index them by
 * track position, and read each dataset's tracks off in its OWN order.
 *
 * Generic over the shard row and the report row. What stays with the caller is
 * exactly what genuinely differs per statistic: which shard to load, and how one
 * tuple becomes a row — including the drop-guard, since the guards ask different
 * questions (a gene needs an effect size and a p; a pathway needs NES, padj and
 * a p) and a shared one would have to be spelled as a list of field names.
 *
 * `toRow` returns null to drop a track. Resolves null (never a partial report)
 * whenever the index is unusable, so the caller falls back to the full download:
 * a stale index must degrade to SLOW, never to wrong.
 */
async function runIndexQuery<R extends [number, ...unknown[]], Row>(
  datasets: Dataset[],
  loadRows: (manifest: QueryManifest) => Promise<R[] | null>,
  toRow: (row: R, entry: QueryTrackEntry, manifest: QueryManifest) => Row | null,
): Promise<TrackQueryResult<Row> | null> {
  const manifest = await loadQueryManifest(datasets);
  if (!manifest) return null;
  // See indexFreshness: a stale index must degrade to slow, never to wrong.
  const fresh = manifestFreshness(manifest, datasets, ['coverage', 'trackCounts', 'contrast'], {
    metaFor: peekDatasetMeta,
  });
  if (!fresh.ok) {
    console.warn(
      `[queryIndex] the query index cannot answer for this registry — using per-track downloads of meta + bundles + pathway siblings:\n  `
      + `${fresh.problems.join('\n  ')}\n${REBUILD_HINT}`,
    );
    return null;
  }
  const rows = await loadRows(manifest);
  if (rows === null) return null;   // index absent — NOT the same as "in no track"

  // trackIdx -> row, so each dataset's tracks can be read off in its own order.
  const byTrackIdx = new Map<number, R>();
  for (const r of rows) byTrackIdx.set(r[0], r);

  const byDs = tracksByDataset(manifest);
  let total = 0;
  const groups = datasets.map((ds) => {
    const entries = byDs.get(ds.id) || [];
    total += entries.length;
    const tracks: Row[] = [];
    for (const { idx, entry } of entries) {
      const r = byTrackIdx.get(idx);
      if (!r) continue;             // not measured in this track — absence reads as absence
      const row = toRow(r, entry, manifest);
      if (row !== null) tracks.push(row);
    }
    return { dataset: ds, contrast: getActiveContrast(ds), tracks };
  });

  // loaded === total: the index answers in one request, so there is no partial
  // state for a progress bar to report.
  return { total, loaded: total, groups };
}

/**
 * One gene across every dataset, from the index.
 * Resolves null when the index is unavailable, so the caller can fall back.
 * Exported for the search portal (src/search/searchSummaries.ts), which wants
 * the index answer or nothing: it must never pay for the full download.
 */
export async function queryGeneViaIndex(
  gene: string,
  datasets: Dataset[],
): Promise<CrossDatasetGeneReport | null> {
  const res = await runIndexQuery<GeneIndexRow, TrackRow>(
    datasets,
    (manifest) => loadGeneRows(datasets, gene, manifest.buildId),
    ([, logFC, pval, fdr, se], entry) => {
      // A row without an effect size or a p-value is not a usable result; drop
      // it rather than fabricate a value. (Measured: 0 of 1,319,978 index rows
      // are missing either, so this is a guard, not a filter. `se` is the one
      // field that IS legitimately absent on some tracks — 110 rows — and it
      // stays null so those tracks plot a dot with no interval.)
      if (logFC === null || pval === null) return null;
      return geneRow({
        trackId: entry.trackId,
        label: entry.label,
        type: entry.type,
        logFC,
        fdr,
        pval,
        // Kept PER TRACK: the forest draws each track's OWN 95% CI whisker
        // from it. Nothing combines SEs across tracks or across datasets — the
        // studies are not interchangeable, so the report never pools them.
        se,
        // Read off the manifest, not computed: the generator already resolved
        // the QC flag, so this path never loads the meta.js isLowPower needs.
        lowPower: entry.lowPower,
      });
    },
  );
  return res && { gene, ...res };
}

/** One pathway across every pathway-capable dataset, from the index. Index-only
 *  like queryGeneViaIndex; the caller passes the pathway-capable datasets. */
export async function queryPathwayViaIndex(
  pathway: string,
  datasets: Dataset[],
): Promise<CrossDatasetPathwayReport | null> {
  const res = await runIndexQuery<PathwayIndexRow, PathwayTrackRow>(
    datasets,
    (manifest) => loadPathwayRows(datasets, pathway, manifest.buildId),
    ([, NES, padj, pval, size, dbIdx], entry, manifest) => {
      // pval is required too: `pval ?? 0` would render a missing p-value as
      // maximally significant. The full-download path never emits such a row,
      // so dropping it keeps the fast and slow paths answering alike.
      if (NES === null || padj === null || pval === null) return null;
      return pathwayRow({
        trackId: entry.trackId,
        label: entry.label,
        type: entry.type,
        NES,
        padj,
        pval: pval ?? 0,
        size,
        db: (manifest.dbNames[dbIdx] ?? '') as DbName,
      });
    },
  );
  return res && { pathway, ...res };
}

export async function queryGeneAcrossDatasets(
  gene: string,
  opts: QueryGeneOptions = {},
): Promise<CrossDatasetGeneReport> {
  const datasets = opts.datasets || listDatasets();
  // Match case-insensitively so a human/macaque symbol (POMC, LEPR) resolves
  // against mouse nomenclature (Pomc, Lepr) and vice versa. Casing is the
  // dominant cross-species mismatch; symbol-level ortholog mapping is a later
  // refinement, not needed for the common feeding/obesity genes.
  const GENE = String(gene).toUpperCase();

  // Fast path: 2 small requests instead of ~100 track bundles (284 MB). Falls
  // through to the full download when the index is not deployed.
  const fromIndex = await queryGeneViaIndex(GENE, datasets).catch(() => null);
  if (fromIndex) return { ...fromIndex, gene };

  // loadTrack resolves the SLIM track bundle — FGSEA pathways live in a sibling
  // — so the gene query never downloads the pathway tax.
  const { total, loaded, groups } = await runTrackQuery<TrackRow>(
    datasets,
    opts.onProgress,
    async ({ ds, meta: m, trackId }, { contrast, tick }) => {
      const raw = await loadTrack(ds, trackId);
      tick();
      const de = strictDeTableFor(raw, contrast?.id, getActiveContrast(ds)?.id);
      const d = de.find((x) => x.gene && x.gene.toUpperCase() === GENE);
      if (!d) return null;
      return geneRow({
        trackId,
        label: m.labels?.[trackId] || trackId,
        type: m.types?.[trackId] || '',
        logFC: d.logFC,
        fdr: typeof d.FDR === 'number' ? d.FDR : null,
        pval: d.PValue,
        se: typeof d.se === 'number' ? d.se : null,
        // Computed here, unlike the index path: this path has the dataset meta
        // in hand, so it reads the QC flags directly.
        lowPower: isLowPower(m.qcFlags?.[trackId]),
      });
    },
  );

  return { gene, total, loaded, groups };
}

// Compact per-dataset summary for the verdict line + stat tiles: the strongest
// (largest |log2FC| among significant) track, and counts of significant up/down.
export function summarizeGroup(group: DatasetGroup): GroupSummary {
  const sig = group.tracks.filter((t) => t.significant);
  const up = sig.filter((t) => t.direction === 'up').length;
  const down = sig.filter((t) => t.direction === 'down').length;
  const strongest = sig.slice().sort((a, b) => Math.abs(b.logFC) - Math.abs(a.logFC))[0] || null;
  return { up, down, nSig: sig.length, nTracks: group.tracks.length, strongest };
}

// ── Cross-dataset PATHWAY query (the FGSEA analog of queryGeneAcrossDatasets) ──
// One pathway's enrichment (NES/padj) across every track of every PATHWAY-CAPABLE
// dataset. FGSEA is now computed for both macaque (per cell population) and the
// mouse datasets (scripts/run_mouse_fgsea.R), so this resolves across the whole
// resource; gs_names are MSigDB-standard so they join across species.

export interface QueryPathwayOptions {
  datasets?: Dataset[];
  onProgress?: (loaded: number, total: number) => void;
}

export async function queryPathwayAcrossDatasets(
  pathway: string,
  opts: QueryPathwayOptions = {},
): Promise<CrossDatasetPathwayReport> {
  const all = opts.datasets || listDatasets();
  const datasets = all.filter((d) => d.supportsPathways);
  // Pathway tokens are species-stable MSigDB gs_names (HALLMARK_…, GOBP_…), so a
  // case-insensitive exact match is enough; no ortholog mapping needed.
  const NAME = String(pathway).toUpperCase();

  // Fast path — as above. Replaces ~93 MB of pathway siblings, 45% of which is
  // the leadingEdge gene lists this query never reads.
  const fromIndex = await queryPathwayViaIndex(NAME, datasets).catch(() => null);
  if (fromIndex) return { ...fromIndex, pathway };

  // Loads ONLY the pathway sibling (track_<id>.pathways.js) — not the full
  // track — so the pathway query never pays the per-gene CPM/DE tax.
  const { total, loaded, groups } = await runTrackQuery<PathwayTrackRow>(
    datasets,
    opts.onProgress,
    async ({ ds, meta: m, trackId }, { contrast, tick }) => {
      const db = await loadPathways(ds, trackId);
      tick();
      const rec = findPathway(db, ds, contrast?.id, NAME);
      if (!rec) return null;
      return pathwayRow({
        trackId,
        label: m.labels?.[trackId] || trackId,
        type: m.types?.[trackId] || '',
        NES: rec.NES,
        padj: rec.padj,
        pval: rec.pval,
        size: rec.size,
        db: rec.db,
      });
    },
  );

  return { pathway, total, loaded, groups };
}

// Find a gs_name across all DBs of a pathway sibling, tagging it with its DB.
// Equivalent to scanning the old getPopData(...).allPathways (which flattened the
// same per-DB record arrays), but without building the whole popData transform.
// Contrast resolution follows the strict default-witness rule, which lives in
// rawTrack.strictSiblingPathwaysFor next to its gene-side twin.
function findPathway(
  sibling: PathwaySibling | null,
  dataset: Dataset,
  contrastId: string | undefined,
  NAME: string,
): (PathwayRecord & { db: DbName }) | null {
  if (!sibling || !contrastId) return null;
  const { db } = strictSiblingPathwaysFor(sibling, contrastId, getActiveContrast(dataset)?.id);
  if (!db) return null;
  for (const [dbName, recs] of Object.entries(db) as Array<[DbName, PathwayRecord[] | undefined]>) {
    if (!recs) continue;
    const rec = recs.find((p) => p.pathway.toUpperCase() === NAME);
    if (rec) return { ...rec, db: dbName };
  }
  return null;
}

/**
 * Gene symbols across the corpus, for the Gene Explorer's search autocomplete.
 *
 * The gene-side sibling of `loadPathwayIndex`, and deliberately thinner: there
 * is no per-dataset fan-out to fall back on. The pathway version can rebuild its
 * union from each dataset's tiny gs_name manifest, but the gene equivalent would
 * mean downloading every track bundle in the corpus to list what is in them —
 * hundreds of megabytes to populate a suggestion list. So this returns [] when
 * the shared names file is unreachable, and the search box stays usable with no
 * suggestions rather than becoming expensive.
 *
 * SUGGESTIONS ARE NOT THE VOCABULARY. The names file is built from each
 * dataset's DEFAULT track, while the query index spans every track — so a
 * few hundred symbols detected only in a non-default cell population are
 * queryable but never suggested. Callers must let a typed symbol through
 * whether or not it appears here.
 */
export async function loadGeneIndex(opts: { datasets?: Dataset[] } = {}): Promise<string[]> {
  const datasets = opts.datasets || listDatasets();
  const manifest = await loadQueryManifest(datasets).catch(() => null);
  if (!manifest) return [];
  return (await loadGeneNames(datasets, manifest.buildId).catch(() => null)) ?? [];
}

// Union of pathway gs_names across pathway-capable datasets, for the pathway
// search autocomplete. Reads each dataset's tiny gs_name manifest (pathways_index.js)
// — NOT a full track — so the autocomplete is cheap to warm.
export async function loadPathwayIndex(opts: { datasets?: Dataset[] } = {}): Promise<string[]> {
  const datasets = (opts.datasets || listDatasets()).filter((d) => d.supportsPathways);
  // One 222 KB file instead of 41 requests totalling 5.52 MB, whose union this
  // already is. Falls through to the per-dataset fan-out when absent.
  //
  // The manifest fetch is not extra work in practice: it is 11 KB, cached for the
  // session, and the pathway query that follows this autocomplete needs it
  // anyway. It is required here because the names file lives under the build-id
  // prefix, which only the manifest knows.
  const manifest = await loadQueryManifest(datasets).catch(() => null);
  const shared = manifest ? await loadPathwayNames(datasets, manifest.buildId).catch(() => null) : null;
  if (shared) return shared;
  const set = new Set<string>();
  const lists = await Promise.all(
    datasets.map((ds) => loadPathwayIndexForDataset(ds).catch(() => [] as string[])),
  );
  for (const list of lists) for (const name of list) set.add(name);
  return [...set].sort();
}
