import { useEffect, useState } from 'react';
import { BUNDLE_BASE } from '../data/bundleBase';
import {
  CLOUDFLARE_STATUS_URL,
  diagnoseDataOrigin,
  explainOrigin,
  shouldLinkStatusPage,
  type OriginDiagnosis,
} from '../data/originHealth';

// A standing light for the DATA origin, on the landing hub.
//
// The site is two hosts: this app shell, and the ~300 MB of bundles behind
// BUNDLE_BASE (the Cloudflare R2 custom domain). The split is invisible until it
// breaks, and then it breaks in the most confusing way available — the site
// renders perfectly and every dataset fails to load. originHealth.ts already
// diagnoses that, but only reactively, once a load has failed. This says it up
// front, before the visitor has picked a study and blamed the site for it.
//
// It reuses the same probe rather than inventing a second definition of
// "healthy": one no-cors request to the query manifest, memoized for 30 s in
// originHealth, so the light and any error banner always agree.
//
// What it is NOT allowed to claim: that Cloudflare is down. A failed probe from
// one browser proves the visitor cannot reach the data origin — which is just as
// often a corporate/school network eating an unfamiliar subdomain as it is an
// outage (see the long note in originHealth.ts). So the red state reports
// reachability, and offers the CDN status page as the next thing to check
// instead of asserting an answer.
//
// Renders NOTHING on a same-origin deploy (BUNDLE_BASE empty, which is also dev
// and test): the app shell just loaded from that host, so the light could only
// ever be green, and a light that cannot go red is decoration.

/** How often a tab left open re-probes. Well over originHealth's 30 s memo, so
 *  each tick is a real request; rare enough that an idle tab costs ~11 KB per
 *  five minutes rather than per minute. Waking the tab or regaining the network
 *  re-probes immediately, which is when the answer actually changes. */
const RECHECK_MS = 5 * 60 * 1000;

interface Presentation {
  /** Modifier class carrying the hue. */
  tone: 'ok' | 'down' | 'warn' | 'idle';
  /** The state IN WORDS — never color alone (DESIGN.md). */
  label: string;
  title: string;
}

function present(diagnosis: OriginDiagnosis | null): Presentation | null {
  if (diagnosis === null) {
    return { tone: 'idle', label: 'Checking data', title: `Checking whether ${BUNDLE_BASE} is responding…` };
  }
  switch (diagnosis.status) {
    case 'origin-reachable':
      // Deliberately not explainOrigin(): that copy exists to explain a FAILED
      // file against a healthy origin, and reads as an apology here.
      return {
        tone: 'ok',
        label: 'Data online',
        title: `${diagnosis.origin} is responding. Dataset downloads should work normally.`,
      };
    case 'origin-unreachable':
      return {
        tone: 'down',
        label: 'Data unreachable',
        title: explainOrigin(diagnosis) ?? '',
      };
    case 'offline':
      return { tone: 'warn', label: 'You are offline', title: explainOrigin(diagnosis) ?? '' };
    default:
      // 'unknown' (no fetch, or a probe that raced a teardown) and 'same-origin'
      // have nothing to report. Better a missing light than a wrong one.
      return null;
  }
}

export function DataOriginStatus() {
  const [diagnosis, setDiagnosis] = useState<OriginDiagnosis | null>(null);

  useEffect(() => {
    if (!BUNDLE_BASE) return;
    let live = true;
    const run = () => {
      // diagnoseDataOrigin never rejects; a late resolve after unmount is dropped.
      diagnoseDataOrigin().then((d) => {
        if (live) setDiagnosis(d);
      });
    };
    run();

    const id = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') run();
    }, RECHECK_MS);
    const onWake = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('online', onWake);
    window.addEventListener('offline', run);

    return () => {
      live = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', onWake);
      window.removeEventListener('offline', run);
    };
  }, []);

  if (!BUNDLE_BASE) return null;
  const view = present(diagnosis);
  if (view === null) return null;

  // role=status: a light that flips while the page is open should be announced,
  // politely, without stealing focus.
  return (
    <span className={`hub-origin ${view.tone}`} role="status" title={view.title}>
      <span className="sdot" />
      {shouldLinkStatusPage(diagnosis) ? (
        <a href={CLOUDFLARE_STATUS_URL} target="_blank" rel="noreferrer">
          {view.label}
        </a>
      ) : (
        view.label
      )}
    </span>
  );
}
