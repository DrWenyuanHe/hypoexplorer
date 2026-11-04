// Lazy-load a track's data bundle. The bundle is a classic script that sets a
// dataset-namespaced window global (e.g. HX_MACAQUE_SNRNA_E9) as a side effect
// (see scripts/migrate_macaque_bundles.mjs output). HOW those bytes arrive —
// streamed with fetch and counted for the loading bar, or injected as a
// <script src> — is the bundle-source seam's business, not this module's.
//
// Generalizes track loading from a flat popId to a (dataset, trackId) pair so
// tracks from different datasets never collide. (This is the sole track loader;
// it replaced the earlier flat POP_<ID> loader.)
//
// Contract:
//   loadTrack(dataset, trackId) → Promise<rawTrack>
//
// Safety properties:
//   - cache key = dataset.id + '::' + trackId (collision-free across datasets).
//   - Second call with the same key while the first is pending returns the SAME
//     promise (in-flight dedup → single <script> tag).
//   - Resolved tracks stay in rawCache and resolve synchronously.
//   - If the namespaced global is already set (e.g. an eager index.html tag),
//     seed the cache and resolve WITHOUT requesting anything.
//   - A failed load clears in-flight so retries are possible.
//
// "Raw track never replaced" invariant: rawCache stores the FIRST raw object
// resolved for a key and never reassigns it (resolved keys short-circuit at the
// top), so a given (dataset, trackId) maps to one stable object reference for
// the session. popCache.js relies on this — its WeakMap is keyed by that very
// object identity.

import {
  resolveTrackUrl, resolveTrackGlobalKey,
  resolvePathwayUrl, resolvePathwayGlobalKey,
  resolvePathwayIndexUrl, resolvePathwayIndexGlobalKey,
} from './bundleLocators';
import { loadRequiredBundle, loadOptionalBundle, _resetBundleCache } from './bundleSource';
import { _resetPopDataCache } from './popCache';
import type { Dataset, PathwaySibling, RawTrack } from '../types';

// Caching, in-flight dedup, the eager-global seed and the ?v= cache-bust all
// live in the bundle-source seam now; what remains here is which URL and which
// global key a (dataset, trackId) maps to. The bundle cache is keyed by URL,
// which is collision-free across datasets for the same reason the old
// 'datasetId::trackId' key was: bundleFileTemplate is dataset-namespaced.
//
// Returned verbatim (not re-wrapped in .then/.catch) so a concurrent call gets
// the SAME promise object — callers and tests rely on that identity to prove a
// single request was made.
export function loadTrack(dataset: Dataset, trackId: string): Promise<RawTrack> {
  return loadRequiredBundle<RawTrack>(
    resolveTrackUrl(dataset, trackId),
    resolveTrackGlobalKey(dataset, trackId),
  );
}

// ── Pathway sibling bundle loader (track_<id>.pathways.js) ───────────────────
// FGSEA pathways now live in a sibling file, loaded ONLY when pathways are needed
// (single-dataset Pathway tab / leading-edge, and the cross-dataset pathway query)
// — so the cross-dataset GENE query and plain track loads never download them.
// Resolves null (not reject) when the sibling is absent, so a non-pathway dataset
// or a missing file degrades to "no pathways" rather than crashing.

// Optional, not required: an absent sibling is a legitimate answer (a dataset
// that generated no enrichment), so the seam resolves null. A failed load stays
// retryable (bounded: track loads themselves are cached, so the sibling is only
// re-asked when a track actually loads).
//
// The resolved value is the sibling's RAW shape (plain block, or the
// multi-contrast wrapper — see PathwaySibling); callers unwrap through the
// rawTrack helpers rather than assuming the legacy plain block.
export function loadPathways(dataset: Dataset, trackId: string): Promise<PathwaySibling | null> {
  if (!dataset.supportsPathways) return Promise.resolve(null);
  return loadOptionalBundle<PathwaySibling>(
    resolvePathwayUrl(dataset, trackId),
    resolvePathwayGlobalKey(dataset, trackId),
  );
}

// ── Dataset-level gs_name index (pathways_index.js) for the pathway autocomplete.
export function loadPathwayIndexForDataset(dataset: Dataset): Promise<string[]> {
  if (!dataset.supportsPathways) return Promise.resolve([]);
  return loadOptionalBundle<string[]>(
    resolvePathwayIndexUrl(dataset),
    resolvePathwayIndexGlobalKey(dataset),
  ).then((names) => names ?? []);
}

// Test-only helper to reset module state between tests.
//
// This is the ONLY reset hook the suite calls for the data layer. Every bundle
// cache now lives behind the bundle-source seam, so there are exactly two things
// to clear: the bundles themselves and the popData transforms built from them.
// A new loader needs no new reset hook — it inherits this one by construction.
export function _resetTrackCache(): void {
  _resetBundleCache();
  _resetPopDataCache();
}
