import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMemo } from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import App from '../App';
import { useAppRouter, type AppRouter, type ExplorerAt, type ExplorerNavigation } from '../appRouter';
import {
  activeTabOf, activeTrackOf, initialPosition, useExplorerPosition, type ExplorerPosition, type NavigationIntent,
} from '../explorer/explorerPosition';
import { _resetDatasetMetaCache } from '../data/loadDatasetMeta';
import { getDataset, getDefaultDataset } from '../data/datasets';
import type { DatasetMeta } from '../types';
import type { ExplorerAnalysisState } from '../utils/analysisState';
import { DB_NAMES } from '../data/constants';

// One navigation attempt at a time, each with its own history write policy.
//
// Every URL event, router verb and user-originated change starts an attempt.
// Only the newest attempt's metadata check may move the app (B2). A followed
// URL is canonicalized in place, so Back never lands on an entry that pushes
// its own canonical form behind itself (B4). A fragment the router does not
// recognize is left in the address bar (B8).

vi.mock('../expression-survey/ExpressionSurveyView', () => ({
  ExpressionSurveyView: () => <h1>Expression survey</h1>,
}));

// A dataset whose metadata the test resolves or rejects by hand: the window
// in which a followed link is still landing.
const held = vi.hoisted(() => ({
  loads: new Map<string, { promise: Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void }>(),
}));

vi.mock('../data/loadDatasetMeta', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/loadDatasetMeta')>();
  return {
    ...actual,
    loadDatasetMeta: (dataset: { id: string }) => {
      const load = held.loads.get(dataset.id);
      return load ? load.promise : actual.loadDatasetMeta(dataset as Parameters<typeof actual.loadDatasetMeta>[0]);
    },
  };
});

const MACAQUE = getDefaultDataset();
const MOUSE = getDataset('mouse_hypo_hfd_gse220533')!;
const COLD_LINK = `/#/dataset/${MOUSE.id}/whole`;
const MOUSE_META = {
  populations: ['whole'],
  labels: { whole: 'Whole hypothalamus' },
  types: { whole: 'Whole tissue' },
  qcFlags: { whole: { nNormal: 7, nObese: 8, is3v3: false } },
  nGenes: { whole: 2 },
} as unknown as DatasetMeta;

/** Hold the mouse dataset's metadata until the test settles it. */
function holdMouseMeta() {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
  promise.catch(() => {});
  held.loads.set(MOUSE.id, { promise, resolve, reject });
  return {
    resolve: () => act(async () => { resolve(MOUSE_META); await promise; }),
    reject: () => act(async () => { reject(new Error('offline')); await promise.catch(() => {}); }),
  };
}

function describeIntent(intent: NavigationIntent): string {
  if (intent.type !== 'open') return intent.type;
  return `open:${intent.datasetId}${intent.compare ? '/compare' : intent.trackId ? `/${intent.trackId}` : ''}`;
}

/** The router over a real explorer position, as App wires it. */
function renderLinkedRouter(initialView = 'hub') {
  const calls: string[] = [];
  const current: { position: ExplorerPosition | null } = { position: null };
  const hook = renderHook(() => {
    const { position, apply } = useExplorerPosition(() => initialPosition(MACAQUE));
    current.position = position;
    const explorer = useMemo<ExplorerNavigation>(() => ({
      navigate: (intent) => { calls.push(describeIntent(intent)); apply(intent); },
    }), [apply]);
    const at = useMemo<ExplorerAt>(() => ({
      datasetId: position.datasetId, trackId: activeTrackOf(position), tab: activeTabOf(position) ?? 'gene',
    }), [position]);
    return useAppRouter(initialView, explorer, at);
  });
  return { ...hook, calls, current };
}

const hash = () => window.location.hash;

/** A link followed in the open tab: the browser makes the entry, then fires hashchange. */
const follow = (url: string) => act(async () => {
  window.history.pushState(null, '', url);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
});

/** Back or Forward, waiting for jsdom's traversal before the router hears of it. */
async function traverse(direction: 'back' | 'forward') {
  const before = window.location.href;
  await act(async () => { window.history[direction](); });
  await waitFor(() => expect(window.location.href).not.toBe(before));
  await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')); });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  held.loads.clear();
  _resetDatasetMetaCache();
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
  held.loads.clear();
});

type Router = AppRouter;

interface SupersedeCase {
  name: string;
  /** Where the user is before following the cold link. */
  before: (r: Router) => void;
  beforeHash: string;
  /** The user-originated change made while the cold link is still landing. */
  change: (r: Router) => void;
  view: string;
  target: string;
}

const SUPERSEDING: SupersedeCase[] = [
  {
    name: 'search', before: (r) => r.openMethodology(), beforeHash: '#/methodology',
    change: (r) => r.search('insulin'), view: 'search', target: '#/search/insulin',
  },
  {
    name: 'goHome', before: (r) => r.openMethodology(), beforeHash: '#/methodology',
    change: (r) => r.goHome(), view: 'hub', target: '',
  },
  {
    name: 'openInExplorer with no track', before: (r) => r.openMethodology(), beforeHash: '#/methodology',
    change: (r) => r.openInExplorer(MACAQUE.id), view: 'explorer', target: `#/dataset/${MACAQUE.id}`,
  },
  {
    name: 'openInExplorer with a track', before: (r) => r.openMethodology(), beforeHash: '#/methodology',
    change: (r) => r.openInExplorer(MACAQUE.id, 'i23'), view: 'explorer', target: `#/dataset/${MACAQUE.id}/i23`,
  },
  {
    name: 'setSearchFilter', before: (r) => r.search('insulin'), beforeHash: '#/search/insulin',
    change: (r) => r.setSearchFilter('gene'), view: 'search', target: '#/search/insulin/genes',
  },
  {
    name: 'setLibraryDataset', before: (r) => r.openLibrary(), beforeHash: '#/library',
    change: (r) => r.setLibraryDataset(MACAQUE.id), view: 'library', target: `#/library/${MACAQUE.id}`,
  },
  {
    name: 'setCompareSetItems([])',
    before: (r) => r.openCompareSet([{ datasetId: MACAQUE.id, trackId: 'i23' }, { datasetId: MOUSE.id }]),
    beforeHash: `#/compare-set/${MACAQUE.id}:i23,${MOUSE.id}`,
    change: (r) => r.setCompareSetItems([]), view: 'library', target: '#/library',
  },
];

describe('a user change supersedes a pending landing (B2)', () => {
  describe.each(SUPERSEDING)('$name', ({ before, beforeHash, change, view, target }) => {
    async function midLanding() {
      const meta = holdMouseMeta();
      const linked = renderLinkedRouter();
      act(() => { before(linked.result.current); });
      await waitFor(() => expect(hash()).toBe(beforeHash));
      await follow(COLD_LINK);
      act(() => { change(linked.result.current); });
      return { ...linked, meta };
    }

    async function thenNavigateOnce(result: { current: Router }) {
      act(() => { result.current.openNomenclature(); });
      await waitFor(() => expect(hash()).toBe('#/nomenclature'));
      expect(result.current.view).toBe('nomenclature');
    }

    it('wins after the old metadata resolves', async () => {
      const { result, meta, current } = await midLanding();
      await meta.resolve();
      await waitFor(() => expect(hash()).toBe(target));
      expect(result.current.view).toBe(view);
      expect(current.position?.datasetId).toBe(MACAQUE.id);
      await thenNavigateOnce(result);
    });

    it('wins after the old metadata rejects', async () => {
      const { result, meta, current } = await midLanding();
      await meta.reject();
      await waitFor(() => expect(hash()).toBe(target));
      expect(result.current.view).toBe(view);
      expect(current.position?.datasetId).toBe(MACAQUE.id);
      await thenNavigateOnce(result);
    });
  });

  it('lets a search win over an openInExplorer still verifying its track', async () => {
    // A verified in-app open is an attempt like a followed link, so a later
    // change supersedes it the same way.
    const meta = holdMouseMeta();
    const { result, current } = renderLinkedRouter();
    act(() => { result.current.openInExplorer(MOUSE.id, 'whole'); });
    act(() => { result.current.search('leptin'); });
    await meta.resolve();
    await waitFor(() => expect(hash()).toBe('#/search/leptin'));
    expect(result.current.view).toBe('search');
    expect(current.position?.datasetId).toBe(MACAQUE.id);
  });

  it('is not superseded by a view echoing the state it was opened with', async () => {
    // Views report their state on mount. Only a real change is user-originated,
    // or a page mounting under a pending landing would cancel it.
    const meta = holdMouseMeta();
    const { result, current } = renderLinkedRouter();
    act(() => { result.current.openLibrary({ datasetId: MACAQUE.id }); });
    await waitFor(() => expect(hash()).toBe(`#/library/${MACAQUE.id}`));
    await follow(COLD_LINK);
    act(() => {
      result.current.setLibraryDataset(MACAQUE.id);
      result.current.setSearchFilter('all');
      result.current.setGeneStudySelection((s) => ({ ...s }));
    });
    await meta.resolve();
    await waitFor(() => expect(current.position?.datasetId).toBe(MOUSE.id));
    expect(result.current.view).toBe('explorer');
    await waitFor(() => expect(hash()).toBe(`#/dataset/${MOUSE.id}`));
  });

  it('lets supersede() retire a landing for a change the router does not make itself', async () => {
    // The shell's own track, tab and contrast controls call supersede() and
    // then navigate; the address bar follows them, not the abandoned link.
    const meta = holdMouseMeta();
    const linked = renderLinkedRouter();
    act(() => { linked.result.current.openInExplorer(MACAQUE.id); });
    await waitFor(() => expect(hash()).toBe(`#/dataset/${MACAQUE.id}`));
    await follow(COLD_LINK);
    act(() => { linked.result.current.supersede(); });
    await meta.resolve();
    expect(linked.current.position?.datasetId).toBe(MACAQUE.id);
    await waitFor(() => expect(hash()).toBe(`#/dataset/${MACAQUE.id}`));
  });

  it('keeps supersede referentially stable', () => {
    const { result, rerender } = renderHook(
      ({ explorer }) => useAppRouter('hub', explorer),
      { initialProps: { explorer: { navigate: vi.fn() } as ExplorerNavigation } },
    );
    const before = result.current.supersede;
    expect(before).toBeTypeOf('function');
    act(() => { result.current.openMethodology(); });
    rerender({ explorer: { navigate: vi.fn() } });
    expect(result.current.supersede).toBe(before);
  });
});

describe('a followed URL is canonicalized in place (B4)', () => {
  it('lets Back leave an explicit default-track link', async () => {
    const { result } = renderLinkedRouter();
    act(() => { result.current.openMethodology(); });
    await waitFor(() => expect(hash()).toBe('#/methodology'));

    // The explicit default track is not how the app names the dataset.
    await follow(`/#/dataset/${MACAQUE.id}/${MACAQUE.defaultTrack}`);
    await waitFor(() => expect(hash()).toBe(`#/dataset/${MACAQUE.id}`));
    expect(result.current.view).toBe('explorer');

    act(() => { result.current.openLibrary(); });
    await waitFor(() => expect(hash()).toBe('#/library'));
    const depth = window.history.length;

    await traverse('back');
    await waitFor(() => expect(result.current.view).toBe('explorer'));
    expect(hash()).toBe(`#/dataset/${MACAQUE.id}`);

    // The second Back reaches the page before the link, not the raw link
    // re-canonicalizing itself forward.
    await traverse('back');
    await waitFor(() => expect(result.current.view).toBe('methodology'));
    expect(hash()).toBe('#/methodology');
    expect(window.history.length).toBe(depth);

    await traverse('forward');
    await waitFor(() => expect(result.current.view).toBe('explorer'));
    expect(hash()).toBe(`#/dataset/${MACAQUE.id}`);
    expect(window.history.length).toBe(depth);
  });
});

describe('an unrecognized fragment is preserved (B8)', () => {
  it('keeps an anchor the app was opened at, and pushes the next page behind it', async () => {
    window.history.replaceState(null, '', '/#some-anchor');
    const before = window.history.length;
    const { result } = renderLinkedRouter();
    await act(async () => {});
    expect(result.current.view).toBe('hub');
    expect(hash()).toBe('#some-anchor');
    expect(window.history.length).toBe(before);

    act(() => { result.current.openLibrary({ datasetId: MACAQUE.id }); });
    await waitFor(() => expect(hash()).toBe(`#/library/${MACAQUE.id}`));
    expect(window.history.length).toBe(before + 1);
  });

  it('keeps an anchor that arrives while a link is landing, and the view with it', async () => {
    const meta = holdMouseMeta();
    const { result, current } = renderLinkedRouter();
    act(() => { result.current.openMethodology(); });
    await waitFor(() => expect(hash()).toBe('#/methodology'));
    await follow(COLD_LINK);
    await follow('/#some-anchor');
    const depth = window.history.length;

    await meta.resolve();
    expect(result.current.view).toBe('methodology');
    expect(current.position?.datasetId).toBe(MACAQUE.id);
    expect(hash()).toBe('#some-anchor');
    expect(window.history.length).toBe(depth);

    act(() => { result.current.openLibrary(); });
    await waitFor(() => expect(hash()).toBe('#/library'));
    expect(window.history.length).toBe(depth + 1);
  });
});

describe('write policy', () => {
  const ANALYSIS: ExplorerAnalysisState = {
    version: 1, contrastId: null, genes: ['POMC'], chartScale: 'log2',
    volcano: { metric: 'fdr', logFCThresh: 1, sigThresh: 0.05 },
    pathway: { search: '', dbFilter: Object.fromEntries(DB_NAMES.map((db) => [db, true])), fdrThresh: 0.05, sortKey: 'pval' },
  };

  it('replaces a change that moves only settings', async () => {
    const at: ExplorerAt = { datasetId: MACAQUE.id, trackId: MACAQUE.defaultTrack, tab: 'gene' };
    const { result, rerender } = renderHook(
      ({ pos }: { pos: ExplorerAt }) => useAppRouter('hub', { navigate: vi.fn() }, pos),
      { initialProps: { pos: at } },
    );
    act(() => { result.current.enterExplorer(); });
    await waitFor(() => expect(hash()).toBe(`#/dataset/${MACAQUE.id}`));
    const depth = window.history.length;

    rerender({ pos: { ...at, analysis: ANALYSIS } });
    await waitFor(() => expect(hash()).toMatch(new RegExp(`^#/dataset/${MACAQUE.id}\\?analysis=`)));
    expect(window.history.length).toBe(depth);
  });

  it('writes a no-hash initialView mount by replace', async () => {
    const before = window.history.length;
    const at: ExplorerAt = { datasetId: MACAQUE.id, trackId: 'i23', tab: 'gene' };
    renderHook(() => useAppRouter('explorer', { navigate: vi.fn() }, at));
    await waitFor(() => expect(hash()).toBe(`#/dataset/${MACAQUE.id}/i23`));
    expect(window.history.length).toBe(before);
  });
});

describe('a router-delivered intent does not supersede its own landing', () => {
  it('canonicalizes a booted explorer link in place through the whole app', async () => {
    // App's explorer adapter is the raw `navigate`; were it to call
    // supersede(), the landing would push its own canonical entry.
    window.history.replaceState(null, '', `/#/dataset/${MACAQUE.id}/${MACAQUE.defaultTrack}`);
    const before = window.history.length;
    render(<App />);
    await waitFor(() => expect(hash()).toBe(`#/dataset/${MACAQUE.id}`));
    expect(window.history.length).toBe(before);
  });
});
