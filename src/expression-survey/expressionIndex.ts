import { BUNDLE_BASE } from '../data/bundleBase';
import { loadRequiredBundle } from '../data/bundleSource';
import {
  EXPRESSION_INDEX_SCHEMA_VERSION, EXPRESSION_INDEX_SHARDS,
  expressionIndexBucket, expressionIndexGlobal, expressionIndexKey, expressionIndexShardFile,
} from './expressionIndexFormat';
import type { ExpressionIndexManifest, ExpressionIndexShard } from './expressionIndexFormat';
import type { ExpressionGeneResult, ExpressionSource } from './expressionTypes';

const checkedManifests = new WeakSet<ExpressionIndexManifest>();
const checkedShards = new WeakSet<ExpressionIndexShard>();

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
    }
    return item;
  });
}

function validateManifest(manifest: ExpressionIndexManifest, buildId: string): void {
  if (checkedManifests.has(manifest)) return;
  if (manifest?.schemaVersion !== EXPRESSION_INDEX_SCHEMA_VERSION || manifest.buildId !== buildId ||
      manifest.shardCount !== EXPRESSION_INDEX_SHARDS || !Array.isArray(manifest.sources) ||
      !manifest.sources.length || manifest.totals?.sourceCount !== manifest.sources.length ||
      new Set(manifest.sources.map((source) => source.id)).size !== manifest.sources.length) {
    throw new Error('Expression index metadata does not match this app build.');
  }
  for (const source of manifest.sources) {
    if (!source.source || source.source.id !== source.id || source.source.datasetId !== source.datasetId ||
        source.source.trackId !== source.trackId || source.source.unit !== source.unit ||
        !Array.isArray(source.groups) || !Array.isArray(source.source.conditions) ||
        source.groups.length !== source.source.conditions.length) {
      throw new Error('Expression index source metadata is inconsistent.');
    }
    const seen = new Set<string>();
    for (const [index, group] of source.groups.entries()) {
      const condition = source.source.conditions[index];
      if (group.key !== condition.key || group.label !== condition.label ||
          group.referenceEligible !== condition.referenceEligible || !Array.isArray(group.sampleIds) ||
          (condition.sampleCount != null && group.sampleIds.length !== condition.sampleCount)) {
        throw new Error('Expression index cohort metadata is inconsistent.');
      }
      for (const sample of group.sampleIds) {
        if (typeof sample !== 'string' || !sample || seen.has(sample)) {
          throw new Error('Expression index sample identities are inconsistent.');
        }
        seen.add(sample);
      }
    }
  }
  checkedManifests.add(manifest);
}

function validateShard(shard: ExpressionIndexShard, manifest: ExpressionIndexManifest, bucket: number): void {
  if (checkedShards.has(shard)) return;
  if (shard?.schemaVersion !== EXPRESSION_INDEX_SCHEMA_VERSION || shard.buildId !== manifest.buildId ||
      shard.bucket !== bucket || !shard.genes || typeof shard.genes !== 'object' || Array.isArray(shard.genes)) {
    throw new Error('Expression shard does not match this app build.');
  }
  for (const [key, rows] of Object.entries(shard.genes)) {
    if (key !== expressionIndexKey(key) || expressionIndexBucket(key) !== bucket || !Array.isArray(rows)) {
      throw new Error('Expression shard contains an invalid gene key.');
    }
    const seen = new Set<string>();
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== 3 || !Number.isInteger(row[0]) ||
          row[0] < 0 || row[0] >= manifest.sources.length || typeof row[1] !== 'string' ||
          expressionIndexKey(row[1]) !== key || !Array.isArray(row[2])) {
        throw new Error('Expression shard contains an invalid source feature.');
      }
      const identity = `${row[0]}\0${row[1]}`;
      const slots = manifest.sources[row[0]].groups.reduce((sum, group) => sum + group.sampleIds.length, 0);
      if (seen.has(identity) || row[2].length !== slots ||
          row[2].some((value) => value !== null && (typeof value !== 'number' || !Number.isFinite(value)))) {
        throw new Error('Expression shard sample values are inconsistent.');
      }
      seen.add(identity);
    }
  }
  checkedShards.add(shard);
}

/** A pinned immutable manifest and only the requested gene buckets; no whole-track fallback. */
export async function loadIndexedExpression(source: ExpressionSource, genes: string[]): Promise<ExpressionGeneResult[]> {
  if (!genes.length) return [];
  const buildId = typeof __EXPRESSION_INDEX_BUILD_ID__ === 'undefined' ? '' : __EXPRESSION_INDEX_BUILD_ID__;
  if (!/^[a-f0-9]{64}$/.test(buildId)) {
    throw new Error('Expression index is not built. Run npm run build:expression-index and restart the app.');
  }
  const base = `${BUNDLE_BASE}/query/expression/${buildId}`;
  const manifest = await loadRequiredBundle<ExpressionIndexManifest>(
    `${base}/manifest.js`, expressionIndexGlobal(buildId, 'manifest'), 'expression source index',
  );
  validateManifest(manifest, buildId);
  const sourceIndex = manifest.sources.findIndex((entry) => entry.id === source.id);
  const indexedSource = manifest.sources[sourceIndex];
  if (!indexedSource || canonical(indexedSource.source) !== canonical(source)) {
    throw new Error('Expression source changed since the index was built. Rebuild the expression index.');
  }
  const keys = genes.map(expressionIndexKey);
  const buckets = [...new Set(keys.map(expressionIndexBucket))];
  const shards = new Map(await Promise.all(buckets.map(async (bucket) => {
    const shard = await loadRequiredBundle<ExpressionIndexShard>(
      `${base}/${expressionIndexShardFile(bucket)}`, expressionIndexGlobal(buildId, bucket), 'expression gene index',
    );
    validateShard(shard, manifest, bucket);
    return [bucket, shard] as const;
  })));
  return genes.map((query, index) => {
    const key = keys[index];
    const shard = shards.get(expressionIndexBucket(key))!;
    // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn requires ES2022; the app targets ES2020.
    const matches = (Object.prototype.hasOwnProperty.call(shard.genes, key) ? shard.genes[key] : [])
      .filter(([at]) => at === sourceIndex);
    const baseResult = { sourceId: source.id, query, unit: source.unit };
    if (!matches.length) return { ...baseResult, status: 'not-retained', groups: [] };
    if (matches.length > 1) return { ...baseResult, status: 'ambiguous', candidates: matches.map((row) => row[1]), groups: [] };
    const [, gene, stored] = matches[0];
    let offset = 0;
    return {
      ...baseResult, status: 'available', gene,
      ...(/^ENS[A-Z]*G\d+(?:\.\d+)?$/i.test(gene) ? { geneId: gene } : {}),
      groups: indexedSource.groups.map((group) => {
        const samples = group.sampleIds.map((id) => ({ id, value: stored[offset++] }));
        const values = samples.flatMap((sample) => sample.value === null ? [] : [sample.value]);
        return {
          key: group.key, label: group.label, referenceEligible: group.referenceEligible,
          samples, mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
          n: values.length, totalSamples: samples.length,
        };
      }),
    };
  });
}
