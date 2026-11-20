// biome-ignore-all lint/a11y/noStaticElementInteractions: the hoverable marks below are
// figure glyphs, not controls. Their only interaction is a hover read-out, and every value
// they surface is also in the sortable, keyboard-reachable results table beside them —
// making each of several hundred data points separately focusable would degrade keyboard
// navigation rather than improve it.
// Phase map: where in the cycle the rhythmic genes peak.
//
// A circular histogram (rose diagram) over the acrophases of every gene that
// passed the current threshold — the panel that answers "is there a coherent
// wave, and when does it break" for a whole transcriptome at once, which no
// per-gene trace can. Read clockwise from the top: the cycle's zero point is at
// 12 o'clock and time advances the way a clock's hand does, so the shape maps
// onto the reader's intuition for time of day rather than onto a maths
// convention where angles run anticlockwise from east.
//
// Bin height is sqrt-scaled by area, not by radius: a rose petal's visual weight
// is its area, so scaling the radius linearly would make a bin holding twice as
// many genes look four times as large.
//
// Bins default to 2 h. A coarse sampling grid puts every JTK peak on a lattice
// (a 6 h grid gives phases every 3 h), and 2 h bins over a 3 h lattice alternate
// between holding a lattice point and holding none, drawing spikes that come
// from the grid rather than the biology. When every peak lies on a lattice
// coarser than the bin width, the map bins on that lattice instead, one bin
// centred on each lattice point, and its caption says so.
//
// The default fill is a neutral ink. Arm colour is a claim about which arm the
// genes came from, so the container passes it; the figure does not assume one.

import { useMemo, useState } from 'react';
import { FONT_MONO, FONT_SANS } from '../styles/constants';

const INK = 'var(--text-primary)';
const NEUTRAL_FILL = 'var(--text-mono)';
const SIZE = 260;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R_MAX = 92;
const R_MIN = 16;
/** Hours within which a peak counts as lying on a lattice point. */
const LATTICE_EPS = 1e-6;
/** A lattice must leave at least this many bins around the cycle. */
const MIN_LATTICE_BINS = 4;

export interface PhaseMapProps {
  /** Acrophases in hours, one per rhythmic gene. */
  acrophases: number[];
  cycleHours: number;
  timeUnit: 'ZT' | 'CT' | 'h';
  /** Petal colour, normally the tested arm's colour; defaults to a neutral ink. */
  color?: string;
  /** Bin width in hours, unless the peaks lie on a coarser lattice. */
  binHours?: number;
  /** Shade the second half of the cycle (dark phase). */
  shadeDarkPhase?: boolean;
}

/** A regular set of peak times: offset + k × step, wrapped to the cycle. */
export interface PhaseLattice {
  step: number;
  offset: number;
}

function wrap(t: number, cycle: number): number {
  const r = t % cycle;
  return r < 0 ? r + cycle : r;
}

/**
 * The coarsest lattice coarser than `binHours` on which every finite peak lies,
 * or null when the peaks are continuous (or too few to show a lattice).
 *
 * Candidate steps divide the cycle evenly, so lattice bins tile it, and leave at
 * least four bins. At least two distinct peak times are required: one value
 * lies on every lattice and says nothing about the grid.
 */
export function phaseLattice(
  acrophases: readonly number[], cycleHours: number, binHours: number,
): PhaseLattice | null {
  const phases = acrophases.filter(Number.isFinite).map((a) => wrap(a, cycleHours));
  if (!phases.length) return null;
  const anchor = phases[0];
  const onCycle = (d: number) => Math.min(d, cycleHours - d);
  if (!phases.some((p) => onCycle(Math.abs(p - anchor)) > LATTICE_EPS)) return null;
  const maxBins = Math.floor(cycleHours / binHours);
  for (let n = MIN_LATTICE_BINS; n <= maxBins; n++) {
    const step = cycleHours / n;
    if (step <= binHours + LATTICE_EPS) break;
    const fits = phases.every((p) => {
      const r = (p - anchor) / step;
      return Math.abs(r - Math.round(r)) * step < LATTICE_EPS;
    });
    if (fits) {
      const offset = wrap(anchor, step);
      return { step, offset: step - offset < LATTICE_EPS ? 0 : offset };
    }
  }
  return null;
}

/** "3", "1.5", "4.8": hours to at most two decimals, no trailing zeros. */
function fmtHours(t: number): string {
  return String(Number(t.toFixed(2)));
}

/** "ZT6", "CT22.5" or "6 h": a cycle time wrapped into the cycle. */
function timeTextFor(unit: string, cycle: number): (t: number) => string {
  return (t) => (unit ? `${unit}${fmtHours(wrap(t, cycle))}` : `${fmtHours(wrap(t, cycle))} h`);
}

/** Cycle time → screen point, clockwise from 12 o'clock. */
function polar(time: number, cycle: number, radius: number): { x: number; y: number } {
  const angle = (time / cycle) * 2 * Math.PI - Math.PI / 2;
  return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle) };
}

function wedgePath(t0: number, t1: number, cycle: number, rInner: number, rOuter: number): string {
  const a = polar(t0, cycle, rInner);
  const b = polar(t0, cycle, rOuter);
  const c = polar(t1, cycle, rOuter);
  const d = polar(t1, cycle, rInner);
  const large = (t1 - t0) / cycle > 0.5 ? 1 : 0;
  return [
    `M${a.x.toFixed(2)},${a.y.toFixed(2)}`,
    `L${b.x.toFixed(2)},${b.y.toFixed(2)}`,
    `A${rOuter},${rOuter} 0 ${large} 1 ${c.x.toFixed(2)},${c.y.toFixed(2)}`,
    `L${d.x.toFixed(2)},${d.y.toFixed(2)}`,
    `A${rInner},${rInner} 0 ${large} 0 ${a.x.toFixed(2)},${a.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

export function PhaseMap({
  acrophases, cycleHours, timeUnit, color, binHours = 2, shadeDarkPhase = true,
}: PhaseMapProps) {
  const [hover, setHover] = useState<number | null>(null);

  const { bins, binWidth, origin, lattice, maxCount, total } = useMemo(() => {
    const found = phaseLattice(acrophases, cycleHours, binHours);
    const nBins = found
      ? Math.round(cycleHours / found.step)
      : Math.max(1, Math.round(cycleHours / binHours));
    const width = cycleHours / nBins;
    const counts = new Array<number>(nBins).fill(0);
    let plotted = 0;
    for (const a of acrophases) {
      if (!Number.isFinite(a)) continue;
      const t = wrap(a, cycleHours);
      // A lattice bin is centred on its lattice point, so a peak exactly on the
      // point cannot fall either side of a bin edge through rounding.
      const index = found
        ? wrap(Math.round((t - found.offset) / width), nBins)
        : Math.min(nBins - 1, Math.floor((t / cycleHours) * nBins));
      counts[index]++;
      plotted++;
    }
    return {
      bins: counts, binWidth: width, origin: found ? found.offset - width / 2 : 0,
      lattice: found, maxCount: Math.max(1, ...counts), total: plotted,
    };
  }, [acrophases, cycleHours, binHours]);

  const unit = timeUnit === 'h' ? '' : timeUnit;
  const timeText = timeTextFor(unit, cycleHours);
  const binStart = (i: number) => origin + i * binWidth;
  /** What a bin covers: its lattice point, or its start–end range. */
  const binText = (i: number) => (lattice
    ? timeText(binStart(i) + binWidth / 2)
    : `${timeText(binStart(i))}–${timeText(binStart(i) + binWidth)}`);
  // Area-proportional radius (see the header note).
  const radiusFor = (count: number) => R_MIN + (R_MAX - R_MIN) * Math.sqrt(count / maxCount);
  const restOpacity = color ? 0.8 : 0.55;
  const dimOpacity = color ? 0.35 : 0.2;
  const summary = useMemo(
    () => describeDistribution(
      acrophases, bins, total, lattice !== null, (i: number) => origin + i * binWidth,
      binWidth, cycleHours, timeTextFor(unit, cycleHours),
    ),
    [acrophases, bins, total, lattice, origin, binWidth, cycleHours, unit],
  );

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ width: '100%', maxWidth: SIZE, height: 'auto' }} role="img"
        aria-label={summary}>
        <title>{summary}</title>

        {shadeDarkPhase && (
          <path
            d={wedgePath(cycleHours / 2, cycleHours, cycleHours, 0, R_MAX + 12)}
            fill={INK} opacity={0.05}
          />
        )}

        {/* Reference rings at a quarter, half and all of the tallest bin. */}
        {[0.25, 0.5, 1].map((f) => (
          <circle
            key={f} cx={CX} cy={CY} r={R_MIN + (R_MAX - R_MIN) * Math.sqrt(f)}
            fill="none" stroke={INK} strokeWidth={0.4} opacity={0.16}
          />
        ))}

        {/* Hour spokes + labels every quarter cycle. */}
        {Array.from({ length: 4 }, (_, i) => {
          const t = (i * cycleHours) / 4;
          const outer = polar(t, cycleHours, R_MAX + 6);
          const label = polar(t, cycleHours, R_MAX + 18);
          return (
            <g key={`spoke-${t}`}>
              <line
                x1={polar(t, cycleHours, R_MIN).x} y1={polar(t, cycleHours, R_MIN).y}
                x2={outer.x} y2={outer.y} stroke={INK} strokeWidth={0.4} opacity={0.24}
              />
              <text
                x={label.x} y={label.y + 3.5} textAnchor="middle"
                fontSize={11} fontFamily={FONT_MONO} fill="var(--text-muted)"
              >
                {unit}{t}
              </text>
            </g>
          );
        })}

        {bins.map((count, i) => {
          const t0 = binStart(i);
          if (count === 0) return null;
          return (
            <path
              key={t0}
              d={wedgePath(t0 + 0.12, t0 + binWidth - 0.12, cycleHours, R_MIN, radiusFor(count))}
              fill={color ?? NEUTRAL_FILL}
              opacity={hover !== null && hover !== i ? dimOpacity : restOpacity}
              stroke="var(--bg-panel)"
              strokeWidth={0.6}
              aria-label={`${count} gene${count === 1 ? '' : 's'} peaking ${lattice ? 'at' : 'in'} ${binText(i)}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}

        <circle cx={CX} cy={CY} r={R_MIN} fill="var(--bg-panel)" stroke={INK} strokeWidth={0.6} opacity={0.6} />
        <text x={CX} y={CY + 3.5} textAnchor="middle" fontSize={11} fontFamily={FONT_MONO} fill="var(--text-muted)">
          {total}
        </text>
      </svg>
      <div
        data-testid="phase-map-bin-caption"
        style={{
          textAlign: 'center', fontSize: 12, fontFamily: FONT_SANS, lineHeight: 1.4,
          color: 'var(--text-muted)', marginTop: 2, minHeight: 17,
        }}
      >
        {hover !== null && hover < bins.length ? (
          <><span style={{ fontFamily: FONT_MONO }}>{binText(hover)}</span>: <span style={{ fontFamily: FONT_MONO }}>{bins[hover]}</span> gene{bins[hover] === 1 ? '' : 's'}</>
        ) : lattice ? (
          <>peak times, <span style={{ fontFamily: FONT_MONO }}>{fmtHours(binWidth)}</span> h bins (all peaks lie on a <span style={{ fontFamily: FONT_MONO }}>{fmtHours(binWidth)}</span> h step)</>
        ) : (
          <>peak times, <span style={{ fontFamily: FONT_MONO }}>{fmtHours(binWidth)}</span> h bins</>
        )}
      </div>
    </div>
  );
}

/** Hours of slack when testing whether two peaks fit in one window. */
const WINDOW_EPS = 1e-9;

/**
 * The most peaks any half-open window [s, s + width) holds, sliding
 * continuously around the cycle (not stepping by bins), with the first and
 * last peak time inside it. Ties go to the window starting at the earliest peak time. A window of the
 * maximum count can always start at a peak, so only those starts are tried;
 * two pointers over the doubled, sorted times keep this linear after sorting.
 */
export function densestWindow(
  acrophases: readonly number[], cycleHours: number, width: number,
): { count: number; first: number; last: number } | null {
  const t = acrophases.filter(Number.isFinite).map((a) => wrap(a, cycleHours)).sort((a, b) => a - b);
  const n = t.length;
  if (!n) return null;
  const at = (k: number) => (k < n ? t[k] : t[k - n] + cycleHours);
  let best = { count: 0, first: t[0], last: t[0] };
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (j < i) j = i;
    while (j + 1 < i + n && at(j + 1) - t[i] < width - WINDOW_EPS) j++;
    if (j - i + 1 > best.count) best = { count: j - i + 1, first: t[i], last: wrap(at(j), cycleHours) };
  }
  return best;
}

/**
 * One-sentence text alternative for the rose: how many peaks, and how many of
 * them fall within a quarter cycle.
 *
 * Windows are half-open, [s, s + quarter cycle). On a lattice every peak sits
 * on a lattice point and the bins are centred on those points, so stepping a
 * window bin by bin already visits every distinct set of peaks a sliding
 * window can hold; the window is named by its bin edges
 * so the stated width matches the times given. Continuous peak times are
 * searched with a truly sliding window (densestWindow), and the sentence names
 * the earliest and latest peak inside it.
 */
function describeDistribution(
  acrophases: readonly number[], bins: readonly number[], total: number, onLattice: boolean,
  binStart: (i: number) => number, binWidth: number, cycleHours: number,
  timeText: (t: number) => string,
): string {
  if (total === 0) return 'Peak times: no genes to show';
  const genes = `${total.toLocaleString()} gene${total === 1 ? '' : 's'}`;
  const shareOf = (count: number) => `${count.toLocaleString()} (${Math.round((count / total) * 100)}%)`;
  if (!onLattice) {
    const width = cycleHours / 4;
    const win = densestWindow(acrophases, cycleHours, width);
    if (!win) return `Peak times of ${genes}`;
    const where = Math.abs(win.last - win.first) < WINDOW_EPS
      ? `at ${timeText(win.first)}`
      : `between ${timeText(win.first)} and ${timeText(win.last)}`;
    return `Peak times of ${genes}; ${shareOf(win.count)} peak ${where}, the most within any ${fmtHours(width)} h window`;
  }
  const n = bins.length;
  const span = Math.max(1, Math.round(cycleHours / 4 / binWidth));
  if (span >= n) return `Peak times of ${genes}`;
  let best = 0;
  let bestCount = -1;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < span; j++) sum += bins[(i + j) % n];
    if (sum > bestCount) { best = i; bestCount = sum; }
  }
  const share = shareOf(bestCount);
  if (span === 1) {
    return `Peak times of ${genes}; ${share} peak at ${timeText(binStart(best) + binWidth / 2)}, the most common peak time`;
  }
  // Name the window by its edges. A lattice bin is centred on its lattice
  // point, so its edges sit half a step either side: two 3 h bins at ZT6 and
  // ZT9 span ZT4.5 to ZT10.5, which is the 6 h the sentence reports.
  const from = binStart(best);
  const to = binStart(best + span);
  return `Peak times of ${genes}; ${share} peak between ${timeText(from)} and ${timeText(to)}, the densest ${fmtHours(span * binWidth)} h window`;
}
