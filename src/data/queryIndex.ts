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
  type CardDetail, type ExprIndexRow, type GeneIndexRow, type PathwayIndexRow, type QueryManifest,
  type ShardEnvelope, type TrackPathwayRow, type TrackPathwaysPayload,
  EXPR_SHARDS, GENE_NAMES_FILE, GENE_NAMES_GLOBAL, GENE_SHARDS, MANIFEST_FILE, MANIFEST_GLOBAL,
  PATHWAY_NAMES_FILE, PATHWAY_NAMES_GLOBAL, PATHWAY_SHARDS,
  cardFile, cardGlobalName, exprShard, exprShardFile, exprShardGlobal, geneShard, geneShardFile, geneShardGlobal,
  indexKey, pathwayShard, pathwayShardFile, pathwayShardGlobal, trackPathwaysFile, trackPathwaysGlobal,
} from './queryWire';

// This module is the READ adapter of ./queryWire, which owns the whole wire
// format — shard counts and the key hash, every file path and JSONP global, the
// manifest and summary shapes, and the row layouts. The generator
// (scripts/build_query_index.mts) is the write adapter of the same module, so
// neither side carries a copy that could drift. The wire types are re-exported
// here because callers reach the index through this client.
export type {
  CardDetail, DatasetSummary, DiscoverySummary, ExprIndexRow, GeneIndexRow, PathwayIndexRow, QueryManifest,
  QueryTrackEntry, TrackPathwayRow,
} from './queryWire';

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

/**
 * One key's rows from a keyed shard family (genes, pathways, expression): the
 * key's shard is a pure function of the key, so this is one request. null =
 * the shard could not be used; [] = it was read and the key is in no track.
 */
function loadKeyedRows<R>(
  datasets: Dataset[],
  name: string,
  buildId: string,
  family: { shardOf: (key: string) => number; file: (shard: number) => string; global: (shard: number) => string },
): Promise<R[] | null> {
  const KEY = indexKey(name);
  const i = family.shardOf(KEY);
  const file = `${buildId}/${family.file(i)}`;
  return loadJsonp<ShardEnvelope<Record<string, R[]>>>(`${baseUrl(datasets)}/query/${file}`, family.global(i))
    .then((shard) => {
      const data = unwrap(shard, buildId, file);
      return data ? data[KEY] ?? [] : null;
    });
}

/** The manifest, or null when the index is unavailable. */
export function loadQueryManifest(datasets: Dataset[]): Promise<QueryManifest | null> {
  return loadJsonp<QueryManifest>(`${baseUrl(datasets)}/query/${MANIFEST_FILE}`, MANIFEST_GLOBAL).then((m) => {
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
  return loadKeyedRows(datasets, gene, buildId, { shardOf: geneShard, file: geneShardFile, global: geneShardGlobal });
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
  return loadKeyedRows(datasets, gene, buildId, { shardOf: exprShard, file: exprShardFile, global: exprShardGlobal });
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
    `${baseUrl(datasets)}/query/${buildId}/${GENE_NAMES_FILE}`,
    GENE_NAMES_GLOBAL,
  ).then((wrapped) => {
    const names = wrapped && typeof wrapped === 'object' && 'd' in wrapped ? wrapped.d : null;
    return Array.isArray(names) && names.length > 0 ? names : null;
  });
}

/** Rows for one pathway. Same null/empty distinction as loadGeneRows. */
export function loadPathwayRows(datasets: Dataset[], pathway: string, buildId: string): Promise<PathwayIndexRow[] | null> {
  return loadKeyedRows(datasets, pathway, buildId, {
    shardOf: pathwayShard, file: pathwayShardFile, global: pathwayShardGlobal,
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
  return loadJsonp<ShardEnvelope<TrackPathwaysPayload>>(
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
    `${baseUrl(datasets)}/query/${buildId}/${PATHWAY_NAMES_FILE}`,
    PATHWAY_NAMES_GLOBAL,
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
  const name = `${buildId}/${cardFile(dataset.id)}`;
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
