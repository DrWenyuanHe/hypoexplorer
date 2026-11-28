import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import './modal.css';

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

// Safari has no `closedby` yet, so a backdrop click does nothing there without
// this. Escape and the back gesture close a modal everywhere regardless.
const SUPPORTS_CLOSEDBY = typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;

/** A pointer position outside the dialog's box, which is where the backdrop is. */
function outside(e: MouseEvent, dialog: HTMLDialogElement): boolean {
  const r = dialog.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
}

/**
 * Generic centered modal: a native `<dialog>` opened with `showModal()` for as
 * long as the component is mounted. The browser puts it in the top layer,
 * makes the rest of the page inert, keeps Tab inside it and hands focus back
 * to the opener when it closes, so none of that is rebuilt here.
 *
 * It closes through `onClose` on the × button, a close request (Escape, the
 * Android back gesture) or a backdrop click (`closedby="any"`). A close
 * request fires `cancel`, which is cancelled so the caller decides by
 * unmounting; `close` is the fallback for one the browser will not let be
 * cancelled. A backdrop click closes only when the press both starts and ends
 * on the backdrop, so a text-selection drag that ends outside won't close it.
 * A popup inside that handles Escape itself calls `preventDefault()` on the
 * keydown, which keeps the close request from reaching the dialog.
 *
 * The header (title + × button) is skipped entirely when there is neither a
 * `title` nor a `headerRight`: a panel that renders its own header and close
 * button must not get a second one stacked above it.
 *
 * Popups opened from inside portal into this dialog rather than document.body
 * (see `portalHost`), since a body-level node would sit under the top layer
 * and be inert.
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => { onCloseRef.current = onClose; });

  // Open on mount, close on unmount. Closing before React removes the node is
  // what returns focus to the opener: removing an open dialog does not.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the dialog opens once per mount; the focus target is read only then
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const requestClose = () => onCloseRef.current();
    const onCancel = (e: Event) => { e.preventDefault(); requestClose(); };
    let pressedOutside = false;
    // Only a press on the dialog itself can be on the backdrop: one inside a
    // nested dialog or a popup bubbles up with that element as its target.
    const onDown = (e: MouseEvent) => { pressedOutside = e.target === dialog && outside(e, dialog); };
    const onUp = (e: MouseEvent) => {
      if (pressedOutside && e.target === dialog && outside(e, dialog)) requestClose();
      pressedOutside = false;
    };
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', requestClose);
    if (!SUPPORTS_CLOSEDBY) {
      dialog.addEventListener('mousedown', onDown);
      dialog.addEventListener('mouseup', onUp);
    }
    if (!dialog.open) dialog.showModal();
    const initialFocus = initialFocusSelector ? dialog.querySelector<HTMLElement>(initialFocusSelector) : null;
    (initialFocus ?? dialog).focus();
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', requestClose);
      dialog.removeEventListener('mousedown', onDown);
      dialog.removeEventListener('mouseup', onUp);
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      closedby="any"
      tabIndex={-1}
      aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
      className="modal-panel"
      style={{ width, height }}
    >
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
      <div className="modal-body">
        {children}
      </div>
    </dialog>
  );
}
