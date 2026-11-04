// Shared writer, checker and replay for external reference products (GTEx, HPA, Allen).
// Builders parse their retained sources into ExternalFeature rows; this module
// shards them in the format of src/expression-survey/externalReferenceFormat.ts,
// writes or byte-compares the products, then reads every emitted value back.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import {
  EXTERNAL_LOOKUP_SHARDS, EXTERNAL_REFERENCE_ROOTS, EXTERNAL_REFERENCE_SCHEMA_VERSION,
  externalFeatureKeys, externalLookupBucket, externalLookupFile, externalValueBucket, externalValueFile,
  type ExternalLookupEntry, type ExternalLookupRow, type ExternalProvider, type ExternalReferenceManifest,
  type ExternalValidation, type ExternalValidationCheckpoint, type ExternalValueShard,
} from '../../src/expression-survey/externalReferenceFormat';

export const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const json = (value: unknown): string => `${JSON.stringify(value)}\n`;

export interface ExternalFeature {
  source: string;
  id: string;
  symbol: string;
  ensemblId: string;
  values: Array<number | null>;
}

export interface PinnedInput {
  name: string;
  url: string;
  bytes: number;
  sha256: string;
}

/** Plain decimal or exponent text, as providers publish it. Anything else is refused. */
export function sourceNumber(text: string, where: string, options: { allowNegative?: boolean } = {}): number {
  const pattern = options.allowNegative ? /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/ : /^\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/;
  assert.match(text, pattern, `Non-numeric or negative value at ${where}: ${JSON.stringify(text)}`);
  const value = Number(text);
  assert.ok(Number.isFinite(value), `Non-finite value at ${where}`);
  return value;
}

/** Members of a zip (stored or deflated, no zip64), each inflated and CRC-checked on demand. */
export function unzipMembers(zip: Buffer): Map<string, () => Buffer> {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, 'Not a zip archive');
  const members = new Map<string, () => Buffer>();
  let central = zip.readUInt32LE(eocd + 16);
  for (let index = 0; index < zip.readUInt16LE(eocd + 10); index++) {
    assert.equal(zip.readUInt32LE(central), 0x02014b50, 'Bad zip central directory');
    const method = zip.readUInt16LE(central + 10);
    const crc = zip.readUInt32LE(central + 16);
    const compressed = zip.readUInt32LE(central + 20);
    const size = zip.readUInt32LE(central + 24);
    const nameLength = zip.readUInt16LE(central + 28);
    const name = zip.subarray(central + 46, central + 46 + nameLength).toString('utf8');
    const local = zip.readUInt32LE(central + 42);
    central += 46 + nameLength + zip.readUInt16LE(central + 30) + zip.readUInt16LE(central + 32);
    members.set(name, () => {
      assert.equal(zip.readUInt32LE(local), 0x04034b50, 'Bad zip local header');
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + compressed);
      assert.ok(method === 0 || method === 8, `Unsupported zip method ${method}`);
      const bytes = method === 0 ? Buffer.from(data) : inflateRawSync(data);
      assert.equal(bytes.length, size, `Zip member size differs: ${name}`);
      assert.equal(crc32(bytes), crc, `Zip member CRC differs: ${name}`);
      return bytes;
    });
  }
  return members;
}

/** The only member of a single-entry zip, with its name. */
export function unzipSingle(zip: Buffer): { name: string; bytes: Buffer } {
  const members = unzipMembers(zip);
  assert.equal(members.size, 1, 'Expected exactly one zip member');
  const [[name, read]] = members;
  return { name, bytes: read() };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** LF-only lines without the final empty element; a CR means the bytes were altered. */
export function sourceLines(text: string, name: string): string[] {
  assert.ok(!text.includes('\r'), `${name} is LF-only; a CR means the bytes were altered`);
  const rows = text.split('\n');
  assert.equal(rows.pop(), '', `${name} must end with a newline`);
  return rows;
}

/** Download one pinned original and refuse any change in size or bytes. */
export async function fetchPinned(input: PinnedInput): Promise<Buffer> {
  const response = await fetch(input.url, { signal: AbortSignal.timeout(900_000) });
  assert.ok(response.ok, `Source fetch failed: ${input.name} (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.length, input.bytes, `Source size changed: ${input.name}`);
  assert.equal(sha256(bytes), input.sha256, `Source bytes changed: ${input.name}`);
  return bytes;
}

/** Read a retained file and refuse it unless its bytes match the manifest. */
export async function readRetained(file: string, expected: { bytes: number; sha256: string }): Promise<Buffer> {
  const bytes = await readFile(file);
  assert.equal(bytes.length, expected.bytes, `Retained size changed: ${file}`);
  assert.equal(sha256(bytes), expected.sha256, `Retained bytes changed: ${file}`);
  return bytes;
}

/**
 * A fresh API checkpoint response must agree with the retained one, apart from
 * its `retrieved` time. The retained file stays pinned; only --record replaces it.
 */
export async function assertSameApiAnswer(fresh: Buffer, file: string, expected: { bytes: number; sha256: string }): Promise<void> {
  const body = (bytes: Buffer) => {
    const { retrieved: _retrieved, ...rest } = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
    return rest;
  };
  assert.deepEqual(body(fresh), body(await readRetained(file, expected)),
    `The provider API now answers differently from ${path.basename(file)}; use --record deliberately`);
}

export type ManifestInput = Omit<ExternalReferenceManifest,
  'schemaVersion' | 'featureCounts' | 'lookupShardCount' | 'validationPath'>;

export interface ProductInput {
  manifest: ManifestInput;
  features: ExternalFeature[];
  inputs: PinnedInput[];
  numericalPolicy: string;
  validationNotes: string[];
  checkpoints: ExternalValidationCheckpoint[];
}

export function buildProducts(input: ProductInput): Map<string, string> {
  const { manifest, features } = input;
  const provider = manifest.provider;
  assert.ok(Number.isInteger(manifest.valueShardCount) && manifest.valueShardCount > 0);
  const sourceIds = new Set(manifest.sources.map((source) => source.id));
  assert.equal(sourceIds.size, manifest.sources.length, 'Duplicate source id');
  for (const source of manifest.sources) {
    assert.ok(source.id.startsWith(`${provider}-`), `Source ${source.id} must start with ${provider}-`);
    assert.equal(source.collection, 'external');
    assert.ok(manifest.columns[source.id]?.length, `No columns for ${source.id}`);
  }
  const featureCounts: Record<string, number> = Object.fromEntries(manifest.sources.map((source) => [source.id, 0]));
  const seen = new Set<string>();
  const sourceIndex = new Map(manifest.sources.map((source, index) => [source.id, index]));
  const lookups = Array.from({ length: EXTERNAL_LOOKUP_SHARDS }, () => ({} as Record<string, ExternalLookupRow[]>));
  const values = Array.from({ length: manifest.valueShardCount }, () => ({} as ExternalValueShard['rows']));
  for (const feature of features) {
    assert.ok(sourceIds.has(feature.source), `Unknown source ${feature.source}`);
    const identity = `${feature.source}\0${feature.id}`;
    assert.ok(!seen.has(identity), `Duplicate feature ${feature.source}/${feature.id}`);
    seen.add(identity);
    assert.equal(feature.values.length, manifest.columns[feature.source].length, `Column count ${feature.source}/${feature.id}`);
    featureCounts[feature.source]++;
    const entry: ExternalLookupEntry = { source: feature.source, id: feature.id, symbol: feature.symbol, ensemblId: feature.ensemblId };
    const row: ExternalLookupRow = [sourceIndex.get(feature.source)!, entry.id, entry.symbol, entry.ensemblId];
    for (const key of externalFeatureKeys(entry)) {
      const shard = lookups[externalLookupBucket(key)];
      if (!shard[key]) shard[key] = [];
      shard[key].push(row);
    }
    const rows = values[externalValueBucket(feature.id, manifest.valueShardCount)];
    if (!rows[feature.source]) rows[feature.source] = {};
    rows[feature.source][feature.id] = feature.values;
  }
  for (const source of manifest.sources) assert.ok(featureCounts[source.id] > 0, `Source ${source.id} has no features`);
  const comparedValues = features.reduce((sum, feature) => sum + feature.values.length, 0);
  const validation: ExternalValidation = {
    schemaVersion: EXTERNAL_REFERENCE_SCHEMA_VERSION, status: 'verified', provider, release: manifest.release,
    comparedValues, exactMatches: comparedValues, maxAbsoluteDifference: 0, numericalPolicy: input.numericalPolicy,
    inputs: input.inputs, sources: manifest.sources.map((source) => ({
      id: source.id, features: featureCounts[source.id], columns: manifest.columns[source.id].length })),
    checkpoints: input.checkpoints, notes: input.validationNotes,
  };
  const full: ExternalReferenceManifest = {
    schemaVersion: EXTERNAL_REFERENCE_SCHEMA_VERSION, ...manifest, featureCounts,
    lookupShardCount: EXTERNAL_LOOKUP_SHARDS, validationPath: 'validation.json',
  };
  const files = new Map<string, string>([['manifest.json', json(full)], ['validation.json', json(validation)]]);
  for (const [bucket, keys] of lookups.entries()) {
    files.set(externalLookupFile(bucket), json({ schemaVersion: EXTERNAL_REFERENCE_SCHEMA_VERSION, provider, bucket, keys }));
  }
  for (const [bucket, rows] of values.entries()) {
    files.set(externalValueFile(bucket), json({ schemaVersion: EXTERNAL_REFERENCE_SCHEMA_VERSION, provider, bucket, rows }));
  }
  return files;
}

async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory()
    ? listFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`) : Promise.resolve([`${prefix}${entry.name}`])));
  return nested.flat();
}

export function productDir(root: string, provider: ExternalProvider): string {
  return path.join(root, 'public', EXTERNAL_REFERENCE_ROOTS[provider]);
}

/** Write a clean product directory, or byte-compare an existing one (--check). */
export async function writeOrCheck(dir: string, files: Map<string, string>, check: boolean): Promise<void> {
  if (check) {
    const present = (await listFiles(dir)).sort();
    assert.deepEqual(present, [...files.keys()].sort(), `Product file set differs in ${dir}; rebuild without --check`);
    for (const [file, expected] of files) {
      assert.equal(await readFile(path.join(dir, file), 'utf8'), expected, `Stale product ${file}; rebuild without --check`);
    }
    return;
  }
  await rm(dir, { recursive: true, force: true });
  for (const [file, text] of files) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), text, 'utf8');
  }
}

/** Independently read every emitted vector back from disk and compare each value. */
export async function replay(dir: string, manifest: ManifestInput, features: ExternalFeature[]): Promise<number> {
  const emitted = new Map<number, ExternalValueShard>();
  let compared = 0;
  for (const feature of features) {
    const bucket = externalValueBucket(feature.id, manifest.valueShardCount);
    let shard = emitted.get(bucket);
    if (!shard) {
      shard = JSON.parse(await readFile(path.join(dir, externalValueFile(bucket)), 'utf8')) as ExternalValueShard;
      emitted.set(bucket, shard);
    }
    const row = shard.rows[feature.source]?.[feature.id];
    assert.ok(row, `Missing emitted row ${feature.source}/${feature.id}`);
    assert.equal(row.length, feature.values.length);
    for (let index = 0; index < row.length; index++) {
      assert.equal(row[index], feature.values[index], `Value mismatch ${feature.source}/${feature.id}[${index}]`);
      compared++;
    }
  }
  return compared;
}
