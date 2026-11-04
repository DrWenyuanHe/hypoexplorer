import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { forceRefresh } from './forceRefresh';
import { FONT_MONO } from '../styles/constants';
import { RELEASE_IDENTITY } from '../data/releaseIdentity';

// Build version, inlined by Vite's `define` (see vite.config.ts). Guarded so the
// component never throws in an environment where the define wasn't applied.
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

// Header affordance: shows the running build version (so the user can confirm an
// update actually landed) and offers a manual "refresh to latest" escape hatch.
//
// Complements <UpdateModal>, which only appears when the browser has already
// detected a freshly deployed service worker. This badge is ALWAYS available —
// it covers the case where a stale SW is wedged and the automatic prompt never
// fired (the scenario behind "Failed to load <track> data" + "version not
// updating"). Clicking it asks for confirmation, then clears the SW + caches and
// reloads (see forceRefresh.ts).
export function VersionBadge() {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  const refresh = () => {
    setPending(true);
    // Unregisters SWs, clears caches, and reloads. The page navigates away, so
    // there's nothing to reset afterward.
    forceRefresh();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        title={`Release ${RELEASE_IDENTITY.releaseId.slice(0, 12)}. Clear cached app files and data, then reload the latest version`}
        aria-label={`Version ${APP_VERSION}. Refresh to the latest version.`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: 11, padding: '4px 9px',
          border: '1px solid var(--border)', borderRadius: 6,
          background: 'transparent', color: 'var(--text-muted)',
          cursor: 'pointer', fontFamily: FONT_MONO,
          transition: 'color var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease)',
        }}
      >
        <span>v{APP_VERSION}</span>
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none"
          aria-hidden="true" focusable="false"
          stroke="currentColor" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <path d="M21 3v5h-5" />
        </svg>
      </button>

      {confirming && (
        // Escape cancels the dialog (keyboard-accessible dismissal), but not
        // once the refresh is already in flight.
        <ConfirmDialog
          labelledBy="version-refresh-title"
          describedBy="version-refresh-desc"
          onEscape={() => { if (!pending) setConfirming(false); }}
        >
          <div style={{
            padding: '16px 18px 12px', borderBottom: '1px solid var(--border)',
          }}>
            <h3 id="version-refresh-title" style={{
              fontSize: 15, fontWeight: 600, margin: 0, color: 'var(--text-primary)',
            }}>
              Refresh to the latest version?
            </h3>
          </div>

          <div style={{ padding: '14px 18px 6px' }}>
            <p id="version-refresh-desc" style={{
              fontSize: 13, lineHeight: 1.5, color: 'var(--text-mono)', margin: 0,
            }}>
              This clears HypoExplorer&apos;s cached app and data, then reloads from
              the server. Use it if data fails to load or the app looks out of date.
              You&apos;re currently on <strong>v{APP_VERSION}</strong>.
            </p>
            <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-mono)' }}>
              Release: <code>{RELEASE_IDENTITY.releaseId.slice(0, 12)}</code>
              {RELEASE_IDENTITY.sourceDirty ? ' (includes uncommitted source changes)' : ''}.
              {' '}<a href="/release.json" target="_blank" rel="noreferrer">Release metadata</a>
              {' · '}<a href="/how-to-cite/">Citation and reuse</a>
            </p>
          </div>

          <div style={{
            padding: '12px 18px 16px',
            display: 'flex', justifyContent: 'flex-end', gap: 8,
          }}>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              style={{
                padding: '7px 14px', fontSize: 13, fontFamily: 'inherit',
                border: '1px solid var(--border-dark)', borderRadius: 7,
                background: 'var(--bg-app)', color: 'var(--text-mono)',
                cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.5 : 1,
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={refresh}
              disabled={pending}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '7px 16px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                border: 'none', borderRadius: 7,
                background: 'var(--color-selected)', color: '#fff',
                cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.8 : 1,
                boxShadow: '0 2px 6px rgba(242, 142, 43, 0.3)',
              }}
            >
              {pending && (
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
                  aria-hidden="true" focusable="false"
                  stroke="#fff" strokeWidth="2.4" strokeLinecap="round"
                  style={{ animation: 'pwa-spin 0.7s linear infinite' }}>
                  <path d="M21 12a9 9 0 1 1-6.2-8.5" />
                </svg>
              )}
              {pending ? 'Refreshing…' : 'Refresh now'}
            </button>
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}
