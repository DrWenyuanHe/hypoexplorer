// edgeR's TMM normalization (calcNormFactors, method = "TMM", default
// arguments), ported for the one browser matrix no DE fit covers: a time-course
// bundle whose libraries span more samples than its two-arm DE contrast.
//
// Mirrors edgeR 4.x calcNormFactors.default:
//   * rows that are zero in every library are dropped;
//   * the reference library is the one whose upper-quartile (p = 0.75,
//     quantile type 7) of counts/lib.size is closest to the mean of those
//     upper quartiles (or, when the median upper quartile is below 1e-20, the
//     library with the largest sum of sqrt(counts));
//   * per library, M = log2 ratio and A = mean log2 abundance against the
//     reference; the 30% most extreme M and 5% most extreme A are trimmed (by
//     average rank), and the factor is the precision-weighted mean of M;
//   * factors are rescaled to a geometric mean of 1.
// Validated against edgeR 4.10.1 (see scripts/lib/tmm.test.mts).

/** Quantile, R type 7 (the default of stats::quantile). */
function quantile7(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/** Average ranks (R's rank(ties.method = "average")), 1-based. */
function averageRanks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k][1]] = rank;
    i = j + 1;
  }
  return ranks;
}

function factorTMM(obs: number[], ref: number[], nO: number, nR: number,
  logratioTrim = 0.3, sumTrim = 0.05, Acutoff = -1e10): number {
  const logR: number[] = [];
  const absE: number[] = [];
  const v: number[] = [];
  for (let g = 0; g < obs.length; g++) {
    const o = obs[g];
    const r = ref[g];
    const lr = Math.log2((o / nO) / (r / nR));
    const ae = (Math.log2(o / nO) + Math.log2(r / nR)) / 2;
    if (!Number.isFinite(lr) || !Number.isFinite(ae) || !(ae > Acutoff)) continue;
    logR.push(lr);
    absE.push(ae);
    v.push((nO - o) / nO / o + (nR - r) / nR / r);
  }
  if (!logR.length || Math.max(...logR.map(Math.abs)) < 1e-6) return 1;
  const n = logR.length;
  const loL = Math.floor(n * logratioTrim) + 1;
  const hiL = n + 1 - loL;
  const loS = Math.floor(n * sumTrim) + 1;
  const hiS = n + 1 - loS;
  const rankR = averageRanks(logR);
  const rankE = averageRanks(absE);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    if (rankR[i] >= loL && rankR[i] <= hiL && rankE[i] >= loS && rankE[i] <= hiS) {
      num += logR[i] / v[i];
      den += 1 / v[i];
    }
  }
  const f = num / den;
  return Number.isFinite(f) ? 2 ** f : 1;
}

/**
 * TMM normalization factors for a genes x libraries count matrix given as
 * library columns (`columns[j][g]`), with library sizes `libSizes`.
 */
export function calcNormFactorsTMM(columns: number[][], libSizes: number[]): number[] {
  const nLib = columns.length;
  if (!nLib) return [];
  const nGene = columns[0].length;
  const keep: number[] = [];
  for (let g = 0; g < nGene; g++) {
    if (columns.some((col) => col[g] !== 0)) keep.push(g);
  }
  const x = columns.map((col) => keep.map((g) => col[g]));
  const f75 = x.map((col, j) => quantile7(col.map((c) => c / libSizes[j]).sort((a, b) => a - b), 0.75));
  const sortedF75 = [...f75].sort((a, b) => a - b);
  let refColumn: number;
  if (quantile7(sortedF75, 0.5) < 1e-20) {
    const sq = x.map((col) => col.reduce((s, c) => s + Math.sqrt(c), 0));
    refColumn = sq.indexOf(Math.max(...sq));
  } else {
    const mean = f75.reduce((a, b) => a + b, 0) / nLib;
    const dist = f75.map((q) => Math.abs(q - mean));
    refColumn = dist.indexOf(Math.min(...dist));
  }
  const factors = x.map((col, j) => factorTMM(col, x[refColumn], libSizes[j], libSizes[refColumn]));
  const geo = Math.exp(factors.reduce((s, f) => s + Math.log(f), 0) / nLib);
  return factors.map((f) => f / geo);
}
