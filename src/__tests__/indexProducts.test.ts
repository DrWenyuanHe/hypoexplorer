import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeIndexProduct } from '../../scripts/lib/indexProducts.mjs';

const created: string[] = [];
async function directory(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hx-index-product-'));
  created.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of created.splice(0)) {
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('hx-index-product-')) throw new Error('Unexpected test cleanup path');
    await rm(resolved, { recursive: true, force: true });
  }
});

describe('immutable index products', () => {
  it('leaves identical bytes and modification times untouched and refuses changed immutable content', async () => {
    const file = path.join(await directory(), 'generation', 'shard.js');
    await writeIndexProduct(file, 'original', { immutable: true });
    const before = (await stat(file)).mtimeMs;
    await writeIndexProduct(file, 'original', { immutable: true });
    expect((await stat(file)).mtimeMs).toBe(before);
    await expect(writeIndexProduct(file, 'changed', { immutable: true })).rejects.toThrow('immutable index object');
    expect(await readFile(file, 'utf8')).toBe('original');
  });

  it('uses atomic pointer replacement and leaves no temporary product after concurrent immutable writes', async () => {
    const dir = await directory();
    const file = path.join(dir, 'shard.js');
    await Promise.all([writeIndexProduct(file, 'same', { immutable: true }), writeIndexProduct(file, 'same', { immutable: true })]);
    const pointer = path.join(dir, 'manifest.js');
    await writeIndexProduct(pointer, 'old', { immutable: false });
    await writeIndexProduct(pointer, 'new', { immutable: false });
    expect(await readFile(pointer, 'utf8')).toBe('new');
    expect((await readdir(dir)).sort()).toEqual(['manifest.js', 'shard.js']);
  });

  it('checks current or missing files without writing or replacing anything', async () => {
    const dir = await directory();
    const file = path.join(dir, 'shard.js');
    await expect(writeIndexProduct(file, 'required', { immutable: true, check: true })).rejects.toThrow('missing or stale');
    expect(await readdir(dir)).toEqual([]);
    await writeFile(file, 'old', 'utf8');
    await expect(writeIndexProduct(file, 'required', { immutable: false, check: true })).rejects.toThrow('missing or stale');
    expect(await readFile(file, 'utf8')).toBe('old');
  });
});
