import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';

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

const DIALOG = 'Gene & Pathway Explorer';
const GENE_INPUT = 'Search a gene across all datasets';
const PATHWAY_INPUT = 'Search a pathway across all datasets';

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

function openFromHub() {
  fireEvent.click(within(hubNav()).getByRole('button', { name: 'Genes' }));
  return screen.getByRole('dialog', { name: DIALOG });
}

describe('shared gene and pathway search dialog', () => {
  it('opens on gene search from the one hub entrance, keeping the hub behind it', () => {
    render(<App />);
    const hub = hubBox();
    const dialog = openFromHub();
    expect(within(dialog).getByRole('tab', { name: 'Genes' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByRole('tab', { name: 'Pathways' })).toHaveAttribute('aria-selected', 'false');
    expect(within(dialog).getByRole('textbox', { name: GENE_INPUT })).toHaveFocus();
    expect(within(dialog).queryByRole('textbox', { name: PATHWAY_INPUT })).toBeNull();
    expect(hub.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(window.location.hash).toBe('#/gene');
    // The pathway side is not mounted, so its vocabulary is not fetched.
    expect(loadPathwayIndex).not.toHaveBeenCalled();
  });

  it('switches between gene and pathway search and keeps what was typed on each side', () => {
    render(<App />);
    const dialog = openFromHub();
    fireEvent.change(within(dialog).getByRole('textbox', { name: GENE_INPUT }), { target: { value: 'AGRP' } });

    const pathwayTab = within(dialog).getByRole('tab', { name: 'Pathways' });
    fireEvent.click(pathwayTab);
    expect(pathwayTab).toHaveAttribute('aria-selected', 'true');
    expect(pathwayTab).toHaveFocus();
    expect(window.location.hash).toBe('#/pathway');
    expect(screen.getByRole('dialog', { name: DIALOG })).toBe(dialog);
    expect(within(dialog).queryByRole('textbox', { name: GENE_INPUT })).toBeNull();
    const pathwayBox = within(dialog).getByRole('textbox', { name: PATHWAY_INPUT });
    fireEvent.change(pathwayBox, { target: { value: 'ADIPO' } });

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Genes' }));
    expect(window.location.hash).toBe('#/gene');
    expect(within(dialog).getByRole('textbox', { name: GENE_INPUT })).toHaveValue('AGRP');
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Pathways' }));
    expect(within(dialog).getByRole('textbox', { name: PATHWAY_INPUT })).toHaveValue('ADIPO');
    expect(queryGene).not.toHaveBeenCalled();
    expect(queryPathway).not.toHaveBeenCalled();
  });

  it('moves between the tabs with the arrow keys', () => {
    render(<App />);
    const dialog = openFromHub();
    const genes = within(dialog).getByRole('tab', { name: 'Genes' });
    fireEvent.keyDown(genes, { key: 'ArrowRight' });
    const pathways = within(dialog).getByRole('tab', { name: 'Pathways' });
    expect(pathways).toHaveAttribute('aria-selected', 'true');
    expect(pathways).toHaveFocus();
    fireEvent.keyDown(pathways, { key: 'Home' });
    expect(genes).toHaveAttribute('aria-selected', 'true');
    expect(genes).toHaveFocus();
  });

  it('opens a #/pathway link on the pathway side', () => {
    window.history.replaceState(null, '', '/#/pathway');
    render(<App />);
    const dialog = screen.getByRole('dialog', { name: DIALOG });
    expect(within(dialog).getByRole('tab', { name: 'Pathways' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByRole('textbox', { name: PATHWAY_INPUT })).toHaveFocus();
  });

  it('opens the dialog on the side the nav entrance names', () => {
    render(<App />);
    fireEvent.click(within(hubNav()).getByRole('button', { name: 'Pathways' }));
    let dialog = screen.getByRole('dialog', { name: DIALOG });
    expect(within(dialog).getByRole('tab', { name: 'Pathways' })).toHaveAttribute('aria-selected', 'true');
    expect(window.location.hash).toBe('#/pathway');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(within(hubNav()).getByRole('button', { name: 'Genes' }));
    dialog = screen.getByRole('dialog', { name: DIALOG });
    expect(within(dialog).getByRole('tab', { name: 'Genes' })).toHaveAttribute('aria-selected', 'true');
    expect(window.location.hash).toBe('#/gene');
  });

  it('submits from the hub box straight to the results page, without the dialog', async () => {
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

  it('restores focus to the nav entrance after Close, Escape and backdrop dismissal', () => {
    render(<App />);
    const trigger = within(hubNav()).getByRole('button', { name: 'Genes' });
    for (const dismiss of ['close', 'escape', 'backdrop']) {
      trigger.focus();
      fireEvent.click(trigger);
      const dialog = screen.getByRole('dialog', { name: DIALOG });
      // Switching sides must not lose the element focus returns to.
      fireEvent.click(within(dialog).getByRole('tab', { name: 'Pathways' }));
      fireEvent.click(within(dialog).getByRole('tab', { name: 'Genes' }));
      if (dismiss === 'close') fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      else if (dismiss === 'escape') fireEvent.keyDown(within(dialog).getByRole('textbox', { name: GENE_INPUT }), { key: 'Escape' });
      else {
        fireEvent.mouseDown(dialog);
        fireEvent.mouseUp(dialog);
      }
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(trigger).toHaveFocus();
      expect(queryGene).not.toHaveBeenCalled();
    }
  });
});

describe.each([
  { tab: 'Genes', title: 'Gene Explorer', input: GENE_INPUT, term: 'POMC', route: '#/gene/POMC', query: queryGene },
  { tab: 'Pathways', title: 'Pathway Explorer', input: PATHWAY_INPUT, term: 'HALLMARK_ADIPOGENESIS', route: '#/pathway/HALLMARK_ADIPOGENESIS', query: queryPathway },
])('$tab search', ({ tab, title, input, term, route, query }) => {
  it('keeps the hub behind the dialog until a nonempty search is submitted', async () => {
    render(<App />);
    const hub = hubBox();
    const dialog = openFromHub();
    fireEvent.click(within(dialog).getByRole('tab', { name: tab }));
    const search = within(dialog).getByRole('textbox', { name: input });
    fireEvent.change(search, { target: { value: '   ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Search' }));
    expect(query).not.toHaveBeenCalled();
    expect(dialog).toBeInTheDocument();

    fireEvent.change(search, { target: { value: term } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(query).toHaveBeenCalledWith(term, expect.any(Object)));
    expect(window.location.hash).toBe(route);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(hub).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(title);
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
