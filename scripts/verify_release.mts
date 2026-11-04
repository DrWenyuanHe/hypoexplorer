import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readReleaseBuild } from './lib/releaseBuild.mjs';

const root = process.cwd();
const dist = resolve(root, process.argv[2] ?? 'dist');
const read = (path: string) => readFileSync(resolve(dist, path), 'utf8');
const release = JSON.parse(read('release.json'));
const expected = readReleaseBuild(root);
for (const [key, value] of Object.entries(expected)) {
  assert.deepEqual(release[key], value, `Release metadata mismatch: ${key}; rebuild before publishing`);
}
const version = JSON.parse(read('version.json'));
assert.equal(version.version, expected.appVersion);
assert.equal(version.releaseId, expected.releaseId);
assert.equal(version.bundleBase, release.bundleBase);
const index = read('index.html');
const scripts = [...index.matchAll(/<script\b[^>]*\bsrc="(\/assets\/[^"?]+)(?:[^"]*)"/g)];
assert(scripts.length > 0, 'No production app bootstrap script');
for (const match of scripts) assert(existsSync(resolve(dist, `.${match[1]}`)), `Missing ${match[1]}`);
for (const guide of ['methods', 'how-to-cite', 'about', 'studies', 'topics']) {
  assert(read(`${guide}/index.html`).includes('<h1'), `${guide} public page is absent or empty`);
}
assert(read('CITATION.cff').includes(`version: ${expected.appVersion}`), 'Citation version differs from app');
assert(read('REUSE.md').includes('Reuse'), 'Reuse statement is missing');
console.log(`Verified release ${expected.releaseId} (v${expected.appVersion}, source ${expected.sourceDirty ? 'working tree' : 'committed'}).`);
