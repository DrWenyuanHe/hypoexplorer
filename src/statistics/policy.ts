// Significance policy — the app's DEFAULT FDR call and the sign of an effect,
// in one dependency-free place.
//
// Deliberately free of imports so every consumer can take it: the cross-dataset
// row builder, the QC fold, the report views and the Statistics glossary all
// need the cutoff, and none of them should acquire a runtime link to the
// cross-dataset row machinery to get it.
//
// WHAT THIS IS NOT
// ----------------
// There is no single application-wide significance number, and this module must
// not be swept over every `0.05` in the tree. These are DIFFERENT policies that
// happen to share a digit:
//
//   - `pToStar` / the star ladder (src/utils/format.ts) cuts RAW p at
//     0.05/0.01/0.001. Stars are a raw-p shorthand, not an FDR call.
//   - The FGSEA QC fold (src/qc/fgseaSummary.ts) counts pathways in PAIRED bins
//     at 0.05 and 0.25, and the bin edges are baked into its field names
//     (`hallmark_005` / `hallmark_025`). A cutoff change must not silently
//     redefine a column called `_005`.
//   - The Circadian tab (src/circadian/CircadianTab.tsx) offers a SELECTABLE
//     threshold over several correction methods — a user control, not a policy.
//   - The Pathway Explorer's FDR slider defaults to 1.0 (show everything) and
//     is likewise user-controlled.
//
// Only the fixed, non-negotiable "is this row a discovery?" call belongs here.

import type { Direction } from '../types';

/**
 * The default false-discovery-rate cutoff: a row is called significant when its
 * adjusted p (gene FDR, or pathway padj) is strictly below this.
 *
 * Shared by both cross-dataset fetch paths, the per-track report rows, the
 * compare views and the prose in StatisticsView, so the number the app applies
 * and the number it documents cannot drift apart.
 */
export const DEFAULT_FDR_CUTOFF = 0.05;

/**
 * The FDR call. A null/undefined or non-finite q is NOT significant — an
 * unknown q is not a small one, and `null < 0.05` would otherwise be true.
 */
export function isFdrSignificant(
  q: number | null | undefined,
  cutoff: number = DEFAULT_FDR_CUTOFF,
): boolean {
  return q != null && Number.isFinite(q) && q < cutoff;
}

/** Sign of an effect size. Exactly 0 (and NaN) is 'flat', never 'down'. */
export function effectDirection(x: number): Direction {
  return x > 0 ? 'up' : x < 0 ? 'down' : 'flat';
}

/**
 * The 97.5th percentile of N(0, 1) — the multiplier for an APPROXIMATE 95%
 * Wald interval.
 *
 * Named `NORMAL_975` rather than `Z_95_CI` on purpose: the intervals this app
 * draws from a per-study SE are normal-approximation Wald intervals, not the
 * moderated-t intervals limma itself would report (limma uses a t critical
 * value on `df.total`, which the bundles do not carry). Label them as
 * approximate wherever they are shown.
 */
export const NORMAL_975 = 1.959963984540054;
