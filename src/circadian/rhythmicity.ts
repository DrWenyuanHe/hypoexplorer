// Rhythmicity detection: the three tests the circadian literature actually uses,
// implemented over the same input shape so a view can switch between them
// without reshaping its data.
//
//   COSINOR       parametric. Least-squares fit of M + A*cos(2pi(t-phi)/T);
//                 p from the F test of that 2-df model against a flat mean.
//                 Best power when the waveform really is sinusoidal.
//   JTK_CYCLE     non-parametric (Hughes, Hogenesch & Kornacker 2010). Kendall
//                 grouped exact permutation test against cosine rank templates,
//                 canonical half-interval phases, Bonferroni across templates,
//                 and Hodges–Lehmann amplitude. Requires a regular sampling grid.
//   LOMB-SCARGLE  least-squares periodogram (Scargle 1982) with the Horne &
//                 Baliunas (1986) independent-frequency count. Designed for
//                 UNEVENLY sampled series, which is what a time course with a
//                 dropped timepoint or unequal replicates actually is.
//
// All three take replicate observations directly (several rows sharing a time)
// rather than pre-averaged timepoint means: averaging first throws away the
// within-timepoint variance that COSINOR's F test and JTK's tie correction both
// depend on.
//
// Every method returns the SAME RhythmResult shape, including a comparable
// `acrophase` (peak time in hours within [0, period)) — the one number readers
// compare across methods, and the easiest to leave inconsistent when each
// method reports in its own convention. Here the convention is fixed once: peak
// time, in hours, on the dataset's own time axis.

import { fCdfUpper } from './distributions';
import { canonicalJtk } from './jtkCycle';

export type RhythmMethod = 'cosinor' | 'jtk' | 'ls';

export const RHYTHM_METHOD_LABELS: Record<RhythmMethod, string> = {
  jtk: 'JTK_CYCLE',
  cosinor: 'COSINOR',
  ls: 'Lomb-Scargle',
};

/** One gene's observations: `times[i]` (hours) carries `values[i]`. Replicates repeat a time. */
export interface RhythmSeries {
  times: number[];
  values: number[];
}

export interface RhythmResult {
  method: RhythmMethod;
  /** Rhythmicity p-value, including period/template search correction. */
  p: number;
  /** Best-supported period in hours; canonical JTK returns 0 for zero amplitude. */
  period: number;
  /** Peak time in hours within [0, period), on the dataset's own time axis. */
  acrophase: number;
  /** Half the peak-to-trough distance, in the dataset's expression unit. */
  amplitude: number;
  /** Rhythm-adjusted mean. */
  mesor: number;
  /** Method-specific statistic: F (cosinor), |S|/group maximum (JTK), normalized power (LS). */
  stat: number;
  /** Observations used (replicates counted individually). */
  n: number;
  /** Distinct sampling times used. */
  nTimepoints: number;
  /** Estimable candidate periods actually tested for this gene. */
  periodsTested?: number[];
}

/** Candidate periods to scan, in hours. A single-entry array pins the period. */
export interface RhythmOptions {
  periods: number[];
}

export const DEFAULT_PERIODS = [24];
/** 20-28 h in 0.5 h steps — the conventional scan window for a free-running rhythm. */
export const SCAN_PERIODS = Array.from({ length: 17 }, (_, i) => 20 + i * 0.5);

// The minimum a rhythm test can honestly say anything about: 3 distinct
// timepoints (COSINOR fits 3 parameters) and 4 observations (so there is at
// least one residual degree of freedom). Below that every method returns null
// and the view shows "—" rather than a p-value computed out of nothing.
const MIN_TIMEPOINTS = 3;
const MIN_OBSERVATIONS = 4;

interface CleanSeries {
  times: number[];
  values: number[];
  uniqueTimes: number[];
}

/**
 * Drop non-finite pairs and index the distinct times.
 *
 * Returns null when what is left cannot support a test, which is the single
 * gate all three methods share — so "too few points" is decided once, by one
 * rule, rather than three times by three slightly different ones.
 */
function clean(series: RhythmSeries): CleanSeries | null {
  const times: number[] = [];
  const values: number[] = [];
  const n = Math.min(series.times.length, series.values.length);
  for (let i = 0; i < n; i++) {
    const t = series.times[i];
    const v = series.values[i];
    if (Number.isFinite(t) && Number.isFinite(v)) {
      times.push(t);
      values.push(v);
    }
  }
  if (values.length < MIN_OBSERVATIONS) return null;
  const uniqueTimes = [...new Set(times)].sort((a, b) => a - b);
  if (uniqueTimes.length < MIN_TIMEPOINTS) return null;
  return { times, values, uniqueTimes };
}

/** Wrap a time into [0, period). */
function wrap(t: number, period: number): number {
  const m = t % period;
  return m < 0 ? m + period : m;
}

interface CosineFit {
  mesor: number;
  amplitude: number;
  acrophase: number;
  /** Residual sum of squares of the 3-parameter fit. */
  sse: number;
  /** Total sum of squares about the mean. */
  sst: number;
}

/**
 * Least-squares fit of y = M + beta*cos(wt) + gamma*sin(wt) at a fixed period.
 *
 * Solved through the 3x3 normal equations rather than a general solver: the
 * design matrix is only ever [1, cos, sin], and closing the form here keeps a
 * whole-transcriptome scan (20k genes x |periods| fits) allocation-free.
 * Returns null if the system is singular — which happens for real when every
 * observation sits at one timepoint.
 */
function fitCosine(times: number[], values: number[], period: number): CosineFit | null {
  const w = (2 * Math.PI) / period;
  const n = values.length;
  let sc = 0, ss = 0, scc = 0, sss = 0, scs = 0;
  let sy = 0, syc = 0, sys = 0;
  for (let i = 0; i < n; i++) {
    const c = Math.cos(w * times[i]);
    const s = Math.sin(w * times[i]);
    const y = values[i];
    sc += c; ss += s;
    scc += c * c; sss += s * s; scs += c * s;
    sy += y; syc += y * c; sys += y * s;
  }
  // Normal equations for [M, beta, gamma]:
  //   [ n   sc   ss  ] [M    ]   [sy ]
  //   [ sc  scc  scs ] [beta ] = [syc]
  //   [ ss  scs  sss ] [gamma]   [sys]
  const a11 = n, a12 = sc, a13 = ss;
  const a22 = scc, a23 = scs, a33 = sss;
  const det =
    a11 * (a22 * a33 - a23 * a23)
    - a12 * (a12 * a33 - a23 * a13)
    + a13 * (a12 * a23 - a22 * a13);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;

  // Inverse of the symmetric 3x3 via cofactors.
  const i11 = (a22 * a33 - a23 * a23) / det;
  const i12 = -(a12 * a33 - a23 * a13) / det;
  const i13 = (a12 * a23 - a22 * a13) / det;
  const i22 = (a11 * a33 - a13 * a13) / det;
  const i23 = -(a11 * a23 - a12 * a13) / det;
  const i33 = (a11 * a22 - a12 * a12) / det;

  const mesor = i11 * sy + i12 * syc + i13 * sys;
  const beta = i12 * sy + i22 * syc + i23 * sys;
  const gamma = i13 * sy + i23 * syc + i33 * sys;

  const meanY = sy / n;
  let sse = 0, sst = 0;
  for (let i = 0; i < n; i++) {
    const pred = mesor + beta * Math.cos(w * times[i]) + gamma * Math.sin(w * times[i]);
    const r = values[i] - pred;
    sse += r * r;
    const d = values[i] - meanY;
    sst += d * d;
  }

  // y = M + A*cos(w t + phi) with beta = A cos(phi), gamma = -A sin(phi).
  // The peak is where w t + phi = 0, i.e. t = -phi/w.
  const amplitude = Math.hypot(beta, gamma);
  const phi = Math.atan2(-gamma, beta);
  const acrophase = wrap(-phi / w, period);
  return { mesor, amplitude, acrophase, sse, sst };
}

/**
 * COSINOR. Fits at every candidate period and keeps the best-supported one.
 *
 * The p-value is the F test of the fitted 2-df cosine against the intercept-only
 * model. When the period grid has more than one entry the winner is selected on
 * that same F. Its p-value is Bonferroni-corrected across the unique estimable
 * candidate periods before the separate gene-wise adjustment.
 */
export function cosinor(series: RhythmSeries, options: RhythmOptions): RhythmResult | null {
  const c = clean(series);
  if (!c) return null;
  const df2 = c.values.length - 3;
  if (df2 < 1) return null;

  let best: RhythmResult | null = null;
  let tested = 0;
  const periodsTested: number[] = [];
  for (const period of new Set(options.periods)) {
    if (!(period > 0) || !Number.isFinite(period)) continue;
    const fit = fitCosine(c.times, c.values, period);
    if (!fit) continue;
    tested++;
    periodsTested.push(period);
    const ssr = fit.sst - fit.sse;
    // A fit that explains nothing (or is numerically negative) is F=0 -> p=1.
    const f = ssr > 0 ? (fit.sse > 0 ? (ssr / 2) / (fit.sse / df2) : Number.POSITIVE_INFINITY) : 0;
    const p = fCdfUpper(f, 2, df2);
    if (!best || f > best.stat) {
      best = {
        method: 'cosinor',
        p,
        period,
        acrophase: fit.acrophase,
        amplitude: fit.amplitude,
        mesor: fit.mesor,
        stat: f,
        n: c.values.length,
        nTimepoints: c.uniqueTimes.length,
      };
    }
  }
  if (best) {
    best.p = Math.min(1, best.p * tested);
    best.periodsTested = periodsTested;
  }
  return best;
}

/** Canonical JTK_CYCLE; see the independent grouped-null implementation. */
export function jtkCycle(series: RhythmSeries, options: RhythmOptions): RhythmResult | null {
  return canonicalJtk(series, options);
}

/**
 * Lomb-Scargle normalized periodogram.
 *
 * Power is evaluated at each candidate period on the classic time-shifted form
 * (Scargle 1982), which is invariant to the choice of time origin. The p-value
 * for the highest peak is the extreme-value tail 1 - (1 - e^-P)^M, with M the
 * number of INDEPENDENT frequencies from the Horne & Baliunas (1986) empirical
 * formula rather than the number of grid points — a denser grid does not buy
 * more independent tests, and charging it as if it did would make the p-value a
 * function of the scan resolution.
 *
 * Amplitude, mesor and acrophase come from the least-squares cosine fit at the
 * winning period. That is not a second method bolted on: the Lomb-Scargle power
 * IS the sum of squares that fit explains, so the two agree by construction.
 */
export function lombScargle(series: RhythmSeries, options: RhythmOptions): RhythmResult | null {
  const c = clean(series);
  if (!c) return null;
  const n = c.values.length;
  const meanY = c.values.reduce((a, b) => a + b, 0) / n;
  let variance = 0;
  for (const v of c.values) variance += (v - meanY) ** 2;
  variance /= n - 1;
  if (!(variance > 0)) return null;

  let bestPower = -1;
  let bestPeriod = options.periods[0];
  for (const period of options.periods) {
    const w = (2 * Math.PI) / period;
    // tau makes the sine and cosine sums orthogonal at this frequency.
    let sin2 = 0, cos2 = 0;
    for (const t of c.times) {
      sin2 += Math.sin(2 * w * t);
      cos2 += Math.cos(2 * w * t);
    }
    const tau = Math.atan2(sin2, cos2) / (2 * w);
    let cTerm = 0, sTerm = 0, cc = 0, ss = 0;
    for (let i = 0; i < n; i++) {
      const arg = w * (c.times[i] - tau);
      const cosArg = Math.cos(arg);
      const sinArg = Math.sin(arg);
      const dy = c.values[i] - meanY;
      cTerm += dy * cosArg;
      sTerm += dy * sinArg;
      cc += cosArg * cosArg;
      ss += sinArg * sinArg;
    }
    const power = (
      (cc > 0 ? (cTerm * cTerm) / cc : 0) + (ss > 0 ? (sTerm * sTerm) / ss : 0)
    ) / (2 * variance);
    if (power > bestPower) {
      bestPower = power;
      bestPeriod = period;
    }
  }
  if (bestPower < 0) return null;

  // Horne & Baliunas (1986) independent-frequency count, capped by the grid size
  // when the grid is coarser than the data's own resolution.
  const hb = Math.round(-6.362 + 1.193 * n + 0.00098 * n * n);
  const m = Math.max(1, Math.min(options.periods.length, hb || 1));
  const p = Math.min(1, Math.max(0, 1 - (1 - Math.exp(-bestPower)) ** m));

  const fit = fitCosine(c.times, c.values, bestPeriod);
  return {
    method: 'ls',
    p,
    period: bestPeriod,
    acrophase: fit?.acrophase ?? 0,
    amplitude: fit?.amplitude ?? 0,
    mesor: fit?.mesor ?? meanY,
    stat: bestPower,
    n,
    nTimepoints: c.uniqueTimes.length,
  };
}

/** Dispatch to one of the three tests. */
export function runRhythmicity(
  method: RhythmMethod,
  series: RhythmSeries,
  options: RhythmOptions,
): RhythmResult | null {
  if (method === 'cosinor') return cosinor(series, options);
  if (method === 'jtk') return jtkCycle(series, options);
  return lombScargle(series, options);
}

/** The fitted curve for plotting: `points` samples of M + A*cos(2pi(t-acro)/T). */
export function fittedCurve(
  result: Pick<RhythmResult, 'mesor' | 'amplitude' | 'acrophase' | 'period'>,
  from: number,
  to: number,
  points = 100,
): Array<{ t: number; y: number }> {
  const out: Array<{ t: number; y: number }> = [];
  const w = result.period > 0 ? (2 * Math.PI) / result.period : 0;
  for (let i = 0; i <= points; i++) {
    const t = from + ((to - from) * i) / points;
    out.push({ t, y: result.mesor + result.amplitude * Math.cos(w * (t - result.acrophase)) });
  }
  return out;
}
