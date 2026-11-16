import { afterEach, describe, expect, it } from 'vitest';
import { _resetBundleCache, _setBundleTransport } from '../data/bundleSource';
import { getDataset } from '../data/datasets';
import {
  loadCardDetail, loadExprRows, loadGeneNames, loadGeneRows, loadPathwayNames, loadPathwayRows, loadQueryManifest,
  loadTrackPathways,
} from '../data/queryIndex';
import {
  type CardDetail, type QueryManifest,
  GENE_NAMES_FILE, GENE_NAMES_GLOBAL, GENE_SHARDS, MANIFEST_FILE, MANIFEST_GLOBAL, PATHWAY_NAMES_FILE,
  PATHWAY_NAMES_GLOBAL, PATHWAY_SHARDS,
  cardFile, cardGlobalName, decodeExprRow, decodeGeneRow, decodePathwayRow, decodeTrackPathwayRow, encodeExprRow,
  encodeGeneRow, encodePathwayRow, encodeTrackPathwayRow, exprShard, exprShardFile, exprShardGlobal, geneShard,
  geneShardFile, geneShardGlobal, indexKey, pathwayShard, pathwayShardFile, pathwayShardGlobal, shardEnvelope,
  trackEntry, trackPathwaysFile, trackPathwaysGlobal,
} from '../data/queryWire';

// src/data/queryWire.ts owns the query index's whole wire format, and the
// generator (scripts/build_query_index.mts) and this client are its two
// adapters. These tests hold the module to what is already PUBLISHED — the
// names and row layouts below are live URLs and live bytes — and prove the
// client reads exactly where and what the shared functions say the generator
// writes.

afterEach(() => {
  _setBundleTransport(null);
  _resetBundleCache();
});

describe('row codecs', () => {
  it('lays a gene row out as [trackIdx, logFC, pval, fdr, se] and reads it back', () => {
    const fields = { trackIdx: 3, logFC: 1.25, pval: 0.0012, fdr: 0.0499876945504852, se: null };
    const row = encodeGeneRow(fields);
    expect(row).toEqual([3, 1.25, 0.0012, 0.0499876945504852, null]);
    expect(decodeGeneRow(row)).toEqual(fields);
  });

  it('lays a pathway row out as [trackIdx, NES, padj, pval, size, dbIdx] and reads it back', () => {
    const fields = { trackIdx: 7, NES: -1.8, padj: 0.03, pval: 0.001, size: 64, dbIdx: 2 };
    const row = encodePathwayRow(fields);
    expect(row).toEqual([7, -1.8, 0.03, 0.001, 64, 2]);
    expect(decodePathwayRow(row)).toEqual(fields);
  });

  it('omits an expression row’s symbol exactly when it equals its uppercase key', () => {
    // Macaque spells genes in upper case, so its rows stay two fields long; a
    // mouse row carries its own spelling so the chart can print Pomc.
    const macaque = encodeExprRow({ trackIdx: 0, values: [1.5, null, 2], sym: 'POMC' });
    expect(macaque).toEqual([0, [1.5, null, 2]]);
    expect(JSON.stringify(macaque)).toBe('[0,[1.5,null,2]]');
    expect(decodeExprRow(macaque, 'POMC')).toEqual({ trackIdx: 0, values: [1.5, null, 2], sym: 'POMC' });

    const mouse = encodeExprRow({ trackIdx: 4, values: [10], sym: 'Pomc' });
    expect(mouse).toEqual([4, [10], 'Pomc']);
    expect(decodeExprRow(mouse, indexKey('Pomc'))).toEqual({ trackIdx: 4, values: [10], sym: 'Pomc' });
  });

  it('lays a track-pathway row out with its corpus base rate last and reads it back', () => {
    const fields = {
      pathway: 'HALLMARK_HYPOXIA', NES: 2.1, padj: 0.0004, size: 200, dbIdx: 1, sigTracks: 3, testedTracks: 39,
    };
    const row = encodeTrackPathwayRow(fields);
    expect(row).toEqual(['HALLMARK_HYPOXIA', 2.1, 0.0004, 200, 1, 3, 39]);
    expect(decodeTrackPathwayRow(row)).toEqual(fields);
  });

  it('wraps a payload with the build id first, as every shard is published', () => {
    expect(JSON.stringify(shardEnvelope('abc', { K: [] }))).toBe('{"b":"abc","d":{"K":[]}}');
  });
});

describe('published file and global names', () => {
  // Every string here is a live URL or window global. Changing one silently
  // turns every lookup into "file absent" for clients of the published index.
  it('names every family the way the published index does', () => {
    expect([MANIFEST_FILE, MANIFEST_GLOBAL]).toEqual(['tracks.js', 'HX_QUERY_TRACKS']);
    expect([geneShardFile(42), geneShardGlobal(42)]).toEqual(['genes/g042.js', 'HX_QUERY_GENES_042']);
    expect([pathwayShardFile(7), pathwayShardGlobal(7)]).toEqual(['pathways/p007.js', 'HX_QUERY_PATHWAYS_007']);
    expect([exprShardFile(511), exprShardGlobal(511)]).toEqual(['expr/e511.js', 'HX_QUERY_EXPR_511']);
    expect([GENE_NAMES_FILE, GENE_NAMES_GLOBAL]).toEqual(['gene_names.js', 'HX_QUERY_GENE_NAMES']);
    expect([PATHWAY_NAMES_FILE, PATHWAY_NAMES_GLOBAL]).toEqual(['pathway_names.js', 'HX_QUERY_PATHWAY_NAMES']);
    expect([trackPathwaysFile(7), trackPathwaysGlobal(7)]).toEqual(['trackpaths/t007.js', 'HX_QUERY_TRACKPATHS_007']);
    expect(cardFile('mouse_arc_hfd_gse225038')).toBe('cards/mouse_arc_hfd_gse225038.js');
  });

  it('derives a card global that is a valid identifier for any dataset id', () => {
    expect(cardGlobalName('mouse_arc_hfd_gse225038')).toBe('HX_QUERY_CARD_MOUSE_ARC_HFD_GSE225038');
    expect(cardGlobalName('emtab-15488')).toBe('HX_QUERY_CARD_EMTAB_15488');
  });
});

describe('manifest track entries', () => {
  it('precomputes lowPower with the app’s own qcFlags rule', () => {
    const meta = {
      labels: { a: 'Arcuate' },
      types: { a: 'Tissue' },
      qcFlags: { a: { nNormal: 2, nObese: 3 }, b: { nNormal: 7, nObese: 8 } },
    };
    expect(trackEntry('ds', 'a', meta)).toEqual({ ds: 'ds', trackId: 'a', label: 'Arcuate', type: 'Tissue', lowPower: true });
    // A balanced 7v8 is NOT low power (ISSUE-001), and missing counts are adequate.
    expect(trackEntry('ds', 'b', meta).lowPower).toBe(false);
    expect(trackEntry('ds', 'c', meta)).toEqual({ ds: 'ds', trackId: 'c', label: 'c', type: '', lowPower: false });
  });
});

describe('the client reads where the generator writes', () => {
  const DATASET = getDataset('mouse_arc_agrp_trap_gse240484')!;
  const BUILD = 'wirebuild1';
  const root = `${DATASET.bundleBaseUrl}/query`;

  /**
   * Serve files exactly as the generator places them: `files` maps a wire path
   * (relative to the query root) to the global it assigns and its payload. A
   * request whose URL OR global differs from the writer's misses, as it would
   * against the real index.
   */
  function serve(files: Record<string, { global: string; value: unknown }>) {
    const requested: string[] = [];
    _setBundleTransport(async (url, globalKey) => {
      requested.push(url);
      const hit = files[url.slice(root.length + 1).split('?')[0]];
      return hit && hit.global === globalKey ? { status: 'ok', value: hit.value } : { status: 'load-failed' };
    });
    return requested;
  }

  const manifest: QueryManifest = {
    v: 2,
    buildId: BUILD,
    geneShards: GENE_SHARDS,
    pathwayShards: PATHWAY_SHARDS,
    dbNames: ['GO_BP'],
    tracks: [trackEntry(DATASET.id, DATASET.defaultTrack, {})],
    trackPathways: { fdr: 0.05, tracks: [0] },
  };

  it('finds each keyed family’s rows at the shard the shared hash names, for any casing of the key', async () => {
    const gene = encodeGeneRow({ trackIdx: 0, logFC: 1.1, pval: 0.001, fdr: 0.02, se: 0.3 });
    const expr = encodeExprRow({ trackIdx: 0, values: [1, 2, 3], sym: 'Pomc' });
    const path = encodePathwayRow({ trackIdx: 0, NES: 1.9, padj: 0.01, pval: 0.001, size: 40, dbIdx: 0 });
    const G = indexKey('Pomc');
    const P = indexKey('hallmark_hypoxia');
    serve({
      [`${BUILD}/${geneShardFile(geneShard(G))}`]: {
        global: geneShardGlobal(geneShard(G)), value: shardEnvelope(BUILD, { [G]: [gene] }),
      },
      [`${BUILD}/${exprShardFile(exprShard(G))}`]: {
        global: exprShardGlobal(exprShard(G)), value: shardEnvelope(BUILD, { [G]: [expr] }),
      },
      [`${BUILD}/${pathwayShardFile(pathwayShard(P))}`]: {
        global: pathwayShardGlobal(pathwayShard(P)), value: shardEnvelope(BUILD, { [P]: [path] }),
      },
    });

    expect(await loadGeneRows([DATASET], 'pomc', BUILD)).toEqual([gene]);
    const exprRows = await loadExprRows([DATASET], 'POMC', BUILD);
    expect(exprRows?.map((row) => decodeExprRow(row, G).sym)).toEqual(['Pomc']);
    expect(await loadPathwayRows([DATASET], 'Hallmark_Hypoxia', BUILD)).toEqual([path]);
  });

  it('finds the manifest, name unions, track pathways and card detail at their wire paths', async () => {
    const card: CardDetail = { pts: [[1, 2]], xlim: 1, ymax: 2, ycut: 1.301, track: DATASET.defaultTrack };
    const trackPathRow = encodeTrackPathwayRow({
      pathway: 'HALLMARK_HYPOXIA', NES: 1.9, padj: 0.01, size: 40, dbIdx: 0, sigTracks: 1, testedTracks: 1,
    });
    const requested = serve({
      [MANIFEST_FILE]: { global: MANIFEST_GLOBAL, value: manifest },
      [`${BUILD}/${GENE_NAMES_FILE}`]: { global: GENE_NAMES_GLOBAL, value: shardEnvelope(BUILD, ['POMC']) },
      [`${BUILD}/${PATHWAY_NAMES_FILE}`]: {
        global: PATHWAY_NAMES_GLOBAL, value: shardEnvelope(BUILD, ['HALLMARK_HYPOXIA']),
      },
      [`${BUILD}/${trackPathwaysFile(0)}`]: {
        global: trackPathwaysGlobal(0),
        value: shardEnvelope(BUILD, { ds: DATASET.id, trackId: DATASET.defaultTrack, rows: [trackPathRow] }),
      },
      [`${BUILD}/${cardFile(DATASET.id)}`]: { global: cardGlobalName(DATASET.id), value: shardEnvelope(BUILD, card) },
    });

    const loaded = await loadQueryManifest([DATASET]);
    expect(loaded?.buildId).toBe(BUILD);
    expect(await loadGeneNames([DATASET], BUILD)).toEqual(['POMC']);
    expect(await loadPathwayNames([DATASET], BUILD)).toEqual(['HALLMARK_HYPOXIA']);
    expect(await loadTrackPathways([DATASET], manifest, 0)).toEqual([trackPathRow]);
    expect(await loadCardDetail(DATASET, BUILD)).toEqual(card);
    expect(requested).toHaveLength(5);
  });
});
