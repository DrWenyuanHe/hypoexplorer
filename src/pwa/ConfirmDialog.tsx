import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { FONT_SANS } from '../styles/constants';

interface ConfirmDialogProps {
  /** id of the heading that names the dialog (`aria-labelledby`). */
  labelledBy: string;
  /** id of the paragraph that describes it (`aria-describedby`). */
  describedBy: string;
  /**
   * What the Escape key does — the two service-worker prompts deliberately
   * differ, so the policy is stated per caller:
   * - a callback → a close request (Escape, the back gesture) calls it, and the
   *   caller decides whether a dismissal is currently allowed (VersionBadge
   *   ignores it once the refresh is in flight);
   * - `'swallow'` → Escape is stopped in the CAPTURE phase, so nothing anywhere
   *   on the page can dismiss the dialog by reflex (a pending update must never
   *   be lost silently).
   */
  onEscape: (() => void) | 'swallow';
  children: ReactNode;
}

/**
 * The PWA prompt shell: a native modal `<dialog role="alertdialog">`, a 420px
 * panel over a dimmed backdrop, and the Escape policy above. Callers supply
 * their own heading, body copy and buttons.
 *
 * Deliberately SEPARATE from `src/common/Modal.tsx`: these are alerts, not
 * ordinary dialogs — `role="alertdialog"`, no × in a shared header and no
 * close-on-backdrop-click. It opens in the top layer, above
 * any Modal already open, so a wedged service worker can always be escaped from.
 *
 * Only the caller closes it, by unmounting. A close request is cancelled; if the
 * browser closes it anyway (it does not let a repeated Escape or back gesture
 * without user activation be cancelled), it is shown again.
 */
export function ConfirmDialog({ labelledBy, describedBy, onEscape, children }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onEscapeRef = useRef(onEscape);
  useLayoutEffect(() => { onEscapeRef.current = onEscape; });
  const swallow = onEscape === 'swallow';

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      const policy = onEscapeRef.current;
      if (policy !== 'swallow') policy();
    };
    const reopen = () => { if (!dialog.open) dialog.showModal(); };
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', reopen);
    if (!dialog.open) dialog.showModal();
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', reopen);
      if (dialog.open) dialog.close();
    };
  }, []);

  // 'swallow': cancelling the keydown means no close request is made at all,
  // and stopping it in the capture phase keeps it from every page listener.
  useLayoutEffect(() => {
    if (!swallow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [swallow]);

  return (
    <dialog
      ref={dialogRef}
      className="pwa-confirm"
      role="alertdialog"
      // A callback needs the close request to arrive as `cancel`; 'swallow'
      // turns close requests off where `closedby` is supported.
      closedby={swallow ? 'none' : 'closerequest'}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      style={{
        // margin: auto centres a modal dialog. The page-wide reset in
        // index.html sets margin: 0 on everything, which pins it top-left.
        width: 420, maxWidth: 'calc(100% - 32px)', margin: 'auto', padding: 0, border: 'none',
        background: 'var(--bg-panel)', color: 'var(--text-primary)',
        borderRadius: 12, boxShadow: '0 18px 44px rgba(0,0,0,0.28)',
        overflow: 'hidden', fontFamily: FONT_SANS,
      }}
    >
      {children}

      {/* Backdrop and the spinner keyframes for the callers' pending buttons —
          scoped, injected once with the dialog. */}
      <style>{
        '.pwa-confirm::backdrop { background: rgba(16,24,40,0.45); overflow: hidden; overscroll-behavior: contain; }'
        + ' .pwa-confirm:modal { overscroll-behavior: contain; }'
        + ' @keyframes pwa-spin { to { transform: rotate(360deg); } }'
      }</style>
    </dialog>
  );
}
