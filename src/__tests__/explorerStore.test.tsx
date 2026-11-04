import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useExplorerStore } from '../data/explorerStore';
import { _setBundleTransport, _resetBundleCache, loadRequiredBundle, type BundleOutcome, type BundleTransport } from '../data/bundleSource';
import { _resetTrackCache } from '../data/loadTrack';
import { BULK_DATASET_FIXTURE, MIRNA_DATASET_FIXTURE, MULTICONTRAST_DATASET_FIXTURE } from './fixtures';

// The explorer store used to live inline in App.tsx, so every one of these
// properties could only be exercised by mounting the whole application and
// asserting on rendered DOM — which is why the stale-write guards, the in-flight
// dedup and the quiet-load rule had no direct coverage at all. They are the
// store's interface now, so they are tested through it.
//
// Every test installs a map-backed bundle transport: no DOM, no window globals,
// and loads that resolve exactly when the test says so.

const DS_A = BULK_DATASET_FIXTURE;   // mouse_bulk_hfd, defaultTrack 'whole'
const DS_B = MIRNA_DATASET_FIXTURE;  // mouse_mirna,    defaultTrack 'whole'

const META_A = { populations: ['whole', 'cortex'], labels: { whole: 'Whole' } };
const META_B = { populations: ['whole'], labels: { whole: 'Whole (miRNA)' } };
const QC_A = { runStatus: [{ cluster: 'whole', status: 'ok' }] };
const TRACK_A = { meta: { code: 'whole' }, de: [], cpm: {} };

/** A transport that serves a fixed map and records every requested URL. */
function mapTransport(files: Record<string, unknown>) {
  const requests: string[] = [];
  const transport: BundleTransport = (url) => {
    requests.push(url);
    if (!(url in files)) return Promise.resolve<BundleOutcome>({ status: 'load-failed' });
    return Promise.resolve<BundleOutcome>({ status: 'ok', value: files[url] });
  };
  return { transport, requests };
}

/** A transport whose every response is released by hand, so a load can be raced. */
function gatedTransport() {
  const requests: string[] = [];
  const pending: Array<(o: BundleOutcome) => void> = [];
  const transport: BundleTransport = (url) => {
    requests.push(url);
    return new Promise<BundleOutcome>((resolve) => { pending.push(resolve); });
  };
  const releaseAll = (value: unknown) => {
    const waiting = pending.splice(0);
    for (const resolve of waiting) resolve({ status: 'ok', value });
  };
  return { transport, requests, releaseAll };
}

const FILES = {
  '/datasets/mouse_bulk_hfd/meta.js': META_A,
  '/datasets/mouse_bulk_hfd/qc_global.js': QC_A,
  '/datasets/mouse_bulk_hfd/track_whole.js': TRACK_A,
  '/datasets/mouse_mirna/meta.js': META_B,
};

beforeEach(() => { _resetBundleCache(); _resetTrackCache(); });
afterEach(() => { _setBundleTransport(null); _resetBundleCache(); _resetTrackCache(); });

describe('explorerStore — dataset metadata', () => {
  it('loads the active dataset metadata', async () => {
    const { transport } = mapTransport(FILES);
    _setBundleTransport(transport);
    const { result } = renderHook(() =>
      useExplorerStore({ dataset: DS_A, activeTrackId: 'whole', wantQC: false }));

    await waitFor(() => expect(result.current.meta).toEqual(META_A));
  });

  it('clears the outgoing metadata before the incoming dataset resolves', async () => {
    const { transport, releaseAll } = gatedTransport();
    _setBundleTransport(transport);
    const { result, rerender } = renderHook(
      ({ dataset }) => useExplorerStore({ dataset, activeTrackId: 'whole', wantQC: false }),
      { initialProps: { dataset: DS_A } },
    );
    await act(async () => { releaseAll(META_A); });
    expect(result.current.meta).toEqual(META_A);

    // Switch datasets; the new meta is still in flight. The previous dataset's
    // metadata must be gone — rendering it against the new dataset's data is how
    // every population label and colour ends up mismatched.
    rerender({ dataset: DS_B });
    expect(result.current.meta).toBeNull();
  });

  it('never exposes the outgoing dataset metadata for even one render', async () => {
    // Regression: clearing from an effect is not enough. useEffect runs AFTER
    // paint, so an effect-based clear leaves one painted frame in which the
    // previous dataset's populations, labels and colours render under the new
    // dataset's identity. `meta` must read null in the SAME render as the switch.
    const { transport, releaseAll } = gatedTransport();
    _setBundleTransport(transport);
    const seen: Array<unknown> = [];
    const { rerender } = renderHook(
      ({ dataset }) => {
        const store = useExplorerStore({ dataset, activeTrackId: 'whole', wantQC: false });
        seen.push(store.meta);
        return store;
      },
      { initialProps: { dataset: DS_A } },
    );
    await act(async () => { releaseAll(META_A); });
    seen.length = 0;

    rerender({ dataset: DS_B });
    // Every render since the switch — including the very first — must be null.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((m) => m === null)).toBe(true);
  });

  it('does not surface a failure from a dataset the user already left', async () => {
    // Regression: an unguarded catch let dataset A's failure raise "Failed to
    // load A" over dataset B — an error banner naming something not on screen.
    const requests: Array<(o: BundleOutcome) => void> = [];
    _setBundleTransport(() => new Promise<BundleOutcome>((resolve) => { requests.push(resolve); }));
    const { result, rerender } = renderHook(
      ({ dataset }) => useExplorerStore({ dataset, activeTrackId: 'whole', wantQC: false }),
      { initialProps: { dataset: DS_A } },
    );
    rerender({ dataset: DS_B });
    // Fail A's (now superseded) request.
    await act(async () => { requests[0]?.({ status: 'load-failed' }); });
    expect(result.current.loadError).toBeNull();
  });

  it('drops a metadata load that resolves after the user switched datasets', async () => {
    // The marquee stale-write case: A's meta is in flight when the user moves to
    // B. A's late resolve must not repaint the shell with A's metadata.
    const { transport, releaseAll } = gatedTransport();
    _setBundleTransport(transport);
    const { result, rerender } = renderHook(
      ({ dataset }) => useExplorerStore({ dataset, activeTrackId: 'whole', wantQC: false }),
      { initialProps: { dataset: DS_A } },
    );
    rerender({ dataset: DS_B });

    // Release BOTH loads (A's stale one and B's live one) with B's payload
    // shape; only the load the store is currently waiting for may land.
    await act(async () => { releaseAll(META_B); });
    expect(result.current.meta).toEqual(META_B);
  });
});

describe('explorerStore — dataset QC is lazy', () => {
  it('does not request QC until something wants it', async () => {
    const { transport, requests } = mapTransport(FILES);
    _setBundleTransport(transport);
    const { result, rerender } = renderHook(
      ({ wantQC }) => useExplorerStore({ dataset: DS_A, activeTrackId: 'whole', wantQC }),
      { initialProps: { wantQC: false } },
    );
    await waitFor(() => expect(result.current.meta).toEqual(META_A));
    expect(requests.some((u) => u.includes('qc_global'))).toBe(false);

    rerender({ wantQC: true });
    await waitFor(() => expect(result.current.qc).toEqual(QC_A));
  });

  it('never serves the previous dataset QC after a switch made with the tab closed', async () => {
    // Regression: QC was only cleared by the effect that runs when the QC tab is
    // OPEN. Switch dataset with the tab closed and re-open it, and the first
    // render served the previous dataset's QC blob against the new dataset's
    // metadata — a cross-dataset mismatch in the one view that is all numbers.
    // Asserted through a render spy, not the settled value: an effect-based
    // clear would be flushed by rerender() and the mismatch would never be
    // visible to a post-hoc assertion — but it IS visible on screen, because
    // effects run after paint.
    const { transport } = mapTransport(FILES);
    _setBundleTransport(transport);
    const seen: Array<unknown> = [];
    const { result, rerender } = renderHook(
      ({ dataset, wantQC }) => {
        const store = useExplorerStore({ dataset, activeTrackId: 'whole', wantQC });
        seen.push(store.qc);
        return store;
      },
      { initialProps: { dataset: DS_A, wantQC: true } },
    );
    await waitFor(() => expect(result.current.qc).toEqual(QC_A));

    // Leave the QC tab, switch dataset, come back.
    rerender({ dataset: DS_A, wantQC: false });
    await act(async () => { rerender({ dataset: DS_B, wantQC: false }); });
    seen.length = 0;
    rerender({ dataset: DS_B, wantQC: true });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((blob) => blob === null)).toBe(true);
  });

  it('does not re-request QC when the tab is left and re-entered', async () => {
    const { transport, requests } = mapTransport(FILES);
    _setBundleTransport(transport);
    const { result, rerender } = renderHook(
      ({ wantQC }) => useExplorerStore({ dataset: DS_A, activeTrackId: 'whole', wantQC }),
      { initialProps: { wantQC: true } },
    );
    await waitFor(() => expect(result.current.qc).toEqual(QC_A));
    const afterFirst = requests.filter((u) => u.includes('qc_global')).length;

    rerender({ wantQC: false });
    rerender({ wantQC: true });
    expect(requests.filter((u) => u.includes('qc_global')).length).toBe(afterFirst);
  });
});

describe('explorerStore — ensureTrack', () => {
  it('caches: a second call for a loaded track issues no new request', async () => {
    const { transport, requests } = mapTransport(FILES);
    _setBundleTransport(transport);
    const { result } = renderHook(() =>
      useExplorerStore({ dataset: DS_A, activeTrackId: 'whole', wantQC: false }));

    await act(async () => { await result.current.ensureTrack('whole'); });
    const afterFirst = requests.filter((u) => u.includes('track_whole')).length;
    expect(afterFirst).toBeGreaterThan(0);
    expect(result.current.getTrack('whole')).toBeTruthy();

    await act(async () => { await result.current.ensureTrack('whole'); });
    expect(requests.filter((u) => u.includes('track_whole')).length).toBe(afterFirst);
  });

  it('dedups concurrent calls for the same track onto one promise', async () => {
    const { transport, releaseAll } = gatedTransport();
    _setBundleTransport(transport);
    const { result } = renderHook(() =>
      useExplorerStore({ dataset: DS_A, activeTrackId: 'whole', wantQC: false }));

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = result.current.ensureTrack('whole');
      second = result.current.ensureTrack('whole');
    });
    expect(first).toBe(second);
    await act(async () => { releaseAll(TRACK_A); });
  });

  it('drives the loading overlay for a normal load but not a quiet one', async () => {
    // Compare renders its own per-track spinners and loads quietly. A quiet load
    // must never set loadingTrack: in Compare mode the active track is the
    // 'compare' pseudo-track, so the guarded clear would never fire and the
    // overlay would sit over the view forever.
    const { transport, releaseAll } = gatedTransport();
    _setBundleTransport(transport);
    const { result } = renderHook(() =>
      useExplorerStore({ dataset: DS_A, activeTrackId: 'whole', wantQC: false }));

    act(() => { result.current.ensureTrack('whole'); });
    expect(result.current.loadingTrack).toBe('whole');
    await act(async () => { releaseAll(TRACK_A); });
    expect(result.current.loadingTrack).toBeNull();

    act(() => { result.current.ensureTrack('cortex', undefined, true); });
    expect(result.current.loadingTrack).toBeNull();
    await act(async () => { releaseAll(TRACK_A); });
  });

  it('surfaces a failed track load on the error channel, and retry clears it', async () => {
    const { transport } = mapTransport({ '/datasets/mouse_bulk_hfd/meta.js': META_A });
    _setBundleTransport(transport);
    const { result } = renderHook(() =>
      useExplorerStore({ dataset: DS_A, activeTrackId: 'whole', wantQC: false }));

    await act(async () => { await result.current.ensureTrack('whole'); });
    expect(result.current.loadError).toMatch(/whole/);
    // The overlay must not be left spinning behind the error banner.
    expect(result.current.loadingTrack).toBeNull();

    act(() => { result.current.retry(); });
    expect(result.current.loadError).toBeNull();
  });

  it('retires the overlay when the user leaves a track whose load is still running', async () => {
    // Regression: the completion handler is guarded to the ACTIVE track, so a
    // load for the track the user left can never clear the overlay it set. If the
    // new selection sets no overlay of its own — entering Compare, which loads
    // nothing — the overlay sat over the view forever.
    const { transport, releaseAll } = gatedTransport();
    _setBundleTransport(transport);
    const { result, rerender } = renderHook(
      ({ activeTrackId }) => useExplorerStore({ dataset: DS_A, activeTrackId, wantQC: false }),
      { initialProps: { activeTrackId: 'whole' } },
    );

    act(() => { result.current.ensureTrack('whole'); });
    expect(result.current.loadingTrack).toBe('whole');

    // Enter Compare while 'whole' is still in flight.
    rerender({ activeTrackId: 'compare' });
    expect(result.current.loadingTrack).toBeNull();

    // The late resolve must not resurrect it either.
    await act(async () => { releaseAll(TRACK_A); });
    expect(result.current.loadingTrack).toBeNull();
  });

  it('retires the overlay on a dataset switch that keeps the track NAME', async () => {
    // Regression: the overlay used to be retired by bare track id, but every
    // bulk dataset calls its track 'whole'. Switch datasets while a load is in
    // flight and land on another dataset whose same-named track is already
    // cached: the id-based guard sees "still on 'whole'" and keeps the overlay,
    // the cached ensureTrack never touches it, and the stale load's clear is
    // guarded to the other dataset's key — the overlay sat over the view forever.
    const { transport, releaseAll } = gatedTransport();
    _setBundleTransport(transport);
    const { result, rerender } = renderHook(
      ({ dataset }) => useExplorerStore({ dataset, activeTrackId: 'whole', wantQC: false }),
      { initialProps: { dataset: DS_B } },
    );
    // Load and cache B::whole.
    let firstLoad!: Promise<unknown>;
    act(() => { firstLoad = result.current.ensureTrack('whole'); });
    await act(async () => { releaseAll(TRACK_A); await firstLoad; });
    expect(result.current.loadingTrack).toBeNull();

    // Switch to A and start its same-named load; leave it in flight.
    rerender({ dataset: DS_A });
    act(() => { result.current.ensureTrack('whole'); });
    expect(result.current.loadingTrack).toBe('whole');

    // Switch back to B, whose 'whole' is cached: nothing will set or clear the
    // overlay from here on — the retire guard alone must take it down.
    await act(async () => { rerender({ dataset: DS_B }); });
    await act(async () => { await result.current.ensureTrack('whole'); });
    expect(result.current.loadingTrack).toBeNull();

    // A's late resolve must not resurrect it either.
    await act(async () => { releaseAll(TRACK_A); });
    expect(result.current.loadingTrack).toBeNull();
  });

  it('retires the error banner when the user switches onto cached data', async () => {
    // Regression: a failure is only ever SET while its track is active, and a
    // switch onto an already-cached track triggers no load — so nothing ever
    // cleared the banner, and "Failed to load whole data" for dataset A sat
    // over dataset B indefinitely.
    const { transport } = mapTransport(FILES);
    _setBundleTransport(transport);
    const { result, rerender } = renderHook(
      ({ dataset, activeTrackId }) => useExplorerStore({ dataset, activeTrackId, wantQC: false }),
      { initialProps: { dataset: DS_B, activeTrackId: 'whole' } },
    );
    // Cache B::whole... (mouse_mirna has no track file in FILES, so use DS_A's
    // cached track as the switch target instead: fail B, land on cached A.)
    rerender({ dataset: DS_A, activeTrackId: 'whole' });
    await act(async () => { await result.current.ensureTrack('whole'); });
    expect(result.current.getTrack('whole')).toBeTruthy();

    // Fail a load on B while B is active.
    await act(async () => { rerender({ dataset: DS_B, activeTrackId: 'whole' }); });
    await act(async () => { await result.current.ensureTrack('whole'); });
    expect(result.current.loadError).toMatch(/whole/);

    // Switch back to A, whose 'whole' is cached: no load fires, so only the
    // retire guard can take the stale banner down.
    await act(async () => { rerender({ dataset: DS_A, activeTrackId: 'whole' }); });
    expect(result.current.loadError).toBeNull();
  });

  it('keys the cache by dataset so same-named tracks never collide', async () => {
    // Both fixtures call their default track 'whole'. A bare-id cache would let
    // the miRNA track answer a lookup for the bulk one.
    const { transport } = mapTransport(FILES);
    _setBundleTransport(transport);
    const { result, rerender } = renderHook(
      ({ dataset }) => useExplorerStore({ dataset, activeTrackId: 'whole', wantQC: false }),
      { initialProps: { dataset: DS_A } },
    );
    await act(async () => { await result.current.ensureTrack('whole'); });
    expect(result.current.getTrack('whole')).toBeTruthy();

    // Switching datasets kicks off the incoming meta load; let it settle so the
    // assertion isn't racing a state update.
    await act(async () => { rerender({ dataset: DS_B }); });
    // mouse_mirna's 'whole' was never loaded — the lookup must miss, not return
    // the bulk dataset's track.
    expect(result.current.getTrack('whole')).toBeUndefined();
  });
});

// ── Eager seed: pathway sibling shapes ──────────────────────────────────────
// index.html eager-loads the default track and its pathway sibling as window
// globals, and the store seeds its cache from them without going through the
// transport. That seed does its own unwrap, so it is a SECOND place the
// sibling shape is handled — and the one with no network step to notice a
// mistake. A wrapper landing verbatim on raw.pathways would make every
// contrast render `{default, byContrast}` as if it were a pathway database.
describe('explorerStore — eager pathway sibling seed', () => {
  const DEFAULT_PW = {
    GO_BP: [{ pathway: 'GOBP_EAGER_DEFAULT', pval: 0.01, padj: 0.02, NES: 2.0, size: 20, leadingEdge: ['FOS'] }],
    HALLMARK: [], KEGG: [], REACTOME: [],
  };
  const REFED_PW = {
    GO_BP: [{ pathway: 'GOBP_EAGER_REFED', pval: 0.03, padj: 0.05, NES: 1.3, size: 12, leadingEdge: ['IGFBP2'] }],
    HALLMARK: [], KEGG: [], REACTOME: [],
  };
  const EAGER_FILES = {
    '/datasets/mouse_fasting_tc/meta.js': { populations: ['whole'], labels: { whole: 'Whole' } },
    '/datasets/mouse_fasting_tc/qc_global.js': { runStatus: [] },
  };

  function seedEagerGlobals(sibling: unknown) {
    (window as any).HX_MOUSE_FASTING_TC_WHOLE = { meta: { code: 'whole' }, de: [], cpm: {} };
    (window as any).HX_MOUSE_FASTING_TC_WHOLE_PATH = sibling;
  }

  afterEach(() => {
    delete (window as any).HX_MOUSE_FASTING_TC_WHOLE;
    delete (window as any).HX_MOUSE_FASTING_TC_WHOLE_PATH;
  });

  it('unwraps a WRAPPER sibling into pathways + pathwaysByContrast', async () => {
    seedEagerGlobals({ default: DEFAULT_PW, byContrast: { refed_vs_fed: REFED_PW } });
    const { transport } = mapTransport(EAGER_FILES);
    _setBundleTransport(transport);

    const { result } = renderHook(() =>
      useExplorerStore({ dataset: MULTICONTRAST_DATASET_FIXTURE, activeTrackId: 'whole', wantQC: false }));

    const seeded = result.current.getTrack('whole')!;
    expect(seeded.pathways).toEqual(DEFAULT_PW);
    expect(seeded.pathwaysByContrast).toEqual({ refed_vs_fed: REFED_PW });
    // The wrapper itself must never be the pathway block.
    expect(seeded.pathways).not.toHaveProperty('byContrast');
    // Let the metadata load settle so its state update lands inside act().
    await waitFor(() => expect(result.current.meta).toBeTruthy());
  });

  it('takes a LEGACY plain-block sibling as the default with no per-contrast blocks', async () => {
    seedEagerGlobals(DEFAULT_PW);
    const { transport } = mapTransport(EAGER_FILES);
    _setBundleTransport(transport);

    const { result } = renderHook(() =>
      useExplorerStore({ dataset: MULTICONTRAST_DATASET_FIXTURE, activeTrackId: 'whole', wantQC: false }));

    const seeded = result.current.getTrack('whole')!;
    expect(seeded.pathways).toEqual(DEFAULT_PW);
    expect(seeded.pathwaysByContrast).toBeUndefined();
    await waitFor(() => expect(result.current.meta).toBeTruthy());
  });
});

describe('explorerStore — a track another loader already fetched', () => {
  it('opens it without raising the global loading overlay', async () => {
    // Compare's track columns fill the bundle cache, not the store's track
    // cache; leaving Compare for such a track used to flash the overlay.
    const { transport } = mapTransport(FILES);
    _setBundleTransport(transport);
    await loadRequiredBundle('/datasets/mouse_bulk_hfd/track_whole.js', 'unused');
    const { result } = renderHook(() => useExplorerStore({ dataset: DS_A, activeTrackId: 'whole', wantQC: false }));
    act(() => { result.current.ensureTrack('whole'); });
    expect(result.current.loadingTrack).toBeNull();
    await waitFor(() => expect(result.current.getTrack('whole')).toBeTruthy());
    expect(result.current.loadingTrack).toBeNull();
  });
});

