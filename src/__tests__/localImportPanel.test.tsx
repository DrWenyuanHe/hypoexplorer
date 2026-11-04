import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as XLSX from 'xlsx';
import { ImportPanel, mergeLocalImport } from '../local-datasets/ImportPanel';
import { normalizeSheet, parseLocalText } from '../local-datasets/importData';
import type { LocalDataset } from '../local-datasets/types';

const DE = 'gene,logFC,pvalue,padj\nPOMC,2,0.001,0.01\n';
const FGSEA = 'pathway,NES,padj,leadingEdge\nHALLMARK_APOPTOSIS,-1.5,0.02,POMC/AGRP\n';
const NOW = '2026-09-05T00:00:00Z';
const emptyDataset = (): LocalDataset => ({
  id: 'existing-local', name: 'Existing comparison', organism: 'Homo sapiens',
  createdAt: NOW, updatedAt: NOW, genes: [], pathways: [], sources: [],
});
const confirm = () => screen.getByRole('checkbox', { name: /I checked the columns/ });
const save = () => screen.getByRole('button', { name: 'Save confirmed datasets locally' });

function workbook(sheets: Record<string, string>): File {
  const book = XLSX.utils.book_new();
  for (const [name, text] of Object.entries(sheets)) {
    const rows = text.trim().split('\n').map((row) => row.split(','));
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new File([XLSX.write(book, { type: 'array', bookType: 'xlsx' })], 'comparison.xlsx');
}

async function upload(files: File[]) {
  fireEvent.change(screen.getByLabelText('Choose local result files'), { target: { files } });
  await screen.findByRole('navigation', { name: 'Workbook sheets' });
  await waitFor(() => expect(screen.queryByText('Reading or saving in this browser...')).not.toBeInTheDocument());
}

function chooseSheet(name: string) {
  const nav = screen.getByRole('navigation', { name: 'Workbook sheets' });
  fireEvent.click(within(nav).getByRole('button', { name: new RegExp(`^${name} `) }));
}

function assignNew(name = 'Treatment vs control') {
  fireEvent.change(screen.getByLabelText('Dataset / comparison name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Organism'), { target: { value: 'Homo sapiens' } });
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('local import column review', () => {
  it('requires separate confirmation for every included workbook sheet before pairing DE and FGSEA', async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    render(<ImportPanel datasets={[]} onImport={onImport} onCancel={vi.fn()} />);
    await upload([workbook({ DE, FGSEA })]);
    expect(save()).toBeDisabled();
    expect(confirm()).toBeDisabled();
    assignNew();
    expect(confirm()).toBeEnabled();
    expect(save()).toBeDisabled();
    fireEvent.click(confirm());
    expect(screen.getByText('1 of 2 included sheets confirmed')).toBeInTheDocument();
    expect(save()).toBeDisabled();
    chooseSheet('FGSEA');
    expect(screen.getByLabelText('Result type')).toHaveValue('pathway');
    expect(confirm()).not.toBeChecked();
    assignNew();
    fireEvent.click(confirm());
    expect(screen.getByText('2 of 2 included sheets confirmed')).toBeInTheDocument();
    fireEvent.click(save());
    await waitFor(() => expect(onImport).toHaveBeenCalledOnce());
    const imported = onImport.mock.calls[0][0] as LocalDataset[];
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({ name: 'Treatment vs control', organism: 'Homo sapiens' });
    expect(imported[0].genes[0]).toMatchObject({ gene: 'POMC', logFC: 2, padj: 0.01 });
    expect(imported[0].pathways[0]).toMatchObject({ pathway: 'HALLMARK_APOPTOSIS', nes: -1.5, genes: ['POMC', 'AGRP'] });
    expect(imported[0].sources.map((source) => source.sheetName)).toEqual(['DE', 'FGSEA']);
    expect(imported[0].sources[0].mapping).toMatchObject({ gene: 0, logFC: 1, pvalue: 2, padj: 3 });
  });

  it('resets confirmation after changing a mapping and requires another check after the mapping is repaired', async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    render(<ImportPanel datasets={[]} onImport={onImport} onCancel={vi.fn()} />);
    await upload([new File([DE], 'de.csv')]);
    assignNew();
    fireEvent.click(confirm());
    expect(save()).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Log2 fold change *'), { target: { value: '' } });
    expect(confirm()).not.toBeChecked();
    expect(confirm()).toBeDisabled();
    expect(save()).toBeDisabled();
    expect(screen.getByText('Choose a log2 fold-change column.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Log2 fold change *'), { target: { value: '1' } });
    expect(confirm()).toBeEnabled();
    expect(confirm()).not.toBeChecked();
    expect(save()).toBeDisabled();
    fireEvent.click(confirm());
    fireEvent.change(screen.getByLabelText('Adjusted p-value / FDR'), { target: { value: '2' } });
    expect(screen.getByText('Choose a different column for each statistic and identifier.')).toBeInTheDocument();
    expect(confirm()).toBeDisabled();
    expect(save()).toBeDisabled();
    expect(onImport).not.toHaveBeenCalled();
  });

  it('can attach several reviewed files to one existing dataset without changing its identity or original rows', async () => {
    const existing = mergeLocalImport(emptyDataset(), normalizeSheet(parseLocalText('gene,logFC,padj\nAGRP,-1,0.03', 'prior.csv')));
    const before = JSON.stringify(existing);
    const onImport = vi.fn().mockResolvedValue(undefined);
    render(<ImportPanel datasets={[existing]} onImport={onImport} onCancel={vi.fn()} />);
    await upload([new File([DE], 'de.csv'), new File([FGSEA], 'fgsea.csv')]);
    for (const name of ['de.csv', 'fgsea.csv']) {
      chooseSheet(name);
      fireEvent.change(screen.getByLabelText('Add to dataset'), { target: { value: existing.id } });
      expect(screen.queryByLabelText('Organism')).not.toBeInTheDocument();
      fireEvent.click(confirm());
    }
    fireEvent.click(save());
    await waitFor(() => expect(onImport).toHaveBeenCalledOnce());
    const [saved] = onImport.mock.calls[0][0] as LocalDataset[];
    expect(saved).toMatchObject({ id: existing.id, name: existing.name, organism: existing.organism, createdAt: NOW });
    expect(saved.genes.map((row) => row.gene)).toEqual(['AGRP', 'POMC']);
    expect(saved.pathways).toHaveLength(1);
    expect(saved.sources).toHaveLength(3);
    expect(JSON.stringify(existing)).toBe(before);
  });

  it('does not call the persistence callback when two included sheets conflict on a gene', async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    render(<ImportPanel datasets={[]} onImport={onImport} onCancel={vi.fn()} />);
    await upload([workbook({ First: DE, Second: DE.replace('POMC,2', 'POMC,-2') })]);
    for (const name of ['First', 'Second']) {
      chooseSheet(name);
      assignNew();
      fireEvent.click(confirm());
    }
    fireEvent.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent('Conflicting results for POMC');
    expect(screen.getByRole('alert')).toHaveTextContent('Assign separate comparisons to separate datasets');
    expect(onImport).not.toHaveBeenCalled();
    expect(save()).toBeEnabled();
  });

  it('shows skipped and invalid rows for review and never substitutes raw p-values for invalid FDR', async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    const text = 'gene,logFC,pvalue,padj\nVALID,2,0.001,0.01\nUNKNOWN,1,0.000001,malformed\nINVALID,not-a-number,0.001,0.01\n';
    render(<ImportPanel datasets={[]} onImport={onImport} onCancel={vi.fn()} />);
    await upload([new File([text], 'imperfect.csv')]);
    expect(screen.getByText('2 usable rows')).toBeInTheDocument();
    expect(screen.getByText('1 skipped rows')).toBeInTheDocument();
    expect(screen.getByText(/padj values were missing or invalid and remain unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/rows were skipped because their gene or log2 fold change was missing or invalid/)).toBeInTheDocument();
    assignNew();
    fireEvent.click(confirm());
    fireEvent.click(save());
    await waitFor(() => expect(onImport).toHaveBeenCalledOnce());
    const [saved] = onImport.mock.calls[0][0] as LocalDataset[];
    expect(saved.genes).toHaveLength(2);
    expect(saved.genes.find((row) => row.gene === 'UNKNOWN')).toMatchObject({ pvalue: 0.000001, padj: null });
    expect(saved.genes.filter((row) => row.padj !== null && row.padj < 0.05).map((row) => row.gene)).toEqual(['VALID']);
  });

  it('allows an irrelevant sheet to be excluded without treating it as confirmed', async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    render(<ImportPanel datasets={[]} onImport={onImport} onCancel={vi.fn()} />);
    await upload([workbook({ DE, Notes: 'Study,Comment\nExample,These are metadata\n' })]);
    assignNew();
    fireEvent.click(confirm());
    chooseSheet('Notes');
    expect(save()).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include this sheet' }));
    expect(screen.getByText('1 of 1 included sheets confirmed')).toBeInTheDocument();
    fireEvent.click(save());
    await waitFor(() => expect(onImport).toHaveBeenCalledOnce());
    expect((onImport.mock.calls[0][0] as LocalDataset[])[0].sources).toHaveLength(1);
  });

  it('keeps the reviewed draft available when saving fails, then permits a retry', async () => {
    const onImport = vi.fn().mockRejectedValueOnce(new Error('This browser has no space left.')).mockResolvedValueOnce(undefined);
    render(<ImportPanel datasets={[]} onImport={onImport} onCancel={vi.fn()} />);
    await upload([new File([DE], 'de.csv')]);
    assignNew();
    fireEvent.click(confirm());
    fireEvent.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent('This browser has no space left.');
    expect(confirm()).toBeChecked();
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('normalized import merging', () => {
  it('combines DE with FGSEA while retaining provenance, unknown statistics, and dataset metadata', () => {
    const dataset = emptyDataset();
    const de = normalizeSheet(parseLocalText('gene,logFC,pvalue\nPOMC,2,0.001\n', 'de.csv'));
    const pathways = normalizeSheet(parseLocalText(FGSEA, 'fgsea.csv'));
    const merged = mergeLocalImport(mergeLocalImport(dataset, de), pathways);
    expect(merged.id).toBe(dataset.id);
    expect(merged.organism).toBe(dataset.organism);
    expect(merged.createdAt).toBe(NOW);
    expect(merged.genes[0]).toMatchObject({ gene: 'POMC', padj: null, pvalue: 0.001 });
    expect(merged.pathways[0].genes).toContain(merged.genes[0].gene);
    expect(merged.sources.map((source) => source.fileName)).toEqual(['de.csv', 'fgsea.csv']);
    expect(dataset.genes).toEqual([]);
    expect(dataset.pathways).toEqual([]);
  });

  it('deduplicates identical gene results across files, but rejects a changed statistic without mutating existing data', () => {
    const dataset = mergeLocalImport(emptyDataset(), normalizeSheet(parseLocalText(DE, 'first.csv')));
    const repeat = normalizeSheet(parseLocalText(DE.replace('POMC', 'Pomc'), 'repeat.csv'));
    expect(mergeLocalImport(dataset, repeat).genes).toHaveLength(1);
    const before = JSON.stringify(dataset);
    const conflict = normalizeSheet(parseLocalText('gene,logFC,pvalue,padj\nNEW,1,0.01,0.02\npomc,3,0.001,0.01\n', 'conflict.csv'));
    expect(() => mergeLocalImport(dataset, conflict)).toThrow(/Conflicting results for pomc/);
    expect(JSON.stringify(dataset)).toBe(before);
  });

  it('keeps distinct databases separate and rejects conflicting enrichment for the same database/pathway', () => {
    const original = normalizeSheet(parseLocalText('pathway,NES,padj,leadingEdge,database\nSTRESS,1.2,0.01,POMC,CustomA', 'original.csv'));
    const dataset = mergeLocalImport(emptyDataset(), original);
    const repeated = normalizeSheet(parseLocalText('pathway,NES,padj,leadingEdge,database\nSTRESS,1.2,0.01,POMC,CustomA', 'repeat.csv'));
    expect(mergeLocalImport(dataset, repeated).pathways).toHaveLength(1);
    const separate = normalizeSheet(parseLocalText('pathway,NES,padj,leadingEdge,database\nSTRESS,-1.2,0.01,POMC,CustomB', 'separate.csv'));
    expect(mergeLocalImport(dataset, separate).pathways).toHaveLength(2);
    const conflict = normalizeSheet(parseLocalText('pathway,NES,padj,leadingEdge,database\nSTRESS,-1.2,0.01,POMC,CustomA', 'conflict.csv'));
    expect(() => mergeLocalImport(dataset, conflict)).toThrow(/Conflicting pathway results/);
    expect(dataset.pathways[0].nes).toBe(1.2);
  });
});
