import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import { listDatasets } from '../data/datasets';
import { registryCards } from '../data/datasetCatalog';
import type { Dataset } from '../types';
import { DEFAULT_STUDY_ANALYSIS } from '../utils/analysisState';
import { parseRoute, routeHref } from '../utils/appLinks';

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
const search = (gene = 'POMC') => {
  const box = screen.getByRole('textbox', { name: 'Search another gene' });
  fireEvent.change(box, { target: { value: gene } });
  fireEvent.keyDown(box, { key: 'Enter' });
};
// The study filters sit in a collapsed <details> on the report. Opening is
// idempotent, so a test can call it after any remount.
// The filter panel's own live count. A report carries other status regions
// (loading, expression cards), so the query is scoped to the panel when there
// is one, and falls back to the page's only status elsewhere (Compare).
const scopeStatus = () => {
  const details = document.querySelector('details.report-filters') as HTMLElement | null;
  return details ? within(details).getByRole('status') : screen.getByRole('status');
};
const openFilters = () => {
  const details = document.querySelector('details.report-filters') as HTMLDetailsElement | null;
  if (details) details.open = true;
};

beforeEach(() => {
  window.history.replaceState(null, '', `/#/gene/${START}`);
  queryGene.mockReset().mockImplementation(async (gene: string) => ({ gene, total: 0, loaded: 0, groups: [] }));
  loadCatalog.mockReset().mockResolvedValue({ state: 'complete', cards: registryCards().map((card) => ({
    ...card, nBaseline: card.dataset.id === chosen.id ? 8 : 3, nCase: 8,
  })) });
});
afterEach(() => { window.history.replaceState(null, '', '/'); });

describe('App gene search scope', () => {
  it('rejects unsupported analysis settings visibly without querying an unfiltered report', async () => {
    window.history.replaceState(null, '', `/#/gene/POMC?analysis=${encodeURIComponent(JSON.stringify({ ...DEFAULT_STUDY_ANALYSIS, version: 99 }))}`);
    render(<App />); openFilters();
    expect(screen.getByRole('alert')).toHaveTextContent('unsupported version');
    expect(queryGene).not.toHaveBeenCalled();
  });

  it('keeps an obsolete saved study set empty instead of querying all studies', async () => {
    window.history.replaceState(null, '', `/${routeHref({ view: 'report', gene: 'POMC', scope: null,
      analysis: { ...DEFAULT_STUDY_ANALYSIS, datasetIds: ['removed-study'] } })}`);
    render(<App />); openFilters();
    expect(await screen.findByText('No datasets selected.')).toBeInTheDocument();
    expect(queryGene).not.toHaveBeenCalled();
  });

  it('keeps the 75-study larger-groups cohort in its copied URL and in a retired compare link', async () => {
    const cohort = listDatasets().filter((dataset) => dataset.id !== 'macaque_snrna').slice(0, 75).map((dataset) => dataset.id);
    loadCatalog.mockResolvedValue({ state: 'complete', cards: registryCards().map((card) => ({
      ...card, nBaseline: cohort.includes(card.dataset.id) ? 5 : 3, nCase: 5,
    })) });
    const first = render(<App />); openFilters();
    fireEvent.click(screen.getByRole('button', { name: /^Larger groups / }));
    fireEvent.click(screen.getByRole('button', { name: 'Pipeline QC Passed' }));
    await waitFor(() => expect(scopeStatus()).toHaveTextContent(/^75 of /));
    search();
    await waitFor(() => expect(lastRequestedIds()).toEqual(cohort));
    const copied = window.location.hash;
    expect(copied).toMatch(/^#\/gene\/POMC\?analysis=/);
    first.unmount();
    // The copied link reopens the same cohort; so does the retired side-by-side
    // compare link for that gene, which now opens the gene page.
    for (const link of [copied, copied.replace('#/gene/', '#/compare/')]) {
      queryGene.mockClear();
      window.history.replaceState(null, '', `/${link}`);
      const view = render(<App />); openFilters();
      await waitFor(() => expect(queryGene).toHaveBeenCalled());
      expect(lastRequestedIds()).toEqual(cohort);
      expect(scopeStatus()).toHaveTextContent(/^75 of /);
      // Rewritten to the gene page's own address (key order aside).
      await waitFor(() => expect(parseRoute(window.location.hash)).toEqual(parseRoute(copied)));
      view.unmount();
    }
  });

  it('restores category, individual selection and quality/sample filters in a fresh session', async () => {
    const first = render(<App />); openFilters();
    fireEvent.click(screen.getByRole('button', { name: /^Aging / }));
    fireEvent.click(screen.getByRole('button', { name: /^Larger groups / }));
    fireEvent.click(screen.getByRole('button', { name: 'Experimental design Passed' }));
    await waitFor(() => expect(scopeStatus()).toHaveTextContent(/^1 of /));
    fireEvent.click(screen.getByRole('button', { name: /^Datasets / }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    fireEvent.click(screen.getByRole('checkbox', { name: `${chosen.name} ${chosen.organism}` }));
    search();
    await waitFor(() => expect(lastRequestedIds()).toEqual([chosen.id]));
    const copied = window.location.hash;
    expect(copied).toContain('?analysis=');
    first.unmount();
    queryGene.mockClear();
    window.history.replaceState(null, '', `/${copied}`);
    render(<App />); openFilters();
    await waitFor(() => expect(queryGene).toHaveBeenCalled());
    expect(lastRequestedIds()).toEqual([chosen.id]);
    openFilters();
    for (const name of [/^Aging /, /^Larger groups /, 'Experimental design Passed']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
    }
  });

  it('searches all datasets by default', async () => {
    render(<App />); openFilters();
    search();
    await waitFor(() => expect(queryGene).toHaveBeenCalled());
    expect(lastRequestedIds()).toEqual(listDatasets().map((dataset) => dataset.id));
  });

  it('combines categories and quality, preserving them across term-keyed remounts', async () => {
    render(<App />); openFilters();
    fireEvent.click(screen.getByRole('button', { name: /^Aging / }));
    fireEvent.click(screen.getByRole('button', { name: /^Larger groups / }));
    fireEvent.click(screen.getByRole('button', { name: 'Pipeline QC Passed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Experimental design Passed' }));
    await waitFor(() => expect(scopeStatus()).toHaveTextContent(`1 of ${listDatasets().length} datasets selected`));
    expect(queryGene).not.toHaveBeenCalledWith('IGF1', expect.anything());
    search('IGF1');
    await waitFor(() => expect(queryGene).toHaveBeenCalled());
    expect(lastRequestedIds()).toEqual([chosen.id]);
    openFilters();
    expect(screen.getByRole('button', { name: /^Larger groups / })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Pipeline QC Passed' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Experimental design Passed' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Author concordance Passed' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search another gene' }), { target: { value: 'LEPR' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search another gene' }), { key: 'Enter' });
    await waitFor(() => expect(queryGene).toHaveBeenLastCalledWith('LEPR', expect.any(Object)));
    expect(lastRequestedIds()).toEqual([chosen.id]);
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Author concordance Passed' }));
    expect(await screen.findByText('No datasets selected.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^All datasets / }));
    await waitFor(() => expect(lastRequestedIds()).toHaveLength(listDatasets().length));
    for (const name of ['Pipeline QC Passed', 'Experimental design Passed', 'Author concordance Passed']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('selects an individual study inside a category and keeps it through search', async () => {
    render(<App />); openFilters();
    fireEvent.click(screen.getByRole('button', { name: /^Aging / }));
    fireEvent.click(screen.getByRole('button', { name: /^Datasets / }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(aging.length);
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(scopeStatus()).toHaveTextContent(`0 of ${listDatasets().length} datasets selected`);
    const study = screen.getByRole('checkbox', { name: `${chosen.name} ${chosen.organism}` });
    fireEvent.click(study);
    fireEvent.click(study);
    expect(scopeStatus()).toHaveTextContent(`0 of ${listDatasets().length} datasets selected`);
    fireEvent.click(study);
    search();
    await waitFor(() => expect(queryGene).toHaveBeenCalled());
    expect(lastRequestedIds()).toEqual([chosen.id]);
  });

  it('does not widen an empty individual selection into a query of the whole corpus', async () => {
    render(<App />); openFilters();
    await waitFor(() => expect(queryGene).toHaveBeenCalled());
    queryGene.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^Datasets / }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    search();
    expect(await screen.findByText('No datasets selected.')).toBeInTheDocument();
    expect(queryGene).not.toHaveBeenCalled();
  });
});
