// The explorer store: the single place the explorer's per-dataset resources are
// loaded and held — the dataset's metadata, its QC blob, and the cache of loaded
// tracks — and the single place a late resolve is dropped.
//
// This used to live inline in App.tsx, where the same STALE-WRITE GUARD was
// hand-written five times (dataset meta ×3: the mount effect, switchDataset and
// the retry handler; dataset QC ×2: the tab effect and the retry handler) and
// three refs existed purely to mirror state past React's closure capture. Each
// copy had to independently remember the rule: a load that resolves after the
// user has switched away must land in its own cache slot but must NOT touch the
// shared meta/QC/loading/error state, or it repaints the screen with the wrong
// dataset's data. One copy originally got it wrong — comparing a
// closure-captured id against itself, a guard that could never fire.
//
// Contract:
//   useExplorerStore({ dataset, activeTrackId, wantQC }) -> ExplorerStore
//
// What the caller keeps: navigation. Which dataset and which track are ACTIVE is
// the shell's state, passed in — the store never navigates. What the store keeps:
// everything that follows from that choice, including when a load is redundant.
//
// The load protocol itself is NOT here: bundle fetch → pathway sibling →
// transform-cache invalidation lives in the track-data seam (./trackData). This
// module owns the React-layer policy above it — the cache, the in-flight dedup,
// the loading/error banner state, and the guards.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { peekBundle, peekGlobalBundle } from './bundleSource';
import { resolveTrackGlobalKey, resolvePathwayGlobalKey, resolveTrackUrl } from './bundleLocators';
import { COMPARE_TRACK } from '../explorer/explorerPosition';
import { loadDatasetMeta, loadDatasetQC } from './loadDatasetMeta';
import { loadTrackData, type PathwayPolicy } from './trackData';
import { siblingDefaultPathways, siblingPathwaysByContrast } from './rawTrack';
import { useBundleProgress, type LoadProgress } from './useBundleProgress';
import type { Dataset, DatasetMeta, PathwaySibling, QcGlobal, RawTrack } from '../types';

// ── Eager globals ───────────────────────────────────────────────────────────
// index.html can eager-load the default dataset's meta + default track so the
// first paint needs no round trip. WHICH globals get seeded, and the pathway
// sibling attach below, are this module's policy; the window read itself is the
// bundle-source seam's `peekGlobalBundle`. Absent in tests and for every
// non-default dataset, where the loaders take over.

/** The eager-loaded dataset-meta global (e.g. HX_MACAQUE_SNRNA_META). */
function readEagerMeta(dataset: Dataset): DatasetMeta | undefined {
  return peekGlobalBundle<DatasetMeta>(dataset.metaGlobalKey);
}

/**
 * Seed the track cache from the eager globals, if index.html set them.
 *
 * FGSEA pathways ship in a sibling bundle, so the eager pathway global is
 * attached onto the eager raw here — that is what lets the default track's first
 * popData build expose allPathways (Pathway tab, leading-edge drilldown) without
 * waiting for a lazy fetch.
 */
function seedTrackCache(dataset: Dataset): Record<string, RawTrack> {
  const trackId = dataset.defaultTrack;
  const eager = peekGlobalBundle<RawTrack>(resolveTrackGlobalKey(dataset, trackId));
  if (!eager) return {};
  if (!eager.pathways) {
    // Unwrap through the sibling-shape helpers: only the macaque default is
    // eager today (plain block), but a multi-contrast wrapper seeded here must
    // not land verbatim on raw.pathways.
    const pw = peekGlobalBundle<PathwaySibling>(resolvePathwayGlobalKey(dataset, trackId));
    const defaultBlock = siblingDefaultPathways(pw);
    const byContrast = siblingPathwaysByContrast(pw);
    if (defaultBlock) eager.pathways = defaultBlock;
    if (byContrast) eager.pathwaysByContrast = { ...eager.pathwaysByContrast, ...byContrast };
  }
  return { [cacheKeyFor(dataset.id, trackId)]: eager };
}

/**
 * Track-cache key. Namespaced by dataset so same-named tracks from different
 * datasets never collide — and deliberately private to this module: `getTrack`
 * takes a bare track id, so no consumer learns the convention.
 */
function cacheKeyFor(datasetId: string, trackId: string): string {
  return `${datasetId}::${trackId}`;
}

/** A loaded resource, tagged with the dataset it belongs to. */
interface KeyedResource<T> {
  datasetId: string;
  value: T;
}

export interface ExplorerStoreInput {
  /** The active dataset. Changing it reloads meta + QC and rebinds `getTrack`. */
  dataset: Dataset;
  /**
   * The active track. Used only for the loading/error guard — the store does not
   * load it; the shell decides when to call `ensureTrack` (the hub, for
   * instance, deliberately touches no bundle).
   */
  activeTrackId: string;
  /** Whether the QC blob is wanted yet. QC is lazy: the QC tab flips this true. */
  wantQC: boolean;
  /** Fixed for this store's lifetime; gene-only previews omit pathway bundles. */
  pathways?: PathwayPolicy;
}

export interface ExplorerStore {
  /** The active dataset's metadata. Null while loading, or after a failure. */
  meta: DatasetMeta | null;
  /** The active dataset's QC blob. Null until `wantQC` and the load resolves. */
  qc: QcGlobal | null;
  /**
   * Loaded-track lookup for the ACTIVE dataset, by bare track id. Identity
   * changes when the cache does, so callers' memos re-observe newly loaded
   * tracks — including a pathway sibling landing after first paint.
   */
  getTrack: (trackId: string) => RawTrack | undefined;
  /**
   * Load a track into the cache, returning the raw so callers can await it.
   *
   * Idempotent and deduped: a cached track resolves immediately, and a second
   * call while the first is in flight reuses that promise rather than firing a
   * redundant load. Safe to call on every render.
   *
   * `dsOverride` loads a track from a dataset other than the currently-active
   * one — needed when the shell switches dataset and track together, since this
   * closure still sees the outgoing dataset. `quiet` suppresses the global
   * loading overlay for background loads (Compare renders its own per-track
   * spinners); see the note on the overlay in the implementation.
   */
  ensureTrack: (trackId: string, dsOverride?: Dataset, quiet?: boolean) => Promise<RawTrack | undefined>;
  /** The track id the global loading overlay is showing for, or null. */
  loadingTrack: string | null;
  /**
   * Bytes of that track's bundle so far, or null when nothing is loading.
   * `total` is null when the size is unknown, which the bar renders as an
   * indeterminate sweep rather than a fake percentage.
   */
  loadingProgress: LoadProgress | null;
  /** The user-facing load-failure message for the error banner, or null. */
  loadError: string | null;
  /** Re-attempt whatever is currently missing (meta, QC, the active track). */
  retry: () => void;
}

export function useExplorerStore({ dataset, activeTrackId, wantQC, pathways = 'include' }: ExplorerStoreInput): ExplorerStore {
  // Loaded resources are stored WITH the dataset they belong to, and read back
  // through an id check, so `meta` and `qc` read as null the instant `dataset`
  // changes — in the same render, before any effect runs.
  //
  // Storing the bare value and clearing it from an effect is NOT equivalent, and
  // the difference is visible: useEffect runs after paint, so between the switch
  // and the cleanup there is one painted frame showing the outgoing dataset's
  // populations, labels and colours under the incoming dataset's identity.
  // Keying the value makes that state unrepresentable rather than merely brief.
  const [metaState, setMetaState] = useState<KeyedResource<DatasetMeta> | null>(() => {
    const eager = readEagerMeta(dataset);
    return eager ? { datasetId: dataset.id, value: eager } : null;
  });
  const [qcState, setQCState] = useState<KeyedResource<QcGlobal> | null>(null);
  const [trackCache, setTrackCache] = useState<Record<string, RawTrack>>(() => seedTrackCache(dataset));
  // The overlay is keyed by (dataset, track), not bare track id: every dataset's
  // bulk track is called 'whole', so a bare-id guard cannot tell "still loading
  // this track" from "loading the SAME-NAMED track of a dataset the user left".
  //
  // The bundle URL rides along because the overlay reports DOWNLOAD PROGRESS,
  // which the bundle-source seam publishes per URL. Resolving it here rather
  // than in the shell keeps the file-layout convention inside the data layer —
  // the shell is handed bytes, not a path.
  const [loadingState, setLoadingState] = useState<{ key: string; trackId: string; url: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadingTrack = loadingState ? loadingState.trackId : null;
  const loadingProgress = useBundleProgress(loadingState ? loadingState.url : null);

  const meta = metaState && metaState.datasetId === dataset.id ? metaState.value : null;
  const qc = qcState && qcState.datasetId === dataset.id ? qcState.value : null;

  // ── Stale-write bookkeeping ───────────────────────────────────────────────
  // Which dataset a load is currently IN FLIGHT for. Set before the load starts
  // and compared when it settles, so a load for a dataset the user has since left
  // drops its result — success AND failure alike — instead of repainting the
  // shell (or its error banner) with the wrong dataset's outcome. Refs, not
  // state, because the settle callbacks need the CURRENT value rather than the
  // one their closure captured.
  const metaFetchRef = useRef<string | null>(metaState ? metaState.datasetId : null);
  const qcFetchRef = useRef<string | null>(null);

  // Mirror of the cache for SYNCHRONOUS reads inside ensureTrack. Reading the ref
  // (not the closure-captured state) is what lets ensureTrack stay referentially
  // stable across cache updates — so the loader handed to CompareTab keeps a
  // stable identity and doesn't re-fire its effects on every resolve.
  const trackCacheRef = useRef(trackCache);
  useEffect(() => { trackCacheRef.current = trackCache; }, [trackCache]);

  // The (dataset, track) the user is currently viewing, so a track load that
  // resolves after a fast switch-away can leave the shared loading/error state
  // alone.
  const activeKey = cacheKeyFor(dataset.id, activeTrackId);
  const activeKeyRef = useRef(activeKey);
  useEffect(() => {
    activeKeyRef.current = activeKey;
    // Retire an overlay belonging to a track the user has left.
    //
    // A load in flight for the previous track CANNOT clear the overlay itself:
    // its completion is guarded to the active track precisely so it doesn't
    // clobber the spinner for the track the user switched TO. That guard leaves
    // the overlay orphaned whenever the new selection doesn't set one of its own
    // — entering Compare (which loads nothing) or picking an already-cached
    // track (which resolves without touching it). The overlay then sits over the
    // view forever. Clearing on the way out is what makes the guard safe.
    // Compared by KEY: a dataset switch that keeps the track NAME (every bulk
    // dataset's track is 'whole') still leaves the overlay's track behind.
    setLoadingState((current) => (current && current.key !== activeKey ? null : current));
    // The error banner is retired the same way, for the same reason: a failure
    // is only ever SET while its track is active, so by the time this effect
    // runs for a new selection the banner describes something no longer on
    // screen — and a switch onto already-cached data triggers no load that
    // could clear it.
    setLoadError(null);
  }, [activeKey]);

  // In-flight loads by cache key, mirroring loadTrack's module-level dedup at the
  // React layer: without it a rapid track switch + Compare entry for the same
  // track fires redundant setLoadingState / setTrackCache updates.
  const inFlightRef = useRef(new Map<string, Promise<RawTrack | undefined>>());

  // ── Resource loaders ──────────────────────────────────────────────────────
  // One implementation each, shared by the effect that loads on demand and by
  // `retry`. The guard lives here and nowhere else.

  const fetchMeta = useCallback((ds: Dataset) => {
    metaFetchRef.current = ds.id;
    loadDatasetMeta(ds)
      .then((value) => {
        // Compared against the dataset the store is CURRENTLY loading for, never
        // against the closure-captured id — `ds.id === ds.id` is always true and
        // would never drop anything.
        if (metaFetchRef.current !== ds.id) return;
        setMetaState({ datasetId: ds.id, value });
      })
      // The FAILURE is guarded too. Without this, a dataset the user has already
      // left can raise "Failed to load <that dataset>" over the dataset they are
      // now looking at — an error banner naming something not on screen, for a
      // load whose success would have been discarded anyway.
      .catch(() => {
        if (metaFetchRef.current !== ds.id) return;
        setLoadError(`Failed to load ${ds.name} metadata.`);
      });
  }, []);

  const fetchQC = useCallback((ds: Dataset) => {
    qcFetchRef.current = ds.id;
    loadDatasetQC(ds)
      .then((value) => {
        if (qcFetchRef.current !== ds.id) return;
        setQCState({ datasetId: ds.id, value });
      })
      .catch(() => {
        if (qcFetchRef.current !== ds.id) return;
        setLoadError(`Failed to load ${ds.name} QC.`);
      });
  }, []);

  // Dataset metadata: needed by every view, so it loads as soon as the dataset is
  // active. There is no clearing step — `meta` already reads as null for any
  // dataset whose metadata this store does not hold.
  useEffect(() => {
    if (meta) return;                                 // already have this dataset's
    if (metaFetchRef.current === dataset.id) return;  // already in flight for it
    const eager = readEagerMeta(dataset);
    if (eager) {
      // index.html's eager default-dataset seed needs no request at all.
      metaFetchRef.current = dataset.id;
      setMetaState({ datasetId: dataset.id, value: eager });
      return;
    }
    fetchMeta(dataset);
  }, [dataset, meta, fetchMeta]);

  // Dataset QC: lazy, and only while something wants it (the QC tab open). A
  // previous dataset's blob can never render against the current dataset's
  // metadata, because `qc` is keyed — which also covers the case this effect
  // cannot: switching dataset with the QC tab CLOSED, then opening it later.
  useEffect(() => {
    if (!wantQC) return;
    if (qc) return;
    if (qcFetchRef.current === dataset.id) return;
    fetchQC(dataset);
  }, [wantQC, dataset, qc, fetchQC]);

  // ── Track loading ─────────────────────────────────────────────────────────

  const ensureTrack = useCallback((
    trackId: string,
    dsOverride?: Dataset,
    quiet = false,
  ): Promise<RawTrack | undefined> => {
    const ds = dsOverride || dataset;
    const key = cacheKeyFor(ds.id, trackId);
    const cached = trackCacheRef.current[key];
    if (cached) return Promise.resolve(cached);
    // Coherent with the in-flight load: a second call while the first is pending
    // reuses its promise. The first caller's `quiet` wins; a non-quiet follow-up
    // for an in-flight quiet load relies on the main-pane skeleton rather than
    // the global overlay (an uncommon Compare→single-track race).
    const pending = inFlightRef.current.get(key);
    if (pending) return pending;
    // `quiet` loads (Compare's background loads of its selected tracks) must NOT
    // drive the global loading overlay. Compare shows its own per-track loading
    // state; and the overlay's clear is guarded to the ACTIVE track, which in
    // Compare mode is the 'compare' pseudo-track — so a non-quiet load here would
    // set loadingTrack and never clear it, leaving the overlay stuck forever.
    // A bundle another loader already paid for (a Compare column, a report
    // preview) resolves from the bundle cache within microtasks, so raising the
    // global overlay for it would only flash it for a frame.
    const url = resolveTrackUrl(ds, trackId);
    if (!quiet) {
      if (peekBundle(url) === undefined) setLoadingState({ key, trackId, url });
      setLoadError(null);
    }
    const promise = loadTrackData(ds, trackId, { pathways })
      .then(({ raw, pathwaysReady }) => {
        // The raw track always lands in its namespaced cache slot (collision-free,
        // and harmless even if the user already navigated away). The SHARED
        // loading/error state, however, is only touched while this is still the
        // active track.
        setTrackCache((prev) => (prev[key] ? prev : { ...prev, [key]: raw }));
        if (!quiet && activeKeyRef.current === key) setLoadingState(null);
        // FGSEA pathways ship in a sibling bundle and hydrate in the BACKGROUND,
        // so first paint (gene tab) isn't blocked on that payload. pathwaysReady
        // resolves the raw when there is something new to see; the identity bump
        // re-runs consumers' popData memos, which rebuild at whatever contrast is
        // CURRENT (not the one active when the load began). Resolves null — never
        // rejects — when there is nothing to re-read.
        pathwaysReady.then((hydrated) => { if (hydrated) setTrackCache((prev) => ({ ...prev })); });
        return raw;
      })
      .catch(() => {
        if (!quiet && activeKeyRef.current === key) {
          setLoadingState(null);
          setLoadError(`Failed to load ${trackId} data.`);
        }
        return undefined;
      })
      .finally(() => { inFlightRef.current.delete(key); });
    inFlightRef.current.set(key, promise);
    return promise;
  }, [dataset, pathways]);

  const getTrack = useCallback(
    (trackId: string): RawTrack | undefined => trackCache[cacheKeyFor(dataset.id, trackId)],
    [trackCache, dataset.id],
  );

  // Re-attempt whatever is missing. Mirrors the loaders above so a transient
  // failure is recoverable in place: a meta 404 otherwise leaves a silently
  // empty sidebar with no way back.
  const retry = useCallback(() => {
    setLoadError(null);
    if (!meta) fetchMeta(dataset);
    if (wantQC && !qc) fetchQC(dataset);
    if (activeTrackId !== COMPARE_TRACK) ensureTrack(activeTrackId);
  }, [dataset, wantQC, meta, qc, activeTrackId, ensureTrack, fetchMeta, fetchQC]);

  return useMemo(
    () => ({ meta, qc, getTrack, ensureTrack, loadingTrack, loadingProgress, loadError, retry }),
    [meta, qc, getTrack, ensureTrack, loadingTrack, loadingProgress, loadError, retry],
  );
}
