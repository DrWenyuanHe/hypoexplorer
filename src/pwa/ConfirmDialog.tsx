import { useEffect } from 'react';
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
   * - a callback → Escape closes, listened for in the BUBBLE phase, and the
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
 * The PWA prompt shell: fixed backdrop + centered 420px `alertdialog` panel,
 * body-scroll lock, and the Escape policy above. Callers supply their own
 * heading, body copy and buttons.
 *
 * Deliberately SEPARATE from `src/common/Modal.tsx`: these are alerts, not
 * ordinary dialogs — `role="alertdialog"`, no × in a shared header, no
 * close-on-backdrop-click, and a z-index above every app-level overlay so a
 * wedged service worker can always be escaped from.
 */
export function ConfirmDialog({ labelledBy, describedBy, onEscape, children }: ConfirmDialogProps) {
  useEffect(() => {
    const swallow = onEscape === 'swallow';
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (swallow) { e.preventDefault(); e.stopPropagation(); return; }
      onEscape();
    };
    window.addEventListener('keydown', onKey, swallow);
    return () => window.removeEventListener('keydown', onKey, swallow);
  }, [onEscape]);

  // Body scroll stays locked for as long as the prompt is up; the previous
  // value is saved and restored rather than cleared.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed', inset: 0, zIndex: 2147483000,
        background: 'rgba(16,24,40,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        style={{
          width: 420, maxWidth: '100%', background: 'var(--bg-panel)',
          borderRadius: 12, boxShadow: '0 18px 44px rgba(0,0,0,0.28)',
          overflow: 'hidden', fontFamily: FONT_SANS,
        }}
      >
        {children}
      </div>

      {/* Spinner keyframes for the callers' pending buttons — scoped, injected
          once with the dialog. */}
      <style>{'@keyframes pwa-spin { to { transform: rotate(360deg); } }'}</style>
    </div>
  );
}
