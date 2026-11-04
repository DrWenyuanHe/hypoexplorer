/**
 * Declare the successor evidence of ledgers rebuilt after the R 4.6.0 regeneration.
 *
 * A ledger the regeneration rewrote is served to sealed checks as its archived
 * pre-regeneration bytes only when the rewrite touched nothing but regenerated
 * datasets (checkLedgerTransition). A ledger rebuilt from successor evidence (new
 * producers writing new evidence files; the sealed producers and their evidence
 * stay byte-identical) also changes its path -> fingerprint inventory. This tool
 * records exactly how: the retired entries (each must be byte-identical to the
 * pre-swap commit or a regenerated output the supersession manifest names), the added entries (each must exist) and the new fingerprint of
 * every other changed entry that the supersession manifest does not name.
 * Already sealed retirement identities may remain unavailable, explicitly
 * qualified without claiming that their bytes were reverified. New retirements
 * still require the original evidence. The
 * readers pin the declaration's SHA-256.
 *
 *   npx tsx scripts/regen-r460/build_successor_inventory.mts --finalize [--ledger=<path> ...]
 *   npx tsx scripts/regen-r460/build_successor_inventory.mts --check
 *
 * Rerun --finalize after rebuilding a declared ledger; review the printed changes.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { SUCCESSOR_INVENTORY, SUCCESSOR_INVENTORY_SHA256, SUPERSESSION_SHA256, checkLedgerTransition, readAdditiveIntake, supersession } from '../lib/historicalEvidence.mjs';
import {QC_INPUT_BASELINE_SHA256, fingerprintQcIdentity, readQcInputBaseline, retainedAdditionAvailability, retainedRetirementAvailability} from '../lib/qcInputAvailability.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PY = 'scripts/historical_evidence.py';
const TS = 'scripts/lib/historicalEvidence.mts';
const DEFAULT_LEDGERS = ['data/internal-qc/assessments.generated.json', 'data/intake/hfd-2026-09-12/audit.generated.json'];
const args = process.argv.slice(2);
const finalize = args.includes('--finalize');
const check = args.includes('--check');
assert.ok(finalize !== check, 'Pass exactly one of --finalize or --check');
const hash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const state = supersession(ROOT);
const preservedUnavailableRetirements: Array<Record<string, unknown>> = [];
const preservedUnavailableAdditions: Array<Record<string, unknown>> = [];
const qcInputBaseline = readQcInputBaseline(ROOT);
const isMap = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length > 0 && Object.keys(value).every((name) => name.includes('/'));

function declare(path: string) {
  const row = state.ledgers.get(path);
  assert.ok(row, `Not an archived ledger: ${path}`);
  const original = gunzipSync(readFileSync(resolve(ROOT, row.archivePath)));
  assert.equal(hash(original), row.sha256, `Archived ledger identity changed: ${path}`);
  assert.equal(original.length, row.bytes, `Archived ledger byte count changed: ${path}`);
  const before = JSON.parse(original.toString('utf8'));
  const after = JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));
  const keys: Record<string, { retired: string[]; added: string[]; updated: Record<string, string> }> = {};
  for (const key of Object.keys(before)) {
    const old = before[key], now = after[key];
    if (!isMap(old) || !isMap(now)) continue;
    const retired = Object.keys(old).filter((name) => !(name in now)).sort();
    const added = Object.keys(now).filter((name) => !(name in old)).sort();
    const updated = Object.fromEntries(Object.keys(old).filter((name) => name in now && old[name] !== now[name] && !state.paths.has(name)).sort()
      .map((name) => [name, now[name] as string]));
    if (!retired.length && !added.length && !Object.keys(updated).length) continue;
    const previousAdded = new Set(state.successors[path]?.[key]?.added ?? []);
    for (const name of added) {
      const unavailable = retainedAdditionAvailability(name, now[name] as string, previousAdded, qcInputBaseline, existsSync(resolve(ROOT, name)));
      if (!unavailable) continue;
      const previous = existing?.preservedUnavailableAdditions?.find((row: any) => row.ledger === path && row.inventoryKey === key && row.path === name);
      if (previous) assert.equal(previous.sha256, now[name], `Unavailable successor identity changed: ${name}`);
      preservedUnavailableAdditions.push(previous ?? {ledger: path, inventoryKey: key, ...unavailable, baselineSha256: QC_INPUT_BASELINE_SHA256,
        priorDeclarationSha256: SUCCESSOR_INVENTORY_SHA256});
    }
    // Retired evidence is preserved: byte-identical to the pre-regeneration commit, unless it
    // is an output the supersession manifest records as regenerated.
    const preserved = retired.filter((name) => !state.paths.has(name));
    for (let i = 0; i < preserved.length; i += 200) {
      const batch = preserved.slice(i, i + 200);
      const diff = spawnSync('git', ['-C', ROOT, 'diff', '--name-only', state.commit, '--', ...batch], { encoding: 'utf8' });
      assert.equal(diff.status, 0, diff.stderr);
      assert.equal(diff.stdout.trim(), '', `${path}/${key}: retired entries changed since ${state.commit}: ${diff.stdout.trim().split('\n').slice(0, 5).join(', ')}`);
      const previousRetired = new Set(state.successors[path]?.[key]?.retired ?? []);
      for (const name of batch) {
        const available = existsSync(resolve(ROOT, name));
        const bytes = available ? readFileSync(resolve(ROOT, name)) : null;
        const actual = bytes ? (hash(bytes) === old[name] ? hash(bytes) : fingerprintQcIdentity(name, bytes)) : undefined;
        const unavailable = retainedRetirementAvailability(name, old[name] as string, previousRetired, available, actual);
        if (unavailable) {
          const previous = existing?.preservedUnavailableRetirements?.find((row: any) => row.ledger === path && row.inventoryKey === key && row.path === name);
          if (previous) assert.equal(previous.sha256, old[name], `Previously retired identity changed: ${name}`);
          preservedUnavailableRetirements.push(previous ?? {ledger: path, inventoryKey: key, ...unavailable, priorDeclarationSha256: SUCCESSOR_INVENTORY_SHA256});
        }
      }
    }
    keys[key] = { retired, added, updated };
    process.stdout.write(`${path}/${key}: ${retired.length} retired, ${added.length} added, ${Object.keys(updated).length} updated outside the manifest: ${Object.keys(updated).join(', ')}\n`);
  }
  checkLedgerTransition(path, before, after, state.datasetIds, state.paths, keys, readAdditiveIntake(ROOT).datasetIds);
  return keys;
}

const existingBytes = existsSync(resolve(ROOT, SUCCESSOR_INVENTORY)) ? readFileSync(resolve(ROOT, SUCCESSOR_INVENTORY)) : null;
if (existingBytes && SUCCESSOR_INVENTORY_SHA256) assert.equal(hash(existingBytes), SUCCESSOR_INVENTORY_SHA256, 'Existing successor declaration is not the pinned artifact');
const existing = existingBytes ? JSON.parse(existingBytes.toString('utf8')) : null;
const ledgers = args.filter((arg) => arg.startsWith('--ledger=')).map((arg) => arg.slice('--ledger='.length));
const scope = ledgers.length ? ledgers : existing ? Object.keys(existing.ledgers) : DEFAULT_LEDGERS;
const document = {
  schemaVersion: 1,
  record: 'Ledgers rebuilt from successor evidence after the R 4.6.0 regeneration. For each path -> fingerprint inventory: the retired entries (preserved against the pre-swap identity, or regenerated outputs supersession.json names), the added successor entries, and the new fingerprint of every other changed entry that supersession.json does not name. Already sealed unavailable retirements are qualified separately; their bytes are not newly verified. New missing retirements are rejected. Read by scripts/historical_evidence.py and scripts/lib/historicalEvidence.mts; written by scripts/regen-r460/build_successor_inventory.mts.',
  supersessionSha256: SUPERSESSION_SHA256,
  preSwapCommit: state.commit,
  ledgers: Object.fromEntries(scope.sort().map((path) => [path, declare(path)])),
  preservedUnavailableRetirements: preservedUnavailableRetirements.sort((a, b) => `${a.ledger}/${a.inventoryKey}/${a.path}`.localeCompare(`${b.ledger}/${b.inventoryKey}/${b.path}`)),
  preservedUnavailableAdditions: preservedUnavailableAdditions.sort((a, b) => `${a.ledger}/${a.inventoryKey}/${a.path}`.localeCompare(`${b.ledger}/${b.inventoryKey}/${b.path}`)),
};
const body = `${JSON.stringify(document, null, 2)}\n`;
const sha = hash(body);
if (check) {
  assert.equal(readFileSync(resolve(ROOT, SUCCESSOR_INVENTORY), 'utf8'), body, 'Successor inventory declaration is stale; rerun --finalize after reviewing the changes.');
  assert.equal(SUCCESSOR_INVENTORY_SHA256, sha, `${TS} does not pin the declaration`);
  assert.ok(readFileSync(resolve(ROOT, PY), 'utf8').includes(`SUCCESSOR_INVENTORY_SHA = '${sha}'`), `${PY} does not pin the declaration`);
  process.stdout.write(`Successor inventory declaration is current: ${sha}\n`);
} else {
  writeFileSync(resolve(ROOT, SUCCESSOR_INVENTORY), body);
  const pin = (file: string, pattern: RegExp, replacement: string) => {
    const text = readFileSync(resolve(ROOT, file), 'utf8');
    assert.equal(text.match(pattern)?.length, 1, `${file}: pin constant not found`);
    writeFileSync(resolve(ROOT, file), text.replace(pattern, replacement));
  };
  pin(PY, /^SUCCESSOR_INVENTORY_SHA = .*$/m, `SUCCESSOR_INVENTORY_SHA = '${sha}'`);
  pin(PY, /^SUCCESSOR_INVENTORY_MANIFEST_SHA = .*$/m, `SUCCESSOR_INVENTORY_MANIFEST_SHA = '${SUPERSESSION_SHA256}'`);
  pin(TS, /^export const SUCCESSOR_INVENTORY_SHA256: string \| null = .*;$/m, `export const SUCCESSOR_INVENTORY_SHA256: string | null = '${sha}';`);
  pin(TS, /^export const SUCCESSOR_INVENTORY_MANIFEST_SHA256: string \| null = .*;$/m, `export const SUCCESSOR_INVENTORY_MANIFEST_SHA256: string | null = '${SUPERSESSION_SHA256}';`);
  process.stdout.write(`Wrote ${SUCCESSOR_INVENTORY} (${sha}) and pinned it in ${PY} and ${TS}.\n`);
}
