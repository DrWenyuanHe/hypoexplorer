// Route-level code splitting for the app shell.
//
// App used to import every view statically, so the landing hub, which renders a
// search box, downloaded and parsed the whole application: every explorer tab,
// the library, the reports, recharts and both evidence ledgers (~7 MB of
// JavaScript, ~900 KB compressed) before its first paint. A view wrapped here
// becomes its own chunk, fetched the first time it renders or when something
// preloads it.
//
// What this adds to plain React.lazy:
// - React.lazy caches a rejected import forever, so a failed chunk download (a
//   dropped connection) stays failed even after the ErrorBoundary's "Reload this
//   tab". Here a rejected download is retried by a render that comes later
//   (see RETRY_AFTER_MS), such as that reset.
// - A view preloaded before its first render renders synchronously, without a
//   fallback frame. Tests that render App call `preload()` first and keep their
//   synchronous queries.
// - Each view carries its own Suspense boundary and fallback, so App needs no
//   boundary of its own and a loading tab never blanks the explorer around it.

import { Suspense, lazy, type ComponentType, type ReactNode } from 'react';
import { Spinner } from './Spinner';

export interface LazyView<P> {
  (props: P): ReactNode;
  /** Start (or join) the chunk download. Resolves to the loaded component. */
  preload(): Promise<ComponentType<P>>;
}

/** Full-area placeholder for a page or tab whose chunk is downloading. */
export function ViewLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div style={{ flex: 1, minHeight: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <Spinner size={18} label={label} />
    </div>
  );
}

/**
 * How long a failed download stays failed. Renders inside this window reuse the
 * rejected promise, so React's immediate re-render after an error rethrows it
 * to the ErrorBoundary instead of starting a new download (a chunk that always
 * fails would otherwise loop). A later render, such as the boundary's "Reload
 * this tab", downloads again.
 */
const RETRY_AFTER_MS = 1000;

export function lazyView<P extends object>(
  load: () => Promise<ComponentType<P>>,
  fallback: ReactNode = <ViewLoading />,
): LazyView<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  let failedAt: number | null = null;

  const preload = (): Promise<ComponentType<P>> => {
    if (loaded) return Promise.resolve(loaded);
    if (pending && failedAt !== null && Date.now() - failedAt >= RETRY_AFTER_MS) pending = null;
    if (!pending) {
      failedAt = null;
      pending = load().then(
        (component) => { loaded = component; return component; },
        (error: unknown) => { failedAt = Date.now(); throw error; },
      );
    }
    return pending;
  };

  const makeLazy = () => lazy(() => preload().then((component) => ({ default: component })));
  let Lazy = makeLazy();
  // Chosen once, at the first render of any instance, and never changed: a
  // view whose chunk is already here renders it directly (no Suspense frame);
  // otherwise every render goes through React.lazy, which renders synchronously
  // once resolved. Either way an instance's element type never changes, so a
  // view is never remounted (and never loses state) when its chunk lands.
  let direct: boolean | null = null;

  // biome-ignore lint/correctness/noComponentHookFactories: lazyView runs once per view at module scope (src/appViews.tsx), never during render, so each View is one stable component type, exactly like React.lazy's return value.
  const View = (props: P) => {
    if (direct === null) direct = loaded !== null;
    if (direct && loaded) { const Component = loaded; return <Component {...props} />; }
    // React.lazy keeps a rejection forever; a render after the retry window
    // (the ErrorBoundary's reset) gets a fresh lazy, whose init downloads again.
    if (failedAt !== null && Date.now() - failedAt >= RETRY_AFTER_MS) Lazy = makeLazy();
    return <Suspense fallback={fallback}><Lazy {...props} /></Suspense>;
  };
  View.preload = preload;
  return View;
}

/**
 * Warm a chunk without rendering it, on an idle moment after first paint.
 * Failures are swallowed: the view retries the download when it mounts.
 */
export function preloadWhenIdle(...views: Array<{ preload(): Promise<unknown> }>): () => void {
  if (typeof window === 'undefined') return () => {};
  const run = () => { for (const view of views) view.preload().catch(() => { /* retried on mount */ }); };
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(run, { timeout: 4000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(run, 1500);
  return () => window.clearTimeout(handle);
}
