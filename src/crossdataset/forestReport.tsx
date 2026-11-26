// Shared primitives for the cross-dataset report pages (GeneReport's log2FC
// forest and PathwayReport's NES forest): the
// direction encoding, the contrast label, the category
// grouping, the filter chip, the report-query lifecycle, and the shared
// six-column grid. Which studies a report covers is study selection's
// (studySelection.ts), not this file's.
//
// Deliberately NOT one all-owning <ForestReport>: GeneReport carries policy
// (95% CI whiskers, collapsible dataset disclosures, provenance links) that
// PathwayReport doesn't have, and a schema wide enough to express all of it
// would expose GeneReport's implementation as an interface. Each report keeps its own ForestRow; what lives here is what
// they genuinely share.
import { useEffect, useState } from 'react';
import { ProgressBar } from '../common/ProgressBar';
import { Spinner } from '../common/Spinner';
import { useBundleBytes } from '../data/useBundleProgress';
import { DIRECTION_UP_COLOR, DIRECTION_DOWN_COLOR, FONT_MONO } from '../styles/constants';
import { fmtBytes } from '../utils/format';
import type { Direction } from '../types';

// One grid template for every row of a forest (axis header, track rows) so the
// dots, the axis ticks and the numeric columns stay registered.
export const FOREST_GRID = '200px 1fr 60px 72px 60px 92px';

/** Position (0–100%) of an effect on the shared, zero-centered axis, clamped. */
export function axisPct(value: number, bound: number): number {
  return Math.max(0, Math.min(100, 50 + (value / bound) * 50));
}

// The forest dot's fill and border: a plot MARK, so it keeps the chart palette.
// Direction TEXT goes through statistics/direction.ts, whose tokens are held
// to 4.5:1; these fills are not.
export function directionFill(dir: Direction, significant: boolean): string {
  if (!significant) return 'var(--text-muted)';
  return dir === 'up' ? DIRECTION_UP_COLOR : dir === 'down' ? DIRECTION_DOWN_COLOR : 'var(--text-muted)';
}

// A pill that toggles whether one category is shown in a cross-dataset view.
// `count` is optional because the Gene Explorer's physiological-signal presets
// wear the same pill without one — a preset is a saved query, not a bucket, so
// there is no honest number to put after its name.
export function FilterChip({ label, count, active, onClick, title }: { label: string; count?: number; active: boolean; onClick: () => void; title?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999,
      fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
      border: `1px solid ${active ? 'var(--accent)' : 'var(--border-dark)'}`,
      background: active ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--bg-panel)',
      color: active ? 'var(--accent)' : 'var(--text-muted)',
    }}>
      {label}
      {count != null && <span style={{ fontFamily: FONT_MONO, fontSize: 10, opacity: 0.8 }}>{count}</span>}
    </button>
  );
}

// Group report rows into categories, in the canonical category order regardless
// of input order; categories with no groups are dropped.
export function groupForestCategories<TGroup, TCategory extends string>(
  groups: readonly TGroup[],
  spec: { order: readonly TCategory[]; categoryOf: (group: TGroup) => TCategory },
): Array<{ category: TCategory; groups: TGroup[] }> {
  const byCat = new Map<TCategory, TGroup[]>();
  for (const g of groups) {
    const c = spec.categoryOf(g);
    const arr = byCat.get(c);
    if (arr) arr.push(g); else byCat.set(c, [g]);
  }
  return spec.order
    .filter((c) => byCat.has(c))
    .map((c) => ({ category: c, groups: byCat.get(c) as TGroup[] }));
}

export interface ReportQueryState<TResult> {
  result: TResult | null;
  loading: boolean;
  progress: { loaded: number; total: number };
  /**
   * Bytes downloaded since this query started.
   *
   * The unit the FILE count cannot express: a query that resolves from the
   * index moves 2 files and a few hundred KB, while the full-download fallback
   * moves a hundred bundles and a few hundred MB, and "3 / 100 tracks" reads
   * identically in both. Reset per query — see useBundleBytes.
   */
  bytes: number;
  error: string | null;
}

// The report-query lifecycle both reports share: reset when the request
// changes, track per-track progress, and suppress every state update after
// cleanup so a superseded query can't clobber the current one. The request is a
// typed value whose IDENTITY is the query (study selection keeps it stable while
// the term and selected studies are unchanged); null is idle.
export function useReportQuery<TRequest, TResult>(
  request: TRequest | null,
  load: (request: TRequest, options: { onProgress: (loaded: number, total: number) => void }) => Promise<TResult>,
  errorMessage: string,
): ReportQueryState<TResult> {
  const [result, setResult] = useState<TResult | null>(null);
  // A null request is IDLE, not loading. A report still waiting on its study
  // selection (sample counts not yet loaded) mounts with one, and starting at
  // `true` would show a spinner for a query that has not been issued.
  const [loading, setLoading] = useState(request !== null);
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const bytes = useBundleBytes(loading);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `load` and `errorMessage` are stable per call site; the query re-runs on `request` alone.
  useEffect(() => {
    // Clearing the request has to clear the RESULT too. Bailing out early while
    // leaving the previous query's result in place would render the old gene's
    // forest under an empty heading — invisible while every report was remounted
    // per query, and a real bug the moment one can be cleared in place.
    if (request === null) {
      setResult(null); setError(null); setProgress({ loaded: 0, total: 0 }); setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true); setError(null); setResult(null); setProgress({ loaded: 0, total: 0 });
    load(request, {
      onProgress: (loaded, total) => { if (!cancelled) setProgress({ loaded, total }); },
    })
      .then((r) => { if (!cancelled) { setResult(r); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError(errorMessage); setLoading(false); } });
    return () => { cancelled = true; };
  }, [request]);

  return { result, loading, progress, bytes, error };
}

/**
 * The wait a cross-dataset report shows while it queries. One component for all
 * three reports, which previously spelled the same spinner + "N / M" line three
 * times — and would now have to spell the bar and the byte readout three times
 * too.
 *
 * The bar is determinate on FILES, not bytes: the total byte size of a query is
 * unknowable up front (the index path fetches one shard; the fallback fetches
 * every track bundle of every dataset), whereas the file count is planned before
 * the first request. Bytes ride alongside as the magnitude the file count hides.
 */
export function ReportLoading(
  { label, progress, bytes, unit, hint }: {
    label: string;
    progress: { loaded: number; total: number };
    bytes: number;
    /** What the counted items are — 'tracks' or 'datasets'. */
    unit: string;
    hint?: string;
  },
) {
  const { loaded, total } = progress;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '64px 0', color: 'var(--text-muted)' }}>
      <Spinner size={22} label={label} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: 260 }}>
        <ProgressBar label={label} value={total > 0 ? loaded / total : null} />
        <div style={{ fontFamily: FONT_MONO, fontSize: 12 }}>
          {total > 0 ? `${loaded} / ${total} ${unit}` : `Planning ${unit}…`}
          {bytes > 0 && ` · ${fmtBytes(bytes)}`}
        </div>
      </div>
      {hint && <div style={{ fontSize: 11, maxWidth: 420, textAlign: 'center' }}>{hint}</div>}
    </div>
  );
}
