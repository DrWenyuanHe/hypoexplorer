// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePathwayTable, samePathway, PATHWAY_SORTS, type PathwayStatsKeyed } from '../pathway-explorer/pathwayTable';

// The pathway-table rules used to exist twice — once in the single-track Pathway
// Explorer, once in the Compare tab's cross-population view — and were tested
// through neither, because each copy was tangled into a ~300–600 line component.

interface Row extends PathwayStatsKeyed {
  size: number;
}

function row(pathway: string, db: string, NES: number, padj = 0.01, pval = 0.001): Row {
  return { pathway, db, NES, padj, pval, size: 10 };
}

const ROWS: Row[] = [
  row('GLYCOLYSIS', 'GO_BP', 1.2, 0.2, 0.05),
  row('GLYCOLYSIS', 'REACTOME', -2.5, 0.001, 0.0001),
  row('ADIPOGENESIS', 'HALLMARK', 2.0, 0.04, 0.01),
  row('OXPHOS', 'KEGG', -0.5, 0.6, 0.3),
];

const ALL_DBS = { GO_BP: true, HALLMARK: true, KEGG: true, REACTOME: true };

function renderTable(props: Partial<Parameters<typeof usePathwayTable<Row>>[0]> = {}) {
  return renderHook(
    (p: Parameters<typeof usePathwayTable<Row>>[0]) => usePathwayTable<Row>(p),
    {
      initialProps: {
        rows: ROWS, search: '', dbFilter: ALL_DBS, ...props,
      } as Parameters<typeof usePathwayTable<Row>>[0],
    },
  );
}

describe('pathwayTable — pathway identity', () => {
  it('treats the same name in different databases as different pathways', () => {
    // GO and Reactome both publish a "Glycolysis"; keying on the name alone
    // silently merges two different gene sets into one row.
    expect(samePathway(ROWS[0], ROWS[1])).toBe(false);
    expect(samePathway(ROWS[0], { pathway: 'GLYCOLYSIS', db: 'GO_BP' })).toBe(true);
  });

  it('is false for a missing side rather than throwing', () => {
    expect(samePathway(null, ROWS[0])).toBe(false);
    expect(samePathway(ROWS[0], undefined)).toBe(false);
  });
});

describe('pathwayTable — filtering', () => {
  it('drops rows whose database is switched off', () => {
    const { result } = renderTable({ dbFilter: { GO_BP: true, HALLMARK: false, KEGG: false, REACTOME: false } });
    expect(result.current.filtered.map((r) => r.db)).toEqual(['GO_BP']);
  });

  it('matches the search case-insensitively on the pathway name', () => {
    const { result } = renderTable({ search: 'adipo' });
    expect(result.current.filtered.map((r) => r.pathway)).toEqual(['ADIPOGENESIS']);
  });

  it('ignores a whitespace-only search', () => {
    const { result } = renderTable({ search: '   ' });
    expect(result.current.filtered).toHaveLength(ROWS.length);
  });

  it('applies the caller predicate alongside the built-in filters', () => {
    // The single-track view's FDR cutoff arrives this way.
    const { result } = renderTable({ include: (r: Row) => r.padj <= 0.05 });
    expect(result.current.filtered.map((r) => r.pathway).sort())
      .toEqual(['ADIPOGENESIS', 'GLYCOLYSIS']);
  });

  it('does not reorder the caller\'s array', () => {
    // `rows` is derived from popData, which is memoized and shared — sorting it
    // in place would reorder another view's data as a side effect.
    const rows = [...ROWS];
    const snapshot = rows.map((r) => `${r.db}:${r.pathway}`);
    renderTable({ rows, compare: PATHWAY_SORTS.name });
    expect(rows.map((r) => `${r.db}:${r.pathway}`)).toEqual(snapshot);
  });
});

describe('pathwayTable — sort orders', () => {
  it('ranks by effect size for the nes key, largest |NES| first', () => {
    const { result } = renderTable({ compare: PATHWAY_SORTS.nes });
    expect(result.current.filtered.map((r) => r.NES)).toEqual([-2.5, 2.0, 1.2, -0.5]);
  });

  it('ranks by adjusted significance for pval, and by raw p for rawpval', () => {
    const byPadj = renderTable({ compare: PATHWAY_SORTS.pval });
    expect(byPadj.result.current.filtered.map((r) => r.padj)).toEqual([0.001, 0.04, 0.2, 0.6]);

    const byRaw = renderTable({ compare: PATHWAY_SORTS.rawpval });
    expect(byRaw.result.current.filtered.map((r) => r.pval)).toEqual([0.0001, 0.01, 0.05, 0.3]);
  });

  it('leaves the order alone when no comparator is given', () => {
    const { result } = renderTable();
    expect(result.current.filtered.map((r) => r.pathway)).toEqual(ROWS.map((r) => r.pathway));
  });
});

describe('pathwayTable — pagination', () => {
  it('pages the filtered rows', () => {
    const { result } = renderTable({ initialPageSize: 2 });
    expect(result.current.totalPages).toBe(2);
    expect(result.current.displayed).toHaveLength(2);

    act(() => { result.current.setPage(2); });
    expect(result.current.displayed).toHaveLength(2);
    expect(result.current.displayed[0]).toEqual(ROWS[2]);
  });

  it("returns every row when the page size is 'all'", () => {
    const { result } = renderTable({ initialPageSize: 'all' });
    expect(result.current.totalPages).toBe(1);
    expect(result.current.displayed).toHaveLength(ROWS.length);
  });

  it('resets to page 1 when the search narrows the list', () => {
    // The defect both copies carried: the reset effect was written with an empty
    // dependency array, so it only ever ran on mount. It was masked by the clamp
    // below — the user landed on a silently clamped last page instead of the
    // first page of their new results.
    const { result, rerender } = renderHook(
      (p: Parameters<typeof usePathwayTable<Row>>[0]) => usePathwayTable<Row>(p),
      { initialProps: { rows: ROWS, search: '', dbFilter: ALL_DBS, initialPageSize: 1 } },
    );
    act(() => { result.current.setPage(4); });
    expect(result.current.safePage).toBe(4);

    rerender({ rows: ROWS, search: 'GLYCOLYSIS', dbFilter: ALL_DBS, initialPageSize: 1 });
    expect(result.current.page).toBe(1);
    expect(result.current.safePage).toBe(1);
  });

  it('clamps a page that outlives the list it indexes', () => {
    // Belt and braces for the reset above: `page` can still exceed the range for
    // one render, and the table must never render an out-of-range slice.
    const { result, rerender } = renderHook(
      (p: Parameters<typeof usePathwayTable<Row>>[0]) => usePathwayTable<Row>(p),
      { initialProps: { rows: ROWS, search: '', dbFilter: ALL_DBS, initialPageSize: 1 } },
    );
    act(() => { result.current.setPage(4); });
    rerender({ rows: ROWS.slice(0, 2), search: '', dbFilter: ALL_DBS, initialPageSize: 1 });
    expect(result.current.safePage).toBeLessThanOrEqual(result.current.totalPages);
    expect(result.current.displayed).toHaveLength(1);
  });

  it('returns to page 1 when the page size changes', () => {
    const { result } = renderTable({ initialPageSize: 1 });
    act(() => { result.current.setPage(3); });
    act(() => { result.current.setPageSize(2); });
    expect(result.current.page).toBe(1);
  });
});

describe('pathwayTable — selection coherence', () => {
  it('drops a selection the filters have removed', () => {
    // Otherwise the detail panel goes on describing a pathway that is no longer
    // in the table behind it.
    const onDeselect = vi.fn();
    const { rerender } = renderHook(
      (p: Parameters<typeof usePathwayTable<Row>>[0]) => usePathwayTable<Row>(p),
      {
        initialProps: {
          rows: ROWS, search: '', dbFilter: ALL_DBS,
          selected: ROWS[2], onDeselect,
        } as Parameters<typeof usePathwayTable<Row>>[0],
      },
    );
    expect(onDeselect).not.toHaveBeenCalled();

    rerender({
      rows: ROWS, search: 'GLYCOLYSIS', dbFilter: ALL_DBS,
      selected: ROWS[2], onDeselect,
    } as Parameters<typeof usePathwayTable<Row>>[0]);
    expect(onDeselect).toHaveBeenCalled();
  });

  it('keeps a selection that survives the filters', () => {
    const onDeselect = vi.fn();
    renderHook(() => usePathwayTable<Row>({
      rows: ROWS, search: 'GLYCOLYSIS', dbFilter: ALL_DBS,
      selected: ROWS[1], onDeselect,
    }));
    expect(onDeselect).not.toHaveBeenCalled();
  });

  it('does not confuse a same-named pathway from another database', () => {
    // The selection is the Reactome GLYCOLYSIS; filtering to GO_BP only must
    // drop it, even though a row named GLYCOLYSIS is still on screen.
    const onDeselect = vi.fn();
    renderHook(() => usePathwayTable<Row>({
      rows: ROWS,
      search: '',
      dbFilter: { GO_BP: true, HALLMARK: false, KEGG: false, REACTOME: false },
      selected: ROWS[1],
      onDeselect,
    }));
    expect(onDeselect).toHaveBeenCalled();
  });
});
