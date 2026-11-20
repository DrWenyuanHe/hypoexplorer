// biome-ignore-all lint/a11y/noStaticElementInteractions: the hoverable marks below are
// figure glyphs, not controls. Their only interaction is a hover read-out, and every value
// they surface is also in the sortable, keyboard-reachable results table beside them —
// making each of several hundred data points separately focusable would degrade keyboard
// navigation rather than improve it. The figure's own aria-label summarises the result.
// The rhythm figure: one gene's expression across the sampling cycle.
//
// Drawn as inline SVG rather than through recharts, for three reasons. The
// app's recharts chunk is deliberately confined to ONE module (see
// __tests__/lazyChunkBoundaries.test.ts) and importing it here would widen that
// boundary by 80 KB gzipped. A circadian trace also needs marks recharts has no
// vocabulary for — the light/dark bar under the axis, double-plotting the cycle,
// a fitted cosine drawn through the timepoint means rather than between them.
// And at this size hand-drawn SVG is simply less code than bending a chart
// library into the shape.
//
// Conventions follow the app's existing figure style (gene-explorer/
// BarSEMChartImpl): ink-coloured rules, hairline grid, replicate dots drawn over
// the summary mark with a panel-coloured halo, arm colours from the dataset
// manifest. Arms also differ by marker SHAPE, so the figure never depends on
// colour alone.
//
// The figure is only ever rendered in the page (nothing serialises it to a
// standalone SVG file), so its ink can stay a CSS variable and follow the theme.

import { type MouseEventHandler, type ReactElement, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FONT_MONO, FONT_SANS } from '../styles/constants';
import type { TimeSeriesBundle } from '../types';
import { hasEstimablePeak } from './peak';
import { fittedCurve, type RhythmResult } from './rhythmicity';
import { type ArmSummary, summarizeGene } from './timeSeriesSource';

const INK = 'var(--text-primary)';
const PAPER = 'var(--bg-panel)';

// Wide geometry. The viewBox scales to the container, so these are relative
// units as much as pixels; text scales with the figure.
const W_WIDE = 760;
const H_WIDE = 320;
const PAD_WIDE = { top: 26, right: 20, bottom: 56, left: 62 };

/**
 * Below this container width the wide viewBox would shrink 11px axis text to
 * about 6px. The figure then draws at the container's own pixel width, with a
 * taller plot and the legend stacked under the gene name.
 */
export const COMPACT_BELOW_PX = 480;

export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond';
const SHAPES: MarkerShape[] = ['circle', 'square', 'triangle', 'diamond'];
const SHAPE_PLURAL: Record<MarkerShape, string> = {
  circle: 'circles', square: 'squares', triangle: 'triangles', diamond: 'diamonds',
};

/** Marker shape for the arm at `index` in the bundle's arm list: circle, square, triangle, diamond, then repeat. */
export function markerShapeFor(index: number): MarkerShape {
  return SHAPES[((index % SHAPES.length) + SHAPES.length) % SHAPES.length];
}

interface MarkStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity?: number;
  onMouseEnter?: MouseEventHandler<SVGElement>;
  onMouseLeave?: MouseEventHandler<SVGElement>;
}

/**
 * One marker centred on (cx, cy). `r` is the circle's radius; the other shapes
 * are sized to the same area, so no arm's points look heavier than another's.
 */
function marker(shape: MarkerShape, cx: number, cy: number, r: number, style: MarkStyle, key?: string): ReactElement {
  if (shape === 'circle') {
    return <circle key={key} data-shape={shape} cx={cx} cy={cy} r={r} {...style} />;
  }
  let d: string;
  if (shape === 'square') {
    const h = r * 0.886; // half-side of a square with area πr²
    d = `M${cx - h},${cy - h}h${2 * h}v${2 * h}h${-2 * h}Z`;
  } else if (shape === 'triangle') {
    // Equilateral, area πr², centroid on (cx, cy).
    const half = r * 1.347;
    d = `M${cx},${cy - r * 1.555}L${cx + half},${cy + r * 0.778}L${cx - half},${cy + r * 0.778}Z`;
  } else {
    const h = r * 1.253; // half-diagonal of a diamond with area πr²
    d = `M${cx},${cy - h}L${cx + h},${cy}L${cx},${cy + h}L${cx - h},${cy}Z`;
  }
  return <path key={key} data-shape={shape} d={d} strokeLinejoin="round" {...style} />;
}

export interface RhythmTraceProps {
  bundle: TimeSeriesBundle;
  gene: string;
  /** Per-arm fit to overlay, keyed by arm key. Absent arms draw data only. */
  fits?: Record<string, RhythmResult | null>;
  /** Arms to draw; defaults to all of them. */
  visibleArms?: string[];
  /** Repeat the cycle twice on the x axis — the convention for reading phase. */
  doublePlot?: boolean;
  /** Wide-layout viewBox height. The compact layout sets its own. */
  height?: number;
}

/**
 * The hovered mark, by identity rather than by value: which gene in which
 * bundle, which arm, which timepoint and cycle repeat, and which replicate
 * (null for the mean). The read-out is derived from the current data on every
 * render, and a hover recorded for another gene or bundle is ignored, so a
 * selection changed from the keyboard never shows the previous gene's value.
 */
interface HoverMark {
  bundle: TimeSeriesBundle;
  gene: string;
  arm: string;
  time: number;
  off: number;
  replicate: number | null;
}

/** Ticks every 4 h, or every 6 h once the axis is long enough to crowd. Compact axes take half as many. */
function tickStep(span: number, compact: boolean): number {
  if (compact) return span <= 24 ? 6 : 12;
  if (span <= 24) return 4;
  if (span <= 48) return 6;
  return 12;
}

/** Decimals beyond which y labels switch to scientific notation. */
const MAX_FIXED_DIGITS = 6;

const allDistinct = (labels: readonly string[]) => labels.every((l, i) => i === 0 || l !== labels[i - 1]);

/**
 * Labels for evenly spaced y ticks. Fixed notation with as many decimals as the
 * step needs, more if adjacent labels would still print alike; scientific
 * notation once that takes more than six decimals (a 1 ± 0.00002 range reads
 * 0.99998, 1.00000, 1.00002, never 1.0000 three times).
 */
export function yTickLabels(ticks: readonly number[], step: number): string[] {
  let digits = 0;
  while (digits < MAX_FIXED_DIGITS && Math.abs(Math.round(step * 10 ** digits) - step * 10 ** digits) > 1e-6) {
    digits++;
  }
  for (let d = digits; d <= MAX_FIXED_DIGITS; d++) {
    const labels = ticks.map((v) => v.toFixed(d));
    if (allDistinct(labels)) return labels;
  }
  for (let p = 1; p <= 15; p++) {
    const labels = ticks.map((v) => v.toExponential(p));
    if (allDistinct(labels)) return labels;
  }
  return ticks.map((v) => v.toExponential(15));
}

/** Hard cap on y ticks: tick generation is a bounded loop whatever the domain. */
const MAX_Y_TICKS = 20;

/**
 * Relative width below which a y range counts as flat. Mean and SEM of
 * identical replicates carry float error (three 0.1s average to
 * 0.10000000000000002), so "flat" cannot mean exactly equal.
 */
const FLAT_RELATIVE = 1e-9;

/**
 * The y domain for data spanning [lo, hi]. An effectively flat range is
 * widened symmetrically about its value (±5 %, or ±1 around zero) so a constant
 * gene draws as a level line on readable ticks. Otherwise the range is
 * padded by 12 % each side. When the data are non-negative the floor stays at
 * zero — a negative CPM tick would be a claim the data cannot make.
 */
export function yDomain(lo: number, hi: number): { yMin: number; yMax: number } {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return { yMin: 0, yMax: 1 };
  const floor = lo >= 0 ? 0 : Number.NEGATIVE_INFINITY;
  if (hi - lo <= Math.max(Math.abs(lo), Math.abs(hi), 1) * FLAT_RELATIVE) {
    const v = (lo + hi) / 2;
    const half = v === 0 ? 1 : Math.abs(v) * 0.05;
    return { yMin: Math.max(floor, v - half), yMax: v + half };
  }
  const pad = (hi - lo) * 0.12;
  return { yMin: Math.max(floor, lo - pad), yMax: hi + pad };
}

/**
 * Evenly spaced y ticks over [yMin, yMax] on a 1/2/2.5/5 step aiming at five
 * slots. The loop runs on a small integer counter capped at MAX_Y_TICKS, and
 * each tick must exceed the last, so no domain (however narrow or far from
 * zero) can repeat a tick or loop without end.
 */
export function yTickValues(yMin: number, yMax: number): { ticks: number[]; step: number } {
  const range = yMax - yMin;
  if (!Number.isFinite(range) || range <= 0) {
    return Number.isFinite(yMin) ? { ticks: [yMin], step: 1 } : { ticks: [], step: 1 };
  }
  const raw = range / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  // Multiply rather than accumulate, so float error does not drift along the axis.
  const first = Math.ceil(yMin / step);
  // A range too small to divide (subnormal underflow) has no nice step: label its ends.
  if (!(step > 0) || !Number.isFinite(step) || !Number.isFinite(first)) return { ticks: [yMin, yMax], step: range };
  const ticks: number[] = [];
  for (let i = 0; i < MAX_Y_TICKS; i++) {
    const v = (first + i) * step;
    if (v > yMax) break;
    if (ticks.length && v <= ticks[ticks.length - 1]) break;
    ticks.push(v);
  }
  return { ticks, step };
}

/** Three significant figures, keeping every integer digit from 100 up. */
function fmtValue(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(3);
}

interface Geometry {
  compact: boolean;
  W: number;
  H: number;
  pad: { top: number; right: number; bottom: number; left: number };
  plotW: number;
  plotH: number;
}

function geometry(width: number | null, height: number, nArms: number): Geometry {
  const compact = width != null && width < COMPACT_BELOW_PX;
  if (!compact) {
    const pad = PAD_WIDE;
    return {
      compact, W: W_WIDE, H: height, pad,
      plotW: W_WIDE - pad.left - pad.right, plotH: height - pad.top - pad.bottom,
    };
  }
  // Drawn 1:1 with the container, so 11px text is 11px on screen. The legend
  // stacks one arm per line under the gene name, and the plot is taller than
  // wide-layout proportions so a narrow trace still separates the arms.
  const W = Math.max(280, Math.round(width));
  const pad = { top: 26 + 15 * Math.max(1, nArms), right: 12, bottom: 56, left: 52 };
  const plotW = W - pad.left - pad.right;
  const plotH = Math.round(plotW * 0.78);
  return { compact, W, H: pad.top + plotH + pad.bottom, pad, plotW, plotH };
}

export function RhythmTrace({
  bundle, gene, fits, visibleArms, doublePlot = false, height = H_WIDE,
}: RhythmTraceProps) {
  const [hoverMark, setHoverMark] = useState<HoverMark | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  // Measure the container: below COMPACT_BELOW_PX the figure switches layout.
  // A zero width (not yet laid out, or jsdom) keeps the wide layout.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = (w: number) => setWidth(w > 0 ? Math.round(w) : null);
    measure(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) measure(entry.contentRect.width);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const cycle = bundle.meta.cycleHours;
  const span = doublePlot ? cycle * 2 : cycle;
  const summaries: ArmSummary[] = useMemo(() => summarizeGene(bundle, gene), [bundle, gene]);
  // summarizeGene keeps the bundle's arm order, so the index here is the arm's
  // position in the manifest — the shape stays with the arm whichever are shown.
  const shown = summaries
    .map((s, index) => ({ ...s, shape: markerShapeFor(index) }))
    .filter((s) => !visibleArms || visibleArms.includes(s.arm.key));

  const g = geometry(width, height, shown.length);
  const { W, H, pad: PAD, plotW: PLOT_W, plotH: PLOT_H, compact } = g;

  // One y scale across every arm and every replicate, so the arms are
  // comparable by eye — the whole point of overlaying them.
  const { yMin, yMax } = useMemo(() => {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const arm of shown) {
      for (const tp of arm.timepoints) {
        for (const v of tp.points) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        lo = Math.min(lo, tp.mean - tp.sem);
        hi = Math.max(hi, tp.mean + tp.sem);
      }
      const fit = fits?.[arm.arm.key];
      // Only a fit that is drawn (one with an estimable peak) shapes the axis.
      if (fit && hasEstimablePeak(fit)) {
        lo = Math.min(lo, fit.mesor - fit.amplitude);
        hi = Math.max(hi, fit.mesor + fit.amplitude);
      }
    }
    return yDomain(lo, hi);
  }, [shown, fits]);

  const xOf = (t: number) => PAD.left + (t / span) * PLOT_W;
  const yOf = (v: number) => PAD.top + PLOT_H - ((v - yMin) / (yMax - yMin)) * PLOT_H;

  // Y ticks: five slots, rounded to something a reader can hold in their head.
  // Labels carry as many decimals as adjacent ticks need to differ (see
  // yTickLabels), so a narrow range never prints the same label twice.
  const { yTicks, yLabels } = useMemo(() => {
    const { ticks, step } = yTickValues(yMin, yMax);
    return { yTicks: ticks, yLabels: yTickLabels(ticks, step) };
  }, [yMin, yMax]);

  const step = tickStep(span, compact);
  const xTicks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= span; t += step) out.push(t);
    return out;
  }, [span, step]);

  const isEntrained = bundle.meta.timeUnit === 'ZT';
  const unit = bundle.meta.timeUnit === 'h' ? '' : bundle.meta.timeUnit;
  const timeText = (t: number | string) => (unit ? `${unit}${t}` : `${t} h`);

  // Replicate dots are spread horizontally inside their timepoint so three
  // overlapping values read as three, not one. The offset is in hours, scaled
  // off the sampling interval, so it never bleeds into the neighbouring point.
  const interval = bundle.meta.timepoints.length > 1
    ? bundle.meta.timepoints[1] - bundle.meta.timepoints[0]
    : 4;
  const jitter = (i: number, n: number) => (n <= 1 ? 0 : ((i / (n - 1)) - 0.5) * interval * 0.34);

  // The figure's accessible name: what a sighted reader takes from it — which
  // gene, which arms (and their marker shapes), where each arm's mean peaks and,
  // when a fit is overlaid, the fitted peak. Per-point values stay on hover.
  const timeAxis = bundle.meta.timeUnit === 'ZT' ? 'Zeitgeber time'
    : bundle.meta.timeUnit === 'CT' ? 'circadian time' : 'time';
  const armSummaries = shown.map((arm) => {
    const head = `${arm.arm.label} (${SHAPE_PLURAL[arm.shape]})`;
    if (!arm.timepoints.length) return `${head}: no measured values`;
    const top = arm.timepoints.reduce((a, b) => (b.mean > a.mean ? b : a));
    let text = `${head}: highest mean ${fmtValue(top.mean)} at ${timeText(top.time)}`;
    const fit = fits?.[arm.arm.key];
    if (fit && hasEstimablePeak(fit)) text += `, fitted peak ${timeText(fit.acrophase.toFixed(1))} (period ${fit.period} h)`;
    else if (fit) text += ', no estimable fitted peak';
    return text;
  });

  // The hovered mark's read-out, from the data now on screen. Null when the
  // hover belongs to another gene or bundle, or its mark is no longer drawn
  // (arm hidden, double-plot turned off).
  const hover = (() => {
    const h = hoverMark;
    if (!h || h.gene !== gene || h.bundle !== bundle) return null;
    if (h.off !== 0 && !(doublePlot && h.off === cycle)) return null;
    const arm = shown.find((a) => a.arm.key === h.arm);
    const tp = arm?.timepoints.find((t) => t.time === h.time);
    if (!arm || !tp) return null;
    const label = `${arm.arm.label} · ${timeText(tp.time)}`;
    if (h.replicate === null) {
      return {
        x: xOf(tp.time + h.off), y: yOf(tp.mean), label, color: arm.arm.color,
        detail: `mean ${fmtValue(tp.mean)} ± ${fmtValue(tp.sem)} SEM (n=${tp.n})`,
      };
    }
    const v = tp.points[h.replicate];
    if (v === undefined) return null;
    return {
      x: xOf(tp.time + h.off), y: yOf(v), label, color: arm.arm.color,
      detail: `${fmtValue(v)} ${bundle.meta.expressionUnit}`,
    };
  })();
  const hoverOn = (armKey: string, time: number, off: number, replicate: number | null) => () =>
    setHoverMark({ bundle, gene, arm: armKey, time, off, replicate });
  const hoverOff = () => setHoverMark(null);
  const ariaLabel = `${gene} expression (${bundle.meta.expressionUnit}) across ${timeAxis}`
    + `${doublePlot ? ', double-plotted' : ''}. ${armSummaries.join('. ')}.`;

  const textSize = 11;

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', minWidth: 0 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
        role="img"
        aria-label={ariaLabel}
        data-layout={compact ? 'compact' : 'wide'}
      >
        <title>{`${gene} expression across ${bundle.meta.timeUnit === 'ZT' ? 'the light–dark cycle' : 'circadian time'}`}</title>

        {/* Light/dark bar. For an entrained (ZT) series the dark phase is real
            clock time; for a free-running (CT) series it is SUBJECTIVE night,
            drawn hollow so the figure never implies lights the animals did not
            see. */}
        {Array.from({ length: doublePlot ? 2 : 1 }, (_, cycleIdx) => {
          const t0 = cycleIdx * cycle;
          const dayW = xOf(t0 + cycle / 2) - xOf(t0);
          return (
            <g key={`ld-${t0}`} transform={`translate(0, ${PAD.top + PLOT_H + 8})`}>
              <rect x={xOf(t0)} y={0} width={dayW} height={7} fill={PAPER} stroke={INK} strokeWidth={0.7} />
              <rect
                x={xOf(t0 + cycle / 2)} y={0} width={dayW} height={7}
                fill={isEntrained ? INK : 'none'} stroke={INK} strokeWidth={0.7}
              />
              {!isEntrained && (
                // Hatch marks the subjective night without claiming darkness.
                <line
                  x1={xOf(t0 + cycle / 2)} y1={7} x2={xOf(t0 + cycle)} y2={0}
                  stroke={INK} strokeWidth={0.5} opacity={0.5}
                />
              )}
            </g>
          );
        })}

        {/* Dark-phase wash behind the plot, faint enough to sit under the data. */}
        {Array.from({ length: doublePlot ? 2 : 1 }, (_, cycleIdx) => {
          const t0 = cycleIdx * cycle + cycle / 2;
          return (
            <rect
              key={`wash-${t0}`}
              x={xOf(t0)} y={PAD.top}
              width={xOf(t0 + cycle / 2) - xOf(t0)} height={PLOT_H}
              fill={INK} opacity={0.045}
            />
          );
        })}

        {/* Y grid + ticks */}
        {yTicks.map((v, i) => (
          <g key={`y-${v}`} data-y-tick>
            <line
              x1={PAD.left} y1={yOf(v)} x2={PAD.left + PLOT_W} y2={yOf(v)}
              stroke={INK} strokeWidth={0.4} opacity={0.14}
            />
            <text
              x={PAD.left - 8} y={yOf(v) + 3.5} textAnchor="end"
              fontSize={textSize} fontFamily={FONT_MONO} fill="var(--text-muted)"
            >
              {yLabels[i]}
            </text>
          </g>
        ))}

        {/* Axes */}
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + PLOT_H} stroke={INK} strokeWidth={0.9} />
        <line
          x1={PAD.left} y1={PAD.top + PLOT_H} x2={PAD.left + PLOT_W} y2={PAD.top + PLOT_H}
          stroke={INK} strokeWidth={0.9}
        />
        {xTicks.map((t) => (
          <g key={`x-${t}`}>
            <line
              x1={xOf(t)} y1={PAD.top + PLOT_H} x2={xOf(t)} y2={PAD.top + PLOT_H + 4}
              stroke={INK} strokeWidth={0.8}
            />
            <text
              x={xOf(t)} y={PAD.top + PLOT_H + 28} textAnchor="middle"
              fontSize={textSize} fontFamily={FONT_MONO} fill="var(--text-muted)"
            >
              {unit}{doublePlot ? t % cycle : t}
            </text>
          </g>
        ))}

        {/* Axis titles */}
        <text
          transform={`translate(${compact ? 12 : 14}, ${PAD.top + PLOT_H / 2}) rotate(-90)`}
          textAnchor="middle" fontSize={textSize} fontFamily={FONT_SANS} fill="var(--text-primary)"
        >
          {bundle.meta.expressionUnit}
        </text>
        <text
          x={PAD.left + PLOT_W / 2} y={H - 4} textAnchor="middle"
          fontSize={textSize} fontFamily={FONT_SANS} fill="var(--text-primary)"
        >
          {bundle.meta.timeUnit === 'ZT' ? 'Zeitgeber time (h)'
            : bundle.meta.timeUnit === 'CT' ? 'Circadian time (h)' : 'Time (h)'}
        </text>

        {/* One group per arm: fitted curve, then mean±SEM, then replicate dots. */}
        {shown.map((arm) => {
          const color = arm.arm.color;
          const fit = fits?.[arm.arm.key];
          const reps = doublePlot ? [0, cycle] : [0];

          // A fit with no estimable peak (a zero-amplitude or failed cosine
          // fit) has no curve to draw: a flat line would read as a fitted shape.
          const curve = fit && hasEstimablePeak(fit)
            ? fittedCurve(fit, 0, span, 220)
              .map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOf(pt.t).toFixed(2)},${yOf(pt.y).toFixed(2)}`)
              .join(' ')
            : null;

          const meanPath = reps.flatMap((off) =>
            arm.timepoints.map((tp) => ({ t: tp.time + off, v: tp.mean })),
          ).sort((a, b) => a.t - b.t)
            .map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOf(pt.t).toFixed(2)},${yOf(pt.v).toFixed(2)}`)
            .join(' ');

          return (
            <g key={arm.arm.key} data-arm={arm.arm.key}>
              {curve && (
                <path
                  d={curve} fill="none" stroke={color} strokeWidth={1.6}
                  strokeDasharray="5 3" opacity={0.85}
                />
              )}
              <path d={meanPath} fill="none" stroke={color} strokeWidth={1.1} opacity={0.55} />
              {reps.map((off) => arm.timepoints.map((tp) => (
                <g key={`${arm.arm.key}-${tp.time}-${off}`}>
                  {tp.sem > 0 && (
                    <>
                      <line
                        x1={xOf(tp.time + off)} y1={yOf(tp.mean - tp.sem)}
                        x2={xOf(tp.time + off)} y2={yOf(tp.mean + tp.sem)}
                        stroke={INK} strokeWidth={0.8}
                      />
                      <line
                        x1={xOf(tp.time + off) - 3} y1={yOf(tp.mean + tp.sem)}
                        x2={xOf(tp.time + off) + 3} y2={yOf(tp.mean + tp.sem)}
                        stroke={INK} strokeWidth={0.8}
                      />
                      <line
                        x1={xOf(tp.time + off) - 3} y1={yOf(tp.mean - tp.sem)}
                        x2={xOf(tp.time + off) + 3} y2={yOf(tp.mean - tp.sem)}
                        stroke={INK} strokeWidth={0.8}
                      />
                    </>
                  )}
                  {tp.points.map((v, i) => marker(
                    arm.shape,
                    xOf(tp.time + off + jitter(i, tp.points.length)), yOf(v), 2.6,
                    {
                      fill: color, stroke: PAPER, strokeWidth: 0.7, opacity: 0.9,
                      onMouseEnter: hoverOn(arm.arm.key, tp.time, off, i),
                      onMouseLeave: hoverOff,
                    },
                    // A replicate's position within its timepoint is its identity.
                    `p-${i}`,
                  ))}
                  {marker(arm.shape, xOf(tp.time + off), yOf(tp.mean), 3.6, {
                    fill: PAPER, stroke: color, strokeWidth: 1.8,
                    onMouseEnter: hoverOn(arm.arm.key, tp.time, off, null),
                    onMouseLeave: hoverOff,
                  }, 'mean')}
                </g>
              )))}
            </g>
          );
        })}

        {/* Gene label + per-arm legend with the fitted acrophase. Each key
            repeats the arm's marker shape, so the arms can be told apart
            without colour. */}
        <text x={PAD.left} y={14} fontSize={13} fontWeight={600} fontFamily={FONT_MONO} fill="var(--text-primary)">
          {gene}
        </text>
        {shown.map((arm, i) => {
          const fit = fits?.[arm.arm.key];
          const peak = !!fit && hasEstimablePeak(fit);
          const at = compact
            ? `translate(${PAD.left}, ${30 + i * 15})`
            : `translate(${PAD.left + 90 + i * 210}, 10)`;
          return (
            <g key={`lg-${arm.arm.key}`} transform={at} data-legend-arm={arm.arm.key}>
              <line x1={0} y1={0} x2={16} y2={0} stroke={arm.arm.color} strokeWidth={1.6} strokeDasharray={peak ? '5 3' : undefined} />
              {marker(arm.shape, 8, 0, 3.2, { fill: PAPER, stroke: arm.arm.color, strokeWidth: 1.6 })}
              <text x={22} y={4} fontSize={textSize} fontFamily={FONT_SANS} fill="var(--text-muted)">
                {arm.arm.label}
                {fit && peak && (
                  <>
                    {' · peak '}
                    <tspan fontFamily={FONT_MONO}>{unit}{fit.acrophase.toFixed(1)}</tspan>
                  </>
                )}
                {/* The figure's accessible name says "no estimable fitted peak". */}
                {fit && !peak && ' · peak —'}
              </text>
            </g>
          );
        })}

        {hover && (
          <g
            transform={`translate(${Math.max(0, Math.min(hover.x + 8, W - 214))}, ${Math.max(hover.y - 32, 4)})`}
            pointerEvents="none" data-testid="trace-hover"
          >
            <rect width={206} height={32} rx={3} fill={PAPER} stroke={hover.color} strokeWidth={0.9} opacity={0.98} />
            <text x={7} y={13} fontSize={textSize} fontFamily={FONT_SANS} fill="var(--text-primary)">{hover.label}</text>
            <text x={7} y={26} fontSize={textSize} fontFamily={FONT_MONO} fill="var(--text-muted)">{hover.detail}</text>
          </g>
        )}
      </svg>
    </div>
  );
}
