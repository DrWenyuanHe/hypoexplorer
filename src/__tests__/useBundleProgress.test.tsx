import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBundleProgress, useBundleBytes } from '../data/useBundleProgress';
import {
  loadRequiredBundle,
  _setBundleTransport,
  _resetBundleCache,
  type BundleOutcome,
  type BundleReporter,
} from '../data/bundleSource';

// The two reductions the loading UI reads. Driven through real loads rather than
// by pushing synthetic events, because the properties worth pinning are about
// how the stream and the hooks meet: which URL a component sees, and what a
// counter does when a burst starts mid-load.

/** A transport whose bytes are released by hand, so a load can be observed mid-flight. */
function manualTransport() {
  const pending = new Map<string, { report: BundleReporter; finish: (o: BundleOutcome) => void }>();
  const transport = (url: string, _key: string, report: BundleReporter) =>
    new Promise<BundleOutcome>((resolve) => { pending.set(url, { report, finish: resolve }); });
  return {
    transport,
    send: (url: string, loaded: number, total: number | null) =>
      act(() => { pending.get(url)?.report({ loaded, total }); }),
    done: (url: string, value: unknown = { ok: true }) =>
      act(async () => {
        pending.get(url)?.finish({ status: 'ok', value });
        // A macrotask, not a microtask: the seam settles through several `then`
        // hops before the done tick reaches the hook.
        await new Promise((resolve) => { setTimeout(resolve, 0); });
      }),
  };
}

beforeEach(() => { _resetBundleCache(); });
afterEach(() => { _setBundleTransport(null); _resetBundleCache(); });

describe('useBundleProgress', () => {
  it('follows its own url and ignores every other load', async () => {
    const t = manualTransport();
    _setBundleTransport(t.transport);
    const { result } = renderHook(() => useBundleProgress('/mine.js'));

    void loadRequiredBundle('/mine.js', 'G_MINE');
    void loadRequiredBundle('/theirs.js', 'G_THEIRS');

    await t.send('/theirs.js', 999, 999);
    expect(result.current?.loaded).toBe(0);

    await t.send('/mine.js', 512, 2048);
    expect(result.current).toEqual({ loaded: 512, total: 2048 });
  });

  it('reports null for no url, so a component can call it unconditionally', () => {
    const { result } = renderHook(() => useBundleProgress(null));
    expect(result.current).toBeNull();
  });

  it('clears when the url it follows changes', async () => {
    const t = manualTransport();
    _setBundleTransport(t.transport);
    const { result, rerender } = renderHook(({ url }) => useBundleProgress(url), {
      initialProps: { url: '/a.js' as string | null },
    });
    void loadRequiredBundle('/a.js', 'G_A');
    await t.send('/a.js', 100, 400);
    expect(result.current?.loaded).toBe(100);

    // Switching tracks must not leave the previous track's bytes on screen.
    rerender({ url: '/b.js' });
    expect(result.current).toEqual({ loaded: 0, total: null });
  });
});

describe('useBundleBytes', () => {
  it('sums across concurrent loads and keeps a finished one counted', async () => {
    const t = manualTransport();
    _setBundleTransport(t.transport);
    const { result } = renderHook(() => useBundleBytes(true));

    void loadRequiredBundle('/one.js', 'G_ONE');
    void loadRequiredBundle('/two.js', 'G_TWO');
    await t.send('/one.js', 1000, null);
    await t.send('/two.js', 250, null);
    expect(result.current).toBe(1250);

    // A completed load stays in the total; the other keeps climbing.
    await t.done('/one.js');
    await t.send('/two.js', 750, null);
    await waitFor(() => expect(result.current).toBe(1750));
  });

  it('starts at zero, then counts an already-in-flight load in full', async () => {
    // Zero on activation, because a new query must report ITS download and not
    // the previous one's. But a load that started a tick earlier still belongs
    // to this query — the report's planning request routinely beats the state
    // change that activates the counter — so it is counted whole, not from here
    // on, the moment it next reports.
    const t = manualTransport();
    _setBundleTransport(t.transport);
    void loadRequiredBundle('/early.js', 'G_EARLY');
    await t.send('/early.js', 4000, null);

    const { result } = renderHook(() => useBundleBytes(true));
    expect(result.current).toBe(0);

    await t.send('/early.js', 5000, null);
    expect(result.current).toBe(5000);
  });

  it('is zero while inactive', () => {
    const { result } = renderHook(() => useBundleBytes(false));
    expect(result.current).toBe(0);
  });
});
