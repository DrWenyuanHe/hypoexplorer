// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadCompareEntriesViaIndex } from '../data/crossDatasetCompare';
import { queryGeneAcrossDatasets } from '../data/crossDataset';
import { _resetTrackCache } from '../data/loadTrack';
import { getGroupedValues } from '../utils/sampleValues';
import { BULK_DATASET_FIXTURE, BULK_TRACK_FIXTURE } from './fixtures';

// The cross-dataset Compare view has two paths: the precomputed EXPRESSION index
// (3 small requests) and the fallback that downloads every dataset's default
// track in full (43 requests, 148.4 MB measured on the shipping corpus).
//
// Every test here exists because the failure it pins is SILENT. An index that
// stops being trusted turns a 3-request query back into a 148 MB one with
// nothing failing; an index that is trusted when it should not be renders a
// plausible chart built from the wrong samples, the wrong contrast, or a
// dataset nobody read. So the assertions are all of the form "does this resolve
// null (fall back) or not", plus one that the values that DO come through are
// the bundle's values.
//
// Script injection is stubbed the way the other loader tests do it: intercept
// document.createElement, inspect the requested src, and either publish the
// matching window global + fire onload, or fire onerror.

const DS = BULK_DATASET_FIXTURE;   // one dataset, one track 'whole', chow vs hfd
const SAMPLES = BULK_TRACK_FIXTURE.meta?.sampleOrder as string[];
const GROUP_SAMPLES = BULK_TRACK_FIXTURE.meta?.groupSamples as Record<string, string[]>;

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
const shard = (d: unknown) => ({ b: BUILD_ID, d });

// FNV-1a % 512 for 'POMC' — the shard both families put it in. Hard-coded so a
// hash change breaks this test rather than silently re-routing it.
const POMC_SHARD = 'g220.js';
const POMC_EXPR_SHARD = 'e220.js';

const SUMMARY = {
  ds: DS.id,
  trackCount: 1,
  defaultTrack: 'whole',
  trackLabel: 'Whole hypothalamus',
  nGenes: 2,
  nBaseline: 5,
  nCase: 5,
  nVaries: false,
  lowPowerTracks: 0,
  sampleOrder: SAMPLES,
  groupSamples: GROUP_SAMPLES,
  contrastId: 'hfd_vs_chow',
};

const manifest = (over: Record<string, unknown> = {}) => ({
  v: 2,
  buildId: BUILD_ID,
  geneShards: 512,
  pathwayShards: 256,
  exprShards: 512,
  dbNames: ['GO_BP', 'HALLMARK'],
  tracks: [{ ds: DS.id, trackId: 'whole', label: 'Whole hypothalamus', type: 'Whole tissue', lowPower: false }],
  trackCounts: { [DS.id]: 1 },
  datasets: [SUMMARY],
  ...over,
});

// The bundle's own POMC row and column, so a test can assert the index answers
// with the same numbers the full-download path would have read.
const POMC_DE = BULK_TRACK_FIXTURE.de?.[1] as { logFC: number; PValue: number; FDR: number | null };
const POMC_CPM = BULK_TRACK_FIXTURE.cpm.POMC as number[];

/** The default files a healthy index serves. `over` replaces or removes entries. */
function indexFiles(over: Record<string, { global: string; value: unknown } | null> = {}) {
  const base: Record<string, { global: string; value: unknown }> = {
    'query/tracks.js': { global: 'HX_QUERY_TRACKS', value: manifest() },
    [`genes/${POMC_SHARD}`]: {
      global: 'HX_QUERY_GENES_220',
      value: shard({ POMC: [[0, POMC_DE.logFC, POMC_DE.PValue, POMC_DE.FDR, 0.4]] }),
    },
    [`expr/${POMC_EXPR_SHARD}`]: {
      // The source symbol rides along because the shard key is uppercased: the
      // chart must still print the dataset's own spelling.
      global: 'HX_QUERY_EXPR_220',
      value: shard({ POMC: [[0, POMC_CPM, 'Pomc']] }),
    },
  };
  for (const [k, v] of Object.entries(over)) {
    if (v === null) delete base[k];
    else base[k] = v;
  }
  return base;
}

const GLOBALS = [
  'HX_QUERY_TRACKS', 'HX_QUERY_GENE_NAMES', 'HX_QUERY_GENES_220', 'HX_QUERY_EXPR_220',
  'HX_MOUSE_BULK_HFD_WHOLE', 'HX_MOUSE_BULK_HFD_META',
];

beforeEach(() => { _resetTrackCache(); });
afterEach(() => {
  vi.restoreAllMocks();
  for (const g of GLOBALS) delete (window as any)[g];
});

describe('loadCompareEntriesViaIndex — the fast path', () => {
  it('builds a chartable popData from the manifest + two shards, and asks for nothing else', async () => {
    const { requested } = stubQueryFiles(indexFiles());
    const entries = await loadCompareEntriesViaIndex('POMC', [DS]);

    expect(entries).not.toBeNull();
    expect(entries).toHaveLength(1);
    const [entry] = entries as NonNullable<typeof entries>;

    // The per-arm values a bar is drawn from, read through the same seam the
    // chart uses. These ARE the bundle's numbers, split by the bundle's arms.
    const groups = getGroupedValues(entry.popData, 'Pomc', entry.contrast);
    expect(groups.map((g) => g.key)).toEqual(['chow', 'hfd']);
    expect(groups[0].values).toEqual(POMC_CPM.slice(0, 5));
    expect(groups[1].values).toEqual(POMC_CPM.slice(5));

    // And the statistics the summary table + significance bracket read.
    expect(entry.popData.deByGene.Pomc?.logFC).toBe(POMC_DE.logFC);
    expect(entry.popData.deByGene.Pomc?.PValue).toBe(POMC_DE.PValue);

    // Three requests, and NOT the track bundle — the whole point.
    expect(requested).toHaveLength(3);
    expect(requested.some((u) => u.includes('track_whole.js'))).toBe(false);
  });

  it('preserves the source symbol casing rather than the uppercase shard key', async () => {
    stubQueryFiles(indexFiles());
    const entries = await loadCompareEntriesViaIndex('pomc', [DS]);
    // Queried lowercase, keyed uppercase, rendered as the dataset spells it.
    expect(entries?.[0].popData.geneNames).toEqual(['Pomc']);
  });

  it('keeps a dataset whose default track never measured the gene, so it can be named as not-detected', async () => {
    stubQueryFiles(indexFiles({
      [`genes/${POMC_SHARD}`]: { global: 'HX_QUERY_GENES_220', value: shard({}) },
      [`expr/${POMC_EXPR_SHARD}`]: { global: 'HX_QUERY_EXPR_220', value: shard({}) },
    }));
    const entries = await loadCompareEntriesViaIndex('POMC', [DS]);
    // An entry, NOT a fallback and NOT a dropped dataset: the index was
    // consulted and the gene is genuinely absent, which the view reports as
    // "not detected in N other datasets" by name.
    expect(entries).toHaveLength(1);
    expect(entries?.[0].popData.geneNames).toEqual([]);
  });
});

describe('loadCompareEntriesViaIndex — every reason to fall back', () => {
  // Each of these must resolve null. Returning entries instead would render a
  // chart that looks exactly like a correct one.
  const fallsBack = async (files: Parameters<typeof stubQueryFiles>[0], gene = 'POMC') => {
    stubQueryFiles(files);
    expect(await loadCompareEntriesViaIndex(gene, [DS])).toBeNull();
  };

  it('no index at all', async () => { await fallsBack({}); });

  it('a manifest built before the expression family (no exprShards)', async () => {
    const m = manifest();
    delete (m as Record<string, unknown>).exprShards;
    await fallsBack(indexFiles({ 'query/tracks.js': { global: 'HX_QUERY_TRACKS', value: m } }));
  });

  it('a manifest built with a different expression shard count', async () => {
    await fallsBack(indexFiles({
      'query/tracks.js': { global: 'HX_QUERY_TRACKS', value: manifest({ exprShards: 256 }) },
    }));
  });

  it('a dataset with no browse summary', async () => {
    await fallsBack(indexFiles({
      'query/tracks.js': { global: 'HX_QUERY_TRACKS', value: manifest({ datasets: [] }) },
    }));
  });

  it('a summary for a different default track than the registry declares', async () => {
    await fallsBack(indexFiles({
      'query/tracks.js': {
        global: 'HX_QUERY_TRACKS',
        value: manifest({ datasets: [{ ...SUMMARY, defaultTrack: 'arcuate' }] }),
      },
    }));
  });

  it('a summary built for a different contrast than the view will render', async () => {
    await fallsBack(indexFiles({
      'query/tracks.js': {
        global: 'HX_QUERY_TRACKS',
        value: manifest({ datasets: [{ ...SUMMARY, contrastId: 'hfd_vs_ncd' }] }),
      },
    }));
  });

  it('a summary with no expression scaffolding', async () => {
    await fallsBack(indexFiles({
      'query/tracks.js': {
        global: 'HX_QUERY_TRACKS',
        value: manifest({ datasets: [{ ...SUMMARY, sampleOrder: undefined, groupSamples: undefined }] }),
      },
    }));
  });

  it('groupSamples missing an arm the contrast names', async () => {
    await fallsBack(indexFiles({
      'query/tracks.js': {
        global: 'HX_QUERY_TRACKS',
        value: manifest({ datasets: [{ ...SUMMARY, groupSamples: { chow: GROUP_SAMPLES.chow } }] }),
      },
    }));
  });

  it('an arm sample that is not in sampleOrder (it would silently shrink n)', async () => {
    await fallsBack(indexFiles({
      'query/tracks.js': {
        global: 'HX_QUERY_TRACKS',
        value: manifest({
          datasets: [{ ...SUMMARY, groupSamples: { ...GROUP_SAMPLES, hfd: [...GROUP_SAMPLES.hfd, 'H99'] } }],
        }),
      },
    }));
  });

  it('duplicate sample ids in sampleOrder', async () => {
    await fallsBack(indexFiles({
      'query/tracks.js': {
        global: 'HX_QUERY_TRACKS',
        value: manifest({ datasets: [{ ...SUMMARY, sampleOrder: [...SAMPLES.slice(0, 9), 'C1'] }] }),
      },
    }));
  });

  it('an expression shard from a different build (its indices name other tracks)', async () => {
    await fallsBack(indexFiles({
      [`expr/${POMC_EXPR_SHARD}`]: {
        global: 'HX_QUERY_EXPR_220',
        value: { b: 'otherbuild', d: { POMC: [[0, POMC_CPM, 'Pomc']] } },
      },
    }));
  });

  it('a missing expression shard (absent is not the same as "gene in no dataset")', async () => {
    await fallsBack(indexFiles({ [`expr/${POMC_EXPR_SHARD}`]: null }));
  });

  it('a missing gene shard', async () => {
    await fallsBack(indexFiles({ [`genes/${POMC_SHARD}`]: null }));
  });

  it('an expression row whose length no longer matches sampleOrder', async () => {
    await fallsBack(indexFiles({
      [`expr/${POMC_EXPR_SHARD}`]: {
        global: 'HX_QUERY_EXPR_220',
        value: shard({ POMC: [[0, POMC_CPM.slice(0, 8), 'Pomc']] }),
      },
    }));
  });
});

describe('the expression family does not disturb the gene index', () => {
  it('a manifest with no exprShards still serves the cross-dataset gene query', async () => {
    // The capability check is deliberately local to the compare loader. Folding
    // it into loadQueryManifest would make a new client reject an older index
    // outright and drag the forest report onto the slow path with it.
    const m = manifest();
    delete (m as Record<string, unknown>).exprShards;
    const { requested } = stubQueryFiles({
      'query/tracks.js': { global: 'HX_QUERY_TRACKS', value: m },
      [`genes/${POMC_SHARD}`]: {
        global: 'HX_QUERY_GENES_220',
        value: shard({ POMC: [[0, POMC_DE.logFC, POMC_DE.PValue, POMC_DE.FDR, 0.4]] }),
      },
    });
    const report = await queryGeneAcrossDatasets('POMC', { datasets: [DS] });
    expect(report.groups[0].tracks).toHaveLength(1);
    expect(report.groups[0].tracks[0].logFC).toBe(POMC_DE.logFC);
    // Manifest + one gene shard. No track bundle, no expression shard.
    expect(requested).toHaveLength(2);
  });
});
