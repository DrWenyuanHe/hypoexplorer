import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTrackColumns, type TrackColumnPolicy, type TrackColumnRequest } from '../data/trackColumns';
import { _setBundleTransport, _resetBundleCache, type BundleOutcome } from '../data/bundleSource';
import { _resetTrackCache } from '../data/loadTrack';
import { getActiveContrast } from '../data/contrasts';
import type { RawTrack } from '../types';
import { MULTICONTRAST_DATASET_FIXTURE as DS, MULTICONTRAST_TRACK_FIXTURE as FIXTURE } from './fixtures';

// The track-column module is the one load lifecycle the Compare tab, the compare
// set and the report previews share, so its states are tested here, through its
// interface, with a map-backed bundle transport: no DOM, no window globals, and
// a sibling bundle that lands exactly when the test releases it.

const BASE = '/datasets/mouse_fasting_tc';
const META = { populations: ['whole', 'other_population'], labels: {}, types: {}, nGenes: {}, colors: {}, qcFlags: {} };
const TRUST_OMIT: TrackColumnPolicy = { pathways: 'omit', trackList: 'trust' };
const TRUST_INCLUDE: TrackColumnPolicy = { pathways: 'include', trackList: 'trust' };
const VERIFY_INCLUDE: TrackColumnPolicy = { pathways: 'include', trackList: 'verify' };

let requests: string[];
let files: Record<string, unknown>;
let failing: Set<string>;
let gates: Map<string, Promise<void>>;

beforeEach(() => {
  requests = [];
  files = { [`${BASE}/meta.js`]: META, [`${BASE}/track_whole.js`]: { ...FIXTURE } };
  failing = new Set();
  gates = new Map();
  _resetBundleCache();
  _resetTrackCache();
  _setBundleTransport(async (url): Promise<BundleOutcome> => {
    requests.push(url);
    const gate = gates.get(url);
    if (gate) await gate;
    if (failing.has(url) || !(url in files)) return { status: 'load-failed' };
    return { status: 'ok', value: files[url] };
  });
});
afterEach(() => { _setBundleTransport(null); _resetBundleCache(); _resetTrackCache(); });

const request = (trackId: string, contrastId?: string): TrackColumnRequest =>
  ({ dataset: DS, trackId, contrast: getActiveContrast(DS, contrastId) });

/** Hold a URL's response until the returned release is called. */
function gate(url: string): () => void {
  let release = () => {};
  gates.set(url, new Promise<void>((resolve) => { release = resolve; }));
  return release;
}

describe('trackColumns — lifecycle', () => {
  it('moves a column from loading to ready, with popData at the requested contrast', async () => {
    const reqs = [request('whole', 'refed_vs_fed')];
    const { result } = renderHook(() => useTrackColumns(reqs, TRUST_OMIT));
    expect(result.current[0].status).toBe('loading');
    expect(result.current[0].popData).toBeNull();

    await waitFor(() => expect(result.current[0].status).toBe('ready'));
    const [column] = result.current;
    expect(column.error).toBeNull();
    expect(column.raw).toBe(files[`${BASE}/track_whole.js`]);
    expect(column.popData?.deByGene.IGFBP2?.logFC).toBe(0.3);   // refed_vs_fed, not the default
    expect(column.pathwaysSettled).toBe(true);
    // 'trust' asks for no meta.js; 'omit' asks for no sibling.
    expect(requests).toEqual([`${BASE}/track_whole.js`]);
  });

  it('reports a failed bundle with its reason, and retry recovers it', async () => {
    failing.add(`${BASE}/track_whole.js`);
    const reqs = [request('whole')];
    const { result } = renderHook(() => useTrackColumns(reqs, TRUST_OMIT));

    await waitFor(() => expect(result.current[0].status).toBe('failed'));
    expect(result.current[0].error).toMatch(/Failed to load/);
    expect(result.current[0].popData).toBeNull();
    // Settled either way, so a pathway view never waits on a failed column.
    expect(result.current[0].pathwaysSettled).toBe(true);

    failing.clear();
    act(() => { result.current[0].retry(); });
    expect(result.current[0].status).toBe('loading');
    await waitFor(() => expect(result.current[0].status).toBe('ready'));
    expect(result.current[0].error).toBeNull();
    expect(requests.filter((url) => url.endsWith('/track_whole.js'))).toHaveLength(2);
  });

  it('reports a track the dataset does not list as unknown-track, without fetching it', async () => {
    const reqs = [request('dropped_track')];
    const { result } = renderHook(() => useTrackColumns(reqs, VERIFY_INCLUDE));

    await waitFor(() => expect(result.current[0].status).toBe('unknown-track'));
    expect(result.current[0].meta).toEqual(META);
    expect(result.current[0].pathwaysSettled).toBe(true);
    expect(requests).toEqual([`${BASE}/meta.js`]);
  });

  it('exposes the meta under verify, and a failed meta fails the column', async () => {
    const reqs = [request('whole')];
    const { result } = renderHook(() => useTrackColumns(reqs, VERIFY_INCLUDE));
    await waitFor(() => expect(result.current[0].status).toBe('ready'));
    expect(result.current[0].meta).toEqual(META);

    _resetBundleCache();
    _resetTrackCache();
    failing.add(`${BASE}/meta.js`);
    const second = renderHook(() => useTrackColumns(reqs, VERIFY_INCLUDE));
    await waitFor(() => expect(second.result.current[0].status).toBe('failed'));
    expect(second.result.current[0].error).toMatch(/dataset metadata/);
  });
});

describe('trackColumns — pathway sibling', () => {
  it('is ready before the sibling lands, then re-reads popData when it settles', async () => {
    const siblingUrl = `${BASE}/track_whole.pathways.js`;
    files[`${BASE}/track_whole.js`] = { ...FIXTURE, pathways: undefined, pathwaysByContrast: undefined } as RawTrack;
    files[siblingUrl] = { default: FIXTURE.pathways, byContrast: FIXTURE.pathwaysByContrast };
    const release = gate(siblingUrl);

    const reqs = [request('whole')];
    const { result } = renderHook(() => useTrackColumns(reqs, TRUST_INCLUDE));
    await waitFor(() => expect(result.current[0].status).toBe('ready'));
    // First paint is not blocked on the sibling, and does not pretend it landed.
    expect(result.current[0].pathwaysSettled).toBe(false);
    expect(result.current[0].popData?.allPathways).toEqual([]);

    await act(async () => { release(); });
    await waitFor(() => expect(result.current[0].pathwaysSettled).toBe(true));
    expect(result.current[0].popData?.allPathways.length).toBeGreaterThan(0);
  });

  it('settles a failed sibling as "no pathways", and retry asks for it again', async () => {
    const siblingUrl = `${BASE}/track_whole.pathways.js`;
    files[`${BASE}/track_whole.js`] = { ...FIXTURE, pathways: undefined, pathwaysByContrast: undefined } as RawTrack;
    failing.add(siblingUrl);

    const reqs = [request('whole')];
    const { result } = renderHook(() => useTrackColumns(reqs, TRUST_INCLUDE));
    await waitFor(() => expect(result.current[0].pathwaysSettled).toBe(true));
    expect(result.current[0].status).toBe('ready');
    expect(result.current[0].popData?.allPathways).toEqual([]);

    failing.clear();
    files[siblingUrl] = { default: FIXTURE.pathways, byContrast: FIXTURE.pathwaysByContrast };
    act(() => { result.current[0].retry(); });
    await waitFor(() => expect(result.current[0].popData?.allPathways.length).toBeGreaterThan(0));
    expect(requests.filter((url) => url === siblingUrl)).toHaveLength(2);
  });
});

describe('trackColumns — columns are independent', () => {
  it('lets one column fail without holding back the others', async () => {
    const reqs = [request('whole'), request('other_population')];
    const { result } = renderHook(() => useTrackColumns(reqs, TRUST_OMIT));
    await waitFor(() => expect(result.current.map((c) => c.status)).toEqual(['ready', 'failed']));
    expect(result.current[0].popData).not.toBeNull();
  });

  it('never reloads a retained column, and re-reads popData on a contrast switch without a request', async () => {
    const { result, rerender } = renderHook(
      ({ reqs }) => useTrackColumns(reqs, TRUST_OMIT),
      { initialProps: { reqs: [request('whole'), request('other_population')] } },
    );
    await waitFor(() => expect(result.current[0].status).toBe('ready'));
    const before = requests.length;

    // Drop a column: the retained one keeps its state and makes no request.
    rerender({ reqs: [request('whole')] });
    expect(result.current).toHaveLength(1);
    expect(result.current[0].status).toBe('ready');

    // An equal list rebuilt by a re-render keeps the same column list.
    const stable = result.current;
    rerender({ reqs: [request('whole')] });
    expect(result.current).toBe(stable);

    // Switch contrast: new popData, same raw, still no request.
    expect(result.current[0].popData?.deByGene.IGFBP2?.logFC).toBe(-1.4);
    rerender({ reqs: [request('whole', 'refed_vs_fed')] });
    expect(result.current[0].popData?.deByGene.IGFBP2?.logFC).toBe(0.3);
    expect(requests.length).toBe(before);
  });
});

describe('trackColumns — queued columns', () => {
  it('never fetches a trust column removed while it was still queued', async () => {
    // FANOUT is 6: hold the first six, queue a seventh, then trim it away.
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
    const releases = ids.slice(0, 6).map((id) => gate(`${BASE}/track_${id}.js`));
    const all = ids.map((id) => request(id));
    const { rerender } = renderHook(({ reqs }) => useTrackColumns(reqs, TRUST_OMIT), { initialProps: { reqs: all } });
    await waitFor(() => expect(requests.filter((u) => u.includes('track_p')).length).toBe(6));
    rerender({ reqs: all.slice(0, 6) });
    await act(async () => { for (const release of releases) release(); });
    await waitFor(() => expect(requests.filter((u) => u.includes('track_p')).length).toBeGreaterThanOrEqual(6));
    expect(requests).not.toContain(`${BASE}/track_p7.js`);
  });
});

