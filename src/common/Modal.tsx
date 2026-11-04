import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent, ReactNode } from 'react';
import { trapTab } from '../utils/focusTrap';

interface ModalProps {
  title?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  width?: string;
  height?: string;
  headerRight?: ReactNode;
  /** Focus a control inside the panel on open; otherwise focus the panel. */
  initialFocusSelector?: string;
  /**
   * Accessible name for the dialog. Defaults to `title` when that is a plain
   * string; pass it explicitly when the title is markup, or when the panel
   * brings its own header, so the dialog is never left unnamed.
   */
  ariaLabel?: string;
}

/**
 * Generic centered modal overlay. Dismissible via the × button, the Escape key,
 * or a click on the backdrop. Mirrors the look of the leading-edge pathway modal
 * in GeneExplorerTab. The backdrop only closes on a click that both starts and
 * ends on the backdrop, so a text-selection drag that ends outside won't close it.
 *
 * The header (title + × button) is skipped entirely when there is neither a
 * `title` nor a `headerRight`: a panel that renders its own header and close
 * button must not get a second one stacked above it.
 *
 * Body scroll is locked for as long as the modal is mounted, so the page can't
 * scroll away behind the overlay.
 */
export function Modal({
  title,
  onClose,
  children,
  width = '80vw',
  height = '80vh',
  headerRight = null,
  ariaLabel,
  initialFocusSelector,
}: ModalProps) {
  const backdropMouseDown = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Lock body scroll while the dialog is up. The previous value is SAVED and
  // restored rather than cleared, so a modal opened from inside another modal
  // doesn't hand the page back its scrollbar while the outer one is still up.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Move focus into the dialog on open and restore it on close.
  useEffect(() => {
    const prevFocused = document.activeElement as HTMLElement | null;
    const initialFocus = initialFocusSelector
      ? panelRef.current?.querySelector<HTMLElement>(initialFocusSelector)
      : null;
    (initialFocus ?? panelRef.current)?.focus();
    return () => {
      // Restore focus to the trigger, but only if it's still in the DOM — a modal
      // action can unmount its opener (e.g. a tile that navigates away), and
      // focusing a detached node silently drops focus to <body>.
      if (prevFocused && document.contains(prevFocused)) prevFocused.focus();
    };
  }, [initialFocusSelector]);

  // Trap Tab so keyboard focus can't escape to the page behind the modal
  // (WCAG 2.4.3 / 2.1.2).
  //
  // A REACT handler, not the native listener this used to attach to the panel.
  // Callers render QualityBadge, which portals its checklist into document.body;
  // native listeners follow the DOM tree, so keystrokes inside that popover
  // never reached the panel and Tab walked straight out of the dialog. React's
  // synthetic events propagate through the component tree instead, so the
  // portal's keys arrive here.
  const onPanelKeyDown = useCallback((e: ReactKeyboardEvent) => {
    if (panelRef.current) trapTab(e, panelRef.current);
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
      className="modal-backdrop"
      // The trap listens here, on the element that carries role="dialog", rather
      // than on the panel: the panel is a role-less div, and the keys reach this
      // one either way since it is the panel's React parent.
      onKeyDown={onPanelKeyDown}
      onMouseDown={(e: MouseEvent) => { backdropMouseDown.current = e.target === e.currentTarget; }}
      onMouseUp={(e: MouseEvent) => {
        if (backdropMouseDown.current && e.target === e.currentTarget) onClose();
        backdropMouseDown.current = false;
      }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div ref={panelRef} tabIndex={-1} className="modal-panel" style={{
        width, height, maxWidth: '95vw', maxHeight: '90vh',
        background: 'var(--bg-app)', border: '1px solid var(--border-dark)',
        borderRadius: 6, boxShadow: 'var(--shadow-lg)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden', outline: 'none',
      }}>
        {/* Header — see the headerless note above */}
        {(title != null || headerRight != null) && (
          <div className="modal-header" style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, rowGap: 6, flexWrap: 'wrap',
            padding: '10px 14px', borderBottom: '1px solid var(--border)',
            background: 'var(--bg-panel)',
          }}>
            <div className="type-heading" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </div>
            {headerRight != null && <div className="modal-header-actions">{headerRight}</div>}
            <button className="modal-close" type="button" onClick={onClose} aria-label="Close"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)', lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>
              ×
            </button>
          </div>
        )}
        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
