import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RhythmTrace, markerShapeFor, yDomain, yTickLabels, yTickValues } from '../circadian/RhythmTrace';
import { DEFAULT_PERIODS, type RhythmResult, runRhythmicity } from '../circadian/rhythmicity';
import { seriesFor, summarizeGene } from '../circadian/timeSeriesSource';
import type { TimeSeriesBundle } from '../types';

const times = [0, 4, 8, 12, 16, 20];

function bundle(): TimeSeriesBundle {
  const arms = [
    { key: 'chow', label: 'Chow', color: '#4C78A8' },
    { key: 'hfd', label: 'HFD', color: '#E45756' },
    { key: 'ko', label: 'Knockout', color: '#59A14F' },
  ];
  const samples = arms.flatMap((arm) => times.flatMap((time) => [1, 2].map((replicate) => ({
    id: `${arm.key}-${time}-${replicate}`, arm: arm.key, time, replicate,
  }))));
  // Chow peaks at CT8, HFD at CT16, knockout is flat.
  const value = (arm: string, t: number, r: number) => {
    if (arm === 'ko') return 5 + r * 0.01;
    const peak = arm === 'chow' ? 8 : 16;
    return 5 + Math.cos(((t - peak) / 24) * 2 * Math.PI) + r * 0.05;
  };
  return {
    meta: {
      trackId: 'scn', label: 'Trace fixture', cycleHours: 24, timeUnit: 'CT', expressionUnit: 'log2(FPKM + 1)',
      arms, samples, timepoints: times, nGenes: 1,
    },
    values: { Per2: samples.map((s) => value(s.arm, s.time, s.replicate)) },
  };
}

const fit: RhythmResult = {
  method: 'cosinor', p: 0.001, period: 24, acrophase: 8.04, amplitude: 1, mesor: 5.07, stat: 30, n: 12, nTimepoints: 6,
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('RhythmTrace', () => {
  it('assigns arms circle, square, triangle, then diamond, and repeats', () => {
    expect([0, 1, 2, 3, 4].map(markerShapeFor)).toEqual(['circle', 'square', 'triangle', 'diamond', 'circle']);
  });

  it('draws each arm with its own marker shape, and the legend repeats that shape', () => {
    const { container } = render(<RhythmTrace bundle={bundle()} gene="Per2" />);
    const expected = { chow: 'circle', hfd: 'square', ko: 'triangle' } as const;
    for (const [arm, shape] of Object.entries(expected)) {
      const marks = container.querySelectorAll(`[data-arm="${arm}"] [data-shape]`);
      // 6 timepoints × (2 replicates + 1 mean)
      expect(marks).toHaveLength(18);
      expect([...marks].every((m) => m.getAttribute('data-shape') === shape)).toBe(true);
      const legend = container.querySelector(`[data-legend-arm="${arm}"]`);
      expect(legend?.querySelector('[data-shape]')?.getAttribute('data-shape')).toBe(shape);
    }
  });

  it('keeps an arm\'s shape when other arms are hidden', () => {
    const { container } = render(<RhythmTrace bundle={bundle()} gene="Per2" visibleArms={['hfd']} />);
    expect(container.querySelector('[data-legend-arm="chow"]')).toBeNull();
    expect(container.querySelector('[data-legend-arm="hfd"] [data-shape]')?.getAttribute('data-shape')).toBe('square');
  });

  it('summarises gene, arms, shapes and peaks in the figure\'s accessible name', () => {
    render(<RhythmTrace bundle={bundle()} gene="Per2" fits={{ chow: fit, hfd: null }} />);
    const name = screen.getByRole('img').getAttribute('aria-label') ?? '';
    expect(name).toMatch(/^Per2 expression \(log2\(FPKM \+ 1\)\) across circadian time\./);
    expect(name).toContain('Chow (circles): highest mean');
    expect(name).toContain('at CT8, fitted peak CT8.0 (period 24 h)');
    expect(name).toContain('HFD (squares): highest mean');
    expect(name).toContain('at CT16');
    expect(name).toContain('Knockout (triangles)');
  });

  it('uses the theme ink rather than a hard-coded near-black', () => {
    const { container } = render(<RhythmTrace bundle={bundle()} gene="Per2" />);
    expect(container.innerHTML).not.toMatch(/#1A1A1A/i);
    expect(container.querySelector('line[stroke="var(--text-primary)"]')).not.toBeNull();
  });

  it('switches to a taller, pixel-scale layout in a phone-width container', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 343, height: 0, top: 0, left: 0, right: 343, bottom: 0, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    const { container } = render(<RhythmTrace bundle={bundle()} gene="Per2" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('data-layout')).toBe('compact');
    const [, , w, h] = (svg?.getAttribute('viewBox') ?? '').split(' ').map(Number);
    expect(w).toBe(343);
    expect(h / w).toBeGreaterThan(0.85);
    // Text is drawn at 1:1 scale, so no axis label renders below 11px.
    const sizes = [...container.querySelectorAll('text')].map((t) => Number(t.getAttribute('font-size')));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(11);
  });

  it('keeps the wide layout when the container is wide or not yet measured', () => {
    const { container } = render(<RhythmTrace bundle={bundle()} gene="Per2" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('data-layout')).toBe('wide');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 760 320');
  });
});

describe('RhythmTrace without an estimable peak', () => {
  // A failed Lomb–Scargle cosine fit: the requested period, amplitude 0, acrophase 0.
  const failed: RhythmResult = {
    method: 'ls', p: 0.002, period: 24, acrophase: 0, amplitude: 0, mesor: 5, stat: 12, n: 12, nTimepoints: 6,
  };

  it('announces no estimable fitted peak rather than a peak at CT0', () => {
    render(<RhythmTrace bundle={bundle()} gene="Per2" fits={{ chow: failed }} />);
    const name = screen.getByRole('img').getAttribute('aria-label') ?? '';
    expect(name).toContain('Chow (circles): highest mean');
    expect(name).toContain('no estimable fitted peak');
    expect(name).not.toMatch(/fitted peak CT0/);
  });

  it('draws no fitted curve and no legend peak time', () => {
    const { container } = render(<RhythmTrace bundle={bundle()} gene="Per2" fits={{ chow: failed, hfd: fit }} />);
    expect(container.querySelector('[data-arm="chow"] path[stroke-dasharray]')).toBeNull();
    expect(container.querySelector('[data-arm="hfd"] path[stroke-dasharray]')).not.toBeNull();
    const legend = container.querySelector('[data-legend-arm="chow"]');
    expect(legend?.textContent).toBe('Chow · peak —');
    expect(legend?.querySelector('line')?.getAttribute('stroke-dasharray')).toBeNull();
  });
});

describe('RhythmTrace hover read-out', () => {
  function twoGenes(): TimeSeriesBundle {
    const b = bundle();
    return {
      ...b,
      values: {
        GeneA: b.meta.samples.map(() => 7.25),
        GeneB: b.meta.samples.map(() => 3.5),
      },
    };
  }
  const firstReplicate = (container: HTMLElement) => {
    const mark = container.querySelector('[data-arm="chow"] [data-shape]');
    if (!mark) throw new Error('no mark');
    return mark;
  };

  it('drops a hover from the previous gene when the selection changes from the keyboard', () => {
    const b = twoGenes();
    const { container, rerender } = render(<RhythmTrace bundle={b} gene="GeneA" />);
    fireEvent.mouseEnter(firstReplicate(container));
    expect(screen.getByTestId('trace-hover').textContent).toContain('7.25');

    // GeneB arrives with no mouse movement (arrow key in the results table).
    rerender(<RhythmTrace bundle={b} gene="GeneB" />);
    expect(screen.queryByTestId('trace-hover')).toBeNull();
    expect(container.textContent).not.toContain('7.25');

    fireEvent.mouseEnter(firstReplicate(container));
    expect(screen.getByTestId('trace-hover').textContent).toContain('3.50');
  });

  it('drops a hover when the bundle changes under the same gene', () => {
    const b = twoGenes();
    const { container, rerender } = render(<RhythmTrace bundle={b} gene="GeneA" />);
    fireEvent.mouseEnter(firstReplicate(container));
    expect(screen.getByTestId('trace-hover')).toBeInTheDocument();
    rerender(<RhythmTrace bundle={{ ...b, values: { GeneA: b.meta.samples.map(() => 9) } }} gene="GeneA" />);
    expect(screen.queryByTestId('trace-hover')).toBeNull();
  });
});

describe('RhythmTrace y-axis labels', () => {
  it('chooses enough precision that adjacent ticks differ', () => {
    expect(yTickLabels([0.99998, 1, 1.00002], 0.00002)).toEqual(['0.99998', '1.00000', '1.00002']);
    expect(yTickLabels([5, 5.05, 5.1], 0.05)).toEqual(['5.00', '5.05', '5.10']);
    expect(yTickLabels([0, 2.5, 5], 2.5)).toEqual(['0.0', '2.5', '5.0']);
  });

  it('falls back to scientific notation when fixed decimals would run long', () => {
    const labels = yTickLabels([1, 1 + 2e-9, 1 + 4e-9], 2e-9);
    expect(new Set(labels).size).toBe(3);
    expect(labels.every((l) => l.includes('e'))).toBe(true);
  });

  it('never prints the same tick label twice for a near-flat series (1 ± 0.00002)', () => {
    const b = bundle();
    const flat: TimeSeriesBundle = {
      ...b,
      values: { Flat: b.meta.samples.map((s) => 1 + 0.00002 * Math.cos((s.time / 24) * 2 * Math.PI)) },
    };
    const { container } = render(<RhythmTrace bundle={flat} gene="Flat" />);
    const labels = [...container.querySelectorAll('[data-y-tick] text')].map((t) => t.textContent);
    expect(labels.length).toBeGreaterThan(1);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('RhythmTrace with a constant-expression gene', () => {
  // The reviewer's scenario: six timepoints × three replicates, every value 0.1.
  // Mean and SEM of three 0.1s carry float error, so the data span
  // 0.1 .. 0.10000000000000003; the old tick loop then took a 1e-17 step from
  // index 1e16, where k + 1 === k, and pushed the same tick forever.
  function constantBundle(value: number, replicates: number): TimeSeriesBundle {
    const arms = [{ key: 'wt', label: 'Wild type', color: '#4C78A8' }];
    const samples = times.flatMap((time) => Array.from({ length: replicates }, (_, r) => ({
      id: `wt-${time}-${r + 1}`, arm: 'wt', time, replicate: r + 1,
    })));
    return {
      meta: {
        trackId: 'scn', label: 'Constant fixture', cycleHours: 24, timeUnit: 'ZT', expressionUnit: 'log2(CPM + 1)',
        arms, samples, timepoints: times, nGenes: 1,
      },
      values: { Flat: samples.map(() => value) },
    };
  }

  const yLabelsOf = (container: HTMLElement) =>
    [...container.querySelectorAll('[data-y-tick] text')].map((t) => t.textContent ?? '');
  const expectFiniteDistinct = (labels: string[]) => {
    expect(labels.length).toBeGreaterThan(1);
    expect(labels.length).toBeLessThanOrEqual(20);
    expect(labels.every((l) => Number.isFinite(Number(l)))).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  };

  it('reproduces the float error that froze the old tick loop', () => {
    const [arm] = summarizeGene(constantBundle(0.1, 3), 'Flat');
    const tp = arm.timepoints[0];
    expect(tp.mean).not.toBe(0.1);
    expect(tp.mean + tp.sem).toBeGreaterThan(0.1);
  });

  it('renders six timepoints × three replicates of 0.1 with finite, distinct y labels', () => {
    const b = constantBundle(0.1, 3);
    const series = seriesFor(b, 'Flat', 'wt');
    // Real estimator output for the constant series, overlaid as the tab would.
    for (const method of ['cosinor', 'jtk', 'ls'] as const) {
      const fit = runRhythmicity(method, series, { periods: DEFAULT_PERIODS });
      cleanup();
      const { container } = render(<RhythmTrace bundle={b} gene="Flat" fits={{ wt: fit }} doublePlot />);
      const labels = yLabelsOf(container);
      expectFiniteDistinct(labels);
      // The constant value sits inside the axis.
      const values = labels.map(Number);
      expect(Math.min(...values)).toBeLessThanOrEqual(0.1);
      expect(Math.max(...values)).toBeGreaterThanOrEqual(0.1);
    }
  });

  it('renders a gene that is 0 in every library on a 0 .. 1 axis', () => {
    const { container } = render(<RhythmTrace bundle={constantBundle(0, 3)} gene="Flat" />);
    const labels = yLabelsOf(container);
    expectFiniteDistinct(labels);
    expect(labels[0]).toMatch(/^0(\.0+)?$/);
    expect(Number(labels[labels.length - 1])).toBe(1);
  });

  it('renders a constant gene with one library per timepoint', () => {
    const b = constantBundle(0.1, 1);
    const { container } = render(<RhythmTrace bundle={b} gene="Flat" />);
    expectFiniteDistinct(yLabelsOf(container));
    // No replicates, so no SEM whiskers; one mark per timepoint plus its mean.
    expect(container.querySelectorAll('[data-arm="wt"] [data-shape]')).toHaveLength(times.length * 2);
  });
});

describe('y domain and ticks', () => {
  it('widens an effectively flat range symmetrically about its value', () => {
    expect(yDomain(0.1, 0.10000000000000003)).toEqual({ yMin: expect.closeTo(0.095, 12), yMax: expect.closeTo(0.105, 12) });
    expect(yDomain(0, 0)).toEqual({ yMin: 0, yMax: 1 });
    expect(yDomain(-2, -2)).toEqual({ yMin: -2.1, yMax: -1.9 });
    expect(yDomain(1e6, 1e6 + 1e-4)).toEqual({ yMin: expect.closeTo(0.95e6, 3), yMax: expect.closeTo(1.05e6, 3) });
  });

  it('keeps padding a range that is narrow but genuinely not flat', () => {
    const { yMin, yMax } = yDomain(0.99998, 1.00002);
    expect(yMin).toBeCloseTo(0.9999752, 9);
    expect(yMax).toBeCloseTo(1.0000248, 9);
  });

  it('never returns more than twenty ticks or a repeated tick, whatever the domain', () => {
    const domains: Array<[number, number]> = [
      [0.1, 0.10000000000000003], // the unexpanded reviewer range
      [1e16, 1e16 + 2],
      [0, Number.MIN_VALUE],
      [0, 1],
      [5, 5],
    ];
    for (const [lo, hi] of domains) {
      const { ticks } = yTickValues(lo, hi);
      expect(ticks.length).toBeLessThanOrEqual(20);
      expect(ticks.every((t, i) => Number.isFinite(t) && (i === 0 || t > ticks[i - 1]))).toBe(true);
    }
  });
});
