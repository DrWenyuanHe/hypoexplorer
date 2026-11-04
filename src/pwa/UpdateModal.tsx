import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { subscribe, getSnapshot, applyUpdate } from './updateStore';

// "Updating to the newest version" prompt. Mounted once at the app root. Stays
// invisible (renders null) until a newer deploy is detected — either by the
// service worker parking a freshly built SW in "waiting" (registerUpdates.ts)
// or by the version stamp poll noticing this tab is behind (versionWatch.ts).
//
// Update policy: MANDATORY. There is no "Later", no ×, no Escape and no
// backdrop dismissal — once a newer build exists, this tab reloads onto it,
// automatically after AUTO_RELOAD_SECONDS if the user does nothing.
//
// Why an old tab is not allowed to keep running: the deployed data is versioned
// with the app (?v=<version>, and /datasets/** is cached immutable for a year on
// the strength of that), so an old bundle does not merely look out of date — it
// requests data at paths and versions the current deploy may have moved or
// deleted, which surfaces as "Failed to load <track> data" (the v0.4→v0.5
// restructure did exactly this). A prompt that could be dismissed left users in
// that state indefinitely, and every bug report from one of those sessions
// describes a build that is no longer deployed.
//
// The countdown exists so the reload is never a silent surprise: the user sees
// what is about to happen, and can take it immediately with "Reload now".
const AUTO_RELOAD_SECONDS = 10;

export function UpdateModal() {
  const signal = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [pending, setPending] = useState(false);
  // The countdown carries the signal it belongs to. Two states would desync: on
  // the render where a SECOND update bumps the signal, the reset written by the
  // restart effect is not visible to the apply effect yet, so it would read the
  // previous countdown's 0 and fire the new update instantly with no notice.
  const [countdown, setCountdown] = useState({ signal: 0, secondsLeft: AUTO_RELOAD_SECONDS });
  // applyUpdate() must fire exactly once per detected update: the button and the
  // countdown race, and React StrictMode double-invokes effects in dev.
  const applied = useRef(false);

  const open = signal > 0;
  const secondsLeft = countdown.signal === signal ? countdown.secondsLeft : AUTO_RELOAD_SECONDS;

  // Restart the countdown for each newly detected update (a second deploy while
  // the tab is still open bumps the signal again).
  useEffect(() => {
    if (signal === 0) return;
    applied.current = false;
    setPending(false);
    setCountdown({ signal, secondsLeft: AUTO_RELOAD_SECONDS });
    const id = setInterval(() => {
      setCountdown((c) =>
        c.signal === signal && c.secondsLeft > 0 ? { signal, secondsLeft: c.secondsLeft - 1 } : c,
      );
    }, 1000);
    return () => clearInterval(id);
  }, [signal]);

  // Reaching zero applies the update exactly as the button does.
  useEffect(() => {
    if (signal === 0 || countdown.signal !== signal || countdown.secondsLeft > 0) return;
    if (applied.current) return;
    applied.current = true;
    setPending(true);
    applyUpdate();
  }, [signal, countdown]);

  if (!open) return null;

  const reloadNow = () => {
    if (applied.current) return;
    applied.current = true;
    setPending(true);
    // applyUpdate() → the fn registered with the store: SKIP_WAITING + reload
    // for the service-worker path, or a full cache reset + reload for the
    // version-stamp path. The spinner covers the gap until the page navigates.
    applyUpdate();
  };

  return (
    // The shell (backdrop, 420px panel, body-scroll lock) is ConfirmDialog's;
    // `onEscape="swallow"` is what stops the key dismissing a mandatory update.
    <ConfirmDialog
      labelledBy="pwa-update-title"
      describedBy="pwa-update-desc"
      onEscape="swallow"
    >
      <div style={{
        padding: '16px 18px 12px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
          background: 'rgba(242, 142, 43, 0.14)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
            aria-hidden="true" focusable="false"
            stroke="var(--color-selected)" strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 3v5h-5" />
          </svg>
        </span>
        <h3 id="pwa-update-title" style={{
          fontSize: 15, fontWeight: 600, margin: 0, color: 'var(--text-primary)',
        }}>
          Updating to the newest version
        </h3>
      </div>

      <div style={{ padding: '14px 18px 6px' }}>
        <p id="pwa-update-desc" style={{
          fontSize: 13, lineHeight: 1.5, color: 'var(--text-mono)', margin: 0,
        }}>
          A new version of HypoExplorer is available. This tab will reload to
          keep the app and its data files up to date.
        </p>
        <p style={{
          fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)', margin: '8px 0 0',
        }}>
          {pending
            ? 'Reloading…'
            : `Reloading automatically in ${secondsLeft} second${secondsLeft === 1 ? '' : 's'}.`}
        </p>
      </div>

      <div style={{
        padding: '12px 18px 16px',
        display: 'flex', justifyContent: 'flex-end', gap: 8,
      }}>
        <button
          type="button"
          onClick={reloadNow}
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
          {pending ? 'Reloading…' : 'Reload now'}
        </button>
      </div>
    </ConfirmDialog>
  );
}
