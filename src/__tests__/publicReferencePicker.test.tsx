import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getActiveContrast } from '../data/contrasts';
import { listDatasets } from '../data/datasets';
import { loadDatasetMeta } from '../data/loadDatasetMeta';
import { loadTrackData, popDataFor } from '../data/trackData';
import { PublicReferencePicker, publicReferenceDataset } from '../local-datasets/PublicReferencePicker';
import type { DatasetMeta, PopData, RawTrack } from '../types';

vi.mock('../data/loadDatasetMeta', () => ({ loadDatasetMeta: vi.fn() }));
vi.mock('../data/trackData', () => ({ loadTrackData: vi.fn(), popDataFor: vi.fn() }));

const study = listDatasets().find((dataset) => dataset.featureType === 'gene')!;
const contrast = getActiveContrast(study);
const metadata = {
  populations: ['test-track'], labels: { 'test-track': 'Test population' },
  types: {}, nGenes: {}, colors: {}, qcFlags: {},
} satisfies DatasetMeta;
const results = {
  de: [{ gene: 'POMC', logFC: 2, PValue: 0.02, FDR: null }],
  allPathways: [{ pathway: 'HALLMARK_INFLAMMATORY_RESPONSE', NES: -1.2, padj: 0.04, pval: 0.005, size: 10, leadingEdge: ['POMC', 'POMC'], db: 'HALLMARK' }],
} as PopData;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadDatasetMeta).mockResolvedValue(metadata);
  vi.mocked(loadTrackData).mockResolvedValue({ raw: { cpm: {} }, pathwaysReady: Promise.resolve(null) });
  vi.mocked(popDataFor).mockReturnValue(results);
});
afterEach(cleanup);

describe('public results saved for local comparison', () => {
  it('preserves comparison, species, source, and unknown adjusted significance', () => {
    const saved = publicReferenceDataset(study, 'test-track', 'Test population', contrast, results, '2026-09-05T00:00:00Z');
    expect(saved.id).toBe(`public:${study.id}:test-track:${contrast?.id ?? 'default'}`);
    expect(saved.name).toContain('Test population');
    expect(saved.name).toContain(contrast!.label);
    expect(saved.organism).toBe(study.organism);
    expect(saved.genes[0]).toMatchObject({ gene: 'POMC', logFC: 2, pvalue: 0.02, padj: null });
    expect(saved.pathways[0]).toMatchObject({ pathway: 'HALLMARK_INFLAMMATORY_RESPONSE', nes: -1.2, genes: ['POMC'] });
    expect(saved.sources.map((source) => source.kind)).toEqual(['de', 'pathway']);
  });

  it('does not turn invalid statistics into zero significance', () => {
    const invalid = {
      de: [{ gene: 'UNKNOWN', logFC: 1, PValue: -1, FDR: Number.NaN }, { gene: 'BROKEN', logFC: Number.NaN, PValue: 0.01, FDR: 0.02 }],
      allPathways: [{ ...results.allPathways[0], NES: Number.NaN, padj: 2 }],
    } as PopData;
    const saved = publicReferenceDataset(study, 'test-track', 'Test population', contrast, invalid);
    expect(saved.genes).toHaveLength(1);
    expect(saved.genes[0]).toMatchObject({ pvalue: null, padj: null });
    expect(saved.pathways[0]).toMatchObject({ nes: null, padj: null });
  });

  it('loads no public data until a study is chosen', () => {
    render(<PublicReferencePicker onAdd={vi.fn()} />);
    expect(loadDatasetMeta).not.toHaveBeenCalled();
    expect(loadTrackData).not.toHaveBeenCalled();
  });

  it('downloads a whole selected track, awaits pathways, and saves once', async () => {
    let hydrate!: (raw: RawTrack | null) => void;
    vi.mocked(loadTrackData).mockResolvedValue({ raw: { cpm: {} }, pathwaysReady: new Promise((resolve) => { hydrate = resolve; }) });
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<PublicReferencePicker onAdd={onAdd} />);
    fireEvent.change(screen.getByLabelText('Public reference study'), { target: { value: study.id } });
    const button = screen.getByRole('button', { name: 'Download comparison to this browser', hidden: true });
    await waitFor(() => expect(button).toBeEnabled());
    expect(loadTrackData).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(loadTrackData).toHaveBeenCalledWith(study, 'test-track', { pathways: 'include' }));
    expect(onAdd).not.toHaveBeenCalled();
    hydrate(null);
    await waitFor(() => expect(onAdd).toHaveBeenCalledOnce());
    expect(onAdd.mock.calls[0][0].genes).toHaveLength(1);
    expect(onAdd.mock.calls[0][0].pathways).toHaveLength(1);
    expect(screen.getByRole('status', { hidden: true })).toHaveTextContent('Saved 1 gene results and 1 pathway results');
  });

  it('makes missing pathways visible after saving the available genes', async () => {
    vi.mocked(popDataFor).mockReturnValue({ ...results, allPathways: [] });
    render(<PublicReferencePicker onAdd={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.change(screen.getByLabelText('Public reference study'), { target: { value: study.id } });
    const button = screen.getByRole('button', { name: 'Download comparison to this browser', hidden: true });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('status', { hidden: true })).toHaveTextContent('gene results only'));
  });

  it('does not report a successful save when local storage rejects', async () => {
    render(<PublicReferencePicker onAdd={vi.fn().mockRejectedValue(new Error('Browser storage is full.'))} />);
    fireEvent.change(screen.getByLabelText('Public reference study'), { target: { value: study.id } });
    const button = screen.getByRole('button', { name: 'Download comparison to this browser', hidden: true });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('alert', { hidden: true })).toHaveTextContent('Browser storage is full.'));
    expect(screen.queryByRole('status', { hidden: true })).not.toBeInTheDocument();
  });
});
