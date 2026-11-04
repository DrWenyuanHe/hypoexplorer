import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { registryCards } from '../data/datasetCatalog';
import { getDataset, listDatasets } from '../data/datasets';
import { getActiveContrast } from '../data/contrasts';
import type { CrossDatasetPathwayReport, Dataset } from '../types';

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
const NEXT_PATHWAY = 'HALLMARK_INFLAMMATORY_RESPONSE';
const MACAQUE = getDataset('macaque_snrna')!;
const MOUSE = getDataset('mouse_hypo_hfd_gse220533')!;

function report(pathway: string): CrossDatasetPathwayReport {
  return {
    pathway, total: 2, loaded: 2,
    groups: [MACAQUE, MOUSE].map((dataset) => ({
      dataset, contrast: getActiveContrast(dataset),
      tracks: [{
        trackId: dataset.defaultTrack, label: dataset.defaultTrack, type: 'Tissue',
        NES: 1.5, padj: 0.01, pval: 0.001, size: 30, db: 'HALLMARK',
        direction: 'up', significant: true,
      }],
    })),
  };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/#/pathway');
  loadCatalog.mockReset().mockResolvedValue({ state: 'complete', cards: registryCards().map((card) => ({
    ...card, nBaseline: card.dataset.id === MOUSE.id ? 8 : 3, nCase: 8,
  })) });
  queryPathway.mockReset().mockImplementation(async (pathway: string) => report(pathway));
  loadIndex.mockReset().mockResolvedValue([PATHWAY, NEXT_PATHWAY]);
});

afterEach(() => { window.history.replaceState(null, '', '/'); });
const requestedIds = () => (queryPathway.mock.lastCall![1].datasets as Dataset[]).map((dataset) => dataset.id);
function search(pathway = PATHWAY) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Search a pathway across all datasets' }), { target: { value: pathway } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
}

describe('App pathway category scope', () => {
  it('restores a copied pathway analysis in a fresh session with its study restrictions', async () => {
    const first = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^Diet-induced obesity / }));
    fireEvent.click(screen.getByRole('button', { name: /^Larger groups / }));
    fireEvent.click(screen.getByRole('button', { name: 'Pipeline QC Passed' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^1 of /));
    fireEvent.click(screen.getByRole('button', { name: /^Datasets / }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    fireEvent.click(screen.getByRole('checkbox', { name: `${MOUSE.name} ${MOUSE.organism}` }));
    search();
    await waitFor(() => expect(requestedIds()).toEqual([MOUSE.id]));
    const copied = window.location.hash;
    expect(copied).toContain('?analysis=');
    first.unmount();
    queryPathway.mockClear();
    window.history.replaceState(null, '', `/${copied}`);
    render(<App />);
    await waitFor(() => expect(queryPathway).toHaveBeenCalled());
    expect(requestedIds()).toEqual([MOUSE.id]);
    fireEvent.click(screen.getByText('Study filters'));
    for (const name of [/^Diet-induced obesity /, /^Larger groups /, 'Pipeline QC Passed']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
    }
  });

  it('retains category selection from the landing page across pathway searches', async () => {
    render(<App initialView="pathway-report" />);
    fireEvent.click(screen.getByRole('button', { name: /^Primate atlas / }));
    expect(queryPathway).not.toHaveBeenCalled();
    search();

    expect(await screen.findByText(MACAQUE.name)).toBeInTheDocument();
    expect(screen.queryByText(MOUSE.name)).toBeNull();
    fireEvent.click(screen.getByText('Study filters'));
    expect(screen.getByRole('button', { name: /^Primate atlas/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^All datasets / })).toHaveAttribute('aria-pressed', 'false');

    // Changing the pathway remounts the report to reset its error boundary.
    // The selected category must still belong to the search after that remount.
    const nextSearch = screen.getByRole('textbox', { name: 'Search a pathway' });
    fireEvent.change(nextSearch, { target: { value: 'INFLAMMATORY_RESPONSE' } });
    fireEvent.mouseDown(await screen.findByRole('button', { name: NEXT_PATHWAY }));

    expect(await screen.findByText(MACAQUE.name)).toBeInTheDocument();
    expect(queryPathway).toHaveBeenLastCalledWith(NEXT_PATHWAY, expect.any(Object));
    expect(screen.queryByText(MOUSE.name)).toBeNull();
    fireEvent.click(screen.getByText('Study filters'));
    expect(screen.getByRole('button', { name: /^Primate atlas/ })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: /^All datasets / }));
    expect(await screen.findByText(MOUSE.name)).toBeInTheDocument();
    expect(requestedIds()).toEqual(listDatasets().filter((dataset) => dataset.supportsPathways).map((dataset) => dataset.id));
  });

  it('combines category, sample size and independent quality checks through searches', async () => {
    render(<App initialView="pathway-report" />);
    const field = screen.getByRole('textbox', { name: 'Search a pathway across all datasets' });
    fireEvent.change(field, { target: { value: 'hallmark_adipogenesis' } });
    fireEvent.click(screen.getByRole('button', { name: /^Diet-induced obesity / }));
    fireEvent.click(screen.getByRole('button', { name: /^Larger groups / }));
    fireEvent.click(screen.getByRole('button', { name: 'Pipeline QC Passed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Experimental design Passed' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^1 of /));
    expect(field).toHaveValue('hallmark_adipogenesis');
    expect(queryPathway).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(MOUSE.name)).toBeInTheDocument();
    expect(requestedIds()).toEqual([MOUSE.id]);
    expect(queryPathway).toHaveBeenLastCalledWith(PATHWAY, expect.any(Object));
    fireEvent.click(screen.getByText('Study filters'));
    for (const name of ['Larger groups At least 5 samples per group', 'Pipeline QC Passed', 'Experimental design Passed']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
    }
    const nextSearch = screen.getByRole('textbox', { name: 'Search a pathway' });
    fireEvent.change(nextSearch, { target: { value: 'INFLAMMATORY_RESPONSE' } });
    fireEvent.mouseDown(await screen.findByRole('button', { name: NEXT_PATHWAY }));
    await waitFor(() => expect(queryPathway).toHaveBeenLastCalledWith(NEXT_PATHWAY, expect.any(Object)));
    expect(requestedIds()).toEqual([MOUSE.id]);
    fireEvent.click(screen.getByText('Study filters'));
    fireEvent.click(screen.getByRole('button', { name: 'Author concordance Passed' }));
    expect(await screen.findByText('No datasets selected.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^All datasets / }));
    expect(await screen.findByText(MACAQUE.name)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Author concordance Passed' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('preserves individual selections and does not search the corpus for an empty selection', async () => {
    render(<App initialView="pathway-report" />);
    fireEvent.click(screen.getByRole('button', { name: /^Primate atlas / }));
    fireEvent.click(screen.getByRole('button', { name: /^Datasets / }));
    const study = screen.getByRole('checkbox', { name: `${MACAQUE.name} ${MACAQUE.organism}` });
    fireEvent.click(study);
    expect(screen.getByRole('status')).toHaveTextContent(/^0 of /);
    fireEvent.click(study);
    search();
    expect(await screen.findByText(MACAQUE.name)).toBeInTheDocument();
    expect(requestedIds()).toEqual([MACAQUE.id]);
    fireEvent.click(screen.getByText('Study filters'));
    fireEvent.click(screen.getByRole('button', { name: /^Datasets / }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    const calls = queryPathway.mock.calls.length;
    expect(await screen.findByText('No datasets selected.')).toBeInTheDocument();
    expect(queryPathway).toHaveBeenCalledTimes(calls);
  });

  it('excludes studies without pathway support from the picker and query', async () => {
    loadCatalog.mockResolvedValue({ state: 'complete', cards: registryCards().map((card) => card.dataset.id === MOUSE.id
      ? { ...card, dataset: { ...card.dataset, supportsPathways: false } } : card) });
    render(<App initialView="pathway-report" />);
    const count = listDatasets().filter((dataset) => dataset.supportsPathways && dataset.id !== MOUSE.id).length;
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(`${count} of ${count} pathway-capable datasets selected`));
    fireEvent.click(screen.getByRole('button', { name: /^Datasets / }));
    expect(screen.queryByRole('checkbox', { name: `${MOUSE.name} ${MOUSE.organism}` })).toBeNull();
    search();
    // Searching remounts the report, which starts from the registry cards until
    // its catalog load settles; a query keyed on that snapshot is cancelled and
    // re-run. Assert on the query that stands, not the first one issued.
    await waitFor(() => expect(queryPathway).toHaveBeenCalled());
    await waitFor(() => expect(requestedIds()).not.toContain(MOUSE.id));
    expect(requestedIds()).toContain(MACAQUE.id);
  });

});
