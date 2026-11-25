import { describe, expect, it } from 'vitest';
import { armLombScargleFloor, lombScargleFloor } from '../circadian/lombScargleFloor';
import { runRhythmicity, SCAN_PERIODS } from '../circadian/rhythmicity';
import type { RhythmRow, ScanState } from '../circadian/scan';
import { seriesFor } from '../circadian/timeSeriesSource';
import type { TimeSeriesBundle } from '../types';

// When the Circadian notes may state a Lomb–Scargle floor. A wrong floor reads
// as "no gene can pass", so the preconditions and both checks behind it are
// pinned here directly rather than only through renders of the whole tab.

/** One arm, `a`, sampled at `times`, with the given genes. */
function bundleOf(times: number[], values: Record<string, Array<number | null>>): TimeSeriesBundle {
  return {
    meta: {
      trackId: 't', label: 'Test', cycleHours: 24, timeUnit: 'CT', expressionUnit: 'CPM',
      arms: [{ key: 'a', label: 'A', color: '#3775BA' }],
      samples: times.map((time, i) => ({ id: `s${i}`, arm: 'a', time, replicate: 1 })),
      timepoints: [...new Set(times)],
      nGenes: Object.keys(values).length,
    },
    values,
  };
}

/** A finished scan of arm `a`, scored by lombScargle as the scan would score it. */
function scanned(bundle: TimeSeriesBundle, periods: readonly number[]): ScanState {
  const rows: RhythmRow[] = [];
  for (const gene of Object.keys(bundle.values)) {
    const result = runRhythmicity('ls', seriesFor(bundle, gene, 'a'), { periods: [...periods] });
    if (result) rows.push({ ...result, gene, q: result.p });
  }
  return { rows, running: false, tested: rows.length, total: Object.keys(bundle.values).length };
}

const floorOf = (bundle: TimeSeriesBundle, periods: readonly number[], state = scanned(bundle, periods)) =>
  armLombScargleFloor({ method: 'ls', state, bundle, arm: 'a', periods });

const SPREAD = [0, 0, 8, 8, 16, 16];
const WAVE = [2, 2, 1, 1, 0, 0];

describe('lombScargleFloor', () => {
  it('gives the floor for a series length and period grid', () => {
    expect(lombScargleFloor(6, 1)).toBeCloseTo(0.0821, 4);
    expect(lombScargleFloor(7, 1)).toBeCloseTo(0.0498, 4);
  });

  it('agrees with the count the tab used to spell differently (n ** 2, no `|| 1`)', () => {
    const before = (n: number, nPeriods: number) =>
      1 - (1 - Math.exp(-(n - 1) / 2)) ** Math.max(1, Math.min(nPeriods, Math.round(-6.362 + 1.193 * n + 0.00098 * n ** 2)));
    for (let n = 1; n <= 5000; n++) {
      for (const nPeriods of [1, SCAN_PERIODS.length]) expect(lombScargleFloor(n, nPeriods)).toBe(before(n, nPeriods));
    }
  });
});

describe('armLombScargleFloor', () => {
  const bundle = bundleOf(SPREAD, { Wave: WAVE });
  const periods = [24];

  it('states the floor of a finished Lomb–Scargle scan', () => {
    expect(floorOf(bundle, periods)).toEqual({ n: 6, floor: lombScargleFloor(6, 1) });
  });

  it('states nothing for another test, an unscanned arm, a running scan or no scored gene', () => {
    const done = scanned(bundle, periods);
    const at = (method: 'ls' | 'cosinor' | 'jtk', state: ScanState | undefined) =>
      armLombScargleFloor({ method, state, bundle, arm: 'a', periods });
    expect(at('cosinor', done)).toBeNull();
    expect(at('jtk', done)).toBeNull();
    expect(at('ls', undefined)).toBeNull();
    // A rescan reports its new request as running with no rows yet.
    expect(at('ls', { ...done, running: true })).toBeNull();
    expect(at('ls', { ...done, rows: [], tested: 0 })).toBeNull();
    expect(armLombScargleFloor({ method: 'ls', state: done, bundle, arm: '', periods })).toBeNull();
  });

  it('states nothing when a gene\'s own observed times break the power cap', () => {
    // At 24 h, times 0, 12 and 24 h put every sine on zero: the shifted sine
    // column vanishes and the computed power is a ratio of rounding errors.
    const times = [0, 0, 6, 12, 12, 18, 24, 24];
    const complete = bundleOf(times, { Full: [3, 3, 1, 2, 2, 0, 3, 3] });
    expect(floorOf(complete, periods)).not.toBeNull();
    // The same schedule with a gene missing the 6 h and 18 h libraries.
    const gappy = bundleOf(times, { Full: [3, 3, 1, 2, 2, 0, 3, 3], Gappy: [3, 3, null, 2, 2, null, 3, 3] });
    expect(scanned(gappy, periods).rows.map((r) => r.gene)).toContain('Gappy');
    expect(floorOf(gappy, periods)).toBeNull();
  });

  it('states nothing when an observed p falls below the floor, though the cap check passes (large time origin)', () => {
    // Codex's counterexample: at origin 1e8 + 3 rounding lets the power exceed
    // the (n − 1)/2 cap, so p falls below the floor the cap would imply. The
    // observed-p guard is what catches it.
    const far = bundleOf(SPREAD.map((t) => t + 100000003), { Wave: WAVE });
    const [row] = scanned(far, periods).rows;
    expect(row.p).toBeLessThan(lombScargleFloor(6, 1) * (1 - 1e-9));
    expect(floorOf(far, periods)).toBeNull();
    for (const origin of [0, 1e3, 1e6]) {
      expect(floorOf(bundleOf(SPREAD.map((t) => t + origin), { Wave: WAVE }), periods)).not.toBeNull();
    }
  });

  it('takes the smallest floor over the series lengths the genes were tested at', () => {
    const times = [0, 0, 4, 8, 8, 12, 16, 16, 20];
    const values = { Full: [5, 5, 4, 2, 2, 1, 2, 2, 4], Short: [5, 5, null, 2, 2, 1, 2, null, 4] };
    const both = bundleOf(times, values);
    const lengths = scanned(both, SCAN_PERIODS).rows.map((r) => r.n).sort();
    expect(lengths).toEqual([7, 9]);
    const result = floorOf(both, SCAN_PERIODS);
    const expected = Math.min(lombScargleFloor(7, SCAN_PERIODS.length), lombScargleFloor(9, SCAN_PERIODS.length));
    expect(result?.floor).toBe(expected);
  });

  it('only ever states a floor every scored p respects (random designs, registered time ranges)', () => {
    let seed = 7;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    let stated = 0;
    for (let trial = 0; trial < 200; trial++) {
      const n = 6 + Math.floor(random() * 10);
      const origin = random() * 48;
      const times = Array.from({ length: n }, () => origin + Math.round(random() * 48));
      const genes: Record<string, number[]> = {};
      for (let g = 0; g < 3; g++) genes[`g${g}`] = times.map(() => random() * 10);
      const bundle = bundleOf(times, genes);
      for (const grid of [[24], SCAN_PERIODS]) {
        const state = scanned(bundle, grid);
        const result = floorOf(bundle, grid, state);
        if (!result) continue;
        stated++;
        for (const row of state.rows) expect(row.p).toBeGreaterThanOrEqual(result.floor * (1 - 1e-9));
      }
    }
    // The property is not vacuous: most random designs do state a floor.
    expect(stated).toBeGreaterThan(100);
  });
});
