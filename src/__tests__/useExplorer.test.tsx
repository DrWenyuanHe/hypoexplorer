import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useExplorer } from '../explorer/useExplorer';
import { COMPARE_TRACK } from '../explorer/explorerPosition';
import { DB_DEFAULT_FILTER } from '../data/constants';
import { getDefaultDataset, listDatasets } from '../data/datasets';
import type { ExplorerAnalysisState } from '../utils/analysisState';

// The explorer as the router meets it, without mounting App: one intent moves
// the position, the session and Compare together, in a fixed order, and `at`
// reports where that left the explorer.

const HOME = getDefaultDataset();
const OTHER = listDatasets().find((d) => d.id !== HOME.id)!;

function analysis(genes: string[]): ExplorerAnalysisState {
  return {
    version: 1, contrastId: null, genes,
    volcano: { metric: 'fdr', logFCThresh: 0.5, sigThresh: 0.05 },
    pathway: { search: '', dbFilter: { ...DB_DEFAULT_FILTER }, fdrThresh: 1, sortKey: 'nes' },
  };
}

describe('useExplorer', () => {
  it('clears what a dataset move resets before it restores the saved analysis', () => {
    const { result } = renderHook(() => useExplorer(HOME));
    act(() => { result.current.screen.session.genes.addMany(['AGRP']); });
    expect(result.current.screen.session.genes.genes).toEqual(['AGRP']);

    act(() => { result.current.nav.navigate({ type: 'open', datasetId: OTHER.id, analysis: analysis(['POMC']) }); });
    // Reset first, then restore: the shared genes, not the old ones and not nothing.
    expect(result.current.screen.dataset.id).toBe(OTHER.id);
    expect(result.current.screen.session.genes.genes).toEqual(['POMC']);
    expect(result.current.at.analysis?.genes).toEqual(['POMC']);
  });

  it('a plain dataset move clears the session', () => {
    const { result } = renderHook(() => useExplorer(HOME));
    act(() => { result.current.screen.session.genes.addMany(['AGRP']); });
    act(() => { result.current.nav.navigate({ type: 'open', datasetId: OTHER.id }); });
    expect(result.current.screen.session.genes.genes).toEqual([]);
    expect(result.current.at.analysis).toBeUndefined();
  });

  it('lands a Compare link on a new epoch and reports it only while in Compare', () => {
    const { result } = renderHook(() => useExplorer(HOME));
    const epoch = result.current.screen.compare.epoch;
    act(() => {
      result.current.nav.navigate({ type: 'open', datasetId: HOME.id, compare: true, compareView: { genes: ['POMC'] } });
    });
    expect(result.current.screen.isCompare).toBe(true);
    expect(result.current.at).toMatchObject({ datasetId: HOME.id, trackId: COMPARE_TRACK, compare: { genes: ['POMC'] } });
    expect(result.current.screen.compare.epoch).toBe(epoch + 1);

    act(() => { result.current.nav.navigate({ type: 'leaveCompare' }); });
    expect(result.current.screen.isCompare).toBe(false);
    expect(result.current.at.compare).toBeUndefined();
    // The view is still held, so coming back to Compare resumes it.
    expect(result.current.screen.compare.link).toEqual({ genes: ['POMC'] });
  });

  it('a Compare view Compare reports rides in `at` without remounting Compare', () => {
    const { result } = renderHook(() => useExplorer(HOME));
    act(() => { result.current.nav.navigate({ type: 'compare' }); });
    const epoch = result.current.screen.compare.epoch;
    expect(result.current.at.compare).toBeUndefined();
    act(() => { result.current.screen.compare.report({ mode: 'pathways' }); });
    expect(result.current.at.compare).toEqual({ mode: 'pathways' });
    expect(result.current.screen.compare.epoch).toBe(epoch);
  });

  it('keeps nav and showActiveTrack stable while nothing they read changes', () => {
    const { result, rerender } = renderHook(() => useExplorer(HOME));
    const { nav, showActiveTrack } = result.current;
    rerender();
    expect(result.current.nav).toBe(nav);
    expect(result.current.showActiveTrack).toBe(showActiveTrack);
  });
});
