import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryCatalogContent } from '../data/queryCatalogIdentity';
import { loadDatasetCatalog } from '../data/datasetCatalog';
import { loadQueryManifest, type QueryManifest } from '../data/queryIndex';
import { _resetBundleCache, _setBundleTransport } from '../data/bundleSource';
import { listDatasets } from '../data/datasets';
import { loadDatasetMeta, peekDatasetMeta } from '../data/loadDatasetMeta';
import { seedQueryManifest } from './fixtures';

const id = 'mouse_pvn_crh_ela_gse174085';
const legacy = 'PVN CRH neurons (animal pseudobulk)';
const reviewed = 'PVN CRH neurons (litter pseudobulk)';
const manifest = () => (window as unknown as { HX_QUERY_TRACKS: QueryManifest }).HX_QUERY_TRACKS;
afterEach(() => {
  _resetBundleCache();
  _setBundleTransport(null);
  vi.restoreAllMocks();
});

describe('complete catalog content binding', () => {
  it.each([
    ['baseline count', (m: QueryManifest) => { m.datasets![0].nBaseline = 15; }],
    ['case count', (m: QueryManifest) => { m.datasets![0].nCase = 9; }],
    ['feature count', (m: QueryManifest) => { m.datasets![0].nGenes = 1; }],
    ['varying N flag', (m: QueryManifest) => { m.datasets![0].nVaries = !m.datasets![0].nVaries; }],
    ['low power count', (m: QueryManifest) => { m.datasets![0].lowPowerTracks++; }],
    ['summary label', (m: QueryManifest) => { m.datasets![0].trackLabel = 'Different tissue'; }],
    ['track label', (m: QueryManifest) => { m.tracks[0].label = 'Different tissue'; }],
    ['track type', (m: QueryManifest) => { m.tracks[0].type = 'Different type'; }],
    ['track power flag', (m: QueryManifest) => { m.tracks[0].lowPower = !m.tracks[0].lowPower; }],
    ['sample order', (m: QueryManifest) => { m.datasets![0].sampleOrder = ['changed-sample']; }],
    ['sample arm assignment', (m: QueryManifest) => { m.datasets![0].groupSamples = { normal: ['changed-sample'] }; }],
    ['arm keys', (m: QueryManifest) => { m.datasets![0].armKeys!.reverse(); }],
    ['track array order', (m: QueryManifest) => { m.tracks.reverse(); }],
    ['summary array order', (m: QueryManifest) => { m.datasets!.reverse(); }],
    ['new unreviewed metadata', (m: QueryManifest) => { Object.assign(m.datasets![0], { laterField: 123 }); }],
  ] as const)('withholds same-build %s changes and keeps current badges', async (_label, change) => {
    const restore = seedQueryManifest();
    try {
      change(manifest());
      expect(manifest().buildId).toBe('test');
      const result = await loadDatasetCatalog();
      expect(result.state).toBe('registry-only');
      expect(result.cards.length).toBe(listDatasets().length);
      expect(result.cards.every(c => c.nBaseline === null && c.nCase === null && c.nGenes === null && c.trackCount === null)).toBe(true);
      expect(result.cards.every(c => c.validation.datasetId === c.dataset.id)).toBe(true);
    } finally { restore(); }
  });

  it.each([undefined, '', 'malformed expected content'])('withholds counts without a valid expected content binding: %s', async (value) => {
    const restore = seedQueryManifest();
    try {
      (globalThis as unknown as Record<string, unknown>).__QUERY_CATALOG_CONTENT__ = value;
      expect((await loadDatasetCatalog()).state).toBe('registry-only');
    } finally { restore(); }
  });

  it('accepts reordered object properties with every field and array unchanged', async () => {
    const restore = seedQueryManifest();
    try {
      const before = queryCatalogContent(manifest());
      manifest().datasets = manifest().datasets!.map(row => Object.fromEntries(Object.entries(row).reverse()) as unknown as typeof row);
      expect(queryCatalogContent(manifest())).toBe(before);
      expect((await loadDatasetCatalog()).state).toBe('complete');
    } finally { restore(); }
  });

  it('accepts precisely the reviewed legacy label without changing source counts or sample arrays', async () => {
    const restore = seedQueryManifest();
    try {
      const m = manifest(), track = m.tracks.find(t => t.ds === id)!, row = m.datasets!.find(d => d.ds === id)!;
      track.label = legacy; row.trackLabel = legacy;
      row.nBaseline = 14; row.nCase = 10;
      row.sampleOrder = ['L1', 'L13']; row.groupSamples = { control: ['L1'], case: ['L13'] };
      const before = JSON.stringify(m);
      (globalThis as unknown as Record<string, unknown>).__QUERY_CATALOG_CONTENT__ = queryCatalogContent(m);
      const loaded = await loadQueryManifest(listDatasets());
      expect(loaded!.tracks.find(t => t.ds === id)!.label).toBe(reviewed);
      const result = await loadDatasetCatalog(), card = result.cards.find(c => c.dataset.id === id)!;
      expect(result.state).toBe('complete');
      expect([card.nBaseline, card.nCase, card.trackLabel]).toEqual([14, 10, reviewed]);
      expect(JSON.stringify(m)).toBe(before);
      expect(loaded!.datasets!.find(d => d.ds === id)!.sampleOrder).toBe(row.sampleOrder);
      expect(loaded!.datasets!.find(d => d.ds === id)!.groupSamples).toBe(row.groupSamples);
      // The old/new reviewed spellings have one explicitly defined display meaning.
      track.label = reviewed; row.trackLabel = reviewed;
      expect(queryCatalogContent(m)).toBe((globalThis as unknown as Record<string, unknown>).__QUERY_CATALOG_CONTENT__);
    } finally { restore(); }
  });

  it.each([NaN, Infinity, -Infinity, undefined])('rejects non-JSON count %s instead of treating it as null', async (value) => {
    const restore = seedQueryManifest();
    try {
      const m = manifest(); m.datasets![0].nGenes = null;
      (globalThis as unknown as Record<string, unknown>).__QUERY_CATALOG_CONTENT__ = queryCatalogContent(m);
      m.datasets![0].nGenes = value as number;
      expect(() => queryCatalogContent(m)).toThrow(/non-JSON/);
      expect((await loadDatasetCatalog()).state).toBe('registry-only');
    } finally { restore(); }
  });

  it('preserves in-flight loader identity and numeric metadata while overlaying the litter label', async () => {
    const dataset = listDatasets().find(d => d.id === id)!;
    const source = { labels: { crh_pvn: legacy }, qcFlags: { crh_pvn: { nNormal: 14, nObese: 10 } } };
    let settle!: (value: {status: 'ok'; value: typeof source}) => void;
    const transport = vi.fn(() => new Promise<{status: 'ok'; value: typeof source}>(resolve => { settle = resolve; }));
    _setBundleTransport(transport);
    const first = loadDatasetMeta(dataset), second = loadDatasetMeta(dataset);
    expect(first).toBe(second);
    settle({status: 'ok', value: source});
    const meta = await first;
    expect(transport).toHaveBeenCalledTimes(1);
    expect(meta.labels.crh_pvn).toBe(reviewed);
    expect(meta.qcFlags).toBe(source.qcFlags);
    expect(source.labels.crh_pvn).toBe(legacy);
    expect(peekDatasetMeta(dataset)).toBe(meta);
  });

  it.each(['serializer', 'non-enumerable serializer', 'prototype', 'accessor'] as const)('rejects a hidden %s that claims unchanged values', async (kind) => {
    const restore = seedQueryManifest();
    try {
      const m = manifest(), row = m.datasets![0], expected = { ...row };
      row.nBaseline = 15;
      const serializer = vi.fn(() => expected);
      if (kind === 'serializer') Object.assign(row, { toJSON: serializer });
      if (kind === 'non-enumerable serializer') Object.defineProperty(row, 'toJSON', { value: serializer });
      if (kind === 'prototype') Object.setPrototypeOf(row, { toJSON: serializer });
      if (kind === 'accessor') Object.defineProperty(row, 'nBaseline', { enumerable: true, get: serializer });
      expect(() => queryCatalogContent(m)).toThrow();
      expect((await loadDatasetCatalog()).state).toBe('registry-only');
      // Validation precedes the label overlay and never executes these hooks.
      expect(serializer).not.toHaveBeenCalled();
    } finally { restore(); }
  });

  it.each(['iterator', 'accessor', 'sparse'] as const)('rejects a sample array with a custom %s', async kind => {
    const restore = seedQueryManifest();
    try {
      const m = manifest(), row = m.datasets![0]; row.sampleOrder = ['original'];
      (globalThis as unknown as Record<string, unknown>).__QUERY_CATALOG_CONTENT__ = queryCatalogContent(m);
      row.sampleOrder[0] = 'changed';
      const claimed = vi.fn(() => 'original');
      if (kind === 'iterator') Object.defineProperty(row.sampleOrder, Symbol.iterator, {value: function* () { yield claimed(); }});
      if (kind === 'accessor') Object.defineProperty(row.sampleOrder, '0', {get: claimed});
      if (kind === 'sparse') delete row.sampleOrder[0];
      expect(() => queryCatalogContent(m)).toThrow();
      expect((await loadDatasetCatalog()).state).toBe('registry-only');
      expect(claimed).not.toHaveBeenCalled();
    } finally { restore(); }
  });
});
