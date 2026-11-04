import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useMemo } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAppRouter, type ExplorerNavigation, type ExplorerAt } from '../appRouter';
import {
  activeTabOf, activeTrackOf, initialPosition, useExplorerPosition, type ExplorerPosition, type NavigationIntent,
} from '../explorer/explorerPosition';
import { _resetDatasetMetaCache } from '../data/loadDatasetMeta';
import { getDataset, getDefaultDataset } from '../data/datasets';

// The URL used to be read-only: deep links resolved on load, but the app's own
// navigation never touched the address bar, so all eight views and every dataset
// shared the URL `hypoexplorer.com`. These tests pin the write direction — and,
// more importantly, the places where writing can eat the thing it is supposed to
// preserve.

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

const MACAQUE = getDefaultDataset();
const MOUSE = getDataset('mouse_hypo_hfd_gse220533')!;

/** Mount the router with a fixed explorer position, as App does. */
function renderRouter(at?: Partial<ExplorerAt>) {
  const explorer = spyExplorer();
  const position: ExplorerAt = {
    datasetId: MACAQUE.id,
    trackId: MACAQUE.defaultTrack,
    tab: 'gene',
    ...at,
  };
  const hook = renderHook(
    ({ pos }: { pos: ExplorerAt }) => useAppRouter('hub', explorer, pos),
    { initialProps: { pos: position } },
  );
  return { ...hook, explorer };
}

/**
 * Mount the router with an explorer that actually MOVES when told to, the way
 * App's does: the real explorer position applies each intent, and the router
 * serializes where it lands.
 *
 * The fixed-position harness above is enough for testing what a given position
 * serializes to, but not for anything about the window between "a route was
 * read" and "the shell has caught up with it": with a position that never
 * changes, the router is correctly writing a stale URL and the test would be
 * asserting against its own harness.
 */
function renderLinkedRouter() {
  const calls: string[] = [];
  const current: { position: ExplorerPosition | null; navigate: ExplorerNavigation['navigate'] | null } = { position: null, navigate: null };
  const hook = renderHook(() => {
    const { position, apply } = useExplorerPosition(() => initialPosition(MACAQUE));
    current.position = position;
    const explorer = useMemo<ExplorerNavigation>(() => ({
      navigate: (intent) => { calls.push(describeIntent(intent)); apply(intent); },
    }), [apply]);
    current.navigate = explorer.navigate;
    const at = useMemo<ExplorerAt>(() => ({
      datasetId: position.datasetId, trackId: activeTrackOf(position), tab: activeTabOf(position) ?? 'gene',
    }), [position]);
    return useAppRouter('hub', explorer, at);
  });
  return { ...hook, calls, current };
}

const hash = () => window.location.hash;

// The mouse dataset's metadata is not seeded globally the way the macaque
// default is, and validating a track loads it. Without this the loader falls
// through to its script-injection transport, which resolves nothing in jsdom.
function seedMouseDataset() {
  (window as any).HX_MOUSE_HYPO_HFD_GSE220533_META = {
    populations: ['whole'],
    labels: { whole: 'Whole hypothalamus' },
    types: { whole: 'Whole tissue' },
    qcFlags: { whole: { nNormal: 7, nObese: 8, is3v3: false } },
    nGenes: { whole: 2 },
  };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  _resetDatasetMetaCache();
});

afterEach(() => {
  delete (window as any).HX_MOUSE_HYPO_HFD_GSE220533_META;
});

describe('appRouter — navigation writes the URL', () => {
  it('gives each view its own address', async () => {
    const { result } = renderRouter();

    act(() => { result.current.searchGene('POMC'); });
    await waitFor(() => expect(hash()).toBe('#/gene/POMC'));

    act(() => { result.current.searchGene('LEPR', ['Diet-induced obesity']); });
    await waitFor(() => expect(hash()).toBe('#/gene/LEPR/Diet-induced%20obesity'));

    act(() => { result.current.searchPathway('HALLMARK_ADIPOGENESIS'); });
    await waitFor(() => expect(hash()).toBe('#/pathway/HALLMARK_ADIPOGENESIS'));

    act(() => { result.current.compareDatasets('LEPR', null); });
    await waitFor(() => expect(hash()).toBe('#/compare/LEPR'));

    act(() => { result.current.openTracker('GSE220533'); });
    await waitFor(() => expect(hash()).toBe('#/tracker/GSE220533'));

    act(() => { result.current.openLibrary({ datasetId: 'macaque_snrna' }); });
    await waitFor(() => expect(hash()).toBe('#/library/macaque_snrna'));

    act(() => { result.current.openLibrary({ categories: ['Circadian'] }); });
    await waitFor(() => expect(hash()).toBe('#/library/in/Circadian'));

    // Entering the library is a fresh start: the scope from the previous entry
    // must not survive into a link that no longer claims it.
    act(() => { result.current.openLibrary(); });
    await waitFor(() => expect(hash()).toBe('#/library'));

    act(() => { result.current.openStatistics(); });
    await waitFor(() => expect(hash()).toBe('#/statistics'));

    act(() => { result.current.search('insulin secretion'); });
    await waitFor(() => expect(hash()).toBe('#/search/insulin%20secretion'));

    act(() => { result.current.setSearchFilter('pathway'); });
    await waitFor(() => expect(hash()).toBe('#/search/insulin%20secretion/pathways'));

    act(() => { result.current.search(''); });
    await waitFor(() => expect(hash()).toBe('#/search'));

    // A compare set names its columns. The mouse study sits on its default
    // track, so that track is implied and left out; the macaque population is
    // not the default, so it is spelled.
    act(() => {
      result.current.openCompareSet([
        { datasetId: MACAQUE.id, trackId: 'i23' },
        { datasetId: MOUSE.id, trackId: MOUSE.defaultTrack },
      ]);
    });
    await waitFor(() => expect(hash()).toBe(`#/compare-set/${MACAQUE.id}:i23,${MOUSE.id}`));
  });

  it('returns the hub to the bare site root, with no fragment left behind', async () => {
    const { result } = renderRouter();
    act(() => { result.current.openStatistics(); });
    await waitFor(() => expect(hash()).toBe('#/statistics'));

    act(() => { result.current.goHome(); });
    // Not '#/' — landing on the hub should leave hypoexplorer.com looking like
    // hypoexplorer.com.
    await waitFor(() => expect(hash()).toBe(''));
  });

  it('names the dataset the explorer is actually on', async () => {
    const { result, rerender } = renderRouter();
    act(() => { result.current.enterExplorer(); });
    // The default track is implied by the dataset, so it is left out — the same
    // short form the cross-dataset report's links already use.
    await waitFor(() => expect(hash()).toBe(`#/dataset/${MACAQUE.id}`));

    // A different dataset, also on its default track: still the short form.
    rerender({ pos: { datasetId: MOUSE.id, trackId: MOUSE.defaultTrack, tab: 'gene' } });
    await waitFor(() => expect(hash()).toBe(`#/dataset/${MOUSE.id}`));

    // A non-default track is what actually needs naming.
    rerender({ pos: { datasetId: MACAQUE.id, trackId: 'i23', tab: 'gene' } });
    await waitFor(() => expect(hash()).toBe(`#/dataset/${MACAQUE.id}/i23`));
  });

  it('carries the selected tab, spelling out the track it has to sit behind', async () => {
    const { result, rerender } = renderRouter();
    act(() => { result.current.enterExplorer(); });
    await waitFor(() => expect(hash()).toBe(`#/dataset/${MACAQUE.id}`));

    // The segments are positional, so a tab on the DEFAULT track still forces
    // the track back into the URL rather than sliding into its slot.
    rerender({ pos: { datasetId: MACAQUE.id, trackId: MACAQUE.defaultTrack, tab: 'qc' } });
    await waitFor(() => expect(hash()).toBe(`#/dataset/${MACAQUE.id}/${MACAQUE.defaultTrack}/qc`));
  });

  it('writes no URL for the explorer until the shell reports where it is', () => {
    // App always passes a position; a caller that does not (the navigation-verb
    // tests) must not get a guessed dataset written into the address bar.
    const explorer = spyExplorer();
    const { result } = renderHook(() => useAppRouter('hub', explorer));
    act(() => { result.current.enterExplorer(); });
    expect(hash()).toBe('');
  });
});

describe('appRouter — the URL is a history stack', () => {
  it('pushes each navigation so Back returns to the previous view', async () => {
    const { result } = renderRouter();

    act(() => { result.current.searchGene('POMC'); });
    await waitFor(() => expect(hash()).toBe('#/gene/POMC'));
    act(() => { result.current.openStatistics(); });
    await waitFor(() => expect(hash()).toBe('#/statistics'));

    await act(async () => {
      window.history.back();
      // jsdom applies the traversal but does not always deliver popstate to
      // listeners synchronously; dispatch it so the handler runs deterministically.
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => {
      expect(result.current.view).toBe('report');
      expect(result.current.reportGene).toBe('POMC');
    });
  });

  it('restores query and filter when Back and Forward move between two searches', async () => {
    const { result } = renderRouter();
    const back = async () => {
      await act(async () => {
        window.history.back();
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
    };

    act(() => { result.current.search('insulin', 'pathway'); });
    await waitFor(() => expect(hash()).toBe('#/search/insulin/pathways'));
    act(() => { result.current.search('POMC'); });
    await waitFor(() => expect(hash()).toBe('#/search/POMC'));

    await back();
    await waitFor(() => {
      expect(result.current.view).toBe('search');
      expect(result.current.searchQuery).toBe('insulin');
      expect(result.current.searchFilter).toBe('pathway');
    });

    await act(async () => {
      window.history.forward();
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => {
      expect(result.current.searchQuery).toBe('POMC');
      expect(result.current.searchFilter).toBe('all');
    });
  });

  it('pushes a filter change, so Back returns to the previous breakdown', async () => {
    // The filter is a path segment, and the router pushes every path change
    // made after arrival (a report's scope does the same).
    const { result } = renderRouter();
    act(() => { result.current.search('insulin'); });
    await waitFor(() => expect(hash()).toBe('#/search/insulin'));
    const depth = window.history.length;

    act(() => { result.current.setSearchFilter('gene'); });
    await waitFor(() => expect(hash()).toBe('#/search/insulin/genes'));
    expect(window.history.length).toBe(depth + 1);

    await act(async () => {
      window.history.back();
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(result.current.searchFilter).toBe('all'));
    expect(result.current.searchQuery).toBe('insulin');
  });

  it('does not push a synthetic entry when it normalizes the URL on arrival', async () => {
    // The first write REPLACES. If it pushed, Back from the landing page would
    // put the user back on the site instead of leaving it.
    window.history.replaceState(null, '', '/#/dataset/no_such_dataset');
    const before = window.history.length;
    renderRouter();
    // Unknown dataset → the router stays on the hub and cleans up the stale hash.
    await waitFor(() => expect(hash()).toBe(''));
    expect(window.history.length).toBe(before);
  });

  it('re-applies a route read from the URL without pushing it back on', async () => {
    // Reads must not echo into writes: applying a route makes the state match
    // the URL, so the write effect has nothing left to do.
    const { result } = renderRouter();
    act(() => { result.current.searchGene('POMC'); });
    await waitFor(() => expect(hash()).toBe('#/gene/POMC'));

    const depth = window.history.length;
    await act(async () => {
      window.history.replaceState(null, '', '/#/statistics');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    await waitFor(() => expect(result.current.view).toBe('statistics'));
    expect(hash()).toBe('#/statistics');
    expect(window.history.length).toBe(depth);
  });
});

describe('appRouter — booting from the URL', () => {
  it.each([
    ['#/statistics', 'statistics'],
    ['#/methodology', 'methodology'],
    ['#/dataset/macaque_snrna/e9/methodology', 'methodology'],
    ['#/tracker', 'tracker'],
    ['#/library', 'library'],
    ['#/gene/POMC', 'report'],
    ['#/compare/POMC', 'compare-datasets'],
    ['#/compare-set/macaque_snrna,mouse_hypo_hfd_gse220533', 'compare-set'],
    ['#/pathway/HALLMARK_ADIPOGENESIS', 'pathway-report'],
  ])('opens %s on the %s view, on the first frame', (url, view) => {
    window.history.replaceState(null, '', `/${url}`);
    const { result } = renderRouter();
    // Synchronously, with no act() flush: resolving the boot route in an effect
    // instead would render one frame of the wrong view — and hand the write
    // effect a frame in which to overwrite the link that was just followed.
    expect(result.current.view).toBe(view);
  });

  it('carries the parameters the boot route named', () => {
    window.history.replaceState(null, '', '/#/gene/LEPR/Circadian');
    const { result } = renderRouter();
    expect(result.current.reportGene).toBe('LEPR');
    expect(result.current.reportScope).toEqual(['Circadian']);
  });

  it('boots a search link on the results page with its query and filter', async () => {
    window.history.replaceState(null, '', '/#/search/insulin/pathways');
    const before = window.history.length;
    const { result } = renderRouter();
    // First frame, like every other boot route.
    expect(result.current.view).toBe('search');
    expect(result.current.searchQuery).toBe('insulin');
    expect(result.current.searchFilter).toBe('pathway');
    // Already canonical: nothing rewritten, nothing pushed.
    await waitFor(() => expect(hash()).toBe('#/search/insulin/pathways'));
    expect(window.history.length).toBe(before);
  });

  it('boots a search link with an encoded query intact', () => {
    window.history.replaceState(null, '', `/${'#/search/a%2Fb%3Fc%23d%25e%20%E8%83%B0'}`);
    const { result } = renderRouter();
    expect(result.current.view).toBe('search');
    expect(result.current.searchQuery).toBe('a/b?c#d%e 胰');
    expect(result.current.searchFilter).toBe('all');
  });

  it('resolves a compare-set link on the first frame and shortens it in place', async () => {
    window.history.replaceState(null, '', `/#/compare-set/${MACAQUE.id}:i23,${MOUSE.id}:${MOUSE.defaultTrack}`);
    const before = window.history.length;
    const { result } = renderRouter();
    expect(result.current.view).toBe('compare-set');
    expect(result.current.compareSetItems).toEqual([
      { datasetId: MACAQUE.id, trackId: 'i23' },
      { datasetId: MOUSE.id, trackId: MOUSE.defaultTrack },
    ]);
    // The mouse default track is implied, so the link is rewritten to its
    // canonical short form — replacing, so Back still leaves the site.
    await waitFor(() => expect(hash()).toBe(`#/compare-set/${MACAQUE.id}:i23,${MOUSE.id}`));
    expect(window.history.length).toBe(before);
  });

  it('lands a compare-set link whose columns are all stale in the library', async () => {
    window.history.replaceState(null, '', '/#/compare-set/no_such_a,no_such_b:x');
    const { result } = renderRouter();
    expect(result.current.view).toBe('library');
    await waitFor(() => expect(hash()).toBe('#/library'));
  });

  it('follows a compare-set link pasted into the open tab', async () => {
    const { result } = renderRouter();
    act(() => { result.current.openStatistics(); });
    await waitFor(() => expect(hash()).toBe('#/statistics'));

    await act(async () => {
      window.history.replaceState(null, '', `/#/compare-set/${MACAQUE.id},${MOUSE.id}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => expect(result.current.view).toBe('compare-set'));
    expect(result.current.compareSetItems).toEqual([
      { datasetId: MACAQUE.id, trackId: MACAQUE.defaultTrack },
      { datasetId: MOUSE.id, trackId: MOUSE.defaultTrack },
    ]);
  });

  it('does not overwrite a deep link while its track is still being validated', async () => {
    // The bug this exists to prevent: validating a track needs the dataset's
    // metadata, so for several renders the shell still reports the OLD position.
    // Writing during that window replaces the incoming link with wherever the
    // user already was — the classic way a hand-rolled hash router eats its own
    // deep links.
    // A non-default track of the dataset the shell is ALREADY on: the stale
    // position would serialize to `#/dataset/macaque_snrna`, so a premature
    // write is unmistakable.
    window.history.replaceState(null, '', `/#/dataset/${MACAQUE.id}/i23`);
    const { calls } = renderLinkedRouter();

    // The shell has not moved yet, and the URL must be untouched.
    expect(hash()).toBe(`#/dataset/${MACAQUE.id}/i23`);
    await waitFor(() => expect(calls).toContain(`open:${MACAQUE.id}/i23`));
    expect(hash()).toBe(`#/dataset/${MACAQUE.id}/i23`);
  });

  it('survives a boot route that lands on a DIFFERENT dataset', async () => {
    // Same window, crossing datasets: the shell reports the macaque default
    // until the mouse metadata resolves.
    seedMouseDataset();
    window.history.replaceState(null, '', `/#/dataset/${MOUSE.id}/whole`);
    const { calls } = renderLinkedRouter();

    expect(hash()).toBe(`#/dataset/${MOUSE.id}/whole`);
    await waitFor(() => expect(calls).toContain(`open:${MOUSE.id}/whole`));
    // 'whole' IS the mouse default track, so the router normalizes the URL to
    // the short canonical form — the same place, never the macaque one.
    await waitFor(() => expect(hash()).toBe(`#/dataset/${MOUSE.id}`));
    expect(hash()).not.toContain(MACAQUE.id);
  });

  it('honours an explicit initialView when there is no URL to read', () => {
    // Tests mount straight into the explorer this way; an empty hash is "no
    // opinion", not "go to the hub".
    window.history.replaceState(null, '', '/');
    const { result } = renderHook(() => useAppRouter('explorer', spyExplorer()));
    expect(result.current.view).toBe('explorer');
  });
});

describe('appRouter — a URL is untrusted input', () => {
  it('ignores an unknown dataset and cleans the stale hash away', async () => {
    window.history.replaceState(null, '', '/#/dataset/no_such_dataset');
    const { result, explorer } = renderRouter();
    expect(result.current.view).toBe('hub');
    expect(explorer.calls).toEqual([]);
    await waitFor(() => expect(hash()).toBe(''));
  });

  it('drops a tab the dataset cannot answer, landing on the Gene Explorer', async () => {
    // The macaque snRNA dataset carries no time course, so its tab bar never
    // renders Circadian — and a link naming it must not open one.
    expect(MACAQUE.timeSeries?.tracks).toBeUndefined();
    window.history.replaceState(null, '', `/#/dataset/${MACAQUE.id}/${MACAQUE.defaultTrack}/circadian`);
    const { current } = renderLinkedRouter();

    await waitFor(() => expect(hash()).toBe(`#/dataset/${MACAQUE.id}`));
    expect(current.position?.focus).toEqual({ kind: 'track', trackId: MACAQUE.defaultTrack, tab: 'gene' });
  });

  it('applies a tab the dataset does support', async () => {
    expect(MACAQUE.supportsPathways).toBe(true);
    window.history.replaceState(null, '', `/#/dataset/${MACAQUE.id}/${MACAQUE.defaultTrack}/pathway`);
    const { current } = renderLinkedRouter();
    await waitFor(() => expect(current.position?.focus).toEqual({ kind: 'track', trackId: MACAQUE.defaultTrack, tab: 'pathway' }));
    expect(hash()).toBe(`#/dataset/${MACAQUE.id}/${MACAQUE.defaultTrack}/pathway`);
  });
  it('leaves the user alone on a hash it does not recognize', async () => {
    const { result } = renderRouter();
    act(() => { result.current.openStatistics(); });
    await waitFor(() => expect(result.current.view).toBe('statistics'));

    await act(async () => {
      window.history.replaceState(null, '', '/#some-anchor');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current.view).toBe('statistics');
  });
});

describe('appRouter — Compare round-trips through the URL', () => {
  it('restores Compare from its own link, and keeps naming it', async () => {
    window.history.replaceState(null, '', `/#/dataset/${MACAQUE.id}/compare`);
    const { result, current } = renderLinkedRouter();
    await waitFor(() => expect(current.position?.focus.kind).toBe('compare'));
    expect(result.current.view).toBe('explorer');
    // Reloading here comes back to Compare, returning to the default track.
    expect(current.position?.focus).toEqual({ kind: 'compare', returnTo: { trackId: MACAQUE.defaultTrack, tab: 'gene' } });
    expect(hash()).toBe(`#/dataset/${MACAQUE.id}/compare`);
  });

  it('writes Compare when the shell enters it, and the default track when it leaves', async () => {
    const { result, current } = renderLinkedRouter();
    act(() => { result.current.openInExplorer(MACAQUE.id, 'i23'); });
    await waitFor(() => expect(hash()).toBe(`#/dataset/${MACAQUE.id}/i23`));
    // The shell's own sidebar sends these; the router only serializes them.
    act(() => { current.navigate?.({ type: 'compare' }); });
    await waitFor(() => expect(hash()).toBe(`#/dataset/${MACAQUE.id}/compare`));
    act(() => { current.navigate?.({ type: 'leaveCompare' }); });
    await waitFor(() => expect(hash()).toBe(`#/dataset/${MACAQUE.id}/i23`));
  });

  it('ignores a tab segment behind Compare, which has none', async () => {
    window.history.replaceState(null, '', `/#/dataset/${MACAQUE.id}/compare/qc`);
    const { current } = renderLinkedRouter();
    await waitFor(() => expect(current.position?.focus.kind).toBe('compare'));
    await waitFor(() => expect(hash()).toBe(`#/dataset/${MACAQUE.id}/compare`));
  });

  it('degrades a Compare link on a single-track dataset to its default track', async () => {
    seedMouseDataset();
    window.history.replaceState(null, '', `/#/dataset/${MOUSE.id}/compare`);
    const { current } = renderLinkedRouter();
    await waitFor(() => expect(current.position?.datasetId).toBe(MOUSE.id));
    expect(current.position?.focus).toEqual({ kind: 'track', trackId: 'whole', tab: 'gene' });
    await waitFor(() => expect(hash()).toBe(`#/dataset/${MOUSE.id}`));
  });
});