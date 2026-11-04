import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPRESENTATIVE_TRACKS, verifyServedReleaseData } from '../../scripts/lib/deployedDataVerification.mjs';
import { sha256 } from '../../scripts/lib/releaseBuild.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'hypo-deployed-data-'));
  roots.push(root);
  const expressionBuildId = 'e'.repeat(64);
  const paths = ['/query/tracks.js', '/query/expression-manifest.js',
    `/query/expression/${expressionBuildId}/manifest.js`, ...REPRESENTATIVE_TRACKS];
  const files = new Map(paths.map((path) => [path, Buffer.from(`var DATA = {"buildId":"same","path":"${path}"};\n`)]));
  for (const [path, bytes] of files) {
    const file = join(root, 'public', path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  const urls: string[] = [];
  const options = { dataOrigin: 'https://data.example.test', bundleVersion: 'f'.repeat(32), expressionBuildId,
    querySha256: sha256(files.get('/query/tracks.js')!) };
  const fetchBytes = async (url: string) => {
    urls.push(url);
    const body = files.get(new URL(url).pathname);
    return { status: body ? 200 : 404, body: body ?? Buffer.from('Missing') };
  };
  return { root, files, paths, urls, options, fetchBytes };
}

describe('deployed release data byte verification', () => {
  it('uses the browser release cache key for mutable files and the pinned expression URL without a query', async () => {
    const f = fixture();
    const results = await verifyServedReleaseData(f.root, f.options, f.fetchBytes);
    expect(results).toHaveLength(5);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(f.urls[0]).toBe(`https://data.example.test/query/tracks.js?v=${f.options.bundleVersion}`);
    expect(f.urls[1]).toContain(`expression-manifest.js?v=${f.options.bundleVersion}`);
    expect(f.urls[2]).toBe(`https://data.example.test/query/expression/${f.options.expressionBuildId}/manifest.js`);
    expect(f.urls[3]).toContain(`?v=${f.options.bundleVersion}`);
  });

  it.each([0, 1, 2, 3, 4])('rejects changed bytes in object %i despite an unchanged buildId', async (index) => {
    const f = fixture();
    f.files.set(f.paths[index], Buffer.from('var DATA = {"buildId":"same","changed":true};\n'));
    const results = await verifyServedReleaseData(f.root, f.options, f.fetchBytes);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(results[index].detail).toContain('expected');
  });

  it('fails closed for unavailable objects and a local query pointer outside the release identity', async () => {
    const f = fixture();
    f.options.querySha256 = '0'.repeat(64);
    f.files.delete(f.paths[2]);
    const results = await verifyServedReleaseData(f.root, f.options, f.fetchBytes);
    expect(results[0]).toMatchObject({ ok: false });
    expect(results[0].detail).toContain('Local query pointer');
    expect(results[2]).toMatchObject({ ok: false });
    expect(results[2].detail).toContain('HTTP 404');
  });
});
