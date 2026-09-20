import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../pwa/forceRefresh', () => ({
  forceRefresh: vi.fn().mockResolvedValue(undefined),
}));

import { forceRefresh } from '../pwa/forceRefresh';
import { applyWaitingWorker, watchForSilentTakeover } from '../pwa/registerUpdates';
import { _resetUpdateStore, getSnapshot, markUpdateAvailable } from '../pwa/updateStore';

// What <UpdateModal> runs when the user accepts a service-worker update.
//
// The bug these pin: vite-plugin-pwa's updateSW can fail to reload the tab
// WITHOUT failing — it only reloads from workbox's `controlling` event when
// `isUpdate` (i.e. a worker was already controlling at register() time), and
// it posts nothing at all when no worker is parked in "waiting". Either way the
// caller is left awaiting a navigation that is never coming, and the modal is
// mandatory, so the user cannot leave it. Every path below must end in exactly
// one of: reload, or forceRefresh (which reloads for itself).

describe('applyWaitingWorker — the SKIP_WAITING handover', () => {
  let reload: any, listeners: Record<string, () => void>, origSWDesc: any, origLocationDesc: any;

  const waiting = () => ({ waiting: {}, installing: null }) as unknown as ServiceWorkerRegistration;
  const nothingWaiting = () =>
    ({ waiting: null, installing: null }) as unknown as ServiceWorkerRegistration;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(forceRefresh).mockClear();
    reload = vi.fn();
    listeners = {};

    origSWDesc = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        addEventListener: (type: string, fn: () => void) => {
          listeners[type] = fn;
        },
      },
    });

    origLocationDesc = Object.getOwnPropertyDescriptor(window, 'location');
    Object.defineProperty(window, 'location', { configurable: true, value: { reload } });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (origSWDesc) Object.defineProperty(navigator, 'serviceWorker', origSWDesc);
    else delete (navigator as any).serviceWorker;
    if (origLocationDesc) Object.defineProperty(window, 'location', origLocationDesc);
  });

  it('reloads as soon as the new worker takes control', async () => {
    const updateSW = vi.fn().mockResolvedValue(undefined);
    await applyWaitingWorker(updateSW, waiting());

    expect(updateSW).toHaveBeenCalledWith(true);
    expect(reload).not.toHaveBeenCalled(); // nothing happens until the handover

    listeners.controllerchange();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(forceRefresh).not.toHaveBeenCalled(); // the cheap path was enough
  });

  // The reload here is NOT gated on workbox's `isUpdate`, which is false for any
  // tab that loaded uncontrolled — a hard reload, a first visit the installing
  // worker never claimed, or the tab forceRefresh() leaves behind. Those tabs
  // are exactly the ones that used to accept an update and then sit spinning.
  it('reloads on control change even though workbox would have skipped it', async () => {
    const updateSW = vi.fn().mockResolvedValue(undefined);
    await applyWaitingWorker(updateSW, waiting());
    listeners.controllerchange();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('recovers without waiting when no worker is parked in "waiting"', async () => {
    // SKIP_WAITING has no recipient here — workbox posts nothing and returns.
    const updateSW = vi.fn().mockResolvedValue(undefined);
    await applyWaitingWorker(updateSW, nothingWaiting());

    expect(forceRefresh).toHaveBeenCalledTimes(1);
    expect(updateSW).not.toHaveBeenCalled(); // pointless; skipped
  });

  it('recovers when the handover is accepted but no controller ever arrives', async () => {
    const updateSW = vi.fn().mockResolvedValue(undefined);
    await applyWaitingWorker(updateSW, waiting());

    expect(forceRefresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(7_000);
    expect(forceRefresh).not.toHaveBeenCalled(); // still inside the budget

    await vi.advanceTimersByTimeAsync(2_000);
    expect(forceRefresh).toHaveBeenCalledTimes(1);
  });

  it('recovers immediately when the handover itself throws', async () => {
    const updateSW = vi.fn().mockRejectedValue(new Error('registration gone'));
    await applyWaitingWorker(updateSW, waiting());
    expect(forceRefresh).toHaveBeenCalledTimes(1);
  });

  it('acts once: a late control change cannot reload on top of a recovery', async () => {
    const updateSW = vi.fn().mockResolvedValue(undefined);
    await applyWaitingWorker(updateSW, waiting());

    await vi.advanceTimersByTimeAsync(9_000);
    expect(forceRefresh).toHaveBeenCalledTimes(1);

    listeners.controllerchange();
    expect(reload).not.toHaveBeenCalled();
    expect(forceRefresh).toHaveBeenCalledTimes(1);
  });

  // A registration is not always in hand at click time (onRegistered can still
  // be pending). Absent one, assume the handover is worth attempting.
  it('still attempts the handover when no registration is in hand', async () => {
    const updateSW = vi.fn().mockResolvedValue(undefined);
    await applyWaitingWorker(updateSW, null);
    expect(updateSW).toHaveBeenCalledWith(true);
    expect(forceRefresh).not.toHaveBeenCalled();
  });

  // clientsClaim lets a newly activated worker take over tabs that never asked
  // for the update. Updating is mandatory, so those tabs have to be brought
  // along rather than left running a superseded bundle against a new worker.
  describe('a tab claimed by a worker it did not accept', () => {
    beforeEach(() => _resetUpdateStore());
    afterEach(() => _resetUpdateStore());

    it('checks the deployed version when a worker takes over unbidden', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: '99.0.0' }),
      });
      vi.stubGlobal('fetch', fetchMock);
      try {
        watchForSilentTakeover();
        listeners.controllerchange();
        await vi.waitFor(() => expect(getSnapshot()).toBe(1));
        expect(fetchMock.mock.calls[0][0]).toContain('/version.json');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    // The first worker a first-ever visit installs claims the page too, and that
    // page is already running the deployed version. Prompting there would put a
    // mandatory reload in front of someone who just arrived.
    it('stays quiet when the takeover is not a new deploy', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: __APP_VERSION__ }),
      });
      vi.stubGlobal('fetch', fetchMock);
      try {
        watchForSilentTakeover();
        listeners.controllerchange();
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(getSnapshot()).toBe(0);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('does not cut across a handover this tab already started', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      try {
        markUpdateAvailable(vi.fn()); // this tab is already in the update flow
        watchForSilentTakeover();
        listeners.controllerchange();
        await Promise.resolve();
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
