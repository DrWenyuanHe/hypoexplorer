// Lossless baseline-expression point lookups, including every curated track.
// No network access, statistical refit, feature rounding, or old-build deletion.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { getDataset } from '../src/data/datasets';
import { resolveTrackUrl, sameOriginDataset } from '../src/data/bundleLocators';
import { EXISTING_EXPRESSION_SOURCES } from '../src/expression-survey/existingCatalog';
import { expressionForGenes } from '../src/expression-survey/existingExpressionValues';
import {
  EXPRESSION_INDEX_POINTER_GLOBAL, EXPRESSION_INDEX_SCHEMA_VERSION, EXPRESSION_INDEX_SHARDS,
  expressionIndexBucket, expressionIndexGlobal, expressionIndexKey, expressionIndexShardFile,
  type ExpressionIndexManifest, type ExpressionIndexRow, type ExpressionIndexShard,
  type ExpressionIndexSource, type ExpressionIndexTotals,
} from '../src/expression-survey/expressionIndexFormat';
import type { Dataset, ExpressionGeneResult, ExpressionSource, RawTrack } from '../src/types';
import { findEolDrift } from './lib/bundleEol.mjs';
import { writeIndexProduct } from './lib/indexProducts.mjs';

const ROOT = path.resolve('.');
const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const jsonp = (global: string, value: unknown): string => `var ${global} = ${JSON.stringify(value)};\n`;

/** Parse only a JSON assignment, never execute a downloaded/source script. */
export function parseExpressionBundle(text: string): RawTrack {
  const match = /^\s*(?:var|let|const)\s+[A-Za-z_$][\w$]*\s*=\s*([\s\S]*?)\s*;?\s*$/.exec(text);
  if (!match) throw new Error('Expected one JSON bundle assignment.');
  return JSON.parse(match[1].replace(/;$/, '')) as RawTrack;
}

export function indexedSourceFromRaw(source: ExpressionSource, raw: RawTrack, dataset: Dataset): {
  source: ExpressionIndexSource;
  entries: Array<[key: string, row: ExpressionIndexRow]>;
  adapterQueries: number;
  ambiguousSourceKeys: number;
} {
  assert.equal(source.datasetId, dataset.id, 'Source and dataset identity differ');
  assert.ok(source.trackId, 'Every existing source must identify its actual track');
  const meta = raw.meta ?? {};
  const sampleOrder = meta.sampleOrder ?? meta.sampleNames ?? [];
  const groupSamples = meta.groupSamples ?? ((meta.normalSamples || meta.obeseSamples)
    ? { normal: meta.normalSamples ?? [], obese: meta.obeseSamples ?? [] } : { normal: [], obese: [] });
  const keptIds = meta.samplesKept ?? raw.qc?.samplesKept;
  const kept = keptIds ? new Set(keptIds) : null;
  const groups = source.conditions.map((condition) => {
    assert.ok(dataset.groups.some((group) => group.key === condition.key), `Unregistered group ${source.id}/${condition.key}`);
    const sampleIds = [...(groupSamples[condition.key] ?? [])];
    assert.equal(sampleIds.length, condition.sampleCount, `Catalog sample count drift ${source.id}/${condition.key}`);
    return { key: condition.key, label: condition.label, referenceEligible: condition.referenceEligible, sampleIds };
  });
  const allIds = groups.flatMap((group) => group.sampleIds);
  assert.equal(allIds.length, source.sampleCount, `Catalog source count drift ${source.id}`);
  assert.equal(new Set(allIds).size, allIds.length, `Overlapping source conditions ${source.id}`);
  const slots = allIds.map((id) => ({ id, index: sampleOrder.indexOf(id) }));
  const features = Object.keys(raw.cpm ?? {});
  assert.ok(features.length, `No per-sample expression rows in ${source.id}`);
  const indexedSource: ExpressionIndexSource = {
    id: source.id, datasetId: dataset.id, trackId: source.trackId, unit: source.unit,
    source, groups, featureCount: features.length,
  };
  const entries: Array<[string, ExpressionIndexRow]> = [];
  const byKey = new Map<string, ExpressionIndexRow[]>();
  for (const feature of features) {
    // Read the original CPM column by its original sample ID. This intentionally
    // does not call popDataFor/valueAt, so their alignment is independently checked.
    const values = slots.map(({ id, index }) => {
      const value = index < 0 ? null : raw.cpm?.[feature]?.[index];
      return (kept && !kept.has(id)) || value == null || !Number.isFinite(value) ? null : value;
    });
    const row: ExpressionIndexRow = [0, feature, values];
    const key = expressionIndexKey(feature);
    entries.push([key, row]);
    const matches = byKey.get(key) ?? [];
    matches.push(row);
    byKey.set(key, matches);
  }

  // Compare every normalized source feature to the existing full-track adapter.
  // That includes ambiguous candidate order, group means, IDs, nulls and zeros.
  const keys = [...byKey.keys()];
  for (let offset = 0; offset < keys.length; offset += 512) {
    const queries = keys.slice(offset, offset + 512);
    const expected = expressionForGenes(source, raw, dataset, queries);
    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      const rows = byKey.get(query)!;
      const reconstructed = resultFromIndexedRows(indexedSource, rows, query);
      assert.deepEqual(reconstructed, expected[i], `Full adapter mismatch ${source.id}/${query}`);
      // Serialization must preserve every finite number without significant-digit rounding.
      assert.deepEqual(JSON.parse(JSON.stringify(rows)), rows, `Lossy JSON values ${source.id}/${query}`);
    }
  }
  return { source: indexedSource, entries, adapterQueries: keys.length,
    ambiguousSourceKeys: [...byKey.values()].filter((rows) => rows.length > 1).length };
}

/** Independent reconstruction used only for the offline fidelity comparison. */
function resultFromIndexedRows(source: ExpressionIndexSource, rows: ExpressionIndexRow[], query: string): ExpressionGeneResult {
  const base = { sourceId: source.id, query, unit: source.unit };
  if (rows.length > 1) return { ...base, status: 'ambiguous', candidates: rows.map((row) => row[1]), groups: [] };
  const [, gene, values] = rows[0];
  let offset = 0;
  return {
    ...base, status: 'available', gene,
    ...(/^ENS[A-Z]*G\d+(?:\.\d+)?$/i.test(gene) ? { geneId: gene } : {}),
    groups: source.groups.map((group) => {
      const samples = group.sampleIds.map((id) => ({ id, value: values[offset++] }));
      const finite = samples.flatMap((sample) => sample.value === null ? [] : [sample.value]);
      return { key: group.key, label: group.label, referenceEligible: group.referenceEligible,
        samples, mean: finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null,
        n: finite.length, totalSamples: samples.length };
    }),
  };
}

interface RetainedInput { path: string; sha256: string; bytes: number }

export async function buildExpressionIndex(options: { outDir?: string; evidenceDir?: string; check?: boolean } = {}): Promise<ExpressionIndexManifest> {
  const outDir = path.resolve(options.outDir ?? path.join(ROOT, 'public/query'));
  const evidenceDir = path.resolve(options.evidenceDir ?? path.join(ROOT, 'data/expression/existing'));
  const sources: ExpressionIndexSource[] = [];
  const buckets: Array<Record<string, ExpressionIndexRow[]>> = Array.from({ length: EXPRESSION_INDEX_SHARDS }, () => Object.create(null));
  const inputs = new Map<string, RetainedInput>();
  const rawCache = new Map<string, RawTrack>();
  const totals: ExpressionIndexTotals = { sourceCount: 0, trackCount: 0, queryKeyCount: 0, featureRows: 0,
    sampleSlots: 0, finiteValues: 0, missingValues: 0, ambiguousSourceKeys: 0 };
  let adapterQueries = 0;
  for (const source of EXISTING_EXPRESSION_SOURCES) {
    const dataset = getDataset(source.datasetId!);
    assert.ok(dataset, `Unknown dataset ${source.datasetId}`);
    const relativePath = resolveTrackUrl(sameOriginDataset(dataset), source.trackId!).replace(/^\//, '');
    let raw = rawCache.get(relativePath);
    if (!raw) {
      const bytes = await readFile(path.join(ROOT, 'public', relativePath));
      inputs.set(relativePath, { path: `public/${relativePath}`, sha256: sha256(bytes), bytes: bytes.length });
      raw = parseExpressionBundle(bytes.toString('utf8'));
      rawCache.set(relativePath, raw);
    }
    const built = indexedSourceFromRaw(source, raw, dataset);
    const sourceIndex = sources.length;
    sources.push(built.source);
    totals.ambiguousSourceKeys += built.ambiguousSourceKeys;
    adapterQueries += built.adapterQueries;
    for (const [key, row] of built.entries) {
      row[0] = sourceIndex;
      const genes = buckets[expressionIndexBucket(key)];
      if (!genes[key]) { genes[key] = []; totals.queryKeyCount++; }
      genes[key].push(row);
      totals.featureRows++;
      totals.sampleSlots += row[2].length;
      for (const value of row[2]) {
        if (value === null) totals.missingValues++;
        else totals.finiteValues++;
      }
    }
  }
  // Every pin below describes committed bytes. An input whose working copy
  // differs from them only in line endings (a checkout from before
  // .gitattributes exempted the bundles; see lib/bundleEol.mts) would record a
  // pin that fails on every other checkout, as f644452 had to undo. Refuse it.
  const drift = findEolDrift([...inputs.values()].map((input) => `:(literal)${input.path}`), ROOT);
  if (drift?.length) {
    throw new Error(`Refusing to pin ${drift.length} input bundle(s) whose line endings differ from the committed bytes: `
      + `${drift.map((entry) => entry.path).join(', ')}. Restore them with npm run restore:bundle-eol.`);
  }
  totals.sourceCount = sources.length;
  totals.trackCount = inputs.size;
  // Sort keys only; row order retains source and original feature insertion order.
  const sortedBuckets = buckets.map((genes) => Object.fromEntries(Object.keys(genes).sort().map((key) => [key, genes[key]])));
  const semantic: Omit<ExpressionIndexManifest, 'buildId'> = { schemaVersion: EXPRESSION_INDEX_SCHEMA_VERSION, shardCount: EXPRESSION_INDEX_SHARDS, sources, totals };
  const contentHash = createHash('sha256').update(JSON.stringify(semantic));
  for (let bucket = 0; bucket < sortedBuckets.length; bucket++) {
    const encoded = JSON.stringify(sortedBuckets[bucket]);
    contentHash.update(`\n${bucket}:${Buffer.byteLength(encoded)}\n`).update(encoded);
  }
  const buildId = contentHash.digest('hex');
  const manifest: ExpressionIndexManifest = { ...semantic, buildId };
  const relativeRoot = `expression/${buildId}`;
  const output = new Map<string, string>();
  output.set(`${relativeRoot}/manifest.js`, jsonp(expressionIndexGlobal(buildId, 'manifest'), manifest));
  for (let bucket = 0; bucket < sortedBuckets.length; bucket++) {
    const shard: ExpressionIndexShard = { schemaVersion: EXPRESSION_INDEX_SCHEMA_VERSION, buildId, bucket, genes: sortedBuckets[bucket] };
    output.set(`${relativeRoot}/${expressionIndexShardFile(bucket)}`, jsonp(expressionIndexGlobal(buildId, bucket), shard));
  }

  const sizes = [...output].map(([file, body]) => ({ path: `query/${file}`, bytes: Buffer.byteLength(body), gzip6Bytes: gzipSync(body, { level: 6 }).length }));
  const pointer = jsonp(EXPRESSION_INDEX_POINTER_GLOBAL, manifest);
  const probeKeys = ['Lepr', 'Agrp', 'Pomc', 'Igf1r'];
  const probeQueries = probeKeys.map((gene) => {
    const bucket = expressionIndexBucket(expressionIndexKey(gene));
    const files = [sizes[0], sizes[bucket + 1]];
    return { gene, bucket, files: files.map((file) => file.path),
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      gzip6Bytes: files.reduce((sum, file) => sum + file.gzip6Bytes, 0) };
  });
  const validation = {
    schemaVersion: 1, buildId, status: 'verified',
    comparison: 'Every normalized source query matches the full-track adapter, including ambiguity candidate order and every available group, sample ID, finite/missing value and mean. All indexed features, including ambiguous candidates, were independently aligned to raw sample IDs and survived JSON serialization exactly.',
    precision: 'Exact JavaScript numeric values retained from source JSON; no rounding or statistical transformation.',
    totals, adapterQueries, maxAbsoluteError: 0,
    inputBundles: [...inputs.values()],
    outputFiles: sizes.length, outputBytes: sizes.reduce((sum, file) => sum + file.bytes, 0),
    outputGzip6Bytes: sizes.reduce((sum, file) => sum + file.gzip6Bytes, 0),
    compressionEstimate: 'Local gzip level 6, excluding HTTP overhead and app code. These are not measured R2 transfer sizes.',
    coldProbeQueries: probeQueries,
    artifacts: sizes.map((size) => ({ ...size, sha256: sha256(output.get(size.path.replace(/^query\//, ''))!) })),
  };
  for (const [relativePath, body] of output) await writeIndexProduct(path.join(outDir, relativePath), body, { check: options.check, immutable: true });
  await writeIndexProduct(path.join(evidenceDir, 'validation.json'), `${JSON.stringify(validation, null, 2)}\n`, { check: options.check, immutable: false });
  // The pointer is written only after all immutable objects and evidence exist.
  await writeIndexProduct(path.join(outDir, 'expression-manifest.js'), pointer, { check: options.check, immutable: false });
  console.log(JSON.stringify({ mode: options.check ? 'check' : 'build', buildId, ...totals, adapterQueries,
    outputBytes: validation.outputBytes, coldProbeQueries: probeQueries }, null, 2));
  return manifest;
}

if (process.argv[1] && import.meta.url.startsWith('file:') && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const evidenceIndex = args.indexOf('--evidence');
  await buildExpressionIndex({ check: args.includes('--check'),
    outDir: outIndex < 0 ? undefined : args[outIndex + 1],
    evidenceDir: evidenceIndex < 0 ? undefined : args[evidenceIndex + 1] });
}
