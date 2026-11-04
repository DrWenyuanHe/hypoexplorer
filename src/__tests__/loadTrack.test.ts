// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadTrack, _resetTrackCache } from '../data/loadTrack';
import { resolveTrackGlobalKey } from '../data/bundleLocators';
import { BULK_DATASET_FIXTURE, MIRNA_DATASET_FIXTURE, BULK_TRACK_FIXTURE } from './fixtures';

// Two synthetic datasets that DECLARE THE SAME track id ('whole') but resolve
// to different global keys / URLs. Used to prove the loader keys its cache by
// (datasetId, trackId), so the same track id across datasets never collides.
const DS_A = BULK_DATASET_FIXTURE;     // globalKeyTemplate HX_MOUSE_BULK_HFD_{TRACKID}
const DS_B = MIRNA_DATASET_FIXTURE;    // globalKeyTemplate HX_MOUSE_MIRNA_{TRACKID}

// Helper: stub document.createElement so injected <script> tags don't hit the
// network. The callback decides what happens on append (set a global + onload,
// fire onerror, etc).
function stubScripts(onAppend: (el: any) => void) {
  const orig = document.createElement.bind(document);
  const injected: any[] = [];
  const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: any) => {
    const el = orig(tag);
    if (tag === 'script') {
      injected.push(el);
      // Defer so loadTrack has appended + wired onload/onerror first.
      setTimeout(() => onAppend(el), 0);
    }
    return el;
  });
  return { spy, injected };
}

beforeEach(() => {
  _resetTrackCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as any).HX_MOUSE_BULK_HFD_WHOLE;
  delete (window as any).HX_MOUSE_MIRNA_WHOLE;
  delete (window as any).HX_MOUSE_BULK_HFD_ZZZ;
});

describe('loadTrack — eager-global seed (no reinject)', () => {
  it('resolves synchronously from an already-set global without injecting a script', async () => {
    (window as any)[resolveTrackGlobalKey(DS_A, 'whole')] = BULK_TRACK_FIXTURE;
    const { injected } = stubScripts(() => {});
    const data = await loadTrack(DS_A, 'whole');
    expect(data).toBe(BULK_TRACK_FIXTURE);
    expect(injected.length).toBe(0); // never injected
  });
});

describe('loadTrack — cache key is (datasetId, trackId), collision-free', () => {
  it('the same track id in two datasets resolves to two distinct bundles', async () => {
    const aData = { ...BULK_TRACK_FIXTURE, _tag: 'A' };
    const bData = { ...BULK_TRACK_FIXTURE, _tag: 'B' };
    (window as any).HX_MOUSE_BULK_HFD_WHOLE = aData;
    (window as any).HX_MOUSE_MIRNA_WHOLE = bData;
    stubScripts(() => {});

    const a = await loadTrack(DS_A, 'whole');
    const b = await loadTrack(DS_B, 'whole');
    expect((a as any)._tag).toBe('A');
    expect((b as any)._tag).toBe('B');
    expect(a).not.toBe(b);
  });
});

describe('loadTrack — in-flight dedup', () => {
  it('two rapid calls for the same (dataset, track) return the same promise and inject one script', async () => {
    const { injected } = stubScripts(() => {}); // never resolves
    const p1 = loadTrack(DS_A, 'whole');
    const p2 = loadTrack(DS_A, 'whole');
    expect(p1).toBe(p2);
    // The <script> arrives a tick late: the transport tries a streaming fetch
    // first (that is what counts bytes for the loading bar) and only falls back
    // to script injection once that fetch has failed. Dedup is unchanged — what
    // matters is that ONE tag appears, not that it appears synchronously.
    await vi.waitFor(() => expect(injected.length).toBe(1));
    // Clean up so the promise doesn't dangle.
    injected.forEach(s => { s.onerror?.(new Event('error')); });
    return p1.catch(() => {});
  });
});

describe('loadTrack — injects + reads the namespaced global on load', () => {
  it('appends a versioned <script> at the resolved URL and resolves with the global', async () => {
    const { injected } = stubScripts((el) => {
      (window as any).HX_MOUSE_BULK_HFD_WHOLE = BULK_TRACK_FIXTURE; // simulate the bundle assigning its global
      el.onload?.(new Event('load'));
    });
    const data = await loadTrack(DS_A, 'whole');
    expect(data).toBe(BULK_TRACK_FIXTURE);
    expect(injected.length).toBe(1);
    expect(injected[0].src).toContain('/datasets/mouse_bulk_hfd/track_whole.js');
    expect(injected[0].src).toContain('?v=');
  });
});

describe('loadTrack — missing-global reject', () => {
  it('rejects with a clear error when onload fires but the global is not set', async () => {
    stubScripts((el) => {
      // onload WITHOUT assigning HX_MOUSE_BULK_HFD_ZZZ
      el.onload?.(new Event('load'));
    });
    await expect(loadTrack(DS_A, 'zzz')).rejects.toThrow(/HX_MOUSE_BULK_HFD_ZZZ not defined/);
  });

  it('clears in-flight on failure so a retry can re-inject', async () => {
    // First attempt: onerror.
    const first = stubScripts((el) => el.onerror?.(new Event('error')));
    await expect(loadTrack(DS_A, 'zzz')).rejects.toThrow(/Failed to load/);
    first.spy.mockRestore();

    // Retry: now the global is present on load → resolves.
    const second = stubScripts((el) => {
      (window as any).HX_MOUSE_BULK_HFD_ZZZ = { ...BULK_TRACK_FIXTURE, _tag: 'retry' };
      el.onload?.(new Event('load'));
    });
    const data = await loadTrack(DS_A, 'zzz');
    expect((data as any)._tag).toBe('retry');
    expect(second.injected.length).toBe(1); // re-injected after the clear
  });
});

describe('loadTrack — onerror reject', () => {
  it('rejects with the bundle URL when the script fails to load', async () => {
    stubScripts((el) => el.onerror?.(new Event('error')));
    await expect(loadTrack(DS_A, 'whole')).rejects.toThrow(/track_whole\.js/);
  });
});
