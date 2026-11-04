// Track columns: the single place a (dataset, track) a view has asked for moves
// through its load lifecycle and comes out as popData — or as a stated failure.
//
// A "column" is one loaded track shown beside others: a population in the
// single-cell Compare tab, a study in the compare set, the one track an effect
// preview draws. Before this module each of those callers wrote its own state
// machine over the track-data seam, and they disagreed in ways users could see:
//
//   * CompareTab loaded through the explorer store's `quiet` path, whose catch
//     swallowed the failure and resolved undefined. The tab could not tell
//     "still loading" from "will never load", so a population whose bundle
//     failed showed "Loading X…" for the rest of the session, Export stayed
//     disabled, and nothing offered a retry. Its effect also re-fired the load
//     whenever `getTrack` changed identity, so the only retry was an
//     uncontrolled one.
//   * The gene effect preview borrowed the whole explorer store, which also
//     fetched the dataset's meta.js through its meta effect — a request the
//     preview never read.
//   * The pathway effect preview borrowed the compare set's hook for a single
//     track, and with it a meta.js request and the compare set's default
//     contrast, which it then had to override.
//
// Contract:
//   useTrackColumns(requests, policy) -> TrackColumn[]   (one per request, in order)
//   useTrackColumn(request, policy)   -> TrackColumn
//
// Each column moves through
//
//   loading → ready            (track known, bundle parsed)
//           → failed           (meta or bundle refused; error says why)
//           → unknown-track    (policy 'verify' only: the dataset's meta does
//                               not list the track)
//
// and every column carries `retry`, which restarts that column alone — from any
// state, so a ready column whose pathway sibling failed can ask for it again.
//
// popData is a RENDER-TIME read, never stored: it is `popDataFor(raw, dataset,
// contrast)` at the request's CURRENT contrast. That is what lets a view switch
// contrast without reloading anything, and it is why a hydrated pathway sibling
// needs no "re-read" message carrying prebuilt popData — the settle bumps this
// module's state, the column list is rebuilt, and popDataFor (whose cache the
// hydration dropped) builds the pathway-bearing transform. `pathwaysSettled`
// says the sibling has landed or definitively has not; a pathway view waits on
// it rather than rendering "no pathways" for a sibling still in flight.
//
// Two rules callers rely on:
//   * A column that could not be READ is reported as such, never rendered as
//     "not detected" — the invariant CrossDatasetCompare states for its own
//     failed datasets.
//   * Retained columns never reload. The load effect is keyed on the joined
//     column keys and starts only keys it has not seen, so removing one column
//     leaves the others exactly as they were, and a parent re-render that
//     rebuilds an equal request list restarts nothing.
//
// The module sits ON the track-data seam (loadTrackData / popDataFor own the
// fetch → sibling hydration → cache invalidation protocol) and through it on
// the bundle-source seam, so its tests drive it with the map-backed transport.
// It deliberately does not sit under the explorer store: the store's track
// cache, first-paint seed and global overlay are the main explorer's, and a
// column never touches them.

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { loadDatasetMeta } from './loadDatasetMeta';
import { loadTrackData, popDataFor, type PathwayPolicy } from './trackData';
import { mapLimit } from '../utils/mapLimit';
import type { Dataset, DatasetMeta, PopData, RawTrack, ResolvedContrast } from '../types';

export type TrackColumnStatus = 'loading' | 'ready' | 'failed' | 'unknown-track';

/**
 * Whether the column confirms the track against the dataset's meta.js before
 * fetching the bundle.
 *
 * REQUIRED, like the pathway policy, because the two answers cost different
 * things. 'verify' spends one meta request per dataset (cached by the bundle
 * source) and is the only way to report `unknown-track` — the compare set needs
 * it, because its columns come from a URL or a saved set that can name a track
 * a later build dropped, and it shows the meta's labels before the bundle
 * lands. 'trust' skips the request for callers whose track id already came from
 * that dataset's own track list (the Compare tab's selector) or from an index
 * row built from it (the report previews); a track that is somehow absent then
 * surfaces as `failed`, which is still a stated failure.
 */
export type TrackListPolicy = 'verify' | 'trust';

export interface TrackColumnPolicy {
  pathways: PathwayPolicy;
  trackList: TrackListPolicy;
}

export interface TrackColumnRequest {
  dataset: Dataset;
  trackId: string;
  /** Read at render time only; changing it never reloads the column. */
  contrast: ResolvedContrast | null;
}

export interface TrackColumn {
  /** `${dataset.id}::${trackId}` — collision-free across datasets. */
  key: string;
  dataset: Dataset;
  trackId: string;
  contrast: ResolvedContrast | null;
  status: TrackColumnStatus;
  /** Why the column failed; null otherwise. */
  error: string | null;
  /** The dataset's meta, under policy 'verify', once read. Null under 'trust'. */
  meta: DatasetMeta | null;
  /** The raw bundle object; null until ready. */
  raw: RawTrack | null;
  /** popData at the request's current contrast; null unless ready. */
  popData: PopData | null;
  /** The pathway sibling has settled, either way (also true once failed). */
  pathwaysSettled: boolean;
  /** Restart this column's load. Retries a failed bundle or pathway sibling. */
  retry: () => void;
}

/** What the reducer holds per key. popData is derived, never stored. */
interface Slot {
  status: TrackColumnStatus;
  error: string | null;
  meta: DatasetMeta | null;
  raw: RawTrack | null;
  pathwaysSettled: boolean;
}

type Action =
  | { type: 'start'; key: string }
  | { type: 'meta'; key: string; meta: DatasetMeta }
  | { type: 'unknown-track'; key: string; meta: DatasetMeta }
  | { type: 'ready'; key: string; raw: RawTrack }
  | { type: 'pathways-settled'; key: string }
  | { type: 'failed'; key: string; error: string }
  | { type: 'drop'; keys: string[] };

type State = Record<string, Slot>;

const LOADING: Slot = { status: 'loading', error: null, meta: null, raw: null, pathwaysSettled: false };

function reducer(state: State, action: Action): State {
  if (action.type === 'start') return { ...state, [action.key]: LOADING };
  if (action.type === 'drop') {
    const next = { ...state };
    for (const key of action.keys) delete next[key];
    return next;
  }
  const current = state[action.key];
  // A result for a column that has since been removed: nothing to update.
  if (!current) return state;
  switch (action.type) {
    case 'meta':
      return { ...state, [action.key]: { ...current, meta: action.meta } };
    case 'unknown-track':
      return { ...state, [action.key]: { ...current, meta: action.meta, status: 'unknown-track', pathwaysSettled: true } };
    case 'ready':
      return { ...state, [action.key]: { ...current, status: 'ready', raw: action.raw, error: null } };
    case 'pathways-settled':
      // A new slot object even though only a flag changes: the rebuilt column
      // list is what makes popDataFor re-read a raw whose sibling just hydrated.
      return { ...state, [action.key]: { ...current, pathwaysSettled: true } };
    case 'failed':
      return { ...state, [action.key]: { ...current, status: 'failed', error: action.error, pathwaysSettled: true } };
  }
}

function keyFor(request: TrackColumnRequest): string {
  return `${request.dataset.id}::${request.trackId}`;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Concurrent first loads per hook. A retry runs on its own, outside the cap. */
const FANOUT = 6;

/**
 * One attempt at one column. Never rejects — the batch runner would abandon
 * every other column otherwise — so each outcome is dispatched here, and only
 * while `live()` says this attempt is still the column's current one.
 */
async function attemptColumn(
  request: TrackColumnRequest,
  policy: TrackColumnPolicy,
  live: () => boolean,
  dispatch: (action: Action) => void,
): Promise<void> {
  const { dataset, trackId } = request;
  const key = keyFor(request);
  // A queued attempt can start after its column was removed (a selection
  // trimmed while more than FANOUT loads were waiting); bail before any
  // request, or a `trust` column would still download a bundle nobody shows.
  if (!live()) return;
  if (policy.trackList === 'verify') {
    let meta: DatasetMeta;
    try {
      meta = await loadDatasetMeta(dataset);
    } catch (err) {
      if (live()) dispatch({ type: 'failed', key, error: describe(err) });
      return;
    }
    if (!live()) return;
    if (!meta.populations?.includes(trackId)) {
      dispatch({ type: 'unknown-track', key, meta });
      return;
    }
    dispatch({ type: 'meta', key, meta });
  }

  let loaded: Awaited<ReturnType<typeof loadTrackData>>;
  try {
    loaded = await loadTrackData(dataset, trackId, { pathways: policy.pathways });
  } catch (err) {
    if (live()) dispatch({ type: 'failed', key, error: describe(err) });
    return;
  }
  if (!live()) return;
  if (!loaded.raw) {
    dispatch({ type: 'failed', key, error: 'The bundle could not be read' });
    return;
  }
  dispatch({ type: 'ready', key, raw: loaded.raw });
  // pathwaysReady never rejects; a null (nothing to re-read) still settles.
  void loaded.pathwaysReady.then(() => {
    if (live()) dispatch({ type: 'pathways-settled', key });
  });
}

/**
 * Load a set of track columns, each landing on its own, none blocking the
 * others. Returns one column per request, in the requests' order.
 *
 * `policy` is read when a load STARTS: a change applies to columns started
 * afterwards (new keys, retries), never to ones already loaded.
 */
export function useTrackColumns(
  requests: readonly TrackColumnRequest[],
  policy: TrackColumnPolicy,
): TrackColumn[] {
  const [byKey, dispatch] = useReducer(reducer, {});
  // The run each key is on. A key that is dropped loses its run, so a load
  // resolving after its column was removed finds no run to report to; a key
  // added back later — or retried — gets a fresh run, and the bundle cache
  // makes an already-loaded bundle free.
  const runs = useRef(new Map<string, number>());
  const nextRun = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // The latest requests and policy, for `retry` and for the load effect, which
  // is deliberately keyed on the column keys rather than on array identity.
  // Mirrored in an effect declared BEFORE the load effect, so it is current by
  // the time that one runs (effects run in declaration order).
  const latest = useRef({ requests, policy });
  useEffect(() => { latest.current = { requests, policy }; });

  const keysSig = requests.map(keyFor).join('|');
  // Contrast ids join the output signature: a contrast switch re-reads popData
  // without restarting a load.
  const outputSig = requests.map((r) => `${keyFor(r)}@${r.contrast?.id ?? ''}`).join('|');

  // Put a key on a fresh run and show it loading; returns the attempt's
  // liveness check. Refs and dispatch only, so it is stable for the lifetime.
  const startRun = useCallback((key: string): (() => boolean) => {
    const run = ++nextRun.current;
    runs.current.set(key, run);
    dispatch({ type: 'start', key });
    return () => mounted.current && runs.current.get(key) === run;
  }, []);

  const retryKey = useCallback((key: string) => {
    // Retry the request as it stands NOW, under the policy as it stands now.
    const current = latest.current.requests.find((r) => keyFor(r) === key);
    if (!current || !mounted.current) return;
    void attemptColumn(current, latest.current.policy, startRun(key), dispatch);
  }, [startRun]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the joined column keys, not on the array's identity — a parent re-render that rebuilds an equal list must not restart a single load.
  useEffect(() => {
    const wanted = new Map(latest.current.requests.map((request) => [keyFor(request), request]));
    const dropped = [...runs.current.keys()].filter((key) => !wanted.has(key));
    if (dropped.length) {
      for (const key of dropped) runs.current.delete(key);
      dispatch({ type: 'drop', keys: dropped });
    }
    const fresh: Array<{ request: TrackColumnRequest; live: () => boolean }> = [];
    for (const [key, request] of wanted) {
      if (runs.current.has(key)) continue;
      fresh.push({ request, live: startRun(key) });
    }
    if (!fresh.length) return;
    const runPolicy = latest.current.policy;
    void mapLimit(fresh, FANOUT, ({ request, live }) => attemptColumn(request, runPolicy, live, dispatch));
  }, [keysSig]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the output signature (keys + contrast ids), not on the array's identity, so consumers' memos see a stable list across equal re-renders.
  return useMemo(() => requests.map((request): TrackColumn => {
    const key = keyFor(request);
    const slot = byKey[key] ?? LOADING;
    return {
      key,
      dataset: request.dataset,
      trackId: request.trackId,
      contrast: request.contrast,
      status: slot.status,
      error: slot.error,
      meta: slot.meta,
      raw: slot.raw,
      popData: slot.status === 'ready' ? popDataFor(slot.raw, request.dataset, request.contrast) : null,
      pathwaysSettled: slot.pathwaysSettled,
      retry: () => retryKey(key),
    };
  }), [outputSig, byKey, retryKey]);
}

/** One column — the effect previews' shape. Same lifecycle, same policy rules. */
export function useTrackColumn(request: TrackColumnRequest, policy: TrackColumnPolicy): TrackColumn {
  const { dataset, trackId, contrast } = request;
  const requests = useMemo(() => [{ dataset, trackId, contrast }], [dataset, trackId, contrast]);
  return useTrackColumns(requests, policy)[0];
}
