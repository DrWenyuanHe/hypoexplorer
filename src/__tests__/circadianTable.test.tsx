import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi, beforeAll } from 'vitest';
import {
  CircadianResultsTable, VISIBLE_ROW_CAP, fmtSig3, rhythmSortValue,
} from '../circadian/CircadianResultsTable';
import { type ExportContext, exportRawCSV, exportResultsCSV, exportWorkbook } from '../circadian/circadianExport';
import { type RhythmResult, SCAN_PERIODS, runRhythmicity } from '../circadian/rhythmicity';
import type { RhythmRow } from '../circadian/scan';
import { defineDataset } from '../data/datasets';
import type { TimeSeriesBundle } from '../types';
import { loadExportEvidence } from '../utils/lazyExport';

// Export snapshots record the internal QC ledger, which the app loads on the
// first export (utils/lazyExport.ts); load it before any export runs.
beforeAll(() => loadExportEvidence());

vi.mock('../circadian/circadianExport', () => ({
  exportResultsCSV: vi.fn(), exportRawCSV: vi.fn(), exportWorkbook: vi.fn().mockResolvedValue(undefined),
}));

const bundle: TimeSeriesBundle = {
  meta: {
    trackId: 'scn', label: 'Table fixture', cycleHours: 24, timeUnit: 'CT', expressionUnit: 'log2(FPKM + 1)',
    arms: [{ key: 'control', label: 'Control', color: '#4C78A8' }],
    samples: [], timepoints: [0, 4, 8, 12, 16, 20], nGenes: 0,
  },
  values: {},
};

const dataset = defineDataset({ id: 'table_timecourse', category: 'Circadian', name: 'Table fixture',
  organism: 'Mus musculus', modality: 'bulk RNA-seq', region: 'Suprachiasmatic nucleus', perturbation: 'Genetic', preparation: 'Bulk tissue',
  citation: '', doi: '', pmid: '', geo: '', bundleBaseUrl: '/datasets/table_timecourse',
  defaultTrack: 'scn', featureType: 'gene', featureLabel: 'Gene', supportsPathways: false,
  isDefault: false, trackCategoryOrder: ['Tissue'],
  groups: [{ key: 'control', label: 'Control', color: '#4C78A8' }], contrasts: [],
  timeSeries: { tracks: ['scn'], cycleHours: 24, timeUnit: 'CT', design: 'Synthetic fixture' } });

/** Rows in ascending p, so the table's default p sort keeps this order. */
function makeRows(n: number): RhythmRow[] {
  return Array.from({ length: n }, (_, i) => ({
    gene: `G${String(i).padStart(4, '0')}`, method: 'cosinor', p: (i + 1) / (n + 1), q: (i + 1) / (n + 1),
    period: 24, acrophase: 4.26, amplitude: 0.08234, mesor: 2.4719, stat: 3.5, n: 12, nTimepoints: 6,
  }));
}

function Harness({ rows, onSelect, periodMode = 'fixed24' }: {
  rows: RhythmRow[]; onSelect?: (gene: string) => void; periodMode?: 'fixed24' | 'scan';
}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <CircadianResultsTable
      bundle={bundle} dataset={dataset} rows={rows} running={false} total={rows.length}
      selected={selected} onSelect={(g) => { setSelected(g); onSelect?.(g); }}
      threshold={0.05} adjust="bh" qLabel="q" periodMode={periodMode}
      statLabel="F" unit="CT" exportCtx={{ bundle, dataset } as ExportContext}
    />
  );
}

const bodyRows = () => within(screen.getByRole('table', { name: 'Rhythm results' })).getAllByRole('row').slice(1);
const geneOf = (row: HTMLElement) => row.querySelector('td')?.textContent;
/** One body row's cell under the column whose header reads `column`. */
const cellUnder = (row: HTMLElement, column: string) => {
  const headers = within(screen.getByRole('table', { name: 'Rhythm results' })).getAllByRole('columnheader');
  const index = headers.findIndex((h) => (h.textContent ?? '').replace(/ [↑↓]$/, '') === column);
  if (index < 0) throw new Error(`no column ${column}`);
  return within(row).getAllByRole('cell')[index];
};
const asRow = (gene: string, fit: RhythmResult | null): RhythmRow => {
  if (!fit) throw new Error(`${gene}: the estimator returned no result`);
  return { gene, ...fit, q: fit.p };
};

/**
 * The reviewer's Lomb–Scargle case: six libraries at 0, 12, 12, 24, 24, 24 h,
 * scanned over the 17 periods 20–28 h. The periodogram picks 24 h by maximum
 * power; the cosine fit at 24 h is then singular (every sine term is 0), so the
 * estimator records amplitude 0 and acrophase 0 as fallbacks.
 */
function lsSingular(): RhythmResult | null {
  return runRhythmicity('ls', { times: [0, 12, 12, 24, 24, 24], values: [2, 0, 0, 2, 2, 2] }, { periods: SCAN_PERIODS });
}

/**
 * The reviewer's JTK_CYCLE spike: six time points on a 4 h grid, eight
 * replicates each, values 1, 0, 0, 0, 0, 0 at every replicate. Canonical
 * JTK_CYCLE scores it (p ≈ 0.0215) with a Hodges–Lehmann amplitude of 0, hence
 * period 0.
 */
function jtkSpike(): RhythmResult | null {
  const times: number[] = [];
  const values: number[] = [];
  for (let rep = 0; rep < 8; rep++) {
    [0, 4, 8, 12, 16, 20].forEach((t, i) => { times.push(t); values.push(i === 0 ? 1 : 0); });
  }
  return runRhythmicity('jtk', { times, values }, { periods: [24] });
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('CircadianResultsTable keyboard selection', () => {
  it('names the table and offers exactly one tab stop, on the first row before anything is selected', () => {
    render(<Harness rows={makeRows(4)} />);
    const rows = bodyRows();
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.tabIndex === 0)).toEqual([rows[0]]);
    expect(rows.every((r) => r.getAttribute('aria-selected') === 'false')).toBe(true);
  });

  it('moves focus and selection with the arrow keys, Home and End', () => {
    const onSelect = vi.fn();
    render(<Harness rows={makeRows(5)} onSelect={onSelect} />);
    let rows = bodyRows();
    act(() => rows[0].focus());

    fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
    rows = bodyRows();
    expect(onSelect).toHaveBeenLastCalledWith('G0001');
    expect(document.activeElement).toBe(rows[1]);
    expect(rows[1]).toHaveAttribute('aria-selected', 'true');
    expect(rows.filter((r) => r.tabIndex === 0)).toEqual([rows[1]]);

    fireEvent.keyDown(rows[1], { key: 'End' });
    rows = bodyRows();
    expect(document.activeElement).toBe(rows[4]);
    expect(geneOf(rows[4])).toBe('G0004');
    expect(rows[4]).toHaveAttribute('aria-selected', 'true');

    // ArrowDown at the last row stays put.
    fireEvent.keyDown(rows[4], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(bodyRows()[4]);

    fireEvent.keyDown(bodyRows()[4], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(bodyRows()[3]);
    expect(onSelect).toHaveBeenLastCalledWith('G0003');

    fireEvent.keyDown(bodyRows()[3], { key: 'Home' });
    rows = bodyRows();
    expect(document.activeElement).toBe(rows[0]);
    expect(rows[0]).toHaveAttribute('aria-selected', 'true');
    expect(rows.filter((r) => r.getAttribute('aria-selected') === 'true')).toHaveLength(1);
  });

  it('selects the focused row with Enter or Space, and the tab stop follows the selection', () => {
    const onSelect = vi.fn();
    render(<Harness rows={makeRows(3)} onSelect={onSelect} />);
    fireEvent.keyDown(bodyRows()[0], { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith('G0000');

    fireEvent.click(bodyRows()[2]);
    expect(onSelect).toHaveBeenLastCalledWith('G0002');
    expect(bodyRows().filter((r) => r.tabIndex === 0)).toEqual([bodyRows()[2]]);

    fireEvent.keyDown(bodyRows()[1], { key: ' ' });
    expect(onSelect).toHaveBeenLastCalledWith('G0001');
    expect(bodyRows()[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps the sortable headers as focusable buttons, and the tab stop follows a re-sort', () => {
    render(<Harness rows={makeRows(3)} />);
    fireEvent.click(bodyRows()[0]);
    const geneSort = screen.getByRole('button', { name: 'Gene' });
    act(() => geneSort.focus());
    expect(document.activeElement).toBe(geneSort);
    fireEvent.click(screen.getByRole('button', { name: 'p' })); // p descending
    const rows = bodyRows();
    expect(geneOf(rows[2])).toBe('G0000');
    expect(rows.filter((r) => r.tabIndex === 0)).toEqual([rows[2]]);
  });

  it('labels the filter box as a search field', () => {
    render(<Harness rows={makeRows(3)} />);
    const box = screen.getByRole('searchbox', { name: 'Filter genes' });
    fireEvent.change(box, { target: { value: 'G0002' } });
    expect(bodyRows().map(geneOf)).toEqual(['G0002']);
  });
});

describe('CircadianResultsTable values and exports', () => {
  it('writes every sorted gene to the raw-values CSV and the workbook, not only the rendered rows', () => {
    const rows = makeRows(VISIBLE_ROW_CAP + 5);
    render(<Harness rows={rows} />);
    expect(bodyRows()).toHaveLength(VISIBLE_ROW_CAP);
    expect(screen.getByText(/showing the first/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Raw values CSV' }));
    const rawGenes = vi.mocked(exportRawCSV).mock.calls[0][1];
    expect(rawGenes).toHaveLength(VISIBLE_ROW_CAP + 5);
    expect(rawGenes).toEqual(rows.map((r) => r.gene));

    fireEvent.click(screen.getByRole('button', { name: 'Excel' }));
    const [wbRows, wbGenes] = vi.mocked(exportWorkbook).mock.calls[0];
    expect(wbRows).toHaveLength(VISIBLE_ROW_CAP + 5);
    expect(wbGenes).toEqual(rows.map((r) => r.gene));

    fireEvent.click(screen.getByRole('button', { name: 'Results CSV' }));
    expect(vi.mocked(exportResultsCSV).mock.calls[0][0]).toHaveLength(VISIBLE_ROW_CAP + 5);
  });

  it('emphasizes a row on its adjusted value, never on a raw p standing in for a missing q', () => {
    const [called, base] = makeRows(2);
    const rows = [{ ...called, p: 0.001, q: 0.01 }, { ...base, p: 0.002, q: null }];
    render(<Harness rows={rows} />);
    const emphasized = (row: HTMLElement) => within(row).getAllByRole('cell').some((c) => c.style.fontWeight === '600');
    const [first, second] = bodyRows();
    expect(geneOf(first)).toBe(called.gene);
    expect(emphasized(first)).toBe(true);
    // Under BH a row not yet adjusted counts as q = 1, though its raw p is 0.002.
    expect(emphasized(second)).toBe(false);
  });

  it('shows amplitude and mesor to three significant figures and the peak to one decimal', () => {
    render(<Harness rows={makeRows(1)} />);
    const cells = within(bodyRows()[0]).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toContain('0.0823');
    expect(cells).toContain('2.47');
    expect(cells).toContain('4.3');
  });

  it('keeps the max-power period of the six-library Lomb–Scargle case whose cosine fit fails', () => {
    const fit = lsSingular();
    // Real estimator output, pinned so the scenario cannot drift.
    expect(fit).toMatchObject({ method: 'ls', period: 24, amplitude: 0, acrophase: 0, n: 6, nTimepoints: 3 });
    const row = asRow('LsSingular', fit);
    render(<Harness rows={[row]} periodMode="scan" />);
    const [tr] = bodyRows();
    // The period was chosen by periodogram power before the fit failed, and the
    // results CSV records PeriodHours = 24: the table must not deny it.
    expect(screen.getByRole('button', { name: 'period (h, max power)' })).toBeInTheDocument();
    expect(cellUnder(tr, 'period (h, max power)').textContent).toBe('24');
    expect(tr.textContent).not.toMatch(/no estimable period/);
    // No peak time: acrophase 0 is a fallback, not CT0.
    expect(cellUnder(tr, 'peak (CT)').textContent).toBe('—no estimable peak');
    // The recorded amplitude is shown as recorded, and marked as not fitted.
    const amplitude = cellUnder(tr, 'amplitude');
    expect(amplitude.textContent).toBe('0 (recorded as 0 because the cosine fit failed; not a fitted amplitude)');
    expect(amplitude.title).toMatch(/cosine fit failed; not a fitted amplitude/);
    expect(cellUnder(tr, 'p').textContent).not.toBe('—');
    // The sort accessor follows the same per-column rules.
    expect(rhythmSortValue(row, 'period')).toBe(24);
    expect(rhythmSortValue(row, 'amplitude')).toBe(0);
    expect(rhythmSortValue(row, 'acrophase')).toBeNull();
  });

  it('shows the estimated zero amplitude of the JTK_CYCLE replicate spike as 0, with no period or peak', () => {
    const fit = jtkSpike();
    expect(fit).toMatchObject({ method: 'jtk', period: 0, amplitude: 0, periodsTested: [24] });
    expect(fit?.p).toBeCloseTo(0.0215, 4);
    const row = asRow('Spike', fit);
    render(<Harness rows={[row]} periodMode="scan" />);
    const [tr] = bodyRows();
    expect(screen.getByRole('button', { name: 'period (h)' })).toBeInTheDocument();
    expect(cellUnder(tr, 'amplitude').textContent).toBe('0');
    expect(cellUnder(tr, 'amplitude').title).toBe('');
    expect(cellUnder(tr, 'period (h)').textContent).toBe('—no estimable period');
    expect(cellUnder(tr, 'peak (CT)').textContent).toBe('—no estimable peak');
    expect(cellUnder(tr, 'p').textContent).not.toBe('—');
    expect(rhythmSortValue(row, 'amplitude')).toBe(0);
    expect(rhythmSortValue(row, 'period')).toBeNull();
    expect(rhythmSortValue(row, 'acrophase')).toBeNull();
  });

  it('dashes only a non-finite amplitude', () => {
    const [base] = makeRows(1);
    const row: RhythmRow = { ...base, amplitude: Number.NaN };
    render(<Harness rows={[row]} />);
    expect(cellUnder(bodyRows()[0], 'amplitude').textContent).toBe('—no estimable amplitude');
    expect(rhythmSortValue(row, 'amplitude')).toBeNull();
  });

  it('formats three significant figures without exponent notation for large values', () => {
    expect(fmtSig3(0.08234)).toBe('0.0823');
    expect(fmtSig3(2.4719)).toBe('2.47');
    expect(fmtSig3(12345.6)).toBe('12346');
    expect(fmtSig3(0)).toBe('0');
    expect(fmtSig3(-0.5)).toBe('-0.500');
  });
});

describe('CircadianResultsTable sorting rows without an estimable peak', () => {
  /** 301 zero-period JTK rows (more than the visible cap) and one real ZT12 peak. */
  function mixedRows(): RhythmRow[] {
    const none = Array.from({ length: VISIBLE_ROW_CAP + 1 }, (_, i): RhythmRow => ({
      gene: `Z${String(i).padStart(4, '0')}`, method: 'jtk', p: 0.001, q: 0.01,
      period: 0, acrophase: 0, amplitude: 0, mesor: 2, stat: 0.5, n: 12, nTimepoints: 6,
    }));
    const real: RhythmRow = {
      gene: 'Real', method: 'jtk', p: 0.5, q: 0.6,
      period: 24, acrophase: 12, amplitude: 0.4, mesor: 2, stat: 0.2, n: 12, nTimepoints: 6,
    };
    return [...none, real];
  }

  it('returns null, not ZT0 or period 0, for the peak and period of a row without one, and 0 for its amplitude', () => {
    const [zero] = mixedRows();
    expect(rhythmSortValue(zero, 'acrophase')).toBeNull();
    expect(rhythmSortValue(zero, 'period')).toBeNull();
    expect(rhythmSortValue(zero, 'amplitude')).toBe(0);
    expect(rhythmSortValue(zero, 'p')).toBe(0.001);
    expect(rhythmSortValue(zero, 'mesor')).toBe(2);
  });

  it.each([
    ['peak (CT)'], ['period (h)'],
  ])('keeps the one real peak on screen when sorting by %s in either direction', (column) => {
    render(<Harness rows={mixedRows()} periodMode="scan" />);
    const header = screen.getByRole('button', { name: column });
    fireEvent.click(header); // ascending
    expect(bodyRows()).toHaveLength(VISIBLE_ROW_CAP);
    expect(geneOf(bodyRows()[0])).toBe('Real');
    fireEvent.click(header); // descending: missing values still sort last
    expect(geneOf(bodyRows()[0])).toBe('Real');
  });

  it('sorts estimated zero JTK amplitudes as 0, below a real amplitude', () => {
    render(<Harness rows={mixedRows()} periodMode="scan" />);
    const header = screen.getByRole('button', { name: 'amplitude' });
    fireEvent.click(header); // ascending: the zeros come first
    expect(geneOf(bodyRows()[0])).toMatch(/^Z/);
    expect(cellUnder(bodyRows()[0], 'amplitude').textContent).toBe('0');
    fireEvent.click(header); // descending
    expect(geneOf(bodyRows()[0])).toBe('Real');
  });
});
