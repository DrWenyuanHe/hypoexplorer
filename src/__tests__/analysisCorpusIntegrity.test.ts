/**
 * Guards the committed analysis corpus against the three ways the prebuild
 * author-validation chain has been broken by the Git index rather than by
 * the analysis itself:
 *
 *   1. a registered dataset's geo_replication directory ignored or untracked;
 *   2. a hash-pinned analysis artifact whose checked-out bytes no longer match
 *      the SHA-256 its FGSEA provenance recorded (line-ending renormalization);
 *   3. a source manifest whose pinned bytes cannot be reproduced by a clean
 *      checkout because .gitattributes rewrites the file's line endings.
 *
 * Everything here reads the working tree the way a clean clone would see it,
 * so a failure means "do not commit this", not "the pipeline is wrong".
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATASETS } from '../data/datasets';
import { LOCAL_INPUT_DATASETS } from '../../scripts/lib/authorValidationAudit.mjs';

const ROOT = process.cwd();
const GEO = resolve(ROOT, 'geo_replication');
const EXCLUDED_DATASET = 'macaque_snrna';
const FGSEA_RESULT_KEYS: ReadonlyArray<[key: string, suffix: string]> = [
  ['de_sha256', '_DE.tsv'],
  ['hallmark_result_sha256', '_FGSEA_HALLMARK.tsv'],
  ['kegg_result_sha256', '_FGSEA_KEGG.tsv'],
  ['go_bp_result_sha256', '_FGSEA_GO_BP.tsv'],
  ['reactome_result_sha256', '_FGSEA_REACTOME.tsv'],
  ['focal_result_sha256', '_fgsea.tsv'],
];
const TEXT_LIKE = /\.(?:csv|tsv|txt|xml|json|ipynb|html|r)$/i;

const posix = (path: string) => relative(ROOT, path).replace(/\\/g, '/');
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const normalizedSha256 = (bytes: Buffer) => sha256(bytes.toString('utf8').replace(/\r\n/g, '\n'));

function git(args: string[], input?: string): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
}

/** Repo-relative POSIX paths Git tracks, so "committed" never means "happens to be on disk". */
const tracked = new Set(git(['ls-files', '-z']).split('\0').filter(Boolean));

function readTsv(path: string): Record<string, string>[] {
  const lines = readFileSync(path, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
  const head = lines[0].split('\t');
  return lines.slice(1).filter(Boolean).map((line) => {
    const cells = line.split('\t');
    return Object.fromEntries(head.map((key, index) => [key, cells[index] ?? '']));
  });
}

const datasetDirs = ['datasets', 'archive'].flatMap((root) => {
  const absolute = resolve(GEO, root);
  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '_author_de')
    .map((entry) => resolve(absolute, entry.name));
});

/** Same directory heuristic as scripts/audit_author_validation.mts. */
function datasetDirFor(dataset: (typeof DATASETS)[number]): string | null {
  const accession = (dataset.geo ?? '').toUpperCase();
  if (!accession) return null;
  const normalized = accession.replace(/-/g, '');
  let matches = datasetDirs.filter((path) => {
    const upper = path.toUpperCase();
    return upper.includes(accession) || upper.includes(normalized);
  });
  if (accession === 'GSE68177') {
    const token = dataset.id.includes('pomc_') ? 'POMC' : 'AGRP';
    matches = matches.filter((path) => path.toUpperCase().includes(token));
  }
  return matches[0] ?? null;
}

function findFileRecursive(root: string, target: string): string | null {
  const queue = [root];
  while (queue.length) {
    const current = queue.shift()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) queue.push(path);
      else if (entry.name === target) return path;
    }
  }
  return null;
}

function resolveManifestFile(datasetDir: string, value: string): string | null {
  if (!value) return null;
  const normalized = value.replace(/\\/g, '/');
  const rooted = resolve(ROOT, normalized);
  if (existsSync(rooted)) return rooted;
  const local = resolve(datasetDir, normalized);
  if (existsSync(local)) return local;
  return findFileRecursive(datasetDir, basename(normalized));
}

const registered = DATASETS.filter((dataset) => dataset.id !== EXCLUDED_DATASET);

describe('registered datasets are committed analysis directories', () => {
  it('every registered bulk dataset has a geo_replication directory with a tracked DE table', () => {
    const problems: string[] = [];
    for (const dataset of registered) {
      const dir = datasetDirFor(dataset);
      if (!dir) {
        problems.push(`${dataset.id}: no geo_replication directory for ${dataset.geo}`);
        continue;
      }
      const processed = resolve(dir, 'processed');
      const tables = existsSync(processed)
        ? readdirSync(processed).filter((name) => name.endsWith('_DE.tsv')).map((name) => posix(resolve(processed, name)))
        : [];
      if (!tables.length) problems.push(`${dataset.id}: ${posix(dir)}/processed has no *_DE.tsv`);
      for (const table of tables) {
        if (!tracked.has(table)) problems.push(`${dataset.id}: ${table} exists but is not tracked by Git`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('no registered dataset directory or DE table is gitignored', () => {
    const candidates = registered.flatMap((dataset) => {
      const dir = datasetDirFor(dataset);
      if (!dir) return [];
      const processed = resolve(dir, 'processed');
      const tables = existsSync(processed)
        ? readdirSync(processed).filter((name) => name.endsWith('_DE.tsv')).map((name) => posix(resolve(processed, name)))
        : [];
      // No trailing slash: Git for Windows 2.54 reports a phantom blank-line
      // match for some directory paths given with one.
      return [posix(dir), ...tables];
    });
    // check-ignore exits 1 when nothing is ignored, which is the outcome we want.
    let ignored = '';
    try {
      ignored = git(['check-ignore', '--stdin', '--no-index'], `${candidates.join('\n')}\n`);
    } catch (error) {
      const failure = error as { status?: number; stdout?: string };
      if (failure.status !== 1) throw error;
      ignored = failure.stdout ?? '';
    }
    expect(ignored.trim()).toBe('');
  });

  it('only registered local-input datasets keep an untracked source, and only the declared file is ignored', () => {
    for (const dataset of LOCAL_INPUT_DATASETS) {
      expect(registered.some((entry) => entry.id === dataset.datasetId)).toBe(true);
      expect(existsSync(resolve(ROOT, dataset.directory))).toBe(true);
      const required = dataset.requiredLocalFiles.map((file) => `${dataset.directory}/${file}`);
      const untracked = new Set(dataset.untrackedSourceFiles.map((entry) => `${dataset.directory}/${entry.file}`));
      let ignored: string[] = [];
      try {
        ignored = git(['check-ignore', '--stdin', '--no-index'], `${required.join('\n')}\n`).split(/\r?\n/).filter(Boolean);
      } catch (error) {
        const failure = error as { status?: number; stdout?: string };
        if (failure.status !== 1) throw error;
      }
      expect(new Set(ignored)).toEqual(untracked);
      for (const path of required) {
        if (untracked.has(path)) continue;
        if (existsSync(resolve(ROOT, path))) expect(tracked.has(path), `${path} is on disk but not tracked`).toBe(true);
      }
    }
  });

  // The snapshot is the sealed pre-migration baseline of the FGSEA migration audit
  // (fgsea-baselines/manifest.json). The R 4.6.0 regeneration replaced the processed
  // table, so each side is checked against its own record in the supersession manifest.
  it('the GSE281503 baseline snapshot and processed DE table are the recorded pre- and post-regeneration bytes', () => {
    const snapshot = resolve(ROOT, 'data/author-validation/fgsea-baselines/GSE281503/GSE281503_DE.tsv');
    const processed = resolve(ROOT, 'geo_replication/datasets/GSE281503_mmus_hypo_lps/processed/GSE281503_DE.tsv');
    expect(tracked.has(posix(processed))).toBe(true);
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'data/quality/regeneration-r460-2026-09-25/supersession.json'), 'utf8'));
    const record = manifest.records.find((row: { path: string }) => row.path === posix(processed));
    expect(record, 'GSE281503 DE is not in the supersession manifest').toBeDefined();
    expect(record.pinnedBy).toContain('data/author-validation/fgsea-baselines/manifest.json');
    expect(sha256(readFileSync(snapshot))).toBe(record.oldSha256);
    // The recorded bytes, or a checkout's CRLF rendering of recorded LF bytes (as isRecordedRegeneration).
    const current = readFileSync(processed);
    const lf = Buffer.from(current.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
    expect([sha256(current), sha256(lf)]).toContain(record.newSha256);
  });
});

describe('hash-pinned FGSEA artifacts match the bytes Git checks out', () => {
  const provenanceFiles = [...tracked].filter((path) => /^geo_replication\/.*_FGSEA_provenance\.tsv$/.test(path));
  const pinnedFiles: string[] = [];
  const mismatches: string[] = [];
  for (const provenancePath of provenanceFiles) {
    const absolute = resolve(ROOT, provenancePath);
    const directory = resolve(absolute, '..');
    const prefix = basename(provenancePath).replace(/_FGSEA_provenance\.tsv$/, '');
    const provenance = Object.fromEntries(readTsv(absolute).map((row) => [row.key, row.value]));
    for (const [key, suffix] of FGSEA_RESULT_KEYS) {
      const target = resolve(directory, `${prefix}${suffix}`);
      const relativeTarget = posix(target);
      pinnedFiles.push(relativeTarget);
      if (!existsSync(target)) {
        mismatches.push(`${relativeTarget}: missing (pinned by ${provenancePath})`);
        continue;
      }
      const bytes = readFileSync(target);
      if (sha256(bytes) === provenance[key]) continue;
      const text = bytes.toString('utf8');
      const lf = text.replace(/\r\n/g, '\n');
      const variant = sha256(lf.replace(/\n/g, '\r\n')) === provenance[key]
        ? 'the CRLF form of this file matches; restore CRLF bytes, do not edit the provenance'
        : sha256(lf) === provenance[key]
          ? 'the LF form of this file matches; restore LF bytes, do not edit the provenance'
          : 'content differs, not just line endings';
      mismatches.push(`${relativeTarget}: SHA-256 differs from ${key} in ${provenancePath} (${variant})`);
    }
  }

  it('covers every dataset that has FGSEA results', () => {
    expect(provenanceFiles.length).toBeGreaterThan(100);
  });

  it('every DE input, collection result, and focal table hashes to its provenance pin', () => {
    expect(mismatches).toEqual([]);
  });

  it('every pinned artifact is tracked and marked -text so Git cannot rewrite its bytes', () => {
    const untracked = pinnedFiles.filter((path) => !tracked.has(path));
    expect(untracked).toEqual([]);
    const attributes = git(['check-attr', '--stdin', 'text'], `${pinnedFiles.join('\n')}\n`)
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.split(': text: '));
    expect(attributes).toHaveLength(pinnedFiles.length);
    const converting = attributes.filter(([, value]) => value !== 'unset').map(([path, value]) => `${path}: text=${value}`);
    expect(converting).toEqual([]);
  });
});

describe('source manifests can be verified on any checkout', () => {
  const manifests = [...tracked].filter((path) => /^geo_replication\/(?:datasets|archive)\/[^/]+\/metadata\/[^/]+_source_files\.tsv$/.test(path));

  it('finds the committed manifests', () => {
    expect(manifests.length).toBeGreaterThan(50);
  });

  it('every present manifest file matches its pinned SHA-256 outright or through a declared normalized_sha256', () => {
    const problems: string[] = [];
    for (const manifest of manifests) {
      const datasetDir = resolve(ROOT, manifest, '..', '..');
      for (const row of readTsv(resolve(ROOT, manifest))) {
        const fileValue = row.local_path || row.file || '';
        const path = resolveManifestFile(datasetDir, fileValue);
        const expectedSha = (row.sha256 || '').toLowerCase();
        const expectedBytes = row.bytes !== '' && Number.isFinite(Number(row.bytes)) ? Number(row.bytes) : null;
        if (!path || !existsSync(path) || (!expectedSha && expectedBytes == null)) continue;
        const bytes = readFileSync(path);
        const observedSha = sha256(bytes);
        if ((expectedSha === '' || expectedSha === observedSha) && (expectedBytes == null || expectedBytes === statSync(path).size)) continue;
        const declaredNormalized = (row.normalized_sha256 || '').toLowerCase() || expectedSha;
        if (TEXT_LIKE.test(path) && declaredNormalized && normalizedSha256(bytes) === declaredNormalized) continue;
        const hint = TEXT_LIKE.test(path)
          ? `line endings differ from the deposited bytes; add normalized_sha256=${normalizedSha256(bytes)} to the manifest row`
          : 'binary content differs from the pinned bytes';
        problems.push(`${manifest}: ${fileValue} -> ${posix(path)} (${hint})`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('the committed mechanical audit records no source mismatch or bundle failure', () => {
    const report = JSON.parse(readFileSync(resolve(ROOT, 'data/author-validation/mechanical-audit.generated.json'), 'utf8')) as {
      datasetCount: number;
      summary: { sourceManifestMismatch: number; bundleFail: number };
      datasets: Array<{ datasetId: string; sourceIntegrity: string; sourceFiles: Array<{ file: string; result: string }> }>;
    };
    expect(report.datasetCount).toBe(registered.length);
    expect(report.summary.sourceManifestMismatch).toBe(0);
    expect(report.summary.bundleFail).toBe(0);
    expect(report.datasets.flatMap((dataset) => dataset.sourceFiles.filter((file) => file.result === 'mismatch').map((file) => `${dataset.datasetId}: ${file.file}`)))
      .toEqual([]);
  });
});
