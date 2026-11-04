import type { CSSProperties } from 'react';

interface SpinnerProps {
  size?: number;
  label?: string;
  color?: string;
  style?: CSSProperties;
}

/**
 * Spinning loader ring. Pairs with the `.spinner` utility class in index.html
 * (which respects prefers-reduced-motion). Pass `label` to render an inline
 * "spinner + text" status; omit it for a bare ring.
 */
export function Spinner({ size = 14, label, color = 'var(--text-muted)', style }: SpinnerProps) {
  const ring = (
    <span
      className="spinner"
      aria-hidden="true"
      style={{ width: size, height: size, borderTopColor: 'var(--color-selected)', ...style }}
    />
  );
  if (!label) return ring;
  return (
    <span
      role="status"
      aria-live="polite"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-12)', color }}
    >
      {ring}
      <span>{label}</span>
    </span>
  );
}
