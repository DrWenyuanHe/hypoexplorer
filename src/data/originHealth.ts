// Why a bundle failed: is the DATA ORIGIN reachable from this browser, or is
// this one file missing?
//
// The explorer serves its app shell from one host and its ~300 MB of data
// bundles from another (BUNDLE_BASE — the Cloudflare R2 custom domain in
// production). That split is invisible to a visitor: when the data origin is
// unreachable, every dataset fails to load while the site itself renders
// perfectly, which reads as "this website is broken" when it is nothing of the
// sort. Naming the real cause is the whole point of this module.
//
// It cannot be answered at the load site. Bundles are classic <script src>
// loads (no CORS required — see bundleSource.ts), and a <script> onerror fires
// identically for a 404, a DNS failure, a CSP block and a parse error. So the
// diagnosis is a SEPARATE probe, run only after something has already failed.
//
// The probe is `fetch(..., { mode: 'no-cors' })`, which needs no CORS headers
// on the bucket. The response is opaque — its status is unreadable — but that
// is fine, because the only bit needed is whether a response arrived at all:
//
//   * REJECTS  → nothing answered: DNS failure, connection refused, TLS
//                failure, the request blocked before it left the browser
//                (extension, corporate proxy, DNS filter), or the origin is
//                genuinely down. The data origin is unreachable.
//   * RESOLVES → the origin answered, even if that answer was a 404. So the
//                origin is fine and the specific file is the problem.
//
// A note on what this can and cannot blame. A TOTAL Cloudflare outage takes the
// app host down too (it is proxied through the same CDN), so the visitor would
// see no site at all rather than this banner. The failures that actually
// produce "site works, data doesn't" are: the R2 bucket or its custom domain
// specifically failing, a partial CDN incident, a deploy that never uploaded
// the bundles — and, most often in practice, the VISITOR'S OWN network
// blocking the data subdomain (school/corporate firewalls and DNS-level
// blockers routinely eat an unfamiliar second-party domain). This module
// therefore reports what it can actually prove — "your browser cannot reach
// our data origin" — and lists the likely causes, rather than asserting an
// outage it has no standing to diagnose from inside one browser tab.

import { BUNDLE_BASE } from './bundleBase';

export type OriginStatus =
  /** navigator says there is no network at all. */
  | 'offline'
  /** Nothing answered at the data origin. */
  | 'origin-unreachable'
  /** The origin answered; a specific file is missing or malformed. */
  | 'origin-reachable'
  /** Bundles ship from the app's own origin, so a fetch proves nothing new. */
  | 'same-origin'
  /** No way to tell (no fetch, probe raced a teardown). */
  | 'unknown';

export interface OriginDiagnosis {
  status: OriginStatus;
  /** The data origin as configured, or '' for a same-origin deploy. */
  origin: string;
}

/**
 * A small, always-present object on the data origin.
 *
 * The query manifest is the right probe target: it is the one file guaranteed
 * to exist for every deploy that has any data at all (every dataset bundle
 * path, by contrast, depends on which datasets are registered). It carries a
 * short max-age rather than the year-long immutable of the bundles, so a probe
 * is never answered out of a stale year-old cache entry — and `cache: 'no-store'`
 * below stops even that one from being served from the local cache.
 */
const PROBE_PATH = '/query/tracks.js';

/** How long a verdict stands before another failure re-probes. */
const TTL_MS = 30_000;

let cached: { at: number; diagnosis: OriginDiagnosis } | null = null;
let inFlight: Promise<OriginDiagnosis> | null = null;

/** Test seam: drop the memoized verdict. */
export function _resetOriginHealth(): void {
  cached = null;
  inFlight = null;
}

function now(): number {
  return Date.now();
}

async function probe(origin: string): Promise<OriginDiagnosis> {
  // Offline is checked first and separately: it is the one cause the browser
  // states outright, and "you are offline" is a far more useful sentence than
  // "our data origin is unreachable" when the visitor's wifi dropped.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { status: 'offline', origin };
  }
  if (typeof fetch !== 'function') return { status: 'unknown', origin };

  try {
    // no-cors: the bucket sends no CORS headers and needs none. The opaque
    // response is unreadable and that is fine — arrival is the signal.
    // no-store: never let a cached hit answer a reachability question.
    await fetch(`${origin}${PROBE_PATH}`, { mode: 'no-cors', cache: 'no-store', credentials: 'omit' });
    return { status: 'origin-reachable', origin };
  } catch {
    // Re-check offline: a network can drop between the check above and here,
    // and "offline" outranks "unreachable" as an explanation.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { status: 'offline', origin };
    }
    return { status: 'origin-unreachable', origin };
  }
}

/**
 * Diagnose the data origin. Memoized for TTL_MS and deduped while in flight, so
 * a burst of failing bundles (the cross-dataset query fans out over 118 tracks)
 * costs ONE probe rather than one per failure.
 *
 * Never rejects: a diagnosis that throws would replace a real error message
 * with a worse one.
 */
export function diagnoseDataOrigin(): Promise<OriginDiagnosis> {
  const origin = BUNDLE_BASE;
  // Same-origin deploy: the app shell just loaded from this very host, so it is
  // reachable by construction and a probe would only restate that.
  if (!origin) return Promise.resolve({ status: 'same-origin', origin: '' });

  if (cached && now() - cached.at < TTL_MS) return Promise.resolve(cached.diagnosis);
  if (inFlight) return inFlight;

  inFlight = probe(origin)
    .catch((): OriginDiagnosis => ({ status: 'unknown', origin }))
    .then((diagnosis) => {
      cached = { at: now(), diagnosis };
      inFlight = null;
      return diagnosis;
    });
  return inFlight;
}

/**
 * The visitor-facing explanation for a diagnosis, or null when there is nothing
 * useful to add beyond the error already on screen.
 *
 * Written for a reader who does not know the site has two origins, and phrased
 * so it never claims more than the probe proves.
 */
export function explainOrigin(diagnosis: OriginDiagnosis | null): string | null {
  if (!diagnosis) return null;
  switch (diagnosis.status) {
    case 'offline':
      return 'Your device appears to be offline. The site is loaded, but the data files cannot be '
        + 'downloaded until the connection is back.';
    case 'origin-unreachable':
      return `Your browser cannot reach ${diagnosis.origin}, where the datasets are stored. `
        + 'The data server may be unavailable, or your network may be blocking the address. '
        + 'Check your connection and try again. You can also check the provider status page.';
    case 'origin-reachable':
      return 'The data server responded, but this file could not be loaded. Try again. '
        + 'If the problem continues, the file may be missing or temporarily unavailable.';
    default:
      return null;
  }
}

/** Whether a diagnosis warrants pointing the visitor at the CDN status page. */
export function shouldLinkStatusPage(diagnosis: OriginDiagnosis | null): boolean {
  return diagnosis?.status === 'origin-unreachable';
}

export const CLOUDFLARE_STATUS_URL = 'https://www.cloudflarestatus.com/';
