// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { forceRefresh } from '../pwa/forceRefresh';

// forceRefresh is the manual escape hatch: unregister every SW, delete every
// Cache Storage entry, then reload. jsdom ships neither a real serviceWorker nor
// caches, and its location.reload throws "Not implemented" — so we stub all three.

describe('forceRefresh — manual cache reset', () => {
  let unregister: any, cacheDelete: any, reload: any, origSWDesc: any, origCaches: any, origLocationDesc: any;

  beforeEach(() => {
    unregister = vi.fn().mockResolvedValue(true);
    cacheDelete = vi.fn().mockResolvedValue(true);
    reload = vi.fn();

    origSWDesc = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistrations: vi.fn().mockResolvedValue([{ unregister }, { unregister }]),
      },
    });

    origCaches = globalThis.caches;
    (globalThis as any).caches = {
      keys: vi.fn().mockResolvedValue(['workbox-precache-v2', 'other']),
      delete: cacheDelete,
    };

    origLocationDesc = Object.getOwnPropertyDescriptor(window, 'location');
    Object.defineProperty(window, 'location', { configurable: true, value: { reload } });
  });

  afterEach(() => {
    if (origSWDesc) Object.defineProperty(navigator, 'serviceWorker', origSWDesc);
    else delete (navigator as any).serviceWorker;
    (globalThis as any).caches = origCaches;
    if (origLocationDesc) Object.defineProperty(window, 'location', origLocationDesc);
  });

  it('unregisters every SW, deletes every cache, then reloads', async () => {
    await forceRefresh();
    expect(unregister).toHaveBeenCalledTimes(2);
    expect(cacheDelete).toHaveBeenCalledWith('workbox-precache-v2');
    expect(cacheDelete).toHaveBeenCalledWith('other');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('preserves the dataset bundle cache (hundreds of MB) while clearing the shell', async () => {
    (globalThis as any).caches.keys = vi
      .fn()
      .mockResolvedValue(['workbox-precache-v2', 'hypoexplorer-data-bundles', 'other']);
    await forceRefresh();
    expect(cacheDelete).toHaveBeenCalledWith('workbox-precache-v2');
    expect(cacheDelete).toHaveBeenCalledWith('other');
    // The data cache can never serve a stale entry for a URL the new build asks
    // for (URLs are versioned), so clearing it would cost a full re-download and
    // fix nothing.
    expect(cacheDelete).not.toHaveBeenCalledWith('hypoexplorer-data-bundles');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('still reloads even if the SW API throws (private mode / blocked)', async () => {
    (navigator.serviceWorker.getRegistrations as any).mockRejectedValue(new Error('blocked'));
    await forceRefresh();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // try/catch only covers a promise that REJECTS. One that never settles would
  // leave the finally unreached — and this is the fallback the update handover
  // relies on, so a hang here is a spinner the user cannot leave. The cleanup is
  // best-effort; the reload is not.
  it('still reloads if the cleanup never settles', async () => {
    vi.useFakeTimers();
    try {
      (navigator.serviceWorker.getRegistrations as any).mockReturnValue(new Promise(() => {}));
      const done = forceRefresh();
      expect(reload).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5_000);
      await done;
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
