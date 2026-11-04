import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { useAppRouter, type ExplorerNavigation } from '../appRouter';
import { hubSections } from '../hub/LandingHub';
import { LocalExplorer } from '../local-datasets/LocalExplorer';
import type { LocalDataset } from '../local-datasets/types';
import { parseRoute, routeHref } from '../utils/appLinks';

function router() {
  const explorer: ExplorerNavigation = { navigate: vi.fn() };
  return { ...renderHook(() => useAppRouter('hub', explorer)), explorer };
}

beforeEach(() => { window.history.replaceState(null, '', '/'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

describe('local dataset navigation', () => {
  it('round-trips a parameter-free route and refuses identifier-bearing variants', () => {
    expect(routeHref({ view: 'local-datasets' })).toBe('#/local-datasets');
    for (const hash of ['#/local-datasets', '#/local-datasets/', '/local-datasets']) {
      expect(parseRoute(hash)).toEqual({ view: 'local-datasets' });
    }
    expect(parseRoute('#/local-datasets/private-dataset')).toBeNull();
    expect(parseRoute('#/local-datasets?gene=private-gene')).toBeNull();
  });

  it('opens the live hub entry without selecting or requesting a public dataset', async () => {
    const { result, explorer } = router();
    const sections = hubSections({
      onOpenSearch: vi.fn(),
      onOpenTracker: vi.fn(),
      onOpenLibrary: vi.fn(),
      onOpenLocalDatasets: result.current.openLocalDatasets,
    }, { nDatasets: 145 });
    const entry = sections.flatMap((section) => section.items).find((item) => item.name === 'Explore Local Datasets');
    expect(entry?.status).toBe('live');
    expect(entry?.desc).toContain('Your files stay in this browser');
    act(() => { entry!.go(); });
    await waitFor(() => expect(result.current.view).toBe('local-datasets'));
    expect(window.location.hash).toBe('#/local-datasets');
    expect(explorer.navigate).not.toHaveBeenCalled();
  });

  it('opens the local workspace immediately from a direct link and preserves it on remount', () => {
    window.history.replaceState(null, '', '/#/local-datasets');
    const first = router();
    expect(first.result.current.view).toBe('local-datasets');
    expect(first.result.current.reportGene).toBeNull();
    expect(first.result.current.reportPathway).toBeNull();
    first.unmount();
    const reloaded = router();
    expect(reloaded.result.current.view).toBe('local-datasets');
    expect(window.location.hash).toBe('#/local-datasets');
    expect(reloaded.explorer.navigate).not.toHaveBeenCalled();
  });

  it('returns to the workspace with browser Back and removes its hash on Home', async () => {
    const { result } = router();
    act(() => { result.current.openLocalDatasets(); });
    await waitFor(() => expect(window.location.hash).toBe('#/local-datasets'));
    act(() => { result.current.openStatistics(); });
    await waitFor(() => expect(window.location.hash).toBe('#/statistics'));
    await act(async () => { window.history.back(); });
    await waitFor(() => expect(result.current.view).toBe('local-datasets'));
    expect(window.location.hash).toBe('#/local-datasets');
    act(() => { result.current.goHome(); });
    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(result.current.view).toBe('hub');
  });

  it('keeps gene and pathway selections out of the URL and browser history state', () => {
    window.history.replaceState(null, '', '/#/local-datasets');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const fetch = vi.spyOn(globalThis, 'fetch');
    const dataset: LocalDataset = {
      id: 'PRIVATE_DATASET', name: 'Private comparison', organism: 'Homo sapiens',
      createdAt: '', updatedAt: '', sources: [],
      genes: [{ gene: 'PRIVATE_GENE', logFC: 2, pvalue: 0.001, padj: 0.01, source: 'PRIVATE_FILE.csv' }],
      pathways: [{ pathway: 'PRIVATE_PATHWAY', name: 'PRIVATE_PATHWAY', database: 'Custom', nes: 1.5, pvalue: 0.01, padj: 0.02, size: 1, genes: ['PRIVATE_GENE'], source: 'PRIVATE_FGSEA.csv' }],
    };
    render(<LocalExplorer datasets={[dataset]} activeId={dataset.id} onSelectDataset={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'PRIVATE_GENE' }));
    const detail = screen.getByRole('region', { name: 'Selected local result' });
    fireEvent.click(within(detail).getByRole('button', { name: /PRIVATE PATHWAY/ }));
    expect(within(detail).getByText('Supplied genes')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/local-datasets');
    expect(window.location.search).toBe('');
    expect(JSON.stringify(window.history.state)).not.toContain('PRIVATE_');
    expect(fetch).not.toHaveBeenCalled();
  });
});
