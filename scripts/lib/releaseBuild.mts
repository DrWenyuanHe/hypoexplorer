import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import type { ReleaseIdentity } from '../../src/data/releaseIdentity';
import { readQueryCatalogBuild } from './queryCatalogBuild.mjs';
import { readExpressionIndexBuild } from './expressionIndexBuildIdentity.mjs';

export const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');

// Deliberate allow-list: no .env files, credentials, worktrees, raw study downloads,
// local manuscripts or scratch directories enter a source archive or fingerprint.
export function isReleaseSource(path: string): boolean {
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) return true;
  if (['.gitignore', '.gitattributes', 'public/.htaccess', 'public/.assetsignore'].includes(path)) return true;
  if (path === 'nar-research/dataset-survey/scout_master_combined.json') return true;
  if (/(^|\/)(?:\.[^/]+|node_modules|dist)(\/|$)/.test(path)) return false;
  if (/^(?:package(?:-lock)?\.json|index\.html|(?:vite|playwright)\.config\.ts|tsconfig(?:\.node)?\.json|biome\.json|wrangler\.jsonc|VERSION|README\.md|CHANGELOG\.md|CITATION\.cff|LICENSE|REUSE\.md)$/.test(path)) return true;
  // These retained evidence/config imports affect rendered scientific claims
  // independently of the query index. They are required to rebuild the app.
  if (/^data\/.+\.(?:json|ts|mts|mjs|R|py)$/.test(path)) return true;
  if (/^geo_replication\/config\/.+\.(?:json|tsv)$/.test(path)) return true;
  // Data bundles and immutable indexes have their own identities and archive.
  if (/^public\/(?!datasets\/|query\/)/.test(path)) return true;
  return /^(?:src|scripts|e2e|dataset-tracker|brand|geo_replication\/scripts)\/.+\.(?:ts|tsx|mts|mjs|js|jsx|css|json|svg|R|py|md|txt|html)$/.test(path);
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
}

export function releaseSourceFiles(root: string): string[] {
  return [...new Set(git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0').filter((path) => isReleaseSource(path) && existsSync(resolve(root, path))))].sort();
}

/** Length-delimited UTF-8 paths and canonical LF text make the hash portable. */
export function sourceFingerprint(root: string, files: string[]): string {
  const hash = createHash('sha256');
  for (const path of [...files].sort()) {
    const raw = readFileSync(resolve(root, path));
    const text = /\.(?:[cm]?[jt]sx?|jsonc?|css|html|svg|md|txt|cff|ya?ml|toml|tsv|csv|R|py)$/i.test(path)
      || /(?:^|\/)(?:LICENSE|VERSION|_headers|_redirects|\.[^/]+)$/.test(path);
    const bytes = text ? Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n')) : raw;
    hash.update(`${Buffer.byteLength(path)}:${path}:${bytes.length}:`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

export function readReleaseBuild(root: string): ReleaseIdentity {
  // A deposited source archive has no .git directory. Its source manifest is
  // verified against extracted bytes, never trusted as a shortcut around hashing.
  const archived = !existsSync(resolve(root, '.git')) && existsSync(resolve(root, 'release-source.json'))
    ? JSON.parse(readFileSync(resolve(root, 'release-source.json'), 'utf8')) : null;
  const files: string[] = archived ? archived.sourceFiles : releaseSourceFiles(root);
  assert(Array.isArray(files) && files.length > 0 && files.every((path) => typeof path === 'string'
    && !path.split('/').includes('..') && !path.includes('\\') && isReleaseSource(path)), 'Invalid archive source manifest');
  const sourceSha256 = sourceFingerprint(root, files);
  if (archived) assert.equal(sourceSha256, archived.release.sourceSha256, 'Archived source fingerprint does not match');
  const tracked = archived ? null : new Set(git(root, ['ls-files', '-z']).split('\0'));
  const changed = archived ? [] : git(root, ['diff', '--name-only', 'HEAD', '-z']).split('\0');
  const queryPath = resolve(root, 'public/query/tracks.js');
  const query = readQueryCatalogBuild(queryPath);
  const identity = {
    schemaVersion: 1 as const,
    appVersion: JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version as string,
    codeCommit: archived ? archived.release.codeCommit as string : git(root, ['rev-parse', 'HEAD']).trim(),
    sourceSha256,
    sourceDirty: archived ? archived.release.sourceDirty as boolean : changed.some(isReleaseSource) || files.some((path) => !tracked!.has(path)),
    dataBuildId: query.buildId,
    dataBuildSha256: sha256(readFileSync(queryPath)),
    expressionBuildId: readExpressionIndexBuild(resolve(root, 'public/query/expression-manifest.js')),
    // Analysis environment, not a claim that every study used every method.
    analysisVersions: 'R 4.6.0; edgeR 4.10.1; limma 3.68.4; fgsea 1.38.0',
    geneSetVersions: 'msigdbr 26.1.0; MSigDB 2026.1.Hs; study-specific collections in pathway provenance',
  };
  const release = { ...identity, releaseId: sha256(JSON.stringify(identity)) };
  if (archived) assert.equal(release.releaseId, archived.release.releaseId, 'Archived release or data identity does not match');
  return release;
}
