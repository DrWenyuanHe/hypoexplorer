import { useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registryCards, type DatasetCatalog } from '../data/datasetCatalog';
import * as catalogModule from '../data/datasetCatalog';
import { datasetQuality } from '../data/datasetQualityR460';
import { DEFAULT_GENE_STUDY_FILTERS, useStudySelection, type GeneStudyFilters } from '../crossdataset/geneStudyScope';
import { useCategoryScope, useReportQuery } from '../crossdataset/forestReport';
import type { DatasetCategory } from '../data/datasetCategories';

const { loadCatalog } = vi.hoisted(() => ({ loadCatalog: vi.fn() }));
vi.mock('../data/datasetCatalog', async (original) => ({
  ...await original<typeof import('../data/datasetCatalog')>(), loadDatasetCatalog: loadCatalog,
}));
vi.mock('../data/datasetQualityR460', async (original) => ({
  ...await original<typeof import('../data/datasetQualityR460')>(), datasetQuality: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

type Options = Parameters<typeof useStudySelection>[0];
const cards = registryCards();
const chosen = cards[0].dataset;
const idsOf = (datasets: readonly { id: string }[]) => datasets.map((dataset) => dataset.id);
const assessment = (status: 'pass' | 'fail' | 'review' | 'not_assessed' | 'not_applicable') =>
  ({ status, policyVersion: '', scope: '', checks: [] });
const passing = () => ({
  internalQc: assessment('pass'), pipelineQc: assessment('pass'),
  experimentalDesign: assessment('pass'), authorConcordance: assessment('pass'),
});
const options = (overrides: Partial<Options> = {}): Options => ({
  kind: 'gene', term: 'Pomc', categories: { activeCats: null, setActiveCats: vi.fn() }, ...overrides,
});

beforeEach(() => {
  loadCatalog.mockReset().mockReturnValue(new Promise<DatasetCatalog>(() => {}));
  vi.mocked(datasetQuality).mockReset().mockReturnValue(passing());
});

afterEach(() => { vi.restoreAllMocks(); });

describe('study selection interface', () => {
  it.each(['gene', 'pathway', 'bars'] as const)('starts %s from registry cards without waiting when counts are not needed', (kind) => {
    const { result } = renderHook(() => useStudySelection(options({ kind })));
    const expected = cards.filter((card) => kind !== 'pathway' || card.dataset.supportsPathways).map((card) => card.dataset);
    expect(result.current.selectedDatasets).toEqual(expected);
    expect(result.current.awaitingCounts).toBe(false);
    expect(JSON.parse(result.current.queryKey)).toEqual([kind === 'bars' ? 'POMC' : 'Pomc', idsOf(expected)]);
  });

  it.each(['gene', 'pathway', 'bars'] as const)('gates %s on delayed counts, then requires the minimum in both arms', async (kind) => {
    const catalog = deferred<DatasetCatalog>();
    loadCatalog.mockReturnValue(catalog.promise);
    const measured = cards.map((card, index) => ({ ...card,
      nBaseline: index === 0 ? 5 : index === 1 ? 20 : index === 2 ? 4 : null,
      nCase: index === 0 ? 8 : index === 1 ? 4 : 20,
    }));
    const { result } = renderHook(() => useStudySelection(options({
      kind, studyFilters: { minSamples: 5, requiredChecks: [] },
    })));
    expect(result.current.awaitingCounts).toBe(true);
    expect(result.current.queryKey).toBe('');
    await act(async () => { catalog.resolve({ cards: measured, state: 'complete' }); });
    expect(result.current.awaitingCounts).toBe(false);
    expect(idsOf(result.current.selectedDatasets)).toEqual(
      kind !== 'pathway' || chosen.supportsPathways ? [chosen.id] : [],
    );
  });

  it('settles registry-only fallback without treating unknown counts as sufficient', async () => {
    const catalog = deferred<DatasetCatalog>();
    loadCatalog.mockReturnValue(catalog.promise);
    const { result } = renderHook(() => useStudySelection(options({
      studyFilters: { minSamples: 5, requiredChecks: [] },
    })));
    await act(async () => { catalog.resolve({ cards, state: 'registry-only' }); });
    expect(result.current.awaitingCounts).toBe(false);
    expect(result.current.selectedDatasets).toEqual([]);
    expect(JSON.parse(result.current.queryKey)).toEqual(['Pomc', []]);
  });

  it('combines categories and individual studies, preserving empty selection and an idle term', () => {
    const base = options({ categories: { activeCats: new Set([chosen.category]), setActiveCats: vi.fn() } });
    const { result, rerender } = renderHook(useStudySelection, { initialProps: base });
    expect(result.current.selectedDatasets.every((dataset) => dataset.category === chosen.category)).toBe(true);
    rerender({ ...base, datasetScope: [chosen.id] });
    expect(idsOf(result.current.selectedDatasets)).toEqual([chosen.id]);
    rerender({ ...base, datasetScope: [] });
    expect(result.current.selectedDatasets).toEqual([]);
    expect(JSON.parse(result.current.queryKey)).toEqual(['Pomc', []]);
    rerender({ ...base, term: '' });
    expect(result.current.queryKey).toBe('');
  });

  it('excludes studies without pathways before and after catalog settlement', async () => {
    const catalog = deferred<DatasetCatalog>();
    loadCatalog.mockReturnValue(catalog.promise);
    const mixed = cards.map((card, index) => index === 0
      ? { ...card, dataset: { ...card.dataset, supportsPathways: false } } : card);
    vi.spyOn(catalogModule, 'registryCards').mockReturnValue(mixed);
    const supported = mixed.filter((card) => card.dataset.supportsPathways);
    expect(supported.length).toBeLessThan(mixed.length);
    const { result } = renderHook(() => useStudySelection(options({ kind: 'pathway' })));
    expect(result.current.cards).toEqual(supported);
    await act(async () => { catalog.resolve({ cards: mixed, state: 'complete' }); });
    expect(result.current.cards).toEqual(supported);
    expect(idsOf(result.current.selectedDatasets)).toEqual(supported.map((card) => card.dataset.id));
  });

  it('requires an explicit pass in every selected evidence domain', () => {
    const base = options({ datasetScope: [chosen.id] });
    const { result, rerender } = renderHook(useStudySelection, { initialProps: base });
    const domains = ['pipelineQc', 'experimentalDesign', 'authorConcordance'] as const;
    for (const domain of domains) {
      for (const status of ['fail', 'review', 'not_assessed', 'not_applicable'] as const) {
        vi.mocked(datasetQuality).mockReturnValue({ ...passing(), [domain]: assessment(status) });
        rerender({ ...base, studyFilters: { minSamples: 0, requiredChecks: [domain] } });
        expect(result.current.selectedDatasets).toEqual([]);
        rerender({ ...base, studyFilters: { minSamples: 0, requiredChecks: domains.filter((key) => key !== domain) } });
        expect(idsOf(result.current.selectedDatasets)).toEqual([chosen.id]);
        rerender({ ...base, studyFilters: { minSamples: 0, requiredChecks: [...domains] } });
        expect(result.current.selectedDatasets).toEqual([]);
      }
    }
    vi.mocked(datasetQuality).mockReturnValue(passing());
    rerender({ ...base, studyFilters: { minSamples: 0, requiredChecks: [...domains] } });
    expect(idsOf(result.current.selectedDatasets)).toEqual([chosen.id]);
    rerender({ ...base, studyFilters: { minSamples: 5, requiredChecks: [...domains] } });
    expect(result.current.selectedDatasets).toEqual([]);
  });

  it.each(['gene', 'pathway'] as const)('resets %s categories, filters and individual selection through their owners', (kind) => {
    const { result } = renderHook(() => {
      const [datasetScope, onDatasetScopeChange] = useState<string[] | null>([]);
      const [studyFilters, onStudyFiltersChange] = useState<GeneStudyFilters>({ minSamples: 5, requiredChecks: ['pipelineQc'] });
      const categories = useCategoryScope<DatasetCategory>([chosen.category]);
      const selection = useStudySelection({ kind, term: 'Pomc', categories,
        datasetScope, onDatasetScopeChange, studyFilters, onStudyFiltersChange });
      return { selection, categories, datasetScope };
    });
    act(() => result.current.selection.reset());
    expect(result.current.categories.activeCats).toBeNull();
    expect(result.current.datasetScope).toBeNull();
    expect(result.current.selection.filters).toEqual(DEFAULT_GENE_STUDY_FILTERS);
    expect(result.current.selection.awaitingCounts).toBe(false);
  });

  it('also resets locally owned filters', () => {
    const { result } = renderHook(() => useStudySelection(options()));
    act(() => result.current.changeFilters({ minSamples: 5, requiredChecks: [] }));
    expect(result.current.awaitingCounts).toBe(true);
    act(() => result.current.reset());
    expect(result.current.filters).toEqual(DEFAULT_GENE_STUDY_FILTERS);
    expect(result.current.awaitingCounts).toBe(false);
  });

  it('keeps bars categories out of query identity and resets only those categories', () => {
    const onDatasetScopeChange = vi.fn();
    const onStudyFiltersChange = vi.fn();
    const filters: GeneStudyFilters = { minSamples: 0, requiredChecks: ['pipelineQc'] };
    const { result } = renderHook(() => {
      const categories = useCategoryScope<DatasetCategory>([chosen.category]);
      const selection = useStudySelection(options({ kind: 'bars', categories,
        datasetScope: [chosen.id], studyFilters: filters, onDatasetScopeChange, onStudyFiltersChange }));
      return { selection, categories };
    });
    const queryKey = result.current.selection.queryKey;
    act(() => result.current.categories.setActiveCats(new Set(['Aging'])));
    expect(result.current.selection.queryKey).toBe(queryKey);
    act(() => result.current.selection.reset());
    expect(result.current.categories.activeCats).toBeNull();
    expect(result.current.selection.queryKey).toBe(queryKey);
    expect(result.current.selection.filters).toEqual(filters);
    expect(onStudyFiltersChange).not.toHaveBeenCalled();
    expect(onDatasetScopeChange).not.toHaveBeenCalled();
  });

  it('does not let an old catalog load replace a newly mounted selection', async () => {
    const oldCatalog = deferred<DatasetCatalog>();
    const currentCatalog = deferred<DatasetCatalog>();
    loadCatalog.mockReturnValueOnce(oldCatalog.promise).mockReturnValueOnce(currentCatalog.promise);
    const settings = options({ studyFilters: { minSamples: 5, requiredChecks: [] } });
    const old = renderHook(() => useStudySelection(settings));
    old.unmount();
    const { result } = renderHook(() => useStudySelection(settings));
    await act(async () => { oldCatalog.resolve({ cards: [], state: 'registry-only' }); });
    expect(result.current.awaitingCounts).toBe(true);
    await act(async () => { currentCatalog.resolve({
      cards: [{ ...cards[0], nBaseline: 5, nCase: 5 }], state: 'complete',
    }); });
    expect(idsOf(result.current.selectedDatasets)).toEqual([chosen.id]);
  });

  it('lets the report-query seam discard results and progress for a superseded selection', async () => {
    const pending: Array<{ done: ReturnType<typeof deferred<string>>; progress: (loaded: number, total: number) => void }> = [];
    const load = vi.fn((_key: string, { onProgress }: { onProgress: (loaded: number, total: number) => void }) => {
      const done = deferred<string>();
      pending.push({ done, progress: onProgress });
      return done.promise;
    });
    const base = options();
    const { result, rerender } = renderHook((props: Options) => {
      const selection = useStudySelection(props);
      return useReportQuery(selection.queryKey, load, 'Failed');
    }, { initialProps: base });
    expect(load).toHaveBeenCalledTimes(1);
    rerender({ ...base, datasetScope: [chosen.id] });
    expect(load).toHaveBeenCalledTimes(2);
    act(() => { pending[1].progress(1, 2); pending[0].progress(100, 100); });
    expect(result.current.progress).toEqual({ loaded: 1, total: 2 });
    await act(async () => { pending[1].done.resolve('selected study'); });
    await act(async () => { pending[0].done.resolve('old whole corpus'); });
    expect(result.current.result).toBe('selected study');
    expect(result.current.loading).toBe(false);
    rerender({ ...base, term: '' });
    await waitFor(() => expect(result.current.result).toBeNull());
    expect(load).toHaveBeenCalledTimes(2);
  });
});
