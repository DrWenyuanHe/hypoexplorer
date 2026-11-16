// The query index's WIRE FORMAT, whole: shard counts and the key hash, every
// file path and JSONP global name, the manifest and browse-summary shapes, and
// the positional row layouts of every shard family.
//
// The generator (scripts/build_query_index.mts) and the client (./queryIndex.ts)
// are two adapters of this one module. They used to agree by having the same
// declarations typed out twice under matching "MUST match the other side"
// comments — the summary types, the tuple layouts, every HX_QUERY_* name, the
// card global, even the low-power rule — with a test that pinned only the
// client's copy against a literal. A drift on either side was silent: a
// misnamed global reads as "file absent" and a reordered tuple as wrong numbers.
// Now each fact is spelled here once and both sides import it. The golden shard
// vectors in the test suite stay, because sharing the code stops ONE side
// drifting while goldens stop BOTH sides drifting together away from what is
// already published.
//
// Dependency-free on purpose (type imports and the shared low-power rule
// aside): the Node build script imports this module, so it must not reach for
// the DOM, the dataset registry, or anything else.
//
// Changing a shard count, a file name or a global name invalidates every
// published URL; changing a row layout or a field name breaks every deployed
// client. The output bytes of the generator are part of this contract.

import type { DatasetMeta } from '../types';
import { isLowPower } from '../utils/qcFlags';

// ── Shards and the key hash ────────────────────────────────────────────────

/** Shards in the per-gene DE family. */
export const GENE_SHARDS = 512;

/** Shards in the per-pathway FGSEA family. */
export const PATHWAY_SHARDS = 256;

/**
 * Shards in the EXPRESSION family — per-sample values for each dataset's
 * default track, which is what the cross-dataset Compare view plots.
 *
 * Deliberately the same count as the gene shards: a gene's stats and its values
 * hash to the same-numbered slice, so a client that wants both makes two
 * predictable requests.
 */
export const EXPR_SHARDS = 512;

/**
 * FNV-1a (32-bit).
 *
 * Chosen for being a handful of lines with no dependencies and identical
 * results in both runtimes. The `>>> 0` after each step is load-bearing: JS
 * bitwise ops yield a signed int32, and without it `Math.imul`'s sign bit would
 * make two implementations diverge for some keys.
 */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The key a gene or pathway is stored under in its shard: the name UPPERCASED,
 * so a lookup is case-insensitive across species (macaque POMC, mouse Pomc).
 * The shard functions below take a key, not a raw name.
 */
export const indexKey = (name: string): string => name.toUpperCase();

export const geneShard = (gene: string): number => fnv1a(gene) % GENE_SHARDS;
export const pathwayShard = (pathway: string): number => fnv1a(pathway) % PATHWAY_SHARDS;
export const exprShard = (gene: string): number => fnv1a(gene) % EXPR_SHARDS;

/** Shard numbers are zero-padded to three digits in every shard filename. */
export const padShard = (n: number): string => String(n).padStart(3, '0');

// ── Files and JSONP globals ────────────────────────────────────────────────
// Every product is a classic script assigning one window global. File paths
// are relative to the build prefix (`<query root>/<buildId>/`), except the
// manifest, which is the mutable pointer at the query root itself.

/** The manifest: relative to the query root, NOT under a build prefix. */
export const MANIFEST_FILE = 'tracks.js';
export const MANIFEST_GLOBAL = 'HX_QUERY_TRACKS';

export const geneShardFile = (shard: number): string => `genes/g${padShard(shard)}.js`;
export const geneShardGlobal = (shard: number): string => `HX_QUERY_GENES_${padShard(shard)}`;

export const pathwayShardFile = (shard: number): string => `pathways/p${padShard(shard)}.js`;
export const pathwayShardGlobal = (shard: number): string => `HX_QUERY_PATHWAYS_${padShard(shard)}`;

export const exprShardFile = (shard: number): string => `expr/e${padShard(shard)}.js`;
export const exprShardGlobal = (shard: number): string => `HX_QUERY_EXPR_${padShard(shard)}`;

/** The uppercased gene-name union (the Compare view's picker). */
export const GENE_NAMES_FILE = 'gene_names.js';
export const GENE_NAMES_GLOBAL = 'HX_QUERY_GENE_NAMES';

/** The pathway gs_name union (the search autocomplete). */
export const PATHWAY_NAMES_FILE = 'pathway_names.js';
export const PATHWAY_NAMES_GLOBAL = 'HX_QUERY_PATHWAY_NAMES';

/** One dataset's card detail (the library popover's volcano cloud). */
export const cardFile = (ds: string): string => `cards/${ds}.js`;
/**
 * The JSONP global a card-detail file assigns. Dataset ids are [a-z0-9_]
 * today; the replace is what keeps a future id with a hyphen from emitting a
 * syntax error instead of a file.
 */
export const cardGlobalName = (ds: string): string => `HX_QUERY_CARD_${ds.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

/**
 * The TRACK-PATHWAYS family: one file per pathway-capable track, named by the
 * track's position in the manifest (meaningful only under its build prefix),
 * holding that track's significant pathways.
 */
export const trackPathwaysFile = (trackIdx: number): string => `trackpaths/t${padShard(trackIdx)}.js`;
export const trackPathwaysGlobal = (trackIdx: number): string => `HX_QUERY_TRACKPATHS_${padShard(trackIdx)}`;

// ── Envelope ───────────────────────────────────────────────────────────────

/**
 * Every file under a build prefix ships as `{ b: buildId, d: payload }` so the
 * id travels with the data; the client refuses a payload whose id differs from
 * the manifest's. (The manifest carries the id as an ordinary field.)
 */
export interface ShardEnvelope<T> { b: string; d: T }

/** @public — written by scripts/build_query_index.mts. */
export function shardEnvelope<T>(buildId: string, payload: T): ShardEnvelope<T> {
  return { b: buildId, d: payload };
}

// ── Manifest ───────────────────────────────────────────────────────────────

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

/**
 * A manifest track entry, from the dataset's meta.js. `lowPower` is the app's
 * own rule (src/utils/qcFlags), precomputed so the query path never needs the
 * per-dataset meta.js files.
 *
 * @public — written by scripts/build_query_index.mts.
 */
export function trackEntry(
  ds: string,
  trackId: string,
  meta: Pick<Partial<DatasetMeta>, 'labels' | 'types' | 'qcFlags'>,
): QueryTrackEntry {
  return {
    ds,
    trackId,
    label: meta.labels?.[trackId] || trackId,
    type: meta.types?.[trackId] || '',
    lowPower: isLowPower(meta.qcFlags?.[trackId]),
  };
}

/**
 * The manifest as a client may receive it. Optional fields arrived after v2
 * first shipped; a reader tests for the FIELD it needs and degrades to its old
 * path when it is absent (`v` stays 2 — nothing branches on it).
 */
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

/** The manifest the CURRENT generator writes: every additive field present. */
export interface BuiltQueryManifest extends QueryManifest {
  exprShards: number;
  trackCounts: Record<string, number>;
  datasets: BuiltDatasetSummary[];
  trackPathways: { fdr: number; tracks: number[] };
}

// ── Browse summaries ───────────────────────────────────────────────────────

/** One database's significant-pathway split. */
export interface PathwayDbCount { up: number; down: number; tested: number }

/** Significant-feature counts for a dataset's default track, at DEFAULT_FDR_CUTOFF. */
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
  /** Per-database split, keyed by the bundle's own db name (GO_BP, HALLMARK...). */
  pathsByDb: Record<string, PathwayDbCount> | null;
  /**
   * Indexed tracks of this dataset with at least one significant gene.
   *
   * 0 or 1 for a single-track study, and the only honest headline for the
   * macaque atlas: its default population (POMC) finds nothing, while 20 of its
   * 60 populations find something. A card showing the default track's 0 without
   * this number is understating the dataset.
   */
  tracksWithGenes: number;
}

/**
 * One dataset's precomputed browse facts: everything the dataset library shows
 * on a card, for one dataset, without opening that dataset's bundles.
 *
 * A MATERIALIZED READ MODEL, not a new authority. The registry owns identity
 * and arms, meta.js owns replicate counts and gene counts; this is the join,
 * computed once at build time.
 *
 * `nBaseline`/`nCase` are the DEFAULT CONTRAST's two arms on the default track
 * — the pair whose labels the card prints beside them, which on a factorial
 * dataset is not the pooled control/case pair. `nVaries` asks whether the
 * dataset's TRACKS agree in size, which only the pooled pair measures per
 * track: the macaque atlas is 3v3 on 55 of its 60 populations and drops to an
 * arm of 2 on the other five.
 */
export interface DatasetSummary {
  ds: string;
  /** Indexed tracks (not `meta.populations.length` — a track whose bundle
   *  failed to parse is not in the index and must not be counted as browsable). */
  trackCount: number;
  defaultTrack: string;
  /** The default track's display label — the tissue actually analysed. */
  trackLabel: string;
  nGenes: number | null;
  nBaseline: number | null;
  nCase: number | null;
  /** True when any indexed track's POOLED counts differ from the default track's. */
  nVaries: boolean;
  /** Tracks with an arm below n=3, by the same isLowPower rule the QC tab uses. */
  lowPowerTracks: number;
  // ── Expression scaffolding (indexes built with the expression family) ──────
  // An ExprIndexRow is bare numbers in an order; these say which sample each
  // one is and which arm claims it. They travel in the manifest rather than the
  // shards because they are per-dataset, not per-gene. Optional because an
  // older index has none, and a summary missing them can only mean "fall back",
  // never "no samples".
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
  /** Baseline/case group keys, in display order. Optional only for manifests built before this field existed. */
  armKeys?: string[];
  /**
   * What the default track found, at DEFAULT_FDR_CUTOFF, counted from the RAW
   * FDR/padj (never a rounded wire copy).
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

/** The summary the CURRENT generator writes: scaffolding and discoveries present. */
export interface BuiltDatasetSummary extends DatasetSummary {
  sampleOrder: string[];
  groupSamples: Record<string, string[]>;
  contrastId: string | null;
  armKeys: string[];
  discoveries: DiscoverySummary;
}

/** The hover popover's volcano cloud for one dataset's default track. */
export interface CardDetail {
  /** [logFC, -log10(FDR)], downsampled at build time, 2dp. */
  pts: Array<[number, number]>;
  /** Symmetric x limit, clipped at the 0.2/99.8 percentile so one runaway
   *  logFC cannot squash the cloud into the middle column. */
  xlim: number;
  ymax: number;
  ycut: number;
  track: string;
}

// ── Row layouts and codecs ─────────────────────────────────────────────────
// Rows are positional tuples because they repeat ~1.3M times; field names on
// every row would be most of the payload. Each layout below is written by its
// encoder and read by its decoder, so the field order is spelled once. Every
// row's `trackIdx` is a position in the manifest's `tracks` array — one
// namespace for every family, so there is no second positional space to get out
// of step. Encoders do no rounding: precision is the generator's policy.

/** [trackIdx, logFC, pval, fdr, se] — se is null when the source bundle had none. */
export type GeneIndexRow = [number, number | null, number | null, number | null, number | null];

/** One gene's DE statistics in one track, as a gene row carries them. */
export interface GeneRowFields {
  trackIdx: number;
  logFC: number | null;
  pval: number | null;
  fdr: number | null;
  se: number | null;
}

/** @public — written by scripts/build_query_index.mts. */
export function encodeGeneRow(f: GeneRowFields): GeneIndexRow {
  return [f.trackIdx, f.logFC, f.pval, f.fdr, f.se];
}

export function decodeGeneRow(row: GeneIndexRow): GeneRowFields {
  const [trackIdx, logFC, pval, fdr, se] = row;
  return { trackIdx, logFC, pval, fdr, se };
}

/** [trackIdx, NES, padj, pval, size, dbIdx] — dbIdx indexes the manifest's `dbNames`. */
export type PathwayIndexRow = [number, number | null, number | null, number | null, number, number];

/** One pathway's FGSEA result in one track. leadingEdge is deliberately not carried. */
export interface PathwayRowFields {
  trackIdx: number;
  NES: number | null;
  padj: number | null;
  pval: number | null;
  size: number;
  dbIdx: number;
}

/** @public — written by scripts/build_query_index.mts. */
export function encodePathwayRow(f: PathwayRowFields): PathwayIndexRow {
  return [f.trackIdx, f.NES, f.padj, f.pval, f.size, f.dbIdx];
}

export function decodePathwayRow(row: PathwayIndexRow): PathwayRowFields {
  const [trackIdx, NES, padj, pval, size, dbIdx] = row;
  return { trackIdx, NES, padj, pval, size, dbIdx };
}

/**
 * [trackIdx, perSampleValues, sym?] - one gene's expression in one track.
 *
 * `sym` is the source symbol, sent only when it differs from the row's
 * uppercase key, so a chart can print the dataset's own spelling (macaque POMC,
 * mouse Pomc) from a case-insensitive lookup. A null cell is a value the source
 * bundle did not carry; it is dropped, never read as a zero.
 */
export type ExprIndexRow = [number, Array<number | null>, string?];

/** One gene's per-sample values in one track, in its summary's `sampleOrder`. */
export interface ExprRowFields {
  trackIdx: number;
  values: Array<number | null>;
  /** The source symbol — the dataset's own spelling of the gene. */
  sym: string;
}

/** @public — written by scripts/build_query_index.mts. `sym` is omitted when it equals its key. */
export function encodeExprRow(f: ExprRowFields): ExprIndexRow {
  return f.sym === indexKey(f.sym) ? [f.trackIdx, f.values] : [f.trackIdx, f.values, f.sym];
}

/** `key` is the shard key the row was stored under; an omitted `sym` means the key IS the spelling. */
export function decodeExprRow(row: ExprIndexRow, key: string): ExprRowFields {
  const [trackIdx, values, sym] = row;
  return { trackIdx, values, sym: sym ?? key };
}

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

/** One significant pathway of one track, with its corpus base rate. */
export interface TrackPathwayRowFields {
  pathway: string;
  NES: number;
  padj: number;
  size: number;
  dbIdx: number;
  sigTracks: number;
  testedTracks: number;
}

/** @public — written by scripts/build_query_index.mts. */
export function encodeTrackPathwayRow(f: TrackPathwayRowFields): TrackPathwayRow {
  return [f.pathway, f.NES, f.padj, f.size, f.dbIdx, f.sigTracks, f.testedTracks];
}

export function decodeTrackPathwayRow(row: TrackPathwayRow): TrackPathwayRowFields {
  const [pathway, NES, padj, size, dbIdx, sigTracks, testedTracks] = row;
  return { pathway, NES, padj, size, dbIdx, sigTracks, testedTracks };
}

/** A track-pathways file's payload: the track it names, and its rows. */
export interface TrackPathwaysPayload { ds: string; trackId: string; rows: TrackPathwayRow[] }
