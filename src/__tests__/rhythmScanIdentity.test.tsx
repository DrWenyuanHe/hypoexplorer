import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircadianTab } from '../circadian/CircadianTab';
import { useRhythmScan } from '../circadian/scan';
import { DEFAULT_PERIODS, SCAN_PERIODS, type RhythmMethod } from '../circadian/rhythmicity';
import { _resetBundleCache, _setBundleTransport } from '../data/bundleSource';
import { defineDataset } from '../data/datasets';
import { exportResultsCSV, exportWorkbook } from '../circadian/circadianExport';
import type { TimeSeriesBundle } from '../types';

vi.mock('../circadian/circadianExport', () => ({
  exportResultsCSV: vi.fn(), exportRawCSV: vi.fn(), exportWorkbook: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../circadian/RhythmTrace', () => ({ RhythmTrace: ({ gene }: { gene: string }) => <div data-testid="trace">{gene}</div> }));
vi.mock('../circadian/PhaseMap', () => ({ PhaseMap: () => <div /> }));

const references = JSON.parse(readFileSync(resolve(process.cwd(), 'src/__tests__/fixtures/jtkCanonical.json'), 'utf8')) as {
  cosinorCases: Array<{ id: string; grid: string; times: number[]; values: number[]; expected: { p: number } }>;
};
const reference = references.cosinorCases.find((c) => c.id === 'signal_regular12_6_0.2' && c.grid === 'scan20_28')!;
function bundle(gene = 'First'): TimeSeriesBundle {
  return { meta: { trackId: 'scn', label: 'Identity fixture', cycleHours: 24, timeUnit: 'CT', expressionUnit: 'CPM',
    arms: [{ key: 'control', label: 'Control', color: '#3775BA' }],
    samples: reference.times.map((time, i) => ({ id: `sample${i}`, arm: 'control', time, replicate: 1 })),
    timepoints: reference.times, nGenes: 1 }, values: { [gene]: reference.values } };
}
const dataset = defineDataset({ id: 'identity_timecourse', category: 'Circadian', name: 'Identity fixture',
  organism: 'Mus musculus', modality: 'bulk RNA-seq', region: 'Suprachiasmatic nucleus', perturbation: 'Genetic', preparation: 'Bulk tissue',
  citation: '', doi: '', pmid: '', geo: '', bundleBaseUrl: '/datasets/identity_timecourse',
  defaultTrack: 'scn', featureType: 'gene', featureLabel: 'Gene', supportsPathways: false,
  isDefault: false, trackCategoryOrder: ['Tissue'],
  groups: [{ key: 'control', label: 'Control', color: '#3775BA' }], contrasts: [],
  timeSeries: { tracks: ['scn'], cycleHours: 24, timeUnit: 'CT', design: 'Synthetic independent-reference fixture' } });

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); _resetBundleCache(); });
afterEach(() => { cleanup(); _setBundleTransport(null); _resetBundleCache(); vi.useRealTimers(); });
const finishScan = async () => { await act(async () => { await vi.runAllTimersAsync(); }); };

describe('completed rhythmicity request identity', () => {
  it('never exposes an old bundle/method result during the render before its replacement effect starts', async () => {
    const first = bundle('First'), second = bundle('Second');
    const renders: Array<{ method: string; gene?: string; rowMethod?: string; running: boolean }> = [];
    const { result, rerender } = renderHook(({ source, method }: { source: TimeSeriesBundle | null; method: RhythmMethod }) => {
      const state = useRhythmScan(source, { method, arm: 'control', periods: DEFAULT_PERIODS }, 'none');
      renders.push({ method, gene: state.rows[0]?.gene, rowMethod: state.rows[0]?.method, running: state.running });
      return state;
    }, { initialProps: { source: first as TimeSeriesBundle | null, method: 'jtk' as RhythmMethod } });
    await finishScan();
    expect(result.current.rows[0]).toMatchObject({ gene: 'First', method: 'jtk' });
    rerender({ source: second, method: 'cosinor' });
    expect(renders.filter((r) => r.method === 'cosinor').every((r) => !r.gene && r.running)).toBe(true);
    expect(result.current.tested).toBe(0);
    await finishScan();
    expect(result.current.rows[0]).toMatchObject({ gene: 'Second', method: 'cosinor' });
    rerender({ source: null, method: 'cosinor' });
    expect(result.current.rows).toEqual([]);
    expect(result.current.running).toBe(false);
  });

  it('blocks CSV/XLSX and removes the previous trace through a cancelled scan, then exports matching current statistics', async () => {
    _setBundleTransport(() => Promise.resolve({ status: 'ok', value: bundle() }));
    render(<CircadianTab dataset={dataset} trackId="scn" />);
    await act(async () => { await Promise.resolve(); });
    await finishScan();
    expect(screen.getByRole('button', { name: 'Results CSV' })).toBeEnabled();
    expect(screen.getByTestId('trace')).toHaveTextContent('First');

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'scan' } });
    // Change the method before that scan completes: its eventual callback is cancelled.
    fireEvent.change(screen.getByLabelText('Rhythm test'), { target: { value: 'cosinor' } });
    expect(screen.getByRole('button', { name: 'Results CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Excel' })).toBeDisabled();
    expect(screen.queryByTestId('trace')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Results CSV' }));
    fireEvent.click(screen.getByRole('button', { name: 'Excel' }));
    expect(exportResultsCSV).not.toHaveBeenCalled();
    expect(exportWorkbook).not.toHaveBeenCalled();

    await finishScan();
    expect(screen.getByRole('button', { name: 'Results CSV' })).toBeEnabled();
    expect(screen.getByTestId('trace')).toHaveTextContent('First');
    fireEvent.click(screen.getByRole('button', { name: 'Results CSV' }));
    const [rows, ctx] = vi.mocked(exportResultsCSV).mock.calls[0];
    expect(ctx.method).toBe('cosinor');
    expect(ctx.periods).toEqual(SCAN_PERIODS);
    expect(rows[0].method).toBe('cosinor');
    expect(rows[0].periodsTested).toEqual(SCAN_PERIODS);
    expect(Math.abs(rows[0].p - reference.expected.p)).toBeLessThan(1e-12);
    fireEvent.click(screen.getByRole('button', { name: 'Excel' }));
    expect(vi.mocked(exportWorkbook).mock.calls[0][0]).toEqual(rows);
    expect(vi.mocked(exportWorkbook).mock.calls[0][2].method).toBe('cosinor');
  });
});
