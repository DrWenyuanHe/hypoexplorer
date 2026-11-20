import { beforeEach, describe, expect, it, vi, beforeAll } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import { preloadAppViews } from '../appViews';

// App's views are separate chunks (src/appViews.tsx); load them first so every
// render below is synchronous.
beforeAll(() => preloadAppViews());

const { queryGene, queryPathway, loadPathwayIndex } = vi.hoisted(() => ({
  queryGene: vi.fn(), queryPathway: vi.fn(), loadPathwayIndex: vi.fn(),
}));
vi.mock('../data/crossDataset', async (original) => ({
  ...await original<typeof import('../data/crossDataset')>(),
  queryGeneAcrossDatasets: queryGene,
  queryPathwayAcrossDatasets: queryPathway,
  loadGeneIndex: async () => [],
  loadPathwayIndex,
}));
vi.mock('../data/datasetCatalog', async (original) => {
  const module = await original<typeof import('../data/datasetCatalog')>();
  return { ...module, loadDatasetCatalog: async () => ({ state: 'complete', cards: module.registryCards() }) };
});
// The results page loads the search vocabulary; what is under test here is the
// App wiring around it, so a stand-in reports its props and exposes its callbacks.
vi.mock('../search/SearchPage', () => ({
  SearchPage: (props: import('../search/SearchPage').SearchPageProps) => (
    <main aria-label="Search results" data-query={props.query} data-filter={props.filter}>
      <button type="button" onClick={() => props.onOpenGene('POMC')}>Open POMC</button>
      <button type="button" onClick={() => props.onOpenPathway('HALLMARK_ADIPOGENESIS')}>Open adipogenesis</button>
      <button type="button" onClick={() => props.onFilterChange('pathway')}>Pathways only</button>
      <button type="button" onClick={() => props.onSearch('leptin')}>Search leptin</button>
      <button type="button" onClick={props.onHome}>Home</button>
    </main>
  ),
}));

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  queryGene.mockReset().mockImplementation(async (gene: string) => ({ gene, total: 0, loaded: 0, groups: [] }));
  queryPathway.mockReset().mockImplementation(async (pathway: string) => ({ pathway, total: 0, loaded: 0, groups: [] }));
  loadPathwayIndex.mockReset().mockResolvedValue([]);
});

// Scoped to the hub's own nodes: document-wide role queries are slow on a
// full App mount (see the jsdom getByRole note in the test docs).
const hubNav = () => document.querySelector('.hub-nav') as HTMLElement;
const HUB_BOX = 'Search genes and pathways';
const hubBox = () => screen.getByRole('search', { name: HUB_BOX });
const results = () => screen.getByRole('main', { name: 'Search results' });

describe('hub search', () => {
  it('offers no separate Genes or Pathways entrance in the hub nav', () => {
    render(<App />);
    const names = within(hubNav()).getAllByRole('button').map((button) => button.textContent);
    expect(names).not.toContain('Genes');
    expect(names).not.toContain('Pathways');
    expect(names).toContain('Library');
  });

  it('submits from the hub box straight to the results page', async () => {
    render(<App />);
    const box = hubBox();
    fireEvent.change(within(box).getByRole('combobox', { name: `${HUB_BOX} across all studies` }), { target: { value: 'POMC' } });
    fireEvent.click(within(box).getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(window.location.hash).toBe('#/search/POMC'));
    expect(results()).toHaveAttribute('data-query', 'POMC');
    expect(results()).toHaveAttribute('data-filter', 'all');
    expect(screen.queryByRole('dialog')).toBeNull();
    // The results page decides what to open; the box itself runs no report.
    expect(queryGene).not.toHaveBeenCalled();
    expect(queryPathway).not.toHaveBeenCalled();
  });
});

// `#/gene`, `#/gene/in/<cats>` and `#/pathway` opened the retired gene and
// pathway search dialog. Links shared while it existed open the results page.
describe('retired search landings', () => {
  const analysis = encodeURIComponent(JSON.stringify({ v: 1, datasetIds: ['macaque_snrna'] }));

  it.each(['#/gene', '#/pathway', '#/gene/in/Circadian', `#/gene?analysis=${analysis}`])(
    'opens %s on the empty results page and rewrites the address',
    async (hash) => {
      window.history.replaceState(null, '', `/${hash}`);
      render(<App />);
      expect(results()).toHaveAttribute('data-query', '');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      await waitFor(() => expect(window.location.hash).toBe('#/search'));
      expect(queryGene).not.toHaveBeenCalled();
      expect(queryPathway).not.toHaveBeenCalled();
    },
  );

  it('replaces a retired link followed in an open tab instead of stacking it in history', async () => {
    window.history.replaceState(null, '', '/#/search');
    render(<App />);
    expect(results()).toHaveAttribute('data-query', '');
    const depth = window.history.length;
    // Following `#/pathway` while search is already showing: the view does
    // not change, so only the navigation handler can correct the address.
    window.history.pushState(null, '', '/#/pathway');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => expect(window.location.hash).toBe('#/search'));
    expect(window.history.length).toBe(depth + 1);
    expect(results()).toHaveAttribute('data-query', '');
  });
});

describe('unified search results page', () => {
  it('opens a #/search link on the results page with its query and filter', () => {
    window.history.replaceState(null, '', '/#/search/insulin%20secretion/pathways');
    render(<App />);
    const page = results();
    expect(page).toHaveAttribute('data-query', 'insulin secretion');
    expect(page).toHaveAttribute('data-filter', 'pathway');
    expect(document.querySelector('.hub-nav')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('writes a filter change and a new search into the address', async () => {
    window.history.replaceState(null, '', '/#/search/insulin');
    render(<App />);
    fireEvent.click(within(results()).getByRole('button', { name: 'Pathways only' }));
    await waitFor(() => expect(window.location.hash).toBe('#/search/insulin/pathways'));
    expect(results()).toHaveAttribute('data-filter', 'pathway');

    fireEvent.click(within(results()).getByRole('button', { name: 'Search leptin' }));
    await waitFor(() => expect(window.location.hash).toBe('#/search/leptin'));
    expect(results()).toHaveAttribute('data-query', 'leptin');
    expect(results()).toHaveAttribute('data-filter', 'all');
  });

  it('opens the gene report from a result', async () => {
    window.history.replaceState(null, '', '/#/search/pomc');
    render(<App />);
    fireEvent.click(within(results()).getByRole('button', { name: 'Open POMC' }));
    await waitFor(() => expect(queryGene).toHaveBeenCalledWith('POMC', expect.any(Object)));
    expect(window.location.hash).toBe('#/gene/POMC');
  });

  it('opens the pathway report from a result', async () => {
    window.history.replaceState(null, '', '/#/search/adipogenesis');
    render(<App />);
    fireEvent.click(within(results()).getByRole('button', { name: 'Open adipogenesis' }));
    await waitFor(() => expect(queryPathway).toHaveBeenCalledWith('HALLMARK_ADIPOGENESIS', expect.any(Object)));
    expect(window.location.hash).toBe('#/pathway/HALLMARK_ADIPOGENESIS');
  });

  it('goes home from the results page', async () => {
    window.history.replaceState(null, '', '/#/search/insulin');
    render(<App />);
    fireEvent.click(within(results()).getByRole('button', { name: 'Home' }));
    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(hubNav()).not.toBeNull();
  });
});
