// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { queryGeneAcrossDatasets, queryPathwayAcrossDatasets, loadPathwayIndex, loadGeneIndex } from '../data/crossDataset';
import { loadDatasetMeta } from '../data/loadDatasetMeta';
import { _resetTrackCache } from '../data/loadTrack';
import {
  BULK_DATASET_FIXTURE,
  BULK_TRACK_FIXTURE,
  MULTICONTRAST_DATASET_FIXTURE,
  MULTICONTRAST_TRACK_FIXTURE,
} from './fixtures';

// The cross-dataset queries have two paths: the precomputed inverted index
// (public/query/**, 2 small requests) and the legacy fallback that downloads
// every track bundle of every dataset. These tests pin the contract between
// them, because the failure modes are silent:
//   - a broken index yields an EMPTY report, not an error (a missing shard is
//     indistinguishable from "gene present in no track"),
//   - and a fallback that stops triggering turns a 2-request query back into a
//     ~100-request, 284 MB one with nothing failing.
//
// Script injection is stubbed the same way the loader tests do it: intercept
// document.createElement, inspect the requested src, and either publish the
// matching window global + fire onload, or fire onerror.

const DS = BULK_DATASET_FIXTURE;   // single dataset, single track 'whole'

// Serve a fake /query/** tree. `files` maps a URL substring -> the global name
// and value that loading it should publish. Anything not listed 404s (onerror).
function stubQueryFiles(files: Record<string, { global: string; value: unknown }>) {
  const orig = document.createElement.bind(document);
  const requested: string[] = [];
  vi.spyOn(document, 'createElement').mockImplementation((tag: any) => {
    const el = orig(tag);
    if (tag === 'script') {
      setTimeout(() => {
        const src: string = el.src || '';
        requested.push(src);
        const hit = Object.keys(files).find((k) => src.includes(k));
        if (hit) {
          (window as any)[files[hit].global] = files[hit].value;
          el.onload?.(new Event('load'));
        } else {
          el.onerror?.(new Event('error'));
        }
      }, 0);
    }
    return el;
  });
  return { requested };
}

const BUILD_ID = 'testbuild1';

// Shards ship as { b: buildId, d: payload }; the client refuses a shard whose
// build id does not match the manifest's, because trackIdx values are positions
// in the manifest's track array and a mixed pair silently maps rows to the
// wrong tracks.
const shard = (d: unknown) => ({ b: BUILD_ID, d });

const MANIFEST = {
  v: 1,
  buildId: BUILD_ID,
  geneShards: 512,
  pathwayShards: 256,
  dbNames: ['GO_BP', 'HALLMARK'],
  tracks: [
    { ds: DS.id, trackId: 'whole', label: 'Whole hypothalamus', type: 'Tissue', lowPower: false },
  ],
  datasets: [{
    ds: DS.id,
    trackCount: 1,
    defaultTrack: DS.defaultTrack,
    trackLabel: 'Whole hypothalamus',
    nGenes: 2,
    nBaseline: 5,
    nCase: 5,
    nVaries: false,
    lowPowerTracks: 0,
    contrastId: 'hfd_vs_chow',
    armKeys: ['chow', 'hfd'],
  }],
};

// Globals the stubs publish; cleared between tests so a cached shard cannot leak.
const GLOBALS = [
  'HX_QUERY_TRACKS', 'HX_QUERY_PATHWAY_NAMES', 'HX_QUERY_GENE_NAMES',
  ...Array.from({ length: 512 }, (_, i) => `HX_QUERY_GENES_${String(i).padStart(3, '0')}`),
  ...Array.from({ length: 256 }, (_, i) => `HX_QUERY_PATHWAYS_${String(i).padStart(3, '0')}`),
];

beforeEach(() => { _resetTrackCache(); });
afterEach(() => {
  vi.restoreAllMocks();
  for (const g of GLOBALS) delete (window as any)[g];
  delete (window as any).HX_MOUSE_BULK_HFD_WHOLE;
  delete (window as any).HX_MOUSE_BULK_HFD_ARCUATE;
  delete (window as any).HX_MOUSE_BULK_HFD_META;
  delete (window as any).HX_MOUSE_FASTING_TC_WHOLE;
  delete (window as any).HX_MOUSE_FASTING_TC_WHOLE_PATH;
  delete (window as any).HX_MOUSE_FASTING_TC_META;
});

describe('shard hash — golden vectors', () => {
  // The shard for a key is FNV-1a(key) % N, implemented TWICE: in
  // scripts/build_query_index.mts (which decides which file a key is written to)
  // and in src/data/queryIndex.ts (which decides which file to request). If the
  // two ever disagree the client fetches a shard that simply does not contain
  // the key — and "key not in this shard" is indistinguishable from "gene not
  // present in any track", so the app would report confident, empty results with
  // no error anywhere.
  //
  // These vectors pin the hash so a one-sided change fails loudly here instead.
  // They were produced by the generator; if you change the hash, both sides and
  // this table must move together AND the whole index must be rebuilt.
  // Read back out of the real emitted public/query/** tree, not computed by
  // hand — the point is to pin what the GENERATOR actually did.
  const VECTORS: Array<[string, number]> = [
    ['POMC', 220],
    ['AGRP', 331],
    ['LEPR', 340],
    ['IGF1', 244],
    ['HALLMARK_INFLAMMATORY_RESPONSE', 189],
  ];

  function fnv1a(str: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  it('routes known keys to the shards the generator wrote them to', () => {
    for (const [key, expected] of VECTORS) {
      const n = key.startsWith('HALLMARK_') ? 256 : 512;
      expect(`${key} -> ${fnv1a(key) % n}`).toBe(`${key} -> ${expected}`);
    }
  });
});

describe('cross-dataset query — index fast path', () => {
  it('answers a gene query from the manifest + one shard, without touching any track bundle', async () => {
    // The shard file is whichever one the client asks for — we match on the
    // /genes/ path segment rather than recomputing the hash, so the test does not
    // duplicate (and therefore cannot silently disagree with) the hash function.
    // Shards live under /query/<buildId>/, so the build id is not matched on.
    let shardGlobal = '';
    const orig = document.createElement.bind(document);
    const requested: string[] = [];
    vi.spyOn(document, 'createElement').mockImplementation((tag: any) => {
      const el = orig(tag);
      if (tag === 'script') {
        setTimeout(() => {
          const src: string = el.src || '';
          requested.push(src);
          if (src.includes('/query/tracks.js')) {
            (window as any).HX_QUERY_TRACKS = MANIFEST;
            el.onload?.(new Event('load'));
          } else if (src.includes('/genes/')) {
            const m = src.match(/\/genes\/g(\d{3})\.js/);
            shardGlobal = `HX_QUERY_GENES_${m![1]}`;
            (window as any)[shardGlobal] = shard({
              POMC: [[0, 1.234, 0.0001, 0.004, 0.31]],
            });
            el.onload?.(new Event('load'));
          } else {
            el.onerror?.(new Event('error'));
          }
        }, 0);
      }
      return el;
    });

    const report = await queryGeneAcrossDatasets('POMC', { datasets: [DS] });

    expect(report.groups).toHaveLength(1);
    expect(report.groups[0].tracks).toEqual([
      {
        trackId: 'whole',
        label: 'Whole hypothalamus',
        type: 'Tissue',
        logFC: 1.234,
        fdr: 0.004,
        pval: 0.0001,
        se: 0.31,
        direction: 'up',
        significant: true,
        lowPower: false,
      },
    ]);
    // Exactly two requests, and NOT the track bundle.
    expect(requested).toHaveLength(2);
    expect(requested.some((r) => r.includes('track_whole.js'))).toBe(false);
  });

  it('is case-insensitive on the gene symbol (macaque POMC vs mouse Pomc)', async () => {
    const orig = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: any) => {
      const el = orig(tag);
      if (tag === 'script') {
        setTimeout(() => {
          const src: string = el.src || '';
          if (src.includes('/query/tracks.js')) {
            (window as any).HX_QUERY_TRACKS = MANIFEST;
            el.onload?.(new Event('load'));
          } else if (src.includes('/genes/')) {
            const m = src.match(/\/genes\/g(\d{3})\.js/);
            (window as any)[`HX_QUERY_GENES_${m![1]}`] = shard({ POMC: [[0, -2, 0.01, 0.02, 0.5]] });
            el.onload?.(new Event('load'));
          } else el.onerror?.(new Event('error'));
        }, 0);
      }
      return el;
    });
    const report = await queryGeneAcrossDatasets('Pomc', { datasets: [DS] });
    expect(report.groups[0].tracks[0].logFC).toBe(-2);
    expect(report.groups[0].tracks[0].direction).toBe('down');
  });

  it('reports a gene that is in the index but in no track as an empty group (absence reads as absence)', async () => {
    const orig = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: any) => {
      const el = orig(tag);
      if (tag === 'script') {
        setTimeout(() => {
          const src: string = el.src || '';
          if (src.includes('/query/tracks.js')) {
            (window as any).HX_QUERY_TRACKS = MANIFEST;
            el.onload?.(new Event('load'));
          } else if (src.includes('/genes/')) {
            const m = src.match(/\/genes\/g(\d{3})\.js/);
            (window as any)[`HX_QUERY_GENES_${m![1]}`] = shard({}); // shard loaded, gene absent
            el.onload?.(new Event('load'));
          } else el.onerror?.(new Event('error'));
        }, 0);
      }
      return el;
    });
    const report = await queryGeneAcrossDatasets('NOTAGENE', { datasets: [DS] });
    expect(report.groups[0].tracks).toEqual([]);
    expect(report.groups[0].error).toBeUndefined();
  });

  it('answers a pathway query from the index, mapping dbIdx back to the db name', async () => {
    const orig = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: any) => {
      const el = orig(tag);
      if (tag === 'script') {
        setTimeout(() => {
          const src: string = el.src || '';
          if (src.includes('/query/tracks.js')) {
            (window as any).HX_QUERY_TRACKS = MANIFEST;
            el.onload?.(new Event('load'));
          } else if (src.includes('/pathways/')) {
            const m = src.match(/\/pathways\/p(\d{3})\.js/);
            (window as any)[`HX_QUERY_PATHWAYS_${m![1]}`] = shard({
              HALLMARK_INFLAMMATORY_RESPONSE: [[0, 1.9, 0.01, 0.002, 200, 1]],
            });
            el.onload?.(new Event('load'));
          } else el.onerror?.(new Event('error'));
        }, 0);
      }
      return el;
    });
    const report = await queryPathwayAcrossDatasets('HALLMARK_INFLAMMATORY_RESPONSE', { datasets: [DS] });
    expect(report.groups[0].tracks[0]).toMatchObject({
      trackId: 'whole', NES: 1.9, padj: 0.01, pval: 0.002, size: 200,
      db: 'HALLMARK',      // dbIdx 1 -> MANIFEST.dbNames[1]
      direction: 'up', significant: true,
    });
  });
});

describe('cross-dataset query — fallback when the index is absent', () => {
  it('falls back to loading track bundles when /query/tracks.js 404s', async () => {
    const { requested } = stubQueryFiles({
      // Only the legacy artifacts exist — every /query/ request 404s.
      'meta.js': { global: 'HX_MOUSE_BULK_HFD_META', value: { populations: ['whole'], labels: { whole: 'Whole' }, types: {}, qcFlags: {} } },
      'track_whole.js': { global: 'HX_MOUSE_BULK_HFD_WHOLE', value: BULK_TRACK_FIXTURE },
    });

    const report = await queryGeneAcrossDatasets('POMC', { datasets: [DS] });

    // It tried the index first, then fell back to the bundle path.
    expect(requested.some((r) => r.includes('/query/tracks.js'))).toBe(true);
    expect(requested.some((r) => r.includes('track_whole.js'))).toBe(true);
    expect(report.groups).toHaveLength(1);
  });

  it('falls back when the manifest does not cover a queried dataset (stale index after a new dataset lands)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const DS_NEW = { ...DS, id: 'brand_new_dataset' } as typeof DS;
    const { requested } = stubQueryFiles({
      // Manifest knows only about DS, not DS_NEW.
      '/query/tracks.js': { global: 'HX_QUERY_TRACKS', value: MANIFEST },
      'meta.js': { global: 'HX_MOUSE_BULK_HFD_META', value: { populations: ['whole'], labels: {}, types: {}, qcFlags: {} } },
      'track_whole.js': { global: 'HX_MOUSE_BULK_HFD_WHOLE', value: BULK_TRACK_FIXTURE },
    });

    await queryGeneAcrossDatasets('POMC', { datasets: [DS, DS_NEW] });

    // Serving an empty track list for the uncovered dataset would render as
    // "Gene not detected in this dataset" — a claim of ABSENCE for a dataset
    // whose bundles were never read. A stale index must degrade to slow, never
    // to wrong.
    expect(warn).toHaveBeenCalled();
    expect(requested.some((r) => r.includes('track_whole.js'))).toBe(true);
  });

  it('serves the registered default from legacy de when deByContrast contains only non-defaults', async () => {
    stubQueryFiles({
      'meta.js': {
        global: 'HX_MOUSE_FASTING_TC_META',
        value: { populations: ['whole'], labels: { whole: 'Whole' }, types: {}, qcFlags: {} },
      },
      'track_whole.js': { global: 'HX_MOUSE_FASTING_TC_WHOLE', value: MULTICONTRAST_TRACK_FIXTURE },
    });

    const report = await queryGeneAcrossDatasets('IGFBP2', { datasets: [MULTICONTRAST_DATASET_FIXTURE] });

    // This is the committed GSE135639 shape: legacy de is the registered
    // default, while deByContrast carries only non-default tables.
    expect(report.groups[0].tracks.map((track) => track.logFC)).toEqual([-1.4]);
  });

  const replacementDataset = {
      ...MULTICONTRAST_DATASET_FIXTURE,
      contrasts: [
        { id: 'refed_vs_fed', baseline: 'fed', case: 'refed' },
        { id: 'new_default', baseline: 'fed', case: 'fast24', isDefault: true },
      ],
    };

  it.each([
    ['plain legacy sibling', BULK_TRACK_FIXTURE.pathways, 1],
    [
      'wrapper carrying the registered default id',
      { default: BULK_TRACK_FIXTURE.pathways, byContrast: { new_default: BULK_TRACK_FIXTURE.pathways } },
      1,
    ],
    [
      // The committed GSE135639 shape: byContrast holds only non-defaults, the
      // default's table lives in the `default` block. Serving it is the
      // contract; a stale bundle predating a default swap is indistinguishable
      // here and is the manifest freshness check's problem.
      'wrapper whose byContrast holds only non-defaults',
      { default: BULK_TRACK_FIXTURE.pathways, byContrast: { refed_vs_fed: MULTICONTRAST_TRACK_FIXTURE.pathways } },
      1,
    ],
  ])('applies the pathway default contract for a %s', async (_shape, sibling, expectedTracks) => {
    stubQueryFiles({
      'meta.js': {
        global: 'HX_MOUSE_FASTING_TC_META',
        value: { populations: ['whole'], labels: { whole: 'Whole' }, types: {}, qcFlags: {} },
      },
      'track_whole.pathways.js': {
        global: 'HX_MOUSE_FASTING_TC_WHOLE_PATH',
        value: sibling,
      },
    });

    const report = await queryPathwayAcrossDatasets('GOBP_ENERGY_HOMEOSTASIS', { datasets: [replacementDataset] });

    expect(report.groups[0].tracks).toHaveLength(expectedTracks);
  });

  it('refuses a shard from a different build and falls back (mixed manifest/shard = wrong tracks)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const orig = document.createElement.bind(document);
    const requested: string[] = [];
    vi.spyOn(document, 'createElement').mockImplementation((tag: any) => {
      const el = orig(tag);
      if (tag === 'script') {
        setTimeout(() => {
          const src: string = el.src || '';
          requested.push(src);
          if (src.includes('/query/tracks.js')) {
            (window as any).HX_QUERY_TRACKS = MANIFEST;
            el.onload?.(new Event('load'));
          } else if (src.includes('/genes/')) {
            const m = src.match(/\/genes\/g(\d{3})\.js/);
            // Stale shard: right shape, WRONG build.
            (window as any)[`HX_QUERY_GENES_${m![1]}`] = { b: 'otherbuild', d: { POMC: [[0, 9, 0.01, 0.02, 0.5]] } };
            el.onload?.(new Event('load'));
          } else if (src.includes('meta.js')) {
            (window as any).HX_MOUSE_BULK_HFD_META = { populations: ['whole'], labels: {}, types: {}, qcFlags: {} };
            el.onload?.(new Event('load'));
          } else if (src.includes('track_whole.js')) {
            (window as any).HX_MOUSE_BULK_HFD_WHOLE = BULK_TRACK_FIXTURE;
            el.onload?.(new Event('load'));
          } else el.onerror?.(new Event('error'));
        }, 0);
      }
      return el;
    });

    await queryGeneAcrossDatasets('POMC', { datasets: [DS] });

    // trackIdx values are positions in the manifest's track array, so a shard
    // built against a different manifest maps every row to the wrong track —
    // silently. Must be refused, not used.
    expect(warn).toHaveBeenCalled();
    expect(requested.some((r) => r.includes('track_whole.js'))).toBe(true);
  });

  it('ignores a manifest whose shard counts disagree with the client and falls back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { requested } = stubQueryFiles({
      '/query/tracks.js': { global: 'HX_QUERY_TRACKS', value: { ...MANIFEST, geneShards: 64 } },
      'meta.js': { global: 'HX_MOUSE_BULK_HFD_META', value: { populations: ['whole'], labels: {}, types: {}, qcFlags: {} } },
      'track_whole.js': { global: 'HX_MOUSE_BULK_HFD_WHOLE', value: BULK_TRACK_FIXTURE },
    });

    await queryGeneAcrossDatasets('POMC', { datasets: [DS] });

    // A wrong shard count would send every lookup to a URL that 404s, which is
    // indistinguishable from "gene not found" — so it must be refused loudly and
    // fall back rather than silently return empty reports.
    expect(warn).toHaveBeenCalled();
    expect(requested.some((r) => r.includes('track_whole.js'))).toBe(true);
  });
});

describe('cross-dataset query — contrast freshness guard', () => {
  it('falls back when the manifest summary names a different default contrast', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manifest = {
      ...MANIFEST,
      datasets: [{ ...MANIFEST.datasets[0], contrastId: 'hfd_vs_ncd' }],
    };
    const { requested } = stubQueryFiles({
      '/query/tracks.js': { global: 'HX_QUERY_TRACKS', value: manifest },
      'meta.js': {
        global: 'HX_MOUSE_BULK_HFD_META',
        value: { populations: ['whole'], labels: {}, types: {}, qcFlags: {} },
      },
      'track_whole.js': { global: 'HX_MOUSE_BULK_HFD_WHOLE', value: BULK_TRACK_FIXTURE },
    });

    await queryGeneAcrossDatasets('POMC', { datasets: [DS] });

    expect(warn).toHaveBeenCalled();
    expect(requested.some((request) => request.includes('track_whole.js'))).toBe(true);
  });

  it('stays on the fast path when the summary contrast matches', async () => {
    const { requested } = stubQueryFiles({
      '/query/tracks.js': { global: 'HX_QUERY_TRACKS', value: MANIFEST },
      '/genes/g220.js': {
        global: 'HX_QUERY_GENES_220',
        value: shard({ POMC: [[0, 1.5, 0.001, 0.01, 0.2]] }),
      },
    });

    const report = await queryGeneAcrossDatasets('POMC', { datasets: [DS] });

    expect(report.groups[0].tracks.map((track) => track.logFC)).toEqual([1.5]);
    expect(requested.some((request) => request.includes('track_whole.js'))).toBe(false);
  });

  it('falls back for a pre-summary manifest because contrast freshness is unverifiable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { datasets: _datasets, ...preSummaryManifest } = MANIFEST;
    const { requested } = stubQueryFiles({
      '/query/tracks.js': { global: 'HX_QUERY_TRACKS', value: preSummaryManifest },
      'meta.js': {
        global: 'HX_MOUSE_BULK_HFD_META',
        value: { populations: ['whole'], labels: {}, types: {}, qcFlags: {} },
      },
      'track_whole.js': { global: 'HX_MOUSE_BULK_HFD_WHOLE', value: BULK_TRACK_FIXTURE },
    });

    await queryGeneAcrossDatasets('POMC', { datasets: [DS] });

    expect(warn).toHaveBeenCalled();
    expect(requested.some((request) => request.includes('track_whole.js'))).toBe(true);
  });
});

describe('cross-dataset query — track-count freshness guard', () => {
  // manifestCovers used to check only that each queried DATASET id appears in
  // the manifest, so a bundle redeploy that added or removed TRACKS within a
  // covered dataset sailed through: the index silently omitted the new tracks
  // ("gene not detected" for data never read) or resurrected removed ones.
  // The manifest now records per-dataset track counts, and where this session
  // has ALREADY loaded a dataset's meta.js (peek only — no extra fetch), the
  // two are compared; any mismatch falls back to the slow path.
  const STALE_META = {
    // meta.js after a redeploy that added a track the index has never seen.
    populations: ['whole', 'arcuate'],
    labels: { whole: 'Whole', arcuate: 'Arcuate' },
    types: {},
    qcFlags: {},
  };

  it('falls back when an already-loaded meta.js declares tracks the manifest does not count', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { requested } = stubQueryFiles({
      '/query/tracks.js': { global: 'HX_QUERY_TRACKS', value: { ...MANIFEST, trackCounts: { [DS.id]: 1 } } },
      'meta.js': { global: 'HX_MOUSE_BULK_HFD_META', value: STALE_META },
      'track_whole.js': { global: 'HX_MOUSE_BULK_HFD_WHOLE', value: BULK_TRACK_FIXTURE },
      'track_arcuate.js': { global: 'HX_MOUSE_BULK_HFD_ARCUATE', value: BULK_TRACK_FIXTURE },
    });
    await loadDatasetMeta(DS);   // the session holds the meta, so the peek can see it

    await queryGeneAcrossDatasets('POMC', { datasets: [DS] });

    // The index knows 1 track, the meta declares 2 — trusting the index would
    // claim absence for the track it never read. Must degrade to slow.
    expect(warn).toHaveBeenCalled();
    expect(requested.some((r) => r.includes('track_whole.js'))).toBe(true);
  });

  it('keeps the guard armed for manifests published before trackCounts existed (derived count)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { requested } = stubQueryFiles({
      // MANIFEST has no trackCounts field and one track entry for DS.
      '/query/tracks.js': { global: 'HX_QUERY_TRACKS', value: MANIFEST },
      'meta.js': { global: 'HX_MOUSE_BULK_HFD_META', value: STALE_META },
      'track_whole.js': { global: 'HX_MOUSE_BULK_HFD_WHOLE', value: BULK_TRACK_FIXTURE },
      'track_arcuate.js': { global: 'HX_MOUSE_BULK_HFD_ARCUATE', value: BULK_TRACK_FIXTURE },
    });
    await loadDatasetMeta(DS);

    await queryGeneAcrossDatasets('POMC', { datasets: [DS] });

    expect(warn).toHaveBeenCalled();
    expect(requested.some((r) => r.includes('track_whole.js'))).toBe(true);
  });

  it('stays on the fast path when the loaded meta agrees with the manifest count', async () => {
    // POMC hashes to gene shard 220 — pinned by the golden vectors above.
    const { requested } = stubQueryFiles({
      '/query/tracks.js': { global: 'HX_QUERY_TRACKS', value: { ...MANIFEST, trackCounts: { [DS.id]: 1 } } },
      'meta.js': {
        global: 'HX_MOUSE_BULK_HFD_META',
        value: { populations: ['whole'], labels: { whole: 'Whole' }, types: {}, qcFlags: {} },
      },
      '/genes/g220.js': { global: 'HX_QUERY_GENES_220', value: shard({ POMC: [[0, 1.5, 0.001, 0.01, 0.2]] }) },
    });
    await loadDatasetMeta(DS);

    const report = await queryGeneAcrossDatasets('POMC', { datasets: [DS] });

    expect(report.groups[0].tracks.map((t) => t.logFC)).toEqual([1.5]);
    expect(requested.some((r) => r.includes('track_whole.js'))).toBe(false);
  });

  it('skips the disk identity check — without fetching meta — when meta was never loaded', async () => {
    // The comparison is opportunistic BY DESIGN: fetching meta.js per dataset
    // is exactly the fan-out the index exists to avoid. An unloaded meta means
    // "unknown", not "stale" — the index is used, and no meta request is made.
    const { requested } = stubQueryFiles({
      '/query/tracks.js': { global: 'HX_QUERY_TRACKS', value: { ...MANIFEST, trackCounts: { [DS.id]: 1 } } },
      '/genes/g220.js': { global: 'HX_QUERY_GENES_220', value: shard({ POMC: [[0, 1.5, 0.001, 0.01, 0.2]] }) },
    });

    const report = await queryGeneAcrossDatasets('POMC', { datasets: [DS] });

    expect(report.groups[0].tracks).toHaveLength(1);
    expect(requested.some((r) => r.includes('meta.js'))).toBe(false);
    expect(requested.some((r) => r.includes('track_whole.js'))).toBe(false);
  });
});

describe('cross-dataset query — flattened multi-dataset fan-out', () => {
  // The per-dataset serial loop was replaced by one global concurrency queue
  // that flattens every (dataset, track) pair and re-groups by index afterwards.
  // These pin the two things that regrouping can silently get wrong: which group
  // a row lands in, and how many rows survive per group.
  const DS2 = { ...DS, id: 'ds_two', name: 'Second dataset' } as typeof DS;

  const MULTI_MANIFEST = {
    ...MANIFEST,
    tracks: [
      { ds: DS.id, trackId: 'a', label: 'A', type: 'Tissue', lowPower: false },
      { ds: DS2.id, trackId: 'x', label: 'X', type: 'Tissue', lowPower: false },
      { ds: DS.id, trackId: 'b', label: 'B', type: 'Tissue', lowPower: true },
      { ds: DS2.id, trackId: 'y', label: 'Y', type: 'Tissue', lowPower: false },
      { ds: DS.id, trackId: 'c', label: 'C', type: 'Tissue', lowPower: false },
    ],
    datasets: [MANIFEST.datasets[0], { ...MANIFEST.datasets[0], ds: DS2.id }],
  };

  function stubMulti(rows: unknown[]) {
    const orig = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: any) => {
      const el = orig(tag);
      if (tag === 'script') {
        setTimeout(() => {
          const src: string = el.src || '';
          if (src.includes('/query/tracks.js')) {
            (window as any).HX_QUERY_TRACKS = MULTI_MANIFEST;
            el.onload?.(new Event('load'));
          } else if (src.includes('/genes/')) {
            const m = src.match(/\/genes\/g(\d{3})\.js/);
            (window as any)[`HX_QUERY_GENES_${m![1]}`] = shard({ POMC: rows });
            el.onload?.(new Event('load'));
          } else el.onerror?.(new Event('error'));
        }, 0);
      }
      return el;
    });
  }

  it('routes each track to its own dataset group, interleaved manifest order and all', async () => {
    // Manifest order interleaves the two datasets (a, x, b, y, c) — exactly the
    // case a naive positional regroup would scramble.
    stubMulti([
      [0, 1.0, 0.01, 0.02, 0.1],
      [1, 2.0, 0.01, 0.02, 0.2],
      [2, 3.0, 0.01, 0.02, 0.3],
      [3, 4.0, 0.01, 0.02, 0.4],
      [4, 5.0, 0.01, 0.02, 0.5],
    ]);
    const report = await queryGeneAcrossDatasets('POMC', { datasets: [DS, DS2] });

    expect(report.groups.map((g) => g.dataset.id)).toEqual([DS.id, DS2.id]);
    expect(report.groups[0].tracks.map((t) => t.trackId)).toEqual(['a', 'b', 'c']);
    expect(report.groups[1].tracks.map((t) => t.trackId)).toEqual(['x', 'y']);
    // Per-track fields follow the track, not the position.
    expect(report.groups[0].tracks.map((t) => t.logFC)).toEqual([1.0, 3.0, 5.0]);
    expect(report.groups[1].tracks.map((t) => t.logFC)).toEqual([2.0, 4.0]);
    expect(report.groups[0].tracks.map((t) => t.lowPower)).toEqual([false, true, false]);
  });

  it('keeps per-track granularity — a multi-population dataset stays N rows, not one', async () => {
    // The report shows every track's own effect and its own 95% CI, and nothing
    // averages them: a multi-population dataset's tracks share animals, so a
    // combined estimate would carry an SE ~sqrt(k) too small. If the index ever
    // returned ONE pre-pooled row per dataset, that falsely narrow interval
    // would arrive upstream and invisibly.
    stubMulti([
      [0, 1.0, 0.01, 0.02, 0.1],
      [2, 3.0, 0.01, 0.02, 0.3],
      [4, 5.0, 0.01, 0.02, 0.5],
    ]);
    const report = await queryGeneAcrossDatasets('POMC', { datasets: [DS] });
    const seBearing = report.groups[0].tracks.filter((t) => t.se != null);
    expect(seBearing).toHaveLength(3);
    expect(seBearing.map((t) => t.se)).toEqual([0.1, 0.3, 0.5]);
  });

  it('omits tracks the gene is absent from without shifting the others', async () => {
    stubMulti([
      [0, 1.0, 0.01, 0.02, 0.1],
      [4, 5.0, 0.01, 0.02, 0.5],
    ]);
    const report = await queryGeneAcrossDatasets('POMC', { datasets: [DS, DS2] });
    expect(report.groups[0].tracks.map((t) => t.trackId)).toEqual(['a', 'c']);
    expect(report.groups[1].tracks).toEqual([]);
  });
});

describe('pathway autocomplete index', () => {
  // The names file lives under /query/<buildId>/, so the manifest has to be
  // resolved first to know the prefix — it is 11 KB, session-cached, and the
  // pathway query that follows needs it anyway.
  it('prefers the single shared names file over the per-dataset fan-out', async () => {
    const { requested } = stubQueryFiles({
      '/query/tracks.js': { global: 'HX_QUERY_TRACKS', value: MANIFEST },
      '/pathway_names.js': { global: 'HX_QUERY_PATHWAY_NAMES', value: shard(['HALLMARK_A', 'GOBP_B']) },
    });
    const names = await loadPathwayIndex({ datasets: [{ ...DS, supportsPathways: true }] });
    expect(names).toEqual(['HALLMARK_A', 'GOBP_B']);
    // The 41-request / 5.52 MB per-dataset fan-out must not happen.
    expect(requested.some((r) => r.includes('pathways_index.js'))).toBe(false);
    // …and it asked under the build-id prefix, not a bare path.
    expect(requested.some((r) => /\/query\/testbuild1\/pathway_names\.js/.test(r))).toBe(true);
  });

  it('falls back to the per-dataset pathways_index.js files when the shared file is absent', async () => {
    const { requested } = stubQueryFiles({
      '/query/tracks.js': { global: 'HX_QUERY_TRACKS', value: MANIFEST },
      'pathways_index.js': { global: 'HX_MOUSE_BULK_HFD_PATHIDX', value: ['GOBP_LEGACY'] },
    });
    const names = await loadPathwayIndex({ datasets: [{ ...DS, supportsPathways: true }] });
    expect(requested.some((r) => r.includes('/pathway_names.js'))).toBe(true);
    expect(names).toEqual(['GOBP_LEGACY']);
  });

  it('falls back when the manifest itself is unavailable (no build id, no prefix)', async () => {
    const { requested } = stubQueryFiles({
      'pathways_index.js': { global: 'HX_MOUSE_BULK_HFD_PATHIDX', value: ['GOBP_LEGACY'] },
    });
    const names = await loadPathwayIndex({ datasets: [{ ...DS, supportsPathways: true }] });
    // Without a manifest there is no prefix to build a names URL from, so it must
    // not guess one — it degrades to the legacy fan-out.
    expect(requested.some((r) => r.includes('pathway_names.js'))).toBe(false);
    expect(names).toEqual(['GOBP_LEGACY']);
  });
});

describe('gene autocomplete index', () => {
  // The gene sibling of `loadPathwayIndex` above, and deliberately thinner: the
  // pathway version can rebuild its union from each dataset's tiny gs_name
  // manifest, but the gene equivalent would mean downloading every track bundle
  // in the corpus to list what is in them. So there is no fan-out to degrade
  // to, and every failure has to land on the SAME answer — an empty list, which
  // the search box reads as "no suggestions" and stays usable.
  //
  // The thing that would be expensive is the thing with no test otherwise: a
  // future `loadGeneIndex` that threw, or that grew a per-dataset fallback,
  // would turn a 2-request warm-up into a corpus-sized download with nothing
  // failing.
  it('serves the shared names file when the manifest resolves the prefix', async () => {
    const { requested } = stubQueryFiles({
      '/query/tracks.js': { global: 'HX_QUERY_TRACKS', value: MANIFEST },
      '/gene_names.js': { global: 'HX_QUERY_GENE_NAMES', value: shard(['POMC', 'AGRP']) },
    });
    const names = await loadGeneIndex({ datasets: [DS] });
    expect(names).toEqual(['POMC', 'AGRP']);
    // …asked under the build-id prefix, not a bare path.
    expect(requested.some((r) => /\/query\/testbuild1\/gene_names\.js/.test(r))).toBe(true);
  });

  it('returns an empty list — never a track bundle — when the names file is absent', async () => {
    const { requested } = stubQueryFiles({
      '/query/tracks.js': { global: 'HX_QUERY_TRACKS', value: MANIFEST },
    });
    await expect(loadGeneIndex({ datasets: [DS] })).resolves.toEqual([]);
    // The whole point: no fan-out. A suggestion list is never worth a bundle.
    expect(requested.some((r) => r.includes('track_'))).toBe(false);
  });

  it('returns an empty list when the manifest itself is unavailable', async () => {
    // No manifest means no build id, so there is no names URL to build. It must
    // not guess one, and it must not throw — the caller renders a search box.
    const { requested } = stubQueryFiles({});
    await expect(loadGeneIndex({ datasets: [DS] })).resolves.toEqual([]);
    expect(requested.some((r) => r.includes('gene_names.js'))).toBe(false);
  });

  it('reads an empty names payload as no suggestions rather than as a vocabulary', async () => {
    // `loadGeneNames` collapses an empty array to null. Pinned here because the
    // difference matters one layer up: [] must mean "suggest nothing", never
    // "no gene exists", and the box has to let a typed symbol through either
    // way (suggestions are built from default tracks only; the index spans all).
    stubQueryFiles({
      '/query/tracks.js': { global: 'HX_QUERY_TRACKS', value: MANIFEST },
      '/gene_names.js': { global: 'HX_QUERY_GENE_NAMES', value: shard([]) },
    });
    await expect(loadGeneIndex({ datasets: [DS] })).resolves.toEqual([]);
  });
});
