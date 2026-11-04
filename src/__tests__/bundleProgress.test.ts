// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const { releaseForTest } = vi.hoisted(() => ({ releaseForTest: { releaseId: 'unverified' } }));
vi.mock('../data/releaseIdentity', async (original) => ({
  ...await original<typeof import('../data/releaseIdentity')>(), RELEASE_IDENTITY: releaseForTest,
}));
import {
  loadRequiredBundle,
  subscribeBundleProgress,
  expectedBundleBytes,
  _setBundleTransport,
  _resetBundleCache,
  type BundleProgress,
  type BundleOutcome,
  type BundleTransport,
} from '../data/bundleSource';

// The loading bar's data supply, tested at the seam that produces it: the event
// stream every bundle load emits, and the streaming transport that fills it with
// real byte counts.
//
// The stream's shape is what the UI depends on — one start tick carrying the
// size, byte ticks while the bytes land, exactly one `done` — and it must hold
// for EVERY transport, including the ones that count nothing. That is why these
// assertions are about the stream rather than about fetch.

function collect() {
  const events: BundleProgress[] = [];
  const stop = subscribeBundleProgress((e) => { events.push(e); });
  return { events, stop };
}

beforeEach(() => { _resetBundleCache(); releaseForTest.releaseId = 'unverified'; });
afterEach(() => { _setBundleTransport(null); _resetBundleCache(); vi.restoreAllMocks(); });

describe('bundleSource — progress stream', () => {
  it('brackets every load with a start and exactly one done', async () => {
    _setBundleTransport(() => Promise.resolve<BundleOutcome>({ status: 'ok', value: { tag: 'A' } }));
    const { events, stop } = collect();
    await loadRequiredBundle('/a.js', 'G_A');
    stop();

    expect(events.map((e) => e.done)).toEqual([false, true]);
    expect(events.every((e) => e.url === '/a.js')).toBe(true);
  });

  it('relays the bytes a transport counts, in order', async () => {
    const transport: BundleTransport = async (_url, _key, report) => {
      report({ loaded: 100, total: 400 });
      report({ loaded: 400, total: 400 });
      return { status: 'ok', value: { tag: 'B' } };
    };
    _setBundleTransport(transport);
    const { events, stop } = collect();
    await loadRequiredBundle('/b.js', 'G_B');
    stop();

    expect(events.map((e) => e.loaded)).toEqual([0, 100, 400, 400]);
    expect(events.at(-1)).toMatchObject({ done: true, loaded: 400 });
  });

  it('a failed load never claims bytes it did not receive', async () => {
    // The distinction matters for the cumulative counter behind the
    // cross-dataset reports: a bundle that 404s must not add its full size to
    // "X MB downloaded" just because the size was known in advance.
    _setBundleTransport(() => Promise.resolve<BundleOutcome>({ status: 'load-failed' }));
    const { events, stop } = collect();
    await expect(loadRequiredBundle('/missing.js', 'G_X')).rejects.toThrow();
    stop();

    expect(events.at(-1)).toMatchObject({ done: true, loaded: 0 });
  });

  it('emits nothing for a cached bundle — a cache hit is not a download', async () => {
    _setBundleTransport(() => Promise.resolve<BundleOutcome>({ status: 'ok', value: { tag: 'C' } }));
    await loadRequiredBundle('/c.js', 'G_C');
    const { events, stop } = collect();
    await loadRequiredBundle('/c.js', 'G_C');
    stop();
    expect(events).toEqual([]);
  });

  it('a size the build did not measure is null, not zero', () => {
    // Null means "unknown", which the bar renders as an indeterminate sweep.
    // Zero would read as "a 0-byte file", i.e. instantly complete.
    expect(expectedBundleBytes('/query/genes/042.js')).toBeNull();
    expect(expectedBundleBytes('/datasets/not_a_dataset/track_nope.js')).toBeNull();
  });
});

describe('bundleSource — streaming transport', () => {
  // Drives the REAL default transport (no _setBundleTransport) by standing up a
  // fetch that streams two chunks, and a <script> stub that plays the part of
  // the browser executing the blob.
  function stubStreamingFetch(chunks: Uint8Array[], headers: Record<string, string> = {}) {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    const fetchStub = vi.fn().mockResolvedValue({
      ok: true,
      body,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    });
    vi.stubGlobal('fetch', fetchStub);
    return fetchStub;
  }

  /** Stand in for the browser running the fetched source: set the global, load. */
  function stubBlobExecution(globalKey: string, value: unknown) {
    const orig = document.createElement.bind(document);
    const injected: any[] = [];
    vi.spyOn(document, 'createElement').mockImplementation((tag: any) => {
      const el = orig(tag);
      if (tag === 'script') {
        injected.push(el);
        setTimeout(() => {
          (window as any)[globalKey] = value;
          el.onload?.(new Event('load'));
        }, 0);
      }
      return el;
    });
    return injected;
  }

  afterEach(() => { vi.unstubAllGlobals(); delete (window as any).HX_STREAM_TEST; });

  it('uses different mutable data URLs for two releases sharing one app version', async () => {
    // Model a reload into recomputed data without a package-version bump. A
    // persistent HTTP/SW cache must not reuse the earlier release's track bytes.
    const path = '/datasets/x/track_y.js';
    const requested: string[] = [];
    stubBlobExecution('HX_STREAM_TEST', { tag: 'loaded' });
    for (const releaseId of ['a'.repeat(64), 'b'.repeat(64)]) {
      releaseForTest.releaseId = releaseId;
      _resetBundleCache();
      delete (window as any).HX_STREAM_TEST;
      const fetchStub = stubStreamingFetch([new Uint8Array(1)]);
      await loadRequiredBundle(path, 'HX_STREAM_TEST');
      requested.push(fetchStub.mock.calls[0][0]);
    }
    expect(requested).toEqual([`${path}?v=${'a'.repeat(32)}`, `${path}?v=${'b'.repeat(32)}`]);
  });

  it('uses the release cache key for mutable data on script fallback too', async () => {
    releaseForTest.releaseId = 'c'.repeat(64);
    const path = '/datasets/x/meta.js';
    const fetchStub = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchStub);
    const injected = stubBlobExecution('HX_STREAM_TEST', { tag: 'fallback' });
    await loadRequiredBundle(path, 'HX_STREAM_TEST');
    expect(fetchStub.mock.calls[0][0]).toBe(`${path}?v=${releaseForTest.releaseId.slice(0, 32)}`);
    expect(new URL(injected[0].src).searchParams.get('v')).toBe(releaseForTest.releaseId.slice(0, 32));
  });

  it.each([
    '/query/abc123def456/genes/g042.js',
    '/query/abc123def456/pathways/p042.js',
    '/query/abc123def456/expr/e042.js',
    '/query/abc123def456/trackpaths/t042.js',
    '/query/abc123def456/gene_names.js',
    '/query/abc123def456/pathway_names.js',
    '/query/abc123def456/cards/mouse_gse254155.js',
    `/query/expression/${'a'.repeat(64)}/manifest.js`,
    `/query/expression/${'a'.repeat(64)}/shards/e042.js`,
  ])('reuses the content-versioned HTTP cache key for %s across app releases', async (path) => {
    const fetchStub = stubStreamingFetch([new Uint8Array(1)]);
    stubBlobExecution('HX_STREAM_TEST', { tag: 'immutable' });
    await loadRequiredBundle(path, 'HX_STREAM_TEST');
    expect(fetchStub).toHaveBeenCalledWith(path, { credentials: 'omit' });
  });

  it.each(['/query/tracks.js', '/query/expression-manifest.js', '/datasets/x/track_y.js', '/query/genes/g042.js'])(
    'retains app-version invalidation for mutable or legacy data at %s', async (path) => {
      const fetchStub = stubStreamingFetch([new Uint8Array(1)]);
      stubBlobExecution('HX_STREAM_TEST', { tag: 'mutable' });
      await loadRequiredBundle(path, 'HX_STREAM_TEST');
      const requested = new URL(fetchStub.mock.calls[0][0], window.location.href);
      expect(requested.pathname).toBe(path);
      expect(requested.searchParams.get('v')).toBeTruthy();
    },
  );

  it('uses the same immutable cache key when streaming falls back to a script', async () => {
    const path = '/query/abc123def456/expr/e042.js';
    const fetchStub = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchStub);
    const injected = stubBlobExecution('HX_STREAM_TEST', { tag: 'fallback' });
    await loadRequiredBundle(path, 'HX_STREAM_TEST');
    expect(fetchStub.mock.calls[0][0]).toBe(path);
    expect(new URL(injected[0].src).pathname).toBe(path);
    expect(new URL(injected[0].src).search).toBe('');
  });

  it('counts the bytes as they arrive and resolves the executed global', async () => {
    stubStreamingFetch([new Uint8Array(300), new Uint8Array(700)]);
    const injected = stubBlobExecution('HX_STREAM_TEST', { tag: 'streamed' });
    const { events, stop } = collect();

    await expect(loadRequiredBundle('/datasets/x/track_y.js', 'HX_STREAM_TEST'))
      .resolves.toEqual({ tag: 'streamed' });
    stop();

    // One tick per chunk, cumulative — this is what fills the bar.
    expect(events.filter((e) => !e.done).map((e) => e.loaded)).toEqual([0, 300, 1000]);
    // Executed through a blob URL, so the <script> src is never the data path.
    expect(injected).toHaveLength(1);
    expect(injected[0].src).not.toContain('/datasets/');
  });

  it('does not use Content-Length as a total when the response is encoded', async () => {
    // Content-Length counts COMPRESSED bytes while the reader yields decompressed
    // ones. Trusting it would drive the bar past 100% partway through the file.
    stubStreamingFetch([new Uint8Array(4096)], { 'content-length': '512', 'content-encoding': 'br' });
    stubBlobExecution('HX_STREAM_TEST', { tag: 'br' });
    const { events, stop } = collect();

    await loadRequiredBundle('/datasets/x/track_br.js', 'HX_STREAM_TEST');
    stop();

    expect(events.every((e) => e.total === null)).toBe(true);
  });

  it('reports a 404 as a failure without retrying it through a script tag', async () => {
    const fetchStub = vi.fn().mockResolvedValue({ ok: false, status: 404, body: null, headers: { get: () => null } });
    vi.stubGlobal('fetch', fetchStub);
    const injected = stubBlobExecution('HX_STREAM_TEST', { tag: 'never' });

    await expect(loadRequiredBundle('/datasets/x/track_404.js', 'HX_STREAM_TEST')).rejects.toThrow(/Failed to load/);
    // A status IS an answer; re-asking with a <script> only buys a second 404.
    expect(injected).toHaveLength(0);
  });

  it('falls back to a <script> tag when the fetch itself throws', async () => {
    // A thrown fetch is ambiguous (CORS rejection, offline, aborted), so the
    // transport that needs neither CORS nor a readable body takes over.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const injected = stubBlobExecution('HX_STREAM_TEST', { tag: 'fallback' });

    await expect(loadRequiredBundle('/datasets/x/track_cors.js', 'HX_STREAM_TEST'))
      .resolves.toEqual({ tag: 'fallback' });
    expect(injected).toHaveLength(1);
    expect(injected[0].src).toContain('/datasets/x/track_cors.js');
    expect(injected[0].src).toContain('?v=');
  });
});
