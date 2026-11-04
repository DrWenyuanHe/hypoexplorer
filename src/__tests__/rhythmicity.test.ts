import { describe, expect, it } from 'vitest';
import {
  cosinor, fittedCurve, jtkCycle, lombScargle, runRhythmicity,
  DEFAULT_PERIODS, SCAN_PERIODS,
} from '../circadian/rhythmicity';
import { fCdfUpper, incompleteBeta, kendallExactP, normalSf } from '../circadian/distributions';
import { adjustPValues } from '../circadian/multipleTesting';

// A clean 24 h cosine sampled every 4 h over two cycles, peaking at t=6.
function cosineSeries(peak: number, amplitude = 2, mesor = 10, noise = 0) {
  const times: number[] = [];
  const values: number[] = [];
  for (let t = 0; t < 48; t += 4) {
    for (let rep = 0; rep < 3; rep++) {
      times.push(t);
      // Deterministic pseudo-noise so the test never flakes.
      const jitter = noise * Math.sin(t * 7.1 + rep * 2.3);
      values.push(mesor + amplitude * Math.cos((2 * Math.PI * (t - peak)) / 24) + jitter);
    }
  }
  return { times, values };
}

describe('distributions', () => {
  it('incompleteBeta matches known values', () => {
    // I_0.5(1,1) = 0.5 (uniform), I_0.5(2,2) = 0.5 by symmetry.
    expect(incompleteBeta(0.5, 1, 1)).toBeCloseTo(0.5, 10);
    expect(incompleteBeta(0.5, 2, 2)).toBeCloseTo(0.5, 10);
    expect(incompleteBeta(0, 2, 3)).toBe(0);
    expect(incompleteBeta(1, 2, 3)).toBe(1);
  });

  it('fCdfUpper matches the closed form for df1=2', () => {
    // With 2 numerator df the F upper tail collapses to (1 + 2f/v)^(-v/2) — an
    // identity that owes nothing to the incomplete-beta path being tested, so
    // this checks the implementation rather than restating it. df1=2 is also
    // exactly the COSINOR case (a 2-parameter cosine against a flat mean).
    const closed = (f: number, v: number) => (1 + (2 * f) / v) ** (-v / 2);
    expect(fCdfUpper(5, 2, 10)).toBeCloseTo(closed(5, 10), 12);
    expect(fCdfUpper(1, 2, 10)).toBeCloseTo(closed(1, 10), 12);
    expect(fCdfUpper(19, 2, 33)).toBeCloseTo(closed(19, 33), 12);
    expect(fCdfUpper(0.5, 2, 7)).toBeCloseTo(closed(0.5, 7), 12);
  });

  it('fCdfUpper is monotone decreasing in f', () => {
    let prev = 1;
    for (const f of [0.1, 0.5, 1, 2, 5, 10, 50]) {
      const p = fCdfUpper(f, 3, 20);
      expect(p).toBeLessThan(prev);
      prev = p;
    }
  });

  it('fCdfUpper degrades to 1 rather than NaN', () => {
    expect(fCdfUpper(0, 2, 10)).toBe(1);
    expect(fCdfUpper(-1, 2, 10)).toBe(1);
    expect(fCdfUpper(5, 2, 0)).toBe(1);
    expect(fCdfUpper(Number.NaN, 2, 10)).toBe(1);
    // An exact nonconstant fit has infinite F and a zero upper tail.
    expect(fCdfUpper(Number.POSITIVE_INFINITY, 2, 10)).toBe(0);
  });

  it('normalSf matches the standard normal tail', () => {
    expect(normalSf(0)).toBeCloseTo(0.5, 6);
    expect(normalSf(1.959964)).toBeCloseTo(0.025, 5);
    expect(normalSf(-1.959964)).toBeCloseTo(0.975, 5);
  });

  it('kendallExactP is a valid two-sided tail', () => {
    // Perfect concordance of n=5: S = 10, p = 2/120 = 0.01667.
    expect(kendallExactP(10, 5)).toBeCloseTo(2 / 120, 8);
    // Perfect concordance of n=4: S = 6, p = 2/24 = 0.08333.
    expect(kendallExactP(6, 4)).toBeCloseTo(2 / 24, 8);
    // S = 0 is the centre of the distribution: p = 1.
    expect(kendallExactP(0, 5)).toBeCloseTo(1, 6);
    // Above the DP ceiling the caller is told to use the approximation instead.
    expect(kendallExactP(10, 40)).toBeNull();
  });
});

describe('cosinor', () => {
  it('recovers mesor, amplitude and acrophase from a noiseless cosine', () => {
    const r = cosinor(cosineSeries(6, 2, 10), { periods: DEFAULT_PERIODS });
    expect(r).not.toBeNull();
    expect(r?.mesor).toBeCloseTo(10, 6);
    expect(r?.amplitude).toBeCloseTo(2, 6);
    expect(r?.acrophase).toBeCloseTo(6, 6);
    expect(r?.period).toBe(24);
    expect(r?.p).toBeLessThan(1e-12);
  });

  it('recovers an acrophase near the wrap point without going negative', () => {
    const r = cosinor(cosineSeries(23, 2, 10), { periods: DEFAULT_PERIODS });
    expect(r?.acrophase).toBeGreaterThanOrEqual(0);
    expect(r?.acrophase).toBeLessThan(24);
    expect(r?.acrophase).toBeCloseTo(23, 6);
  });

  it('reports no rhythm for a flat series', () => {
    const times = [0, 4, 8, 12, 16, 20];
    const r = cosinor({ times, values: times.map(() => 7) }, { periods: DEFAULT_PERIODS });
    expect(r?.p).toBe(1);
    expect(r?.stat).toBe(0);
  });

  it('finds the right period when scanning', () => {
    // A 20 h rhythm sampled every 2 h; the scan should prefer 20 over 24.
    const times: number[] = [];
    const values: number[] = [];
    for (let t = 0; t < 60; t += 2) {
      times.push(t);
      values.push(5 + Math.cos((2 * Math.PI * t) / 20));
    }
    const r = cosinor({ times, values }, { periods: SCAN_PERIODS });
    expect(r?.period).toBeCloseTo(20, 6);
    // Repeating a hypothesis or inserting invalid periods must not charge
    // another search test or change the fitted result.
    expect(cosinor({ times, values }, { periods: [20, 20, 0, -1, Number.NaN] }))
      .toEqual(cosinor({ times, values }, { periods: [20] }));
  });

  it('returns null below the minimum design', () => {
    expect(cosinor({ times: [0, 12], values: [1, 2] }, { periods: DEFAULT_PERIODS })).toBeNull();
    // 3 timepoints but only 3 observations: no residual df.
    expect(cosinor({ times: [0, 8, 16], values: [1, 2, 3] }, { periods: DEFAULT_PERIODS })).toBeNull();
  });
});

describe('jtkCycle', () => {
  it('detects a clean rhythm and places its peak', () => {
    const r = jtkCycle(cosineSeries(6, 2, 10), { periods: DEFAULT_PERIODS });
    expect(r).not.toBeNull();
    expect(r?.p).toBeLessThan(0.01);
    // Canonical JTK reports |S| relative to the grouped design's maximum;
    // independent R reference fixtures additionally pin its p-value, phase
    // and amplitude on replicated/tied designs.
    expect(r?.stat).toBeGreaterThan(0.7);
    // Canonical half-interval phases include 6 h on this 4-hour sampling grid.
    expect(Math.abs((r?.acrophase ?? 0) - 6)).toBeLessThanOrEqual(2);
  });

  it('is unmoved by an outlier that drags the cosinor fit', () => {
    const clean = cosineSeries(6, 2, 10);
    const spiked = { times: [...clean.times], values: [...clean.values] };
    spiked.values[0] = 500;
    const jtkClean = jtkCycle(clean, { periods: DEFAULT_PERIODS });
    const jtkSpiked = jtkCycle(spiked, { periods: DEFAULT_PERIODS });
    const cosClean = cosinor(clean, { periods: DEFAULT_PERIODS });
    const cosSpiked = cosinor(spiked, { periods: DEFAULT_PERIODS });
    // JTK barely notices; the parametric fit loses its rhythm entirely.
    expect(jtkSpiked?.stat).toBeGreaterThan((jtkClean?.stat ?? 1) * 0.8);
    expect(cosSpiked?.p).toBeGreaterThan(0.05);
    expect(cosClean?.p).toBeLessThan(1e-12);
  });

  it('reports a p of 1 (post-Bonferroni) for a monotone ramp', () => {
    const times = [0, 4, 8, 12, 16, 20];
    const r = jtkCycle({ times, values: [1, 2, 3, 4, 5, 6] }, { periods: DEFAULT_PERIODS });
    // A ramp correlates with a cosine at some lag, but never strongly enough to
    // survive the phase-grid Bonferroni.
    expect(r?.p).toBeGreaterThan(0.05);
  });

  it('never returns a p above 1 after the grid correction', () => {
    const r = jtkCycle(cosineSeries(6, 0.001, 10, 5), { periods: SCAN_PERIODS });
    expect(r?.p).toBeLessThanOrEqual(1);
    expect(r?.p).toBeGreaterThan(0);
  });
});

describe('lombScargle', () => {
  it('detects a rhythm in an unevenly sampled series', () => {
    // Deliberately irregular sampling — the case Lomb-Scargle exists for.
    const times = [0, 3, 5, 11, 14, 19, 25, 27, 33, 38, 44, 47];
    const values = times.map((t) => 10 + 2 * Math.cos((2 * Math.PI * (t - 6)) / 24));
    const r = lombScargle({ times, values }, { periods: SCAN_PERIODS });
    expect(r).not.toBeNull();
    expect(r?.period).toBeCloseTo(24, 1);
    expect(r?.acrophase).toBeCloseTo(6, 1);
    expect(r?.p).toBeLessThan(0.05);
  });

  it('cannot beat the (N-1)/2 power ceiling on a short series', () => {
    // A property worth pinning because it reads as a bug from the UI: the
    // normalized periodogram divides by the data's own variance, so a PERFECT
    // sinusoid maxes out at P=(N-1)/2 no matter how clean it is. At N=12 that
    // caps the achievable p at ~0.032 — Lomb-Scargle simply cannot report a
    // small p on a 12-point series, which is why the tab warns when a series is
    // short rather than letting a user read the ceiling as "not rhythmic".
    const times = [0, 3, 5, 11, 14, 19, 25, 27, 33, 38, 44, 47];
    const perfect = times.map((t) => 10 + 2 * Math.cos((2 * Math.PI * (t - 6)) / 24));
    const r = lombScargle({ times, values: perfect }, { periods: SCAN_PERIODS });
    expect(r?.stat).toBeLessThanOrEqual((times.length - 1) / 2 + 1e-9);
    expect(r?.p).toBeGreaterThan(0.01);

    // The same waveform sampled 36 times clears it by five orders of magnitude.
    const dense: number[] = [];
    const denseVals: number[] = [];
    for (let t = 0; t < 48; t += 4) {
      for (let rep = 0; rep < 3; rep++) {
        dense.push(t);
        denseVals.push(10 + 2 * Math.cos((2 * Math.PI * (t - 6)) / 24));
      }
    }
    const dr = lombScargle({ times: dense, values: denseVals }, { periods: DEFAULT_PERIODS });
    expect(dr?.p).toBeLessThan(1e-6);
  });

  it('reports a high p for a flat-but-noisy series', () => {
    const times = [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44];
    // Alternating values: high variance, no 24 h structure.
    const values = times.map((_, i) => (i % 2 === 0 ? 9 : 11));
    const r = lombScargle({ times, values }, { periods: DEFAULT_PERIODS });
    expect(r?.p).toBeGreaterThan(0.05);
  });

  it('returns null when a series has no variance', () => {
    const times = [0, 6, 12, 18];
    expect(lombScargle({ times, values: [5, 5, 5, 5] }, { periods: DEFAULT_PERIODS })).toBeNull();
  });
});

describe('cross-method agreement', () => {
  it('all three place the same acrophase on the same clean rhythm', () => {
    const series = cosineSeries(14, 3, 20, 0.05);
    const results = (['jtk', 'cosinor', 'ls'] as const)
      .map((m) => runRhythmicity(m, series, { periods: DEFAULT_PERIODS }));
    for (const r of results) {
      expect(r).not.toBeNull();
      expect(r?.p).toBeLessThan(0.01);
      // Canonical JTK uses half-interval phases; numerical ties can share peaks.
      expect(Math.abs((r?.acrophase ?? 0) - 14)).toBeLessThanOrEqual(2);
    }
  });

  it('all three drop non-finite observations rather than propagating NaN', () => {
    const series = cosineSeries(6);
    series.values[3] = Number.NaN;
    for (const m of ['jtk', 'cosinor', 'ls'] as const) {
      const r = runRhythmicity(m, series, { periods: DEFAULT_PERIODS });
      expect(Number.isFinite(r?.p)).toBe(true);
      expect(r?.n).toBe(series.values.length - 1);
    }
  });
});

describe('fittedCurve', () => {
  it('traces the fitted cosine through its own peak', () => {
    const pts = fittedCurve({ mesor: 10, amplitude: 2, acrophase: 6, period: 24 }, 0, 24, 240);
    const peak = pts.reduce((a, b) => (b.y > a.y ? b : a));
    expect(peak.t).toBeCloseTo(6, 1);
    expect(peak.y).toBeCloseTo(12, 3);
  });
});

describe('adjustPValues', () => {
  const p = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216];

  it('bonferroni multiplies by the test count and clamps at 1', () => {
    const q = adjustPValues(p, 'bonferroni');
    expect(q[0]).toBeCloseTo(0.01, 10);
    expect(q[9]).toBe(1);
  });

  it('holm matches R p.adjust(method="holm")', () => {
    const q = adjustPValues(p, 'holm') as number[];
    // R: p.adjust(p, "holm")[1:5] = 0.010 0.072 0.312 0.312 0.312
    expect(q[0]).toBeCloseTo(0.01, 6);
    expect(q[1]).toBeCloseTo(0.072, 6);
    expect(q[2]).toBeCloseTo(0.312, 6);
    expect(q[3]).toBeCloseTo(0.312, 6);
    expect(q[4]).toBeCloseTo(0.312, 6);
  });

  it('holm is monotone and never below the raw p', () => {
    const q = adjustPValues(p, 'holm') as number[];
    for (let i = 1; i < q.length; i++) expect(q[i]).toBeGreaterThanOrEqual(q[i - 1]);
    p.forEach((raw, i) => { expect(q[i]).toBeGreaterThanOrEqual(raw); });
  });

  it('by is uniformly stricter than bh', () => {
    const bh = adjustPValues(p, 'bh') as number[];
    const by = adjustPValues(p, 'by') as number[];
    by.forEach((v, i) => { expect(v).toBeGreaterThanOrEqual(bh[i] - 1e-12); });
  });

  it('none passes p through unchanged', () => {
    expect(adjustPValues(p, 'none')).toEqual(p);
  });

  it('excludes untested genes from the test count', () => {
    const withGaps = [0.01, null, 0.02, null];
    const q = adjustPValues(withGaps, 'bonferroni');
    // m = 2, not 4.
    expect(q[0]).toBeCloseTo(0.02, 10);
    expect(q[1]).toBeNull();
    expect(q[3]).toBeNull();
  });

  it('handles an empty input', () => {
    expect(adjustPValues([], 'bh')).toEqual([]);
  });
});
