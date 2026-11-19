// One staged pipeline for intake studies registered through a generated
// registry sidecar. A hook turns each manifest study into its registry
// definition and the payload of every track; this module writes each study
// through the bundle-writer seam into a private staging root, then either
// compares the staged bytes with public/ (check) or publishes them. A study
// that fails late cannot leave partially rewritten public bundles behind.
//
// The September 5 intake builds through it. The HFD and OXT/AVP intake
// builders keep their own loops for now: their source bytes are fingerprinted
// by their intake audits, so moving them here is a reviewed evidence change.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { defineDataset, type DatasetDefinition } from '../../src/data/datasets';
import { writeDatasetBundles, type TrackBundlePayload } from './bundleWriter.mjs';
import { assertUniqueKeys } from './regenTables.mjs';

export interface IntakeStudyBuild {
  /** The registry entry, exactly as the sidecar stores it. */
  definition: DatasetDefinition;
  /** Every track of the study, in display order, including the default track. */
  tracks: TrackBundlePayload[];
  /** Progress lines for the build log. */
  log?: string[];
}

export interface IntakeHooks<Study> {
  /** Names the staging directory and the messages. */
  name: string;
  /** Repository-relative path of the generated registry sidecar. */
  registryPath: string;
  /** The manifest's studies, in registry order. */
  studies: readonly Study[];
  /** The registry id the study builds. */
  id(study: Study): string;
  /** The key `--only=` selects by (an accession). */
  key(study: Study): string;
  build(study: Study): IntakeStudyBuild;
}

export interface IntakeRunOptions {
  /** Repository root: the staging parent `.tmp/` and the registry resolve here. */
  root: string;
  /** Root standing in for public/. Defaults to `<root>/public`. */
  publicRoot?: string;
  /** Compare instead of publishing; any difference throws. */
  check?: boolean;
  /** Build only these study keys; the registry keeps every other entry. */
  only?: readonly string[];
  log?: (line: string) => void;
}

export interface IntakeRunResult {
  studies: string[];
  /** Public paths compared or written, relative to the public root. */
  files: string[];
  registryChanged: boolean;
}

/** Resolve a manifest path inside `root`, refusing absolute, backslash, dot or escaping paths. */
export function intakePath(root: string, path: string): string {
  assert.ok(path && !isAbsolute(path) && !path.includes('\\')
    && !path.split('/').some((part) => part === '..' || part === '.' || part === ''), `Unsafe intake path: ${path}`);
  const target = resolve(root, path);
  const rel = relative(root, target);
  assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), `Intake path escaped the repository: ${path}`);
  return target;
}

/** A tab-separated intake table (optionally gzipped) as header-keyed rows; the header must be unique. */
export function readIntakeTable(root: string, path: string): Record<string, string>[] {
  const raw = readFileSync(intakePath(root, path));
  const lines = (path.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8').trim().split(/\r?\n/);
  const head = lines.shift()!.split('\t');
  assertUniqueKeys(head, `${path} header`);
  return lines.map((line) => Object.fromEntries(line.split('\t').map((value, index) => [head[index], value])));
}

/** Parse `--check` and `--only=A,B`; anything else is an error. */
export function intakeArgs(argv: readonly string[] = process.argv.slice(2)): { check: boolean; only?: string[] } {
  let check = false;
  let only: string[] | undefined;
  for (const arg of argv) {
    if (arg === '--check') check = true;
    else if (arg.startsWith('--only=') && arg.length > 7) only = arg.slice(7).split(',');
    else throw new Error(`Unsupported argument: ${arg} (expected --check or --only=<keys>)`);
  }
  return { check, only };
}

const normalizeEol = (text: string): string => text.replace(/\r\n/g, '\n');

export function buildIntakeStudies<Study>(hooks: IntakeHooks<Study>, opts: IntakeRunOptions): IntakeRunResult {
  const root = resolve(opts.root);
  const publicRoot = resolve(opts.publicRoot ?? resolve(root, 'public'));
  const log = opts.log ?? ((line: string) => console.log(line));
  const check = opts.check ?? false;
  const keys = hooks.studies.map((study) => hooks.key(study));
  const ids = hooks.studies.map((study) => hooks.id(study));
  assertUniqueKeys(keys, `${hooks.name} study keys`);
  assertUniqueKeys(ids, `${hooks.name} study ids`);
  const unknown = (opts.only ?? []).filter((key) => !keys.includes(key));
  assert.equal(unknown.length, 0, `${hooks.name}: --only names unknown studies (${unknown.join(', ')})`);
  const selected = hooks.studies.filter((study) => !opts.only || opts.only.includes(hooks.key(study)));

  const temporaryBase = resolve(root, '.tmp');
  mkdirSync(temporaryBase, { recursive: true });
  const prefix = hooks.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const temporary = mkdtempSync(resolve(temporaryBase, `${prefix}-`));
  try {
    const written: DatasetDefinition[] = [];
    const staged: string[] = [];
    for (const study of selected) {
      const build = hooks.build(study);
      assert.equal(build.definition.id, hooks.id(study), `${hooks.key(study)}: definition id differs from the manifest id`);
      const result = writeDatasetBundles(defineDataset(build.definition), build.tracks, { outRoot: temporary });
      staged.push(...result.files);
      written.push(build.definition);
      for (const line of build.log ?? []) log(line);
    }

    // The registry: a partial build keeps every other entry, ordered by the manifest.
    const registryFile = resolve(root, hooks.registryPath);
    const previous: DatasetDefinition[] = existsSync(registryFile) ? JSON.parse(readFileSync(registryFile, 'utf8')) : [];
    const replaced = new Set(written.map((definition) => definition.id));
    const merged = new Map([...previous.filter((definition) => !replaced.has(definition.id)), ...written]
      .map((definition) => [definition.id, definition]));
    const ordered = ids.filter((id) => merged.has(id)).map((id) => merged.get(id)!);
    assert.equal(ordered.length, merged.size, `${hooks.name}: registry contains an unknown study`);
    // Compare values, not bytes: a sidecar may be pinned by exact bytes, and
    // JSON.stringify would re-spell its escaped characters without changing a value.
    const registryChanged = JSON.stringify(previous) !== JSON.stringify(ordered);

    const files = staged.map((file) => {
      const rel = relative(temporary, file);
      assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), `Staged bundle escaped its staging root: ${file}`);
      return rel;
    });
    if (check) {
      const stale = files.filter((rel) => {
        const target = resolve(publicRoot, rel);
        return !existsSync(target)
          || normalizeEol(readFileSync(target, 'utf8')) !== readFileSync(resolve(temporary, rel), 'utf8');
      });
      assert.equal(stale.length, 0, `${hooks.name}: missing or stale bundles:\n  ${stale.join('\n  ')}`);
      assert.ok(!registryChanged, `${hooks.name}: ${hooks.registryPath} is stale`);
    } else {
      for (const rel of files) {
        const target = resolve(publicRoot, rel);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, readFileSync(resolve(temporary, rel)));
      }
      if (registryChanged) writeFileSync(registryFile, `${JSON.stringify(ordered, null, 2)}\n`);
    }
    log(`${hooks.name}: ${selected.length} studies, ${files.length} bundle files ${check ? 'current' : 'written'}`);
    return { studies: written.map((definition) => definition.id), files, registryChanged };
  } finally {
    const contained = relative(temporaryBase, temporary);
    assert.ok(contained && !contained.startsWith('..') && !isAbsolute(contained), 'Temporary cleanup escaped its workspace directory');
    rmSync(temporary, { recursive: true, force: true });
  }
}
