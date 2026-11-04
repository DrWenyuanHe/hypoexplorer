// Lazy wrapper around the recharts-backed chart.
//
// WHY: recharts and its d3 dependencies are 319 KB raw / 80 KB gzipped — the
// biggest single chunk in the app — and BarSEMChartImpl is their ONLY importer.
// Imported statically it landed in the eager module graph and was
// `modulepreload`ed on every visit, including on the landing hub, which renders
// a search box and a tool index and never draws a chart.
//
// Routed through React.lazy it becomes its own chunk, fetched the first time a
// chart actually mounts. The public API is unchanged: `<BarSEMChart {...} />`
// still works at all six call sites (gene explorer, compare tab, compare pathway
// view, leading-edge view, cross-dataset compare), so nothing else had to move.
//
// The Suspense boundary is PER CHART, deliberately. These render in grids of
// tens of charts; a single boundary wrapped around the grid would blank the
// whole thing until the chunk arrived, whereas per-chart boundaries let each
// tile hold its own space and swap in place. React.lazy memoises the import, so
// N charts still trigger exactly one network request.
//
// The skeleton reserves the same height the real chart occupies (200 px plot +
// ~46 px of header) so the grid does not reflow when the chunk lands.

import { lazy, Suspense } from 'react';
import type { BarSEMChartProps, ChartComparison } from './BarSEMChartImpl';
import { FONT_MONO } from '../styles/constants';

// Re-exported so callers name the bracket shape without reaching past the lazy
// boundary (a type-only import cannot drag recharts back into the eager bundle,
// but one import path for the component and its props is one fewer trap).
export type { ChartComparison };

const BarSEMChartImpl = lazy(() => import('./BarSEMChartImpl'));

/**
 * Warm the chart chunk without rendering one.
 *
 * Called when the explorer opens, so the download overlaps with the user
 * choosing a gene rather than starting when they have already chosen it. Safe to
 * call repeatedly — the underlying dynamic import is memoised by the module
 * system, so this is a no-op after the first call. Never called from the hub.
 */
export function preloadBarSEMChart(): Promise<unknown> {
  // Returns the promise so callers that need the chunk actually present — tests,
  // chiefly — can await it. App code fires and forgets.
  return import('./BarSEMChartImpl');
}

/** Placeholder holding the chart's footprint while its chunk loads. */
function ChartSkeleton({ gene }: { gene: string }) {
  return (
    <div
      // Mirrors the impl's outer frame so the swap is not a visible jump.
      style={{
        position: 'relative', background: 'var(--bg-panel)',
        border: '1px solid var(--border)', padding: '8px 8px 4px',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, fontFamily: FONT_MONO, color: 'var(--text-primary)' }}>
        {gene}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>loading chart…</div>
      <div className="skeleton" style={{ height: 200 }} />
    </div>
  );
}

export function BarSEMChart(props: BarSEMChartProps) {
  return (
    <Suspense fallback={<ChartSkeleton gene={props.gene} />}>
      <BarSEMChartImpl {...props} />
    </Suspense>
  );
}
