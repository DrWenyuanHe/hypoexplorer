// Pure lookups over the active dataset's metadata (DatasetMeta). The meta is a
// VALUE that flows from App's state — there is no module-level "active dataset"
// and no window.POP_META: callers pass the meta they were given. A null meta
// (mid dataset-switch, or a load failure) degrades to the id / fallback colour
// rather than recovering the previous dataset through a side channel.
import type { DatasetMeta } from '../types';

export const FALLBACK_TRACK_COLOR = '#888888';

/** The track's palette colour, or the neutral fallback for unknown ids. */
export function trackColor(meta: DatasetMeta | null | undefined, trackId: string): string {
  return meta?.colors?.[trackId] ?? FALLBACK_TRACK_COLOR;
}

/** The track's display label (e.g. "e9 (POMC/TBX3)"), or the bare id. */
export function trackLabel(meta: DatasetMeta | null | undefined, trackId: string): string {
  return meta?.labels?.[trackId] ?? trackId;
}
