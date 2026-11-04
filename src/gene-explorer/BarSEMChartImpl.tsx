// The recharts-backed implementation of BarSEMChart.
//
// Split out from BarSEMChart.tsx so that recharts (plus its d3 dependencies —
// 319 KB raw / 80 KB gzipped, the single largest chunk in the app) can be loaded
// on demand. This file is reached ONLY through the lazy wrapper in
// BarSEMChart.tsx; import it directly and you put recharts back on the landing
// page's critical path, which is exactly what the split exists to prevent.
//
import { useMemo, useState, type JSX } from 'react';
import {
  ComposedChart, Bar, XAxis, YAxis, ErrorBar,
  ResponsiveContainer, Cell, useXAxisTicks, useYAxisScale, type XAxisTickContentProps,
} from 'recharts';
import { mean, std } from '../utils/math';
import { pToStar, fmtP } from '../utils/format';
import { getGroupedValues, getValuesForGroups } from '../utils/sampleValues';
import { formatAxisTick, resolveChartScale } from '../utils/chartScale';
import { wrapLabel } from '../utils/axes';
import { useChartScale } from '../common/chartScaleStore';
import { FONT_MONO, FONT_SANS } from '../styles/constants';
import type { Group, PopData, ResolvedContrast } from '../types';

// Near-black "ink" for axes, bar edges, error bars and significance brackets.
// Bar + dot colours now come from the contrast's group definitions, not hardcoded
// Normal/Obese constants — the dot colour is a darkened shade of the group's bar
// colour so the raw-data dots stay readable on top of the bar.
const NATURE = { ink: '#1A1A1A' };

// Darken a hex colour (#rgb / #rrggbb) toward black for the raw-data dot overlay.
// Non-hex colours (e.g. hsl()) are returned unchanged so the dot still renders.
function darken(color: string, factor = 0.72): string {
  if (typeof color !== 'string' || color[0] !== '#') return color;
  let hex = color.slice(1);
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length !== 6) return color;
  const r = Math.round(parseInt(hex.slice(0, 2), 16) * factor);
  const g = Math.round(parseInt(hex.slice(2, 4), 16) * factor);
  const b = Math.round(parseInt(hex.slice(4, 6), 16) * factor);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

interface GroupDots {
  vals: number[];
  color: string;
}

/**
 * One significance bracket, already resolved to BAR POSITIONS.
 *
 * `from`/`to` are indices into the drawn bars rather than group keys, because
 * the overlay only ever sees bars — the key→index resolution belongs to the
 * component that decided the bar order, and doing it there keeps this pure
 * geometry. `level` stacks brackets that overlap horizontally (see `stack`).
 */
interface Bracket {
  from: number;
  to: number;
  star: string;
  title?: string;
  level: number;
}

/** Vertical pitch between stacked bracket levels, in px. */
const BRACKET_PITCH = 15;

/**
 * Assign each bracket a vertical level so that no two brackets sharing a level
 * overlap horizontally. Short spans are placed first, so adjacent-pair brackets
 * sit closest to the bars and wider ones arch over them — the convention a
 * reader of a factorial figure already expects.
 *
 * Two brackets touching only at an endpoint (a shared bar) do NOT overlap: their
 * ticks land on the same x, which reads fine and keeps the stack shallow.
 */
function stack(specs: Array<Omit<Bracket, 'level'>>): Bracket[] {
  const byLevel: Array<Array<[number, number]>> = [];
  return [...specs]
    .map((s, i) => ({ s, i, lo: Math.min(s.from, s.to), hi: Math.max(s.from, s.to) }))
    // Stable within a span width: declaration order decides, so the same dataset
    // always draws the same picture.
    .sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo) || a.i - b.i)
    .map(({ s, lo, hi }) => {
      let level = 0;
      while (byLevel[level]?.some(([l, h]) => lo < h && l < hi)) level++;
      byLevel[level] ??= [];
      byLevel[level].push([lo, hi]);
      return { ...s, level };
    });
}

interface DotOverlayProps {
  /** Bar means, in bar order. */
  means: number[];
  /** Pixel width of every bar (the Bar's barSize). */
  barSize: number;
  groupDots: GroupDots[];
  brackets: Bracket[];
}

// ─── Bar chart dot overlay ────────────────────────────────────────────────────
// groupDots is [{ vals:number[], color }, ...] aligned to the bars, one entry per
// bar — two for a contrast chart, one per design cell for a multi-condition one.
//
// Rendered as a chart child so it can read the chart's own axes: each bar is
// centred on its x tick (interval={0} gives every bar one, and ticks are indexed,
// so duplicate group labels still resolve) and is barSize wide; heights come from
// the y scale. The bars rise from 0, which the y domain always contains.
function DotOverlay({ means, barSize, groupDots, brackets }: DotOverlayProps) {
  const ticks = useXAxisTicks();
  const yScale = useYAxisScale();
  if (!ticks?.length || !yScale) return null;
  const toY = (val: number) => yScale(val) ?? Number.NaN;

  const zeroY = toY(0);
  const bars = means.flatMap((value, i) => {
    const center = ticks.find((tick) => tick.index === i)?.coordinate;
    if (center === undefined) return [];
    const top = toY(value);
    return [{ x: center - barSize / 2, width: barSize, y: Math.min(top, zeroY), height: Math.abs(top - zeroY) }];
  });
  if (bars.length !== means.length) return null;

  const offsetsFor = (n: number): number[] => {
    if (n <= 1) return [0];
    if (n === 2) return [-0.2, 0.2];
    if (n === 3) return [-0.27, 0, 0.27];
    // Even spacing for 4+ (unlikely but safe).
    const step = 0.54 / (n - 1);
    return Array.from({ length: n }, (_, i) => -0.27 + i * step);
  };
  const elems: JSX.Element[] = [];

  bars.forEach((bar, gi) => {
    const group = groupDots[gi];
    const vals = group?.vals ?? [];
    const color = group?.color;
    const offs = offsetsFor(vals.length);
    vals.forEach((v, i) => {
      if (v == null) return;
      elems.push(
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: scatter dot position within a fixed-order group is the identity
          key={`${color}-${gi}-${i}`}
          cx={bar.x + bar.width * (0.5 + offs[i])}
          cy={toY(v)}
          r={3.5}
          fill={color}
          stroke="white"
          strokeWidth={0.8}
          opacity={0.9}
        />,
      );
    });
  });

  // Significance brackets. Each one clears the tallest bar it spans, then rises
  // by its level so stacked brackets do not collide.
  for (const b of brackets) {
    const fromBar = bars[b.from];
    const toBar = bars[b.to];
    if (!fromBar || !toBar) continue;
    const lo = Math.min(b.from, b.to);
    const hi = Math.max(b.from, b.to);
    const clearance = Math.min(...bars.slice(lo, hi + 1).map((bar) => Math.min(bar.y, bar.y + bar.height)));
    const lineY = clearance - 6 - b.level * BRACKET_PITCH;
    const midNx = fromBar.x + fromBar.width / 2;
    const midOx = toBar.x + toBar.width / 2;
    elems.push(
      <g key={`bracket-${b.from}-${b.to}`}>
        {b.title && <title>{b.title}</title>}
        <line x1={midNx} y1={lineY + 8} x2={midNx} y2={lineY} stroke={NATURE.ink} strokeWidth={0.8} />
        <line x1={midNx} y1={lineY} x2={midOx} y2={lineY} stroke={NATURE.ink} strokeWidth={0.8} />
        <line x1={midOx} y1={lineY} x2={midOx} y2={lineY + 8} stroke={NATURE.ink} strokeWidth={0.8} />
        <text x={(midNx + midOx) / 2} y={lineY - 3} textAnchor="middle"
          fontFamily={FONT_SANS}
          fontSize={b.star === 'ns' ? 11 : 15} fill={NATURE.ink} fontStyle={b.star === 'ns' ? 'italic' : 'normal'}>
          {b.star}
        </text>
      </g>,
    );
  }

  return <g>{elems}</g>;
}

// ─── X-axis labels ────────────────────────────────────────────────────────────
// Long study group labels (see wrapLabel) would collide on one line, so
// every tick wraps to its bar's slot and the axis grows by the lines it needs —
// the plot keeps its height rather than being squeezed by the labels.

/** Chart margins and y-axis width, shared by the layout and the slot estimate. */
const MARGIN = { right: 16, left: 36, bottom: 16 };
const Y_AXIS_WIDTH = 38;
/** Assumed chart width before the container reports its size (a grid cell). */
const FALLBACK_CHART_WIDTH = 300;

interface TickLayout {
  /** Label text per bar, before wrapping. */
  texts: string[];
  /** Per-bar n, drawn on its own smaller line in the multi-condition chart. */
  counts: number[] | null;
  fontSize: number;
}

const lineHeight = (fontSize: number) => Math.round(fontSize * 1.2);

// Each bar owns an equal share of the plot width; a label wraps to it, less a
// little air so neighbouring labels never touch.
const slotWidth = (plotWidth: number, bars: number) => Math.max(40, plotWidth / Math.max(1, bars) - 8);

/** Height the x-axis needs for the tallest tick, wrapped to `plotWidth`. */
function axisHeight({ texts, counts, fontSize }: TickLayout, plotWidth: number): number {
  const slot = slotWidth(plotWidth, texts.length);
  const labelLines = Math.max(1, ...texts.map((t) => wrapLabel(t, slot, fontSize).length));
  return 4 + labelLines * lineHeight(fontSize) + (counts ? lineHeight(fontSize - 1) : 0) + 4;
}

interface WrappedTickProps {
  // Injected by recharts: `width` is the plot width and `index` the tick's
  // position along the axis. Recharts types the geometry as number | string.
  x?: number | string;
  y?: number | string;
  width?: number | string;
  index?: number;
  payload?: { value?: unknown };
  layout: TickLayout;
}

// The two-arm chart wraps "<label> (n=<n>)" as one string, so a short label is
// the same single line it always was. The multi-condition chart puts n on its
// own line: four labelled conditions on a single line collide at any readable
// font size, and shrinking the label to fit is the worse trade — the group name
// is the thing a reader needs to identify the bar.
function WrappedTick({ x: rawX = 0, y: rawY = 0, width: rawWidth = 0, index = 0, payload, layout }: WrappedTickProps) {
  const x = Number(rawX), y = Number(rawY), width = Number(rawWidth);
  const { fontSize, counts, texts } = layout;
  const lines = wrapLabel(texts[index] ?? String(payload?.value ?? ''), slotWidth(width, texts.length), fontSize);
  const truncated = lines[lines.length - 1]?.endsWith('…');
  return (
    <g>
      {truncated && <title>{String(payload?.value ?? '')}</title>}
      <text x={x} y={y} textAnchor="middle" fill={NATURE.ink} fontFamily={FONT_SANS}>
        {lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a wrapped line's position is its identity
          <tspan key={i} x={x} dy={lineHeight(fontSize)} fontSize={fontSize}>{line}</tspan>
        ))}
        {counts && <tspan x={x} dy={lineHeight(fontSize - 1)} fontSize={fontSize - 1} opacity={0.75}>{`n=${counts[index] ?? 0}`}</tspan>}
      </text>
    </g>
  );
}

// Honour the user's reduced-motion preference for the bar grow-in. Guarded so
// environments without matchMedia (jsdom) fall back to no animation.
const prefersReducedMotion =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : true;

/**
 * One bracket the CALLER asks for, named by group key.
 *
 * Callers know contrasts, not bar positions, so this is the shape they speak;
 * the component resolves the keys against the bar order it drew and silently
 * drops a comparison naming a group that is not on screen.
 */
export interface ChartComparison {
  from: string;
  to: string;
  star: string;
  /** SVG <title> on the bracket — the contrast's label and its stats. */
  title?: string;
}

export interface BarSEMChartProps {
  gene: string;
  onRemove?: (() => void) | null;
  popData: PopData;
  popLabel?: string;
  onShowPathways?: ((gene: string) => void) | null;
  contrast?: ResolvedContrast | null;
  /**
   * Draw THESE groups, in this order, instead of the contrast's two arms — the
   * multi-condition view's axis (e.g. GSE135639's four diet × age cells).
   * Omitted, the chart is exactly the two-arm contrast chart it has always been.
   */
  groups?: Array<Group | null | undefined> | null;
  /**
   * Significance brackets to draw. Omitted, the chart draws its historical
   * single bracket across the two arms from the active contrast's p-value. Pass
   * one entry per comparison worth annotating (a factorial design has several,
   * each from its OWN contrast's DE table — the active contrast's p-value says
   * nothing about the other three).
   */
  comparisons?: ChartComparison[] | null;
}

// Default export: React.lazy in the wrapper requires one.
export default function BarSEMChartImpl({
  gene, onRemove, popData, popLabel, onShowPathways, contrast, groups, comparisons,
}: BarSEMChartProps) {
  // Single per-sample value seam. Two arms from the active contrast by default;
  // an explicit `groups` list swaps the axis without touching the read rule —
  // each entry carries that group's REAL sample values (nulls already dropped) + n.
  const activeContrast = contrast ?? popData.contrast;
  const multiCondition = (groups?.length ?? 0) > 0;
  const series = multiCondition
    ? getValuesForGroups(popData, gene, groups)
    : getGroupedValues(popData, gene, activeContrast);
  const shown = series.length
    ? series
    : [{ key: '', label: '', color: NATURE.ink, values: [], n: 0 },
       { key: '', label: '', color: NATURE.ink, values: [], n: 0 }];

  // The y-axis scale is one GLOBAL pick (chartScaleStore) resolved against THIS
  // dataset's deposited unit, so the same pick reads four ways across a grid of
  // mixed units and a chart that cannot honour it falls back and says so.
  //
  // The transform is applied here, once, because everything below reads the
  // PLOTTED values — bar means, error bars, dots, the y domain. Aggregating
  // after it is the point: a log2 axis whose bar is the log of the arithmetic
  // mean is a linear chart with relabelled ticks.
  const scale = useChartScale();
  const scaleView = resolveChartScale(popData.expressionUnit, scale);
  const drawn = shown.map((g) => ({ ...g, values: g.values.map(scaleView.transform) }));

  const stats = drawn.map((g) => {
    const m = mean(g.values);
    return { m, sem: g.values.length > 1 ? std(g.values) / Math.sqrt(g.values.length) : 0 };
  });
  const pval = popData.deByGene[gene]?.PValue ?? 1;
  const allVals = drawn.flatMap((g) => g.values);
  // Centered log-expression values can be negative. Include zero, every sample
  // and both SEM bounds; retain the historical upper padding for positive data.
  const yMin = Math.min(0, ...stats.map((s) => s.m - s.sem), ...allVals) * 1.35;
  const yMax = Math.max(0, ...stats.map((s) => s.m + s.sem), ...allVals) * 1.35 || (yMin < 0 ? 0 : 1);

  const canDrillDown = !!onShowPathways;
  const pathwayCount = useMemo(() => {
    if (!canDrillDown || !popData?.allPathways) return 0;
    let n = 0;
    for (const p of popData.allPathways) if (p.leadingEdge?.includes(gene)) n++;
    return n;
  }, [gene, popData.allPathways, canDrillDown]);

  const chartData = drawn.map((g, i) => ({
    name: g.label, n: g.n, mean: +stats[i].m.toFixed(3), sem: +stats[i].sem.toFixed(3),
  }));
  const colors = drawn.map((g) => g.color);
  const barSize = drawn.length > 2 ? 30 : 40;
  const groupDots: GroupDots[] = drawn.map((g) => ({ vals: g.values, color: darken(g.color) }));

  // Bracket specs → bar indices. The default (no `comparisons`) is the historical
  // single bracket over the two arms, so every existing call site is untouched.
  const indexOfKey = new Map(drawn.map((g, i) => [g.key, i]));
  const brackets = stack(
    comparisons?.length
      ? comparisons.flatMap((c) => {
        const from = indexOfKey.get(c.from);
        const to = indexOfKey.get(c.to);
        return from == null || to == null ? [] : [{ from, to, star: c.star, title: c.title }];
      })
      : drawn.length > 1 ? [{ from: 0, to: 1, star: pToStar(pval) }] : [],
  );
  const maxLevel = brackets.reduce((m, b) => Math.max(m, b.level), 0);

  // Four labelled conditions do not fit on one line in a 260 px grid cell, so a
  // multi-condition chart splits the tick into label + n and gets a wider tile
  // (the grid's minmax is widened alongside this in the charts pop-up).
  const tickFontSize = drawn.length > 2 ? 10 : 12;
  const tickLayout: TickLayout = {
    texts: drawn.map((g) => (multiCondition ? g.label : `${g.label} (n=${g.n})`)),
    counts: multiCondition ? drawn.map((g) => g.n) : null,
    fontSize: tickFontSize,
  };
  // The ticks wrap against the plot width recharts hands them; the axis height
  // has to be fixed before that render, so it wraps against the container's
  // last reported width instead (the two agree once the container has measured).
  const [chartWidth, setChartWidth] = useState(FALLBACK_CHART_WIDTH);
  const plotWidth = chartWidth - MARGIN.left - MARGIN.right - Y_AXIS_WIDTH;
  const xAxisHeight = axisHeight(tickLayout, plotWidth);
  // The axis's extra height is added to the chart rather than taken from the
  // plot, so wrapped labels never shorten the bars. 200 px matches the lazy
  // wrapper's skeleton for the common single-line case.
  const singleLineAxis = axisHeight({ ...tickLayout, texts: drawn.map(() => '') }, plotWidth);
  const chartHeight = (drawn.length > 2 ? 226 : 200) + xAxisHeight - singleLineAxis;

  return (
    <div style={{ position: 'relative', background: 'var(--bg-panel)', border: '1px solid var(--border)', padding: '8px 8px 4px' }}>
      {onRemove && (
        <button type="button"
          onClick={onRemove}
          aria-label={`Remove ${gene}`}
          style={{
            position: 'absolute', top: 4, right: 4,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 14, lineHeight: 1,
            padding: '2px 4px', borderRadius: 2,
          }}
        >×</button>
      )}
      <div style={{ fontSize: 12, fontWeight: 600, fontFamily: FONT_MONO, color: 'var(--text-primary)' }}>{gene}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
        {popLabel || popData.meta?.label} ·{' '}
        <span title={scaleView.provenance} style={{ cursor: 'help', borderBottom: '1px dotted currentColor' }}>
          {scaleView.unitLabel}{scaleView.unavailable ? '†' : ''}
        </span>{' '}
        (mean ± SEM){multiCondition
          ? ` · ${drawn.length} conditions`
          : ` · P = ${fmtP(pval)}`}
      </div>
      <ResponsiveContainer width="100%" height={chartHeight}
        onResize={(width) => { if (width > 0) setChartWidth(width); }}>
        <ComposedChart data={chartData} margin={{ ...MARGIN, top: 28 + maxLevel * BRACKET_PITCH }}>
          <XAxis dataKey="name"
            tick={(props: XAxisTickContentProps) => <WrappedTick {...props} layout={tickLayout} />}
            height={xAxisHeight}
            axisLine={{ stroke: NATURE.ink, strokeWidth: 0.8 }}
            tickLine={{ stroke: NATURE.ink, strokeWidth: 0.8 }}
            tickMargin={0}
            interval={0}
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fontSize: 10, fontFamily: FONT_SANS, fill: NATURE.ink }}
            axisLine={{ stroke: NATURE.ink, strokeWidth: 0.8 }}
            tickLine={{ stroke: NATURE.ink, strokeWidth: 0.8 }}
            tickFormatter={formatAxisTick}
            width={Y_AXIS_WIDTH}
          />
          <Bar dataKey="mean" barSize={barSize}
            isAnimationActive={!prefersReducedMotion} animationDuration={450} animationEasing="ease-out"
            radius={0} stroke={NATURE.ink} strokeWidth={0.75}>
            {chartData.map((d, i) => <Cell key={d.name || i} fill={colors[i]} />)}
            <ErrorBar dataKey="sem" width={6} strokeWidth={1.4} stroke={NATURE.ink} direction="y" />
          </Bar>
          <DotOverlay means={chartData.map((d) => d.mean)} barSize={barSize} groupDots={groupDots} brackets={brackets} />
        </ComposedChart>
      </ResponsiveContainer>
      {canDrillDown && (
        <button type="button"
          onClick={() => onShowPathways?.(gene)}
          style={{
            width: '100%', marginTop: 4, fontSize: 11, padding: '3px 8px',
            border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer',
            background: 'var(--bg-panel)', color: 'var(--text-muted)',
            fontFamily: FONT_SANS,
          }}
        >
          ⊞ {pathwayCount} pathway{pathwayCount !== 1 ? 's' : ''} as leading gene
        </button>
      )}
    </div>
  );
}
