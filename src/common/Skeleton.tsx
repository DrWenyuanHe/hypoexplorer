import type { CSSProperties } from 'react';

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: CSSProperties;
}

/**
 * Pulsing placeholder block. Pairs with the `.skeleton` utility class
 * (sk-pulse animation, reduced-motion aware). Use for content-shaped loading
 * states — a toolbar bar, a chart area — while data streams in.
 */
export function Skeleton({ width = '100%', height = 14, radius = 'var(--r-sm)', style }: SkeletonProps) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius, ...style }} aria-hidden="true" />;
}
