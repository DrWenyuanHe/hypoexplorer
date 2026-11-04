// Transformed-popData cache keyed by the raw track object reference + contrast.
// Fixes Compare's per-render duplicate work: buildPopData used to run
// for every active track inside CompareTab's useMemo on every render.
// Now each (raw track, contrast) pair is transformed exactly once and reused.
//
// dataset/contrast are passed through to buildPopData so the transform can
// expose resolved groups / groupSamples / sampleOrder, and so the active
// contrast's DE/pathway table is selected from a multi-contrast bundle. The
// outer WeakMap is keyed by the raw object identity (GC-friendly); the inner
// Map is keyed by contrast id, because the SAME raw track now yields a
// different transform per selected contrast. Without the inner key, switching
// contrast on a track would serve the previous contrast's stale transform.
//
// This depends on loadTrack's "raw track never replaced" invariant: a given
// (dataset, trackId) resolves to one stable raw object for the session, so the
// WeakMap key never goes stale. The dataset is USUALLY implied by the raw object
// identity (one raw object belongs to one dataset) — but nothing in the type
// system enforces that a caller pairs them correctly, so the dataset id is part
// of the inner key too. A mismatched pairing then yields its own (wrong but
// self-consistent) entry rather than silently serving another dataset's
// transform under the same contrast id.
//
// Internal to the data layer: callers go through trackData.popDataFor.

import { buildPopData } from './buildPopData';
import type { Dataset, PopData, RawTrack, ResolvedContrast } from '../types';

const NO_CONTRAST_KEY = '__default__';
let transformCache = new WeakMap<RawTrack, Map<string, PopData>>();

export function getPopData(
  rawPop: RawTrack | null | undefined,
  dataset: Dataset,
  contrast: ResolvedContrast | null,
): PopData | null {
  if (!rawPop) return null;
  const key = `${dataset.id}::${contrast?.id ?? NO_CONTRAST_KEY}`;
  let byContrast = transformCache.get(rawPop);
  const cached = byContrast?.get(key);
  if (cached) return cached;
  const transformed = buildPopData(rawPop, dataset, contrast);
  if (transformed) {
    if (!byContrast) {
      byContrast = new Map<string, PopData>();
      transformCache.set(rawPop, byContrast);
    }
    byContrast.set(key, transformed);
  }
  return transformed;
}

// Drop the cached transform(s) for a raw track. Called when the raw is augmented
// after first transform (e.g. pathways hydrated from the sibling bundle), so the
// next getPopData rebuilds with the new data instead of serving the stale cache.
export function invalidatePopData(rawPop: RawTrack | null | undefined): void {
  if (rawPop) transformCache.delete(rawPop);
}

// Test-only: drop every cached transform. A WeakMap can't be cleared, so this
// replaces it — which is also why the cache is a `let`. Called from
// _resetTrackCache so the suite has ONE reset hook for the data layer; without
// it a fixture transformed in one test kept serving that transform to the next.
export function _resetPopDataCache(): void {
  transformCache = new WeakMap<RawTrack, Map<string, PopData>>();
}
