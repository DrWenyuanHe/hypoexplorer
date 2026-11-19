import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pin = vi.hoisted(() => ({ tag: 'hypomap-atlas-test', archive: 'hypomap-atlas.tar.gz', archiveSha256: '', manifestSha256: '' }));
vi.mock('../../hypomap-release.json', () => ({ default: pin }));

const { HYPOMAP_KEY_PREFIX, installedHypomapAtlas } = await import('../../scripts/lib/hypomapAtlas.mjs');

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

/** A public/ root holding a small release for the mocked pin; returns the root and the atlas directory. */
async function install(files: Record<string, string>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hypomap-atlas-test-'));
  roots.push(root);
  const directory = path.join(root, 'hypomap', pin.tag);
  await mkdir(directory, { recursive: true });
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(directory, name), content);
  const manifest = JSON.stringify({
    schema_version: 1, shard_size: 2,
    files: Object.entries(files).map(([name, content]) => ({ path: name, bytes: Buffer.byteLength(content), sha256: sha(content) })),
  });
  await writeFile(path.join(directory, 'manifest.json'), manifest);
  pin.manifestSha256 = sha(manifest);
  return { root, directory };
}

const release = { 'metadata.json.gz': 'm', 'search-index.json.gz': 's', 'genes-0000.json.gz': 'g0', 'genes-0001.json.gz': 'g1' };

describe('installedHypomapAtlas', () => {
  it('uses the pinned tag as the key prefix', () => {
    expect(HYPOMAP_KEY_PREFIX).toBe('hypomap/hypomap-atlas-test/');
  });

  it('returns null when the pinned tag is not installed', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'hypomap-atlas-test-'));
    roots.push(root);
    await mkdir(path.join(root, 'hypomap', 'hypomap-atlas-other'), { recursive: true });
    expect(await installedHypomapAtlas(root)).toBeNull();
  });

  it('lists the manifest and every file it names after verifying them', async () => {
    const { root, directory } = await install(release);
    const files = await installedHypomapAtlas(root);
    expect(files?.map((file) => path.relative(directory, file)).sort()).toEqual(['manifest.json', ...Object.keys(release)].sort());
  });

  it('refuses a manifest other than the pinned one', async () => {
    const { root } = await install(release);
    pin.manifestSha256 = '0'.repeat(64);
    await expect(installedHypomapAtlas(root)).rejects.toThrow(/does not match hypomap-release.json/);
  });

  it('refuses altered, extra or misnamed files', async () => {
    const altered = await install(release);
    await writeFile(path.join(altered.directory, 'genes-0001.json.gz'), 'changed');
    await expect(installedHypomapAtlas(altered.root)).rejects.toThrow(/genes-0001\.json\.gz does not match the manifest/);

    const extra = await install(release);
    await writeFile(path.join(extra.directory, 'notes.txt'), 'x');
    await expect(installedHypomapAtlas(extra.root)).rejects.toThrow(/Unexpected entry .*notes\.txt/);

    const misnamed = await install({ ...release, 'genes-abcd.json.gz': 'x' });
    await expect(installedHypomapAtlas(misnamed.root)).rejects.toThrow(/unexpected file: genes-abcd\.json\.gz/);
  });
});
