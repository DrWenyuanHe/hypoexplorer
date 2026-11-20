import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircadianTab } from '../circadian/CircadianTab';
import { useArmScans } from '../circadian/scan';
import { DEFAULT_PERIODS, SCAN_PERIODS, cosinor, jtkCycle, lombScargle } from '../circadian/rhythmicity';
import { exportResultsCSV } from '../circadian/circadianExport';
import { fmtP } from '../utils/format';
import { _resetBundleCache, _setBundleTransport } from '../data/bundleSource';
import { defineDataset } from '../data/datasets';
import type { TimeSeriesBundle } from '../types';

// The comparison layer of the Circadian tab: the selected gene survives a
// change of arm, test or period; every arm is scanned under the same settings
// so the counts compare like with like; and the per-arm strip under the trace
// reports each arm's own single-gene test with that arm's own gene-wise q.

vi.mock('../circadian/circadianExport', () => ({
  exportResultsCSV: vi.fn(), exportRawCSV: vi.fn(), exportWorkbook: vi.fn().mockResolvedValue(undefined),
}));
// Every gene the trace is asked to draw, in order, including renders an effect
// would immediately replace.
const traced = vi.hoisted(() => ({ genes: [] as string[] }));
vi.mock('../circadian/RhythmTrace', () => ({
  RhythmTrace: ({ gene }: { gene: string }) => { traced.genes.push(gene); return <div data-testid="trace">{gene}</div>; },
}));
vi.mock('../circadian/PhaseMap', () => ({
  PhaseMap: ({ color, acrophases }: { color?: string; acrophases: number[] }) => (
    <div data-testid="phase-map" data-color={color} data-count={acrophases.length} data-peaks={acrophases.join(',')} />
  ),
}));
// The real results table, wrapped to count its renders.
const tableRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('../circadian/CircadianResultsTable', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../circadian/CircadianResultsTable')>();
  const Real = actual.CircadianResultsTable;
  return {
    ...actual,
    CircadianResultsTable: (props: Parameters<typeof Real>[0]) => { tableRenders.count++; return <Real {...props} />; },
  };
});

const TIMES = [0, 4, 8, 12, 16, 20];
const wave = (amp: number, phase: number, base = 10) =>
  TIMES.flatMap((t) => [base + amp * Math.cos((2 * Math.PI * (t - phase)) / 24) + 0.05,
    base + amp * Math.cos((2 * Math.PI * (t - phase)) / 24) - 0.05]);
// Deterministic, arrhythmic values around a constant.
const flat = (seed: number) => TIMES.flatMap((_, i) => [10 + (((i + seed) * 7) % 5) * 0.01, 10 - (((i + seed) * 3) % 5) * 0.01]);

function fixture(times = TIMES, extra: Record<string, Array<number | null>> = {}): TimeSeriesBundle {
  const samples = ['control', 'hfd'].flatMap((arm) => times.flatMap((time) => [1, 2].map((replicate) => ({
    id: `${arm}_${time}_${replicate}`, arm, time, replicate,
  }))));
  const both = (control: number[], hfd: Array<number | null>) => [...control, ...hfd];
  return {
    meta: {
      trackId: 'scn', label: 'Comparison fixture', cycleHours: 24, timeUnit: 'ZT', expressionUnit: 'CPM',
      arms: [{ key: 'control', label: 'Chow', color: '#4C78A8' }, { key: 'hfd', label: 'High-fat diet', color: '#E45756' }],
      samples, timepoints: times, nGenes: 4,
    },
    values: {
      Strong: both(wave(5, 4), flat(1)),
      Middle: both(wave(3, 10), wave(3, 10)),
      // Scored in Chow only: every high-fat-diet library is missing.
      ChowOnly: both(wave(1, 16), TIMES.flatMap(() => [null, null])),
      Flat: both(flat(2), flat(3)),
      ...extra,
    },
  };
}

/** The comparison fixture with every gene replaced by `n` rhythmic genes: several JTK chunks per arm. */
function manyGenes(n: number): TimeSeriesBundle {
  const base = fixture();
  const values: Record<string, Array<number | null>> = {};
  for (let g = 0; g < n; g++) values[`G${g}`] = [...wave(1 + (g % 5), g % 24), ...wave(0.5 + (g % 3), (g * 5) % 24)];
  return { ...base, meta: { ...base.meta, nGenes: n }, values };
}

const dataset = defineDataset({ id: 'comparison_timecourse', category: 'Circadian', name: 'Comparison fixture',
  organism: 'Mus musculus', modality: 'bulk RNA-seq', region: 'Suprachiasmatic nucleus', perturbation: 'Diet & obesity', preparation: 'Bulk tissue',
  citation: '', doi: '', pmid: '', geo: '', bundleBaseUrl: '/datasets/comparison_timecourse',
  defaultTrack: 'scn', featureType: 'gene', featureLabel: 'Gene', supportsPathways: false,
  isDefault: false, trackCategoryOrder: ['Tissue'],
  groups: [{ key: 'control', label: 'Chow', color: '#4C78A8' }, { key: 'hfd', label: 'High-fat diet', color: '#E45756' }],
  contrasts: [],
  timeSeries: { tracks: ['scn'], cycleHours: 24, timeUnit: 'ZT', design: 'Synthetic two-arm fixture' } });

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); _resetBundleCache(); });
afterEach(() => { cleanup(); _setBundleTransport(null); _resetBundleCache(); vi.useRealTimers(); });
const finishScans = async () => { await act(async () => { await vi.runAllTimersAsync(); }); };
const nextTimer = async () => { await act(async () => { await vi.advanceTimersToNextTimerAsync(); }); };

async function mount(props: { initialGene?: string; bundle?: TimeSeriesBundle } = {}) {
  const source = props.bundle ?? fixture();
  _setBundleTransport(() => Promise.resolve({ status: 'ok', value: source }));
  render(<CircadianTab dataset={dataset} trackId="scn" initialGene={props.initialGene} />);
  await act(async () => { await Promise.resolve(); });
}

const strip = () => screen.getByRole('table', { name: /in each arm/ });
const stripRow = (label: string) => within(strip()).getByRole('row', { name: new RegExp(label) });

describe('gene selection across settings', () => {
  it('keeps the selected gene when the arm, test or period changes', async () => {
    await mount({ initialGene: 'Middle' });
    await finishScans();
    expect(screen.getByTestId('trace')).toHaveTextContent('Middle');

    fireEvent.change(screen.getByLabelText('Arm'), { target: { value: 'hfd' } });
    expect(screen.getByTestId('trace')).toHaveTextContent('Middle');
    await finishScans();
    expect(screen.getByTestId('trace')).toHaveTextContent('Middle');

    fireEvent.change(screen.getByLabelText('Rhythm test'), { target: { value: 'cosinor' } });
    // During the rescan the trace stays, dimmed and marked busy, instead of
    // collapsing to an empty state.
    expect(screen.getByTestId('trace')).toHaveTextContent('Middle');
    expect(screen.getByTestId('circadian-figure')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Rescanning…')).toBeInTheDocument();
    await finishScans();
    expect(screen.getByTestId('circadian-figure')).not.toHaveAttribute('aria-busy');
    expect(screen.getByTestId('trace')).toHaveTextContent('Middle');

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'scan' } });
    await finishScans();
    expect(screen.getByTestId('trace')).toHaveTextContent('Middle');
  });

  it('falls back to the top gene only when the new scan did not score the selected one', async () => {
    await mount({ initialGene: 'ChowOnly' });
    await finishScans();
    expect(screen.getByTestId('trace')).toHaveTextContent('ChowOnly');
    fireEvent.change(screen.getByLabelText('Rhythm test'), { target: { value: 'cosinor' } });
    fireEvent.change(screen.getByLabelText('Arm'), { target: { value: 'hfd' } });
    // Still shown while the high-fat-diet scan runs; it has not yet been judged.
    expect(screen.getByTestId('trace')).toHaveTextContent('ChowOnly');
    await finishScans();
    expect(screen.getByTestId('trace')).not.toHaveTextContent('ChowOnly');
    expect(screen.getByTestId('trace')).toHaveTextContent(/Strong|Middle|Flat/);
  });

  it('keeps the trace through a rescan but no stale statistic: q and exports wait for the new scan', async () => {
    await mount({ initialGene: 'Strong' });
    await finishScans();
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'scan' } });
    // Change the test before that scan completes: its eventual callback is cancelled.
    fireEvent.change(screen.getByLabelText('Rhythm test'), { target: { value: 'cosinor' } });
    expect(screen.getByTestId('trace')).toHaveTextContent('Strong');
    expect(within(stripRow('Chow')).getByText('awaiting scan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Results CSV' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Results CSV' }));
    expect(exportResultsCSV).not.toHaveBeenCalled();

    await finishScans();
    expect(within(stripRow('Chow')).queryByText('awaiting scan')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Results CSV' }));
    const [rows, ctx] = vi.mocked(exportResultsCSV).mock.calls[0];
    expect(ctx.method).toBe('cosinor');
    expect(ctx.periods).toEqual(SCAN_PERIODS);
    expect(rows.every((r) => r.method === 'cosinor')).toBe(true);
  });
});

describe('every arm under the same settings', () => {
  it('scans the selected arm first, then the others, and counts both', async () => {
    await mount({ initialGene: 'Strong' });
    fireEvent.change(screen.getByLabelText('Rhythm test'), { target: { value: 'cosinor' } });
    const counts = screen.getByTestId('circadian-counts');
    expect(counts).toHaveAttribute('aria-live', 'polite');

    // The single progress bar sits in the count area, outside the live region.
    const summary = counts.parentElement as HTMLElement;
    expect(within(summary).getByRole('progressbar', { name: /Scanning Chow/ })).toBeInTheDocument();
    expect(within(counts).queryByRole('progressbar')).toBeNull();

    // Advance one timer at a time until Chow is done but High-fat diet is not.
    for (let i = 0; i < 10 && within(counts).queryByText(/rhythmic at/) == null; i++) await nextTimer();
    expect(counts).toHaveTextContent(/Chow/);
    expect(counts).toHaveTextContent(/High-fat diet/);
    expect(counts).toHaveTextContent(/scanning/);
    // High-fat diet's q is not shown until its own scan finishes.
    expect(within(stripRow('High-fat diet')).getByText('awaiting scan')).toBeInTheDocument();
    expect(screen.getByText(/q for High-fat diet appears when that arm's scan finishes/)).toBeInTheDocument();

    await finishScans();
    expect(counts).not.toHaveTextContent(/scanning/);
    expect(counts.textContent).toMatch(/^\d+\s*Chow·\s*\d+\s*High-fat diet\s*rhythmic at q < 0\.05 of [\d/ ,]+ tested$/);
    expect(within(summary).queryByRole('progressbar')).toBeNull();
  });

  it('names the arm being scanned, not one queued behind it', async () => {
    await mount({ initialGene: 'Strong' });
    // Chow starts first; selecting High-fat diet before Chow finishes puts
    // High-fat diet at the head of the queue and Chow behind it.
    fireEvent.change(screen.getByLabelText('Arm'), { target: { value: 'hfd' } });
    const counts = screen.getByTestId('circadian-counts');
    const summary = counts.parentElement as HTMLElement;
    expect(within(summary).getByRole('progressbar', { name: /Scanning High-fat diet/ })).toBeInTheDocument();
    expect(within(summary).queryByRole('progressbar', { name: /Chow/ })).toBeNull();
    expect(within(summary).getByText('Scanning High-fat diet')).toBeInTheDocument();
    expect(counts).toHaveTextContent(/queued\s*Chow/);
    expect(counts).toHaveTextContent(/scanning\s*High-fat diet/);
    await finishScans();
    expect(within(summary).queryByRole('progressbar')).toBeNull();
  });

  it('reports each arm in the strip, with a word verdict and no peak for a non-rhythmic arm', async () => {
    await mount({ initialGene: 'Strong' });
    fireEvent.change(screen.getByLabelText('Rhythm test'), { target: { value: 'cosinor' } });
    await finishScans();

    const chow = stripRow('Chow');
    expect(chow).toHaveAttribute('aria-current', 'true');
    expect(within(chow).getByText('selected arm')).toBeInTheDocument();
    expect(within(chow).getByText('rhythmic')).toBeInTheDocument();
    // Strong peaks at ZT4 in Chow.
    expect(within(chow).getByText('4.0')).toBeInTheDocument();

    const hfd = stripRow('High-fat diet');
    expect(hfd).not.toHaveAttribute('aria-current');
    expect(within(hfd).getByText('not rhythmic')).toBeInTheDocument();
    expect(within(hfd).getByText('n.s.')).toBeInTheDocument();
    expect(within(hfd).queryByText('awaiting scan')).toBeNull();
    // Header names the adjusted column and the threshold.
    expect(within(strip()).getByRole('columnheader', { name: 'q' })).toBeInTheDocument();
    expect(within(strip()).getByRole('columnheader', { name: 'at q < 0.05' })).toBeInTheDocument();
    // The phase map takes the selected arm's colour.
    expect(screen.getByTestId('phase-map')).toHaveAttribute('data-color', '#4C78A8');
  });

  it('drops the q column when correction is off and judges on raw p', async () => {
    await mount({ initialGene: 'Strong' });
    fireEvent.change(screen.getByLabelText('Rhythm test'), { target: { value: 'cosinor' } });
    fireEvent.change(screen.getByLabelText('Correction'), { target: { value: 'none' } });
    await finishScans();
    expect(within(strip()).queryByRole('columnheader', { name: 'q' })).toBeNull();
    expect(within(strip()).getByRole('columnheader', { name: 'at p < 0.05' })).toBeInTheDocument();
    expect(screen.getByText(/No gene-wise correction is applied/)).toBeInTheDocument();
  });

  it('offers COSINOR in one dedicated state when JTK cannot test the design', async () => {
    // Irregular sampling: no regular lattice for JTK_CYCLE.
    await mount({ bundle: fixture([0, 3, 8, 13, 16, 21]) });
    await finishScans();
    expect(screen.getByText(/JTK_CYCLE cannot test Chow/)).toBeInTheDocument();
    // No arm can be scanned: the count area says so instead of "Scanning 4 genes".
    const counts = screen.getByTestId('circadian-counts');
    expect(counts).toHaveTextContent('JTK_CYCLE cannot test this sampling design in any arm.');
    expect(counts).not.toHaveTextContent(/Scanning/);
    expect(within(counts.parentElement as HTMLElement).queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText('No gene selected')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Results CSV' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Use COSINOR instead/ }));
    expect(screen.getByLabelText('Rhythm test')).toHaveValue('cosinor');
    await finishScans();
    expect(screen.getByTestId('trace')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Results CSV' })).toBeEnabled();
  });
});

describe('useArmScans request identity', () => {
  it('never reports an arm from another bundle or test, and keeps finished arms on reorder', async () => {
    const first = fixture();
    const second = fixture();
    const renders: Array<{ method: string; rows: number; running: boolean }> = [];
    const { result, rerender } = renderHook(
      ({ source, method, arms }: { source: TimeSeriesBundle | null; method: 'jtk' | 'cosinor'; arms: string[] }) => {
        const state = useArmScans(source, { method, periods: DEFAULT_PERIODS }, arms, 'bh').states;
        renders.push({ method, rows: state.control?.rows.length ?? 0, running: !!state.control?.running });
        return state;
      },
      { initialProps: { source: first as TimeSeriesBundle | null, method: 'jtk' as 'jtk' | 'cosinor', arms: ['control', 'hfd'] } },
    );
    await finishScans();
    expect(result.current.control.running).toBe(false);
    expect(result.current.hfd.running).toBe(false);
    expect(result.current.control.tested).toBe(4);
    expect(result.current.hfd.tested).toBe(3);
    // Each arm's q is adjusted within that arm: the family sizes differ.
    expect(result.current.control.rows.every((r) => r.q != null && r.q >= r.p)).toBe(true);

    // Reordering the same arms under the same settings reuses both results.
    rerender({ source: first, method: 'jtk', arms: ['hfd', 'control'] });
    expect(result.current.control.running).toBe(false);
    expect(result.current.hfd.running).toBe(false);

    renders.length = 0;
    rerender({ source: second, method: 'cosinor', arms: ['control', 'hfd'] });
    expect(renders.every((r) => r.rows === 0 && r.running)).toBe(true);
    await finishScans();
    expect(result.current.control.rows[0].method).toBe('cosinor');
    rerender({ source: null, method: 'cosinor', arms: ['control', 'hfd'] });
    expect(result.current.control).toMatchObject({ rows: [], running: false });
  });
});

describe('per-arm adjusted values', () => {
  // Same series in both arms, so the same raw p; Chow's correction family has
  // five scored genes and High-fat diet's four (ChowOnly is missing there).
  const edgeTimes = TIMES.flatMap((t) => [t, t]);
  const edge = TIMES.flatMap((t, i) => {
    const c = 10 + 0.1075 * Math.cos((2 * Math.PI * (t - 8)) / 24);
    return [c + 0.05 + (i % 3) * 0.01, c - 0.05 - (i % 2) * 0.01];
  });

  it('shows each arm its own Bonferroni q, before and after switching the selected arm', async () => {
    const p = cosinor({ times: edgeTimes, values: edge }, { periods: DEFAULT_PERIODS })?.p as number;
    // The fixture only tests something if the family size flips the verdict.
    expect(5 * p).toBeGreaterThan(0.05);
    expect(4 * p).toBeLessThan(0.05);

    await mount({ initialGene: 'Edge', bundle: fixture(TIMES, { Edge: [...edge, ...edge] }) });
    fireEvent.change(screen.getByLabelText('Rhythm test'), { target: { value: 'cosinor' } });
    fireEvent.change(screen.getByLabelText('Correction'), { target: { value: 'bonferroni' } });
    await finishScans();

    const check = () => {
      const chow = stripRow('Chow');
      const hfd = stripRow('High-fat diet');
      expect(within(chow).getAllByText(fmtP(p))).toHaveLength(1);
      expect(within(hfd).getAllByText(fmtP(p))).toHaveLength(1);
      expect(within(chow).getByText(fmtP(5 * p))).toBeInTheDocument();
      expect(within(hfd).getByText(fmtP(4 * p))).toBeInTheDocument();
      expect(within(chow).getByText('not rhythmic')).toBeInTheDocument();
      expect(within(hfd).getByText('rhythmic')).toBeInTheDocument();
    };
    expect(screen.getByTestId('trace')).toHaveTextContent('Edge');
    check();

    fireEvent.change(screen.getByLabelText('Arm'), { target: { value: 'hfd' } });
    await finishScans();
    expect(screen.getByTestId('trace')).toHaveTextContent('Edge');
    expect(stripRow('High-fat diet')).toHaveAttribute('aria-current', 'true');
    check();
  });

  it('gives the gene-specific reason when missing libraries leave a gene untestable in one arm', async () => {
    await mount({ initialGene: 'ChowOnly' });
    await finishScans();
    expect(screen.getByTestId('trace')).toHaveTextContent('ChowOnly');
    // High-fat diet's schedule supports JTK_CYCLE; this gene has no observation there.
    expect(within(stripRow('High-fat diet')).getByText(/JTK_CYCLE needs at least four observations/)).toBeInTheDocument();
    expect(within(stripRow('Chow')).queryByText(/JTK_CYCLE/)).toBeNull();
  });
});

describe('phase map', () => {
  it('counts a passing gene with no estimable peak but does not plot it at midnight', async () => {
    // Twelve 2-h timepoints, three libraries each. Spike is 1 at ZT0-4 and 0
    // elsewhere: canonical JTK_CYCLE finds a strong rank pattern, but every
    // Hodges-Lehmann amplitude is 0, so it reports period 0 and peak 0.
    const times = Array.from({ length: 12 }, (_, i) => i * 2);
    const samples = times.flatMap((time) => [1, 2, 3].map((replicate) => ({
      id: `control_${time}_${replicate}`, arm: 'control', time, replicate,
    })));
    const at = (f: (t: number, i: number) => number) => samples.map((s, i) => f(s.time, i));
    const spike = at((t) => (t <= 4 ? 1 : 0));
    const reference = jtkCycle({ times: samples.map((s) => s.time), values: spike }, { periods: DEFAULT_PERIODS });
    expect(reference).toMatchObject({ period: 0, acrophase: 0 });
    expect(reference?.p).toBeLessThan(0.01);

    const bundle: TimeSeriesBundle = {
      meta: {
        trackId: 'scn', label: 'Phase fixture', cycleHours: 24, timeUnit: 'ZT', expressionUnit: 'CPM',
        arms: [{ key: 'control', label: 'Chow', color: '#4C78A8' }],
        samples, timepoints: times, nGenes: 4,
      },
      values: {
        Wave: at((t, i) => 10 + 2 * Math.cos((2 * Math.PI * (t - 6)) / 24) + (i % 3) * 0.05),
        Spike: spike,
        FlatA: at((_, i) => 10 + ((i * 7) % 5) * 0.01),
        FlatB: at((_, i) => 10 + ((i * 3) % 7) * 0.01),
      },
    };
    await mount({ bundle });
    await finishScans();

    expect(screen.getByTestId('circadian-counts')).toHaveTextContent(/^2\s*Chow/);
    const map = screen.getByTestId('phase-map');
    expect(map).toHaveAttribute('data-count', '1');
    expect(map.getAttribute('data-peaks')).not.toBe('0');
    expect(screen.getByTestId('phase-map-caption')).toHaveTextContent(
      /^Peak times of the 1 of 2 genes passing q < 0\.05 in Chow that have an estimable peak\. The other 1 has no estimable peak time and is not plotted\./,
    );
  });
});

/** One arm sampled at `times`, one library per entry. */
function singleArm(times: number[], values: Record<string, Array<number | null>>): TimeSeriesBundle {
  return {
    meta: {
      trackId: 'scn', label: 'Single-arm fixture', cycleHours: 24, timeUnit: 'ZT', expressionUnit: 'CPM',
      arms: [{ key: 'control', label: 'Chow', color: '#4C78A8' }],
      samples: times.map((time, i) => ({ id: `control_${i}`, arm: 'control', time, replicate: i + 1 })),
      timepoints: [...new Set(times)], nGenes: Object.keys(values).length,
    },
    values,
  };
}

describe('Lomb-Scargle floor never contradicts the scan', () => {
  // Three sampling times that fall on two phases of 24 h. The periodogram's
  // sine column is zero up to rounding, so the computed power exceeds the
  // (n - 1)/2 cap and p = 0.040 lands below the formula floor of 0.082.
  const times = [0, 12, 12, 24, 24, 24];
  const values = [2, 0, 0, 2, 2, 2];

  it('states no floor, counts the passing gene, and does not plot its failed fit at midnight', async () => {
    const reference = lombScargle({ times, values }, { periods: DEFAULT_PERIODS });
    expect(reference?.p).toBeCloseTo(0.040195, 5);
    expect(Math.exp(-5 / 2)).toBeCloseTo(0.082085, 5);
    // The cosine fit is singular at this design: period 24, amplitude 0, peak 0.
    expect(reference).toMatchObject({ period: 24, amplitude: 0, acrophase: 0 });

    await mount({ bundle: singleArm(times, { Pulse: values }) });
    fireEvent.change(screen.getByLabelText('Rhythm test'), { target: { value: 'ls' } });
    await finishScans();

    expect(screen.getByTestId('circadian-counts')).toHaveTextContent(/^1\s*Chow/);
    expect(screen.queryByText(/No gene can reach/)).toBeNull();
    expect(screen.queryByText(/smallest p any gene/)).toBeNull();
    expect(screen.queryByText('8.2e-2')).toBeNull();
    expect(screen.queryByTestId('phase-map')).toBeNull();
    expect(screen.getByTestId('phase-map-caption')).toHaveTextContent(
      /^None of the 1 gene passing q < 0\.05 in Chow has an estimable peak time, so there is nothing to plot\.$/,
    );

    fireEvent.change(screen.getByLabelText('Correction'), { target: { value: 'none' } });
    expect(screen.queryByText(/Expected by chance/)).toBeNull();
    expect(screen.queryByText(/No gene can reach/)).toBeNull();
  });

  it('states no floor while the scan is running, then the observed one when it finishes', async () => {
    // Seven libraries at six distinct phases of 24 h; Gap misses one.
    const seven = [0, 4, 8, 12, 16, 20, 24];
    await mount({ bundle: singleArm(seven, {
      Full: seven.map((t, i) => 10 + Math.cos((2 * Math.PI * t) / 24) + (i % 2) * 0.1),
      Gap: [null, ...seven.slice(1).map((t, i) => 10 + Math.cos((2 * Math.PI * (t - 4)) / 24) + (i % 3) * 0.1)],
    }) });
    fireEvent.change(screen.getByLabelText('Rhythm test'), { target: { value: 'ls' } });
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'scan' } });
    expect(screen.queryByText(/smallest p any gene/)).toBeNull();
    expect(screen.queryByText('8.2e-2')).toBeNull();
    await finishScans();
    expect(screen.getByText('8.2e-2')).toBeInTheDocument();
  });

  it('withholds the floor when one gene\'s observed times are degenerate though the schedule is not', async () => {
    // The full schedule puts a library at 6 h, so both shifted columns exist at
    // 24 h. Gap misses that library: its observed times are 0, 12, 12, 24, 24,
    // 24, where the sine column vanishes. Its own p sits above the n = 6 floor,
    // but a permutation of the same six values at those times gets 0.040.
    const schedule = [0, 6, 12, 12, 24, 24, 24];
    const gap = [0, null, 0, 2, 2, 2, 2];
    const observed = [0, 12, 12, 24, 24, 24];
    const own = lombScargle({ times: observed, values: [0, 0, 2, 2, 2, 2] }, { periods: DEFAULT_PERIODS });
    const permuted = lombScargle({ times: observed, values: [2, 0, 0, 2, 2, 2] }, { periods: DEFAULT_PERIODS });
    expect(own?.p).toBeGreaterThanOrEqual(Math.exp(-5 / 2));
    expect(permuted?.p).toBeCloseTo(0.040195, 5);
    expect(permuted?.p).toBeLessThan(Math.exp(-5 / 2));

    await mount({ bundle: singleArm(schedule, { Gap: gap }) });
    fireEvent.change(screen.getByLabelText('Rhythm test'), { target: { value: 'ls' } });
    fireEvent.change(screen.getByLabelText('Correction'), { target: { value: 'none' } });
    await finishScans();
    expect(screen.getByTestId('circadian-counts')).toHaveTextContent(/of 1 tested/);
    expect(screen.queryByText(/No gene can reach/)).toBeNull();
    expect(screen.queryByText(/smallest p any gene/)).toBeNull();
    expect(screen.queryByText('8.2e-2')).toBeNull();
    expect(screen.queryByText(/Expected by chance:/)).toBeNull();
    expect(screen.getByText(/Uncorrected benchmark:/)).toBeInTheDocument();
  });

  it('states the floor for the same schedule when every scored gene is fully observed', async () => {
    // Control for the case above: the complete pattern supports both columns,
    // so the n = 7 floor e^-3 = 0.0498 is stated.
    const schedule = [0, 6, 12, 12, 24, 24, 24];
    await mount({ bundle: singleArm(schedule, { Full: [10, 11, 12, 11.5, 10, 10.5, 9.5] }) });
    fireEvent.change(screen.getByLabelText('Rhythm test'), { target: { value: 'ls' } });
    await finishScans();
    expect(Math.exp(-3)).toBeCloseTo(0.049787, 5);
    expect(screen.getByText('5.0e-2')).toBeInTheDocument();
  });

  it('states the floor for a regular three-time design and says no gene can pass', async () => {
    // Two libraries at each of 0, 8 and 16 h: three phases a third of a cycle
    // apart, so both shifted columns exist at 24 h. [2, 2, 0, 0, 0, 0] is fully
    // explained by the cosine and reaches the cap (n - 1)/2 = 2.5.
    const three = [0, 0, 8, 8, 16, 16];
    const pulse = [2, 2, 0, 0, 0, 0];
    const reference = lombScargle({ times: three, values: pulse }, { periods: DEFAULT_PERIODS });
    expect(reference?.stat).toBeCloseTo(2.5, 9);
    expect(reference?.p).toBeCloseTo(0.082085, 6);

    const values: Record<string, number[]> = {};
    for (let g = 0; g < 100; g++) values[`G${g}`] = pulse;
    await mount({ bundle: singleArm(three, values) });
    fireEvent.change(screen.getByLabelText('Rhythm test'), { target: { value: 'ls' } });
    fireEvent.change(screen.getByLabelText('Correction'), { target: { value: 'none' } });
    await finishScans();
    expect(screen.getByTestId('circadian-counts')).toHaveTextContent(/^0\s*Chow\s*rhythmic at p < 0\.05 of 100 tested/);
    expect(screen.getByText(/No gene can reach/)).toHaveTextContent(
      /No gene can reach p < 0\.05 with Lomb–Scargle in this arm \(n = 6 libraries\)\. The smallest p any gene in this arm can reach is 8\.2e-2, which is not below 0\.05\./,
    );
    expect(screen.getAllByRole('button', { name: 'Switch to COSINOR' }).length).toBeGreaterThan(0);
    expect(screen.getByText(/Expected by chance:/)).toHaveTextContent(/^Expected by chance: 0 of 100 tested genes/);
    expect(screen.queryByText(/Uncorrected benchmark:/)).toBeNull();
    expect(screen.queryByText(/≈ 5\.0/)).toBeNull();
  });
});

describe('results table across an unsupported JTK_CYCLE design', () => {
  it('keeps the filter and sort when the user takes the COSINOR offer', async () => {
    // Irregular sampling: no regular lattice for JTK_CYCLE.
    await mount({ bundle: fixture([0, 3, 8, 13, 16, 21]) });
    fireEvent.click(screen.getByRole('button', { name: /Use COSINOR instead/ }));
    await finishScans();
    fireEvent.change(screen.getByLabelText('Filter genes'), { target: { value: 'Mid' } });
    fireEvent.click(screen.getByRole('button', { name: /^Gene/ }));
    const geneHeader = () => screen.getByRole('columnheader', { name: /^Gene/ });
    const sortState = geneHeader().getAttribute('aria-sort');
    expect(sortState).not.toBe('none');
    expect(within(screen.getByRole('table', { name: 'Rhythm results' })).getAllByRole('row')).toHaveLength(2);

    fireEvent.change(screen.getByLabelText('Rhythm test'), { target: { value: 'jtk' } });
    expect(screen.getByText(/JTK_CYCLE cannot test Chow/)).toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: 'Filter genes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Results CSV' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Use COSINOR instead/ }));
    await finishScans();
    expect(screen.getByLabelText('Filter genes')).toHaveValue('Mid');
    const table = screen.getByRole('table', { name: 'Rhythm results' });
    const bodyRows = within(table).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(1);
    expect(bodyRows[0]).toHaveTextContent('Middle');
    expect(geneHeader()).toHaveAttribute('aria-sort', sortState as string);
  });
});

describe('switching to an arm that has already been scanned', () => {
  it('never draws a gene the arm did not score, not even for one render', async () => {
    await mount({ initialGene: 'ChowOnly' });
    await finishScans();
    expect(screen.getByTestId('trace')).toHaveTextContent('ChowOnly');
    // Both arms are finished, so the switch is served from the cache.
    expect(screen.getByTestId('circadian-counts')).not.toHaveTextContent(/scanning|queued/);

    traced.genes.length = 0;
    fireEvent.change(screen.getByLabelText('Arm'), { target: { value: 'hfd' } });
    expect(traced.genes.length).toBeGreaterThan(0);
    expect(traced.genes).not.toContain('ChowOnly');
    expect(screen.getByTestId('circadian-figure')).not.toHaveAttribute('aria-busy');
    expect(screen.getByTestId('trace')).not.toHaveTextContent('ChowOnly');

    // The fallback is now the selection: returning to Chow keeps it.
    const fallback = screen.getByTestId('trace').textContent;
    fireEvent.change(screen.getByLabelText('Arm'), { target: { value: 'control' } });
    expect(screen.getByTestId('trace')).toHaveTextContent(fallback as string);
  });
});

describe('scan states the figure and notes depend on', () => {
  it('clears the trace when the selected arm scores no gene, and restores it on return', async () => {
    const base = fixture();
    const values = Object.fromEntries(Object.entries(base.values)
      .map(([gene, row]) => [gene, [...row.slice(0, 12), ...row.slice(12).map(() => null)]]));
    await mount({ initialGene: 'Strong', bundle: { ...base, values } });
    await finishScans();
    expect(screen.getByTestId('trace')).toHaveTextContent('Strong');

    fireEvent.change(screen.getByLabelText('Arm'), { target: { value: 'hfd' } });
    await finishScans();
    expect(screen.queryByTestId('trace')).toBeNull();
    expect(screen.queryByRole('table', { name: /in each arm/ })).toBeNull();
    expect(screen.getByText('No scorable genes')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Arm'), { target: { value: 'control' } });
    expect(screen.getByTestId('trace')).toHaveTextContent('Strong');
  });

  it('bounds the Lomb-Scargle floor by every observed series length, not the schedule', async () => {
    // Seven libraries scheduled; Gap misses one. Over the 17-period scan the
    // floor at n = 6 (8.2e-2) is below the floor at n = 7 (9.7e-2): the
    // Horne-Baliunas count drops from 2 to 1 faster than the power cap falls.
    const times = [0, 4, 8, 12, 16, 20, 24];
    const bundle: TimeSeriesBundle = {
      meta: {
        trackId: 'scn', label: 'Floor fixture', cycleHours: 24, timeUnit: 'ZT', expressionUnit: 'CPM',
        arms: [{ key: 'control', label: 'Chow', color: '#4C78A8' }],
        samples: times.map((time) => ({ id: `control_${time}`, arm: 'control', time, replicate: 1 })),
        timepoints: times, nGenes: 2,
      },
      values: {
        Full: times.map((t, i) => 10 + Math.cos((2 * Math.PI * t) / 24) + (i % 2) * 0.1),
        Gap: [null, ...times.slice(1).map((t, i) => 10 + Math.cos((2 * Math.PI * (t - 4)) / 24) + (i % 3) * 0.1)],
      },
    };
    await mount({ bundle });
    fireEvent.change(screen.getByLabelText('Rhythm test'), { target: { value: 'ls' } });
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'scan' } });
    await finishScans();
    expect(screen.getByText('8.2e-2')).toBeInTheDocument();
    expect(screen.queryByText('9.7e-2')).toBeNull();
  });
});

describe('background scans', () => {
  it('keeps the in-flight scan when its arm becomes the selected one', async () => {
    await mount({ bundle: manyGenes(640) });
    const summary = screen.getByTestId('circadian-counts').parentElement as HTMLElement;
    const hfdBar = () => within(summary).queryByRole('progressbar', { name: /Scanning High-fat diet/ });
    for (let i = 0; i < 50 && hfdBar() == null; i++) await nextTimer();
    await nextTimer();
    await nextTimer();
    const before = Number(hfdBar()?.getAttribute('aria-valuenow'));
    // A restart would fall back to the first chunk's 5%.
    expect(before).toBeGreaterThan(10);
    expect(before).toBeLessThan(90);

    // Reorder before High-fat diet completes: it is now the first unfinished arm.
    fireEvent.change(screen.getByLabelText('Arm'), { target: { value: 'hfd' } });
    expect(Number(hfdBar()?.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(before);
    await nextTimer();
    expect(Number(hfdBar()?.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(before);
    await finishScans();
    expect(hfdBar()).toBeNull();
    expect(screen.getByTestId('circadian-counts')).toHaveTextContent(/rhythmic at q < 0\.05 of 640 tested/);
  });

  it('does not re-render the finished results table while another arm scans', async () => {
    await mount({ bundle: manyGenes(640) });
    const counts = screen.getByTestId('circadian-counts');
    const summary = counts.parentElement as HTMLElement;
    for (let i = 0; i < 50 && !/rhythmic at/.test(counts.textContent ?? ''); i++) await nextTimer();
    expect(within(summary).getByRole('progressbar', { name: /Scanning High-fat diet/ })).toBeInTheDocument();
    const atHandOff = tableRenders.count;
    let chunks = 0;
    while (within(summary).queryByRole('progressbar') && chunks < 50) { await nextTimer(); chunks++; }
    // 640 genes at 32 per JTK chunk: several progress updates, none re-rendering the table.
    expect(chunks).toBeGreaterThan(4);
    expect(tableRenders.count - atHandOff).toBeLessThanOrEqual(1);
  });
});
