// Whether a gene is called rhythmic: one rule for the tab, its table and the
// per-arm strip.
//
// A row is judged on its adjusted value, or on the raw p when the user turned
// the correction off. That decision used to be spelled in the tab (its filter
// and its count reducer), handed to the table as a function prop, and
// re-derived by the strip under the trace with its own precedence. It sits
// beside multipleTesting.ts rather than inside it, so that file stays limited
// to what the retained R reference (reference.R) checks.

import type { AdjustMethod } from './multipleTesting';

/** The correction and threshold a call is made under. */
export interface RhythmCall {
  adjust: AdjustMethod;
  threshold: number;
}

/**
 * The number a scanned row is judged on: the raw p when the correction is off,
 * else its adjusted q. A row not yet adjusted (q null) counts as 1, never as
 * its raw p: a raw scan row carries q: null until its arm's correction runs.
 */
export function rhythmScore(row: { p: number; q: number | null }, adjust: AdjustMethod): number {
  return adjust === 'none' ? row.p : (row.q ?? 1);
}

/** Called rhythmic under this correction and threshold. A non-finite score is not. */
export function isRhythmic(row: { p: number; q: number | null }, call: RhythmCall): boolean {
  return rhythmScore(row, call.adjust) < call.threshold;
}

export type ArmVerdict = 'rhythmic' | 'not rhythmic' | 'pending' | 'not tested';

/**
 * The selected gene's verdict in one arm, from its own fit and the arm's
 * adjusted value for it (undefined while the arm's scan runs, null when the
 * scan did not score the gene). Precedence:
 *   no fit                → 'not tested', even while the arm is still queued;
 *   correction off        → judged on the fit's own p at once, never 'pending';
 *   q undefined           → 'pending';
 *   q null                → 'not tested';
 *   otherwise             → judged on q.
 */
export function armVerdict(fit: { p: number } | null, q: number | null | undefined, call: RhythmCall): ArmVerdict {
  if (!fit) return 'not tested';
  if (call.adjust === 'none') return fit.p < call.threshold ? 'rhythmic' : 'not rhythmic';
  if (q === undefined) return 'pending';
  if (q === null) return 'not tested';
  return q < call.threshold ? 'rhythmic' : 'not rhythmic';
}
