// Fallback detector for "this tab is running an old build".
//
// The service-worker path (registerUpdates.ts) is the primary one, but it
// cannot cover two real cases:
//   - a service worker never registers at all — blocked by enterprise policy or
//     an extension, disabled in private mode, or a non-secure context. Nothing
//     ever fires onNeedRefresh, so nothing ever offers the update.
//   - the installed worker is itself wedged: it keeps serving a precached
//     index.html from an OLD deploy, so the tab runs old code and the reload
//     prompt the new build ships never even gets a chance to run.
// Both leave a session pinned to a build that is no longer deployed, which is
// not cosmetic here: data URLs carry ?v=<app version> and /datasets/** is cached
// immutable for a year on that basis, so an old bundle asks for files this
// deploy has moved or replaced and track loads start failing.
//
// So the app ALSO polls a tiny version stamp emitted by the build
// (dist/version.json — see emitVersionManifest() in vite.config.ts) and compares
// it with the version compiled into this bundle. A mismatch arms the same
// mandatory prompt <UpdateModal> shows for a waiting service worker, with
// forceRefresh() as the apply fn rather than SKIP_WAITING: by definition this
// path only fires when the service-worker path did not, so the remedy has to be
// the heavy one — unregister the worker, drop the shell caches, reload.

import { forceRefresh } from './forceRefresh';
import { getSnapshot, markUpdateAvailable } from './updateStore';
import { RELEASE_IDENTITY } from '../data/releaseIdentity';

// The version this bundle was built from (Vite `define`). Guarded so the module
// never throws where the define was not applied.
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

// Emitted into the site root by the build, alongside index.html. App-relative on
// purpose: this stamp describes the APP shell, which is served from this origin
// even when the data bundles live on R2.
const VERSION_URL = '/version.json';

// How long after startup the first check runs. Late enough to stay off the
// first-paint path, early enough that a wedged tab is corrected in the first few
// seconds rather than a quarter of an hour in.
const FIRST_CHECK_DELAY_MS = 5_000;

// Poll cadence for a tab left open, and the floor between any two checks (so
// flicking back and forth between tabs cannot hammer the origin).
const POLL_INTERVAL_MS = 15 * 60 * 1000;
const MIN_CHECK_GAP_MS = 60 * 1000;

// Loop guard. A forced refresh that does NOT change the running version would
// otherwise repeat forever — the failure mode of a half-finished upload (new
// version.json, old index.html) or an edge still holding the previous shell.
// Two attempts per target version per tab session, then give up loudly and let
// the user keep working on the old build rather than reload-looping them.
const ATTEMPT_KEY = 'hypoexplorer:update-attempts';
const MAX_ATTEMPTS = 2;

function attemptsFor(target: string): number {
  try {
    const raw = sessionStorage.getItem(ATTEMPT_KEY);
    if (!raw) return 0;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return 0;
    const { target: seen, count } = parsed as { target?: unknown; count?: unknown };
    return seen === target && typeof count === 'number' ? count : 0;
  } catch {
    // Absent, unreadable (storage blocked), or corrupt — treat as "no attempts".
    return 0;
  }
}

function recordAttempt(target: string, attempts: number): void {
  try {
    sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify({ target, count: attempts + 1 }));
  } catch {
    // Storage blocked: the guard degrades to "no memory across reloads". The
    // check below still runs; it just cannot count attempts, and the update is
    // more valuable than the guard.
  }
}

// Reads the deployed version stamp. Returns null for anything that is not a
// usable answer (offline, 404, HTML error page, malformed JSON) — an unknown
// deployed version must never be treated as "you are out of date".
async function fetchDeployedVersion(): Promise<string | null> {
  try {
    // no-store plus a cache-busting param: this file exists to report what the
    // ORIGIN currently serves, and a cached copy would report the old version
    // for exactly as long as the problem it is meant to detect persists.
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (typeof data !== 'object' || data === null) return null;
    const { version, releaseId } = data as { version?: unknown; releaseId?: unknown };
    if (typeof version !== 'string' || !version.length) return null;
    // Older deployments have only a version. New stamps also distinguish two
    // source/data snapshots that accidentally share a package version.
    if (typeof releaseId === 'string' && /^[a-f0-9]{64}$/.test(releaseId)
      && releaseId !== RELEASE_IDENTITY.releaseId) return `${version}@${releaseId}`;
    return version;
  } catch {
    return null;
  }
}

// One comparison. Arms the mandatory prompt when the origin is serving a
// different version than this tab is running.
export async function checkForNewerDeploy(): Promise<void> {
  // The service-worker path already found it and stored the cheaper apply fn
  // (SKIP_WAITING). Do not overwrite it with the full cache reset.
  if (getSnapshot() > 0) return;

  const deployed = await fetchDeployedVersion();
  if (deployed === null || deployed === APP_VERSION) return;

  const attempts = attemptsFor(deployed);
  if (attempts >= MAX_ATTEMPTS) {
    console.warn(
      `[pwa] still running v${APP_VERSION} after ${attempts} refresh attempts at v${deployed} — ` +
        'giving up to avoid a reload loop. The origin is probably serving a stale app shell.',
    );
    return;
  }
  recordAttempt(deployed, attempts);

  markUpdateAvailable(async () => {
    await forceRefresh();
  });
}

// Starts the poll. Called once at bootstrap (main.tsx), fire-and-forget.
export function startVersionWatch(): void {
  // Dev has no version.json (it is emitted by `vite build`), and a dev server
  // must never force-reload the page out from under HMR.
  if (import.meta.env.DEV) return;
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return;

  let lastCheck = 0;
  const check = () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const now = Date.now();
    if (now - lastCheck < MIN_CHECK_GAP_MS) return;
    lastCheck = now;
    void checkForNewerDeploy();
  };

  setTimeout(check, FIRST_CHECK_DELAY_MS);
  setInterval(check, POLL_INTERVAL_MS);
  // A tab the user comes back to after a week should not wait out the interval.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.addEventListener('online', check);
}
