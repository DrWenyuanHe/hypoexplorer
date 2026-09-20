// Service-worker registration for the mandatory update flow.
//
// Called once at bootstrap (main.tsx), fire-and-forget. It dynamically imports
// vite-plugin-pwa's virtual module and wires registerSW so that when a newly
// deployed SW parks itself in "waiting", we surface <UpdateModal> instead of
// reloading behind the user's back. registerType stays "prompt" precisely so the
// APP owns the moment of activation: the modal announces the reload, counts
// down, and then applies it — mandatory, but never a silent surprise.
//
// A registration alone would only ever notice a new deploy on a navigation (or
// on the browser's own ~24h check), so a tab left open for a week keeps running
// an old build with no prompt at all. watchForNewWorker() below closes that gap;
// versionWatch.ts covers the case where no service worker is in play.
//
// No-ops — without touching the network or throwing — in environments where a
// service worker can't or shouldn't run:
//   - dev (the SW isn't built; the virtual module is a dev stub)
//   - browsers without navigator.serviceWorker
//   - non-secure contexts (SW requires HTTPS; localhost counts as secure)
// The dynamic import is wrapped in try/catch so a missing/blocked virtual
// module can never break app startup.

import { forceRefresh } from './forceRefresh';
import { markUpdateAvailable } from './updateStore';
import { checkForNewerDeploy } from './versionWatch';

// How often a long-open tab asks the origin whether a newer worker exists.
const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;
// Floor between two checks, so flicking between tabs cannot hammer the origin.
const MIN_CHECK_GAP_MS = 60 * 1000;

// How long the SKIP_WAITING handover gets to produce a new controller before we
// stop waiting on it and reload the heavy way instead. See applyWaitingWorker().
// Long enough to cover a slow activate (cleanupOutdatedCaches deletes the
// previous precache), short enough that nobody watches a dead spinner.
const HANDOVER_TIMEOUT_MS = 8_000;

// The live registration, captured from onRegistered. Read at apply time to see
// whether a worker is actually parked in "waiting" — vite-plugin-pwa's updateSW
// is a SILENT no-op when it isn't (workbox-window's messageSkipWaiting only
// posts SKIP_WAITING `if (registration.waiting)`), and a silent no-op is exactly
// what leaves the modal spinning.
let swRegistration: ServiceWorkerRegistration | null = null;

// Ask the browser to re-fetch sw.js: on a timer, when the tab is brought back to
// the foreground, and when the network returns. A newer worker installs and
// parks in "waiting", which fires onNeedRefresh below exactly as a fresh page
// load would.
function watchForNewWorker(registration: ServiceWorkerRegistration): void {
  let lastCheck = Date.now(); // registration itself just checked
  const check = () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const now = Date.now();
    if (now - lastCheck < MIN_CHECK_GAP_MS) return;
    lastCheck = now;
    // Rejects offline or on an origin blip; the next tick tries again.
    registration.update().catch(() => {});
  };

  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.addEventListener('online', check);
}

// What <UpdateModal> actually runs when the user accepts (or the countdown runs
// out). Wraps vite-plugin-pwa's updateSW because that function alone cannot be
// relied on to reload this tab, and when it fails it fails SILENTLY:
//
//   1. It reloads from workbox-window's `controlling` event, but only when
//      `event.isUpdate` — and isUpdate is `Boolean(navigator.serviceWorker
//      .controller)` sampled at register() time. A tab that loaded UNCONTROLLED
//      is therefore never reloaded by it. Uncontrolled-but-updatable is not
//      exotic: a hard reload (Ctrl+Shift+R) bypasses the worker for that load,
//      and a first-ever visit is not claimed by the worker it installs. Either
//      of those, with a second controlled tab holding the old worker in place so
//      the new one parks in "waiting" rather than activating, gives a prompt on
//      a page that cannot act on it.
//   2. updateSW does nothing at all if no worker is in "waiting" — another tab
//      accepted the same update first, or the last CONTROLLED tab closed and the
//      waiting worker activated on its own, leaving this uncontrolled tab
//      prompting for a handover that has already happened.
//
// So: listen for the handover ourselves (ungated), and treat "no handover" as a
// failure with a remedy rather than a state to sit in. forceRefresh() is the
// remedy — it always ends in a reload, so this cannot hang either way.
export async function applyWaitingWorker(
  updateSW: (reloadPage?: boolean) => Promise<void>,
  registration: ServiceWorkerRegistration | null,
): Promise<void> {
  let handled = false;
  const finish = (recover: boolean) => {
    if (handled) return;
    handled = true;
    // Either branch navigates; the modal's spinner covers the gap.
    if (recover) void forceRefresh();
    else window.location.reload();
  };

  // The real success signal, and deliberately NOT gated on workbox's isUpdate:
  // a new worker taking control of this page is the whole point, whether or not
  // one was controlling it when this tab started.
  navigator.serviceWorker.addEventListener('controllerchange', () => finish(false), { once: true });

  // Nothing parked in "waiting" means SKIP_WAITING has no recipient, so no
  // controller change is coming. Don't spend the timeout discovering that.
  if (registration && !registration.waiting && !registration.installing) {
    finish(true);
    return;
  }

  const watchdog = setTimeout(() => finish(true), HANDOVER_TIMEOUT_MS);
  try {
    await updateSW(true);
  } catch {
    // The handover failed outright — no need to wait out the watchdog for it.
    clearTimeout(watchdog);
    finish(true);
  }
}

// clientsClaim (see vite.config.ts) lets a newly activated worker take control of
// tabs that never asked for the update — the tab where the user accepted it is
// handled above, but a SECOND uncontrolled tab is claimed silently while still
// running the old bundle. Updating is mandatory here precisely because an old
// bundle requests data paths the current deploy may have moved, so those tabs
// must be brought along too rather than left running superseded code.
//
// checkForNewerDeploy() is the right responder because it decides on evidence
// rather than on the event: it compares /version.json with this bundle's version
// and arms the prompt only on a real mismatch. That distinguishes the case this
// exists for from the ordinary first visit, where the very first worker claims
// the page and the deployed version is the one already running.
export function watchForSilentTakeover(): void {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // No-ops when an update is already armed in this tab, so it cannot cut
    // across a handover this tab started.
    void checkForNewerDeploy();
  });
}

export async function registerUpdates(): Promise<void> {
  // Dev: the production SW isn't generated, so there's nothing to register.
  if (import.meta.env.DEV) return;

  // Browser support / security guards. Service workers require a secure context
  // (HTTPS or localhost) and the serviceWorker API.
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (typeof window !== 'undefined' && window.isSecureContext === false) return;

  try {
    const { registerSW } = await import('virtual:pwa-register');
    const updateSW = registerSW({
      immediate: true,
      // A new SW finished installing and is waiting. Hand the reload fn to the
      // store; the modal opens and applies it (automatically, on a countdown).
      onNeedRefresh() {
        markUpdateAvailable(() => applyWaitingWorker(updateSW, swRegistration));
      },
      onRegistered(registration) {
        if (registration) {
          swRegistration = registration;
          watchForNewWorker(registration);
        }
      },
      onRegisterError(error) {
        console.error('[pwa] service worker registration failed:', error);
      },
    });
    watchForSilentTakeover();
  } catch (error) {
    // virtual:pwa-register unavailable (e.g. plugin disabled) or import blocked.
    // The version-stamp watcher (versionWatch.ts) is the remaining safety net.
    console.error('[pwa] update registration skipped:', error);
  }
}
