import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXISTING_EXPRESSION_SOURCES } from '../expression-survey/existingCatalog';
import { loadExpressionGenes, loadExternalValidation } from '../expression-survey/expressionData';
import { EXTERNAL_PROVIDERS } from '../expression-survey/externalReferenceFormat';
import type { ExternalValidation } from '../expression-survey/externalReferenceFormat';
import { createSourceQueue, useExternalValidation, useKeyedLoad, useSurveyLoad } from '../expression-survey/useSurveyLoad';
import type { ExpressionGeneResult, ExpressionSource } from '../types';

vi.mock('../expression-survey/expressionData', () => ({ loadExpressionGenes: vi.fn(), loadExternalValidation: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); });

const source = (id: string): ExpressionSource => ({ ...EXISTING_EXPRESSION_SOURCES[0], id });
const result = (sourceId: string, query: string): ExpressionGeneResult =>
  ({ sourceId, query, unit: 'TPM', status: 'available', groups: [] });

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('createSourceQueue', () => {
  it('runs at most `limit` tasks at once and skips work cancelled before its turn', async () => {
    const queue = createSourceQueue(2);
    const gates = [deferred<string>(), deferred<string>(), deferred<string>(), deferred<string>()];
    let active = 0;
    let peak = 0;
    const work = (index: number) => async () => {
      active++;
      peak = Math.max(peak, active);
      try { return await gates[index].promise; } finally { active--; }
    };
    let cancelled = false;
    const outcomes = [
      queue(work(0), () => false),
      queue(work(1), () => false),
      queue(work(2), () => cancelled),
      queue(work(3), () => false),
    ];
    cancelled = true;
    gates[0].resolve('first');
    gates[1].resolve('second');
    await Promise.resolve();
    gates[3].resolve('fourth');
    expect(await Promise.all(outcomes)).toEqual(['first', 'second', null, 'fourth']);
    expect(peak).toBe(2);
  });
});

describe('useSurveyLoad', () => {
  const sources = [source('a'), source('b'), source('c')];

  it('reports results in selection order once every source has settled', async () => {
    const gates = new Map(sources.map((s) => [s.id, deferred<ExpressionGeneResult[]>()]));
    vi.mocked(loadExpressionGenes).mockImplementation((selected) => gates.get(selected.id)!.promise);
    const { result: load } = renderHook(() => useSurveyLoad({ enabled: true, sources, genes: ['Agrp'] }));
    expect(load.current.loading).toBe(true);
    await act(async () => { gates.get('c')!.resolve([result('c', 'Agrp')]); gates.get('a')!.resolve([result('a', 'Agrp')]); });
    expect(load.current).toMatchObject({ loading: true, results: [], errors: {} });
    await act(async () => { gates.get('b')!.reject(new Error('b is down')); });
    expect(load.current.loading).toBe(false);
    expect(load.current.results.map((r) => r.sourceId)).toEqual(['a', 'c']);
    expect(load.current.errors).toEqual({ b: 'b is down' });
  });

  it('retries only the failed source and keeps the others\' values', async () => {
    let bDown = true;
    vi.mocked(loadExpressionGenes).mockImplementation(async (selected, genes) => {
      if (selected.id === 'b' && bDown) throw new Error('b is down');
      return genes.map((gene) => result(selected.id, gene));
    });
    const { result: load } = renderHook(() => useSurveyLoad({ enabled: true, sources, genes: ['Agrp'] }));
    await waitFor(() => expect(load.current.errors).toEqual({ b: 'b is down' }));
    expect(loadExpressionGenes).toHaveBeenCalledTimes(3);
    bDown = false;
    act(() => load.current.retry('b'));
    expect(load.current.loading).toBe(true);
    await waitFor(() => expect(load.current.loading).toBe(false));
    expect(loadExpressionGenes).toHaveBeenCalledTimes(4);
    expect(vi.mocked(loadExpressionGenes).mock.calls[3][0].id).toBe('b');
    expect(load.current.results.map((r) => r.sourceId)).toEqual(['a', 'b', 'c']);
    expect(load.current.errors).toEqual({});
  });

  it('drops a superseded survey\'s late results and skips its queued sources', async () => {
    const many = Array.from({ length: 6 }, (_, index) => source(`s${index}`));
    const slow: Array<() => void> = [];
    vi.mocked(loadExpressionGenes).mockImplementation((selected, genes) => genes[0] === 'Lepr'
      ? new Promise((resolve) => { slow.push(() => resolve([result(selected.id, 'Lepr')])); })
      : Promise.resolve(genes.map((gene) => result(selected.id, gene))));
    const { result: load, rerender } = renderHook(
      ({ genes }) => useSurveyLoad({ enabled: true, sources: many, genes }),
      { initialProps: { genes: ['Lepr'] } },
    );
    expect(loadExpressionGenes).toHaveBeenCalledTimes(4);
    rerender({ genes: ['Agrp'] });
    expect(loadExpressionGenes).toHaveBeenCalledTimes(4);
    await act(async () => { for (const finish of slow) finish(); });
    await waitFor(() => expect(load.current.loading).toBe(false));
    const calls = vi.mocked(loadExpressionGenes).mock.calls;
    expect(calls.filter(([, genes]) => genes[0] === 'Lepr')).toHaveLength(4);
    expect(calls.filter(([, genes]) => genes[0] === 'Agrp')).toHaveLength(6);
    expect(new Set(load.current.results.map((r) => r.query))).toEqual(new Set(['Agrp']));
  });

  it('loads nothing until enabled with a gene', () => {
    const { result: load, rerender } = renderHook(
      ({ enabled, genes }) => useSurveyLoad({ enabled, sources, genes }),
      { initialProps: { enabled: false, genes: ['Agrp'] } },
    );
    rerender({ enabled: true, genes: [] });
    expect(loadExpressionGenes).not.toHaveBeenCalled();
    expect(load.current).toMatchObject({ loading: false, results: [], errors: {} });
  });
});

describe('useExternalValidation', () => {
  it('reports each atlas as it settles and re-requests only failed reports on return or retry', async () => {
    const gates = new Map(EXTERNAL_PROVIDERS.map((provider) => [provider, deferred<ExternalValidation>()]));
    vi.mocked(loadExternalValidation).mockImplementation((provider) => gates.get(provider)!.promise);
    const { result: state, rerender } = renderHook(({ active }) => useExternalValidation(active), { initialProps: { active: false } });
    expect(loadExternalValidation).not.toHaveBeenCalled();
    rerender({ active: true });
    expect(loadExternalValidation).toHaveBeenCalledTimes(EXTERNAL_PROVIDERS.length);
    const [first, second] = EXTERNAL_PROVIDERS;
    const report = { provider: first } as unknown as ExternalValidation;
    await act(async () => { gates.get(first)!.resolve(report); });
    expect(state.current.reports).toEqual({ [first]: report });
    await act(async () => { gates.get(second)!.reject(new Error('offline')); });
    expect(state.current.reports[second]).toBe('offline');
    rerender({ active: false });
    rerender({ active: true });
    const requested = () => vi.mocked(loadExternalValidation).mock.calls.slice(EXTERNAL_PROVIDERS.length).map(([provider]) => provider);
    expect(requested()).not.toContain(first);
    expect(requested()).toContain(second);
    const before = requested().length;
    act(() => state.current.retry());
    expect(requested().slice(before)).not.toContain(first);
    expect(requested().slice(before)).toContain(second);
  });
});

describe('useKeyedLoad', () => {
  it('loads a key once, keeps its value while the key is null, and reloads only on retry', async () => {
    const load = vi.fn(async () => 'report');
    const { result: state, rerender } = renderHook(({ key }) => useKeyedLoad(key, load, 'failed'), { initialProps: { key: 'r' as string | null } });
    await waitFor(() => expect(state.current.value).toBe('report'));
    rerender({ key: null });
    rerender({ key: 'r' });
    expect(load).toHaveBeenCalledTimes(1);
    expect(state.current).toMatchObject({ value: 'report', loading: false, error: '' });
    act(() => state.current.retry());
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('reports a failure, keeps the last value, and tries a failed key again when it returns', async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('offline'));
    const { result: state, rerender } = renderHook(({ key }) => useKeyedLoad(key, load, 'failed'), { initialProps: { key: 'r' as string | null } });
    await waitFor(() => expect(state.current.error).toBe('offline'));
    expect(state.current.value).toBeUndefined();
    rerender({ key: null });
    load.mockResolvedValue('report');
    rerender({ key: 'r' });
    await waitFor(() => expect(state.current).toMatchObject({ value: 'report', error: '' }));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('drops the result of a superseded key', async () => {
    const gates = { a: deferred<string>(), b: deferred<string>() };
    const { result: state, rerender } = renderHook(
      ({ key }) => useKeyedLoad(key, () => gates[key].promise, 'failed'),
      { initialProps: { key: 'a' as 'a' | 'b' } },
    );
    rerender({ key: 'b' });
    await act(async () => { gates.b.resolve('B'); });
    await act(async () => { gates.a.resolve('A'); });
    expect(state.current.value).toBe('B');
  });
});
