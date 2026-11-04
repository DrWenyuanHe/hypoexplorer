// Dependency-free external store for the "new version available → reload" flow.
//
// The service-worker registration helper (registerUpdates.ts) lives outside
// React and fires `onNeedRefresh` whenever vite-plugin-pwa parks a freshly
// built SW in the "waiting" state. It can't call a hook, so it pushes into this
// store instead; <UpdateModal> subscribes via useSyncExternalStore and reacts.
//
// Shape:
//   - signal: a monotonic counter. 0 = no update seen. Each new waiting SW
//     bumps it. The modal keys its "already dismissed" check off this number,
//     so a second deploy while the tab is still open re-opens the prompt.
//   - updateFn: the reload function returned by registerSW(). Calling it with
//     `true` triggers SKIP_WAITING in the waiting SW and reloads the page once
//     the new SW takes control.

type Listener = () => void;
type UpdateFn = (reloadPage?: boolean) => Promise<void>;

let signal = 0;
let updateFn: UpdateFn | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

// useSyncExternalStore contract: register a listener, return an unsubscribe fn.
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Returns a primitive (number), so Object.is comparison is stable between
// renders when nothing changed — no extra memoization needed.
export function getSnapshot(): number {
  return signal;
}

// Called by the SW registration's onNeedRefresh. Stores the reload fn and bumps
// the signal so subscribers re-render and open the prompt.
export function markUpdateAvailable(fn: UpdateFn): void {
  updateFn = fn;
  signal += 1;
  emit();
}

// Called when the user clicks "Reload". `updateFn(true)` does SKIP_WAITING +
// reload. Guarded so a stray call before any update is a no-op.
export function applyUpdate(): void {
  if (typeof updateFn === 'function') updateFn(true);
}

// Test-only: reset module state between tests.
export function _resetUpdateStore(): void {
  signal = 0;
  updateFn = null;
  listeners.clear();
}
