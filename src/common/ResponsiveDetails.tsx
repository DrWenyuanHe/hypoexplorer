import type { ReactNode } from 'react';
import { useCompactLayout } from './useCompactLayout';

/** Supporting controls stay available without preceding every mobile result. */
export function ResponsiveDetails({ label, children }: { label: string; children: ReactNode }) {
  const compact = useCompactLayout();
  return compact ? <details className="responsive-details"><summary>{label}</summary>{children}</details> : children;
}
