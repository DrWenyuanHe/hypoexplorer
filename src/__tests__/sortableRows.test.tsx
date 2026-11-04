import { describe, it, expect } from 'vitest';
import { fireEvent, render, renderHook, act } from '@testing-library/react';
import { QCTab } from '../qc/QCTab';
import { LeadingEdgeGenesView } from '../pathway-explorer/LeadingEdgeGenesView';
import { useSortedRows } from '../common/useSortedRows';
import { buildPopData } from '../data/buildPopData';
import { MACAQUE_DATASET, MACAQUE_CONTRAST, POP_E9_FIXTURE } from './fixtures';
import type { DatasetMeta, PathwayRecordWithDb, RawTrack } from '../types';

// Characterization of the sortable-table comparator shared by QCTab's
// SortableTable and LeadingEdgeGenesView's gene summary. Both used to spell the
// same null-last comparator out for themselves, and NOTHING asserted row order:
// the other QC tests strip the ↑/↓ arrows and only check which columns exist.
//
// The invariant these pin: nulls sort LAST in BOTH directions (the null block
// deliberately returns ±1 un-multiplied by the direction), strings compare with
// localeCompare, and clicking the active header flips the direction rather than
// re-selecting the column.

const noop = () => {};

const tableWith = (container: HTMLElement, header: string) =>
  [...container.querySelectorAll('table')].find((t) =>
    [...t.querySelectorAll('th')].some((th) => (th.textContent ?? '').replace(/[↑↓\s]+$/, '') === header),
  ) as HTMLTableElement;

const firstCells = (table: HTMLTableElement) =>
  [...table.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')?.textContent ?? '');

const headerCell = (table: HTMLTableElement, header: string) =>
  [...table.querySelectorAll('th')].find(
    (th) => (th.textContent ?? '').replace(/[↑↓\s]+$/, '') === header,
  ) as HTMLTableCellElement;

// The sort ACTION lives on a <button> inside the header cell (SortableTh — a
// bare `<th onClick>` is mouse-only), so a click on the cell itself no longer
// sorts. Both tables below are converted, so there is one element to drive; the
// header a11y contract itself is pinned in sortableHeaderA11y.test.tsx.
const clickHeader = (table: HTMLTableElement, header: string) => {
  fireEvent.click(headerCell(table, header).querySelector('button')!);
};

// ── QCTab (SortableTable) ────────────────────────────────────────────────────
// The Sizes table: `minCells` is a nullable number column and `label` a string
// column, so one table exercises both comparator branches.
const meta = {
  populations: ['e9', 'i23', 'e33'],
  labels: { e9: 'Beta', i23: 'alpha', e33: 'Gamma' },
  qcFlags: {
    e9: { is3v3: true, nNormal: 3, nObese: 3, minCells: 5 },
    i23: { is3v3: true, nNormal: 3, nObese: 3 },
    e33: { is3v3: true, nNormal: 3, nObese: 3, minCells: 1 },
  },
  qaReportFilenames: {},
} as unknown as DatasetMeta;

const emptyQc = { runStatus: [], deSummary: [], fgseaSummary: [], composition: {} };

const renderSizes = () => {
  const { container } = render(
    <QCTab onSelectTrack={noop} qcData={emptyQc} meta={meta} />,
  );
  return tableWith(container, 'Min cells');
};

describe('QCTab SortableTable — row order', () => {
  it('renders in source order until a header is clicked', () => {
    expect(firstCells(renderSizes())).toEqual(['e9', 'i23', 'e33']);
  });

  it('sorts a numeric column ascending on first click, nulls last', () => {
    const table = renderSizes();
    clickHeader(table, 'Min cells');
    expect(firstCells(table)).toEqual(['e33', 'e9', 'i23']);
    expect(headerCell(table, 'Min cells').textContent).toBe('Min cells ↑');
  });

  it('flips to descending on a second click and STILL sorts nulls last', () => {
    const table = renderSizes();
    clickHeader(table, 'Min cells');
    clickHeader(table, 'Min cells');
    expect(firstCells(table)).toEqual(['e9', 'e33', 'i23']);
    expect(headerCell(table, 'Min cells').textContent).toBe('Min cells ↓');
  });

  it('sorts a string column with localeCompare, and a new column resets to ascending', () => {
    const table = renderSizes();
    clickHeader(table, 'Min cells');
    clickHeader(table, 'Min cells'); // now descending
    clickHeader(table, 'Label'); // new key → back to ascending
    expect(firstCells(table)).toEqual(['i23', 'e9', 'e33']); // alpha, Beta, Gamma
    expect(headerCell(table, 'Label').textContent).toBe('Label ↑');
    expect(headerCell(table, 'Min cells').textContent).toBe('Min cells');
    clickHeader(table, 'Label');
    expect(firstCells(table)).toEqual(['e33', 'e9', 'i23']);
  });
});

// ── LeadingEdgeGenesView (gene summary) ──────────────────────────────────────
// GHOST is in the cpm matrix but absent from the DE table, so its logFC/PValue/
// FDR are null — the null-last case, in a view whose default sort is PValue.
const TRACK: RawTrack = {
  ...POP_E9_FIXTURE,
  cpm: { ...POP_E9_FIXTURE.cpm, GHOST: [1, 2, 3, 4, 5, 6] },
};
const popData = buildPopData(TRACK, MACAQUE_DATASET, MACAQUE_CONTRAST)!;
const pathway: PathwayRecordWithDb = {
  db: 'GO_BP',
  pathway: 'GOBP_SORT_FIXTURE',
  pval: 0.01,
  padj: 0.05,
  NES: 1.8,
  size: 20,
  leadingEdge: ['POMC', 'IP6K1', 'TBX3', 'GHOST'],
};

const renderGenes = () => {
  const { container } = render(<LeadingEdgeGenesView pathway={pathway} popData={popData} />);
  return tableWith(container, 'Gene');
};

describe('LeadingEdgeGenesView — row order', () => {
  it('defaults to PValue ascending with the DE-less gene last', () => {
    const table = renderGenes();
    // POMC .001 < TBX3 .05 < IP6K1 .127 < GHOST (null)
    expect(firstCells(table)).toEqual(['POMC', 'TBX3', 'IP6K1', 'GHOST']);
    expect(headerCell(table, 'P-value').textContent).toBe('P-value ↑');
  });

  it('flips to descending on a click and STILL sorts the null last', () => {
    const table = renderGenes();
    clickHeader(table, 'P-value');
    expect(firstCells(table)).toEqual(['IP6K1', 'TBX3', 'POMC', 'GHOST']);
    expect(headerCell(table, 'P-value').textContent).toBe('P-value ↓');
  });

  it('sorts the gene column with localeCompare in both directions', () => {
    const table = renderGenes();
    clickHeader(table, 'Gene');
    expect(firstCells(table)).toEqual(['GHOST', 'IP6K1', 'POMC', 'TBX3']);
    clickHeader(table, 'Gene');
    expect(firstCells(table)).toEqual(['TBX3', 'POMC', 'IP6K1', 'GHOST']);
  });

  it('resets to ascending when a different column is picked', () => {
    const table = renderGenes();
    clickHeader(table, 'P-value'); // descending
    clickHeader(table, 'logFC'); // new key → ascending
    // TBX3 -0.8 < IP6K1 0.315 < POMC 1.2 < GHOST (null)
    expect(firstCells(table)).toEqual(['TBX3', 'IP6K1', 'POMC', 'GHOST']);
    expect(headerCell(table, 'logFC').textContent).toBe('logFC ↑');
  });
});

// ── The extracted hook, directly ─────────────────────────────────────────────
interface Row {
  id: string;
  n: number | null;
  name: string;
}
const ROWS: Row[] = [
  { id: 'a', n: 2, name: 'Beta' },
  { id: 'b', n: null, name: 'alpha' },
  { id: 'c', n: 1, name: 'Gamma' },
];
const pick = (r: Row, k: 'n' | 'name') => r[k];
const ids = (rows: Row[]) => rows.map((r) => r.id);

describe('useSortedRows', () => {
  it('returns the rows untouched (same reference) with no sort key', () => {
    const { result } = renderHook(() => useSortedRows<Row, 'n' | 'name'>(ROWS, pick));
    expect(result.current.sorted).toBe(ROWS);
    expect(result.current.sortKey).toBeNull();
    expect(result.current.arrow('n')).toBe('');
  });

  it('sorts numbers ascending then descending, nulls last both ways', () => {
    const { result } = renderHook(() =>
      useSortedRows<Row, 'n' | 'name'>(ROWS, pick, { key: 'n', dir: 1 }),
    );
    expect(ids(result.current.sorted)).toEqual(['c', 'a', 'b']);
    expect(result.current.arrow('n')).toBe(' ↑');
    act(() => result.current.toggle('n'));
    expect(ids(result.current.sorted)).toEqual(['a', 'c', 'b']);
    expect(result.current.arrow('n')).toBe(' ↓');
  });

  it('sorts strings with localeCompare and resets direction on a new key', () => {
    const { result } = renderHook(() => useSortedRows<Row, 'n' | 'name'>(ROWS, pick));
    act(() => result.current.toggle('n'));
    act(() => result.current.toggle('n')); // descending
    act(() => result.current.toggle('name')); // new key → ascending again
    expect(result.current.sortDir).toBe(1);
    expect(ids(result.current.sorted)).toEqual(['b', 'a', 'c']); // alpha, Beta, Gamma
  });

  it('never mutates the input array', () => {
    const rows = [...ROWS];
    const { result } = renderHook(() =>
      useSortedRows<Row, 'n' | 'name'>(rows, pick, { key: 'n', dir: 1 }),
    );
    expect(result.current.sorted).not.toBe(rows);
    expect(ids(rows)).toEqual(['a', 'b', 'c']);
  });
});
