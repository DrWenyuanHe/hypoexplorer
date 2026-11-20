// Multiplicity control for a whole-transcriptome rhythmicity scan.
//
// A circadian scan tests every expressed gene at once — 14,000-16,000 tests on
// these bundles — so which adjustment is applied changes the answer far more
// than which rhythm test produced the raw p-values. That makes it a user
// CHOICE here rather than a hardcoded default, and the choice is offered with
// its assumption attached (see ADJUSTMENT_NOTES), because BH and BY differ by
// a factor of about 10.2 at 15,000 tests and neither is universally right.
//
// Benjamini-Hochberg is not re-implemented here: the app keeps one shared
// spelling of it in utils/fdr, and two spellings that could drift apart is
// exactly the kind of duplication that makes two screens disagree about the
// same gene.

import { benjaminiHochberg } from '../utils/fdr';

export type AdjustMethod = 'none' | 'bh' | 'by' | 'holm' | 'bonferroni';

export const ADJUST_METHODS: AdjustMethod[] = ['bh', 'by', 'holm', 'bonferroni', 'none'];

export const ADJUSTMENT_LABELS: Record<AdjustMethod, string> = {
  none: 'None (raw p)',
  bh: 'Benjamini-Hochberg (FDR)',
  by: 'Benjamini-Yekutieli',
  holm: 'Holm-Bonferroni',
  bonferroni: 'Bonferroni',
};

export const ADJUSTMENT_NOTES: Record<AdjustMethod, string> = {
  none: 'No correction. As a nominal benchmark, if null p-values were uniform, about 750 of 15,000 genes with no true rhythm would fall below p < 0.05. A fixed 24 h COSINOR p-value is uniform under the null only when the F test’s assumptions hold (normal, independent errors with constant variance). Bonferroni correction across periods or templates within each gene, the discrete JTK_CYCLE null and the approximate Lomb–Scargle false-alarm value make null p-values non-uniform, so for those settings that figure is only a rough guide.',
  bh: 'Controls the false discovery rate, the expected share of false positives among genes called rhythmic. Assumes tests are independent or positively dependent.',
  by: 'Controls FDR under arbitrary dependence between genes. It multiplies BH-adjusted values by the harmonic sum 1 + 1/2 + ... + 1/m, about 10.2 at 15,000 tests, capped at 1. This is a conservative option when genes are co-expressed.',
  holm: 'Controls the family-wise error rate, the probability of any false positive. It has at least as much power as plain Bonferroni. Use it when a single false positive would be costly.',
  bonferroni: 'Controls the family-wise error rate by multiplying each p-value by the number of tests. This strict correction can miss true rhythms.',
};

/**
 * Adjust `pvals` in place of order — the returned array is aligned to the input,
 * so a caller can zip it straight back onto its rows.
 *
 * Non-finite entries (a gene the test declined to score) pass through as NaN and
 * are EXCLUDED from the test count m: charging multiplicity for a test that was
 * never run would penalize every other gene for a gene's missing data.
 */
export function adjustPValues(pvals: Array<number | null>, method: AdjustMethod): Array<number | null> {
  const out: Array<number | null> = new Array(pvals.length).fill(null);
  // Index only the real tests; m is their count, not the array length.
  const idx: number[] = [];
  for (let i = 0; i < pvals.length; i++) {
    const p = pvals[i];
    if (p != null && Number.isFinite(p)) idx.push(i);
  }
  const m = idx.length;
  if (m === 0) return out;

  if (method === 'none') {
    for (const i of idx) out[i] = pvals[i];
    return out;
  }

  if (method === 'bonferroni') {
    for (const i of idx) out[i] = Math.min(1, (pvals[i] as number) * m);
    return out;
  }

  if (method === 'bh') {
    const q = benjaminiHochberg(idx.map((i) => pvals[i] as number));
    idx.forEach((i, k) => { out[i] = q[k]; });
    return out;
  }

  if (method === 'by') {
    // BY is BH with the harmonic-number inflation c(m) = sum(1/i, i=1..m).
    const c = harmonicNumber(m);
    const q = benjaminiHochberg(idx.map((i) => pvals[i] as number));
    idx.forEach((i, k) => { out[i] = Math.min(1, q[k] * c); });
    return out;
  }

  // Holm: sort ascending, adjusted_(k) = max over j<=k of (m - j + 1) * p_(j),
  // clamped to 1. The running max is what makes it monotone (step-down).
  const order = [...idx].sort((a, b) => (pvals[a] as number) - (pvals[b] as number));
  let running = 0;
  order.forEach((i, k) => {
    const adj = (m - k) * (pvals[i] as number);
    running = Math.max(running, adj);
    out[i] = Math.min(1, running);
  });
  return out;
}

/** Column header for the adjusted value: 'p' when uncorrected, 'q' otherwise. */
export function adjustedColumnLabel(method: AdjustMethod): string {
  return method === 'none' ? 'p' : 'q';
}

/** The Benjamini-Yekutieli inflation c(m) = 1 + 1/2 + ... + 1/m. */
export function harmonicNumber(m: number): number {
  let c = 0;
  for (let i = 1; i <= m; i++) c += 1 / i;
  return c;
}

/** Short name of a correction for use inside a sentence ("after BH"). */
export const ADJUSTMENT_SHORT_LABELS: Record<AdjustMethod, string> = {
  none: 'no correction',
  bh: 'BH',
  by: 'BY',
  holm: 'Holm',
  bonferroni: 'Bonferroni',
};

/** What a lower bound on the raw p-value allows once `m` tests are corrected. */
export interface ThresholdReachability {
  /**
   * Lower bound on the adjusted value of any gene when no raw p can fall below
   * `pFloor`. For BH it is attained only with every gene at the floor; for Holm
   * and Bonferroni it is set by the single smallest p.
   */
  minAdjusted: number;
  /**
   * False only when NO gene can have an adjusted value strictly below the
   * threshold. True means the bound does not rule it out, not that it happens.
   */
  reachable: boolean;
  /**
   * Fewest genes that must pass together before any one of them can pass
   * (always 1 for no correction, Holm and Bonferroni). Null when unreachable.
   */
  minGenes: number | null;
}

/**
 * Whether `adjusted < threshold` is attainable for any gene when every raw
 * p-value is at least `pFloor` and `m` genes are tested (m as counted by
 * adjustPValues: genes with a finite p).
 *
 * `pFloor` need only be a common LOWER bound: the smallest p any gene can
 * reach. When genes have different floors (per-gene n differs through missing
 * values), pass the minimum. Every step below uses only p >= f, so a lower
 * bound keeps "unreachable" and "at least R genes" sound; it may understate R.
 * A non-finite floor is treated as no bound at all (f = 0), never as a reason
 * to call the threshold unreachable.
 *
 * Derivation, with f = pFloor:
 *  - none: the adjusted value is p itself, so the bound is f.
 *  - Bonferroni: m·p >= m·f for every gene.
 *  - Holm: every adjusted value is at least m·p(1) >= m·f (step-down running max).
 *  - BH: a gene passes only if some rank j has m·p(j)/j < t; since p(j) >= f this
 *    needs j > m·f/t, and the j genes up to that rank then all pass. The bound
 *    is therefore not a single-gene limit: R genes must pass together, with
 *    R the smallest integer above m·f/t, and the smallest possible q is f (R = m).
 *  - BY: BH scaled by c(m), so the same argument with f·c(m) in place of f.
 */
export function thresholdReachability(
  pFloor: number, m: number, method: AdjustMethod, threshold: number,
): ThresholdReachability {
  const f = Number.isFinite(pFloor) ? Math.min(1, Math.max(0, pFloor)) : 0;
  const n = Math.max(1, Math.floor(m));
  if (method === 'none') {
    const reachable = f < threshold;
    return { minAdjusted: f, reachable, minGenes: reachable ? 1 : null };
  }
  if (method === 'bonferroni' || method === 'holm') {
    const minAdjusted = Math.min(1, n * f);
    const reachable = minAdjusted < threshold;
    return { minAdjusted, reachable, minGenes: reachable ? 1 : null };
  }
  const c = method === 'by' ? harmonicNumber(n) : 1;
  const minAdjusted = Math.min(1, f * c);
  // Smallest R with n·f·c / R < t. Start from the closed form and correct for
  // floating-point error in either direction.
  const passes = (r: number) => Math.min(1, (n * f * c) / r) < threshold;
  let r = Math.max(1, Math.floor((n * f * c) / threshold) + 1);
  while (r > 1 && passes(r - 1)) r--;
  while (r <= n && !passes(r)) r++;
  const reachable = r <= n;
  return { minAdjusted, reachable, minGenes: reachable ? r : null };
}
