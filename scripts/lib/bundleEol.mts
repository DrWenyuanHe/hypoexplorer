// Tracked files whose working line endings differ from the committed blob, among
// those .gitattributes marks -text or eol=lf.
//
// The expression and evidence ledgers pin these files by exact-byte SHA-256:
// dataset bundles, retained sources, replay tables, DE results and the ledgers
// themselves. Every pin writer hashes the working file. .gitattributes fixes
// what a checkout writes for them, but Git never revisits files when attributes
// change: a checkout made before a file became -text or eol=lf keeps its CRLF
// copy, `git status` reports it clean, and `git checkout -- <path>` skips it as
// up to date. Hashing one there fails the evidence checks on other checkouts,
// or records a pin that only the stale copy satisfies, as the September 5
// replication reviews did with five source XMLs and the September 11 scientific
// snapshot with 62 bundles and 182 eol=lf result tables.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Every tracked file whose checkout bytes do not depend on core.autocrlf: those
 * .gitattributes exempts from conversion and those it fixes to LF. text=auto
 * files are left out, since autocrlf may legitimately write them as CRLF, and
 * so are Git LFS files: their committed blob is a pointer, never the working
 * bytes.
 */
export const FIXED_EOL_PATHSPECS: readonly string[] = [':(attr:-text !filter)', ':(attr:eol=lf !filter)'];

export interface EolDrift { path: string; index: string; worktree: string }

/**
 * Parse `git ls-files --eol -z`: `i/<class> w/<class> attr/<attrs>\t<path>`,
 * where the attributes may contain spaces. Drift means the committed and working
 * classes differ. A missing working file has no class; that is a deletion.
 */
export function parseEolDrift(output: string): EolDrift[] {
  const classOf = (field: string | undefined, prefix: string): string =>
    field?.startsWith(prefix) ? field.slice(prefix.length) : '';
  const drift: EolDrift[] = [];
  for (const record of output.split('\0')) {
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const [indexField, worktreeField] = record.slice(0, tab).trim().split(/\s+/);
    const index = classOf(indexField, 'i/');
    const worktree = classOf(worktreeField, 'w/');
    if (worktree && index !== worktree) drift.push({ path: record.slice(tab + 1), index, worktree });
  }
  return drift;
}

function insideWorkTree(cwd: string): boolean {
  try {
    return execFileSync('git', ['rev-parse', '--is-inside-work-tree'],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'true';
  } catch {
    return false; // no repository, or no Git
  }
}

/**
 * Tracked regular files under `pathspecs` whose working size differs from their
 * committed blob. Converting line endings always changes a file's length, so no
 * other file can have drifted; `ls-files --eol` reads every file in full to
 * classify it, which over gigabytes of bundles and sources cost minutes.
 */
function sizeChanged(pathspecs: readonly string[], cwd: string): string[] {
  // Batched to stay inside the Windows command-line limit: restore:bundle-eol
  // re-checks every file it restored by literal path, 1,122 at once in the main
  // checkout, about 76,000 characters of arguments.
  const byPath = new Map<string, { mode: string; oid: string; path: string }>();
  for (let i = 0; i < pathspecs.length; i += 100) {
    const records = execFileSync('git', ['ls-files', '-s', '-z', '--', ...pathspecs.slice(i, i + 100)],
      { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0');
    for (const record of records.filter(Boolean)) {
      const tab = record.indexOf('\t');
      const [mode, oid] = record.slice(0, tab).split(' ');
      byPath.set(record.slice(tab + 1), { mode, oid, path: record.slice(tab + 1) });
    }
  }
  const entries = [...byPath.values()].filter((entry) => entry.mode === '100644' || entry.mode === '100755');
  if (!entries.length) return [];
  // --buffer: unbuffered, Git flushes the pipe per object, ~3 ms each on Windows.
  const sizes = execFileSync('git', ['cat-file', '--batch-check=%(objectsize)', '--buffer'],
    { cwd, encoding: 'utf8', input: `${entries.map((entry) => entry.oid).join('\n')}\n`, maxBuffer: 64 * 1024 * 1024 })
    .trim()
    .split('\n')
    .map(Number);
  return entries.filter((entry, i) => {
    try {
      return statSync(path.join(cwd, entry.path)).size !== sizes[i];
    } catch {
      return false; // deleted, which is not drift
    }
  }).map((entry) => entry.path);
}

/**
 * Drift under `pathspecs`, or null outside a Git work tree: a source archive has
 * no committed bytes to disagree with. Inside one, Git errors propagate rather
 * than silently passing the check.
 */
export function findEolDrift(pathspecs: readonly string[], cwd = process.cwd()): EolDrift[] | null {
  if (!insideWorkTree(cwd)) return null;
  const candidates = sizeChanged(pathspecs, cwd);
  const drift: EolDrift[] = [];
  // Batched to stay inside the Windows command-line limit.
  for (let i = 0; i < candidates.length; i += 100) {
    const literal = candidates.slice(i, i + 100).map((file) => `:(literal)${file}`);
    drift.push(...parseEolDrift(execFileSync('git', ['ls-files', '--eol', '-z', '--', ...literal],
      { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })));
  }
  return drift;
}

/** CRLF read as LF, byte-wise, so a lone CR still counts as content. */
function toLf(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10) continue;
    out[n++] = bytes[i];
  }
  return out.subarray(0, n);
}

export function sameExceptLineEndings(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(toLf(a)).equals(toLf(b));
}

/**
 * Restore each drifted file whose only difference from its committed blob is
 * its line endings. Deleting first is what makes this work: with its stat
 * unchanged, Git treats the stale copy as up to date and a plain checkout leaves
 * it. A file that also differs in content is kept, since restoring it would
 * discard an edit.
 */
export function restoreEolDrift(drift: readonly EolDrift[], cwd = process.cwd()): { restored: string[]; kept: string[] } {
  const restored: string[] = [];
  const kept: string[] = [];
  for (const entry of drift) {
    const committed = execFileSync('git', ['cat-file', 'blob', `:${entry.path}`], { cwd, maxBuffer: 256 * 1024 * 1024 });
    (sameExceptLineEndings(readFileSync(path.join(cwd, entry.path)), committed) ? restored : kept).push(entry.path);
  }
  // Batched to stay inside the Windows command-line limit.
  for (let i = 0; i < restored.length; i += 100) {
    const batch = restored.slice(i, i + 100);
    for (const file of batch) rmSync(path.join(cwd, file));
    try {
      execFileSync('git', ['checkout', '--', ...batch], { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      throw new Error(`Deleted ${batch.length} stale file(s) but could not check them out again; `
        + `run \`git checkout -- <path>\` for each: ${batch.join(', ')}`, { cause: error });
    }
  }
  return { restored, kept };
}
