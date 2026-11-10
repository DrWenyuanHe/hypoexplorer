// Restore the pinned public data release into this checkout.
//
//   pnpm run fetch:data                 # every archive in data-release.json
//   pnpm run fetch:data --no-matrices   # skip the optional normalized-matrix archives
//
// data-release.json names a hypoexplorer-data release: archive URLs with their
// SHA-256, and files.tsv with every file's SHA-256. Each archive is downloaded,
// checked, and unpacked into its usual path (data/..., geo_replication/...), and
// each file is checked against files.tsv. The restored paths are listed in this
// clone's .git/info/exclude, so they never show up as changes to commit.
//
// Only the analysis pipeline and the bundle builders need this; the app itself
// reads its bundles from the data origin (pnpm run fetch:query).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { readTar } from './lib/tarball.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skipMatrices = process.argv.includes('--no-matrices');
const pin = JSON.parse(readFileSync(path.join(ROOT, 'data-release.json'), 'utf8')) as {
  tag: string;
  files: { url: string; sha256: string };
  parts: { name: string; url: string; sha256: string; compression: 'gzip' | 'none'; optional: boolean; files: number }[];
};
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

// Retries a dropped connection or a 5xx up to four times with backoff; a 4xx or a
// hash mismatch fails at once, because retrying cannot fix either.
async function download(url: string, expected: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    let failure: string;
    try {
      const response = await fetch(url);
      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (sha256(bytes) !== expected) throw Object.assign(new Error(`${url}: SHA-256 does not match data-release.json`), { final: true });
        return bytes;
      }
      if (response.status < 500) throw Object.assign(new Error(`${url}: HTTP ${response.status}`), { final: true });
      failure = `HTTP ${response.status}`;
    } catch (error) {
      if ((error as { final?: boolean }).final) throw error;
      failure = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
    }
    if (attempt === 4) throw new Error(`${url}: ${failure} (after ${attempt} attempts)`);
    console.warn(`  ${url}: ${failure}; retrying`);
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
  }
}

const index = new Map((await download(pin.files.url, pin.files.sha256)).toString('utf8').trim().split('\n').slice(1)
  .map((line) => { const [file, , , digest] = line.split('\t'); return [file, digest] as const; }));

// Phase 1: download and verify every selected archive and member. Nothing is
// written until all of them check out, so a failed fetch leaves the checkout as it was.
const staged: { file: string; bytes: Buffer }[] = [];
for (const part of pin.parts) {
  if (part.optional && skipMatrices) { console.log(`skipped ${part.name} (--no-matrices)`); continue; }
  const archive = await download(part.url, part.sha256);
  let count = 0;
  for (const { path: file, bytes } of readTar(part.compression === 'gzip' ? gunzipSync(archive) : archive)) {
    if (index.get(file) !== sha256(bytes)) throw new Error(`${file}: not the file files.tsv pins`);
    staged.push({ file, bytes });
    count++;
  }
  if (count !== part.files) throw new Error(`${part.name}: expected ${part.files} files, unpacked ${count}`);
  console.log(`verified ${part.name}: ${count.toLocaleString()} files`);
}

// Phase 2: install. Each target must resolve inside this checkout with no
// symlink or junction on the way, so an archive cannot write elsewhere.
const realRoot = realpathSync(ROOT);
// lstat, not existsSync: existsSync follows links, so a dangling link would look absent.
const entryAt = (at: string) => { try { return lstatSync(at); } catch { return null; } };
function confined(file: string): string {
  const target = path.join(realRoot, ...file.split('/'));
  if (!target.startsWith(realRoot + path.sep)) throw new Error(`${file}: resolves outside the checkout`);
  for (let dir = path.dirname(target); dir.length > realRoot.length; dir = path.dirname(dir)) {
    const stat = entryAt(dir);
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(dir) !== dir)) throw new Error(`${file}: ${path.relative(realRoot, dir)} is a link or not a directory; refusing to write through it`);
  }
  const stat = entryAt(target);
  if (stat && !stat.isFile()) throw new Error(`${file}: target is a link or not a regular file; refusing to overwrite it`);
  return target;
}
const targets = staged.map(({ file }) => confined(file));

// Install as one transaction. Each file is written to a temporary sibling and
// renamed over its target: the old directory entry is replaced, never written
// through, so a hardlinked copy elsewhere keeps its bytes. An overwritten
// target is first renamed to a backup. The git-exclude update (which keeps
// restored files out of `git status` in this clone) is part of the same
// transaction. On any failure every step is undone, and an undo that itself
// fails is reported by name with where its original now is.
const exclude = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: ROOT, encoding: 'utf8' }).trim();
const excludePath = path.isAbsolute(exclude) ? exclude : path.join(ROOT, exclude);
const begin = '# >>> fetch:data (managed; do not edit)', end = '# <<< fetch:data';
const stamp = `.fetch-data-${process.pid}`;
type Step = { target: string; backup: string | null };
const done: Step[] = [];
const install = (target: string, bytes: Buffer) => {
  mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}${stamp}.new`;
  writeFileSync(temp, bytes, { flag: 'wx' });
  const backup = entryAt(target) ? `${target}${stamp}.old` : null;
  if (backup) renameSync(target, backup);
  done.push({ target, backup });
  renameSync(temp, target);
};
try {
  for (const [i, { bytes }] of staged.entries()) install(targets[i], bytes);
  const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
  const kept = current.replace(new RegExp(`${begin}[\\s\\S]*?${end}\\n?`), '');
  install(excludePath, Buffer.from(`${kept.trimEnd()}\n${begin}\n${[...new Set(staged.map((s) => s.file))].sort().map((f) => `/${f}`).join('\n')}\n${end}\n`, 'utf8'));
} catch (error) {
  const unrecovered: string[] = [];
  for (const { target, backup } of done.reverse()) {
    try {
      rmSync(target, { force: true });
      if (backup) renameSync(backup, target);
    } catch { unrecovered.push(backup ? `${target} (original kept at ${backup})` : target); }
  }
  for (const target of targets) rmSync(`${target}${stamp}.new`, { force: true });
  throw new Error(unrecovered.length
    ? `install failed and ${unrecovered.length} file(s) could not be restored: ${unrecovered.join('; ')}`
    : `install failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`);
}
// Committed: drop the backups.
for (const { backup } of done) if (backup) rmSync(backup, { force: true });
console.log(`data release ${pin.tag}: ${staged.length.toLocaleString()} files installed and excluded from git status`);
