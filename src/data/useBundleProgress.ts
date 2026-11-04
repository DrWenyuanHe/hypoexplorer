// React's view of the bundle-source progress stream: the two reductions the UI
// actually asks for, so no component subscribes to raw events itself.
//
//   useBundleProgress(url)      — ONE bundle. The explorer overlay, which is
//                                 waiting on exactly one track bundle and wants
//                                 a percentage of it.
//   useBundleBytes(active)      — the SUM over a burst. The cross-dataset
//                                 reports, which fire dozens of loads and can
//                                 only report "N of M files, X MB so far".
//
// Both are thin on purpose. The interesting decisions (what counts as a total,
// when a load starts and finishes) belong to the seam that owns the transport;
// see bundleSource's `emitProgress`.

import { useEffect, useState } from 'react';
import { expectedBundleBytes, subscribeBundleProgress } from './bundleSource';

/** Bytes of a single load, as a component renders them. */
export interface LoadProgress {
  /** Decompressed bytes received. 0 when the transport counts none. */
  loaded: number;
  /** Decompressed total, or null when unknown — render indeterminate. */
  total: number | null;
}

/**
 * Follow one bundle's load.
 *
 * Seeded from the build-time size map rather than from the first event, so the
 * bar knows how big the download is on the frame it appears — a subscriber that
 * mounts after the load started (the overlay always does: the load is what sets
 * the state that renders it) would otherwise show nothing until the next chunk.
 *
 * Null `url` means "nothing to follow" and returns null, so a caller can call
 * this unconditionally from a component that only sometimes has a load.
 */
export function useBundleProgress(url: string | null): LoadProgress | null {
  const [progress, setProgress] = useState<LoadProgress | null>(null);

  useEffect(() => {
    if (!url) { setProgress(null); return; }
    setProgress({ loaded: 0, total: expectedBundleBytes(url) });
    return subscribeBundleProgress((event) => {
      if (event.url !== url) return;
      setProgress({ loaded: event.loaded, total: event.total });
    });
  }, [url]);

  return progress;
}

/**
 * Total bytes across every bundle load while `active`.
 *
 * Counts finished loads plus the in-flight bytes of the rest, so the figure
 * rises continuously through a burst rather than stepping once per completed
 * file — the difference between a number that looks alive and one that looks
 * stuck on a slow bundle.
 *
 * Resets to zero on each activation: a cross-dataset report answers a new query
 * from scratch, and carrying the previous query's megabytes into it would report
 * a number that is real but about something else.
 *
 * A load ALREADY in flight when this activates is counted in full, not from
 * here on. It is part of what this query is downloading — the report's own
 * planning request routinely starts a tick before the state that activates this
 * — and charging it a partial figure would understate the transfer. The cost of
 * that choice is bounded and in the honest direction: a straggler from a
 * superseded query can be counted too, and it was genuinely downloaded.
 */
export function useBundleBytes(active: boolean): number {
  const [bytes, setBytes] = useState(0);

  useEffect(() => {
    if (!active) { setBytes(0); return; }
    setBytes(0);
    // Per-URL, not a running sum: every tick restates that URL's TOTAL so far,
    // so accumulating ticks directly would count the same bytes once per chunk.
    const seen = new Map<string, number>();
    return subscribeBundleProgress((event) => {
      seen.set(event.url, event.loaded);
      let sum = 0;
      for (const value of seen.values()) sum += value;
      setBytes(sum);
    });
  }, [active]);

  return bytes;
}
