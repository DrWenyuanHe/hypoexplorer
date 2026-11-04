import type { CSSProperties } from 'react';

interface ProgressBarProps {
  /** Fraction complete, 0–1. Omit (or pass null) for an indeterminate bar. */
  value?: number | null;
  /** Bar width. Defaults to filling its container. */
  width?: number | string;
  height?: number;
  /** Accessible name, e.g. "Loading Ast1". Required — a bar with no name is noise. */
  label: string;
  style?: CSSProperties;
}

/**
 * A determinate or indeterminate progress bar.
 *
 * Determinate whenever a fraction is known, indeterminate otherwise, and the
 * SAME component either way — the bar's size and position must not shift when a
 * total arrives (or fails to), which is exactly what swapping in a spinner would
 * do. `.progress-track--busy` carries the sweep animation; both it and the
 * determinate fill's width transition are gated on prefers-reduced-motion in
 * index.html.
 *
 * `aria-valuenow` is omitted while indeterminate, which is how a screen reader
 * is told the work is ongoing but unmeasured; the visual state says the same
 * thing. The percentage itself is NOT rendered here — callers pair the bar with
 * their own byte/file counts, which carry the units.
 */
export function ProgressBar({ value, width = '100%', height = 6, label, style }: ProgressBarProps) {
  const determinate = value != null && Number.isFinite(value);
  // Clamped, not trusted: a total measured at build time against a bundle
  // rewritten since would otherwise overflow the track.
  const pct = determinate ? Math.max(0, Math.min(1, value as number)) * 100 : 0;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(determinate ? { 'aria-valuenow': Math.round(pct) } : {})}
      className={`progress-track${determinate ? '' : ' progress-track--busy'}`}
      style={{ width, height, borderRadius: height, ...style }}
    >
      {determinate && <div className="progress-fill" style={{ width: `${pct}%`, borderRadius: height }} />}
    </div>
  );
}
