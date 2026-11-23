// App-level smoke for the gene report's study selection: the router, App and
// the report wired together. The selection rules themselves (combining
// restrictions, never widening an empty selection, the link form) are tested at
// the module's interface in studySelection.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi, beforeAll } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import { preloadAppViews } from '../appViews';
import { listDatasets } from '../data/datasets';
import { registryCards } from '../data/datasetCatalog';
import type { Dataset } from '../types';
import { DEFAULT_STUDY_ANALYSIS } from '../utils/analysisState';
import { parseRoute } from '../utils/appLinks';

// App's views are separate chunks (src/appViews.tsx); load them first so every
// render below is synchronous.
beforeAll(() => preloadAppViews());

const { queryGene, loadCatalog } = vi.hoisted(() => ({ queryGene: vi.fn(), loadCatalog: vi.fn() }));
vi.mock('../data/crossDataset', async (original) => ({
  ...await original<typeof import('../data/crossDataset')>(),
  queryGeneAcrossDatasets: queryGene,
  loadGeneIndex: async () => [],
}));
vi.mock('../data/datasetCatalog', async (original) => ({
  ...await original<typeof import('../data/datasetCatalog')>(), loadDatasetCatalog: loadCatalog,
}));
vi.mock('../data/datasetQualityR460', async (original) => ({
  ...await original<typeof import('../data/datasetQualityR460')>(),
  datasetQuality: () => ({ pipelineQc: { status: 'pass' }, experimentalDesign: { status: 'pass' }, authorConcordance: { status: 'not_assessed' } }),
}));

const aging = listDatasets().filter((dataset) => dataset.category === 'Aging');
const chosen = aging[0];
const lastRequestedIds = () => (queryGene.mock.lastCall![1].datasets as Dataset[]).map((dataset) => dataset.id);
// Every test starts on a named report (START) and searches on from it.
const START = 'AGRP';
const searchBox = () => screen.getByRole('textbox', { name: 'Search another gene' });
const search = (gene = 'POMC') => {
  fireEvent.change(searchBox(), { target: { value: gene } });
  fireEvent.keyDown(searchBox(), { key: 'Enter' });
};
const filtersPanel = () => document.querySelector('details.report-filters') as HTMLDetailsElement;
// The filter panel's own live count; the report carries other status regions.
const scopeStatus = () => within(filtersPanel()).getByRole('status');
// The study filters sit in a collapsed <details>. Opening is idempotent, so a
// test can call it after any remount.
const openFilters = () => { filtersPanel().open = true; };

beforeEach(() => {
  window.history.replaceState(null, '', `/#/gene/${START}`);
  queryGene.mockReset().mockImplementation(async (gene: string) => ({ gene, total: 0, loaded: 0, groups: [] }));
  loadCatalog.mockReset().mockResolvedValue({ state: 'complete', cards: registryCards().map((card) => ({
    ...card, nBaseline: card.dataset.id === chosen.id ? 8 : 3, nCase: 8,
  })) });
});
afterEach(() => { window.history.replaceState(null, '', '/'); });

describe('App gene report study selection', () => {
  it('rejects unsupported analysis settings visibly without querying an unfiltered report', async () => {
    window.history.replaceState(null, '', `/#/gene/POMC?analysis=${encodeURIComponent(JSON.stringify({ ...DEFAULT_STUDY_ANALYSIS, version: 99 }))}`);
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent('unsupported version');
    expect(queryGene).not.toHaveBeenCalled();
  });

  it('keeps a selection through a search and restores it from the copied link and a retired compare link', async () => {
    const first = render(<App />); openFilters();
    fireEvent.click(screen.getByRole('button', { name: /^Aging / }));
    fireEvent.click(screen.getByRole('button', { name: /^Larger groups / }));
    fireEvent.click(screen.getByRole('button', { name: 'Experimental design Passed' }));
    await waitFor(() => expect(scopeStatus()).toHaveTextContent(/^1 of /));
    fireEvent.click(screen.getByRole('button', { name: /^Datasets / }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    fireEvent.click(screen.getByRole('checkbox', { name: `${chosen.name} ${chosen.organism}` }));
    // A new gene remounts the report; the selection belongs to the router.
    search();
    await waitFor(() => expect(queryGene).toHaveBeenLastCalledWith('POMC', expect.any(Object)));
    expect(lastRequestedIds()).toEqual([chosen.id]);
    const copied = window.location.hash;
    expect(copied).toMatch(/^#\/gene\/POMC\/Aging\?analysis=/);
    first.unmount();
    // The retired side-by-side compare link for that gene opens the gene page.
    for (const link of [copied, copied.replace('#/gene/', '#/compare/')]) {
      queryGene.mockClear();
      window.history.replaceState(null, '', `/${link}`);
      const view = render(<App />); openFilters();
      await waitFor(() => expect(queryGene).toHaveBeenCalled());
      expect(lastRequestedIds()).toEqual([chosen.id]);
      for (const name of [/^Aging /, /^Larger groups /, 'Experimental design Passed']) {
        expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
      }
      // Landing keeps the link's own bytes; a compare link becomes the gene page's address.
      await waitFor(() => expect(window.location.hash).toBe(copied));
      expect(parseRoute(window.location.hash)).toEqual(parseRoute(copied));
      view.unmount();
    }
  });

  // Regression: the gene report's boundary used to be keyed on its category
  // scope too, so a category click remounted the whole report.
  it('keeps the report\'s own state when a category is toggled', async () => {
    render(<App />); openFilters();
    await waitFor(() => expect(queryGene).toHaveBeenCalled());
    const panel = filtersPanel();
    const box = searchBox();
    fireEvent.change(box, { target: { value: 'LEP' } });
    fireEvent.click(screen.getByRole('button', { name: /^Aging / }));
    await waitFor(() => expect(lastRequestedIds()).toEqual(aging.map((dataset) => dataset.id)));
    expect(queryGene).toHaveBeenLastCalledWith(START, expect.any(Object));
    expect(filtersPanel()).toBe(panel);
    expect(panel.open).toBe(true);
    expect(searchBox()).toBe(box);
    expect(box).toHaveValue('LEP');
    await waitFor(() => expect(window.location.hash).toBe(`#/gene/${START}/Aging`));
  });
});
