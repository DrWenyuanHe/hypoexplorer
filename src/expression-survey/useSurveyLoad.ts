// The expression survey's load lifecycle. `useSurveyLoad` owns the value
// requests for a survey: the shared concurrency queue, per-source errors and a
// per-source retry. `useKeyedLoad` is the one cancelled-flag lifecycle for the
// survey's other requests (catalog, validation reports, sample metadata), each
// with its own retry, so retrying one request never re-fetches another.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadExpressionGenes, loadExternalValidation } from './expressionData';
import { EXTERNAL_PROVIDERS } from './externalReferenceFormat';
import type { ExternalProvider, ExternalValidation } from './externalReferenceFormat';
import type { ExpressionGeneResult, ExpressionSource } from './expressionTypes';

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * A concurrency-limited queue. Work whose `cancelled()` is true when its turn
 * comes resolves null without running; work already running finishes, so shared
 * in-flight loads still warm the loaders' caches for later queries.
 */
export function createSourceQueue(limit: number) {
  const waiting: Array<() => Promise<void>> = [];
  let active = 0;
  function drain() {
    while (active < limit && waiting.length) {
      const task = waiting.shift()!;
      active++;
      void task().finally(() => { active--; drain(); });
    }
  }
  return <T,>(work: () => Promise<T>, cancelled: () => boolean): Promise<T | null> =>
    new Promise((resolve, reject) => {
      waiting.push(async () => {
        if (cancelled()) { resolve(null); return; }
        try { resolve(await work()); } catch (error) { reject(error); }
      });
      drain();
    });
}

export interface KeyedLoad<T> {
  /** The last loaded value; kept while a later key or retry loads, and after a failure. */
  value: T | undefined;
  error: string;
  loading: boolean;
  retry: () => void;
}

/**
 * Loads when `key` changes to anything but the last successfully loaded key, and
 * when `retry` is called. A null key loads nothing and keeps the last value, so
 * a view can name its key only while it needs the data: returning to the loaded
 * key does not reload it, while a key that failed loads again when it returns.
 * A late result of a superseded key is dropped.
 */
export function useKeyedLoad<T>(key: string | null, load: () => Promise<T>, failure: string): KeyedLoad<T> {
  const [state, setState] = useState<{ value: T | undefined; error: string; loading: boolean }>({
    value: undefined,
    error: '',
    loading: key !== null,
  });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ load, failure });
  latest.current = { load, failure };
  const loaded = useRef<{ key: string; attempt: number } | null>(null);
  useEffect(() => {
    if (key === null || (loaded.current?.key === key && loaded.current.attempt === attempt)) return;
    let cancelled = false;
    setState((current) => ({ ...current, error: '', loading: true }));
    latest.current.load().then(
      (value) => {
        if (cancelled) return;
        loaded.current = { key, attempt };
        setState({ value, error: '', loading: false });
      },
      (error: unknown) => {
        if (!cancelled) setState((current) => ({ ...current, error: message(error, latest.current.failure), loading: false }));
      },
    );
    return () => { cancelled = true; };
  }, [key, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { ...state, retry };
}

type ExternalReports = Partial<Record<ExternalProvider, ExternalValidation | string>>;

/**
 * Each reference atlas's validation report (or its error text), requested while
 * `active`. Reports arrive per provider; a loaded report is not requested again,
 * a failed one is re-requested when `active` returns or on `retry`.
 */
export function useExternalValidation(active: boolean): { reports: ExternalReports; retry: () => void } {
  const [reports, setReports] = useState<ExternalReports>({});
  const [attempt, setAttempt] = useState(0);
  const current = useRef(reports);
  current.current = reports;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the retry token; loaded reports are read through a ref.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    for (const provider of EXTERNAL_PROVIDERS) {
      if (typeof current.current[provider] === 'object') continue;
      loadExternalValidation(provider).then(
        (report) => { if (!cancelled) setReports((previous) => ({ ...previous, [provider]: report })); },
        (error: unknown) => {
          if (!cancelled)
            setReports((previous) => ({ ...previous, [provider]: message(error, 'Validation report could not be loaded.') }));
        },
      );
    }
    return () => { cancelled = true; };
  }, [active, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { reports, retry };
}

type SourceEntry = { results: ExpressionGeneResult[]; error: string | null };
type Run = { key: string; cancelled: boolean };

export interface SurveyLoad {
  /** True until every selected source has settled. */
  loading: boolean;
  /** Settled results in selection order; empty while loading. */
  results: ExpressionGeneResult[];
  /** Error text by source id; empty while loading. */
  errors: Record<string, string>;
  /** Re-requests one failed source's values; other sources keep theirs. */
  retry: (sourceId: string) => void;
}

const QUEUE_LIMIT = 4;

async function loadSource(source: ExpressionSource, genes: string[]): Promise<SourceEntry> {
  try {
    return { results: await loadExpressionGenes(source, genes), error: null };
  } catch (error: unknown) {
    return { results: [], error: message(error, 'Expression values could not be loaded.') };
  }
}

/**
 * Expression values for the selected sources and genes. Requests start when
 * `enabled` and at least one gene is given, and restart when the selection or
 * the genes change; work queued for a superseded survey is skipped.
 */
export function useSurveyLoad({ enabled, sources, genes }: {
  enabled: boolean;
  sources: readonly ExpressionSource[];
  genes: readonly string[];
}): SurveyLoad {
  const key = JSON.stringify([sources.map((source) => source.id), genes]);
  const [queue] = useState(() => createSourceQueue(QUEUE_LIMIT));
  const [state, setState] = useState<{ key: string; entries: Record<string, SourceEntry> }>({ key: '', entries: {} });
  const latest = useRef({ sources, genes });
  latest.current = { sources, genes };
  const run = useRef<Run | null>(null);

  const request = useCallback((current: Run, source: ExpressionSource, genes: string[]) => {
    void queue(() => loadSource(source, genes), () => current.cancelled).then((entry) => {
      if (!entry || current.cancelled) return;
      setState((previous) => previous.key === current.key
        ? { key: previous.key, entries: { ...previous.entries, [source.id]: entry } }
        : previous);
    });
  }, [queue]);

  useEffect(() => {
    if (!enabled || latest.current.genes.length === 0) return;
    const current: Run = { key, cancelled: false };
    run.current = current;
    setState({ key, entries: {} });
    const genes = [...latest.current.genes];
    for (const source of latest.current.sources) request(current, source, genes);
    return () => { current.cancelled = true; };
  }, [key, enabled, request]);

  const retry = useCallback((sourceId: string) => {
    const current = run.current;
    const source = latest.current.sources.find((candidate) => candidate.id === sourceId);
    if (!current || current.cancelled || !source) return;
    setState((previous) => {
      if (previous.key !== current.key) return previous;
      const { [sourceId]: _retried, ...entries } = previous.entries;
      return { key: previous.key, entries };
    });
    request(current, source, [...latest.current.genes]);
  }, [request]);

  return useMemo(() => {
    const entries = state.key === key ? state.entries : {};
    const loading = genes.length > 0 && sources.some((source) => !entries[source.id]);
    if (loading) return { loading, results: [], errors: {}, retry };
    return {
      loading,
      results: sources.flatMap((source) => entries[source.id]?.results ?? []),
      errors: Object.fromEntries(
        sources.flatMap((source) => {
          const error = entries[source.id]?.error;
          return error ? [[source.id, error]] : [];
        }),
      ),
      retry,
    };
  }, [state, key, genes, sources, retry]);
}
