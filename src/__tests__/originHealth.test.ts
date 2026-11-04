// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetOriginHealth,
  diagnoseDataOrigin,
  explainOrigin,
  shouldLinkStatusPage,
  type OriginDiagnosis,
} from '../data/originHealth';

// BUNDLE_BASE is pinned to '' at TRANSFORM time under vitest (see vite.config's
// `define` in test mode), so the module always sees a same-origin deploy. The
// off-origin branches are exercised by calling the probe through a stubbed
// BUNDLE_BASE via vi.mock — the only way to reach them without the real env.
vi.mock('../data/bundleBase', () => ({
  BUNDLE_BASE: 'https://data.example.test',
  BUNDLE_BASE_IS_CORS_ENABLED: false,
}));

const realFetch = globalThis.fetch;

function setOnline(value: boolean): void {
  Object.defineProperty(globalThis.navigator, 'onLine', { value, configurable: true });
}

beforeEach(() => {
  _resetOriginHealth();
  setOnline(true);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setOnline(true);
  vi.restoreAllMocks();
});

describe('diagnoseDataOrigin', () => {
  it('reports the origin reachable when a response arrives at all', async () => {
    // no-cors responses are opaque, so a 404 is indistinguishable from a 200 —
    // and that is the point: ARRIVAL is the signal, not the status.
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    await expect(diagnoseDataOrigin()).resolves.toEqual({
      status: 'origin-reachable',
      origin: 'https://data.example.test',
    });
  });

  it('reports the origin unreachable when the request never lands', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const d = await diagnoseDataOrigin();
    expect(d.status).toBe('origin-unreachable');
  });

  it('prefers "offline" over "unreachable" — the browser stated the cause', async () => {
    setOnline(false);
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    await expect(diagnoseDataOrigin()).resolves.toMatchObject({ status: 'offline' });
    // No point spending a request that cannot succeed.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('re-checks offline after a rejection — the network can drop mid-probe', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      setOnline(false);
      return Promise.reject(new TypeError('Failed to fetch'));
    });
    await expect(diagnoseDataOrigin()).resolves.toMatchObject({ status: 'offline' });
  });

  it('probes with no-cors and no-store, so no CORS policy or cache can distort it', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null));
    globalThis.fetch = fetchSpy;
    await diagnoseDataOrigin();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://data.example.test/query/tracks.js');
    expect(init).toMatchObject({ mode: 'no-cors', cache: 'no-store' });
  });

  it('costs ONE request for a burst of failures, then re-probes after the TTL', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null));
    globalThis.fetch = fetchSpy;

    // A cross-dataset query fans out over many tracks; each failure asks.
    await Promise.all([diagnoseDataOrigin(), diagnoseDataOrigin(), diagnoseDataOrigin()]);
    await diagnoseDataOrigin();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000);
    await diagnoseDataOrigin();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('never rejects, even when fetch throws synchronously', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      throw new Error('boom');
    });
    // A diagnosis that threw would replace a real error with a worse one.
    await expect(diagnoseDataOrigin()).resolves.toMatchObject({ status: 'origin-unreachable' });
  });
});

describe('explainOrigin', () => {
  const d = (status: OriginDiagnosis['status']): OriginDiagnosis =>
    ({ status, origin: 'https://data.example.test' });

  it('names the unreachable data host and explains possible causes', () => {
    const text = explainOrigin(d('origin-unreachable'))!;
    expect(text).toContain('https://data.example.test');
    expect(text).toContain('data server may be unavailable');
    expect(text).toContain('your network may be blocking the address');
  });

  it('points at the one file, not an outage, when the origin answers', () => {
    expect(explainOrigin(d('origin-reachable'))).toMatch(/this file could not be loaded/);
  });

  it('says offline plainly', () => {
    expect(explainOrigin(d('offline'))).toMatch(/offline/i);
  });

  it('adds nothing for same-origin or unknown — the error alone is the whole story', () => {
    expect(explainOrigin(d('same-origin'))).toBeNull();
    expect(explainOrigin(d('unknown'))).toBeNull();
    expect(explainOrigin(null)).toBeNull();
  });
});

describe('shouldLinkStatusPage', () => {
  it('offers the CDN status page only when the origin is unreachable', () => {
    const at = (status: OriginDiagnosis['status']) => shouldLinkStatusPage({ status, origin: 'x' });
    expect(at('origin-unreachable')).toBe(true);
    // Sending someone to a status page for their own offline wifi, or for one
    // missing file, is a wild goose chase.
    expect(at('offline')).toBe(false);
    expect(at('origin-reachable')).toBe(false);
    expect(at('same-origin')).toBe(false);
    expect(shouldLinkStatusPage(null)).toBe(false);
  });
});

describe('same-origin deploys', () => {
  it('skip the probe entirely', async () => {
    // Proven against the real module, whose BUNDLE_BASE is '' under vitest.
    vi.resetModules();
    vi.doUnmock('../data/bundleBase');
    const fresh = await vi.importActual<typeof import('../data/originHealth')>('../data/originHealth');
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    await expect(fresh.diagnoseDataOrigin()).resolves.toEqual({ status: 'same-origin', origin: '' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
