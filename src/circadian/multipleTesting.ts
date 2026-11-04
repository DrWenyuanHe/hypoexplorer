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
  none: 'No correction. With about 15,000 genes and no true rhythms, p<0.05 would flag roughly 750 genes by chance alone.',
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
    let c = 0;
    for (let i = 1; i <= m; i++) c += 1 / i;
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
