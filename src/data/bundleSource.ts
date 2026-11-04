// The bundle-source seam: the single place a bundle URL + window-global name
// becomes a value — and the single place its bytes are counted.
//
// Data bundles are loaded as CLASSIC SCRIPTS that assign a namespaced global
// (`var HX_… = {…}`), not as JSON, because they may be served cross-origin from
// R2 with no CORS policy. That mechanic used to be reimplemented six times
// (loadTrack ×3, loadDatasetMeta, queryIndex, useTrackerData), each with its own
// cache pair, its own in-flight map and its own copy of the ?v= cache-bust. This
// module owns all of it once.
//
// Contract:
//   loadRequiredBundle<T>(url, globalKey, failLabel?) -> Promise<T>       (rejects)
//   loadOptionalBundle<T>(url, globalKey)             -> Promise<T | null>
//   subscribeBundleProgress(listener)                 -> unsubscribe
//
// Callers pass fully-formed URLs; base-URL construction lives in bundleBase.ts
// (BUNDLE_BASE) and datasets.ts (each dataset's bundleBaseUrl), not here.
//
// Required vs optional is TWO FUNCTIONS rather than one function with a flag, so
// the policy is part of the in-flight identity. With a flag, two concurrent
// callers wanting different failure semantics would both inherit whichever one
// started first.
//
// Caching:
//   - A resolved value is cached by URL, forever, and shared by both functions.
//     Keying by URL rather than by global key matters for the query shards: they
//     reuse a global name (HX_QUERY_GENES_042) across build ids while the URL
//     carries the build id, so a global-key cache could pin an old build's shard.
//   - A miss is cached only on the optional path, and only when it is
//     DETERMINISTIC (the script loaded but set no global). Failed loads are
//     never cached on either path — a <script> onerror cannot tell a 404 from
//     a network blip, and a cached blip would downgrade the whole session.
//
// What this seam cannot distinguish: a <script> onerror fires identically for a
// 404, a DNS failure, a CSP block and a parse error. 'load-failed' means all of
// them. Only "script loaded but the global is unset" is separable, and it is —
// because that one indicates a malformed bundle rather than a transport problem,
// and the loaders phrase it differently. (The streaming transport below DOES see
// an HTTP status, and reports a non-2xx as 'load-failed' without re-requesting.)

import { BUNDLE_BASE_IS_CORS_ENABLED } from './bundleBase';
import { RELEASE_IDENTITY, releaseBundleVersion } from './releaseIdentity';

/**
 * What a transport reports back.
 *
 * Three states, not two: `loadRequiredBundle` phrases 'missing-global' and
 * 'load-failed' as different errors, and collapsing them to null would lose the
 * only diagnostic that tells a malformed bundle from a failed request.
 */
export type BundleOutcome =
  | { status: 'ok'; value: unknown }
  | { status: 'missing-global' }
  | { status: 'load-failed' };

/** Bytes of one bundle so far, as a transport counts them while it reads. */
export interface BundleBytes {
  /** Decompressed bytes received. */
  loaded: number;
  /** Decompressed total, when the transport can tell. Usually it cannot. */
  total: number | null;
}

/** How a transport hands byte counts back while a load is in flight. */
export type BundleReporter = (bytes: BundleBytes) => void;

/**
 * How a bundle's bytes become a window global. The seam.
 *
 * `report` is optional to IMPLEMENT (a transport that cannot count bytes simply
 * ignores it — every test transport does) but always supplied, so no transport
 * needs a null check.
 */
export type BundleTransport = (
  url: string,
  globalKey: string,
  report: BundleReporter,
) => Promise<BundleOutcome>;

// ── Progress ────────────────────────────────────────────────────────────────
// One event stream for every bundle load in the app, because the two things the
// UI wants are different reductions of the same events: the explorer overlay
// follows ONE url (a track bundle), while the cross-dataset reports want the
// SUM over a burst of dozens. Publishing per-load state instead would make the
// second one the caller's bookkeeping problem, at three call sites.
//
// Emitted from `fetchOutcome` rather than from inside the transports, so a
// transport that reports nothing (the <script> fallback) still produces the
// start/finish pair — "loading, size unknown" stays distinguishable from
// "nothing is loading".

/** One tick of one bundle's load. */
export interface BundleProgress {
  /** The bundle URL, WITHOUT the ?v= bust — what callers resolved and can match. */
  url: string;
  /** Decompressed bytes received so far. 0 when the transport cannot count. */
  loaded: number;
  /** Decompressed total, or null when unknown (the bar goes indeterminate). */
  total: number | null;
  /** True on the final tick, whether the load succeeded or failed. */
  done: boolean;
}

type ProgressListener = (event: BundleProgress) => void;
const progressListeners = new Set<ProgressListener>();

/** Observe every bundle load in the app. Returns the unsubscribe. */
export function subscribeBundleProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener);
  return () => { progressListeners.delete(listener); };
}

function emitProgress(event: BundleProgress): void {
  // Snapshot before iterating: a listener that unsubscribes itself on `done`
  // must not mutate the set mid-iteration.
  for (const listener of [...progressListeners]) listener(event);
}

/**
 * The build-time uncompressed size of a bundle, or null when unknown.
 *
 * This — not Content-Length — is the progress bar's denominator. Bundles are
 * served with Content-Encoding (brotli sidecars same-origin, brotli object
 * metadata on R2), so the header counts COMPRESSED bytes while a streaming
 * reader yields DECOMPRESSED ones; using it as a total sends the bar past 100%
 * roughly a sixth of the way in. `__BUNDLE_SIZES__` is measured from public/ by
 * vite.config's `measureBundleSizes`, so it counts the same bytes the reader
 * will eventually have counted.
 *
 * It is also known BEFORE the request starts, which is what lets the overlay
 * say "2.4 MB" on the first frame rather than after the first chunk lands.
 *
 * Keys are request paths, so the ?v= bust and any off-origin BUNDLE_BASE are
 * stripped. A URL that is not in the map (a query shard; a bundle added after
 * this build) returns null and loads without a percentage.
 */
export function expectedBundleBytes(url: string): number | null {
  if (typeof __BUNDLE_SIZES__ === 'undefined') return null;
  const path = url.split('?')[0];
  const at = path.indexOf('/datasets/');
  const size = __BUNDLE_SIZES__[at === -1 ? path : path.slice(at)];
  return typeof size === 'number' && size > 0 ? size : null;
}

/**
 * Read a bundle straight off `window`, without requesting anything.
 *
 * `undefined` means "no bundle has set this global", which is not the same as
 * "the bundle is empty" — a caller deciding whether to fetch must treat it as
 * unknown. SSR-guarded, so a module that runs before the DOM exists (or under
 * a Node test) simply sees nothing rather than throwing.
 *
 * This lives HERE, in the module that owns global-key semantics, because a
 * window read was previously spelled three times: this file's transport, the
 * explorer store's eager-global seed, and the tracker's direct
 * `window.HX_TRACKER_CATALOG`. Distinct from `peekBundle`, which peeks the
 * CACHE by url; this one peeks the window by global key.
 */
export function peekGlobalBundle<T>(globalKey: string): T | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as Record<string, unknown>)[globalKey] as T | undefined;
}

// ── Transports ──────────────────────────────────────────────────────────────

/**
 * Cache-bust mutable filenames across app deploys. Query shards already carry
 * their data build ID in the path, so keep that cache key across UI releases.
 *
 * Kept as a `?v=` query on an otherwise unchanged path: the service worker's
 * runtime caching matches on pathname, so altering the path shape here would
 * silently bypass the /datasets/ and /query/ cache rules in vite.config.ts.
 * BOTH transports go through this, so the streaming path and the <script>
 * fallback address the same service-worker cache entry — which is what keeps a
 * fallback after a failed fetch from being a guaranteed second download.
 */
function versioned(url: string): string {
  const parsed = new URL(url, 'https://bundles.invalid');
  // Match only the generator's immutable families. The mutable tracks.js
  // pointer and older unversioned query layouts need a release-specific key.
  const immutableQuery = /(?:^|\/)query\/[a-z0-9]{2,14}\/(?:(?:genes\/g|pathways\/p|expr\/e)\d{3}|trackpaths\/t\d{3,}|(?:gene|pathway)_names|cards\/[A-Za-z0-9_-]+)\.js$/;
  const immutableExpression = /(?:^|\/)query\/expression\/[a-f0-9]{64}\/(?:manifest|shards\/e\d{3})\.js$/;
  if (!parsed.search && !parsed.hash && (immutableQuery.test(parsed.pathname) || immutableExpression.test(parsed.pathname))) return url;
  // Source/data generations may share an app version. A persistent browser/SW
  // cache must not return an older track under the new export release identity.
  const v = releaseBundleVersion(RELEASE_IDENTITY.releaseId,
    typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev');
  return `${url}?v=${v}`;
}

/** Run a classic script from `src`; true if it loaded, false if it errored. */
function injectScript(src: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

function readGlobal(globalKey: string): BundleOutcome {
  const value = peekGlobalBundle(globalKey);
  return value === undefined ? { status: 'missing-global' } : { status: 'ok', value };
}

/**
 * Fallback adapter: inject a <script src>, then read the global it set.
 *
 * Counts no bytes — a <script> tag reports no progress, which is precisely why
 * the streaming transport below exists. It is still the only option cross-origin
 * without CORS, so it stays the floor everything degrades to.
 *
 * The eager-global check lives in the transports rather than in the cache
 * layer, so a test that installs its own transport gets a genuinely clean slate
 * — clearing the cache while the cache layer still re-read window globals would
 * leave stale fixtures visible through a supposedly reset module.
 */
const scriptTagTransport: BundleTransport = async (url, globalKey) => {
  const seed = peekGlobalBundle(globalKey);
  if (seed !== undefined) return { status: 'ok', value: seed };
  if (typeof document === 'undefined') return { status: 'load-failed' };
  return (await injectScript(versioned(url))) ? readGlobal(globalKey) : { status: 'load-failed' };
};

/**
 * Whether `url` can be read with fetch() instead of a <script> tag.
 *
 * Same-origin always can. Cross-origin needs the bucket to send CORS headers,
 * which is a DEPLOY fact this build cannot detect — and detecting it by trying
 * would cost a wasted multi-megabyte download on every deploy that has not
 * configured it. So it is declared: VITE_BUNDLE_CORS, off by default.
 * Optimistic-and-wrong is the only expensive way to be wrong here;
 * conservative-and-wrong just means no percentage.
 */
function canStream(url: string): boolean {
  if (typeof fetch !== 'function' || typeof Blob !== 'function') return false;
  if (typeof document === 'undefined' || typeof location === 'undefined') return false;
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  try {
    if (new URL(url, location.href).origin === location.origin) return true;
  } catch {
    return false;
  }
  return BUNDLE_BASE_IS_CORS_ENABLED;
}

/** Drain a response body, reporting bytes as they land. */
async function drain(
  body: ReadableStream<Uint8Array>,
  total: number | null,
  report: BundleReporter,
): Promise<BlobPart[]> {
  const reader = body.getReader();
  const chunks: BlobPart[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value as unknown as BlobPart);
    loaded += value.byteLength;
    report({ loaded, total });
  }
  return chunks;
}

/**
 * Execute already-downloaded source as a CLASSIC script, via a blob URL.
 *
 * A blob URL rather than eval or an inline <script>, because the bundles are
 * `var HX_… = {…}` at top level and only a classic script puts that `var` on
 * `window`: `new Function(src)` would scope it to the function and leave the
 * global unset, and an inline <script> needs 'unsafe-inline' under any CSP the
 * site later adopts. Execution semantics are then identical to the <script src>
 * path, which is what makes the two transports interchangeable.
 *
 * The chunks go into the Blob as bytes, never through a decoded string: a 10 MB
 * bundle would otherwise be held three times over at peak.
 *
 * Returns null when the blob script itself failed to run — an environment
 * problem, not a bundle problem, so the caller retries via <script src> rather
 * than reporting a malformed bundle.
 */
async function runSource(chunks: BlobPart[], globalKey: string): Promise<BundleOutcome | null> {
  const objectUrl = URL.createObjectURL(new Blob(chunks, { type: 'text/javascript' }));
  try {
    return (await injectScript(objectUrl)) ? readGlobal(globalKey) : null;
  } finally {
    // Safe here and not a frame earlier: injectScript has already resolved, so
    // the script has finished executing.
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Production adapter: stream the bundle with fetch(), counting bytes, then run
 * it as a classic script. Falls back to <script src> whenever fetch is not an
 * option or does not land.
 *
 * A non-2xx response is reported as 'load-failed' WITHOUT the fallback: the
 * status is a real answer, and re-requesting a 404 through a <script> tag only
 * buys a second 404. A THROWN fetch (CORS rejection, offline, aborted) is
 * ambiguous, so that one does fall back.
 */
const streamingTransport: BundleTransport = async (url, globalKey, report) => {
  const seed = peekGlobalBundle(globalKey);
  if (seed !== undefined) return { status: 'ok', value: seed };
  if (!canStream(url)) return scriptTagTransport(url, globalKey, report);

  let chunks: BlobPart[];
  try {
    const res = await fetch(versioned(url), { credentials: 'omit' });
    if (!res.ok) return { status: 'load-failed' };
    if (!res.body) {
      chunks = [await res.blob()];
    } else {
      // Content-Length is a usable total only for an UNENCODED response; see
      // expectedBundleBytes. When the response IS encoded the build-time size
      // takes over anyway, so this is only the last-resort denominator.
      const declared = Number(res.headers.get('content-length'));
      const total = !res.headers.get('content-encoding') && declared > 0 ? declared : null;
      chunks = await drain(res.body, total, report);
    }
  } catch {
    return scriptTagTransport(url, globalKey, report);
  }

  return (await runSource(chunks, globalKey)) ?? scriptTagTransport(url, globalKey, report);
};

let transport: BundleTransport = streamingTransport;

// ── Cache + dedup ───────────────────────────────────────────────────────────

const valueCache = new Map<string, unknown>();  // url -> resolved value
const missCache = new Set<string>();           // url -> known-absent (optional path only)

// Two levels of dedup, because a request and a policy are different things:
//   requestInFlight — one transport call per URL, shared by both policies, so a
//     required and an optional caller wanting the same bundle never fetch twice.
//   policyInFlight  — one promise per (policy, URL), so each caller gets its own
//     failure semantics AND a stable promise identity for a concurrent call.
// Collapsing these into one map would make the policy inherit from whichever
// caller happened to start first.
const requestInFlight = new Map<string, Promise<BundleOutcome>>();
const policyInFlight = new Map<string, Promise<unknown>>();

// Bumped by a reset. Anything still in flight belongs to the previous generation
// and must not write to the fresh cache — otherwise a reset could be silently
// undone by a request that started before it.
let generation = 0;

function fetchOutcome(url: string, globalKey: string, gen: number): Promise<BundleOutcome> {
  const pending = requestInFlight.get(url);
  if (pending) return pending;

  // Progress is emitted HERE, wrapped around the transport, so every load
  // produces the same shape of event stream whichever transport runs: one start
  // tick (already carrying the size, which is known before the request), zero or
  // more byte ticks, and exactly one `done`. A subscriber can therefore always
  // pair a start with a finish — including for a cached-global resolve that
  // never touches the network.
  const total = expectedBundleBytes(url);
  let loaded = 0;
  emitProgress({ url, loaded: 0, total, done: false });
  const report: BundleReporter = (bytes) => {
    loaded = bytes.loaded;
    emitProgress({ url, loaded, total: total ?? bytes.total, done: false });
  };

  const request = transport(url, globalKey, report)
    // A transport that throws is a failed load, not a crash for the caller.
    .catch((): BundleOutcome => ({ status: 'load-failed' }));
  request.then((outcome) => {
    // A success that counted nothing (the <script> fallback; an eager global)
    // still finishes at its full size, so a cumulative byte counter stays
    // truthful. A FAILURE never claims bytes it did not receive.
    const settled = outcome.status === 'ok' && total !== null ? Math.max(loaded, total) : loaded;
    emitProgress({ url, loaded: settled, total, done: true });
    if (gen === generation) requestInFlight.delete(url);
  });
  requestInFlight.set(url, request);
  return request;
}

function trackPolicy<T>(key: string, gen: number, promise: Promise<T>): Promise<T> {
  // Settle-tracking on a separate branch so a rejection here is always handled;
  // the caller still gets the original promise to handle (or not) themselves.
  promise.catch(() => {}).then(() => { if (gen === generation) policyInFlight.delete(key); });
  policyInFlight.set(key, promise as Promise<unknown>);
  return promise;
}

/**
 * A bundle the app cannot proceed without.
 *
 * Rejects on a failed load or an unset global, and does NOT cache the failure,
 * so a retry re-requests. `failLabel` replaces the URL in the load-failure
 * message for callers whose users need a friendlier noun ("dataset metadata for
 * mouse_bulk_hfd") than a path.
 *
 * Returns the in-flight promise itself on a concurrent call — callers rely on
 * that identity to prove a single request was made.
 */
export function loadRequiredBundle<T>(url: string, globalKey: string, failLabel?: string): Promise<T> {
  if (valueCache.has(url)) return Promise.resolve(valueCache.get(url) as T);
  const key = `req::${url}`;
  const pending = policyInFlight.get(key);
  if (pending) return pending as Promise<T>;

  const gen = generation;
  return trackPolicy(key, gen, fetchOutcome(url, globalKey, gen).then((outcome) => {
    if (outcome.status === 'missing-global') {
      throw new Error(`${globalKey} not defined after loading ${url}`);
    }
    if (outcome.status === 'load-failed') {
      throw new Error(`Failed to load ${failLabel ?? url}`);
    }
    if (gen === generation) valueCache.set(url, outcome.value);
    return outcome.value as T;
  }));
}

/**
 * A bundle whose absence is a legitimate answer (a pathway sibling a dataset
 * never generated; a query shard from a deploy that predates the index).
 *
 * Resolves null instead of rejecting. Only a DETERMINISTIC miss is cached — the
 * script loaded but never set its global, which no retry can change. A failed
 * load is left retryable: a <script> onerror cannot distinguish a 404 from a
 * network blip, and caching the blip would silently downgrade every later call
 * for the session (one flaky moment on the query manifest would send every
 * cross-dataset query down the full-download path). A genuinely absent bundle
 * therefore costs one small failed request per call site, not per session —
 * the price of staying recoverable.
 */
export function loadOptionalBundle<T>(url: string, globalKey: string): Promise<T | null> {
  if (valueCache.has(url)) return Promise.resolve(valueCache.get(url) as T);
  if (missCache.has(url)) return Promise.resolve(null);
  const key = `opt::${url}`;
  const pending = policyInFlight.get(key);
  if (pending) return pending as Promise<T | null>;

  const gen = generation;
  return trackPolicy(key, gen, fetchOutcome(url, globalKey, gen).then((outcome) => {
    if (outcome.status !== 'ok') {
      if (outcome.status === 'missing-global' && gen === generation) missCache.add(url);
      return null;
    }
    if (gen === generation) valueCache.set(url, outcome.value);
    return outcome.value as T;
  }));
}

/**
 * Read an already-resolved bundle without requesting it. `undefined` means
 * "never loaded this session", which callers must treat as unknown, not absent.
 * Exists for opportunistic checks (manifestCovers's track-count comparison)
 * that want to consult a bundle IF some other code path already paid for it,
 * without adding a network request of their own.
 */
export function peekBundle<T>(url: string): T | undefined {
  return valueCache.has(url) ? (valueCache.get(url) as T) : undefined;
}

/** Test-only: install a transport (e.g. one backed by a fixture map). */
export function _setBundleTransport(next: BundleTransport | null): void {
  transport = next ?? streamingTransport;
}

/** Test-only: drop every cached bundle and orphan anything still in flight. */
export function _resetBundleCache(): void {
  generation++;
  valueCache.clear();
  missCache.clear();
  requestInFlight.clear();
  policyInFlight.clear();
}
