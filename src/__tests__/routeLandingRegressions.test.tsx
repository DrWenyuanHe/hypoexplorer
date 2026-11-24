import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMemo } from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { useAppRouter, type ExplorerAt, type ExplorerNavigation } from '../appRouter';
import {
  activeTabOf, activeTrackOf, initialPosition, useExplorerPosition, type ExplorerPosition,
} from '../explorer/explorerPosition';
import { _resetDatasetMetaCache } from '../data/loadDatasetMeta';
import { getDefaultDataset } from '../data/datasets';
import { _resetChartScaleStore, getSnapshot, setChartScale } from '../common/chartScaleStore';
import type { ExplorerAnalysisState } from '../utils/analysisState';
import { DB_NAMES } from '../data/constants';
import { parseRoute } from '../utils/appLinks';

// Regressions the route-landing extraction fixes. Each one failed on the
// router as it was when boot (`bootState`) and Back/Forward (`applyRoute`)
// read a route separately and disagreed.

vi.mock('../expression-survey/ExpressionSurveyView', () => ({
  ExpressionSurveyView: () => <h1>Expression survey</h1>,
}));

const MACAQUE = getDefaultDataset();

const ANALYSIS: ExplorerAnalysisState = {
  version: 1, contrastId: null, genes: [], chartScale: 'log2',
  volcano: { metric: 'fdr', logFCThresh: 1, sigThresh: 0.05 },
  pathway: { search: '', dbFilter: Object.fromEntries(DB_NAMES.map((db) => [db, true])), fdrThresh: 0.05, sortKey: 'pval' },
};
const analysisQuery = (analysis: unknown) => `analysis=${encodeURIComponent(JSON.stringify(analysis))}`;

const hash = () => window.location.hash;
const follow = (url: string) => act(async () => {
  window.history.replaceState(null, '', url);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
});

/** The router over a real explorer position, as App wires it. */
function renderLinkedRouter() {
  const current: { position: ExplorerPosition | null } = { position: null };
  const hook = renderHook(() => {
    const { position, apply } = useExplorerPosition(() => initialPosition(MACAQUE));
    current.position = position;
    const explorer = useMemo<ExplorerNavigation>(() => ({ navigate: apply }), [apply]);
    const at = useMemo<ExplorerAt>(() => ({
      datasetId: position.datasetId, trackId: activeTrackOf(position), tab: activeTabOf(position) ?? 'gene',
    }), [position]);
    return useAppRouter('hub', explorer, at);
  });
  return { ...hook, current };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  _resetDatasetMetaCache();
  _resetChartScaleStore();
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
  _resetChartScaleStore();
});

describe('a refused link applies nothing (B1)', () => {
  it.each([
    ['an unknown dataset', `/#/dataset/no_such_dataset?${analysisQuery(ANALYSIS)}`],
    ['an unknown contrast', `/#/dataset/${MACAQUE.id}?${analysisQuery({ ...ANALYSIS, contrastId: 'no_such_contrast' })}`],
  ])('leaves the saved chart scale alone when booting on %s', (_label, url) => {
    // The analysis itself is well-formed; only the registry refuses it.
    expect(parseRoute(url.slice(1))).not.toBeNull();
    setChartScale('linear');
    window.history.replaceState(null, '', url);
    const { result } = renderHook(() => useAppRouter('hub', { navigate: vi.fn() }));
    expect(result.current.routeError).not.toBeNull();
    expect(getSnapshot()).toBe('linear');
  });
});

describe('a URL destination is absolute (B3)', () => {
  it('lands a trackless dataset link on the default track when another track is open', async () => {
    const { result, current } = renderLinkedRouter();
    act(() => { result.current.openInExplorer(MACAQUE.id, 'i23'); });
    await waitFor(() => expect(hash()).toBe(`#/dataset/${MACAQUE.id}/i23`));

    // Back to the canonical dataset address.
    await act(async () => {
      window.history.replaceState(null, '', `/#/dataset/${MACAQUE.id}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(current.position?.focus).toMatchObject({ kind: 'track', trackId: MACAQUE.defaultTrack }));
    expect(hash()).toBe(`#/dataset/${MACAQUE.id}`);
  });

  it('lands an unknown track on the default track, not the one already open', async () => {
    const { result, current } = renderLinkedRouter();
    act(() => { result.current.openInExplorer(MACAQUE.id, 'i23'); });
    await waitFor(() => expect(hash()).toBe(`#/dataset/${MACAQUE.id}/i23`));

    await follow(`/#/dataset/${MACAQUE.id}/no_such_track`);
    await waitFor(() => expect(current.position?.focus).toMatchObject({ kind: 'track', trackId: MACAQUE.defaultTrack }));
    await waitFor(() => expect(hash()).toBe(`#/dataset/${MACAQUE.id}`));
  });
});

describe('an unknown dataset pasted mid-session is cleaned away (B5)', () => {
  it('keeps the view and restores its address', async () => {
    const { result } = renderHook(() => useAppRouter('hub', { navigate: vi.fn() }));
    act(() => { result.current.openMethodology(); });
    await waitFor(() => expect(hash()).toBe('#/methodology'));

    await follow('/#/dataset/no_such_dataset');
    expect(result.current.view).toBe('methodology');
    await waitFor(() => expect(hash()).toBe('#/methodology'));
  });
});

describe('a bad analysis refuses a Compare link in any query position (B6)', () => {
  const bad = encodeURIComponent('{"version":99}');
  it.each([
    `#/dataset/${MACAQUE.id}/compare?analysis=${bad}`,
    `#/dataset/${MACAQUE.id}/compare?pops=e9,i23&analysis=${bad}`,
    `#/dataset/${MACAQUE.id}/compare?genes=POMC&analysis=${bad}`,
  ])('refuses %s at boot', (url) => {
    window.history.replaceState(null, '', `/${url}`);
    const { result } = renderHook(() => useAppRouter('hub', { navigate: vi.fn() }));
    expect(result.current.routeError).toMatch(/saved analysis is invalid/);
  });

  it('refuses one followed mid-session', async () => {
    const navigate = vi.fn();
    const { result } = renderHook(() => useAppRouter('hub', { navigate }));
    await follow(`/#/dataset/${MACAQUE.id}/compare?pops=e9,i23&analysis=${bad}`);
    expect(result.current.routeError).toMatch(/saved analysis is invalid/);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('still ignores an unrecognized query that carries no analysis', () => {
    window.history.replaceState(null, '', `/#/dataset/${MACAQUE.id}/compare?pops=e9,i23&junk=1`);
    const { result } = renderHook(() => useAppRouter('hub', { navigate: vi.fn() }));
    expect(result.current.routeError).toBeNull();
    expect(result.current.view).toBe('hub');
  });
});

describe('the error page renders ahead of every view (B7)', () => {
  it('shows a refused link followed from the expression survey', async () => {
    window.history.replaceState(null, '', '/#/expression');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Expression survey' })).toBeInTheDocument();

    await follow(`/#/dataset/no_such_dataset?${analysisQuery(ANALYSIS)}`);
    expect(await screen.findByRole('heading', { name: 'Analysis link unavailable' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Expression survey' })).not.toBeInTheDocument();
  });
});
