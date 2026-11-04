import type { CSSProperties, ReactNode } from 'react';

interface EmptyStateProps {
  title?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  style?: CSSProperties;
}

/**
 * Centered placeholder for "nothing to show yet" states — empty search results,
 * no selection, no data. `title` is the primary line, `hint` an optional
 * secondary explanation, `action` an optional React node (e.g. a reset button).
 *
 * Note: `title` and `hint` each render as a single text node inside their own
 * element so Testing Library's getByText matches them directly. Keep any
 * test-pinned copy contiguous within one prop.
 */
export function EmptyState({ title, hint, action, icon, style }: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 'var(--sp-2)',
        padding: 'var(--sp-6) var(--sp-4)',
        color: 'var(--text-muted)',
        ...style,
      }}
    >
      {icon && <div style={{ color: 'var(--border-dark)', marginBottom: 'var(--sp-1)' }}>{icon}</div>}
      <div style={{ fontSize: 'var(--fs-13)', fontWeight: 500, color: 'var(--text-primary)' }}>{title}</div>
      {hint && <div style={{ fontSize: 'var(--fs-12)', maxWidth: 380, lineHeight: 1.5 }}>{hint}</div>}
      {action && <div style={{ marginTop: 'var(--sp-2)' }}>{action}</div>}
    </div>
  );
}
