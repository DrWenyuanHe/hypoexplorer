import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpressionSurveyView } from '../expression-survey/ExpressionSurveyView';
import { EXISTING_EXPRESSION_SOURCES } from '../expression-survey/existingCatalog';
import {
  loadExpressionGenes, loadExpressionSources, loadExternalSourceErrors, loadExternalValidation,
} from '../expression-survey/expressionData';
import type { ExpressionGeneResult, ExpressionSource } from '../types';
import { downloadFile } from '../utils/exportAction';

vi.mock('../expression-survey/expressionData', () => ({
  loadExpressionSources: vi.fn(), loadExpressionGenes: vi.fn(), loadExpressionValidation: vi.fn(),
  loadExternalSourceErrors: vi.fn(), loadExternalValidation: vi.fn(), loadExternalManifest: vi.fn(),
}));
vi.mock('../utils/exportAction', async (original) => ({
  ...await original<typeof import('../utils/exportAction')>(), downloadFile: vi.fn(),
}));

const existing = EXISTING_EXPRESSION_SOURCES[0];
const source: ExpressionSource = { ...existing, id: 'neuro-test', collection: 'neuroseq', label: 'Test ARC population' };
// Count studies store TMM-normalized CPM since the R 4.6.0 regeneration (rule C2,
// data/quality/regeneration-r460-2026-09-25/README.md); the bars are labelled with the source unit.
const UNIT = 'CPM (TMM-normalized)';

function result(query: string, sourceId = source.id): ExpressionGeneResult {
  return { sourceId, query, gene: query, geneId: 'ENSMUSG00000057722', unit: UNIT, status: 'available', groups: [
    { key: 'control', label: 'Fed', referenceEligible: true, samples: [{ id: 'fed-library', value: 11 }], mean: 11, n: 1, totalSamples: 1 },
    { key: 'case', label: 'Fasted', referenceEligible: false, samples: [{ id: 'fasted-library', value: 99 }], mean: 99, n: 1, totalSamples: 1 },
  ] };
}

beforeEach(() => {
  vi.mocked(loadExternalSourceErrors).mockResolvedValue({});
  vi.mocked(loadExternalValidation).mockRejectedValue(new Error('not under test'));
  vi.mocked(loadExpressionSources).mockResolvedValue([source, existing]);
  vi.mocked(loadExpressionGenes).mockImplementation(async (selected, genes) => genes.map((gene) => result(gene, selected.id)));
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

function submit(gene?: string) {
  const input = screen.getByRole('textbox', { name: 'Gene symbol or Ensembl ID' });
  if (gene !== undefined || !(input as HTMLInputElement).value) {
    fireEvent.change(input, { target: { value: gene ?? 'Lepr' } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Survey →' }));
}

describe('expression survey user flows', () => {
  it('surveys the OXT reference separately and respects its ineligible reference cohorts', async () => {
    const reference: ExpressionSource = {
      ...source, id: 'oxt-reference', collection: 'reference', label: 'Magnocellular OXT cells',
      unit: 'estimated mRNA molecules per cell',
      replicateUnit: 'Individual cells, not independent animal replicates',
    };
    vi.mocked(loadExpressionSources).mockResolvedValue([source, reference, existing]);
    vi.mocked(loadExpressionGenes).mockImplementation(async (selected, genes) => genes.map((gene) => ({
      ...result(gene, selected.id), unit: selected.unit,
      groups: [{ key: 'M3', label: 'M3 cells', referenceEligible: false,
        samples: [{ id: 'cell-1', value: 11 }], mean: 11, n: 1, totalSamples: 1 }],
    })));
    render(<ExpressionSurveyView onHome={() => {}} />);
    await screen.findByText('1 source records selected');
    fireEvent.change(screen.getByRole('combobox', { name: 'Source collection' }), { target: { value: 'reference' } });
    submit('Oxt');
    await screen.findByRole('img', { name: '11 estimated mRNA molecules per cell' });
    expect(loadExpressionGenes).toHaveBeenCalledWith(reference, ['Oxt']);
    expect(screen.getByText(/Individual cells, not independent animal replicates/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fed / reference cohorts only' }));
    expect(screen.queryByRole('img', { name: '11 estimated mRNA molecules per cell' })).not.toBeInTheDocument();
  });

  it('shows published summaries as stated and names the cross-species match', async () => {
    const atlas: ExpressionSource = {
      ...source, id: 'hpa-human-clusters', collection: 'external', label: 'Human clusters · HPA',
      species: 'Homo sapiens', unit: 'nCPM', valueKind: 'summary', summaryStatistic: 'HPA cluster nCPM',
      provider: { name: 'Human Protein Atlas', release: 'HPA version 25', license: 'CC BY 4.0',
        licenseUrl: 'https://www.proteinatlas.org/about/licence', attribution: 'Data from the Human Protein Atlas.' },
    };
    vi.mocked(loadExpressionSources).mockResolvedValue([source, atlas, existing]);
    vi.mocked(loadExpressionGenes).mockImplementation(async (selected, genes) => genes.map((gene) => ({
      sourceId: selected.id, query: gene, status: 'available', gene: 'POMC', geneId: 'ENSG00000115138', unit: 'nCPM',
      groups: [
        { key: 'c-1', label: 'c-1 · splatter', referenceEligible: false, samples: [], mean: null, n: 0, totalSamples: 0, summary: 27.4 },
        { key: 'c-2', label: 'c-2 · mammillary body', referenceEligible: false, samples: [], mean: null, n: 0, totalSamples: 0, summary: 4.1 },
      ],
    })));
    render(<ExpressionSurveyView onHome={() => {}} />);
    await screen.findByText('1 source records selected');
    fireEvent.change(screen.getByRole('combobox', { name: 'Source collection' }), { target: { value: 'external' } });
    submit('Pomc');
    await screen.findByRole('img', { name: '27.4 nCPM' });
    const panel = screen.getByRole('img', { name: '27.4 nCPM' }).closest('section')!;
    expect(panel).toHaveTextContent('Published value · nCPM');
    expect(panel).toHaveTextContent('Pomc → POMC (ENSG00000115138) in Homo sapiens');
    expect(panel).toHaveTextContent('HPA cluster nCPM as stated by the provider; no mean is computed.');
    expect(panel).toHaveTextContent('Data from the Human Protein Atlas. CC BY 4.0');
    expect(panel.querySelector('td[title="Published summary; no sample values"]')).toHaveTextContent('—');
  });

  it('shows every probe of a microarray gene as its own row, never merged', async () => {
    const array: ExpressionSource = {
      ...source, id: 'allen-array', collection: 'external', label: 'Human hypothalamus · Allen microarray',
      species: 'Homo sapiens', unit: 'log2 normalized intensity', featureLevel: 'probe',
    };
    vi.mocked(loadExpressionSources).mockResolvedValue([source, array, existing]);
    vi.mocked(loadExpressionGenes).mockImplementation(async (selected, genes) => genes.flatMap((gene) =>
      [['A_23_P1', 9.5], ['CUST_2', 4.25]].map(([probe, value]) => ({
        sourceId: selected.id, query: gene, status: 'available' as const, gene: 'POMC', geneId: String(probe), probe: String(probe),
        unit: selected.unit, groups: [{ key: 'donor-1', label: 'H0351.2001', referenceEligible: false,
          samples: [{ id: 'well', value: Number(value) }], mean: Number(value), n: 1, totalSamples: 1 }],
      }))));
    render(<ExpressionSurveyView onHome={() => {}} />);
    await screen.findByText('1 source records selected');
    fireEvent.change(screen.getByRole('combobox', { name: 'Source collection' }), { target: { value: 'external' } });
    submit('Pomc');
    await screen.findByRole('img', { name: '9.5 log2 normalized intensity' });
    const panel = screen.getByRole('img', { name: '9.5 log2 normalized intensity' }).closest('section')!;
    expect(panel).toHaveTextContent('Pomc → POMC (2 probes A_23_P1, CUST_2) in Homo sapiens');
    expect(panel).toHaveTextContent('H0351.2001 · probe A_23_P1');
    expect(panel).toHaveTextContent('H0351.2001 · probe CUST_2');
    expect(screen.getByRole('img', { name: '4.25 log2 normalized intensity' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gene matrix' }));
    expect(await screen.findByText('9.5 · 4.25')).toBeInTheDocument();
  });

  it('labels the first existing source in TMM-normalized CPM', () => {
    expect(existing.unit).toBe(UNIT);
  });

  it('keeps the landing bounded and loads values only after the user submits', async () => {
    render(<ExpressionSurveyView onHome={() => {}} />);
    await screen.findByText('1 source records selected');
    expect(screen.getByRole('textbox', { name: 'Gene symbol or Ensembl ID' })).toHaveValue('');
    expect(screen.getByText('Populations').closest('details')).not.toHaveAttribute('open');
    expect(screen.queryByRole('button', { name: 'Agrp' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Result display' })).not.toBeInTheDocument();
    expect(screen.getByText(/Choose your sources, enter a gene/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export ↓' })).not.toBeInTheDocument();
    expect(loadExpressionGenes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Population catalog' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Tissue & bulk' }));
    fireEvent.click(screen.getByRole('button', { name: /Arcuate nucleus/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Gene survey' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Source collection' }), { target: { value: 'existing' } });
    expect(loadExpressionGenes).not.toHaveBeenCalled();
    submit('Agrp');
    await screen.findByRole('columnheader', { name: 'Agrp · mean' });
    expect(loadExpressionGenes).toHaveBeenCalledWith(existing, ['Agrp']);
  });

  it('requires input and retains population selection when opening a multi-gene survey', async () => {
    render(<ExpressionSurveyView onHome={() => {}} />);
    await screen.findByText('1 source records selected');
    fireEvent.click(screen.getByRole('button', { name: 'Survey →' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter at least one gene');
    expect(loadExpressionGenes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Populations'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    submit('Lepr, Agrp');
    expect(await screen.findByText('Select a population or another source collection to begin.')).toBeInTheDocument();
    expect(loadExpressionGenes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    await waitFor(() => expect(loadExpressionGenes).toHaveBeenCalledWith(source, ['Lepr', 'Agrp']));
    expect(screen.getByRole('button', { name: 'Gene matrix' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export ↓' })).toBeEnabled());
  });

  it('caps source loads across query changes and skips obsolete queued sources', async () => {
    const sources = Array.from({ length: 8 }, (_, index) => ({ ...source, id: `source-${index}` }));
    vi.mocked(loadExpressionSources).mockResolvedValue(sources);
    const finishOld: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    vi.mocked(loadExpressionGenes).mockImplementation((selected, genes) => {
      active++;
      peak = Math.max(peak, active);
      if (genes[0] === 'Lepr') return new Promise((resolve) => {
        finishOld.push(() => { active--; resolve([result('Lepr', selected.id)]); });
      });
      active--;
      return Promise.resolve(genes.map((gene) => result(gene, selected.id)));
    });
    render(<ExpressionSurveyView onHome={() => {}} />);
    submit();
    await waitFor(() => expect(loadExpressionGenes).toHaveBeenCalledTimes(4));
    fireEvent.change(screen.getByRole('textbox', { name: 'Gene symbol or Ensembl ID' }), { target: { value: 'Agrp' } });
    submit();
    expect(loadExpressionGenes).toHaveBeenCalledTimes(4);
    await act(async () => { for (const finish of finishOld) finish(); });
    await screen.findByRole('columnheader', { name: 'Agrp · mean' });
    expect(peak).toBe(4);
    const calls = vi.mocked(loadExpressionGenes).mock.calls;
    expect(calls.filter(([, genes]) => genes[0] === 'Lepr')).toHaveLength(4);
    expect(calls.filter(([, genes]) => genes[0] === 'Agrp')).toHaveLength(8);
    expect(screen.queryByRole('columnheader', { name: 'Lepr · mean' })).not.toBeInTheDocument();
  });

  it('discards a slow old query when a new gene finishes first', async () => {
    let finishOld: (value: ExpressionGeneResult[]) => void = () => {};
    vi.mocked(loadExpressionGenes).mockImplementation((selected, genes) => genes[0] === 'Lepr'
      ? new Promise((resolve) => { finishOld = resolve; })
      : Promise.resolve(genes.map((gene) => result(gene, selected.id))));
    render(<ExpressionSurveyView onHome={() => {}} />);
    submit();
    await waitFor(() => expect(loadExpressionGenes).toHaveBeenCalled());
    fireEvent.change(screen.getByRole('textbox', { name: 'Gene symbol or Ensembl ID' }), { target: { value: 'Agrp' } });
    submit();
    await screen.findByRole('columnheader', { name: 'Agrp · mean' });
    await act(async () => { finishOld([result('Lepr')]); });
    expect(screen.queryByRole('columnheader', { name: 'Lepr · mean' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Agrp · mean' })).toBeInTheDocument();
  });

  it('keeps unknown genes distinct from measured zero and removes old bars', async () => {
    render(<ExpressionSurveyView onHome={() => {}} />);
    submit();
    await screen.findByRole('img', { name: `11 ${UNIT}` });
    vi.mocked(loadExpressionGenes).mockResolvedValue([{ sourceId: source.id, query: 'unknown', status: 'not-retained', unit: UNIT, groups: [] }]);
    fireEvent.change(screen.getByRole('textbox', { name: 'Gene symbol or Ensembl ID' }), { target: { value: 'unknown' } });
    submit();
    await screen.findByText(/Not retained in this source/);
    expect(screen.queryByRole('img', { name: `11 ${UNIT}` })).not.toBeInTheDocument();
  });

  it('blocks an incomplete export when a selected source fails', async () => {
    let unavailable = true;
    vi.mocked(loadExpressionSources).mockResolvedValue([source, { ...source, id: 'failed-source' }]);
    vi.mocked(loadExpressionGenes).mockImplementation(async (selected, genes) => {
      if (selected.id === 'failed-source' && unavailable) throw new Error('Source unavailable');
      return genes.map((gene) => result(gene, selected.id));
    });
    render(<ExpressionSurveyView onHome={() => {}} />);
    submit();
    await screen.findByText(/Source unavailable/);
    expect(screen.getByRole('button', { name: 'Export ↓' })).toBeDisabled();
    expect(downloadFile).not.toHaveBeenCalled();
    unavailable = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry source data' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export ↓' })).toBeEnabled());
    expect(screen.queryByText('Source unavailable')).not.toBeInTheDocument();
  });

  it('exports only eligible selected cohorts and retains stable gene and cohort IDs', async () => {
    let exported: Blob | null = null;
    vi.stubGlobal('URL', { createObjectURL: (blob: Blob) => { exported = blob; return 'blob:test'; }, revokeObjectURL: vi.fn() });
    render(<ExpressionSurveyView onHome={() => {}} />);
    submit();
    await screen.findByRole('img', { name: `11 ${UNIT}` });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fed / reference cohorts only' }));
    expect(screen.queryByRole('img', { name: `99 ${UNIT}` })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export ↓' }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(exported!);
    });
    expect(text).toContain('gene_id');
    expect(text).toContain('cohort_key');
    expect(text).toContain('ENSMUSG00000057722');
    expect(text).toContain('fed-library');
    expect(text).not.toContain('fasted-library');
  });

  it('can recover to existing studies when NeuroSeq metadata is unavailable', async () => {
    vi.mocked(loadExpressionSources).mockRejectedValue(new Error('NeuroSeq unavailable'));
    render(<ExpressionSurveyView onHome={() => {}} />);
    await screen.findByText(/NeuroSeq unavailable/);
    fireEvent.click(screen.getByRole('tab', { name: 'Population catalog' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use study library' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Gene survey' })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByRole('combobox', { name: 'Source collection' })).toHaveValue('existing');
  });
});
