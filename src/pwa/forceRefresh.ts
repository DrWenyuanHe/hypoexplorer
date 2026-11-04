// Manual cache-reset escape hatch.
//
// When a service worker from a *previous* build is still controlling the page,
// it serves the old cached app shell. Because we register with type "prompt"
// (see vite.config.ts / registerUpdates.ts), the new SW parks in "waiting" and
// never activates until the user accepts the UpdateModal. A user who misses or
// dismisses that prompt keeps running the old bundle — and the old bundle can
// request data at paths the current deploy has moved or deleted (e.g. the
// v0.4→v0.5 restructure relocated /pop_<id>.js → /datasets/<ds>/track_<id>.js).
// Tracks the browser hadn't already HTTP-cached then 404, surfacing as
// "Failed to load <track> data."
//
// This helper is the always-available manual remedy the automatic prompt can't
// cover: it unregisters every SW for this origin, deletes the app-shell caches,
// then reloads from the network with no SW controlling the next load.
// Distinct from applyUpdate() (updateStore.ts), which only works when the
// browser has already detected a new waiting SW.

// The one cache this deliberately PRESERVES (matches options.cacheName on the
// dataset runtimeCaching rule in vite.config.ts).
//
// Everything this escape hatch exists to fix is app-shell staleness: an old SW
// serving an old index.html/JS bundle that requests data paths the current
// deploy has moved. The data cache cannot cause that. It is keyed by fully
// versioned URLs, so a moved or renamed bundle is simply a cache MISS that falls
// through to the network — a stale entry is never served for a URL the new build
// asks for; it just sits there until it ages out or is evicted.
//
// Meanwhile the cost of clearing it is real and large: the cache holds up to 60
// dataset bundles at 1–10 MB each, so a reflexive click on the version badge
// (which is always on screen) would silently throw away a few hundred MB and
// make the user re-download all of it. Keep it.
//
// 'hypoexplorer-query-manifest' and 'hypoexplorer-query-index' are deliberately
// NOT preserved. The manifest is the pointer to the current index build and is
// cheap (11 KB) to refetch. The shard cache is nominally immutable (URLs carry
// the build id, which now digests the data values), but it is exactly the cache
// that served stale numbers when a data-only reprocess reproduced a build id —
// so the unstick button clears it as a belt-and-braces escape hatch. The cost
// is small: a session re-fetches only the shards it actually queries, at
// ~40–140 KB each.
const PRESERVED_CACHES = new Set(['hypoexplorer-data-bundles']);

export async function forceRefresh(): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !PRESERVED_CACHES.has(k)).map((k) => caches.delete(k)),
      );
    }
  } catch {
    // Best-effort: private mode or a blocked SW/Cache API can throw. Fall
    // through to the reload regardless so the user is never left stuck.
  } finally {
    if (typeof window !== 'undefined' && window.location) window.location.reload();
  }
}
