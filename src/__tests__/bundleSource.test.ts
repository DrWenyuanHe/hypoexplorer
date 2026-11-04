import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadRequiredBundle,
  loadOptionalBundle,
  _setBundleTransport,
  _resetBundleCache,
  type BundleOutcome,
  type BundleTransport,
} from '../data/bundleSource';

// The point of the seam: a test can replace the whole transport instead of
// stubbing document.createElement and seeding (and then cleaning up) window
// globals. queryIndex's suite used to enumerate 770 global names to tear down.
//
// Every test here installs a map-backed transport — no DOM, no globals at all.

function mapTransport(files: Record<string, unknown>) {
  const requests: string[] = [];
  const transport: BundleTransport = (url) => {
    requests.push(url);
    if (!(url in files)) return Promise.resolve<BundleOutcome>({ status: 'load-failed' });
    const value = files[url];
    // `undefined` models "the script loaded but set no global" — a malformed
    // bundle, which is a different failure from a request that never landed.
    return Promise.resolve<BundleOutcome>(
      value === undefined ? { status: 'missing-global' } : { status: 'ok', value },
    );
  };
  return { transport, requests };
}

/** A transport whose responses are released by hand, for racing a reset. */
function gatedTransport() {
  const requests: string[] = [];
  let release: (o: BundleOutcome) => void = () => {};
  const transport: BundleTransport = (url) => {
    requests.push(url);
    return new Promise<BundleOutcome>((resolve) => { release = resolve; });
  };
  return { transport, requests, release: (o: BundleOutcome) => release(o) };
}

beforeEach(() => { _resetBundleCache(); });
afterEach(() => { _setBundleTransport(null); _resetBundleCache(); });

describe('bundleSource — required bundles', () => {
  it('resolves the global the transport reports', async () => {
    const { transport } = mapTransport({ '/a.js': { tag: 'A' } });
    _setBundleTransport(transport);
    await expect(loadRequiredBundle('/a.js', 'G_A')).resolves.toEqual({ tag: 'A' });
  });

  it('distinguishes a malformed bundle from a failed request', async () => {
    const { transport } = mapTransport({ '/loaded-but-empty.js': undefined });
    _setBundleTransport(transport);
    await expect(loadRequiredBundle('/loaded-but-empty.js', 'G_X')).rejects.toThrow(
      /G_X not defined after loading/,
    );
    await expect(loadRequiredBundle('/absent.js', 'G_Y')).rejects.toThrow(/Failed to load \/absent\.js/);
  });

  it('uses failLabel in the load-failure message so the banner names the dataset', async () => {
    const { transport } = mapTransport({});
    _setBundleTransport(transport);
    await expect(
      loadRequiredBundle('/datasets/x/meta.js', 'G_META', 'dataset metadata for x (/datasets/x/meta.js)'),
    ).rejects.toThrow(/Failed to load dataset metadata for x/);
  });

  it('does NOT cache a failure, so a retry re-requests', async () => {
    const files: Record<string, unknown> = {};
    const { transport, requests } = mapTransport(files);
    _setBundleTransport(transport);

    await expect(loadRequiredBundle('/r.js', 'G_R')).rejects.toThrow();
    files['/r.js'] = { tag: 'late' };            // the transient failure clears
    await expect(loadRequiredBundle('/r.js', 'G_R')).resolves.toEqual({ tag: 'late' });
    expect(requests).toEqual(['/r.js', '/r.js']);
  });

  it('caches a success — a second call makes no request', async () => {
    const { transport, requests } = mapTransport({ '/c.js': { tag: 'C' } });
    _setBundleTransport(transport);
    await loadRequiredBundle('/c.js', 'G_C');
    await loadRequiredBundle('/c.js', 'G_C');
    expect(requests).toEqual(['/c.js']);
  });

  it('returns the SAME promise to a concurrent caller and requests once', async () => {
    const { transport, requests, release } = gatedTransport();
    _setBundleTransport(transport);
    const p1 = loadRequiredBundle('/d.js', 'G_D');
    const p2 = loadRequiredBundle('/d.js', 'G_D');
    expect(p1).toBe(p2);
    expect(requests).toEqual(['/d.js']);
    release({ status: 'ok', value: 1 });
    await p1;
  });
});

describe('bundleSource — optional bundles', () => {
  it('resolves null for a failed load and leaves it retryable', async () => {
    // A <script> onerror cannot tell a 404 from a network blip. Caching the
    // miss would let one flaky moment poison the whole session — e.g. every
    // later cross-dataset query silently taking the full-download path.
    const { transport, requests } = mapTransport({});
    _setBundleTransport(transport);
    await expect(loadOptionalBundle('/o.js', 'G_O')).resolves.toBeNull();
    await expect(loadOptionalBundle('/o.js', 'G_O')).resolves.toBeNull();
    expect(requests).toEqual(['/o.js', '/o.js']);
  });

  it('caches a deterministic miss — the script loaded but set no global', async () => {
    const requests: string[] = [];
    _setBundleTransport((url) => {
      requests.push(url);
      return Promise.resolve<BundleOutcome>({ status: 'missing-global' });
    });
    await expect(loadOptionalBundle('/m.js', 'G_M')).resolves.toBeNull();
    await expect(loadOptionalBundle('/m.js', 'G_M')).resolves.toBeNull();
    // Retrying cannot make the global appear; one request per session.
    expect(requests).toEqual(['/m.js']);
  });

  it('shares a cached success with the required path', async () => {
    const { transport, requests } = mapTransport({ '/s.js': { tag: 'S' } });
    _setBundleTransport(transport);
    await loadOptionalBundle('/s.js', 'G_S');
    await expect(loadRequiredBundle('/s.js', 'G_S')).resolves.toEqual({ tag: 'S' });
    expect(requests).toEqual(['/s.js']);
  });

  it('does not let one policy inherit the other in flight, but still requests once', async () => {
    // Required and optional wanting the same URL at the same time must not share
    // a promise: one rejects and one resolves null, so whichever started first
    // would otherwise impose its failure semantics on the other. They must still
    // share the underlying REQUEST — policy is not a reason to fetch twice.
    const { transport, requests, release } = gatedTransport();
    _setBundleTransport(transport);
    const req = loadRequiredBundle('/p.js', 'G_P');
    const opt = loadOptionalBundle('/p.js', 'G_P');
    expect(req).not.toBe(opt);
    expect(requests).toEqual(['/p.js']);
    release({ status: 'load-failed' });
    await expect(req).rejects.toThrow(/Failed to load/);
    await expect(opt).resolves.toBeNull();
  });
});

describe('bundleSource — reset', () => {
  it('a load still in flight cannot repopulate the cache after a reset', async () => {
    const first = gatedTransport();
    _setBundleTransport(first.transport);
    const stale = loadOptionalBundle('/g.js', 'G_G');

    _resetBundleCache();                       // e.g. between two tests
    first.release({ status: 'ok', value: { tag: 'stale' } });
    await stale;

    // The orphaned resolve must not have written to the fresh cache: the next
    // load re-requests and sees the new transport's answer.
    const second = mapTransport({ '/g.js': { tag: 'fresh' } });
    _setBundleTransport(second.transport);
    await expect(loadOptionalBundle('/g.js', 'G_G')).resolves.toEqual({ tag: 'fresh' });
    expect(second.requests).toEqual(['/g.js']);
  });

  it('clears cached successes and cached misses alike', async () => {
    const { transport, requests } = mapTransport({ '/h.js': { tag: 'H' } });
    _setBundleTransport(transport);
    await loadRequiredBundle('/h.js', 'G_H');
    await loadOptionalBundle('/miss.js', 'G_M');
    _resetBundleCache();
    await loadRequiredBundle('/h.js', 'G_H');
    await loadOptionalBundle('/miss.js', 'G_M');
    expect(requests).toEqual(['/h.js', '/miss.js', '/h.js', '/miss.js']);
  });
});
