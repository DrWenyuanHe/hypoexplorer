// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The apply fn for this path is the full cache reset, which navigates the page.
// Mocked so the tests can assert it was armed without jsdom trying to reload.
vi.mock('../pwa/forceRefresh', () => ({
  forceRefresh: vi.fn().mockResolvedValue(undefined),
}));

import { forceRefresh } from '../pwa/forceRefresh';
import { checkForNewerDeploy } from '../pwa/versionWatch';
import {
  getSnapshot,
  applyUpdate,
  markUpdateAvailable,
  _resetUpdateStore,
} from '../pwa/updateStore';

// The version this bundle was built from — the same constant versionWatch
// compares against (Vite `define`, so it is package.json's version in tests too).
const CURRENT = __APP_VERSION__;
const NEWER = '99.0.0';

const respondWith = (body: unknown, ok = true) =>
  vi.fn().mockResolvedValue({ ok, json: async () => body });

let origFetch: typeof globalThis.fetch;

beforeEach(() => {
  _resetUpdateStore();
  sessionStorage.clear();
  origFetch = globalThis.fetch;
  vi.mocked(forceRefresh).mockClear();
});

afterEach(() => {
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
});

describe('versionWatch — detecting a superseded build', () => {
  it('does nothing when the origin serves the version this tab is running', async () => {
    globalThis.fetch = respondWith({ version: CURRENT }) as any;
    await checkForNewerDeploy();
    expect(getSnapshot()).toBe(0);
  });

  it('arms the mandatory prompt with a full cache reset when the origin is newer', async () => {
    globalThis.fetch = respondWith({ version: NEWER }) as any;
    await checkForNewerDeploy();
    expect(getSnapshot()).toBe(1);

    // The apply fn for this path is forceRefresh, not SKIP_WAITING: it only
    // fires when the service-worker path did NOT, so the worker is absent or
    // wedged and has to be torn down.
    applyUpdate();
    expect(forceRefresh).toHaveBeenCalledTimes(1);
  });

  it('detects changed source or data even when the app version was not bumped', async () => {
    globalThis.fetch = respondWith({ version: CURRENT, releaseId: 'a'.repeat(64) }) as any;
    await checkForNewerDeploy();
    expect(getSnapshot()).toBe(1);
  });

  it('ignores malformed release identities rather than forcing a refresh', async () => {
    globalThis.fetch = respondWith({ version: CURRENT, releaseId: 'broken' }) as any;
    await checkForNewerDeploy();
    expect(getSnapshot()).toBe(0);
  });

  it('bypasses caches so a wedged worker cannot answer with the stale version', async () => {
    const fetchMock = respondWith({ version: CURRENT });
    globalThis.fetch = fetchMock as any;
    await checkForNewerDeploy();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/^\/version\.json\?t=\d+$/);
    expect(init).toMatchObject({ cache: 'no-store' });
  });

  it('treats an unusable answer as "unknown", never as "out of date"', async () => {
    // 404 (never uploaded)
    globalThis.fetch = respondWith({ version: NEWER }, false) as any;
    await checkForNewerDeploy();
    expect(getSnapshot()).toBe(0);

    // 200 with the wrong shape (an error page that happens to parse)
    globalThis.fetch = respondWith({ error: 'nope' }) as any;
    await checkForNewerDeploy();
    expect(getSnapshot()).toBe(0);

    // Offline / malformed body
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as any;
    await checkForNewerDeploy();
    expect(getSnapshot()).toBe(0);
  });

  it('leaves the service-worker path alone when it has already armed the prompt', async () => {
    const swUpdate = vi.fn();
    markUpdateAvailable(swUpdate);
    const fetchMock = respondWith({ version: NEWER });
    globalThis.fetch = fetchMock as any;

    await checkForNewerDeploy();

    expect(fetchMock).not.toHaveBeenCalled();
    applyUpdate();
    expect(swUpdate).toHaveBeenCalledWith(true); // cheap path kept, not overwritten
    expect(forceRefresh).not.toHaveBeenCalled();
  });

  it('gives up after two failed attempts at the same version rather than reload-looping', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.fetch = respondWith({ version: NEWER }) as any;

    // Each forced refresh reloads the tab: module state resets, sessionStorage
    // (where the attempt counter lives) does not. Simulate two rounds where the
    // reload does NOT change the running version — a half-finished upload, or an
    // edge still holding the old shell.
    await checkForNewerDeploy();
    expect(getSnapshot()).toBe(1);
    _resetUpdateStore();

    await checkForNewerDeploy();
    expect(getSnapshot()).toBe(1);
    _resetUpdateStore();

    await checkForNewerDeploy();
    expect(getSnapshot()).toBe(0); // third round: no arm, no loop
    expect(warn).toHaveBeenCalled();
  });

  it('counts attempts per target version, so the next deploy still updates', async () => {
    globalThis.fetch = respondWith({ version: NEWER }) as any;
    await checkForNewerDeploy();
    _resetUpdateStore();
    await checkForNewerDeploy();
    _resetUpdateStore();

    // A different version is a different target: the exhausted counter for
    // NEWER must not suppress it.
    globalThis.fetch = respondWith({ version: '99.1.0' }) as any;
    await checkForNewerDeploy();
    expect(getSnapshot()).toBe(1);
  });
});
