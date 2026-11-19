import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireR2LocalLock, metadataHash, objectMetadata, prepareR2Object, queryPublicationPrefixes, remoteMatches,
  synchronizeR2Objects, type R2PreparedObject, type R2RemoteObject,
} from '../../scripts/lib/r2Incremental.mjs';
import { createR2InventoryReader } from '../../scripts/lib/r2RemoteInventory.mjs';

const temporaryDirectories: string[] = [];
async function workspace() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypo-r2-test-'));
  temporaryDirectories.push(directory);
  return directory;
}
afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function fixture(key: string, directory: string, content = 'var fixture = {"value":1};') {
  const file = path.join(directory, `${Math.random()}.js`);
  await writeFile(file, content);
  return prepareR2Object(file, key, path.join(directory, 'cache'));
}
function remote(object: R2PreparedObject): R2RemoteObject {
  return { key: object.key, size: object.storedSize, etag: object.storedMd5,
    httpMetadata: { ...object.httpMetadata }, lastModified: '2026-09-15T12:00:00Z' };
}
function fakeOrigin(initial: readonly R2PreparedObject[]) {
  const state = new Map(initial.map((object) => [object.key, remote(object)]));
  const list = vi.fn(async () => structuredClone(state));
  const put = vi.fn(async (object: R2PreparedObject) => { state.set(object.key, remote(object)); });
  return { state, list, put, concurrency: 2 };
}

describe('verified incremental R2 publication', () => {
  it('selects only the two current namespaces and rejects unsafe or malformed build IDs', () => {
    const expressionBuild = 'a'.repeat(64);
    expect(queryPublicationPrefixes('123abc', expressionBuild, false)).toEqual([
      'query/123abc/', 'query/tracks.js', `query/expression/${expressionBuild}/`, 'query/expression-manifest.js',
    ]);
    expect(queryPublicationPrefixes(undefined, expressionBuild, true)).toHaveLength(2);
    for (const invalid of ['../other', '/absolute', 'build/child', '', undefined]) {
      expect(() => queryPublicationPrefixes(invalid, expressionBuild, false)).toThrow('invalid build ID');
      expect(() => queryPublicationPrefixes('valid', invalid, false)).toThrow('invalid build ID');
    }
  });
  it('bootstraps a fresh checkout from remote bytes and HTTP metadata without payload PUTs', async () => {
    const directory = await workspace();
    const object = await fixture('datasets/example/track.js', directory);
    const pointer = await fixture('query/tracks.js', directory);
    const origin = fakeOrigin([object, pointer]);
    const result = await synchronizeR2Objects([object, pointer], origin);
    expect(result).toMatchObject({ uploaded: [], unchanged: [object.key, pointer.key], planned: [], failures: [] });
    expect(origin.put).not.toHaveBeenCalled();
    expect(origin.list).toHaveBeenCalledTimes(1);
  });

  it('uploads only changed/missing objects and confirms both pointers after the payload barrier', async () => {
    const directory = await workspace();
    const old = await fixture('datasets/example/unchanged.js', directory);
    const shard = await fixture('query/expression/build/000.js', directory);
    const tracks = await fixture('query/tracks.js', directory);
    const expression = await fixture('query/expression-manifest.js', directory);
    const origin = fakeOrigin([old]);
    const result = await synchronizeR2Objects([old, shard, tracks, expression], origin);
    expect(result.uploaded).toEqual([shard.key, tracks.key, expression.key]);
    expect(origin.list).toHaveBeenCalledTimes(4);
    expect((await synchronizeR2Objects([old, shard, tracks, expression], origin)).uploaded).toEqual([]);
    expect(origin.put).toHaveBeenCalledTimes(3);
  });

  it('treats every HTTP metadata change as a write, including unexpected disposition and cache expiry', async () => {
    const object = await fixture('query/tracks.js', await workspace());
    expect(object.httpMetadata.cacheControl).toBe('public, max-age=300');
    expect(objectMetadata('query/expression-manifest.js').cacheControl).toBe('public, max-age=300');
    for (const [field, value] of Object.entries({ cacheControl: 'public, max-age=14400', contentType: 'text/plain',
      contentEncoding: 'gzip', contentLanguage: 'en', contentDisposition: 'attachment', cacheExpiry: '2099-01-01' })) {
      const other = remote(object);
      other.httpMetadata[field as keyof typeof other.httpMetadata] = value;
      expect(remoteMatches(object, other)).toBe(false);
    }
    const origin = fakeOrigin([object]);
    origin.state.get(object.key)!.httpMetadata.cacheControl = 'public, max-age=14400';
    expect((await synchronizeR2Objects([object], origin)).uploaded).toEqual([object.key]);
  });

  it('stores HypoMap .json.gz shards as gzip bytes with no Content-Encoding', async () => {
    const directory = await workspace();
    const file = path.join(directory, 'genes-0000.json.gz');
    const gzip = zlib.gzipSync(Buffer.from(JSON.stringify(Array.from({ length: 2000 }, (_, index) => [index, Math.random()]))));
    expect(gzip.length).toBeGreaterThanOrEqual(4096);
    await writeFile(file, gzip);
    const object = await prepareR2Object(file, 'hypomap/hypomap-atlas-2026-11-05/genes-0000.json.gz', path.join(directory, 'cache'));
    expect(object.httpMetadata).toEqual({ contentType: 'application/gzip', cacheControl: 'public, max-age=31536000, immutable' });
    expect((await readFile(object.uploadPath)).equals(gzip)).toBe(true);
  });

  it('detects changed content, wrong size and non-MD5/multipart etags instead of trusting a local record', async () => {
    const object = await fixture('datasets/example/a.js', await workspace());
    expect(remoteMatches(object, { ...remote(object), etag: 'a'.repeat(32) })).toBe(false);
    expect(remoteMatches(object, { ...remote(object), size: object.storedSize + 1 })).toBe(false);
    expect(remoteMatches(object, { ...remote(object), etag: `${object.storedMd5}-2` })).toBe(false);
    const origin = fakeOrigin([object]);
    origin.state.get(object.key)!.etag = 'multipart-2';
    const result = await synchronizeR2Objects([object], { ...origin, dryRun: true });
    expect(result.unverifiable).toEqual([object.key]);
    expect(result.planned).toEqual([object.key]);
    expect(origin.put).not.toHaveBeenCalled();
  });

  it('resumes after partial failures and never publishes either pointer on failure', async () => {
    const directory = await workspace();
    const good = await fixture('query/expression/build/000.js', directory);
    const bad = await fixture('query/expression/build/001.js', directory);
    const pointer = await fixture('query/expression-manifest.js', directory);
    const origin = fakeOrigin([]);
    const failed = await synchronizeR2Objects([good, bad, pointer], { ...origin,
      put: async (object) => { if (object.key === bad.key) throw new Error('Failed PUT'); await origin.put(object); },
    });
    expect(failed.uploaded).toEqual([good.key]);
    expect(failed.skippedPointers).toEqual([pointer.key]);
    expect(origin.state.has(pointer.key)).toBe(false);
    const resumed = await synchronizeR2Objects([good, bad, pointer], origin);
    expect(resumed.uploaded).toEqual([bad.key, pointer.key]);
    expect(resumed.unchanged).toEqual([good.key]);
  });

  it('withholds pointers when a skipped object disappears or the write does not persist', async () => {
    const directory = await workspace();
    const shard = await fixture('query/expression/build/000.js', directory);
    const pointer = await fixture('query/expression-manifest.js', directory);
    const origin = fakeOrigin([shard]);
    origin.list.mockImplementationOnce(async () => structuredClone(origin.state))
      .mockImplementation(async () => new Map());
    await expect(synchronizeR2Objects([shard, pointer], origin)).rejects.toThrow('Remote verification failed');
    expect(origin.put).not.toHaveBeenCalled();
    const lostWrite = fakeOrigin([]);
    await expect(synchronizeR2Objects([shard, pointer], { ...lostWrite, put: async () => {} })).rejects.toThrow('Remote verification failed');
    expect(lostWrite.state.has(pointer.key)).toBe(false);
  });

  it('detects a concurrent pointer change before publication', async () => {
    const directory = await workspace();
    const shard = await fixture('query/expression/build/000.js', directory);
    const pointer = await fixture('query/expression-manifest.js', directory);
    const origin = fakeOrigin([]);
    await expect(synchronizeR2Objects([shard, pointer], { ...origin, put: async (object) => {
      await origin.put(object);
      origin.state.set(pointer.key, { ...remote(pointer), etag: 'b'.repeat(32) });
    } })).rejects.toThrow('Concurrent publication');
    expect(origin.put.mock.calls.map(([object]) => object.key)).toEqual([shard.key]);
  });

  it('refuses a changed local snapshot before sending bytes', async () => {
    const object = await fixture('datasets/example/a.js', await workspace());
    await writeFile(object.uploadPath, 'changed bytes');
    const origin = fakeOrigin([]);
    const result = await synchronizeR2Objects([object], origin);
    expect(result.failures).toHaveLength(1);
    expect(origin.put).not.toHaveBeenCalled();
  });

  it('fails closed when origin listing fails and validates duplicate keys/concurrency', async () => {
    const object = await fixture('datasets/example/a.js', await workspace());
    const origin = fakeOrigin([]);
    await expect(synchronizeR2Objects([object], { ...origin, list: async () => { throw new Error('403'); } })).rejects.toThrow('403');
    await expect(synchronizeR2Objects([object, object], origin)).rejects.toThrow('Duplicate');
    await expect(synchronizeR2Objects([object], { ...origin, concurrency: 0 })).rejects.toThrow('positive integer');
    expect(origin.put).not.toHaveBeenCalled();
  });
});

describe('compression cache and local publication lock', () => {
  it('reuses verified compression, recovers from corruption, and invalidates source/settings changes', async () => {
    const directory = await workspace();
    const file = path.join(directory, 'bundle.js');
    const cache = path.join(directory, 'cache');
    await writeFile(file, 'var data = {};\n'.repeat(400));
    const encoder = vi.fn(promisify(zlib.brotliCompress));
    const first = await prepareR2Object(file, 'query/a.js', cache, { encoder });
    const second = await prepareR2Object(file, 'query/a.js', cache, { encoder });
    expect(second.cacheHit).toBe(true);
    expect(second.storedSha256).toBe(first.storedSha256);
    expect(encoder).toHaveBeenCalledTimes(1);
    await writeFile(first.uploadPath, Buffer.from('corrupted'));
    expect((await prepareR2Object(file, 'query/a.js', cache, { encoder })).cacheHit).toBe(false);
    expect(encoder).toHaveBeenCalledTimes(2);
    await prepareR2Object(file, 'query/a.js', cache, { encoder, encoderVersion: 'new-settings' });
    expect(encoder).toHaveBeenCalledTimes(3);
    await writeFile(file, 'var data = {changed:1};\n'.repeat(400));
    const changed = await prepareR2Object(file, 'query/a.js', cache, { encoder });
    expect(changed.sourceSha256).not.toBe(first.sourceSha256);
    expect(changed.uploadPath).not.toBe(first.uploadPath);
    expect(encoder).toHaveBeenCalledTimes(4);
  });

  it('stores identity snapshots and separates metadata policy from compression identity', async () => {
    const directory = await workspace();
    const file = path.join(directory, 'a.js');
    await writeFile(file, 'tiny');
    const a = await prepareR2Object(file, 'query/tracks.js', path.join(directory, 'cache'));
    const b = await prepareR2Object(file, 'query/build/a.js', path.join(directory, 'cache'));
    expect(a.uploadPath).toBe(b.uploadPath);
    expect(a.metadataSha256).not.toBe(b.metadataSha256);
    expect(a.httpMetadata.contentEncoding).toBeUndefined();
    await writeFile(file, 'mutated original');
    expect(await readFile(a.uploadPath, 'utf8')).toBe('tiny');
    expect(metadataHash({ contentType: 'a', cacheControl: 'b' })).toBe(metadataHash({ cacheControl: 'b', contentType: 'a' }));
  });

  it('locks per account/bucket and releases without deleting another scope', async () => {
    const directory = await workspace();
    const release = await acquireR2LocalLock(directory, 'account', 'bucket');
    await expect(acquireR2LocalLock(directory, 'account', 'bucket')).rejects.toThrow('Another publication');
    const other = await acquireR2LocalLock(directory, 'account', 'other-bucket');
    await release();
    const again = await acquireR2LocalLock(directory, 'account', 'bucket');
    await other(); await again();
  });
});

describe('R2 authenticated remote inventory', () => {
  const account = 'a'.repeat(32);
  const record = { key: 'query/a.js', size: 3, etag: 'c'.repeat(32), http_metadata: { contentType: 'application/javascript' } };
  const response = (result: unknown[], truncated = false, cursor?: string) => Response.json({ success: true, result,
    result_info: { is_truncated: truncated, ...(cursor ? { cursor } : {}) } });
  it('follows cursors and scopes requests to the exact official account/bucket origin', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response([record], true, 'next token'))
      .mockResolvedValueOnce(response([{ ...record, key: 'query/b.js' }]));
    const read = createR2InventoryReader({ account, bucket: 'test-bucket', token: 'secret-example', prefixes: ['query/'], fetch: request });
    expect((await read()).size).toBe(2);
    const [first, options] = request.mock.calls[0];
    expect(String(first)).toBe(`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/test-bucket/objects?prefix=query%2F&per_page=1000`);
    expect(options?.redirect).toBe('error');
    expect(String(request.mock.calls[1][0])).toContain('cursor=next+token');
  });

  it('rejects authorization errors, incomplete pagination, repeated cursors and malformed metadata', async () => {
    const request = vi.fn<typeof fetch>();
    const read = createR2InventoryReader({ account, bucket: 'test-bucket', token: 'secret-example', prefixes: ['query/'], fetch: request });
    request.mockResolvedValueOnce(new Response('sensitive details', { status: 403 }));
    await expect(read()).rejects.toThrow('HTTP 403');
    request.mockResolvedValueOnce(Response.json({ success: true, result: Array.from({ length: 1000 }, (_, i) => ({ ...record, key: `query/${i}.js` })) }));
    await expect(read()).rejects.toThrow('pagination status');
    request.mockResolvedValueOnce(response([], true, 'same')).mockResolvedValueOnce(response([], true, 'same'));
    await expect(read()).rejects.toThrow('cursor');
    request.mockResolvedValueOnce(response([{ ...record, size: 'three' }]));
    await expect(read()).rejects.toThrow('metadata');
    request.mockResolvedValueOnce(response([{ ...record, key: 'another-prefix/a.js' }]));
    await expect(read()).rejects.toThrow('metadata');
  });

  it('accepts the live API short final-page shape without result_info', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response([record], true, 'next'))
      .mockResolvedValueOnce(Response.json({ success: true, result: [{ ...record, key: 'query/last.js' }] }));
    const read = createR2InventoryReader({ account, bucket: 'test-bucket', token: 'example', prefixes: ['query/'], fetch: request });
    expect((await read()).size).toBe(2);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
