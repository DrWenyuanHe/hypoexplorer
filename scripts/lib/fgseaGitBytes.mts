import { execFileSync } from 'node:child_process';
import { isAbsolute } from 'node:path';

type GitHasher = (root: string, paths: string[], raw: boolean) => string[];

const gitHashes: GitHasher = (root, paths, raw) => execFileSync(
  'git', ['hash-object', ...(raw ? ['--no-filters'] : []), '--stdin-paths'],
  { cwd: root, input: `${paths.join('\n')}\n`, encoding: 'utf8', windowsHide: true,
    maxBuffer: 4 * 1024 * 1024 },
).trim().split(/\r?\n/);

/** Read-only: no -w, index writes, or file conversion; catches Git clean filters. */
export function assertGitPreservesFileBytes(root: string, files: string[], hash: GitHasher = gitHashes): void {
  const paths = [...new Set(files)];
  if (paths.some((path) => !path || isAbsolute(path) || /^[A-Za-z]:/.test(path)
    || path.includes('\\') || path.split('/').includes('..') || /[\r\n]/.test(path))) {
    throw new Error('Hash-pinned analysis paths must be safe relative POSIX paths');
  }
  if (!paths.length) return;
  const raw = hash(root, paths, true);
  const clean = hash(root, paths, false);
  if (raw.length !== paths.length || clean.length !== paths.length
    || [...raw, ...clean].some((value) => !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value))) {
    throw new Error('Git did not return one valid blob hash per analysis file');
  }
  const changed = paths.filter((_, index) => raw[index] !== clean[index]);
  if (changed.length) throw new Error(
    `Git would alter ${changed.length} exact-byte analysis artifact(s); preserve their bytes in .gitattributes: ${changed.join(', ')}`,
  );
}
