import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { uploadWithPublicationBarrier } from './uploadPublication.mjs';

export const R2_POINTER_KEYS = new Set(['query/tracks.js', 'query/expression-manifest.js']);
const compress = promisify(zlib.brotliCompress);
const decompress = promisify(zlib.brotliDecompress);
const HTTP_FIELDS = ['cacheControl', 'cacheExpiry', 'contentDisposition', 'contentEncoding', 'contentLanguage', 'contentType'] as const;
export type R2HttpMetadata = Partial<Record<(typeof HTTP_FIELDS)[number], string>>;
export interface R2RemoteObject {
  key: string;
  etag: string;
  size: number;
  httpMetadata: R2HttpMetadata;
  lastModified?: string;
}
export interface R2PreparedObject {
  key: string;
  sourceSha256: string;
  sourceSize: number;
  storedSha256: string;
  storedMd5: string;
  storedSize: number;
  uploadPath: string;
  httpMetadata: R2HttpMetadata;
  metadataSha256: string;
  cacheHit: boolean;
}
export const digest = (algorithm: 'sha256' | 'md5', bytes: Uint8Array | string): string =>
  createHash(algorithm).update(bytes).digest('hex');

export function queryPublicationPrefixes(tracksBuildId: unknown, expressionBuildId: unknown, expressionOnly: boolean): string[] {
  if (typeof expressionBuildId !== 'string' || !/^[a-f0-9]{64}$/.test(expressionBuildId)) throw new Error('Expression query pointer has an invalid build ID.');
  const expression = [`query/expression/${expressionBuildId}/`, 'query/expression-manifest.js'];
  if (expressionOnly) return expression;
  if (typeof tracksBuildId !== 'string' || !/^[a-z0-9]{1,64}$/.test(tracksBuildId)) throw new Error('Track query pointer has an invalid build ID.');
  return [`query/${tracksBuildId}/`, 'query/tracks.js', ...expression];
}

export function metadataHash(metadata: R2HttpMetadata): string {
  return digest('sha256', JSON.stringify(HTTP_FIELDS.map((field) => metadata[field] ?? '')));
}

export function objectMetadata(key: string): R2HttpMetadata {
  const extension = path.extname(key).toLowerCase();
  const types: Record<string, string> = {
    '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
    '.map': 'application/json; charset=utf-8', '.pdf': 'application/pdf',
    // HypoMap .json.gz: gzip bytes with no Content-Encoding, so neither the edge
    // nor the browser decodes them before the app checks their SHA-256.
    '.gz': 'application/gzip',
  };
  return {
    contentType: types[extension] ?? 'application/octet-stream',
    cacheControl: R2_POINTER_KEYS.has(key) ? 'public, max-age=300' : 'public, max-age=31536000, immutable',
  };
}

/** Cache bytes, not a claim that an object exists remotely. Every hit is verified. */
export async function prepareR2Object(file: string, key: string, cacheDirectory: string, options: {
  encoder?: (bytes: Buffer) => Promise<Buffer>;
  encoderVersion?: string;
} = {}): Promise<R2PreparedObject> {
  const source = await readFile(file);
  const sourceSha256 = digest('sha256', source);
  const encoded = ['.js', '.json', '.csv', '.txt', '.map'].includes(path.extname(file).toLowerCase()) && source.length >= 4096;
  const settings = encoded ? `br:q11:size-hint:node-${process.versions.brotli}:${options.encoderVersion ?? '1'}` : 'identity:1';
  const cacheKey = digest('sha256', `${sourceSha256}:${settings}`);
  await mkdir(cacheDirectory, { recursive: true });
  const uploadPath = path.join(cacheDirectory, `${cacheKey}.${encoded ? 'br' : 'bin'}`);
  let stored: Buffer | undefined;
  let cacheHit = false;
  try {
    const candidate = await readFile(uploadPath);
    // A corrupt or replaced cache entry cannot influence the outgoing payload.
    const restored = encoded ? await decompress(candidate, { maxOutputLength: source.length + 1 }) : candidate;
    if (restored.equals(source)) { stored = candidate; cacheHit = true; }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EACCES') throw error;
  }
  if (!stored) {
    stored = encoded ? await (options.encoder ?? ((bytes) => compress(bytes, { params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
    } })))(source) : source;
    const temporary = `${uploadPath}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, stored); await rename(temporary, uploadPath); }
    finally { await rm(temporary, { force: true }); }
  }
  const httpMetadata = { ...objectMetadata(key), ...(encoded ? { contentEncoding: 'br' } : {}) };
  return {
    key, sourceSha256, sourceSize: source.length,
    storedSha256: digest('sha256', stored), storedMd5: digest('md5', stored), storedSize: stored.length,
    uploadPath, httpMetadata, metadataSha256: metadataHash(httpMetadata), cacheHit,
  };
}

export function remoteMatches(local: R2PreparedObject, remote?: R2RemoteObject): boolean {
  return !!remote && local.key === remote.key && /^[a-f0-9]{32}$/i.test(remote.etag)
    && local.storedMd5 === remote.etag.toLowerCase() && local.storedSize === remote.size
    && local.metadataSha256 === metadataHash(remote.httpMetadata);
}

function sameRemote(a?: R2RemoteObject, b?: R2RemoteObject): boolean {
  if (!a || !b) return a === b;
  return a.key === b.key && a.etag === b.etag && a.size === b.size
    && a.lastModified === b.lastModified && metadataHash(a.httpMetadata) === metadataHash(b.httpMetadata);
}

/** All skips are based on a fresh account/bucket-scoped origin inventory. */
export async function synchronizeR2Objects(objects: readonly R2PreparedObject[], options: {
  concurrency: number;
  dryRun?: boolean;
  list: () => Promise<Map<string, R2RemoteObject>>;
  put: (object: R2PreparedObject) => Promise<void>;
  onSettled?: (object: R2PreparedObject, error?: unknown) => void;
}): Promise<{
  uploaded: string[];
  unchanged: string[];
  planned: string[];
  unverifiable: string[];
  failures: Array<{ object: R2PreparedObject; error: unknown }>;
  skippedPointers: string[];
}> {
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw new Error('Upload concurrency must be a positive integer.');
  if (new Set(objects.map((object) => object.key)).size !== objects.length) throw new Error('Duplicate R2 object keys.');
  const initial = await options.list();
  const changed = objects.filter((object) => !remoteMatches(object, initial.get(object.key)));
  const planned = changed.map((object) => object.key);
  const unchanged = objects.filter((object) => remoteMatches(object, initial.get(object.key))).map((object) => object.key);
  const unverifiable = objects.filter((object) => {
    const remote = initial.get(object.key);
    return remote && !/^[a-f0-9]{32}$/i.test(remote.etag);
  }).map((object) => object.key);
  const result = { uploaded: [] as string[], unchanged, planned, unverifiable,
    failures: [] as Array<{ object: R2PreparedObject; error: unknown }>, skippedPointers: [] as string[] };
  if (options.dryRun || !changed.length) return result;
  const pointers = changed.filter((object) => R2_POINTER_KEYS.has(object.key));
  const payloads = changed.filter((object) => !R2_POINTER_KEYS.has(object.key));
  const required = objects.filter((object) => !R2_POINTER_KEYS.has(object.key));
  const upload = async (object: R2PreparedObject) => {
    const bytes = await readFile(object.uploadPath);
    if (bytes.length !== object.storedSize || digest('sha256', bytes) !== object.storedSha256) {
      throw new Error(`Prepared upload changed on disk: ${object.key}`);
    }
    await options.put(object);
    result.uploaded.push(object.key);
  };
  const payloadResult = await uploadWithPublicationBarrier(payloads, [], {
    concurrency: options.concurrency, upload, onSettled: options.onSettled,
  });
  result.failures.push(...payloadResult.failures);
  if (result.failures.length) { result.skippedPointers = pointers.map((object) => object.key); return result; }

  // Re-list after all writes. A successful CLI exit alone cannot publish a build.
  // Detect overlap by another publisher; no undocumented REST conditional PUT is assumed.
  const verify = async (expectedPointers: readonly R2PreparedObject[]) => {
    const current = await options.list();
    for (const object of [...required, ...expectedPointers]) {
      if (!remoteMatches(object, current.get(object.key))) throw new Error(`Remote verification failed (missing, changed or unverifiable object): ${object.key}`);
    }
    return current;
  };
  let current = await verify([]);
  for (const pointer of objects.filter((object) => R2_POINTER_KEYS.has(object.key))) {
    if (!sameRemote(initial.get(pointer.key), current.get(pointer.key))) {
      throw new Error(`Concurrent publication detected: ${pointer.key} changed. No new pointers were published.`);
    }
  }
  const publishedPointers: R2PreparedObject[] = [];
  for (let index = 0; index < pointers.length; index++) {
    const pointer = pointers[index];
    try {
      // Verify immediately before each pointer, including previously written pointers.
      if (index > 0) current = await verify(publishedPointers);
      if (!sameRemote(initial.get(pointer.key), current.get(pointer.key))) throw new Error(`Concurrent publication detected: ${pointer.key}`);
      await upload(pointer);
      publishedPointers.push(pointer);
      options.onSettled?.(pointer);
    } catch (error) {
      result.failures.push({ object: pointer, error });
      result.skippedPointers = pointers.slice(index + 1).map((object) => object.key);
      options.onSettled?.(pointer, error);
      return result;
    }
  }
  // Verify unchanged pointers too: a publisher can have started during our PUTs.
  await verify(objects.filter((object) => R2_POINTER_KEYS.has(object.key)));
  return result;
}

/** Local exclusive writer lock. Cross-host publishers must still be serialized in CI. */
export async function acquireR2LocalLock(directory: string, account: string, bucket: string): Promise<() => Promise<void>> {
  await mkdir(directory, { recursive: true });
  const lockPath = path.join(directory, `${digest('sha256', `${account}/${bucket}`)}.lock`);
  let handle: FileHandle;
  try { handle = await open(lockPath, 'wx'); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new Error(`Another publication holds ${lockPath}. If its process stopped, inspect and remove that stale lock before retrying.`);
    }
    throw error;
  }
  await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  return async () => { await handle.close(); await rm(lockPath, { force: true }); };
}
