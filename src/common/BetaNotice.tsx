import { useState } from 'react';
import { BETA_NOTICE } from '../data/siteInfo';
import './BetaNotice.css';

const DISMISS_KEY = 'hx:beta-notice-dismissed';

function readDismissed(): boolean {
  try { return window.sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}

/** Shared, readable release status across every public app header.
 *
 * `compact` is the explorer shell's variant: a single slim line the reader can
 * dismiss for the rest of the browser session, because there the notice sits
 * above the data on every view. Every other header keeps the full notice. */
export function BetaNotice({ compact = false }: { compact?: boolean }) {
  const [dismissed, setDismissed] = useState(() => compact && readDismissed());
  if (dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try { window.sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* storage unavailable: hide for this render only */ }
  };
  return (
    <div className={compact ? 'beta-notice beta-notice--compact' : 'beta-notice'}>
      <p>{BETA_NOTICE}</p>
      <a href="/about/">About &amp; feedback</a>
      {compact && (
        <button type="button" className="beta-notice-dismiss" onClick={dismiss}
          aria-label="Dismiss beta notice" title="Hide for this session">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
            strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      )}
    </div>
  );
}
