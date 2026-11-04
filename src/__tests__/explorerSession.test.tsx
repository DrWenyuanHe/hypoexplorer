import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  RESET_MATRIX,
  METRIC_DEFAULT_SIG_THRESH,
  PATHWAY_FDR_DEFAULT,
  resetClears,
  useExplorerSession,
  useGeneSelection,
  useVolcanoView,
  usePathwayView,
} from '../explorer/explorerSession';

// Before this module the reset policy was spelled out four times inside App's
// navigation callbacks, and could only be observed by mounting the whole app and
// clicking through it. It is now data plus one loop, so the matrix itself is the
// test surface.

describe('RESET_MATRIX — what each navigation clears', () => {
  it('a TRACK switch drops the selection but keeps how the instrument is set up', () => {
    expect(resetClears('track', 'genes')).toBe(true);
    expect(resetClears('track', 'pathwaySelection')).toBe(true);
    expect(resetClears('track', 'pathwaySearch')).toBe(true);
    // The sidebar filter describes the track LIST, not the selection: clearing
    // it collapsed a filtered sidebar back to full on every click, which broke
    // opening several matches of one query in a row.
    expect(resetClears('track', 'cellSearch')).toBe(false);
  });

  it('a CONTRAST switch keeps the genes — gene names are contrast-independent', () => {
    expect(resetClears('contrast', 'genes')).toBe(false);
    expect(resetClears('contrast', 'cellSearch')).toBe(false);
    // …but drops the pathway selection, whose row carries THIS contrast's stats.
    expect(resetClears('contrast', 'pathwaySelection')).toBe(true);
    expect(resetClears('contrast', 'pathwaySearch')).toBe(true);
  });

  it('a DATASET switch also clears the sidebar filter', () => {
    expect(resetClears('dataset', 'genes')).toBe(true);
    expect(resetClears('dataset', 'pathwaySelection')).toBe(true);
    expect(resetClears('dataset', 'pathwaySearch')).toBe(true);
    expect(resetClears('dataset', 'cellSearch')).toBe(true);
  });

  it('never clears a threshold, the metric, the DB filter or the sort', () => {
    // The cross-track / cross-dataset cutoff sweep is a real workflow: the way
    // the user has configured the instrument survives every navigation. This is
    // asserted over the whole matrix so a new scope cannot quietly opt in.
    const configurable = ['logFCThresh', 'sigThresh', 'metric', 'dbFilter', 'sortKey', 'fdrThresh'];
    for (const fields of Object.values(RESET_MATRIX)) {
      for (const f of configurable) expect(fields).not.toContain(f);
    }
  });

  it('a contrast switch clears strictly less than a track switch, which clears strictly less than a dataset switch', () => {
    const t = new Set(RESET_MATRIX.track);
    const c = new Set(RESET_MATRIX.contrast);
    const d = new Set(RESET_MATRIX.dataset);
    for (const f of c) expect(t.has(f)).toBe(true);
    for (const f of t) expect(d.has(f)).toBe(true);
  });
});

describe('useGeneSelection', () => {
  it('appends, ignores a duplicate, and preserves order', () => {
    const { result } = renderHook(() => useGeneSelection());
    act(() => { result.current.add('POMC'); });
    act(() => { result.current.add('AGRP'); });
    act(() => { result.current.add('POMC'); });
    expect(result.current.genes).toEqual(['POMC', 'AGRP']);
  });

  it('addMany de-duplicates against what is already selected AND within the batch', () => {
    const { result } = renderHook(() => useGeneSelection());
    act(() => { result.current.add('POMC'); });
    act(() => { result.current.addMany(['AGRP', 'POMC', 'LEPR', 'AGRP']); });
    expect(result.current.genes).toEqual(['POMC', 'AGRP', 'LEPR']);
  });

  it('addMany on an empty list is a no-op', () => {
    const { result } = renderHook(() => useGeneSelection());
    const before = result.current.genes;
    act(() => { result.current.addMany([]); });
    expect(result.current.genes).toBe(before);
  });

  it('replaces the whole list in one update, de-duplicated and in order', () => {
    const { result } = renderHook(() => useGeneSelection());
    act(() => { result.current.addMany(['POMC', 'AGRP']); });
    act(() => { result.current.replace(['LEPR', 'NPY', 'LEPR']); });
    expect(result.current.genes).toEqual(['LEPR', 'NPY']);
    act(() => { result.current.replace([]); });
    expect(result.current.genes).toEqual([]);
  });

  it('removes and clears', () => {
    const { result } = renderHook(() => useGeneSelection());
    act(() => { result.current.addMany(['POMC', 'AGRP']); });
    act(() => { result.current.remove('POMC'); });
    expect(result.current.genes).toEqual(['AGRP']);
    act(() => { result.current.clear(); });
    expect(result.current.genes).toEqual([]);
  });
});

describe('useVolcanoView', () => {
  it('selecting a metric also moves the threshold onto that metric\'s scale', () => {
    // The pairing used to live in a JSX onClick inside VolcanoPlot, so nothing
    // outside that one button could apply it. A -log10 p of 2 is not a -log10
    // FDR of 2; changing one without the other leaves the cutoff line adrift.
    const { result } = renderHook(() => useVolcanoView());
    expect(result.current.metric).toBe('pval');
    expect(result.current.sigThresh).toBe(METRIC_DEFAULT_SIG_THRESH.pval);

    act(() => { result.current.selectMetric('fdr'); });
    expect(result.current.metric).toBe('fdr');
    expect(result.current.sigThresh).toBe(METRIC_DEFAULT_SIG_THRESH.fdr);

    act(() => { result.current.selectMetric('pval'); });
    expect(result.current.sigThresh).toBe(METRIC_DEFAULT_SIG_THRESH.pval);
  });

  it('keeps a hand-set threshold until the metric changes', () => {
    const { result } = renderHook(() => useVolcanoView());
    act(() => { result.current.setSigThresh(3.5); });
    expect(result.current.sigThresh).toBe(3.5);
    act(() => { result.current.setLogFCThresh(1); });
    expect(result.current.logFCThresh).toBe(1);
    expect(result.current.sigThresh).toBe(3.5);
  });
});

describe('usePathwayView', () => {
  it('toggles ONE database without disturbing the others', () => {
    const { result } = renderHook(() => usePathwayView<{ id: string }>());
    const before = { ...result.current.dbFilter };
    const [first] = Object.keys(before);
    act(() => { result.current.setDatabaseEnabled(first, false); });
    expect(result.current.dbFilter[first]).toBe(false);
    for (const k of Object.keys(before)) {
      if (k !== first) expect(result.current.dbFilter[k]).toBe(before[k]);
    }
  });

  it('resetFilters restores search, DB filter and FDR — but keeps the sort', () => {
    const { result } = renderHook(() => usePathwayView<{ id: string }>());
    const [first] = Object.keys(result.current.dbFilter);
    act(() => {
      result.current.setSearch('glycolysis');
      result.current.setDatabaseEnabled(first, false);
      result.current.setFdrThresh(0.05);
      result.current.setSortKey('pval');
    });
    act(() => { result.current.resetFilters(); });
    expect(result.current.search).toBe('');
    expect(result.current.dbFilter[first]).toBe(true);
    expect(result.current.fdrThresh).toBe(PATHWAY_FDR_DEFAULT);
    expect(result.current.sortKey).toBe('pval');
  });

  it('select / deselect', () => {
    const { result } = renderHook(() => usePathwayView<{ id: string }>());
    act(() => { result.current.select({ id: 'GO:1' }); });
    expect(result.current.selected).toEqual({ id: 'GO:1' });
    act(() => { result.current.deselect(); });
    expect(result.current.selected).toBeNull();
  });
});

describe('useExplorerSession — resetFor applies the matrix', () => {
  function seed(result: { current: ReturnType<typeof useExplorerSession<{ id: string }>> }) {
    act(() => {
      result.current.genes.addMany(['POMC', 'AGRP']);
      result.current.pathway.select({ id: 'GO:1' });
      result.current.pathway.setSearch('glycolysis');
      result.current.setCellSearch('e9');
      result.current.volcano.setLogFCThresh(1.5);
    });
  }

  it('track: clears the selection, keeps the sidebar filter and the thresholds', () => {
    const { result } = renderHook(() => useExplorerSession<{ id: string }>());
    seed(result);
    act(() => { result.current.resetFor('track'); });
    expect(result.current.genes.genes).toEqual([]);
    expect(result.current.pathway.selected).toBeNull();
    expect(result.current.pathway.search).toBe('');
    expect(result.current.cellSearch).toBe('e9');
    expect(result.current.volcano.logFCThresh).toBe(1.5);
  });

  it('contrast: keeps the genes and the sidebar filter', () => {
    const { result } = renderHook(() => useExplorerSession<{ id: string }>());
    seed(result);
    act(() => { result.current.resetFor('contrast'); });
    expect(result.current.genes.genes).toEqual(['POMC', 'AGRP']);
    expect(result.current.pathway.selected).toBeNull();
    expect(result.current.pathway.search).toBe('');
    expect(result.current.cellSearch).toBe('e9');
    expect(result.current.volcano.logFCThresh).toBe(1.5);
  });

  it('dataset: clears everything selection-shaped, including the sidebar filter', () => {
    const { result } = renderHook(() => useExplorerSession<{ id: string }>());
    seed(result);
    act(() => { result.current.resetFor('dataset'); });
    expect(result.current.genes.genes).toEqual([]);
    expect(result.current.pathway.selected).toBeNull();
    expect(result.current.pathway.search).toBe('');
    expect(result.current.cellSearch).toBe('');
    // Still preserved: the cutoff sweep survives a dataset switch.
    expect(result.current.volcano.logFCThresh).toBe(1.5);
  });
});
