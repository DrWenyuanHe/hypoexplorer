// App-level smoke for the pathway report's study selection: the router, App and
// the report wired together. The selection rules themselves are tested at the
// module's interface in studySelection.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi, beforeAll } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import { preloadAppViews } from '../appViews';
import { registryCards } from '../data/datasetCatalog';
import { getDataset, listDatasets } from '../data/datasets';
import { getActiveContrast } from '../data/contrasts';
import { pathwayRow } from '../data/crossDatasetRows';
import type { CrossDatasetPathwayReport, Dataset } from '../types';

// App's views are separate chunks (src/appViews.tsx); load them first so every
// render below is synchronous.
beforeAll(() => preloadAppViews());

const { queryPathway, loadIndex, loadCatalog } = vi.hoisted(() => ({
  queryPathway: vi.fn(),
  loadIndex: vi.fn(),
  loadCatalog: vi.fn(),
}));

vi.mock('../data/crossDataset', async (importOriginal) => ({
  ...await importOriginal<typeof import('../data/crossDataset')>(),
  queryPathwayAcrossDatasets: queryPathway,
  loadPathwayIndex: loadIndex,
}));

vi.mock('../data/datasetCatalog', async (original) => ({
  ...await original<typeof import('../data/datasetCatalog')>(), loadDatasetCatalog: loadCatalog,
}));
vi.mock('../data/datasetQualityR460', async (original) => ({
  ...await original<typeof import('../data/datasetQualityR460')>(),
  datasetQuality: () => ({ pipelineQc: { status: 'pass' }, experimentalDesign: { status: 'pass' }, authorConcordance: { status: 'not_assessed' } }),
}));

const PATHWAY = 'HALLMARK_ADIPOGENESIS';
// Every test starts on a named report and searches on from it.
const START = 'HALLMARK_HYPOXIA';
const MACAQUE = getDataset('macaque_snrna')!;
const MOUSE = getDataset('mouse_hypo_hfd_gse220533')!;

function report(pathway: string): CrossDatasetPathwayReport {
  return {
    pathway, total: 2, loaded: 2,
    groups: [MACAQUE, MOUSE].map((dataset) => ({
      dataset, contrast: getActiveContrast(dataset),
      tracks: [pathwayRow({
        trackId: dataset.defaultTrack, label: dataset.defaultTrack, type: 'Tissue',
        NES: 1.5, padj: 0.01, pval: 0.001, size: 30, db: 'HALLMARK',
      })],
    })),
  };
}

beforeEach(() => {
  window.history.replaceState(null, '', `/#/pathway/${START}`);
  loadCatalog.mockReset().mockResolvedValue({ state: 'complete', cards: registryCards().map((card) => ({
    ...card, nBaseline: card.dataset.id === MOUSE.id ? 8 : 3, nCase: 8,
  })) });
  queryPathway.mockReset().mockImplementation(async (pathway: string) => report(pathway));
  loadIndex.mockReset().mockResolvedValue([START, PATHWAY]);
});

afterEach(() => { window.history.replaceState(null, '', '/'); });
const requestedIds = () => (queryPathway.mock.lastCall![1].datasets as Dataset[]).map((dataset) => dataset.id);
async function search(pathway = PATHWAY) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Search a pathway' }), { target: { value: pathway } });
  fireEvent.mouseDown(await screen.findByRole('button', { name: pathway }));
}
const filtersPanel = () => document.querySelector('details.report-filters') as HTMLDetailsElement;
// The filter panel's own live count; the report carries other status regions.
const scopeStatus = () => within(filtersPanel()).getByRole('status');
// The study filters sit in a collapsed <details>. Opening is idempotent, so a
// test can call it after any remount.
const openFilters = () => { filtersPanel().open = true; };

describe('App pathway report study selection', () => {
  it('keeps a selection through a search and restores it from the copied link', async () => {
    const first = render(<App />); openFilters();
    fireEvent.click(screen.getByRole('button', { name: /^Diet-induced obesity / }));
    fireEvent.click(screen.getByRole('button', { name: /^Larger groups / }));
    fireEvent.click(screen.getByRole('button', { name: 'Pipeline QC Passed' }));
    await waitFor(() => expect(scopeStatus()).toHaveTextContent(/^1 of /));
    fireEvent.click(screen.getByRole('button', { name: /^Datasets / }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    fireEvent.click(screen.getByRole('checkbox', { name: `${MOUSE.name} ${MOUSE.organism}` }));
    // A new pathway remounts the report; the selection belongs to the router.
    await search();
    await waitFor(() => expect(queryPathway).toHaveBeenLastCalledWith(PATHWAY, expect.any(Object)));
    expect(requestedIds()).toEqual([MOUSE.id]);
    expect(await screen.findByText(MOUSE.name)).toBeInTheDocument();
    expect(screen.queryByText(MACAQUE.name)).toBeNull();
    const copied = window.location.hash;
    expect(copied).toMatch(/^#\/pathway\/HALLMARK_ADIPOGENESIS\?analysis=/);
    first.unmount();
    queryPathway.mockClear();
    window.history.replaceState(null, '', `/${copied}`);
    render(<App />); openFilters();
    await waitFor(() => expect(queryPathway).toHaveBeenCalled());
    expect(requestedIds()).toEqual([MOUSE.id]);
    for (const name of [/^Diet-induced obesity /, /^Larger groups /, 'Pipeline QC Passed']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
    }
    await waitFor(() => expect(window.location.hash).toBe(copied));
  });

  it('keeps the report\'s own state when a category is toggled', async () => {
    render(<App />); openFilters();
    await waitFor(() => expect(queryPathway).toHaveBeenCalled());
    const panel = filtersPanel();
    fireEvent.click(screen.getByRole('button', { name: /^Primate atlas / }));
    const primate = listDatasets().filter((dataset) => dataset.category === 'Primate atlas' && dataset.supportsPathways);
    await waitFor(() => expect(requestedIds()).toEqual(primate.map((dataset) => dataset.id)));
    expect(filtersPanel()).toBe(panel);
    expect(panel.open).toBe(true);
  });
});
