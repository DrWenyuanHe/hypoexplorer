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

import { useMemo, useState } from 'react';
import { FONT_MONO, FONT_SANS } from '../styles/constants';

const INK = '#1A1A1A';
const SIZE = 260;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R_MAX = 92;
const R_MIN = 16;

export interface PhaseMapProps {
  /** Acrophases in hours, one per rhythmic gene. */
  acrophases: number[];
  cycleHours: number;
  timeUnit: 'ZT' | 'CT' | 'h';
  /** Bar colour; defaults to the app's ink. */
  color?: string;
  /** Bin width in hours. */
  binHours?: number;
  /** Shade the second half of the cycle (dark phase). */
  shadeDarkPhase?: boolean;
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
  acrophases, cycleHours, timeUnit, color = '#4C78A8', binHours = 2, shadeDarkPhase = true,
}: PhaseMapProps) {
  const [hover, setHover] = useState<{ bin: number; count: number } | null>(null);

  const { bins, maxCount, total } = useMemo(() => {
    const nBins = Math.max(1, Math.round(cycleHours / binHours));
    const counts = new Array<number>(nBins).fill(0);
    for (const a of acrophases) {
      if (!Number.isFinite(a)) continue;
      let t = a % cycleHours;
      if (t < 0) t += cycleHours;
      counts[Math.min(nBins - 1, Math.floor((t / cycleHours) * nBins))]++;
    }
    return { bins: counts, maxCount: Math.max(1, ...counts), total: acrophases.length };
  }, [acrophases, cycleHours, binHours]);

  const binWidth = cycleHours / bins.length;
  const unit = timeUnit === 'h' ? '' : timeUnit;
  // Area-proportional radius (see the header note).
  const radiusFor = (count: number) => R_MIN + (R_MAX - R_MIN) * Math.sqrt(count / maxCount);

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ width: '100%', maxWidth: SIZE, height: 'auto' }} role="img"
        aria-label={`Distribution of peak times across ${total} rhythmic genes`}>
        <title>{`Peak-time distribution, ${total} rhythmic genes`}</title>

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
                fontSize={10} fontFamily={FONT_MONO} fill="var(--text-muted)"
              >
                {unit}{t}
              </text>
            </g>
          );
        })}

        {bins.map((count, i) => {
          const t0 = i * binWidth;
          if (count === 0) return null;
          return (
            <path
              key={t0}
              d={wedgePath(t0 + 0.12, t0 + binWidth - 0.12, cycleHours, R_MIN, radiusFor(count))}
              fill={color}
              opacity={hover && hover.bin !== i ? 0.35 : 0.8}
              stroke="white"
              strokeWidth={0.6}
              aria-label={`${count} genes peaking between ${unit}${t0.toFixed(0)} and ${unit}${(t0 + binWidth).toFixed(0)}`}
              onMouseEnter={() => setHover({ bin: i, count })}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}

        <circle cx={CX} cy={CY} r={R_MIN} fill="var(--bg-panel)" stroke={INK} strokeWidth={0.6} />
        <text x={CX} y={CY + 3.5} textAnchor="middle" fontSize={10} fontFamily={FONT_MONO} fill="var(--text-muted)">
          {total}
        </text>
      </svg>
      <div style={{
        textAlign: 'center', fontSize: 10.5, fontFamily: FONT_SANS,
        color: 'var(--text-muted)', marginTop: 2, minHeight: 15,
      }}>
        {hover
          ? `${unit}${(hover.bin * binWidth).toFixed(0)}–${unit}${((hover.bin + 1) * binWidth).toFixed(0)}: ${hover.count} gene${hover.count === 1 ? '' : 's'}`
          : `peak times, ${binWidth} h bins`}
      </div>
    </div>
  );
}
