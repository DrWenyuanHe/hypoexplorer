// Shared primitives for the cross-dataset report pages (GeneReport's log2FC
// forest, PathwayReport's NES forest, and CrossDatasetCompare's bar grid): the
// direction encoding, the significance pill, the contrast label, the category
// grouping, the category-scope state machine + its filter chip, the
// report-query lifecycle, and the shared six-column grid.
//
// Deliberately NOT one all-owning <ForestReport>: GeneReport carries policy
// (95% CI whiskers, collapsible dataset disclosures, provenance links) that
// PathwayReport doesn't have, and a schema wide enough to express all of it
// would expose GeneReport's implementation as an interface. Each report keeps its own ForestRow; what lives here is what
// they genuinely share.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ProgressBar } from '../common/ProgressBar';
import { Spinner } from '../common/Spinner';
import { useBundleBytes } from '../data/useBundleProgress';
import { DIRECTION_UP_COLOR, DIRECTION_DOWN_COLOR, FONT_MONO, FONT_SANS } from '../styles/constants';
import { fmtBytes } from '../utils/format';
import type { Direction, ResolvedContrast } from '../types';

// One grid template for every row of a forest (axis header, track rows) so the
// dots, the axis ticks and the numeric columns stay registered.
export const FOREST_GRID = '200px 1fr 60px 72px 60px 64px';

/** Position (0–100%) of an effect on the shared, zero-centered axis, clamped. */
export function axisPct(value: number, bound: number): number {
  return Math.max(0, Math.min(100, 50 + (value / bound) * 50));
}

// Direction is encoded by sign + arrow + text, never color alone (DESIGN.md).
export function dirGlyph(dir: Direction): string {
  return dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–';
}

export function directionColor(dir: Direction, significant: boolean): string {
  if (!significant) return 'var(--text-muted)';
  return dir === 'up' ? DIRECTION_UP_COLOR : dir === 'down' ? DIRECTION_DOWN_COLOR : 'var(--text-muted)';
}

// The dataset group header's contrast label. Reads the RESOLVED label rather
// than recomputing "<case> vs <baseline>" — resolveContrast already applied the
// authored-label-wins rule, and recomputing here silently discarded it.
export function contrastLabel(contrast: ResolvedContrast | null | undefined): string {
  return contrast?.label ?? '';
}

export function SigPill({ direction, significant }: { direction: Direction; significant: boolean }) {
  const label = !significant ? 'n.s.' : direction === 'up' ? 'up' : direction === 'down' ? 'down' : 'flat';
  const color = directionColor(direction, significant);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
      fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
      color, background: significant ? `color-mix(in srgb, ${color} 12%, transparent)` : 'rgba(148,163,184,0.16)',
      borderRadius: 999, padding: '2px 8px', fontFamily: FONT_SANS,
    }}>
      <span aria-hidden="true">{dirGlyph(direction)}</span>{label}
    </span>
  );
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

export interface CategoryScope<TCategory> {
  /** Which categories show. null = all. */
  activeCats: Set<TCategory> | null;
  setActiveCats: Dispatch<SetStateAction<Set<TCategory> | null>>;
  toggleCat: (category: TCategory) => void;
}

// The category-filter state machine both cross-dataset views share: seeded from
// the incoming scope (e.g. a hub physiology tile), re-seeded whenever that scope
// changes, and toggled under the "empty set collapses to null = all" rule — so
// unticking the last chip widens back to every dataset instead of emptying the
// view.
export function useCategoryScope<TCategory>(scope?: readonly TCategory[] | null, onChange?: (scope: TCategory[] | null) => void): CategoryScope<TCategory> {
  const scopeKey = (scope ?? []).join(',');
  const [activeCats, setActiveCats] = useState<Set<TCategory> | null>(
    scope?.length ? new Set(scope) : null,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only when the scope identity changes
  useEffect(() => { setActiveCats(scope?.length ? new Set(scope) : null); }, [scopeKey]);

  const toggleCat = useCallback((category: TCategory) => {
    setActiveCats((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(category)) next.delete(category); else next.add(category);
      return next.size === 0 ? null : next;
    });
  }, []);

  // Route-owned scopes use the supplied value directly, so Back/Forward and a
  // filter click cannot race an effect that copies one state into another.
  const controlledCats = useMemo(() => scope?.length ? new Set(scope) : null, [scope]);
  const setControlled: CategoryScope<TCategory>['setActiveCats'] = useCallback((action) => {
    const next = typeof action === 'function' ? action(controlledCats) : action;
    onChange?.(next ? [...next] : null);
  }, [controlledCats, onChange]);
  const toggleControlled = useCallback((category: TCategory) => {
    setControlled((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(category)) next.delete(category); else next.add(category);
      return next.size ? next : null;
    });
  }, [setControlled]);
  return onChange
    ? { activeCats: controlledCats, setActiveCats: setControlled, toggleCat: toggleControlled }
    : { activeCats, setActiveCats, toggleCat };
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

// The report-query lifecycle both reports share: reset on key change, track
// per-track progress, and suppress every state update after cleanup so a
// superseded query can't clobber the current one.
export function useReportQuery<TResult>(
  key: string,
  load: (key: string, options: { onProgress: (loaded: number, total: number) => void }) => Promise<TResult>,
  errorMessage: string,
): ReportQueryState<TResult> {
  const [result, setResult] = useState<TResult | null>(null);
  // An empty key is IDLE, not loading. The reports' landing states (the Gene and
  // Pathway Explorers entered with nothing searched yet) mount with one, and
  // starting at `true` would show them a spinner for a query that never runs.
  const [loading, setLoading] = useState(Boolean(key));
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const bytes = useBundleBytes(loading);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `load` and `errorMessage` are stable per call site; the query re-runs on `key` alone.
  useEffect(() => {
    // Clearing the key has to clear the RESULT too. Bailing out early while
    // leaving the previous query's result in place would render the old gene's
    // forest under an empty heading — invisible while every report was remounted
    // per query, and a real bug the moment one can be cleared in place.
    if (!key) {
      setResult(null); setError(null); setProgress({ loaded: 0, total: 0 }); setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true); setError(null); setResult(null); setProgress({ loaded: 0, total: 0 });
    load(key, {
      onProgress: (loaded, total) => { if (!cancelled) setProgress({ loaded, total }); },
    })
      .then((r) => { if (!cancelled) { setResult(r); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError(errorMessage); setLoading(false); } });
    return () => { cancelled = true; };
  }, [key]);

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
