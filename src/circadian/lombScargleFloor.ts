// The Lomb–Scargle p floor one arm's finished scan may state.
//
// Lomb–Scargle's normalized power is at most (n − 1)/2, so its p-value has a
// floor set by the series length: with few libraries, no gene can reach a
// strict threshold however rhythmic it is. The Circadian notes say so, and
// that statement is the hazard. A floor that is wrong tells the user "no gene
// can pass" when one could. So the decision of WHEN a floor may be stated
// lives here, with its preconditions, where it can be tested without
// rendering the tab:
//
//   * only for Lomb–Scargle, and only for a scan of THIS arm that has finished
//     and scored at least one gene (a rescan's running state states nothing);
//   * only when every distinct observed sampling pattern among the scored genes
//     keeps the (n − 1)/2 cap at every tested period (the cap check);
//   * only when every scored p is at or above its floor (the observed-p
//     guard). The cap check alone does not imply the floor: a large time origin
//     can pass it while rounding lets the computed power exceed the cap.
//
// Option B of the design review: rhythmicity.ts is byte-pinned by the retained
// circadian validation evidence, so the shifted-column arithmetic below copies
// lombScargle's rather than sharing it, and the tests pin the two together.

import type { TimeSeriesBundle } from '../types';
import type { RhythmMethod } from './rhythmicity';
import type { ScanState } from './scan';
import { ALL_ARMS } from './timeSeriesSource';

/** A floor an arm can state: the series length that sets it and the smallest p it allows. */
export interface LombScargleBound {
  n: number;
  floor: number;
}

/**
 * Smallest p Lomb–Scargle can report for `n` observations over a grid of
 * `nPeriods` periods, given the (n − 1)/2 power cap. The Horne–Baliunas count
 * is spelled as lombScargle spells it (rhythmicity.ts).
 */
export function lombScargleFloor(n: number, nPeriods: number): number {
  const hb = Math.round(-6.362 + 1.193 * n + 0.00098 * n * n);
  const m = Math.max(1, Math.min(nPeriods, hb || 1));
  return 1 - (1 - Math.exp(-(n - 1) / 2)) ** m;
}

/**
 * Smallest share of the series' squared length (cos² + sin² sums to n) either
 * time-shifted column must keep to count as non-degenerate. A column that
 * vanishes in exact arithmetic keeps about 1e-32 of it after rounding; at this
 * tolerance a genuine column's projection is still accurate to ~1e-12.
 */
const LS_COLUMN_TOL = 1e-6;
/** Largest |cosine| of the angle between the two shifted columns (they should be orthogonal). */
const LS_ORTHOGONALITY_TOL = 1e-8;
/** A relative tolerance on the observed-p guard, for a gene exactly at the cap. */
const OBSERVED_P_TOL = 1e-9;

/**
 * Whether the (n − 1)/2 power cap can hold for a series observed at `times`,
 * at every period in `periods`.
 *
 * The cap is a projection argument. After Scargle's shift τ the cosine and sine
 * columns are orthogonal, so the periodogram's two terms add up to the squared
 * length of the centred data's projection onto their span, which cannot exceed
 * the total sum of squares. That needs both columns to be non-degenerate and
 * the pair orthogonal to working precision. When the observed times fall on
 * phases where one column vanishes (0, 12 and 24 h at 24 h, say) the computed
 * term is a ratio of rounding errors and the power can exceed the cap. The
 * arithmetic mirrors lombScargle step for step, summing in the order given.
 */
function capHolds(times: readonly number[], periods: readonly number[]): boolean {
  const n = times.length;
  for (const period of periods) {
    const w = (2 * Math.PI) / period;
    let sin2 = 0, cos2 = 0;
    for (const t of times) {
      sin2 += Math.sin(2 * w * t);
      cos2 += Math.cos(2 * w * t);
    }
    const tau = Math.atan2(sin2, cos2) / (2 * w);
    let cc = 0, ss = 0, cs = 0;
    for (const t of times) {
      const arg = w * (t - tau);
      const c = Math.cos(arg);
      const s = Math.sin(arg);
      cc += c * c;
      ss += s * s;
      cs += c * s;
    }
    if (!(cc > LS_COLUMN_TOL * n) || !(ss > LS_COLUMN_TOL * n)) return false;
    // Orthogonal to working precision, hence also of full rank.
    if (!(cs * cs <= LS_ORTHOGONALITY_TOL ** 2 * cc * ss)) return false;
  }
  return true;
}

/**
 * The floor the selected arm may state, or null to state none.
 *
 * `state` is the arm's scan as useArmScans matched it to `bundle` and these
 * settings. The value is the smallest floor over the series lengths the scored
 * genes were actually tested at (a gene missing a library is tested at a
 * smaller n, and over a period scan the floor is not monotone in n); the
 * scheduled library count is not used.
 */
export function armLombScargleFloor(input: {
  method: RhythmMethod;
  state: ScanState | undefined;
  bundle: TimeSeriesBundle;
  arm: string;
  periods: readonly number[];
}): LombScargleBound | null {
  const { method, state, bundle, arm, periods } = input;
  if (method !== 'ls' || !arm || !state || state.running || !state.rows.length) return null;
  // Sample indices of this arm, in bundle order: the order seriesFor reads them in.
  const indices: number[] = [];
  bundle.meta.samples.forEach((s, i) => { if (arm === ALL_ARMS || s.arm === arm) indices.push(i); });
  // Keyed by the gene's missingness mask over this arm's samples. A mask means
  // different times in another arm or bundle, so the map lives for one call.
  const patternHolds = new Map<string, boolean>();
  const floorOf = new Map<number, number>();
  let best: LombScargleBound | null = null;
  for (const r of state.rows) {
    const values = bundle.values[r.gene];
    if (!values) return null;
    let key = '';
    for (const i of indices) {
      const v = values[i];
      key += v != null && Number.isFinite(v) ? '1' : '0';
    }
    let holds = patternHolds.get(key);
    if (holds == null) {
      const times = indices.filter((_, k) => key[k] === '1').map((i) => bundle.meta.samples[i].time);
      holds = capHolds(times, periods);
      patternHolds.set(key, holds);
    }
    if (!holds) return null;
    let floor = floorOf.get(r.n);
    if (floor == null) {
      floor = lombScargleFloor(r.n, periods.length);
      floorOf.set(r.n, floor);
      if (!best || !(best.floor <= floor)) best = { n: r.n, floor };
    }
    if (!Number.isFinite(r.p) || r.p < floor * (1 - OBSERVED_P_TOL)) return null;
  }
  return best && Number.isFinite(best.floor) ? best : null;
}
