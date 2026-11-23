import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  diskOrigin, generationFiles, generationOf, httpOrigin, readQueryGeneration, type OriginReader,
} from '../../scripts/lib/queryGeneration.mjs';
import { expressionIndexGlobal } from '../expression-survey/expressionIndexFormat';

const TRACKS = '98dhrb1c2an0x';
const EXPRESSION = 'b'.repeat(64);
const manifest = { schemaVersion: 1, buildId: EXPRESSION, shardCount: 512, sources: [{ id: 's' }] };

/** A complete generation as the origin serves it, keyed like the bucket. */
function origin(overrides: Record<string, string | null> = {}): Record<string, string | null> {
  return {
    'query/tracks.js': `// generated\nvar HX_QUERY_TRACKS = {"v":2,"buildId":"${TRACKS}","tracks":[]};\n`,
    'query/expression-manifest.js': `var HX_EXPRESSION_MANIFEST = ${JSON.stringify(manifest)};\n`,
    [`query/expression/${EXPRESSION}/manifest.js`]: `var ${expressionIndexGlobal(EXPRESSION, 'manifest')} = ${JSON.stringify(manifest)};\n`,
    ...overrides,
  };
}

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function onDisk(files: Record<string, string | null>): Promise<OriginReader> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'query-generation-test-'));
  roots.push(root);
  for (const [key, text] of Object.entries(files)) {
    if (text === null) continue;
    await mkdir(path.dirname(path.join(root, key)), { recursive: true });
    await writeFile(path.join(root, key), text);
  }
  return diskOrigin(root);
}

/** The HTTP adapter over an in-memory origin; `status` overrides a key's response. */
function overHttp(files: Record<string, string | null>, status: Record<string, number> = {}) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    const key = url.replace('https://data.example.test/', '');
    const text = files[key];
    if (status[key]) return new Response('error', { status: status[key] });
    return text === null || text === undefined ? new Response('missing', { status: 404 }) : new Response(text, { status: 200 });
  });
  return { reader: httpOrigin('https://data.example.test/', { fetch: fetch as unknown as typeof globalThis.fetch, headers: { 'cache-control': 'no-cache' } }), requests };
}

const adapters = [
  ['disk', (files: Record<string, string | null>) => onDisk(files)],
  ['http', async (files: Record<string, string | null>) => overHttp(files).reader],
] as const;

describe.each(adapters)('readQueryGeneration over %s', (_name, make) => {
  it('reads both pointers and the immutable manifest they name, byte for byte', async () => {
    const files = origin();
    const read = await readQueryGeneration(await make(files));
    expect(generationOf(read)).toEqual({ tracks: TRACKS, expression: EXPRESSION });
    expect(generationFiles(read)).toEqual(Object.entries(files).map(([key, text]) => ({ key, text })));
  });

  it('reads the expression side alone on request, without the track pointer', async () => {
    const read = await readQueryGeneration(await make(origin({ 'query/tracks.js': null })), { tracks: false });
    expect(generationOf(read)).toEqual({ tracks: null, expression: EXPRESSION });
    expect(generationFiles(read).map((file) => file.key)).toEqual(['query/expression-manifest.js', `query/expression/${EXPRESSION}/manifest.js`]);
  });

  it('names the missing object', async () => {
    await expect(readQueryGeneration(await make(origin({ 'query/tracks.js': null })))).rejects.toThrow('/query/tracks.js is missing');
    await expect(readQueryGeneration(await make(origin({ [`query/expression/${EXPRESSION}/manifest.js`]: null }))))
      .rejects.toThrow(`/query/expression/${EXPRESSION}/manifest.js is missing`);
  });

  it('refuses an invalid build id and a pointer that disagrees with its manifest', async () => {
    await expect(readQueryGeneration(await make(origin({ 'query/tracks.js': 'var HX_QUERY_TRACKS = {"buildId":"../x"};' }))))
      .rejects.toThrow('invalid build id');
    const drifted = { ...manifest, sources: [] };
    await expect(readQueryGeneration(await make(origin({ 'query/expression-manifest.js': `var HX_EXPRESSION_MANIFEST = ${JSON.stringify(drifted)};` }))))
      .rejects.toThrow('does not match its immutable manifest');
  });
});

describe('httpOrigin', () => {
  it('requests each key under the origin with the given headers', async () => {
    const { reader, requests } = overHttp(origin());
    await readQueryGeneration(reader);
    // Both pointers first, then the manifest the expression pointer names.
    expect(requests.map((request) => request.url)).toEqual([
      'https://data.example.test/query/tracks.js',
      'https://data.example.test/query/expression-manifest.js',
      `https://data.example.test/query/expression/${EXPRESSION}/manifest.js`,
    ]);
    expect(requests.map((request) => request.init?.headers)).toEqual(Array(3).fill({ 'cache-control': 'no-cache' }));
  });

  it('treats a 404 as absent and any other failure as an error naming the URL', async () => {
    await expect(overHttp(origin()).reader.read('query/none.js')).resolves.toBeNull();
    await expect(readQueryGeneration(overHttp(origin(), { 'query/tracks.js': 503 }).reader))
      .rejects.toThrow('https://data.example.test/query/tracks.js: HTTP 503');
  });
});
