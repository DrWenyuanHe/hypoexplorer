// Statistical distributions the rhythmicity tests need, implemented here because
// the app has no stats dependency and the three tests each need a different tail:
//
//   COSINOR       → F distribution (2, n-3) upper tail        → fCdfUpper
// Canonical JTK_CYCLE's grouped null lives in jtkCycle.ts. The ungrouped Kendall
// distribution remains available for distribution regression tests.
//   Lomb-Scargle  → exponential extreme-value tail             → (in rhythmicity.ts)
//
// Everything is pure, allocation-light and double-precision. The incomplete-beta
// continued fraction is the standard Lentz evaluation (Numerical Recipes §6.4);
// it is the one piece here with a convergence loop, and it is capped rather than
// unbounded so a pathological input can never hang the browser tab.

/** Lanczos log-gamma (g=7, n=9). Accurate to ~1e-13 for x > 0. */
export function logGamma(x: number): number {
  const g = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    // Reflection: Γ(x)Γ(1-x) = π / sin(πx)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let a = g[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += g[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Regularized incomplete beta I_x(a, b).
 *
 * Uses the continued fraction directly for x < (a+1)/(a+b+2) and the symmetry
 * I_x(a,b) = 1 - I_{1-x}(b,a) otherwise, which is where the fraction converges
 * fastest. Returns 0/1 at the boundaries without iterating.
 */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x > (a + 1) / (a + b + 2)) return 1 - incompleteBeta(1 - x, b, a);

  const front = Math.exp(
    a * Math.log(x) + b * Math.log(1 - x) + logGamma(a + b) - logGamma(a) - logGamma(b),
  ) / a;

  // Modified Lentz: f = 1 + d1 + d2 + ... evaluated as a continued fraction.
  const tiny = 1e-30;
  let f = 1;
  let c = 1;
  let d = 0;
  for (let i = 0; i <= 300; i++) {
    const m = Math.floor(i / 2);
    let numerator: number;
    if (i === 0) numerator = 1;
    else if (i % 2 === 0) numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else numerator = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));

    d = 1 + numerator * d;
    if (Math.abs(d) < tiny) d = tiny;
    d = 1 / d;

    c = 1 + numerator / c;
    if (Math.abs(c) < tiny) c = tiny;

    const cd = c * d;
    f *= cd;
    if (Math.abs(1 - cd) < 1e-12) break;
  }
  return front * (f - 1);
}

/**
 * Upper tail of the F distribution: P(F_{df1,df2} >= f).
 *
 * This is the COSINOR p-value: the 2-df cosine model tested against the
 * intercept-only model. Degenerate inputs (f <= 0, no residual df) return 1 —
 * "no evidence of rhythm" — rather than NaN, so a flat or over-parameterized
 * gene is reported as non-rhythmic instead of poisoning a sort.
 */
export function fCdfUpper(f: number, df1: number, df2: number): number {
  if (f === Number.POSITIVE_INFINITY && df1 > 0 && df2 > 0) return 0;
  if (!Number.isFinite(f) || f <= 0) return 1;
  if (df1 <= 0 || df2 <= 0) return 1;
  const x = df2 / (df2 + df1 * f);
  const p = incompleteBeta(x, df2 / 2, df1 / 2);
  return Math.min(1, Math.max(0, p));
}

/** Standard-normal survival function P(Z >= z), via the Abramowitz-Stegun erfc. */
export function normalSf(z: number): number {
  return 0.5 * erfc(z / Math.SQRT2);
}

/** Complementary error function, |relative error| < 1.2e-7 (A&S 7.1.26 form). */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + z / 2);
  const y = t * Math.exp(
    -z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418
      + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587
        + t * (-0.82215223 + t * 0.17087277))))))))
  );
  return x >= 0 ? y : 2 - y;
}

/**
 * Exact two-sided p-value for Kendall's S under the null of random ordering,
 * for n untied items.
 *
 * The null distribution of the number of concordant-minus-discordant pairs is
 * the Mahonian distribution (permutations by inversion count), built here by the
 * standard DP: inserting the k-th item can add 0..k-1 inversions, so each step
 * is a sliding-window sum over the previous row. Counts are held as doubles
 * NORMALIZED at every step (divided by k), which keeps them probabilities
 * rather than factorial-sized integers — n=40 would overflow otherwise.
 *
 * Returns null when n exceeds `maxN`, so the caller can fall back to the normal
 * approximation instead of spending O(n^3) on a gene it has 20,000 of.
 */
export function kendallExactP(S: number, n: number, maxN = 24): number | null {
  if (n < 2) return null;
  if (n > maxN) return null;
  const maxInv = (n * (n - 1)) / 2;
  // dist[i] = P(inversions == i) after inserting the first k items.
  let dist = new Float64Array(maxInv + 1);
  dist[0] = 1;
  for (let k = 2; k <= n; k++) {
    const next = new Float64Array(maxInv + 1);
    // Sliding window of width k over dist, then normalize by k so the row stays
    // a probability distribution.
    let running = 0;
    for (let i = 0; i <= maxInv; i++) {
      running += dist[i];
      if (i >= k) running -= dist[i - k];
      next[i] = running / k;
    }
    dist = next;
  }
  // S = maxInv - 2*inversions, so |S| >= s  <=>  inversions <= (maxInv-s)/2 or
  // inversions >= (maxInv+s)/2. The distribution is symmetric, so one tail x2.
  const s = Math.abs(S);
  if (s > maxInv) return 0;
  const lowCut = Math.floor((maxInv - s) / 2);
  let tail = 0;
  for (let i = 0; i <= lowCut; i++) tail += dist[i];
  return Math.min(1, 2 * tail);
}
