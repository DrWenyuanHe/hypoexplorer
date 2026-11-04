// The track-data seam: the single place a (dataset, trackId) becomes a loaded
// track, and the single place a loaded track becomes popData.
//
// Before this module, getting one popData with pathways meant knowing FIVE
// modules and an ordering that existed nowhere as code:
//
//   loadTrack(ds, id) -> loadPathways(ds, id) -> raw.pathways = pw
//     -> invalidatePopData(raw) -> getPopData(raw, ds, contrast)
//
// It was implemented once (App.tsx) and skipped in part by both other callers:
// CrossDatasetCompare never ran the pathway hop, and CompareTab called
// getPopData with neither dataset nor contrast — so it silently rendered the
// DEFAULT contrast via buildPopData's old macaque fallback. Both are now
// unrepresentable: the pathway policy is a required argument, and popDataFor
// requires the dataset.
//
// Contract:
//   loadTrackData(dataset, trackId, { pathways }) -> Promise<LoadedTrack>
//   popDataFor(raw, dataset, contrast)            -> PopData | null
//
// Deliberately NO contrast in the load call. popData is a render-time read, not
// a load-time product: the pathway sibling can land after the user has switched
// contrast, so anything the load path pre-built would be stale on arrival. The
// hydration signal says "re-read", never "here is your popData".

import { loadTrack, loadPathways } from './loadTrack';
import { siblingDefaultPathways, siblingPathwaysByContrast } from './rawTrack';
import { getPopData, invalidatePopData } from './popCache';
import type { Dataset, PopData, RawTrack, ResolvedContrast } from '../types';

/**
 * Whether the pathway sibling bundle (track_<id>.pathways.js) is wanted.
 *
 * REQUIRED, with no default, so "this view has no pathways" is a stated choice
 * rather than an omission. The cross-dataset GENE query must never download it
 * — keeping that payload off the gene path is the reason the sibling bundle
 * exists (see loadTrack.ts).
 */
export type PathwayPolicy = 'include' | 'omit';

export interface LoadedTrack {
  /**
   * The raw bundle object. Stable for the session — loadTrack's "raw track
   * never replaced" invariant is what popCache's WeakMap key depends on.
   *
   * Read-only by convention. The pathway hydration below is the ONLY sanctioned
   * mutation of it, and it lives inside this module.
   */
  raw: RawTrack;
  /**
   * Settles when the pathway sibling has been hydrated onto `raw`.
   *
   * Resolves the (same) raw when there is something new to see — re-read via
   * popDataFor at whatever contrast is CURRENT — and null when there is not:
   * pathways omitted, dataset has none, bundle already carried them, or the
   * sibling is absent. Never rejects, so a caller may ignore it entirely
   * without producing an unhandled rejection.
   */
  pathwaysReady: Promise<RawTrack | null>;
}

const NOTHING_TO_REREAD: Promise<RawTrack | null> = Promise.resolve(null);

/**
 * Load a track's bundle and, per policy, hydrate its pathway sibling.
 *
 * Resolves as soon as the DE/CPM bundle is ready — pathway hydration continues
 * in the background behind `pathwaysReady`, so first paint is never blocked on
 * the pathway payload.
 *
 * Rejects if the track bundle itself fails (same as loadTrack). Pathway
 * failures are graceful and surface as `pathwaysReady -> null`.
 */
export async function loadTrackData(
  dataset: Dataset,
  trackId: string,
  opts: { pathways: PathwayPolicy },
): Promise<LoadedTrack> {
  const raw = await loadTrack(dataset, trackId);
  return { raw, pathwaysReady: hydratePathways(dataset, trackId, raw, opts.pathways) };
}

function hydratePathways(
  dataset: Dataset,
  trackId: string,
  raw: RawTrack,
  policy: PathwayPolicy,
): Promise<RawTrack | null> {
  if (policy === 'omit') return NOTHING_TO_REREAD;
  if (!dataset.supportsPathways) return NOTHING_TO_REREAD;
  // The bundle already carries pathways (eager default track; test fixtures) —
  // the first popData build already exposes allPathways, so there is nothing to
  // re-read.
  if (raw.pathways) return NOTHING_TO_REREAD;

  return loadPathways(dataset, trackId)
    .then((sibling) => {
      // A concurrent load may have hydrated it first. Either way the transform
      // cache has been dropped, so the caller still needs to re-read.
      if (raw.pathways) return raw;
      // The sibling is either a plain block (legacy) or the multi-contrast
      // wrapper; hydrate BOTH fields buildPopData reads. The default block
      // lands on raw.pathways (the fallback for the default contrast), the
      // per-contrast blocks on raw.pathwaysByContrast.
      const defaultBlock = siblingDefaultPathways(sibling);
      const byContrast = siblingPathwaysByContrast(sibling);
      if (!defaultBlock && !byContrast) return null;
      if (defaultBlock) raw.pathways = defaultBlock;
      if (byContrast) raw.pathwaysByContrast = { ...raw.pathwaysByContrast, ...byContrast };
      // Drops EVERY cached contrast transform for this raw, not just the one
      // that happens to be on screen — the pathway table is per-contrast, so a
      // narrower invalidation would leave the others serving pathway-less
      // popData forever. Do not "optimize" this to a single contrast.
      invalidatePopData(raw);
      return raw;
    })
    .catch(() => null);
}

/**
 * The transformed view of one loaded track, memoized per (raw, dataset,
 * contrast). Synchronous: safe to call from a render/useMemo.
 *
 * `dataset` is required. It selects the expression unit and decides whether
 * pathways are flattened, so an omitted one used to mean "silently transform
 * this as if it were the macaque atlas".
 */
export function popDataFor(
  raw: RawTrack | null | undefined,
  dataset: Dataset,
  contrast: ResolvedContrast | null,
): PopData | null {
  return getPopData(raw, dataset, contrast);
}
