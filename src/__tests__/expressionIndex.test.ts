import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetBundleCache, _setBundleTransport } from '../data/bundleSource';
import { getDataset } from '../data/datasets';
import { EXISTING_EXPRESSION_SOURCES } from '../expression-survey/existingCatalog';
import { expressionForGenes } from '../expression-survey/existingExpressionValues';
import { loadIndexedExpression } from '../expression-survey/expressionIndex';
import {
  expressionIndexBucket, expressionIndexGlobal, expressionIndexKey, expressionIndexShardFile,
  type ExpressionIndexManifest, type ExpressionIndexShard,
} from '../expression-survey/expressionIndexFormat';
import type { RawTrack } from '../types';

const parse = (text: string) => JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
const diskManifest: ExpressionIndexManifest = parse(fs.readFileSync('public/query/expression-manifest.js', 'utf8'));

beforeEach(() => { _resetBundleCache(); });
afterEach(() => { _setBundleTransport(null); _resetBundleCache(); vi.unstubAllGlobals(); });

describe('lossless expression index reader', () => {
  it('matches full-track results for all 31 sources while sharing one manifest and gene bucket', async () => {
    vi.stubGlobal('__EXPRESSION_INDEX_BUILD_ID__', diskManifest.buildId);
    const requests: string[] = [];
    _setBundleTransport(async (url, global) => {
      requests.push(url);
      expect(url).toMatch(/^\/query\/expression\/[a-f0-9]{64}\//);
      expect(url).not.toContain('?');
      const text = fs.readFileSync(path.join('public', url), 'utf8');
      expect(text).toMatch(new RegExp(`^var ${global} = `));
      return { status: 'ok', value: parse(text) };
    });
    const results = await Promise.all(EXISTING_EXPRESSION_SOURCES.map((source) => loadIndexedExpression(source, ['igf1r'])));
    for (const [index, source] of EXISTING_EXPRESSION_SOURCES.entries()) {
      const raw: RawTrack = parse(fs.readFileSync(`public/datasets/${source.datasetId}/track_${source.trackId}.js`, 'utf8'));
      expect(results[index], source.id).toEqual(expressionForGenes(source, raw, getDataset(source.datasetId!)!, ['igf1r']));
    }
    expect(requests).toHaveLength(2);
    await loadIndexedExpression(EXISTING_EXPRESSION_SOURCES[0], ['Igf1r']);
    expect(requests).toHaveLength(2);
    await loadIndexedExpression(EXISTING_EXPRESSION_SOURCES[0], ['DefinitelyNotARetainedGene']);
    expect(requests.every((url) => !url.includes('/datasets/'))).toBe(true);
  });

  function fixture() {
    const buildId = 'a'.repeat(64);
    vi.stubGlobal('__EXPRESSION_INDEX_BUILD_ID__', buildId);
    const source = structuredClone(EXISTING_EXPRESSION_SOURCES[0]);
    source.sampleCount = 3;
    source.conditions.forEach((condition, index) => { condition.sampleCount = index === 0 ? 2 : 1; });
    const manifest: ExpressionIndexManifest = {
      schemaVersion: 1, buildId, shardCount: 512,
      sources: [{ id: source.id, datasetId: source.datasetId!, trackId: source.trackId!, unit: source.unit,
        source: structuredClone(source), featureCount: 6, groups: source.conditions.map((condition, index) => ({
          key: condition.key, label: condition.label, referenceEligible: condition.referenceEligible,
          sampleIds: index === 0 ? ['fed-a', 'fed-b'] : ['fast-a'],
        })) }],
      totals: { sourceCount: 1, trackCount: 1, queryKeyCount: 5, featureRows: 6,
        sampleSlots: 18, finiteValues: 14, missingValues: 4, ambiguousSourceKeys: 1 },
    };
    const shards = new Map<number, ExpressionIndexShard>();
    const features: Array<[string, (number | null)[]]> = [
      ['Zero', [0, null, 1.234567890123]], ['Empty', [null, null, null]],
      ['Lepr', [1, 2, 3]], ['LEPR', [4, 5, 6]],
      ['ENSMUSG00000057722.1', [7, 8, 9]], ['Gene.1', [3, 2, 1]],
    ];
    for (const [feature, values] of features) {
      const key = expressionIndexKey(feature), bucket = expressionIndexBucket(key);
      const shard = shards.get(bucket) ?? { schemaVersion: 1, buildId, bucket, genes: {} };
      shard.genes[key] ??= [];
      shard.genes[key].push([0, feature, values]);
      shards.set(bucket, shard);
    }
    const requests: string[] = [];
    let failNextShard = false;
    _setBundleTransport(async (url, global) => {
      requests.push(url);
      if (url.endsWith('/manifest.js')) {
        expect(global).toBe(expressionIndexGlobal(buildId, 'manifest'));
        return { status: 'ok', value: manifest };
      }
      if (failNextShard) { failNextShard = false; return { status: 'load-failed' }; }
      const bucket = Number(url.match(/e(\d{3})\.js$/)![1]);
      expect(url.endsWith(expressionIndexShardFile(bucket))).toBe(true);
      expect(global).toBe(expressionIndexGlobal(buildId, bucket));
      return { status: 'ok', value: shards.get(bucket) ?? { schemaVersion: 1, buildId, bucket, genes: {} } };
    });
    return { source, manifest, shards, requests, fail: () => { failNextShard = true; } };
  }

  it('preserves exact values, missing cells, candidate order, Ensembl versions and symbol suffixes', async () => {
    const { source } = fixture();
    const [zero, empty, ambiguous, ensembl, suffix, absent] = await loadIndexedExpression(source,
      [' zero ', 'Empty', 'lepr', 'ensmusg00000057722', 'Gene.1', 'Gene']);
    expect(zero.groups[0]).toMatchObject({ mean: 0, n: 1, totalSamples: 2,
      samples: [{ id: 'fed-a', value: 0 }, { id: 'fed-b', value: null }] });
    expect(zero.groups[1].samples[0].value).toBe(1.234567890123);
    expect(empty.groups[0]).toMatchObject({ mean: null, n: 0 });
    expect(ambiguous).toMatchObject({ status: 'ambiguous', candidates: ['Lepr', 'LEPR'] });
    expect(ensembl).toMatchObject({ gene: 'ENSMUSG00000057722.1', geneId: 'ENSMUSG00000057722.1' });
    expect(suffix.gene).toBe('Gene.1');
    expect(absent).toMatchObject({ status: 'not-retained', groups: [] });
  });

  it.each(['manifest build', 'shard build', 'shard bucket', 'sample length', 'source metadata'])(
    'refuses inconsistent %s without downloading a full track', async (kind) => {
      const { source, manifest, shards, requests } = fixture();
      const shard = shards.get(expressionIndexBucket('ZERO'))!;
      if (kind === 'manifest build') manifest.buildId = 'b'.repeat(64);
      if (kind === 'shard build') shard.buildId = 'b'.repeat(64);
      if (kind === 'shard bucket') shard.bucket = (shard.bucket + 1) % 512;
      if (kind === 'sample length') shard.genes.ZERO[0][2].pop();
      if (kind === 'source metadata') source.label += ' changed';
      await expect(loadIndexedExpression(source, ['Zero'])).rejects.toThrow();
      expect(requests.every((url) => url.startsWith('/query/expression/'))).toBe(true);
    },
  );

  it('retries a failed gene request and reuses its successfully loaded manifest', async () => {
    const { source, requests, fail } = fixture();
    fail();
    await expect(loadIndexedExpression(source, ['Zero'])).rejects.toThrow('Failed to load expression gene index');
    expect((await loadIndexedExpression(source, ['Zero']))[0].gene).toBe('Zero');
    expect(requests).toHaveLength(3);
  });

  it('makes no requests for an empty query and refuses an unbuilt corpus', async () => {
    const { source, requests } = fixture();
    expect(await loadIndexedExpression(source, [])).toEqual([]);
    vi.stubGlobal('__EXPRESSION_INDEX_BUILD_ID__', '');
    await expect(loadIndexedExpression(source, ['Zero'])).rejects.toThrow('not built');
    expect(requests).toHaveLength(0);
  });
});
