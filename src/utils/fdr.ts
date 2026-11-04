// Benjamini–Hochberg step-up FDR, shared by every screen that corrects a family
// of p-values in the browser.
//
// This used to live in a cross-dataset meta-analysis module alongside a
// DerSimonian–Laird pooler. The pooling is gone — the corpus spans eleven
// species, several platforms and a dozen different perturbations, so combining
// one gene's effect estimates across studies averaged questions that are not the
// same question — but BH itself is still needed by the circadian scan, which
// tests every expressed gene at once.

/**
 * Benjamini–Hochberg step-up FDR. Returns q-values aligned to the input order.
 * Callers must pass finite p-values in [0, 1].
 */
export function benjaminiHochberg(pvals: number[]): number[] {
  const n = pvals.length;
  if (n === 0) return [];
  const order = pvals.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const q = new Array<number>(n);
  let prev = 1;
  // Walk from the largest p-value down, enforcing monotonicity.
  for (let rank = n; rank >= 1; rank--) {
    const { p, i } = order[rank - 1];
    prev = Math.min(prev, (p * n) / rank);
    q[i] = prev;
  }
  return q;
}
