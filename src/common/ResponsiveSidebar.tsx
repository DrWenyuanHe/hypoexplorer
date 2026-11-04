import { useCallback, useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal } from './Modal';
import { useCompactLayout } from './useCompactLayout';

interface ResponsiveSidebarProps {
  label: string;
  summary: ReactNode;
  width?: number | string;
  children: (close: () => void) => ReactNode;
}

/** Keep one navigator mounted: a rail on desktop, an accessible dialog on mobile. */
export function ResponsiveSidebar({ label, summary, width = 'var(--sidebar-w)', children }: ResponsiveSidebarProps) {
  const compact = useCompactLayout();
  const [open, setOpen] = useState(false);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!compact) setOpen(false);
  }, [compact]);

  if (!compact) {
    return <aside className="responsive-sidebar" aria-label={label} style={{ width }}>{children(close)}</aside>;
  }

  return (
    <div className="mobile-sidebar-control">
      <button type="button" className="mobile-sidebar-trigger" aria-haspopup="dialog"
        aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(true)}>
        <span>{label}</span><span className="mobile-sidebar-summary">{summary}</span><span aria-hidden="true">▾</span>
      </button>
      {open && (
        <Modal title={label} onClose={close} width="420px" height="85dvh">
          <div id={id} className="responsive-sidebar-content">{children(close)}</div>
          <div className="mobile-sidebar-footer">
            <button type="button" className="btn btn--primary" onClick={close}>Show results</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
