// Client for the precomputed cross-dataset QUERY INDEX (see
// scripts/build_query_index.mts, which emits public/query/**).
//
// The index inverts the corpus from (track -> all genes) to (gene -> all tracks),
// sharded so a lookup fetches only its slice. A cross-dataset query becomes two
// small requests — the manifest plus one shard — instead of downloading every
// track bundle of every dataset (100 files, 284.5 MB) to read one row from each.
//
// GRACEFUL DEGRADATION IS THE POINT
// ---------------------------------
// Every entry point resolves to `null` rather than rejecting when the index is
// absent, stale, or unparseable, and crossDataset.ts treats null as "fall back to
// the full-download path". That is what makes this safe to ship BEFORE the index
// files are uploaded alongside the bundles: a deployment whose /query/ tree is
// missing keeps working exactly as it did, just slowly. A failed manifest load
// is deliberately NOT cached: it costs one small request per query, and in
// exchange a transient network blip cannot pin the session to the slow path.
//
// Same JSONP convention as the data bundles: a classic script that assigns a
// window global, rather than JSON — bundles may be served cross-origin from R2
// with no CORS policy, and a classic script needs none. Everything about how
// those bytes are fetched lives behind loadOptionalBundle.

import { loadOptionalBundle } from './bundleSource';
import { REBUILD_HINT } from './indexFreshness';
import { reviewedTrackLabel } from './reviewedTrackLabels';
import { assertPlainCatalogValue } from './queryCatalogIdentity';
import type { Dataset } from '../types';
import { DEFAULT_FDR_CUTOFF } from '../statistics/policy';
import {
  EXPR_SHARDS, GENE_SHARDS, PATHWAY_SHARDS, exprShard, geneShard, padShard, pathwayShard,
  trackPathwaysFile, trackPathwaysGlobal,
} from './queryWire';

// The wire format — shard counts and the key hash — is shared with the
// generator (scripts/build_query_index.mts) rather than re-typed here. Both
// sides used to carry identical copies under "MUST match the other side".
const pad = padShard;

/** One (dataset, track) pair, with the per-track context a report row needs.
 *  Carrying label/type/lowPower here is what lets the query skip loading every
 *  per-dataset meta.js file as well as the track bundles. */
export interface QueryTrackEntry {
  ds: string;
  trackId: string;
  label: string;
  type: string;
  lowPower: boolean;
}

export interface QueryManifest {
  v: number;
  /** Identifies the generator run. Every shard carries the same value. */
  buildId: string;
  geneShards: number;
  pathwayShards: number;
  /**
   * Present only on indexes built with the expression family. Its ABSENCE is
   * the whole capability check (see manifestSupportsExpr): an older index is
   * perfectly good for the gene and pathway queries, so it must not be refused
   * outright - only the expression-backed view falls back.
   */
  exprShards?: number;
  dbNames: string[];
  /** Tracks per dataset id, as counted at index-build time. Compared against
   *  any already-loaded meta.js to catch a bundle redeploy that added/removed
   *  tracks without an index rebuild. Optional: manifests published before
   *  this field simply skip that check. */
  trackCounts?: Record<string, number>;
  tracks: QueryTrackEntry[];
  /** Per-dataset browse summaries for the dataset library (manifest v2+).
   *  Optional: a v1 manifest simply has none, and ./datasetCatalog degrades to
   *  registry-only cards rather than fanning out over every meta.js file. */
  datasets?: DatasetSummary[];
  /**
   * The TRACK-PATHWAYS family: the manifest positions of every track that has
   * a pathway result (and therefore a file), and the padj cutoff that selected
   * the rows in those files. Optional: an index built before the family exists
   * is still good for every other lookup, so only the search portal's
   * condition-pathways card checks it (see manifestSupportsTrackPathways).
   */
  trackPathways?: { fdr: number; tracks: number[] };
}

/**
 * One dataset's precomputed browse facts. MUST match the DatasetSummary emitted
 * by scripts/build_query_index.mts — the two are a wire contract.
 *
 * `nBaseline`/`nCase` are the DEFAULT track's replicate counts, mapped from
 * meta.js's legacy `nNormal`/`nObese` keys (which mean baseline/case on every
 * dataset, whatever its arms are called). `nVaries` reports whether the rest of
 * the dataset's tracks agree with them.
 */
export interface DatasetSummary {
  ds: string;
  trackCount: number;
  defaultTrack: string;
  trackLabel: string;
  nGenes: number | null;
  nBaseline: number | null;
  nCase: number | null;
  nVaries: boolean;
  lowPowerTracks: number;
  // ── Expression scaffolding (indexes built with the expression family) ──────
  // An ExprIndexRow is bare numbers in an order; these say which sample each
  // one is and which arm claims it. Optional because an older index has none,
  // and a summary missing them can only mean "fall back", never "no samples".
  /** The default track's sample ids, in the order its expression rows run. */
  sampleOrder?: string[];
  /** The default track's arm key -> sample ids. */
  groupSamples?: Record<string, string[]>;
  /**
   * The contrast whose DE table, arms and expression rows this summary
   * describes - the registry's default at index-build time. The client compares
   * it against the contrast it is about to render with, so a dataset that
   * gained a contrast since the last index build cannot show the default
   * contrast's numbers under another contrast's labels.
   */
  contrastId?: string | null;
  /** Baseline/case group keys. Optional only for manifests built before this field existed. */
  armKeys?: string[];
  /**
   * What the default track found, at DEFAULT_FDR_CUTOFF.
   *
   * OPTIONAL, and the optionality is load-bearing. Zero is a real and common
   * answer here - 38% of single-track datasets find no genes at FDR 0.05 - so a
   * manifest built before this field existed must leave the card's result bars
   * ABSENT. Defaulting the missing field to zeros would turn "this deploy is
   * older than the feature" into "this study found nothing", which is a
   * scientific claim made out of a version skew.
   */
  discoveries?: DiscoverySummary;
}

/** One database's significant-pathway split. */
export interface PathwayDbCount { up: number; down: number; tested: number }

/** Significant-feature counts for a dataset's default track. See DatasetSummary. */
export interface DiscoverySummary {
  genes: number;
  genesUp: number;
  genesDown: number;
  /** Genes carrying a finite FDR at all - the denominator the card prints. */
  genesTested: number;
  /** Null when the dataset ships no pathway sibling: not computed, not none. */
  paths: number | null;
  pathsUp: number | null;
  pathsDown: number | null;
  pathsTested: number | null;
  pathsByDb: Record<string, PathwayDbCount> | null;
  /** Indexed tracks of this dataset with at least one significant gene. */
  tracksWithGenes: number;
}

/** The hover popover's volcano cloud for one dataset's default track. */
export interface CardDetail {
  /** [logFC, -log10(FDR)], downsampled at build time. */
  pts: Array<[number, number]>;
  xlim: number;
  ymax: number;
  ycut: number;
  track: string;
}

/** Shards ship as { b: buildId, d: payload } so the id travels with the data. */
interface ShardEnvelope<T> { b: string; d: T }

/** [trackIdx, logFC, pval, fdr, se] — se is null when the source bundle had none. */
export type GeneIndexRow = [number, number | null, number | null, number | null, number | null];
/** [trackIdx, NES, padj, pval, size, dbIdx] */
export type PathwayIndexRow = [number, number | null, number | null, number | null, number, number];
/**
 * [trackIdx, perSampleValues, sym?] - one gene's expression in one track.
 *
 * `trackIdx` indexes the SAME manifest track array the gene and pathway rows
 * use. `sym` is the source symbol, sent only when it differs from the row's
 * uppercase key, so a chart can print the dataset's own spelling (macaque POMC,
 * mouse Pomc) from a case-insensitive lookup. A null cell is a value the source
 * bundle did not carry; it is dropped, never read as a zero.
 */
export type ExprIndexRow = [number, Array<number | null>, string?];
/**
 * [PATHWAY, NES, padj, size, dbIdx, sigTracks, testedTracks] - one significant
 * pathway of one track, copied from that pathway's own index row, so it agrees
 * with the pathway portal and report by construction. PATHWAY is the uppercase
 * pathway-index key (the stored gs_name). The last two are the pathway's corpus
 * base rate: the pathway-capable tracks where it is significant at the family's
 * cutoff, and those where it was tested at all. They are the same in every file
 * that lists the pathway.
 */
export type TrackPathwayRow = [string, number, number, number, number, number, number];

// ── Script-tag loader, mirroring loadTrack.ts's contract ────────────────────
// Resolves the already-set global without injecting (test-seeded or previously
// loaded), dedupes concurrent calls to one request by returning the SAME promise,
// and resolves null on any failure instead of rejecting.

// Every index file is an OPTIONAL bundle: it may not have been uploaded yet, or
// the deploy may predate the index. Absent -> null, cached, so a whole session
// costs one failed request rather than one per query.
//
// The seam keys its cache by URL rather than by global key, which matters
// specifically here: the shard globals (HX_QUERY_GENES_042) are reused across
// build ids while the URL carries the build id, so a global-key cache could pin
// an old build's shard for the session.
const loadJsonp = loadOptionalBundle;

// The index lives beside the bundles, so it inherits the same origin. Any
// dataset's bundleBaseUrl works — they are all projections of the one
// BUNDLE_BASE in bundleBase.ts.
function baseUrl(datasets: Dataset[]): string {
  return datasets[0]?.bundleBaseUrl || '';
}

/** The manifest, or null when the index is unavailable. */
export function loadQueryManifest(datasets: Dataset[]): Promise<QueryManifest | null> {
  return loadJsonp<QueryManifest>(`${baseUrl(datasets)}/query/tracks.js`, 'HX_QUERY_TRACKS').then((m) => {
    if (!m) return null;
    try { assertPlainCatalogValue(m); } catch { return null; }
    if (!Array.isArray(m.tracks) || m.tracks.length === 0) return null;
    // A manifest built with different shard counts would send every lookup to
    // the wrong URL. Refuse it and fall back rather than serve silent misses —
    // a missing shard is indistinguishable from "gene not present in any track",
    // so this would otherwise surface as an empty report, not an error.
    if (m.geneShards !== GENE_SHARDS || m.pathwayShards !== PATHWAY_SHARDS) {
      console.warn(
        `[queryIndex] shard-count mismatch (manifest ${m.geneShards}/${m.pathwayShards}, ` +
        `client ${GENE_SHARDS}/${PATHWAY_SHARDS}) — ignoring the index and using the full-download path. ` +
        REBUILD_HINT,
      );
      return null;
    }
    return {
      ...m,
      tracks: m.tracks.map((track) => ({ ...track, label: reviewedTrackLabel(track.ds, track.trackId, track.label) })),
      datasets: m.datasets?.map((summary) => ({ ...summary, trackLabel: reviewedTrackLabel(summary.ds, summary.defaultTrack, summary.trackLabel) })),
    };
  });
}

/**
 * Unwrap a shard, rejecting one that came from a different generator run.
 *
 * This check is what makes "key missing from the shard" safe to treat as real
 * absence. A shard's row positions are indices into the MANIFEST's track array,
 * so a shard and manifest from different builds do not merely disagree — they
 * silently map every row to the wrong track. Browser cache, CDN edge and a
 * half-finished upload can all produce that pairing, and none of them looks like
 * an error. Refusing the mismatch turns invisible corruption into a fallback.
 */
function unwrap<T>(shard: ShardEnvelope<T> | null, expectBuildId: string, what: string): T | null {
  if (!shard) return null;
  if (typeof shard.b !== 'string' || typeof shard.d === 'undefined') {
    console.warn(`[queryIndex] ${what} is not a build-stamped shard — ignoring the index.`);
    return null;
  }
  if (shard.b !== expectBuildId) {
    console.warn(
      `[queryIndex] ${what} is from build ${shard.b} but the manifest is build ${expectBuildId} — ` +
      'ignoring the index and using the full-download path. Redeploy public/query/ as one set.',
    );
    return null;
  }
  return shard.d;
}

/** Rows for one gene, keyed by the manifest's track order. null = index absent
 *  or unusable. An empty array means the index was consulted and the gene is in
 *  no track — the caller must keep that distinction to choose fallback vs
 *  "absence reads as absence". */
export function loadGeneRows(datasets: Dataset[], gene: string, buildId: string): Promise<GeneIndexRow[] | null> {
  const KEY = gene.toUpperCase();
  const i = geneShard(KEY);
  const name = `${buildId}/genes/g${pad(i)}.js`;
  return loadJsonp<ShardEnvelope<Record<string, GeneIndexRow[]>>>(
    `${baseUrl(datasets)}/query/${name}`,
    `HX_QUERY_GENES_${pad(i)}`,
  ).then((shard) => {
    const data = unwrap(shard, buildId, name);
    return data ? data[KEY] ?? [] : null;
  });
}

/**
 * Whether an index carries the EXPRESSION family.
 *
 * Deliberately NOT folded into loadQueryManifest's validation, which every
 * query goes through. An index built before this family existed is entirely
 * correct for the gene and pathway lookups, so refusing it there would drag two
 * working fast paths down with the one that is missing. Only the caller that
 * needs expression asks.
 *
 * Shard-count equality, not mere presence: the shard for a key is a pure
 * function of the count, so a manifest built with a different one would send
 * every lookup to a URL that cannot hold the key - and a missing shard is
 * indistinguishable from "this gene is in no dataset".
 */
export function manifestSupportsExpr(manifest: QueryManifest): boolean {
  return manifest.exprShards === EXPR_SHARDS;
}

/** Per-sample expression rows for one gene. Same null/empty distinction as
 *  loadGeneRows: null = the index could not be read, [] = it was read and the
 *  gene is in no default track. */
export function loadExprRows(datasets: Dataset[], gene: string, buildId: string): Promise<ExprIndexRow[] | null> {
  const KEY = gene.toUpperCase();
  const i = exprShard(KEY);
  const name = `${buildId}/expr/e${pad(i)}.js`;
  return loadJsonp<ShardEnvelope<Record<string, ExprIndexRow[]>>>(
    `${baseUrl(datasets)}/query/${name}`,
    `HX_QUERY_EXPR_${pad(i)}`,
  ).then((shard) => {
    const data = unwrap(shard, buildId, name);
    return data ? data[KEY] ?? [] : null;
  });
}

/**
 * Sorted union of every gene symbol (UPPERCASED) across the indexed default
 * tracks, for the cross-dataset gene picker. Uppercase collapses the species
 * spellings to one entry each (49,145 rather than 60,776); the charts recover
 * each dataset's own casing from its expression row. Null when unavailable.
 *
 * Like loadPathwayNames this does NOT verify the build id: a stale union shows
 * slightly stale suggestions, not wrong data, and requiring a match would make
 * autocomplete pay for a manifest fetch of its own.
 */
export function loadGeneNames(datasets: Dataset[], buildId: string): Promise<string[] | null> {
  return loadJsonp<ShardEnvelope<string[]>>(
    `${baseUrl(datasets)}/query/${buildId}/gene_names.js`,
    'HX_QUERY_GENE_NAMES',
  ).then((wrapped) => {
    const names = wrapped && typeof wrapped === 'object' && 'd' in wrapped ? wrapped.d : null;
    return Array.isArray(names) && names.length > 0 ? names : null;
  });
}

/** Rows for one pathway. Same null/empty distinction as loadGeneRows. */
export function loadPathwayRows(datasets: Dataset[], pathway: string, buildId: string): Promise<PathwayIndexRow[] | null> {
  const KEY = pathway.toUpperCase();
  const i = pathwayShard(KEY);
  const name = `${buildId}/pathways/p${pad(i)}.js`;
  return loadJsonp<ShardEnvelope<Record<string, PathwayIndexRow[]>>>(
    `${baseUrl(datasets)}/query/${name}`,
    `HX_QUERY_PATHWAYS_${pad(i)}`,
  ).then((shard) => {
    const data = unwrap(shard, buildId, name);
    return data ? data[KEY] ?? [] : null;
  });
}

/**
 * Whether an index carries the TRACK-PATHWAYS family, selected at the cutoff
 * this client calls significant. A family built at another cutoff would list
 * the wrong pathways under this client's "FDR < 0.05", so it counts as absent.
 */
export function manifestSupportsTrackPathways(manifest: QueryManifest): boolean {
  const family = manifest.trackPathways;
  return !!family && family.fdr === DEFAULT_FDR_CUTOFF && Array.isArray(family.tracks);
}

/**
 * The significant pathways of the manifest track at `trackIdx`, most
 * significant first. `[]` is a measured "none at this cutoff"; null means the
 * file could not be read, carries another build's stamp, or names a different
 * track than the manifest puts at that position. Callers check
 * manifest.trackPathways.tracks first: a track missing from that list has no
 * pathway analysis, and this loader is not the way to find that out.
 */
export function loadTrackPathways(
  datasets: Dataset[],
  manifest: QueryManifest,
  trackIdx: number,
): Promise<TrackPathwayRow[] | null> {
  const entry = manifest.tracks[trackIdx];
  if (!entry) return Promise.resolve(null);
  const name = `${manifest.buildId}/${trackPathwaysFile(trackIdx)}`;
  return loadJsonp<ShardEnvelope<{ ds: string; trackId: string; rows: TrackPathwayRow[] }>>(
    `${baseUrl(datasets)}/query/${name}`,
    trackPathwaysGlobal(trackIdx),
  ).then((shard) => {
    const data = unwrap(shard, manifest.buildId, name);
    if (!data || data.ds !== entry.ds || data.trackId !== entry.trackId || !Array.isArray(data.rows)) return null;
    return data.rows;
  });
}

/**
 * Sorted union of every pathway gs_name, for the search autocomplete.
 * Replaces a fan-out over all 41 per-dataset pathways_index.js files (5.52 MB,
 * 41 requests) whose union is only ~5k names — MSigDB gs_names are species-stable,
 * so the per-dataset lists overlap almost entirely. Null when unavailable.
 */
export function loadPathwayNames(datasets: Dataset[], buildId: string): Promise<string[] | null> {
  return loadJsonp<ShardEnvelope<string[]>>(
    `${baseUrl(datasets)}/query/${buildId}/pathway_names.js`,
    'HX_QUERY_PATHWAY_NAMES',
  ).then((wrapped) => {
    // Autocomplete only — a build-id mismatch here would show slightly stale
    // suggestions, not wrong data, so this deliberately does NOT verify the id
    // (it has no manifest to compare against, and requiring one would make the
    // autocomplete pay for a manifest fetch it does not otherwise need).
    const names = wrapped && typeof wrapped === 'object' && 'd' in wrapped ? wrapped.d : null;
    return Array.isArray(names) && names.length > 0 ? names : null;
  });
}
/**
 * The JSONP global a card-detail file assigns. A wire contract with
 * cardGlobalName in scripts/build_query_index.mts; the two are pinned together
 * by a test rather than by convention.
 */
export function cardGlobalName(ds: string): string {
  return `HX_QUERY_CARD_${ds.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

/**
 * The volcano cloud behind a library card's hover popover.
 *
 * Its own file, on purpose. The two obvious alternatives are both wrong: the
 * manifest is fetched on every visit and 161 clouds would add ~1.5 MB to it,
 * and the track bundle holding the real DE table is 2.6 MB at the median, which
 * is not a thing to download because a pointer crossed a bar. This is ~10 KB,
 * fetched when a popover actually opens, and cached by the bundle seam for the
 * session.
 *
 * Null when absent (an index predating the feature, or a dataset whose declared
 * default track failed to index). The popover then shows its counts without a
 * plot, which is the honest degradation: the counts came from the manifest and
 * are still true.
 */
export function loadCardDetail(dataset: Dataset, buildId: string): Promise<CardDetail | null> {
  const name = `${buildId}/cards/${dataset.id}.js`;
  return loadJsonp<ShardEnvelope<CardDetail>>(
    `${dataset.bundleBaseUrl || ''}/query/${name}`,
    cardGlobalName(dataset.id),
  ).then((shard) => {
    const data = unwrap(shard, buildId, name);
    return data && Array.isArray(data.pts) ? data : null;
  });
}

// No reset hook of its own any more: the index files live in the one bundle
// cache, so _resetTrackCache clears them too. The old hook existed only because
// this module owned a private cache that a caller had to remember to clear.
