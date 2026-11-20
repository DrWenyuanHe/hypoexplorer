// The cross-study listing (CONTEXT.md): one term's results across a study
// selection, arranged for a listing mode. The search summaries, the gene report
// and the pathway report all present one, so what leads, the order and what is
// counted are decided here once, and each view decides only how much of it to
// show and what starts folded.
//
// THE RULES
// ---------
// - A row's tier is the row's own (`tier`, set by geneRow / pathwayRow); this
//   module never recomputes it, so a row's label cannot depend on the mode.
// - Lead: in 'nominal' mode the fdr and nominal tiers, in 'fdr' mode the fdr
//   tier alone. Rest: everything else. Both come back in the mode's order.
// - Tier bands are fixed: 'nominal' mode lists fdr → nominal → none, 'fdr'
//   mode lists fdr → everything else as one band.
// - Within a band the order is the caller's:
//     'significance': q for the fdr band; for the other bands, raw p in
//                     'nominal' mode and q in 'fdr' mode; ties by |effect|.
//     'effect':       |effect| alone, largest first.
// - Missing keys (null, NaN, ±Infinity) sort after every finite key. Exact
//   ties keep the input order (group order, then track order), so calling the
//   listing on a subset of groups orders that subset as the whole would.
// - Counts follow the tiers, not the mode, except `nominal`, which is null in
//   'fdr' mode: that mode neither lists nor counts the nominal tier. A 'flat'
//   row counts toward its tier and toward neither direction. A group with no
//   tracks contributes nothing; selected-but-unmeasured datasets are the view's
//   to report.
//
// Pure and synchronous: the inputs are never mutated, so a view can pass the
// cached arrays a loader returned.

import type { Direction, PathwayTrackRow, TrackRow } from '../types';
import type { ListingMode } from './listingModeStore';
import type { SignificanceTier } from './policy';

/** How a row type exposes the keys the listing orders by. */
export interface ListingKeys<R> {
  /** The adjusted p-value (gene FDR, pathway padj). */
  q(row: R): number | null;
  /** The raw p-value. */
  p(row: R): number | null;
  /** The effect size whose magnitude breaks ties (log2FC, NES). Sign is ignored. */
  effect(row: R): number;
}

export const GENE_KEYS: ListingKeys<TrackRow> = {
  q: (row) => row.fdr,
  p: (row) => row.pval,
  effect: (row) => row.logFC,
};

export const PATHWAY_KEYS: ListingKeys<PathwayTrackRow> = {
  q: (row) => row.padj,
  p: (row) => row.pval,
  effect: (row) => row.NES,
};

/** How rows within one tier band are ordered. */
export type ListingOrder = 'significance' | 'effect';

/** One listed result: the track and the group (study) it came from. */
export interface Listed<G, R> {
  group: G;
  track: R;
}

export interface CrossStudyListing<G, R> {
  /** The rows that qualify in the mode, in order. */
  lead: Listed<G, R>[];
  /** Every other measured row, in order. */
  rest: Listed<G, R>[];
  tracks: {
    measured: number;
    /** Rows in the fdr tier. */
    fdr: number;
    /** fdr-tier rows by direction. */
    up: number;
    down: number;
  };
  datasets: {
    /** Groups with at least one track. */
    measured: number;
    /** Groups with at least one fdr-tier track. */
    fdr: number;
  };
  /** The nominal tier; null in 'fdr' mode. */
  nominal: {
    tracks: number;
    /** Groups with a nominal track and no fdr track. */
    datasets: number;
    up: number;
    down: number;
  } | null;
}

interface ListableRow {
  tier: SignificanceTier;
  direction: Direction;
}

const BAND: Record<ListingMode, Record<SignificanceTier, number>> = {
  nominal: { fdr: 0, nominal: 1, none: 2 },
  fdr: { fdr: 0, nominal: 1, none: 1 },
};

const finite = (x: number | null | undefined): x is number => x != null && Number.isFinite(x);

/** Ascending, with every missing or non-finite key after the finite ones. */
function ascending(a: number | null, b: number | null): number {
  if (finite(a) && finite(b)) return a - b;
  return finite(a) ? -1 : finite(b) ? 1 : 0;
}

/** Largest magnitude first, with every missing or non-finite effect last. */
function byMagnitude(a: number, b: number): number {
  if (finite(a) && finite(b)) return Math.abs(b) - Math.abs(a);
  return finite(a) ? -1 : finite(b) ? 1 : 0;
}

export function listCrossStudy<G extends { tracks: readonly R[] }, R extends ListableRow>(
  groups: readonly G[],
  mode: ListingMode,
  keys: ListingKeys<R>,
  order: ListingOrder,
): CrossStudyListing<G, R> {
  const band = BAND[mode];
  const rows: Listed<G, R>[] = [];
  const tracks = { measured: 0, fdr: 0, up: 0, down: 0 };
  const datasets = { measured: 0, fdr: 0 };
  const nominal = { tracks: 0, datasets: 0, up: 0, down: 0 };

  for (const group of groups) {
    if (group.tracks.length === 0) continue;
    datasets.measured++;
    let anyFdr = false, anyNominal = false;
    for (const track of group.tracks) {
      rows.push({ group, track });
      tracks.measured++;
      if (track.tier === 'fdr') {
        anyFdr = true;
        tracks.fdr++;
        if (track.direction === 'up') tracks.up++;
        else if (track.direction === 'down') tracks.down++;
      } else if (track.tier === 'nominal') {
        anyNominal = true;
        nominal.tracks++;
        if (track.direction === 'up') nominal.up++;
        else if (track.direction === 'down') nominal.down++;
      }
    }
    if (anyFdr) datasets.fdr++;
    else if (anyNominal) nominal.datasets++;
  }

  // Within a band, the significance key: q for the fdr band, otherwise the
  // mode's (raw p when the nominal tier is listed, q when it is not).
  const key = (track: R): number | null =>
    track.tier === 'fdr' || mode === 'fdr' ? keys.q(track) : keys.p(track);
  const compare = (a: Listed<G, R>, b: Listed<G, R>): number => {
    const byBand = band[a.track.tier] - band[b.track.tier];
    if (byBand !== 0) return byBand;
    const effect = byMagnitude(keys.effect(a.track), keys.effect(b.track));
    return order === 'effect' ? effect : ascending(key(a.track), key(b.track)) || effect;
  };
  // Array.prototype.sort is stable, so exact ties keep the input order.
  rows.sort(compare);

  const leads = (track: R) => (mode === 'nominal' ? track.tier !== 'none' : track.tier === 'fdr');
  return {
    lead: rows.filter((row) => leads(row.track)),
    rest: rows.filter((row) => !leads(row.track)),
    tracks,
    datasets,
    nominal: mode === 'nominal' ? nominal : null,
  };
}
