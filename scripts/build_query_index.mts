// Build the cross-dataset QUERY INDEX: an inverted index that answers "where is
// this gene / pathway differentially expressed across every dataset?" from two
// small static files instead of the whole corpus.
//
// THE PROBLEM
// -----------
// queryGeneAcrossDatasets() used to download EVERY track bundle of EVERY dataset
// — 100 files, 284.5 MB — to extract one row per track (logFC, PValue, FDR, se)
// for a single gene. queryPathwayAcrossDatasets() did the same over the pathway
// siblings: 93.2 MB, of which 41.6 MB is `leadingEdge` gene lists the query
// never even reads. That is a full database download to serve a point lookup,
// and it is also what drives the tab's memory to ~1 GB of JS heap.
//
// DOCUMENTED RESIDUAL: legacy `de` blocks carry no contrast id. For a
// multi-contrast dataset the builder can verify that the registered default's
// arm keys exist in groupSamples, but it cannot prove by content that `de` was
// computed for those arms. Those datasets are retained and warned loudly below.
// Closing the gap requires a future corpus rebuild that stamps contrast
// provenance into every bundle.
//
// The cross-dataset Compare view had the same shape of problem and none of the
// same cure: it needs a gene's PER-SAMPLE values, which no gene row carries, so
// it went on downloading all 43 default-track bundles (148.4 MB, 43 requests)
// to read one gene out of each. That is what the expression family below is.
//
// THE SHAPE
// ---------
// Pivot the corpus once, offline, from (track -> all genes) to (gene -> all
// tracks), then shard so a lookup fetches only the slice it needs:
//
//   public/query/tracks.js                    manifest / POINTER: every (dataset,
//                                             track) + label, type, lowPower, and
//                                             the build id. Also replaces 41
//                                             separate meta.js fetches.
//   public/query/<buildId>/genes/g<NNN>.js    gene    -> [[trackIdx, logFC, pval, fdr, se], …]
//   public/query/<buildId>/pathways/p<NNN>.js pathway -> [[trackIdx, NES, padj, pval, size, dbIdx], …]
//   public/query/<buildId>/pathway_names.js   autocomplete union
//   public/query/<buildId>/expr/e<NNN>.js     gene    -> [[trackIdx, [perSample], sym?], ...]
//                                             DEFAULT TRACKS ONLY (see pass 1.5)
//   public/query/<buildId>/gene_names.js      autocomplete union (uppercased)
//   public/query/<buildId>/trackpaths/t<NNN>.js  track -> its SIGNIFICANT pathways,
//                                             [[PATHWAY, NES, padj, size, dbIdx,
//                                               sigTracks, testedTracks], …]
//                                             (see pass 1.6)
//
// A query costs 2 requests (manifest + one shard) instead of 100, and the
// cross-dataset Compare view costs 3 (it wants a gene's stats AND its values)
// instead of one full default-track bundle per dataset.
//
// WHY SHARDS LIVE UNDER A BUILD-ID PREFIX
// ---------------------------------------
// Shard contents are only meaningful against the manifest they were built with:
// a row's first field is an INDEX into the manifest's track array, so pairing a
// shard with a different build's manifest maps every row to the wrong track.
// Stable shard paths made that a live hazard in two ways:
//
//   1. Publishing is not atomic. Uploading ~770 objects overwrites shards in
//      place over several minutes, so any client querying mid-upload could pick
//      up a new shard with the old manifest.
//   2. The service worker caches these CacheFirst for a year. With a stable path
//      whose query string only changes on an APP version bump, a data-only
//      redeploy would be invisible to any client that had already cached a
//      shard — it would keep serving last year's numbers.
//
// Scoping shards by build id fixes both by construction: a new build writes to a
// new prefix and never touches the old one, so every shard URL is genuinely
// immutable and safely cacheable forever, and publishing becomes atomic — the
// switchover is the single write of tracks.js, which must therefore be uploaded
// LAST and must NOT be cached long (see the runtimeCaching rules in
// vite.config.ts, where it is StaleWhileRevalidate and the shards are CacheFirst).
// Old prefixes are simply left behind; prune them once no client can still hold
// a stale pointer.
//
// WHY HASH SHARDING, NOT SYMBOL PREFIX
// ------------------------------------
// The client must know which shard holds a key WITHOUT first downloading a
// directory, so the shard has to be a pure function of the key. Prefix sharding
// satisfies that but is badly skewed by real gene nomenclature — the 2-char
// prefix buckets measured 57 KB on average but 2.5 MB at the worst bucket (LOC…,
// Gm…), so the unlucky query pays 40x the typical one. FNV-1a mod N is uniform:
// every bucket lands near the mean, which is what bounds worst-case latency.
// GENE_SHARDS/PATHWAY_SHARDS are part of the wire format — changing either
// invalidates every URL, so the client mirrors them as constants and both sides
// must move together.
//
// STATISTICAL CONTRACT — DO NOT "OPTIMISE" THIS AWAY
// --------------------------------------------------
// One row PER TRACK, never pre-pooled per dataset. The explorer shows each
// track's OWN effect, p, FDR and 95% CI — the macaque atlas's 60 cell
// populations are 60 rows — and nothing anywhere averages them into one, because
// 60 populations drawn from the same 6 animals are not 60 independent studies
// and pooling them as if they were would shrink the SE by ~sqrt(k) and
// manufacture significance. Emitting one pre-pooled row per dataset here would
// do exactly that, upstream and invisibly.
//
// `se` must therefore survive per row: it is what each row's 95% CI whisker is
// drawn from, and a row without one plots a bare dot rather than a wrong
// interval.
//
// OUTPUT FORMAT
// -------------
// Same JSONP convention as every other bundle (`var HX_… = {…};` in a classic
// script, read back off the window global). Deliberately NOT fetch()+JSON: the
// bundles are served cross-origin from R2 with no CORS policy, and a classic
// <script> is a no-cors request that needs none. It also keeps the new loader
// testable by the existing script-injection stubs in the vitest suite.
//
// Run:  npx tsx scripts/build_query_index.mts [--out public/query] [--check]
//       --check verifies the emitted index against the source bundles and exits
//       non-zero on any mismatch; it writes nothing.

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
// The registry is the authority on which track is a dataset's default and which
// groups its default contrast compares. The bundles cannot say: meta.js keys its
// replicate counts as `nNormal`/`nObese` on EVERY dataset, which on a mouse study
// really mean baseline and case (Chow and HFD). Joining here is what lets the
// emitted summary speak in each dataset's own arm names instead of macaque's.
import { getDataset, listDatasets } from '../src/data/datasets';
import { deTableFor, groupSamplesOf, strictSiblingPathwaysFor } from '../src/data/rawTrack';
import { defaultArmCounts, getActiveContrast } from '../src/data/contrasts';
import type { GeneDERecord, PathwaySibling, RawTrack } from '../src/types';
import {
  EXPR_SHARDS, GENE_SHARDS, PATHWAY_SHARDS, geneShard, pathwayShard, trackPathwaysFile, trackPathwaysGlobal,
} from '../src/data/queryWire';
import { DEFAULT_FDR_CUTOFF } from '../src/statistics/policy';
import { writeIndexProduct } from './lib/indexProducts.mjs';

// The wire-format constants and the key hash are imported from
// src/data/queryWire.ts, which the CLIENT imports too — so the two sides can no
// longer drift apart by editing one copy.

// Significant digits kept for EFFECT SIZES ONLY (logFC, NES, se). Full float64
// tails are high-entropy noise well below the precision of the underlying
// estimates: they inflate the payload and, being effectively random, are the
// part gzip/brotli compresses least. 4 sig figs is far finer than anything the
// UI renders and far below these statistics' own noise floor.
const SIG_EFFECT = 4;

// P-VALUES, FDR AND padj GET THRESHOLD-CHECKED ROUNDING — see prob() below.
// They are NOT rounded the way effect sizes are, because the app decides
// significance with `fdr < 0.05` and rounding can move a value ACROSS that
// cliff. Rounding FDR to 3 significant digits silently flipped 19 real rows in
// this corpus from significant to not — e.g. macaque track i40
// ARRB1/ADAM10/APOD at FDR 0.0499876945504852, which rounds to exactly 0.05 and
// then fails `< 0.05`. That is a wrong scientific claim, not a display artefact.
//
// prob() rounds generously (6 significant digits) but verifies each value
// against the exact one on the threshold and keeps full precision for any row
// that would flip. So the size stays close to plain rounding while significance
// is byte-identical to the source bundles by construction rather than by luck.
//
// If you change SIG_FDR here, change it in src/data/crossDataset.ts too — or
// better, do not round probabilities at all (costs ~29 MB on this corpus).

const DATASETS_DIR = path.resolve('public/datasets');

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');
// Emit an index even when some declared tracks could not be read. Off by
// default: a partial index is WORSE than none, because the client cannot tell
// the difference and will report the missing tracks as "gene not detected".
const allowPartial = argv.includes('--allow-partial');
const outIdx = argv.indexOf('--out');
const OUT_DIR = path.resolve(outIdx >= 0 && argv[outIdx + 1] ? argv[outIdx + 1] : 'public/query');

// Keep generated writes inside an explicitly named repository index directory.
// Existing immutable builds and sibling index families are retained.
const REPO_ROOT = path.resolve('.');
function assertSafeOutDir(dir: string): void {
  const rel = path.relative(REPO_ROOT, dir);
  const inside = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  const named = path.basename(dir).toLowerCase().includes('query');
  if (!inside || !named) {
    console.error(
      `refusing to use --out ${dir}\n` +
      '  It must be INSIDE the repo and its final path segment must contain "query"\n' +
      '  (existing immutable generations remain untouched).',
    );
    process.exit(2);
  }
}

// The significance threshold the app applies to FDR/padj. Imported from
// src/statistics/policy, the same module the app itself reads, because rounding
// here must never move a value across the line the UI will draw.
const SIG_FDR = DEFAULT_FDR_CUTOFF;
// Digits tried for probabilities. 6 is far more than the UI shows; the guard
// below is what makes it SAFE rather than merely generous.
const SIG_PROB = 6;

let exactKept = 0;

/**
 * Round a probability, but only when doing so provably cannot change the
 * significance call — otherwise keep it exactly.
 *
 * Rounding a value that is compared against a threshold can flip the comparison:
 * 3-significant-digit rounding turned 19 real FDRs of 0.0499876945504852 into
 * exactly 0.05, which then failed `< 0.05` and rendered as "not significant".
 * That is a wrong scientific claim, not a rounding artefact.
 *
 * Rather than pick a precision and hope, compare the rounded value against the
 * exact one on the ONE threshold that matters and fall back to full precision
 * for the handful of rows that sit on the cliff. The result is byte-identical
 * significance to the source bundles, at roughly the size of plain rounding.
 */
function prob(x: unknown): number | null {
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  const rounded = Number(x.toPrecision(SIG_PROB));
  if ((x < SIG_FDR) !== (rounded < SIG_FDR)) { exactKept++; return x; }
  return rounded;
}

/** Round to `d` significant digits; non-finite / missing -> null. */
function sig(x: unknown, d: number): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? Number(x.toPrecision(d)) : null;
}

// Mirrors src/utils/qcFlags.ts — a track is low power when either arm has < 3
// replicates. Missing counts default to 3 (adequate). Precomputed here so the
// query path never needs the 41 meta.js files.
function isLowPower(flags: { nNormal?: number; nObese?: number } | undefined): boolean {
  if (!flags) return false;
  return Math.min(flags.nNormal ?? 3, flags.nObese ?? 3) < 3;
}

// Parse a `var NAME = {...};` JSONP bundle back into an object. The generated
// files are machine-written with a fixed shape (header comments, then a single
// top-level assignment), so slicing from the first bracket after `var ` is
// sufficient and avoids evaluating untrusted code.
async function readBundle<T>(file: string): Promise<T | null> {
  if (!existsSync(file)) return null;
  const src = await readFile(file, 'utf8');
  const varAt = src.indexOf('var ');
  if (varAt < 0) return null;
  const objAt = src.indexOf('{', varAt);
  const arrAt = src.indexOf('[', varAt);
  const start = objAt < 0 ? arrAt : arrAt < 0 ? objAt : Math.min(objAt, arrAt);
  if (start < 0) return null;
  try {
    return JSON.parse(src.slice(start).replace(/;\s*$/, '')) as T;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isDeRow(value: unknown): value is GeneDERecord {
  if (!isRecord(value)) return false;
  return typeof value.gene === 'string'
    && typeof value.logFC === 'number'
    && typeof value.PValue === 'number'
    && (typeof value.FDR === 'number' || value.FDR === null)
    && (value.se === undefined || typeof value.se === 'number' || value.se === null);
}

function isRawTrack(value: unknown): value is RawTrack {
  if (!isRecord(value)) return false;
  if (value.de !== undefined && (!Array.isArray(value.de) || !value.de.every(isDeRow))) return false;
  if (value.deByContrast !== undefined) {
    if (!isRecord(value.deByContrast)
      || !Object.values(value.deByContrast).every((rows) => Array.isArray(rows) && rows.every(isDeRow))) return false;
  }
  if (value.cpm !== undefined) {
    if (!isRecord(value.cpm) || !Object.values(value.cpm).every((values) => Array.isArray(values)
      && values.every((cell) => typeof cell === 'number' || cell === null))) return false;
  }
  if (value.meta !== undefined) {
    if (!isRecord(value.meta)) return false;
    for (const field of ['sampleOrder', 'sampleNames', 'normalSamples', 'obeseSamples'] as const) {
      if (value.meta[field] !== undefined && !isStringArray(value.meta[field])) return false;
    }
    if (value.meta.groupSamples !== undefined) {
      if (!isRecord(value.meta.groupSamples)
        || !Object.values(value.meta.groupSamples).every(isStringArray)) return false;
    }
  }
  return true;
}

/**
 * One expression row: the per-sample values a gene has in ONE track.
 *
 *   [trackIdx, values, sym?]
 *
 * `trackIdx` is a position in the manifest's `tracks` array — the SAME
 * namespace the gene and pathway rows use, deliberately, so there is only ever
 * one way for a row to name a track and no second positional space to get out
 * of step. (Only default tracks are emitted today; the schema does not need to
 * change if that ever widens.)
 *
 * `sym` is the SOURCE symbol, present only when it differs from the row's
 * uppercase key — which is 97.3% of rows, because the shard key is uppercased
 * to make lookups case-insensitive across species while the charts still show
 * each dataset's own spelling (macaque POMC, mouse Pomc). Omitting it where it
 * is redundant costs nothing and keeps the macaque rows short.
 */
type ExprRow = [number, Array<number | null>, string?];
interface PathRec { pathway: string; pval: number; padj: number; NES: number; size: number }
interface DatasetMeta {
  populations?: string[];
  labels?: Record<string, string>;
  types?: Record<string, string>;
  nGenes?: Record<string, number>;
  qcFlags?: Record<string, { nNormal?: number; nObese?: number }>;
  /** Per-ARM replicate counts, keyed by group key. The only place the bundle
   *  carries a factorial dataset's design-cell sizes — `qcFlags` holds just the
   *  pooled control/case pair. Read by defaultArmCounts. */
  groupN?: Record<string, number>;
}

/**
 * One browse-catalog entry: everything the dataset library shows on a card,
 * for one dataset, without opening that dataset's bundles.
 *
 * This is a MATERIALIZED READ MODEL, not a new authority. Each field still has
 * exactly one source — the registry owns identity and arms, meta.js owns
 * replicate counts and gene counts — and this is the join, computed once at
 * build time so the library costs the manifest it already fetches rather than
 * 42 meta.js requests.
 *
 * Replicate counts are deliberately reported two ways, and they answer different
 * questions. `nBaseline`/`nCase` are the DEFAULT CONTRAST's two arms on the
 * default track — the pair whose LABELS the card prints beside them, which on a
 * factorial dataset is not the pooled control/case pair. `nVaries` asks whether
 * the dataset's TRACKS agree in size, which only the pooled pair measures per
 * track, so the two are computed from different sources on purpose: the macaque atlas is 3v3 on 55 of
 * its 60 populations and drops to an arm of 2 on the other five, so a card that
 * printed a flat "3 v 3" would be making a claim the corpus does not support.
 */
/** Significant-feature counts for one track at DEFAULT_FDR_CUTOFF. */
interface DiscoverySummary {
  genes: number;
  genesUp: number;
  genesDown: number;
  /** Genes carrying a finite FDR at all - the denominator a card prints. */
  genesTested: number;
  paths: number | null;
  pathsUp: number | null;
  pathsDown: number | null;
  pathsTested: number | null;
  /** Per-database split, keyed by the bundle's own db name (GO_BP, HALLMARK...). */
  pathsByDb: Record<string, { up: number; down: number; tested: number }> | null;
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

interface DatasetSummary {
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
  /**
   * What the default track actually FOUND, at the app's own FDR cutoff.
   *
   * The card used to lead with N, which in this corpus is close to useless and
   * sometimes misleading: the two largest studies on the shelf (23v22 and 18v18)
   * return one and two significant genes, while a 3v4 translatome returns 491.
   * These are the numbers a reader is deciding on.
   *
   * Counted from the RAW FDR/padj in the bundle, never from `prob()`'s rounded
   * copy, so a value sitting a hair under the cutoff cannot be rounded across it.
   *
   * `paths*` are null, not 0, when the dataset ships no pathway sibling. Zero is
   * a real and common answer here (38% of single-track datasets find no genes),
   * so "not computed" must never be representable as "found none".
   */
  discoveries: DiscoverySummary;
  // ── Expression scaffolding: what turns an expression row into a chart ──────
  // An ExprRow is just numbers in an order; these three fields are the only
  // thing that says WHICH sample each number belongs to and which arm claims
  // it. They travel in the manifest rather than the shards because they are
  // per-dataset, not per-gene — repeating them on 719,793 rows would be most of
  // the payload.
  /** The default track's sample ids, in the order its expression rows are written. */
  sampleOrder: string[];
  /** The default track's arm -> sample ids, via the app's own back-compat reader. */
  groupSamples: Record<string, string[]>;
  /**
   * The contrast id whose DE table and arms this summary (and every expression
   * row for this dataset) describes — always the registry's DEFAULT, since that
   * is the only contrast the index carries. The client compares it against the
   * contrast it is about to render with, so a dataset that gains a contrast
   * cannot end up showing the default contrast's numbers under another
   * contrast's arm labels.
   */
  contrastId: string | null;
  /** Baseline/case group keys for the emitted contrast, in display order. */
  armKeys: string[];
}

/** One manifest entry — the per-track context the query needs to build a row. */
interface TrackEntry {
  ds: string;
  trackId: string;
  label: string;
  type: string;
  lowPower: boolean;
}

const banner = (what: string) =>
  `// AUTO-GENERATED by scripts/build_query_index.mts — do not edit\n// ${what}\n`;

// Every emitted file carries the same build id, and the client refuses a shard
// whose id does not match the manifest's.
//
// Without it, the manifest and the shards are independent files that a browser
// (or a CDN, or a half-finished upload) can mix across builds — and a mixed pair
// is not a visible error, it is WRONG DATA: trackIdx values are positions in the
// manifest's track array, so a shard from a build with a different track order
// maps every row to the wrong track. Silently. The id turns that into a
// detectable mismatch that falls back to reading the bundles.
//
// Derived from the corpus itself (track identities + row counts + a digest of
// every emitted VALUE), so an unchanged corpus rebuilds to the same id and does
// not needlessly bust caches — while a data-only reprocess (same tracks, new
// logFC/p) produces a NEW id and therefore new immutable shard URLs. Without
// the value digest, such a reprocess reproduced the old id, and the year-long
// CacheFirst shard cache kept serving the old numbers to every returning client.
function buildIdFrom(parts: string[]): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) {
      h1 ^= p.charCodeAt(i);
      h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ p.charCodeAt(i), 0x85ebca6b) >>> 0;
    }
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

let BUILD_ID = '';

async function writeJsonp(file: string, globalName: string, what: string, payload: unknown): Promise<number> {
  // Shards are wrapped so the id travels with the data; the manifest carries it
  // as a normal field.
  const body = `${banner(what)}var ${globalName} = ${JSON.stringify(payload)};\n`;
  await writeIndexProduct(file, body, { immutable: path.resolve(file) !== path.join(OUT_DIR, 'tracks.js') });
  return Buffer.byteLength(body);
}

/**
 * The JSONP global a card-detail file assigns.
 *
 * Duplicated by cardGlobalName in src/data/queryIndex.ts - the two are a wire
 * contract and the dataset-id test in datasetLibrary.test.tsx pins them
 * together. Dataset ids are [a-z0-9_] today; the replace is what keeps a future
 * id with a hyphen from emitting a syntax error instead of a file.
 */
function cardGlobalName(ds: string): string {
  return `HX_QUERY_CARD_${ds.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

/** Shard payloads are wrapped as { b: buildId, d: data } so the id is verifiable. */
function shardEnvelope(data: unknown): { b: string; d: unknown } {
  return { b: BUILD_ID, d: data };
}

// ── Pass 1: walk public/datasets and pivot ──────────────────────────────────

const tracks: TrackEntry[] = [];
// gene -> rows, pathway -> rows. Row 0 is the track index into `tracks`.
const geneIndex = new Map<string, Array<[number, number | null, number | null, number | null, number | null]>>();
const pathIndex = new Map<string, Array<[number, number | null, number | null, number | null, number, number]>>();
// Pathway DB names are interned: 'GO_BP' etc. repeat on every one of ~500k rows,
// so storing an index into this array instead of the string is most of the
// difference between a 20 MB and a 13 MB pathway index.
const dbNames: string[] = [];
// Tracks whose default contrast resolved to a pathway result, significant or
// not. Each gets a track-pathways file (pass 1.6), so a missing file can only
// mean "this track has no pathway analysis", never "found nothing".
const pathwayTracks = new Set<number>();

// ── Discoveries: what each track FOUND, counted while pass 1 is already
// walking every DE row and every pathway record. No extra I/O, no second pass.
interface TrackDiscovery {
  genes: number; genesUp: number; genesDown: number; genesTested: number;
  paths: number; pathsUp: number; pathsDown: number; pathsTested: number;
  pathsByDb: Record<string, { up: number; down: number; tested: number }>;
  sawPathways: boolean;
}
const discoveryByTrack = new Map<string, TrackDiscovery>();
const discoveryKey = (ds: string, trackId: string) => `${ds}/${trackId}`;
function discoveryFor(ds: string, trackId: string): TrackDiscovery {
  const k = discoveryKey(ds, trackId);
  let d = discoveryByTrack.get(k);
  if (!d) {
    d = {
      genes: 0, genesUp: 0, genesDown: 0, genesTested: 0,
      paths: 0, pathsUp: 0, pathsDown: 0, pathsTested: 0,
      pathsByDb: {}, sawPathways: false,
    };
    discoveryByTrack.set(k, d);
  }
  return d;
}

// The hover popover's volcano cloud, one per dataset, for the DEFAULT track
// only. It is NOT in the manifest and must never be: a track bundle is 2.6 MB
// at the median and the manifest is fetched on every visit, so the cloud ships
// as its own ~10 KB file, loaded when a reader actually opens a popover.
interface VolcanoCloud {
  /** [logFC, -log10(FDR)], downsampled, 2dp. */
  pts: Array<[number, number]>;
  /** Symmetric x limit, clipped at the 0.2/99.8 percentile so one runaway
   *  logFC cannot squash the cloud into the middle column. */
  xlim: number;
  ymax: number;
  ycut: number;
  track: string;
}
const cloudByDs = new Map<string, VolcanoCloud>();
const Y_CUT = -Math.log10(SIG_FDR);

/** Keep every discovery (to a cap) and thin the null cloud around it. */
function thinCloud(pts: Array<[number, number]>): Array<[number, number]> {
  const sig: Array<[number, number]> = [];
  const nul: Array<[number, number]> = [];
  for (const p of pts) (p[1] > Y_CUT ? sig : nul).push(p);
  const take = (a: Array<[number, number]>, n: number) => {
    if (a.length <= n) return a;
    const step = a.length / n;
    const o: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) o.push(a[Math.floor(i * step)]);
    return o;
  };
  return [...take(sig, 520), ...take(nul, 420)];
}

// gene -> the per-sample expression rows of the DATASETS' DEFAULT TRACKS only.
// Filled by pass 1.5, once the summaries have resolved which track that is.
const exprIndex = new Map<string, ExprRow[]>();
const dbIndex = (name: string): number => {
  const i = dbNames.indexOf(name);
  if (i >= 0) return i;
  dbNames.push(name);
  return dbNames.length - 1;
};

// Running FNV-1a digest over every emitted row (key + the values as written),
// folded into the build id. Accumulated during pass 1 in emit order, which is
// deterministic (dataset dirs sorted, then each meta's own population order),
// so identical data digests identically across rebuilds.
let contentHash = 0x811c9dc5;
// FNV-1a folded over 32 bits carries only 32 bits of value identity, which is
// thin for a digest whose whole job is to make two different corpora produce
// two different immutable URLs. Every string that feeds the counter also feeds
// a SHA-256 stream, and BOTH land in the build id — the counter so an unchanged
// corpus keeps reproducing its historical id contribution, the stream so
// distinguishing two corpora does not rest on 32 bits.
const contentSha = createHash('sha256');
// Length-delimiting separator: without it, two different splits of the same
// characters would digest identically.
const SEP = '\u0000';
function digestText(s: string): void {
  contentSha.update(s);
  contentSha.update(SEP);
  let h = contentHash;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  contentHash = h >>> 0;
}
function digestRow(key: string, row: ReadonlyArray<number | null>): void {
  digestText(`${key}|${row.join(',')}`);
}

let srcBytes = 0;
let skippedNoSe = 0;
// Declared tracks that could NOT be indexed. Fatal unless --allow-partial —
// see the guard just before the write step, and why a partial index is worse
// than no index at all.
const skippedTracks: string[] = [];
const legacyDefaultAudits = new Map<string, { tracks: number; missingArmKeys: string[] }>();
const legacyPathwayDefaults = new Set<string>();
const legacyPlainPathways = new Set<string>();
const refusedPathwayDefaults = new Set<string>();

const datasetIds = (await readdir(DATASETS_DIR, { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

// Each dataset's meta, kept so the browse summaries can be built after pass 1 —
// they must count INDEXED tracks, which is only known once every bundle has been
// read and the unparseable ones dropped.
const metas = new Map<string, DatasetMeta>();

for (const ds of datasetIds) {
  const dir = path.join(DATASETS_DIR, ds);
  const meta = await readBundle<DatasetMeta>(path.join(dir, 'meta.js'));
  if (meta) metas.set(ds, meta);
  if (!meta?.populations?.length) {
    console.warn(`  ! ${ds}: no meta.js / no populations`);
    skippedTracks.push(`${ds} (no meta.js / no populations)`);
    continue;
  }

  for (const trackId of meta.populations) {
    const trackFile = path.join(dir, `track_${trackId}.js`);
    const parsed = await readBundle<unknown>(trackFile);
    if (!isRawTrack(parsed)) {
      console.warn(`  ! ${ds}/${trackId}: track bundle missing or unparseable`);
      skippedTracks.push(`${ds}/${trackId} (bundle missing or unparseable)`);
      continue;
    }
    const raw = parsed;
    srcBytes += (await readFile(trackFile)).byteLength;

    const ti = tracks.length;
    tracks.push({
      ds,
      trackId,
      label: meta.labels?.[trackId] || trackId,
      type: meta.types?.[trackId] || '',
      lowPower: isLowPower(meta.qcFlags?.[trackId]),
    });

    const registered0 = getDataset(ds);
    const activeContrast0 = getActiveContrast(registered0);
    const contrastId = activeContrast0?.id;
    const de = deTableFor(raw, contrastId);
    const explicitDefaultDe = contrastId ? raw.deByContrast?.[contrastId] : undefined;
    if (registered0 && registered0.contrasts.length > 1 && explicitDefaultDe === undefined && raw.de) {
      const audit = legacyDefaultAudits.get(ds) ?? { tracks: 0, missingArmKeys: [] };
      audit.tracks++;
      const groupKeys = new Set(Object.keys(groupSamplesOf(raw) ?? {}));
      for (const armKey of [activeContrast0?.baseline.key, activeContrast0?.caseGroup.key]) {
        if (armKey && !groupKeys.has(armKey)) audit.missingArmKeys.push(`${trackId}:${armKey}`);
      }
      legacyDefaultAudits.set(ds, audit);
    }
    if (!de.length && !raw.de) {
      console.warn(`  ! ${ds}/${trackId}: no DE table for the default contrast`);
      skippedTracks.push(`${ds}/${trackId} (no DE table for the default contrast)`);
      // The manifest entry was pushed before the DE table was resolved, so drop
      // it again: a track with no indexed rows must not appear in the manifest,
      // or the client would render it as "gene not detected" for every gene.
      tracks.pop();
      continue;
    }

    const disc = discoveryFor(ds, trackId);
    const isDefaultTrack = registered0?.defaultTrack === trackId;
    const cloud: Array<[number, number]> = [];
    for (const r of de) {
      if (!r.gene) continue;
      // Counted from the raw FDR, before prob() rounds it for the wire.
      if (r.FDR != null && Number.isFinite(r.FDR)) {
        disc.genesTested++;
        if (r.FDR < SIG_FDR) {
          disc.genes++;
          if ((r.logFC ?? 0) > 0) disc.genesUp++; else if ((r.logFC ?? 0) < 0) disc.genesDown++;
        }
        if (isDefaultTrack && r.logFC != null && Number.isFinite(r.logFC)) {
          cloud.push([r.logFC, r.FDR <= 0 ? 16 : -Math.log10(r.FDR)]);
        }
      }
      const key = r.gene.toUpperCase();
      const se = sig(r.se, SIG_EFFECT);
      if (se === null) skippedNoSe++;
      let arr = geneIndex.get(key);
      if (!arr) { arr = []; geneIndex.set(key, arr); }
      const row: [number, number | null, number | null, number | null, number | null] =
        [ti, sig(r.logFC, SIG_EFFECT), prob(r.PValue), prob(r.FDR), se];
      arr.push(row);
      digestRow(key, row);
    }

    if (isDefaultTrack && cloud.length) {
      const xs = cloud.map((p) => p[0]).sort((a, b) => a - b);
      const lo = xs[Math.floor(xs.length * 0.002)];
      const hi = xs[Math.floor(xs.length * 0.998)];
      const pts = thinCloud(cloud);
      cloudByDs.set(ds, {
        pts: pts.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]),
        xlim: Math.round(Math.max(Math.abs(lo), Math.abs(hi), 0.01) * 100) / 100,
        ymax: Math.round(Math.max(...pts.map((p) => p[1]), Y_CUT * 1.6) * 10) / 10,
        ycut: Math.round(Y_CUT * 1000) / 1000,
        track: trackId,
      });
    }

    // Pathways live in the sibling bundle; absent is legitimate (a dataset with
    // supportsPathways:false), so it is not a warning. Contrast resolution is
    // rawTrack.strictSiblingPathwaysFor — the same strict default-witness rule
    // the slow path (crossDataset.findPathway) applies, so the two can never
    // disagree about which block serves the default. Its 'legacy-default'
    // source is the contract shape (the registered default lives in `default`,
    // deliberately NOT repeated inside `byContrast`, and carries no contrast
    // id) — attribution is unverifiable-by-content: index it, loudly.
    const pathSibling = await readBundle<PathwaySibling>(
      path.join(dir, `track_${trackId}.pathways.js`),
    );
    // Both arguments are the registered default's id on purpose: the index
    // only ever speaks for the registered default. Passing the ACTIVE id via
    // activeContrast0 keeps the provenance honest — if the index ever indexes
    // a non-default contrast, the two arguments diverge and the strict rule
    // refuses the wrapper's default block instead of misattributing it.
    const resolvedSibling = strictSiblingPathwaysFor(pathSibling, activeContrast0?.id, contrastId);
    if (pathSibling && resolvedSibling.source === 'legacy-default') legacyPathwayDefaults.add(ds);
    if (pathSibling && resolvedSibling.source === 'refused') refusedPathwayDefaults.add(ds);
    // A plain (pre-wrapper) sibling names no contrast at all, so on a
    // MULTI-contrast dataset its attribution is as unverifiable as the legacy
    // `de` table the gene side already audits above. Single-contrast datasets
    // are the normal case for this shape and say nothing.
    if (pathSibling && resolvedSibling.source === 'legacy-plain'
      && registered0 && registered0.contrasts.length > 1) {
      legacyPlainPathways.add(ds);
    }
    const pathDb = resolvedSibling.db as Record<string, PathRec[]> | null;
    if (!pathDb) continue;
    pathwayTracks.add(ti);
    for (const [dbName, recs] of Object.entries(pathDb)) {
      if (!Array.isArray(recs)) continue;
      const di = dbIndex(dbName);
      disc.sawPathways = true;
      let byDb = disc.pathsByDb[dbName];
      if (!byDb) {
        byDb = { up: 0, down: 0, tested: 0 };
        disc.pathsByDb[dbName] = byDb;
      }
      for (const rec of recs) {
        if (!rec?.pathway) continue;
        if (rec.padj != null && Number.isFinite(rec.padj)) {
          disc.pathsTested++;
          byDb.tested++;
          if (rec.padj < SIG_FDR) {
            disc.paths++;
            if (rec.NES > 0) { disc.pathsUp++; byDb.up++; } else if (rec.NES < 0) { disc.pathsDown++; byDb.down++; }
          }
        }
        const key = rec.pathway.toUpperCase();
        let arr = pathIndex.get(key);
        if (!arr) { arr = []; pathIndex.set(key, arr); }
        // leadingEdge is deliberately NOT carried: it is 45% of the pathway
        // payload and is only ever read by the single-track drilldown views,
        // which load the full sibling bundle anyway.
        const row: [number, number | null, number | null, number | null, number, number] =
          [ti, sig(rec.NES, SIG_EFFECT), prob(rec.padj), prob(rec.pval), rec.size ?? 0, di];
        arr.push(row);
        digestRow(key, row);
      }
    }
  }
}

for (const [ds, audit] of legacyDefaultAudits) {
  const armCheck = audit.missingArmKeys.length
    ? `arm-key cross-check FAILED (${audit.missingArmKeys.join(', ')})`
    : 'arm-key cross-check passed';
  console.warn(
    `  !!! ${ds}: ${audit.tracks} track(s) source the registered multi-contrast default from legacy de; `
    + `${armCheck}; CONTRAST ATTRIBUTION IS UNVERIFIABLE-BY-CONTENT because legacy de carries no contrast id. `
    + 'Dataset remains indexed.',
  );
}
for (const ds of legacyPathwayDefaults) {
  console.warn(
    `  !!! ${ds}: pathway rows for the registered default contrast come from the wrapper's `
    + 'unstamped default block; CONTRAST ATTRIBUTION IS UNVERIFIABLE-BY-CONTENT because that block '
    + 'carries no contrast id. Dataset remains indexed.',
  );
}
for (const ds of legacyPlainPathways) {
  console.warn(
    `  !!! ${ds}: pathway rows for the registered default contrast come from a PLAIN pre-wrapper `
    + 'sibling on a multi-contrast dataset; CONTRAST ATTRIBUTION IS UNVERIFIABLE-BY-CONTENT because '
    + 'that sibling names no contrast at all. Dataset remains indexed.',
  );
}
for (const ds of refusedPathwayDefaults) {
  console.warn(
    `  ! ${ds}: pathway wrapper has neither a block for the registered default contrast nor a `
    + 'default block; no pathway rows were indexed for it.',
  );
}

console.log(`indexed ${tracks.length} tracks from ${datasetIds.length} datasets (${(srcBytes / 1048576).toFixed(1)} MB of source bundles)`);
console.log(`  ${geneIndex.size} distinct genes, ${pathIndex.size} distinct pathways, ${dbNames.length} pathway DBs`);
if (skippedNoSe) console.log(`  note: ${skippedNoSe} DE rows carry no 'se' (those tracks plot without a 95% CI)`);
if (exactKept) console.log(`  note: ${exactKept} probabilities kept at full precision (rounding them would have crossed the ${SIG_FDR} significance threshold)`);

// Per-dataset track counts, recorded in the manifest so a client that already
// holds a dataset's meta.js can spot a manifest built against a DIFFERENT track
// list (bundles redeployed without an index rebuild) and fall back to the slow
// path instead of claiming absence for tracks the index never read.
const trackCounts: Record<string, number> = {};
for (const t of tracks) trackCounts[t.ds] = (trackCounts[t.ds] ?? 0) + 1;

// ── Browse catalog: one summary per indexed dataset ────────────────────────
// Emitted into the SAME manifest as the tracks rather than a sibling
// query/datasets.js. A second pointer file would need its own
// stale-while-revalidate rule (the generic /query/ rule in vite.config.ts is
// CacheFirst for a year, which would pin it), its own slot in the upload
// ordering, and could be published out of step with tracks.js — at which point
// the library and the reports would be describing different corpora.
const indexedTracksByDs = new Map<string, string[]>();
for (const t of tracks) {
  const arr = indexedTracksByDs.get(t.ds);
  if (arr) arr.push(t.trackId); else indexedTracksByDs.set(t.ds, [t.trackId]);
}

const datasetSummaries: DatasetSummary[] = [];
for (const [ds, trackIds] of [...indexedTracksByDs].sort((a, b) => a[0].localeCompare(b[0]))) {
  const meta = metas.get(ds);
  const registered = getDataset(ds);
  // A bundle directory the registry does not know about cannot be browsed —
  // the library renders from the registry and would have no name, arms or
  // links for it. Its tracks stay in the index (the reports read them through
  // the manifest, which is registry-independent); only the card is withheld.
  if (!registered) {
    console.warn(`  ! ${ds}: indexed but not in src/data/datasets.ts — no browse card will be emitted`);
    continue;
  }
  // Fall back to the first INDEXED track when the declared default did not
  // survive pass 1, so a card never headlines counts for a track the library
  // would refuse to open.
  const defaultTrack = trackIds.includes(registered.defaultTrack) ? registered.defaultTrack : trackIds[0];
  const qcOf = (t: string) => meta?.qcFlags?.[t] ?? {};
  const def = qcOf(defaultTrack);
  // The DEFAULT CONTRAST's arms, not the pooled pair — the card prints these
  // beside that contrast's labels. See defaultArmCounts for what goes wrong
  // when a factorial dataset's default sits on design cells.
  const { nBaseline, nCase } = defaultArmCounts(registered, meta, def);
  const activeContrast = getActiveContrast(registered);
  // nVaries answers a different question — "do the TRACKS differ in size?" — so
  // it stays on the pooled pair, which is the only per-track measurement
  // `qcFlags` carries. Comparing each track's pooled pair against the default
  // contrast's ARM counts would report every factorial single-track dataset as
  // varying, which is a claim a one-track study cannot support.
  const pooledBaseline = def.nNormal ?? null;
  const pooledCase = def.nObese ?? null;
  // A track whose QC carries no counts is UNKNOWN, not different. Comparing the
  // nulls directly (`null !== 3`) turned every missing measurement into an
  // asserted "replicate counts differ across this dataset" — a claim about the
  // data made out of the absence of data.
  const nVaries = trackIds.some((t) => {
    const q = qcOf(t);
    if (q.nNormal == null || q.nObese == null) return false;
    return q.nNormal !== pooledBaseline || q.nObese !== pooledCase;
  });
  // The default track's own counts, plus how many of this dataset's tracks
  // found anything - the macaque atlas needs the second number to be honest.
  const defDisc = discoveryByTrack.get(discoveryKey(ds, defaultTrack));
  const tracksWithGenes = trackIds
    .filter((t) => (discoveryByTrack.get(discoveryKey(ds, t))?.genes ?? 0) > 0).length;
  const hasPaths = defDisc?.sawPathways ?? false;
  const discoveries: DiscoverySummary = {
    genes: defDisc?.genes ?? 0,
    genesUp: defDisc?.genesUp ?? 0,
    genesDown: defDisc?.genesDown ?? 0,
    genesTested: defDisc?.genesTested ?? 0,
    paths: hasPaths ? (defDisc as TrackDiscovery).paths : null,
    pathsUp: hasPaths ? (defDisc as TrackDiscovery).pathsUp : null,
    pathsDown: hasPaths ? (defDisc as TrackDiscovery).pathsDown : null,
    pathsTested: hasPaths ? (defDisc as TrackDiscovery).pathsTested : null,
    pathsByDb: hasPaths ? (defDisc as TrackDiscovery).pathsByDb : null,
    tracksWithGenes,
  };

  datasetSummaries.push({
    ds,
    trackCount: trackIds.length,
    defaultTrack,
    trackLabel: meta?.labels?.[defaultTrack] || defaultTrack,
    nGenes: meta?.nGenes?.[defaultTrack] ?? null,
    nBaseline,
    nCase,
    nVaries,
    lowPowerTracks: trackIds.filter((t) => isLowPower(meta?.qcFlags?.[t])).length,
    discoveries,
    // Filled by pass 1.5, which has to re-open the default track's bundle.
    sampleOrder: [],
    groupSamples: {},
    // The registry decides which contrast is default; the bundle format puts
    // that contrast's table in `de`, which is what pass 1 indexed.
    contrastId: activeContrast?.id ?? null,
    armKeys: activeContrast ? [activeContrast.baseline.key, activeContrast.caseGroup.key] : [],
  });
}

// The reverse mismatch: a registered dataset with no indexed tracks would be a
// card the user can click that opens an explorer with nothing in it. Name them
// loudly — this is how a bundle that failed to deploy surfaces at build time
// rather than as an empty volcano plot in production.
const unindexed = listDatasets().filter((d) => !indexedTracksByDs.has(d.id)).map((d) => d.id);
if (unindexed.length) {
  console.warn(`  ! ${unindexed.length} registered dataset(s) have no indexed tracks: ${unindexed.join(', ')}`);
}
console.log(`browse catalog: ${datasetSummaries.length} dataset summaries`
  + ` (${datasetSummaries.filter((s) => s.nVaries).length} with replicate counts that vary across tracks)`);

// ── Pass 1.5: the EXPRESSION index ──────────────────────────────────────────
//
// WHY THIS FAMILY EXISTS
// The cross-dataset Compare view (src/crossdataset/CrossDatasetCompare.tsx)
// plots ONE gene's baseline-vs-case bars for every dataset. The gene index
// cannot serve it: a bar needs the per-sample values behind the mean and the
// SEM, and a gene row carries only [logFC, pval, fdr, se]. So that view still
// downloaded every dataset's default track in full — 43 requests, 148.4 MB —
// to read one gene out of each. This family is those values, pivoted the same
// way and sharded on the same hash.
//
// WHY ONLY DEFAULT TRACKS
// That view is one-track-per-dataset by construction. Indexing every non-default
// track as well would expand this family to serve nothing that exists today.
// The row schema names tracks by manifest
// index, so widening it later needs no wire change.
//
// WHY A SEPARATE PASS
// Which track is a dataset's default is only settled once pass 1 has run (a
// declared default whose bundle failed to parse falls back to the first indexed
// track), and holding every track's cpm through pass 1 would mean carrying the
// the whole corpus in memory. Re-opening one default bundle per dataset is the cheaper half.
let exprValues = 0;
let exprNullCells = 0;
let exprSrcBytes = 0;
// The picker's vocabulary, collected from the DEFAULT TRACKS' DE TABLES rather
// than their cpm keys.
//
// It has to be the DE table because that is what "detected" means in this view:
// a chart is rendered for a dataset only when the gene resolves in
// popData.deByGene, which buildPopData derives from `de`. Offering a picker
// built from cpm would let the user select a gene with values but no
// statistics, which every dataset would then report as "not detected" - a
// contradiction the corpus does not currently contain (measured: cpm and de
// cover identical gene sets on all default tracks) and which this keeps
// impossible by construction rather than by luck.
const pickerGeneNames = new Set<string>();
for (const summary of datasetSummaries) {
  const trackFile = path.join(DATASETS_DIR, summary.ds, `track_${summary.defaultTrack}.js`);
  const parsed = await readBundle<unknown>(trackFile);
  const raw = isRawTrack(parsed) ? parsed : null;
  if (raw) exprSrcBytes += (await readFile(trackFile)).byteLength;
  // Pass 1 already indexed this exact file, so an unreadable one here is not a
  // corpus fault but a race (a rebuild mid-run). Fatal either way: a summary
  // with empty scaffolding would be a dataset the client silently drops.
  if (!raw) {
    console.error(`  ! ${summary.ds}/${summary.defaultTrack}: default track unreadable on the expression pass`);
    skippedTracks.push(`${summary.ds}/${summary.defaultTrack} (unreadable on the expression pass)`);
    continue;
  }
  // sampleOrder and groupSamples resolve through the app's own back-compat
  // readers, NOT a second hand-spelled copy of the legacy shapes: the macaque
  // bundles state their arms as normalSamples/obeseSamples, and rawTrack.ts is
  // where that rule lives (it names this builder as one of its consumers).
  const sampleOrder = raw.meta?.sampleOrder ?? raw.meta?.sampleNames ?? [];
  const groupSamples = groupSamplesOf(raw) ?? {};
  summary.sampleOrder = sampleOrder;
  summary.groupSamples = groupSamples;

  const ti = tracks.findIndex((t) => t.ds === summary.ds && t.trackId === summary.defaultTrack);
  if (ti < 0) {
    // Unreachable while summaries are built from `tracks`, but the row's whole
    // meaning is this index — a -1 would map every value to the last track.
    console.error(`  ! ${summary.ds}/${summary.defaultTrack}: default track absent from the manifest`);
    skippedTracks.push(`${summary.ds}/${summary.defaultTrack} (absent from the manifest on the expression pass)`);
    continue;
  }

  // The scaffolding is part of what a row MEANS, so it is digested too: a
  // rebuild that re-assigns arms without touching a single value must still
  // produce a new build id, or the year-long immutable shard cache would keep
  // serving the old numbers against the new arms.
  digestText(`scaffold|${summary.ds}|${summary.defaultTrack}|${summary.contrastId ?? ''}|${summary.armKeys.join(',')}|${sampleOrder.join(',')}|`
    + Object.entries(groupSamples).map(([k, v]) => `${k}=${v.join(',')}`).sort().join(';'));

  for (const r of deTableFor(raw, summary.contrastId ?? undefined)) {
    if (r.gene) pickerGeneNames.add(r.gene.toUpperCase());
  }

  for (const [sym, values] of Object.entries(raw.cpm ?? {})) {
    if (!Array.isArray(values)) continue;
    const key = sym.toUpperCase();
    // Values are ROUNDED but never threshold-checked the way probabilities are
    // (see prob()): they are only ever plotted — bar height, SEM whisker, dot
    // overlay — and never compared against a significance cliff. 4 significant
    // digits is far finer than a 200-pixel bar can render.
    const rounded = values.map((v) => {
      const r = sig(v, SIG_EFFECT);
      if (r === null) exprNullCells++;
      return r;
    });
    exprValues += rounded.length;
    const row: ExprRow = sym === key ? [ti, rounded] : [ti, rounded, sym];
    let arr = exprIndex.get(key);
    if (!arr) { arr = []; exprIndex.set(key, arr); }
    arr.push(row);
    digestText(`expr|${key}|${JSON.stringify(row)}`);
  }
}
const geneNames = [...pickerGeneNames].sort();
console.log(`expression index: ${exprIndex.size} genes across ${datasetSummaries.length} default tracks`
  + ` (${exprValues} values, ${exprNullCells} null cells)`);

// ── Pass 1.6: the TRACK-PATHWAYS family ─────────────────────────────────────
//
// WHY THIS FAMILY EXISTS
// The search page's gene portal follows a gene to the conditions where it
// changes and then asks what ELSE changes there: which pathways are enriched in
// those same tracks. The pathway shards are keyed by pathway, so answering
// "the significant pathways of track X" from them would mean reading every
// pathway shard; the per-track sibling bundles hold the answer but cost 93 MB
// across the corpus. This is that answer, pivoted back to the track and cut
// down to the rows that pass the app's own cutoff.
//
// DERIVED FROM THE PATHWAY SHARDS, NOT FROM THE BUNDLES
// Every row is copied from the pathway index's own row for that (pathway,
// track) pair — same rounded NES, same threshold-checked padj, same dbIdx — so
// a pathway counted here is exactly one the pathway portal and report call
// significant, and --check holds the two families to each other. The drop
// rules mirror queryPathwayViaIndex: a row missing NES, padj or p is not a
// result. Every pathway-capable track gets a file even when it found nothing,
// so an empty list is a measured "none" and a missing file means "no analysis".
//
// ALL significant rows, not a top-N: the portal ranks pathways by how many of
// the gene's conditions share them, and a per-track cap would undercount a
// pathway that is significant everywhere but never in anyone's top N. The
// largest track carries ~1,800 rows (~120 KB before compression).
//
// THE BASE RATE RIDES ON EACH ROW. The portal ranks a pathway by how much more
// often it recurs among the gene's conditions than across the corpus (KEGG
// ribosome is significant in about half of all tracks, so raw recurrence ranks
// it first for nearly every gene). That needs, per pathway, the tracks where it
// is significant and the tracks where it was tested at all, counted here with
// the same drop rules as the rows. They go on the rows rather than in the
// manifest: ~5,000 significant pathway names would add ~250 KB to tracks.js,
// which every page loads, while the rows add two small integers to files the
// card already fetches. A pathway's counts are identical in every file.
type TrackPathRow = [string, number, number, number, number, number, number];
const corpusRate = new Map<string, [number, number]>();
for (const [key, rows] of pathIndex) {
  let sig = 0;
  let tested = 0;
  for (const [, NES, padj, pval] of rows) {
    if (NES === null || padj === null || pval === null) continue;
    tested++;
    if (padj < SIG_FDR) sig++;
  }
  corpusRate.set(key, [sig, tested]);
}
const trackPathRows = new Map<number, TrackPathRow[]>();
for (const ti of [...pathwayTracks].sort((a, b) => a - b)) trackPathRows.set(ti, []);
for (const [key, rows] of pathIndex) {
  const [sig, tested] = corpusRate.get(key)!;
  for (const [ti, NES, padj, pval, size, di] of rows) {
    if (NES === null || padj === null || pval === null || !(padj < SIG_FDR)) continue;
    trackPathRows.get(ti)?.push([key, NES, padj, size, di, sig, tested]);
  }
}
for (const rows of trackPathRows.values()) {
  rows.sort((a, b) => a[2] - b[2] || Math.abs(b[1]) - Math.abs(a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}
const trackPathwaysPayload = (ti: number) => ({
  ds: tracks[ti].ds, trackId: tracks[ti].trackId, rows: trackPathRows.get(ti) ?? [],
});
const trackPathTotal = [...trackPathRows.values()].reduce((n, rows) => n + rows.length, 0);
console.log(`track-pathways: ${trackPathRows.size} pathway-capable tracks, ${trackPathTotal} significant rows`);

// ── Pass 2: shard and emit ──────────────────────────────────────────────────

function bucketize<V>(index: Map<string, V>, shardOf: (k: string) => number, n: number): Array<Record<string, V>> {
  const shards: Array<Record<string, V>> = Array.from({ length: n }, () => ({}));
  for (const [k, v] of index) shards[shardOf(k)][k] = v;
  return shards;
}

const pad = (n: number) => String(n).padStart(3, '0');

if (checkOnly) {
  // Verify a previously-emitted index still agrees with the source bundles.
  let bad = 0;
  // The no-partial-index policy applies here too. Check mode used to exit before
  // that refusal, so a previously-emitted partial index PASSED --check as long as
  // the corpus was still partial in the same way — turning the one guard that
  // catches "a dataset stopped indexing" into a check that agreed with the damage.
  if (skippedTracks.length > 0 && !allowPartial) {
    console.error(
      `FAIL: ${skippedTracks.length} declared track(s) could not be indexed from the current source bundles:\n` +
      skippedTracks.map((t) => `  - ${t}`).join('\n') +
      '\n(pass --allow-partial if an index that omits them is genuinely intended)',
    );
    bad++;
  }
  const manifest = await readBundle<{ tracks: TrackEntry[] }>(path.join(OUT_DIR, 'tracks.js'));
  if (!manifest) {
    console.error(`FAIL: no tracks.js at ${OUT_DIR}`);
    process.exit(1);
  }
  if (manifest.tracks.length !== tracks.length) {
    console.error(`FAIL: manifest has ${manifest.tracks.length} tracks, source has ${tracks.length}`);
    bad++;
  }
  for (let i = 0; i < Math.min(manifest.tracks.length, tracks.length); i++) {
    const a = manifest.tracks[i];
    const b = tracks[i];
    if (a.ds !== b.ds || a.trackId !== b.trackId || a.lowPower !== b.lowPower) {
      console.error(`FAIL: manifest[${i}] = ${a.ds}/${a.trackId} lowPower=${a.lowPower}, source = ${b.ds}/${b.trackId} lowPower=${b.lowPower}`);
      bad++;
    }
  }
  const buildId = (manifest as unknown as { buildId?: string }).buildId;
  if (!buildId) { console.error('FAIL: manifest has no buildId'); bad++; }

  // Every shard file must exist, carry the manifest's build id, and hold
  // EXACTLY the keys and rows the current corpus pivots to.
  //
  // Exactness is the part that took a second attempt. The first version walked
  // the source keys and looked each one up in its shard, which proves nothing
  // about what ELSE the shard contains — and --check's whole reason to exist is
  // being run against a shard tree that was NOT just rebuilt. Delete a gene from
  // the corpus, leave the old shards in place, and a source-driven walk finds
  // every remaining key exactly where it should be and passes, while the shard
  // quietly keeps serving the deleted gene's statistics as current. The write
  // path chooses a new content-derived generation and refuses conflicting
  // immutable bytes; this check must also detect externally altered products.
  //
  // So the comparison is bidirectional, against the same bucketize() the writer
  // uses. It is also the reason --check is worth the corpus read the upload
  // preflight now spends on it.
  let shardsChecked = 0;
  const compareShards = async <V,>(
    index: Map<string, V>, sub: string, prefix: string, shardOf: (k: string) => number,
    n: number, label: string,
  ) => {
    const want = bucketize(index, shardOf, n);
    let checked = 0;
    for (let i = 0; i < n; i++) {
      const name = `${sub}/${prefix}${pad(i)}.js`;
      const env = await readBundle<{ b?: string; d?: Record<string, unknown> }>(
        path.join(OUT_DIR, buildId, sub, `${prefix}${pad(i)}.js`),
      );
      if (!env) { console.error(`FAIL: missing or unparseable shard ${name}`); bad++; continue; }
      if (env.b !== buildId) { console.error(`FAIL: ${name} has build ${env.b}, manifest has ${buildId}`); bad++; continue; }
      const got = env.d;
      if (typeof got !== 'object' || got === null) { console.error(`FAIL: ${name} has no payload`); bad++; continue; }
      shardsChecked++;

      for (const [key, rows] of Object.entries(want[i])) {
        if (!(key in got)) {
          if (bad < 10) console.error(`FAIL: ${name} is missing ${label} ${key}`);
          bad++;
        } else if (JSON.stringify(got[key]) !== JSON.stringify(rows)) {
          if (bad < 10) console.error(`FAIL: ${label} ${key} mismatch in ${name}`);
          bad++;
        }
        checked++;
      }
      for (const key of Object.keys(got)) {
        if (!(key in want[i])) {
          if (bad < 10) {
            console.error(`FAIL: ${name} still carries ${label} ${key}, which the source corpus no longer contains`);
          }
          bad++;
        }
      }
    }
    return checked;
  };
  const nGenes = await compareShards(geneIndex, 'genes', 'g', geneShard, GENE_SHARDS, 'gene');
  const nPaths = await compareShards(pathIndex, 'pathways', 'p', pathwayShard, PATHWAY_SHARDS, 'pathway');
  // Expression rows get the same full comparison, for the same reason: a value
  // that drifted from its bundle is a wrong bar with no error anywhere.
  const nExpr = await compareShards(exprIndex, 'expr', 'e', geneShard, EXPR_SHARDS, 'expression');

  // The autocomplete union and the interned DB-name table.
  const namesEnv = await readBundle<{ d?: string[] }>(path.join(OUT_DIR, buildId, 'pathway_names.js'));
  const names = namesEnv?.d;
  const wantNames = [...pathIndex.keys()].sort();
  if (!names || names.length !== wantNames.length || names.some((n, i) => n !== wantNames[i])) {
    console.error(`FAIL: pathway_names.js has ${names?.length ?? 0} names, expected ${wantNames.length}`);
    bad++;
  }
  // The gene-name union backing the Compare view's picker.
  const geneNamesEnv = await readBundle<{ d?: string[] }>(path.join(OUT_DIR, buildId, 'gene_names.js'));
  const gotGeneNames = geneNamesEnv?.d;
  if (!gotGeneNames || gotGeneNames.length !== geneNames.length || gotGeneNames.some((n, i) => n !== geneNames[i])) {
    console.error(`FAIL: gene_names.js has ${gotGeneNames?.length ?? 0} names, expected ${geneNames.length}`);
    bad++;
  }
  // exprShards is what tells a client the expression family is present at all.
  // A manifest that omits it (or misreports it) silently sends the Compare view
  // back to downloading 148 MB of bundles.
  const manifestExprShards = (manifest as unknown as { exprShards?: number }).exprShards;
  if (manifestExprShards !== EXPR_SHARDS) {
    console.error(`FAIL: manifest exprShards = ${manifestExprShards}, expected ${EXPR_SHARDS}`);
    bad++;
  }
  const manifestDbs = (manifest as unknown as { dbNames?: string[] }).dbNames ?? [];
  if (manifestDbs.length !== dbNames.length || manifestDbs.some((d, i) => d !== dbNames[i])) {
    console.error(`FAIL: manifest dbNames ${JSON.stringify(manifestDbs)} != source ${JSON.stringify(dbNames)}`);
    bad++;
  }
  // trackCounts is the client's redeploy-freshness signal (manifestCovers
  // compares it against each loaded meta.js) — a manifest that misreports it
  // silently disarms that guard.
  const manifestCounts = (manifest as unknown as { trackCounts?: Record<string, number> }).trackCounts;
  if (!manifestCounts) {
    console.error('FAIL: manifest has no trackCounts');
    bad++;
  } else {
    for (const [ds, n] of Object.entries(trackCounts)) {
      if (manifestCounts[ds] !== n) {
        console.error(`FAIL: manifest trackCounts[${ds}] = ${manifestCounts[ds]}, source has ${n} tracks`);
        bad++;
      }
    }
    for (const ds of Object.keys(manifestCounts)) {
      if (!(ds in trackCounts)) {
        console.error(`FAIL: manifest trackCounts names ${ds}, which the source corpus does not contain`);
        bad++;
      }
    }
  }
  // Browse summaries. A stale or partial catalog is not a visible error either:
  // it shows a card with the wrong N, or silently omits a dataset the user can
  // reach every other way. Check the ID SET both directions, and that each
  // summary's default track is one the manifest actually carries.
  const manifestSummaries = (manifest as unknown as { datasets?: DatasetSummary[] }).datasets;
  if (!manifestSummaries) {
    console.error('FAIL: manifest carries no `datasets` browse catalog (rebuild with the current generator)');
    bad++;
  } else {
    const expected = new Map(datasetSummaries.map((s) => [s.ds, s]));
    for (const got of manifestSummaries) {
      const want = expected.get(got.ds);
      if (!want) { console.error(`FAIL: manifest summarises ${got.ds}, which the source corpus does not contain`); bad++; continue; }
      for (const k of ['trackCount', 'defaultTrack', 'trackLabel', 'nGenes', 'nBaseline', 'nCase', 'nVaries', 'lowPowerTracks', 'contrastId'] as const) {
        if (got[k] !== want[k]) {
          console.error(`FAIL: summary ${got.ds}.${k} = ${JSON.stringify(got[k])}, source has ${JSON.stringify(want[k])}`);
          bad++;
        }
      }
      // The expression scaffolding is compared structurally, not with !==.
      // These two fields are the entire mapping from a position in an
      // expression row to a sample and an arm: drift here does not fail, it
      // plots the right numbers against the wrong animals.
      for (const k of ['sampleOrder', 'groupSamples', 'armKeys', 'discoveries'] as const) {
        if (JSON.stringify(got[k]) !== JSON.stringify(want[k])) {
          console.error(`FAIL: summary ${got.ds}.${k} differs from the source bundle's`);
          bad++;
        }
      }
      // A summary whose scaffolding is empty cannot serve an expression row at
      // all; the client would drop the dataset with no way to say why.
      if (!want.sampleOrder.length) {
        console.error(`FAIL: summary ${got.ds} has an empty sampleOrder - its default track declares no samples`);
        bad++;
      }
      expected.delete(got.ds);
    }
    for (const ds of expected.keys()) {
      console.error(`FAIL: manifest has no browse summary for ${ds}`);
      bad++;
    }
  }

  // Track-pathways: the manifest's capability record, then every file, exactly
  // and in both directions. A stale file is a wrong "what else changes here"
  // list with no error anywhere; a stray one is a track the manifest no longer
  // vouches for. The exact comparison covers each row's corpus counts too, so a
  // base rate that drifted from the pathway rows (a wrong specificity rank,
  // also silent) fails here.
  let nTrackPathFiles = 0;
  const manifestTrackPaths = (manifest as unknown as { trackPathways?: { fdr?: number; tracks?: number[] } }).trackPathways;
  const wantTrackPathIdx = [...trackPathRows.keys()];
  if (!manifestTrackPaths) {
    console.error('FAIL: manifest carries no `trackPathways` family (rebuild with the current generator)');
    bad++;
  } else {
    if (manifestTrackPaths.fdr !== SIG_FDR) {
      console.error(`FAIL: manifest trackPathways.fdr = ${manifestTrackPaths.fdr}, expected ${SIG_FDR}`);
      bad++;
    }
    if (JSON.stringify(manifestTrackPaths.tracks) !== JSON.stringify(wantTrackPathIdx)) {
      console.error(`FAIL: manifest trackPathways.tracks lists ${manifestTrackPaths.tracks?.length ?? 0} tracks, source has ${wantTrackPathIdx.length}`);
      bad++;
    }
    for (const ti of wantTrackPathIdx) {
      const name = trackPathwaysFile(ti);
      const env = await readBundle<{ b?: string; d?: unknown }>(path.join(OUT_DIR, buildId, name));
      if (!env) { console.error(`FAIL: missing or unparseable ${name}`); bad++; continue; }
      if (env.b !== buildId) { console.error(`FAIL: ${name} has build ${env.b}, manifest has ${buildId}`); bad++; continue; }
      if (JSON.stringify(env.d) !== JSON.stringify(trackPathwaysPayload(ti))) {
        console.error(`FAIL: ${name} (${tracks[ti].ds}/${tracks[ti].trackId}) differs from the source pathway rows`);
        bad++;
        continue;
      }
      nTrackPathFiles++;
    }
    const trackPathDir = path.join(OUT_DIR, buildId, 'trackpaths');
    const present = existsSync(trackPathDir) ? await readdir(trackPathDir) : [];
    const wanted = new Set(wantTrackPathIdx.map((ti) => path.basename(trackPathwaysFile(ti))));
    for (const file of present) {
      if (!wanted.has(file)) {
        console.error(`FAIL: trackpaths/${file} is not a pathway-capable track of this build`);
        bad++;
      }
    }
  }

  // Labels/types/lowPower are what the report renders; a drift here shows wrong
  // names against right numbers.
  for (let i = 0; i < Math.min(manifest.tracks.length, tracks.length); i++) {
    if (manifest.tracks[i].label !== tracks[i].label || manifest.tracks[i].type !== tracks[i].type) {
      console.error(`FAIL: manifest[${i}] label/type drift: ${manifest.tracks[i].label}/${manifest.tracks[i].type} vs ${tracks[i].label}/${tracks[i].type}`);
      bad++;
    }
  }

  if (bad) { console.error(`\n${bad} check failure(s).`); process.exit(1); }
  console.log(
    `OK: build ${buildId}: ${shardsChecked} shards stamped + present, `
    + `${nGenes} genes, ${nPaths} pathways and ${nExpr} expression genes byte-identical to `
    + `the source bundles, ${nTrackPathFiles} track-pathway files matching the pathway rows and base rates, `
    + `${names?.length ?? 0} pathway + ${gotGeneNames?.length ?? 0} gene `
    + `autocomplete names, ${manifest.tracks.length} manifest tracks.`,
  );
  process.exit(0);
}

// A partial index is worse than no index. The client's manifestCovers() guard
// only checks that each queried DATASET appears — it cannot know that a dataset
// is missing 3 of its 60 tracks, so those tracks would silently render as
// "gene not detected", a claim of absence for data that was never read.
// Fail the build instead, unless explicitly overridden.
if (skippedTracks.length > 0 && !allowPartial) {
  console.error(
    `\nREFUSING to write a partial index: ${skippedTracks.length} declared track(s) could not be indexed:\n` +
    skippedTracks.map((t) => `  - ${t}`).join('\n') +
    '\n\nFix the source bundles, or pass --allow-partial if you genuinely want an index\n' +
    'that omits them (the app will report those tracks as having no data).',
  );
  process.exit(1);
}

// Derive the build id from the exact corpus this run indexed — structure AND
// values (see buildIdFrom).
BUILD_ID = buildIdFrom([
  String(tracks.length), String(geneIndex.size), String(pathIndex.size), String(exprIndex.size),
  ...tracks.map((t) => `${t.ds}/${t.trackId}`),
  ...dbNames,
  `content:${(contentHash >>> 0).toString(36)}`,
  // The wide digest. Every string the 32-bit counter saw also went in here, so
  // this covers the gene and pathway rows as well as the expression rows and
  // the sample scaffolding.
  `sha:${contentSha.digest('hex').slice(0, 16)}`,
]);
console.log(`build id: ${BUILD_ID}`);

assertSafeOutDir(OUT_DIR);
// Every generation has its own content-derived prefix. Retain old generations
// and other query families so already-open clients can still fetch their data.

let outBytes = 0;
const manifestPayload =
  // `datasets` is additive: a client built against v1 ignores it, and
  // datasetCatalog.ts treats its absence as "fall back to registry-only cards"
  // rather than an error — so this manifest is safe to ship before the
  // regenerated index reaches R2.
  // `v` stays 2: the version is not what any client branches on. Readers test
  // for the FIELD they need (datasetCatalog for `datasets`, the Compare view
  // for `exprShards` plus the per-summary scaffolding) and degrade to their old
  // path when it is absent, so an added field is additive by construction and a
  // bumped number would only invite a version check nothing needs.
  {
    v: 2, buildId: BUILD_ID,
    geneShards: GENE_SHARDS, pathwayShards: PATHWAY_SHARDS, exprShards: EXPR_SHARDS,
    dbNames, trackCounts, tracks, datasets: datasetSummaries,
    // Additive like `datasets`: which tracks have a track-pathways file, and
    // the cutoff that selected their rows. The search portal reads the family
    // only when both are present and the cutoff is its own.
    trackPathways: { fdr: SIG_FDR, tracks: [...trackPathRows.keys()] },
  };

// The gene-name union over the indexed default tracks' DE tables, for the
// cross-dataset Compare view's gene picker (see pickerGeneNames for why the DE
// table and not cpm). UPPERCASE, so a gene appears once rather than once per
// species spelling (49,145 names instead of 60,776) -- the charts recover each
// dataset's own casing from its expression row's `sym`.
outBytes += await writeJsonp(
  path.join(OUT_DIR, BUILD_ID, 'gene_names.js'),
  'HX_QUERY_GENE_NAMES',
  'sorted union of every DE-table gene symbol (uppercased) across the indexed default tracks (autocomplete)',
  shardEnvelope(geneNames),
);

// The pathway-name union, for the pathway search autocomplete. Replaces
// loadPathwayIndex()'s fan-out over all 41 per-dataset pathways_index.js files
// (5.52 MB, 41 requests) — which between them contain only these 5,122 distinct
// gs_names, because MSigDB names are species-stable and repeat across datasets.
outBytes += await writeJsonp(
  path.join(OUT_DIR, BUILD_ID, 'pathway_names.js'),
  'HX_QUERY_PATHWAY_NAMES',
  'sorted union of every gs_name across all pathway-capable datasets (autocomplete)',
  shardEnvelope([...pathIndex.keys()].sort()),
);

// Per-dataset card detail: the volcano cloud behind the library card's hover
// popover. One small file per dataset, fetched only when a reader opens a
// popover, because the alternative sources are both wrong - the manifest is
// fetched on every visit and this would add ~1.5 MB to it, and the track bundle
// that holds the real DE table is 2.6 MB at the median.
let cardBytes = 0;
let maxCard = 0;
for (const [ds, cloud] of [...cloudByDs].sort((a, b) => a[0].localeCompare(b[0]))) {
  const b = await writeJsonp(
    path.join(OUT_DIR, BUILD_ID, 'cards', `${ds}.js`),
    cardGlobalName(ds),
    `card detail for ${ds} - downsampled volcano cloud for track ${cloud.track}`,
    shardEnvelope(cloud),
  );
  cardBytes += b;
  if (b > maxCard) maxCard = b;
}
outBytes += cardBytes;
console.log(`  cards: ${cloudByDs.size} files, ${(cardBytes / 1024).toFixed(0)} KB total, ` +
  `${(maxCard / 1024).toFixed(1)} KB largest`);

const geneShardsData = bucketize(geneIndex, geneShard, GENE_SHARDS);
let geneBytes = 0;
let maxGeneShard = 0;
for (let i = 0; i < GENE_SHARDS; i++) {
  const b = await writeJsonp(
    path.join(OUT_DIR, BUILD_ID, 'genes', `g${pad(i)}.js`),
    `HX_QUERY_GENES_${pad(i)}`,
    `gene index shard ${i}/${GENE_SHARDS} — GENE -> [[trackIdx, logFC, pval, fdr, se], …]`,
    shardEnvelope(geneShardsData[i]),
  );
  geneBytes += b;
  if (b > maxGeneShard) maxGeneShard = b;
}
outBytes += geneBytes;

const pathShardsData = bucketize(pathIndex, pathwayShard, PATHWAY_SHARDS);
let pathBytes = 0;
let maxPathShard = 0;
for (let i = 0; i < PATHWAY_SHARDS; i++) {
  const b = await writeJsonp(
    path.join(OUT_DIR, BUILD_ID, 'pathways', `p${pad(i)}.js`),
    `HX_QUERY_PATHWAYS_${pad(i)}`,
    `pathway index shard ${i}/${PATHWAY_SHARDS} — PATHWAY -> [[trackIdx, NES, padj, pval, size, dbIdx], …]`,
    shardEnvelope(pathShardsData[i]),
  );
  pathBytes += b;
  if (b > maxPathShard) maxPathShard = b;
}
outBytes += pathBytes;

const exprShardsData = bucketize(exprIndex, geneShard, EXPR_SHARDS);
let exprBytes = 0;
let maxExprShard = 0;
for (let i = 0; i < EXPR_SHARDS; i++) {
  const b = await writeJsonp(
    path.join(OUT_DIR, BUILD_ID, 'expr', `e${pad(i)}.js`),
    `HX_QUERY_EXPR_${pad(i)}`,
    `expression index shard ${i}/${EXPR_SHARDS} — GENE -> [[trackIdx, [perSampleValues], sym?], …]`,
    shardEnvelope(exprShardsData[i]),
  );
  exprBytes += b;
  if (b > maxExprShard) maxExprShard = b;
}
outBytes += exprBytes;

let trackPathBytes = 0;
let maxTrackPath = 0;
for (const ti of trackPathRows.keys()) {
  const b = await writeJsonp(
    path.join(OUT_DIR, BUILD_ID, trackPathwaysFile(ti)),
    trackPathwaysGlobal(ti),
    `significant pathways (padj < ${SIG_FDR}) of track ${tracks[ti].ds}/${tracks[ti].trackId} — [[PATHWAY, NES, padj, size, dbIdx, sigTracks, testedTracks], …]`,
    shardEnvelope(trackPathwaysPayload(ti)),
  );
  trackPathBytes += b;
  if (b > maxTrackPath) maxTrackPath = b;
}
outBytes += trackPathBytes;

// Publish the mutable pointer only after every immutable object succeeds. A
// failed or conflicting write above leaves the previously usable pointer intact.
outBytes += await writeJsonp(
  path.join(OUT_DIR, 'tracks.js'),
  'HX_QUERY_TRACKS',
  'cross-dataset query manifest: one entry per (dataset, track)',
  manifestPayload,
);

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
console.log(`\nwrote ${OUT_DIR}`);
console.log(`  total ${(outBytes / 1048576).toFixed(1)} MB across ${2 + GENE_SHARDS + PATHWAY_SHARDS + EXPR_SHARDS} files`);
console.log(`  gene shards:    ${(geneBytes / 1048576).toFixed(1)} MB — avg ${kb(geneBytes / GENE_SHARDS)}, worst ${kb(maxGeneShard)}`);
console.log(`  pathway shards: ${(pathBytes / 1048576).toFixed(1)} MB — avg ${kb(pathBytes / PATHWAY_SHARDS)}, worst ${kb(maxPathShard)}`);
console.log(`  expr shards:    ${(exprBytes / 1048576).toFixed(1)} MB — avg ${kb(exprBytes / EXPR_SHARDS)}, worst ${kb(maxExprShard)}`);
console.log(`  track-pathways: ${(trackPathBytes / 1048576).toFixed(1)} MB — ${trackPathRows.size} files, worst ${kb(maxTrackPath)}`);
console.log(`\n  a cross-dataset query now costs tracks.js + ONE shard, replacing ${(srcBytes / 1048576).toFixed(0)} MB of track bundles.`);
console.log('  the cross-dataset Compare view costs tracks.js + one gene shard + one expr shard,');
console.log(`  replacing ${(exprSrcBytes / 1048576).toFixed(0)} MB of default-track bundles over ${datasetSummaries.length} requests.`);
