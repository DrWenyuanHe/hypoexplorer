import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isReleaseSource, readReleaseBuild, sourceFingerprint } from '../../scripts/lib/releaseBuild.mjs';
import { expressionIndexGlobal } from '../expression-survey/expressionIndexFormat';
import type { ReleaseIdentity } from '../data/releaseIdentity';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('release source identity', () => {
  it('excludes secrets, scratch worktrees and third-party/raw downloads', () => {
    for (const path of ['.env', '.env.local', '.env.cfdeploy', '.claude/worktrees/x/src/App.tsx',
      'scripts/.env.json', 'node_modules/x/index.js', 'data/raw/source.csv', '.tmp/artifact.json']) {
      expect(isReleaseSource(path), path).toBe(false);
    }
    expect(isReleaseSource('src/App.tsx')).toBe(true);
    expect(isReleaseSource('scripts/lib/releaseBuild.mts')).toBe(true);
    expect(isReleaseSource('.github/workflows/app-checks.yml')).toBe(true);
    expect(isReleaseSource('data/author-validation/validation-records.generated.json')).toBe(true);
    expect(isReleaseSource('data/seo/studyEditorial.json')).toBe(true);
    expect(isReleaseSource('geo_replication/config/upstream_processing.tsv')).toBe(true);
    expect(isReleaseSource('nar-research/dataset-survey/scout_master_combined.json')).toBe(true);
    expect(isReleaseSource('public/fonts/source/font.woff2')).toBe(true);
    expect(isReleaseSource('public/datasets/macaque_snrna/track_e9.js')).toBe(false);
  });

  it('ignores checkout EOL but changes when source contents or paths change', () => {
    const root = mkdtempSync(join(tmpdir(), 'hypo-release-'));
    roots.push(root);
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/a.ts'), 'one\r\ntwo\r\n');
    const before = sourceFingerprint(root, ['src/a.ts']);
    writeFileSync(join(root, 'src/a.ts'), 'one\ntwo\n');
    expect(sourceFingerprint(root, ['src/a.ts'])).toBe(before);
    writeFileSync(join(root, 'src/b.ts'), 'one\ntwo\n');
    expect(sourceFingerprint(root, ['src/b.ts'])).not.toBe(before);
    writeFileSync(join(root, 'src/a.ts'), 'one\nthree\n');
    expect(sourceFingerprint(root, ['src/a.ts'])).not.toBe(before);
  });

  it('hashes binary assets without lossy UTF-8 replacement', () => {
    const root = mkdtempSync(join(tmpdir(), 'hypo-release-'));
    roots.push(root);
    mkdirSync(join(root, 'public'));
    writeFileSync(join(root, 'public/logo.png'), Buffer.from([0x89, 0xff, 0x0d, 0x0a]));
    const before = sourceFingerprint(root, ['public/logo.png']);
    writeFileSync(join(root, 'public/logo.png'), Buffer.from([0x89, 0xfe, 0x0d, 0x0a]));
    expect(sourceFingerprint(root, ['public/logo.png'])).not.toBe(before);
  });
});

const digest = (text: string): string => createHash('sha256').update(text).digest('hex');

/** A deposited package fixture, deliberately created without Git metadata. */
function extractedArchive() {
  const root = mkdtempSync(join(tmpdir(), 'hypo-release-'));
  roots.push(root);
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'public/query'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"version":"0.15.0","type":"module"}\n');
  writeFileSync(join(root, 'src/App.tsx'), 'export const title = "HypoExplorer";\r\n');
  const sourceFiles = ['package.json', 'src/App.tsx'];
  const query = {
    buildId: 'a'.repeat(64),
    tracks: [{ ds: 'test-study', trackId: 'whole', label: 'Whole tissue' }],
    datasets: [{ ds: 'test-study', defaultTrack: 'whole', trackLabel: 'Whole tissue' }],
  };
  const queryText = (value: typeof query) => `var HX_QUERY_TRACKS = ${JSON.stringify(value)};\n`;
  const writeQuery = (value = query) => writeFileSync(join(root, 'public/query/tracks.js'), queryText(value));
  const writeExpression = (buildId: string) => {
    const manifest = { schemaVersion: 1, buildId, shardCount: 512, sources: [{ id: 'test-source' }] };
    mkdirSync(join(root, 'public/query/expression', buildId), { recursive: true });
    writeFileSync(join(root, 'public/query/expression-manifest.js'), `var HX_EXPRESSION_MANIFEST = ${JSON.stringify(manifest)};\n`);
    writeFileSync(join(root, 'public/query/expression', buildId, 'manifest.js'),
      `var ${expressionIndexGlobal(buildId, 'manifest')} = ${JSON.stringify(manifest)};\n`);
  };
  writeQuery();
  writeExpression('b'.repeat(64));
  const identity: Omit<ReleaseIdentity, 'releaseId'> = {
    schemaVersion: 1, appVersion: '0.15.0', codeCommit: 'c'.repeat(40),
    sourceSha256: sourceFingerprint(root, sourceFiles), sourceDirty: false,
    dataBuildId: query.buildId, dataBuildSha256: digest(queryText(query)),
    expressionBuildId: 'b'.repeat(64),
    analysisVersions: 'R 4.6.0; edgeR 4.10.1; limma 3.68.4; fgsea 1.38.0',
    geneSetVersions: 'msigdbr 26.1.0; MSigDB 2026.1.Hs; study-specific collections in pathway provenance',
  };
  const release = { ...identity, releaseId: digest(JSON.stringify(identity)) };
  writeFileSync(join(root, 'release-source.json'), JSON.stringify({ release, sourceFiles }));
  return { root, release, query, writeQuery, writeExpression };
}

describe('extracted publication archive identity', () => {
  it('reconstructs the deposited identity without Git and tolerates checkout line endings', () => {
    const archive = extractedArchive();
    expect(existsSync(join(archive.root, '.git'))).toBe(false);
    expect(readReleaseBuild(archive.root)).toEqual(archive.release);
    writeFileSync(join(archive.root, 'src/App.tsx'), 'export const title = "HypoExplorer";\n');
    expect(readReleaseBuild(archive.root)).toEqual(archive.release);
  });

  it('rejects a changed source file rather than trusting the deposited manifest', () => {
    const archive = extractedArchive();
    writeFileSync(join(archive.root, 'src/App.tsx'), 'export const title = "Changed scientific view";\n');
    expect(() => readReleaseBuild(archive.root)).toThrow('Archived source fingerprint does not match');
  });

  it('rejects query-pointer content changes even when the query build ID is unchanged', () => {
    const archive = extractedArchive();
    archive.writeQuery({ ...archive.query, tracks: [{ ...archive.query.tracks[0], label: 'A different population' }] });
    expect(() => readReleaseBuild(archive.root)).toThrow('Archived release or data identity does not match');
  });

  it('rejects a changed expression generation even when its pointer and immutable manifest agree', () => {
    const archive = extractedArchive();
    archive.writeExpression('d'.repeat(64));
    expect(() => readReleaseBuild(archive.root)).toThrow('Archived release or data identity does not match');
  });
});
