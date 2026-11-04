// Row shaping for the cross-dataset reports: the single place a track's
// statistics become a report row.
//
// Each statistic is fetched two ways — from the precomputed query index (fast)
// and by downloading the track bundles (fallback) — and both must produce the
// SAME row shape, or the two paths would answer the same question differently.
// Direction encoding, the significance cutoff and the label/type passthrough
// therefore live here, called by both paths, rather than being spelled out four
// times at the call sites.
//
// What deliberately does NOT live here is where the numbers came from: the
// index reads them off a shard tuple, the fallback off a DE/FGSEA table. Those
// stay at the call sites, so a drop rule that differs between the paths stays
// visible in the path that owns it.

import { effectDirection, isFdrSignificant } from '../statistics/policy';
import type { PathwayTrackRow, TrackRow } from '../types';

// The significance cutoff and the direction rule are the app's, not this
// module's — they live in ../statistics/policy so the report views, the compare
// views and the Statistics glossary apply and DOCUMENT the same number. This
// module used to hold a private `SIG_FDR` and a private `direction()`, which is
// why eight other files ended up spelling `0.05` by hand.

/**
 * A gene's per-track DE statistics, minus the two fields this module derives.
 *
 * `lowPower` is an INPUT, not a derivation: the index path reads the flag the
 * generator already baked into its manifest entry, while the full-download path
 * computes `isLowPower(meta.qcFlags[trackId])` itself. Unifying that would make
 * the fast path load the 41 meta.js files it exists to avoid.
 */
export type GeneRowInput = Omit<TrackRow, 'direction' | 'significant'>;

export function geneRow(r: GeneRowInput): TrackRow {
  return {
    ...r,
    direction: effectDirection(r.logFC),
    // A null FDR is not significant — an unknown q is not a small one.
    significant: isFdrSignificant(r.fdr),
  };
}

/** A pathway's per-track FGSEA statistics, minus the two derived fields. */
export type PathwayRowInput = Omit<PathwayTrackRow, 'direction' | 'significant'>;

export function pathwayRow(r: PathwayRowInput): PathwayTrackRow {
  return {
    ...r,
    direction: effectDirection(r.NES),
    significant: isFdrSignificant(r.padj),
  };
}
