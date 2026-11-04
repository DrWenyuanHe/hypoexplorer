import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import App from '../App';
import { DatasetLibrary } from '../library/DatasetLibrary';
import { _resetBundleCache, _setBundleTransport } from '../data/bundleSource';
import { _resetTrackCache } from '../data/loadTrack';
import { listDatasets } from '../data/datasets';
import {
  COMPARE_SET_STORAGE_KEY, _resetCompareSetStore, addItem, getSnapshot,
} from '../compareset/compareSetStore';
import { seedQueryManifest } from './fixtures';

// The compare set from the outside: a study joins from a card, a row or its
// record; the header counts it; the drawer edits it and turns it into a
// comparison; the explorer topbar adds a single population; and a shared link
// renders its own columns without touching the reader's set.

const MACAQUE = 'Macaque hypothalamus (snRNA-seq)';
const MOUSE = 'Mouse whole hypothalamus (bulk RNA-seq)';
const MACAQUE_E9 = { datasetId: 'macaque_snrna', trackId: 'e9' };
const MOUSE_WHOLE = { datasetId: 'mouse_hypo_hfd_gse220533', trackId: 'whole' };

function renderLibrary(over: Partial<Parameters<typeof DatasetLibrary>[0]> = {}) {
  const props = {
    onHome: vi.fn(),
    onOpenInExplorer: vi.fn(),
    onOpenTracker: vi.fn(),
    onCompareSet: vi.fn(),
    ...over,
  };
  const view = render(<DatasetLibrary {...props} />);
  return { ...props, ...view };
}

// Every button query below is scoped to the landmark or container that holds
// the control, never the document. A document-wide `getByRole('button', …)`
// computes the accessible name of every button on the page, and the library
// renders every card — ~900 buttons. Worse, jsdom drops its computed-style
// cache on EVERY DOM mutation, so each click→query pair re-resolved styles for
// all of them: ~12 s a pair in this file's profile, against ~100 ms scoped.
// That is where fourteen minutes of wall clock went, and why this file was
// twice mistaken for a hang. Same rule datasetLibrary.test.tsx keeps.

/** The site header: the compare-set button, and in the explorer, the toggle. */
const banner = () => within(screen.getByRole('banner'));
const header = () => banner().getByRole('button', { name: /^Compare set, \d+ stud/ });
const headerCount = () => header().getAttribute('aria-label');

/**
 * The card or table row that names a study. The toggle sits beside the face
 * that opens the record (see StudyCard), so it is found from that face: the
 * drawer and the study record name the study too, but not in a pressable.
 */
const study = (name: string) => {
  const face = screen.getAllByText(name)
    .map((el) => el.closest('button[aria-pressed]'))
    .find((el): el is HTMLElement => el instanceof HTMLElement);
  if (!face) throw new Error(`No card or row names ${name}`);
  return within((face.closest('tr') ?? face.parentElement) as HTMLElement);
};
const addToggle = (name: string) => study(name).getByRole('button', { name: `Add ${name} to compare set` });
const removeToggle = (name: string) => study(name).getByRole('button', { name: `Remove ${name} from compare set` });
const drawer = () => screen.getByRole('dialog', { name: 'Compare set' });

let unseed = () => {};

// Every test here mounts the library or the whole App, and the library
// renders every card (see TODOS: the mount is O(corpus)). Same explicit
// budget app.dataset.test.tsx carries, for the same reason.
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  _resetCompareSetStore();
  unseed = seedQueryManifest();
});

afterEach(() => {
  unseed();
  _setBundleTransport(null);
  _resetBundleCache();
  _resetTrackCache();
  _resetCompareSetStore();
  window.history.replaceState(null, '', '/');
});

describe('compare set — the library', () => {
  it('adds a study from its card and counts it in the header, in words', () => {
    renderLibrary();
    expect(headerCount()).toBe('Compare set, 0 studies');

    fireEvent.click(addToggle(MACAQUE));
    expect(removeToggle(MACAQUE)).toHaveAttribute('aria-pressed', 'true');
    expect(headerCount()).toBe('Compare set, 1 study');
    expect(getSnapshot()).toEqual([MACAQUE_E9]);
  });

  it('opens the drawer on the set, and holds Compare until there are two', async () => {
    renderLibrary();
    fireEvent.click(addToggle(MACAQUE));
    fireEvent.click(header());

    const dialog = drawer();
    expect(within(dialog).getByText(MACAQUE)).toBeTruthy();
    expect(within(dialog).getByText('Macaca fascicularis')).toBeTruthy();
    expect(within(dialog).getByText(/Obese vs Normal/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /^Compare 1/ })).toBeDisabled();
    expect(within(dialog).getByText('Add at least two')).toBeTruthy();

    // Escape is a way out of a modal.
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('compares two studies, in the order they were added, and closes the drawer', () => {
    const { onCompareSet } = renderLibrary();
    fireEvent.click(addToggle(MOUSE));
    fireEvent.click(addToggle(MACAQUE));
    fireEvent.click(header());

    const go = within(drawer()).getByRole('button', { name: /^Compare 2/ });
    expect(go).not.toBeDisabled();
    fireEvent.click(go);
    expect(onCompareSet).toHaveBeenCalledWith([MOUSE_WHOLE, MACAQUE_E9]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('removes from the drawer, and the card follows', () => {
    renderLibrary();
    fireEvent.click(addToggle(MACAQUE));
    fireEvent.click(header());

    const dialog = drawer();
    fireEvent.click(within(dialog).getByRole('button', { name: `Remove ${MACAQUE} from compare set` }));
    expect(headerCount()).toBe('Compare set, 0 studies');
    expect(within(dialog).getByText(/Nothing in the compare set yet/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(addToggle(MACAQUE)).toHaveAttribute('aria-pressed', 'false');
  });

  it('clears the whole set', () => {
    addItem(MACAQUE_E9);
    addItem(MOUSE_WHOLE);
    renderLibrary();
    expect(headerCount()).toBe('Compare set, 2 studies');
    fireEvent.click(header());
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Clear' }));
    expect(headerCount()).toBe('Compare set, 0 studies');
    expect(getSnapshot()).toEqual([]);
  });

  it('refuses a thirteenth study and says so beside the toggle', () => {
    const twelve = listDatasets().slice(0, 12);
    for (const d of twelve) addItem({ datasetId: d.id, trackId: d.defaultTrack });
    renderLibrary();
    expect(headerCount()).toBe('Compare set, 12 studies');

    const thirteenth = listDatasets()[12];
    fireEvent.click(addToggle(thirteenth.name));
    expect(screen.getByText(/Compare set is full/)).toBeTruthy();
    expect(addToggle(thirteenth.name)).toHaveAttribute('aria-pressed', 'false');
    expect(headerCount()).toBe('Compare set, 12 studies');
  });

  it('adds from the table without opening the record', () => {
    renderLibrary();
    const layout = within(screen.getByRole('group', { name: 'Result layout' }));
    fireEvent.click(layout.getByRole('button', { name: /^table$/i }));
    fireEvent.click(addToggle(MACAQUE));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(headerCount()).toBe('Compare set, 1 study');
  });

  it('adds from the study record', () => {
    renderLibrary();
    fireEvent.click(screen.getAllByText(MACAQUE)[0].closest('button') as HTMLElement);
    const record = screen.getByRole('article', { name: /Macaque hypothalamus/i });
    fireEvent.click(within(record).getByRole('button', { name: `Add ${MACAQUE} to compare set` }));
    expect(headerCount()).toBe('Compare set, 1 study');
    expect(within(record).getByRole('button', { name: `Remove ${MACAQUE} from compare set` })).toBeTruthy();
  });

  it('survives a reload', () => {
    const first = renderLibrary();
    fireEvent.click(addToggle(MACAQUE));
    first.unmount();

    // A reload is a fresh module with the same storage.
    const payload = localStorage.getItem(COMPARE_SET_STORAGE_KEY) as string;
    _resetCompareSetStore();
    localStorage.setItem(COMPARE_SET_STORAGE_KEY, payload);

    renderLibrary();
    expect(headerCount()).toBe('Compare set, 1 study');
    expect(removeToggle(MACAQUE)).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('compare set — the explorer and the view', () => {
  it('adds the active population from the topbar, compares, and keeps the route and the set in step', async () => {
    render(<App initialView="explorer" />);

    // On the default track the toggle names the study alone.
    fireEvent.click(await banner().findByRole('button', { name: `Add ${MACAQUE} to compare set` }));
    expect(headerCount()).toBe('Compare set, 1 study');

    // Off it, the toggle names the population too. The population picker is
    // the explorer's one complementary landmark (CellNavigator).
    const populations = within(screen.getByRole('complementary'));
    fireEvent.click(populations.getByRole('button', { name: /i23/i }));
    fireEvent.click(await banner().findByRole('button', { name: `Add ${MACAQUE} i23 to compare set` }));
    expect(headerCount()).toBe('Compare set, 2 studies');

    fireEvent.click(header());
    fireEvent.click(within(drawer()).getByRole('button', { name: /^Compare 2/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/compare-set/macaque_snrna,macaque_snrna:i23'));
    expect(screen.getByText('1 study · 2 columns')).toBeTruthy();

    // Removing a column in the view drops it from the URL AND the set. Each
    // column is a group named by its legend, so the button is read inside it.
    const column = await screen.findByRole('group', { name: /^Macaque hypothalamus \(snRNA-seq\) · i23/ });
    fireEvent.click(within(column).getByRole('button', { name: /^Remove Macaque hypothalamus \(snRNA-seq\) · i23/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/compare-set/macaque_snrna'));
    expect(headerCount()).toBe('Compare set, 1 study');
    expect(getSnapshot()).toEqual([MACAQUE_E9]);
  });

  it('renders a shared link without touching the set', async () => {
    window.history.replaceState(null, '', '/#/compare-set/macaque_snrna,mouse_hypo_hfd_gse220533');
    render(<App />);

    expect(await screen.findByText('2 studies')).toBeTruthy();
    expect(screen.getByRole('group', { name: MOUSE })).toBeTruthy();
    expect(headerCount()).toBe('Compare set, 0 studies');
    expect(getSnapshot()).toEqual([]);
  });

  it('lands a link whose columns have all gone stale in the library', async () => {
    window.history.replaceState(null, '', '/#/compare-set/no_such_a,no_such_b');
    render(<App />);
    expect(await screen.findByText(/of \d+ studies/)).toBeTruthy();
    await waitFor(() => expect(window.location.hash).toBe('#/library'));
  });
});
