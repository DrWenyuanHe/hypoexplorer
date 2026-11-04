import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppRouter, type ExplorerNavigation } from '../appRouter';
import type { NavigationIntent } from '../explorer/explorerPosition';
import { _resetDatasetMetaCache } from '../data/loadDatasetMeta';

// The router owns WHERE the user is; the explorer adapter owns HOW the shell
// gets into that state. These tests pin the contract between them — previously
// only observable by mounting the whole app and reading rendered DOM, which is
// why "openInExplorer also resets the tab to gene" had no direct coverage.
//
// Deep-link URL handling is covered end-to-end in appDeepLinks.test.tsx; what is
// tested here is the navigation surface itself.

/** One string per intent, so tests can assert the sequence the router sent. */
function describeIntent(intent: NavigationIntent): string {
  switch (intent.type) {
    case 'open':
      return `open:${intent.datasetId}${intent.compare ? '/compare' : intent.trackId ? `/${intent.trackId}` : ''}${intent.tab ? `#${intent.tab}` : ''}`;
    case 'track': return `track:${intent.trackId}`;
    case 'tab': return `tab:${intent.tab}`;
    case 'contrast': return `contrast:${intent.contrastId}`;
    default: return intent.type;
  }
}

function spyExplorer(): ExplorerNavigation & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    navigate: vi.fn((intent: NavigationIntent) => { calls.push(describeIntent(intent)); }),
  };
}

function renderRouter(initialView = 'hub') {
  const explorer = spyExplorer();
  const hook = renderHook(() => useAppRouter(initialView, explorer));
  return { ...hook, explorer };
}

afterEach(() => { window.location.hash = ''; _resetDatasetMetaCache(); });

describe('appRouter — view selection', () => {
  it('starts on the requested view', () => {
    const { result } = renderRouter('explorer');
    expect(result.current.view).toBe('explorer');
  });

  it('goHome returns to the hub', () => {
    const { result } = renderRouter('explorer');
    act(() => { result.current.goHome(); });
    expect(result.current.view).toBe('hub');
  });

  it('routes each report verb to its own view, carrying its parameters', () => {
    const { result } = renderRouter();

    act(() => { result.current.searchGene('POMC'); });
    expect(result.current.view).toBe('report');
    expect(result.current.reportGene).toBe('POMC');
    // An unscoped search means "all categories", not "no categories".
    expect(result.current.reportScope).toBeNull();

    act(() => { result.current.searchPathway('HALLMARK_ADIPOGENESIS'); });
    expect(result.current.view).toBe('pathway-report');
    expect(result.current.reportPathway).toBe('HALLMARK_ADIPOGENESIS');

    act(() => { result.current.searchGene('LEPR', ['Diet-induced obesity']); });
    expect(result.current.view).toBe('report');
    expect(result.current.reportScope).toEqual(['Diet-induced obesity']);

    act(() => { result.current.compareDatasets('LEPR', ['Diet-induced obesity']); });
    expect(result.current.view).toBe('compare-datasets');
    expect(result.current.reportGene).toBe('LEPR');
  });

  it('opens the unified search on a trimmed query, on "all" unless told otherwise', () => {
    const { result } = renderRouter();
    expect(result.current.searchQuery).toBe('');
    expect(result.current.searchFilter).toBe('all');

    act(() => { result.current.search('  Insulin  '); });
    expect(result.current.view).toBe('search');
    // Trimmed, case kept: matching is the page's business.
    expect(result.current.searchQuery).toBe('Insulin');
    expect(result.current.searchFilter).toBe('all');

    act(() => { result.current.search('POMC', 'gene'); });
    expect(result.current.searchQuery).toBe('POMC');
    expect(result.current.searchFilter).toBe('gene');

    // A fresh search resets a filter it does not name.
    act(() => { result.current.search('leptin'); });
    expect(result.current.searchFilter).toBe('all');
  });

  it('changes the search filter in place, leaving the query alone', () => {
    const { result } = renderRouter();
    act(() => { result.current.search('insulin'); });
    act(() => { result.current.setSearchFilter('pathway'); });
    expect(result.current.view).toBe('search');
    expect(result.current.searchQuery).toBe('insulin');
    expect(result.current.searchFilter).toBe('pathway');
  });

  it('opens the tracker focused on a dossier, and unfocused by default', () => {
    const { result } = renderRouter();
    act(() => { result.current.openTracker('GSE220533'); });
    expect(result.current.view).toBe('tracker');
    expect(result.current.trackerSelectedAcc).toBe('GSE220533');

    act(() => { result.current.goHome(); result.current.openTracker(); });
    expect(result.current.trackerSelectedAcc).toBeNull();
  });
});

describe('appRouter — the explorer adapter', () => {
  it('enterTool sends a tab intent and shows the explorer', () => {
    // Whether the tab leaves Compare is the explorer position's rule, not the router's.
    const { result, explorer } = renderRouter();
    act(() => { result.current.enterTool('qc'); });
    expect(explorer.calls).toEqual(['tab:qc']);
    expect(result.current.view).toBe('explorer');
  });

  it('openInExplorer sends ONE open intent naming no tab', () => {
    // No tab means the Gene Explorer: arriving from a report link while the QC
    // tab was last active must not land on QC for a dataset not yet looked at.
    // One intent, so no intermediate position can render between two calls.
    const { result, explorer } = renderRouter();
    act(() => { result.current.openInExplorer('mouse_hypo_hfd_gse220533', 'whole'); });
    expect(explorer.calls).toEqual(['open:mouse_hypo_hfd_gse220533/whole']);
    expect(result.current.view).toBe('explorer');
  });
  it('enterExplorer shows the shell without touching the selected tool', () => {
    const { result, explorer } = renderRouter();
    act(() => { result.current.enterExplorer(); });
    expect(result.current.view).toBe('explorer');
    expect(explorer.calls).toEqual([]);
  });
});

describe('appRouter — the compare set', () => {
  const MACAQUE_I23 = { datasetId: 'macaque_snrna', trackId: 'i23' };
  const MOUSE_WHOLE = { datasetId: 'mouse_hypo_hfd_gse220533', trackId: 'whole' };

  it('opens on the columns it is given, resolving a missing track to the default', () => {
    const { result } = renderRouter();
    act(() => { result.current.openCompareSet([MACAQUE_I23, { datasetId: 'mouse_hypo_hfd_gse220533' }]); });
    expect(result.current.view).toBe('compare-set');
    expect(result.current.compareSetItems).toEqual([MACAQUE_I23, MOUSE_WHOLE]);
  });

  it('drops an unknown dataset and collapses duplicates', () => {
    const { result } = renderRouter();
    act(() => {
      result.current.openCompareSet([
        { datasetId: 'no_such_dataset', trackId: 'x' }, MACAQUE_I23, { ...MACAQUE_I23 }, MOUSE_WHOLE,
      ]);
    });
    expect(result.current.compareSetItems).toEqual([MACAQUE_I23, MOUSE_WHOLE]);
  });

  it('lands in the library when no column survives', () => {
    // Where the next column comes from — not the hub, and not a view of nothing.
    const { result } = renderRouter();
    act(() => { result.current.openCompareSet([{ datasetId: 'no_such_dataset', trackId: 'x' }]); });
    expect(result.current.view).toBe('library');
  });

  it('takes a column removal from the view, and leaves when the last one goes', () => {
    const { result } = renderRouter();
    act(() => { result.current.openCompareSet([MACAQUE_I23, MOUSE_WHOLE]); });
    act(() => { result.current.setCompareSetItems([MOUSE_WHOLE]); });
    expect(result.current.view).toBe('compare-set');
    expect(result.current.compareSetItems).toEqual([MOUSE_WHOLE]);
    act(() => { result.current.setCompareSetItems([]); });
    expect(result.current.view).toBe('library');
  });
});

describe('appRouter — deep-link races', () => {
  it('lets the newest hash win when an earlier route is still validating', async () => {
    // Validating a track means loading the dataset's metadata, so a route can be
    // in flight when the next hash arrives. Without a generation guard, whichever
    // metadata resolved LAST navigated — which is not necessarily the route the
    // user asked for last.
    const explorer = spyExplorer();
    window.location.hash = '#/dataset/macaque_snrna/e9';
    renderHook(() => useAppRouter('hub', explorer));

    // A second hash supersedes the first while its validation is pending.
    await act(async () => {
      window.location.hash = '#/dataset/mouse_hypo_hfd_gse220533';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    const datasetCalls = explorer.calls.filter((c) => c.startsWith('open:'));
    // The last navigation must be the newest hash, never the superseded one.
    expect(datasetCalls[datasetCalls.length - 1]).toBe('open:mouse_hypo_hfd_gse220533');
  });
});

describe('appRouter — verb identity is stable', () => {
  it('keeps the navigation verbs stable when the explorer adapter changes', () => {
    // The shell rebuilds its callbacks whenever its own state changes. If the
    // verbs changed identity with it, every memoized hub tile would re-render on
    // an unrelated explorer keystroke — so the adapter is read through a ref.
    const { result, rerender } = renderHook(
      ({ explorer }) => useAppRouter('hub', explorer),
      { initialProps: { explorer: spyExplorer() } },
    );
    const before = result.current;
    rerender({ explorer: spyExplorer() });

    expect(result.current.goHome).toBe(before.goHome);
    expect(result.current.enterTool).toBe(before.enterTool);
    expect(result.current.openInExplorer).toBe(before.openInExplorer);
    expect(result.current.searchGene).toBe(before.searchGene);
    expect(result.current.openCompareSet).toBe(before.openCompareSet);
    expect(result.current.search).toBe(before.search);
    expect(result.current.setSearchFilter).toBe(before.setSearchFilter);
  });

  it('routes through the LATEST adapter even though the verb is stable', () => {
    // The flip side of the ref: a stable verb must not call a stale adapter.
    const first = spyExplorer();
    const second = spyExplorer();
    const { result, rerender } = renderHook(
      ({ explorer }) => useAppRouter('hub', explorer),
      { initialProps: { explorer: first } },
    );
    rerender({ explorer: second });
    act(() => { result.current.enterTool('qc'); });

    expect(second.calls).toContain('tab:qc');
    expect(first.calls).toEqual([]);
  });
});
