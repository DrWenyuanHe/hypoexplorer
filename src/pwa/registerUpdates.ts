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

import { markUpdateAvailable } from './updateStore';

// How often a long-open tab asks the origin whether a newer worker exists.
const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;
// Floor between two checks, so flicking between tabs cannot hammer the origin.
const MIN_CHECK_GAP_MS = 60 * 1000;

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
        markUpdateAvailable(updateSW);
      },
      onRegistered(registration) {
        if (registration) watchForNewWorker(registration);
      },
      onRegisterError(error) {
        console.error('[pwa] service worker registration failed:', error);
      },
    });
  } catch (error) {
    // virtual:pwa-register unavailable (e.g. plugin disabled) or import blocked.
    // The version-stamp watcher (versionWatch.ts) is the remaining safety net.
    console.error('[pwa] update registration skipped:', error);
  }
}
