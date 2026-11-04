// biome-ignore-all lint/a11y/noStaticElementInteractions: the hoverable marks below are
// figure glyphs, not controls. Their only interaction is a hover read-out, and every value
// they surface is also in the sortable, keyboard-reachable results table beside them —
// making each of several hundred data points separately focusable would degrade keyboard
// navigation rather than improve it.
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
// BarSEMChartImpl): near-black ink, hairline rules, replicate dots drawn over
// the summary mark with a white halo, arm colours from the dataset manifest.

import { useMemo, useState } from 'react';
import { FONT_MONO, FONT_SANS } from '../styles/constants';
import type { TimeSeriesBundle } from '../types';
import { fittedCurve, type RhythmResult } from './rhythmicity';
import { type ArmSummary, summarizeGene } from './timeSeriesSource';

const INK = '#1A1A1A';

// Plot geometry. The viewBox scales to the container, so these are relative
// units as much as pixels; text scales with the figure, which is what keeps a
// downloaded PNG legible at any width.
const W = 760;
const H = 320;
const PAD = { top: 26, right: 20, bottom: 56, left: 62 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

export interface RhythmTraceProps {
  bundle: TimeSeriesBundle;
  gene: string;
  /** Per-arm fit to overlay, keyed by arm key. Absent arms draw data only. */
  fits?: Record<string, RhythmResult | null>;
  /** Arms to draw; defaults to all of them. */
  visibleArms?: string[];
  /** Repeat the cycle twice on the x axis — the convention for reading phase. */
  doublePlot?: boolean;
  height?: number;
}

interface Hover {
  x: number;
  y: number;
  label: string;
  detail: string;
  color: string;
}

/** Ticks every 4 h, or every 6 h once the axis is long enough to crowd. */
function tickStep(span: number): number {
  if (span <= 24) return 4;
  if (span <= 48) return 6;
  return 12;
}

export function RhythmTrace({
  bundle, gene, fits, visibleArms, doublePlot = false, height = H,
}: RhythmTraceProps) {
  const [hover, setHover] = useState<Hover | null>(null);

  const cycle = bundle.meta.cycleHours;
  const span = doublePlot ? cycle * 2 : cycle;
  const summaries: ArmSummary[] = useMemo(() => summarizeGene(bundle, gene), [bundle, gene]);
  const shown = summaries.filter((s) => !visibleArms || visibleArms.includes(s.arm.key));

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
      if (fit) {
        lo = Math.min(lo, fit.mesor - fit.amplitude);
        hi = Math.max(hi, fit.mesor + fit.amplitude);
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { yMin: 0, yMax: 1 };
    if (hi === lo) return { yMin: lo - 1, yMax: hi + 1 };
    const pad = (hi - lo) * 0.12;
    // Expression is non-negative, so the axis floor never goes below zero — a
    // negative CPM tick would be a claim the data cannot make.
    return { yMin: Math.max(0, lo - pad), yMax: hi + pad };
  }, [shown, fits]);

  const xOf = (t: number) => PAD.left + (t / span) * PLOT_W;
  const yOf = (v: number) => PAD.top + PLOT_H - ((v - yMin) / (yMax - yMin)) * PLOT_H;

  // Y ticks: five slots, rounded to something a reader can hold in their head.
  const yTicks = useMemo(() => {
    const raw = (yMax - yMin) / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
    const out: number[] = [];
    for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) out.push(v);
    return out;
  }, [yMin, yMax]);

  const step = tickStep(span);
  const xTicks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= span; t += step) out.push(t);
    return out;
  }, [span, step]);

  const isEntrained = bundle.meta.timeUnit === 'ZT';
  const unit = bundle.meta.timeUnit === 'h' ? '' : bundle.meta.timeUnit;

  // Replicate dots are spread horizontally inside their timepoint so three
  // overlapping values read as three, not one. The offset is in hours, scaled
  // off the sampling interval, so it never bleeds into the neighbouring point.
  const interval = bundle.meta.timepoints.length > 1
    ? bundle.meta.timepoints[1] - bundle.meta.timepoints[0]
    : 4;
  const jitter = (i: number, n: number) => (n <= 1 ? 0 : ((i / (n - 1)) - 0.5) * interval * 0.34);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
        role="img"
        aria-label={`Expression of ${gene} across the sampling cycle`}
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
              <rect x={xOf(t0)} y={0} width={dayW} height={7} fill="#FFFFFF" stroke={INK} strokeWidth={0.7} />
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
        {yTicks.map((v) => (
          <g key={`y-${v}`}>
            <line
              x1={PAD.left} y1={yOf(v)} x2={PAD.left + PLOT_W} y2={yOf(v)}
              stroke={INK} strokeWidth={0.4} opacity={0.14}
            />
            <text
              x={PAD.left - 8} y={yOf(v) + 3.5} textAnchor="end"
              fontSize={10.5} fontFamily={FONT_MONO} fill="var(--text-muted)"
            >
              {v >= 1000 ? v.toFixed(0) : v >= 10 ? v.toFixed(0) : v.toFixed(1)}
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
              fontSize={10.5} fontFamily={FONT_MONO} fill="var(--text-muted)"
            >
              {unit}{doublePlot ? t % cycle : t}
            </text>
          </g>
        ))}

        {/* Axis titles */}
        <text
          transform={`translate(14, ${PAD.top + PLOT_H / 2}) rotate(-90)`}
          textAnchor="middle" fontSize={11} fontFamily={FONT_SANS} fill="var(--text-primary)"
        >
          {bundle.meta.expressionUnit}
        </text>
        <text
          x={PAD.left + PLOT_W / 2} y={H - 4} textAnchor="middle"
          fontSize={11} fontFamily={FONT_SANS} fill="var(--text-primary)"
        >
          {bundle.meta.timeUnit === 'ZT' ? 'Zeitgeber time (h)'
            : bundle.meta.timeUnit === 'CT' ? 'Circadian time (h)' : 'Time (h)'}
        </text>

        {/* One group per arm: fitted curve, then mean±SEM, then replicate dots. */}
        {shown.map((arm) => {
          const color = arm.arm.color;
          const fit = fits?.[arm.arm.key];
          const reps = doublePlot ? [0, cycle] : [0];

          const curve = fit
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
            <g key={arm.arm.key}>
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
                  {tp.points.map((v, i) => (
                    <circle
                      // biome-ignore lint/suspicious/noArrayIndexKey: a replicate's position within its timepoint is its identity
                      key={`p-${i}`}
                      cx={xOf(tp.time + off + jitter(i, tp.points.length))}
                      cy={yOf(v)} r={2.6} fill={color} stroke="white" strokeWidth={0.7}
                      opacity={0.9}
                      aria-label={`${arm.arm.label} ${unit}${tp.time} replicate ${v.toFixed(1)}`}
                      onMouseEnter={() => setHover({
                        x: xOf(tp.time + off), y: yOf(v),
                        label: `${arm.arm.label} · ${unit}${tp.time}`,
                        detail: `${v.toFixed(1)} ${bundle.meta.expressionUnit}`,
                        color,
                      })}
                      onMouseLeave={() => setHover(null)}
                    />
                  ))}
                  <circle
                    cx={xOf(tp.time + off)} cy={yOf(tp.mean)} r={3.6}
                    fill="white" stroke={color} strokeWidth={1.8}
                    aria-label={`${arm.arm.label} ${unit}${tp.time} mean ${tp.mean.toFixed(1)}`}
                    onMouseEnter={() => setHover({
                      x: xOf(tp.time + off), y: yOf(tp.mean),
                      label: `${arm.arm.label} · ${unit}${tp.time}`,
                      detail: `mean ${tp.mean.toFixed(1)} ± ${tp.sem.toFixed(1)} SEM (n=${tp.n})`,
                      color,
                    })}
                    onMouseLeave={() => setHover(null)}
                  />
                </g>
              )))}
            </g>
          );
        })}

        {/* Gene label + per-arm legend with the fitted acrophase. */}
        <text x={PAD.left} y={14} fontSize={12.5} fontWeight={600} fontFamily={FONT_MONO} fill="var(--text-primary)">
          {gene}
        </text>
        {shown.map((arm, i) => {
          const fit = fits?.[arm.arm.key];
          return (
            <g key={`lg-${arm.arm.key}`} transform={`translate(${PAD.left + 90 + i * 210}, 10)`}>
              <line x1={0} y1={0} x2={16} y2={0} stroke={arm.arm.color} strokeWidth={1.6} strokeDasharray={fit ? '5 3' : undefined} />
              <circle cx={8} cy={0} r={3.2} fill="white" stroke={arm.arm.color} strokeWidth={1.6} />
              <text x={22} y={3.5} fontSize={10.5} fontFamily={FONT_SANS} fill="var(--text-muted)">
                {arm.arm.label}
                {fit && fit.period > 0 ? ` · peak ${unit}${fit.acrophase.toFixed(1)}` : ''}
              </text>
            </g>
          );
        })}

        {hover && (
          <g transform={`translate(${Math.min(hover.x + 8, W - 190)}, ${Math.max(hover.y - 30, 4)})`} pointerEvents="none">
            <rect width={182} height={30} rx={3} fill="var(--bg-panel)" stroke={hover.color} strokeWidth={0.9} opacity={0.98} />
            <text x={7} y={12} fontSize={10} fontFamily={FONT_SANS} fill="var(--text-primary)">{hover.label}</text>
            <text x={7} y={24} fontSize={10} fontFamily={FONT_MONO} fill="var(--text-muted)">{hover.detail}</text>
          </g>
        )}
      </svg>
    </div>
  );
}
