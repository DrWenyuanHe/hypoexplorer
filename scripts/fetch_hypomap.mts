import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { readTar } from './lib/tarball.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const pin = JSON.parse(await readFile(path.join(root, 'hypomap-release.json'), 'utf8'));
const source = process.argv[2];
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const url = `https://github.com/DrWenyuanHe/hypoexplorer-data/releases/download/${pin.tag}/${pin.archive}`;
const bytes = source ? await readFile(source) : await (async () => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Atlas release returned HTTP ${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
})();
if (sha(bytes) !== pin.archiveSha256) throw new Error('Atlas archive checksum mismatch');

const members = [...readTar(gunzipSync(bytes))];
const manifest = members.find(member => member.path === 'manifest.json');
if (!manifest || sha(manifest.bytes) !== pin.manifestSha256) throw new Error('Atlas manifest checksum mismatch');
const index = JSON.parse(manifest.bytes.toString('utf8')) as {
  files: { path: string; bytes: number; sha256: string }[];
};
const expected = new Map(index.files.map(file => [file.path, file]));
for (const member of members) {
  if (member === manifest) continue;
  const file = expected.get(member.path);
  if (!file || !/^(metadata|search-index|genes-\d{4})\.json\.gz$/.test(member.path)
    || file.bytes !== member.bytes.length || file.sha256 !== sha(member.bytes)) {
    throw new Error(`Invalid atlas release member: ${member.path}`);
  }
  expected.delete(member.path);
}
if (expected.size) throw new Error('Atlas archive is incomplete');

const publicRoot = path.join(root, 'public', 'hypomap');
const destination = path.join(publicRoot, pin.tag);
await mkdir(publicRoot, { recursive: true });
const temporary = await mkdtemp(path.join(publicRoot, '.install-'));
try {
  for (const member of members) await writeFile(path.join(temporary, member.path), member.bytes);
  await rename(temporary, destination);
} catch (error) {
  const existing = await readFile(path.join(destination, 'manifest.json')).catch(() => null);
  if (!existing || sha(existing) !== pin.manifestSha256) throw error;
  for (const member of members) {
    const file = await readFile(path.join(destination, member.path));
    if (sha(file) !== sha(member.bytes)) throw new Error(`Existing atlas file is invalid: ${member.path}`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log(`Verified ${members.length} atlas files at ${destination}`);
