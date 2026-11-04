/**
 * Re-evaluate unchanged sealed auditors, admitting only a verified roster fingerprint refresh.
 *
 *   npx tsx data/intake/oxt-avp-2026-10-19/reader-refresh/review_reader_refresh.mts <report-key>
 *   npx tsx data/intake/oxt-avp-2026-10-19/reader-refresh/review_reader_refresh.mts --summary
 *
 * The OXT/AVP intake added the GSE65663 row to geo_replication/config/datasets.tsv. Six sealed
 * auditors record the current whole-configuration fingerprint, so their derived reports no longer
 * reproduce. This follows data/quality/hfd-intake-2026-09-12/review_reader_refresh.mts, with one
 * difference: each auditor runs under the R 4.6.0 supersession projection of
 * scripts/run_sealed_ts_check.mts, exactly as its --check does. A candidate is accepted only when every
 * value other than the datasets.tsv reference is unchanged; the scoped validation may additionally
 * list the configuration rows the intake added, which it has already rejected as historical scope.
 * One auditor runs per process because each executes on import.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PRODUCERS, projectSealedChildren, projectSuperseded, projectSupersededModules} from '../../../../scripts/run_sealed_ts_check.mts';

const root = resolve(import.meta.dirname, '../../../..');
const destination = resolve(root, 'data/intake/oxt-avp-2026-10-19/reader-refresh');
const config = 'geo_replication/config/datasets.tsv';
const oldConfig = {path: config, sha256: '2b89ca7d8231622817b5fec41d32d76ec746088f56029319b1d20d54973ebaeb', bytes: 53320};
const addedRows = ['GSE65663'];
const sa = 'data/internal-qc/source-authenticity-2026-09-05';
const REPORTS: Record<string, {auditor: string; report: string}> = {
  scoped: {auditor: `${sa}/audit_scoped_sources.mts`, report: `${sa}/scoped-source-validation.json`},
  round2: {auditor: `${sa}/round2/audit_round2.mts`, report: `${sa}/round2/reader-evaluations.json`},
  round4: {auditor: `${sa}/round4/audit_relationships.mts`, report: `${sa}/round4/reader-evaluations.json`},
  round5: {auditor: `${sa}/round5/audit_relationships.mts`, report: `${sa}/round5/reader-evaluations.json`},
  'round5-keyed': {auditor: `${sa}/round5-keyed/audit_relationship.mts`, report: `${sa}/round5-keyed/reader-evaluations.json`},
  'source-recovery': {auditor: 'data/internal-qc/source-recovery-2026-09-11/audit_recovery.mts', report: 'data/internal-qc/source-recovery-2026-09-11/reader-evaluations.json'},
};
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const write = (name: string, bytes: Buffer | string) => fs.writeFileSync(resolve(destination, name), bytes);

if (process.argv[2] === '--summary') {
  const outcomes = Object.keys(REPORTS).map((key) => {
    const review = JSON.parse(fs.readFileSync(resolve(destination, `${key}.review.json`), 'utf8'));
    assert.equal(hash(fs.readFileSync(resolve(root, review.report))), review.candidateSha256, `Report differs from its reviewed candidate: ${key}`);
    return {key, report: review.report, configReferencesChanged: review.configReferencesChanged, addedRowsListed: review.addedRowsListed,
      statuses: review.statuses, beforeSha256: review.beforeSha256, afterSha256: review.candidateSha256};
  });
  const summary = {scope: 'Only current whole-configuration references in derived sealed-auditor reports', oldConfig,
    currentConfig: JSON.parse(fs.readFileSync(resolve(destination, 'scoped.review.json'), 'utf8')).currentConfig,
    allScientificAndOtherFieldsUnchanged: true, outcomes};
  write('summary.json', JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const key = process.argv[2];
const target = REPORTS[key];
assert.ok(target, `Unknown report key: ${key}`);
assert.equal(hash(fs.readFileSync(resolve(root, target.auditor))), PRODUCERS[target.auditor], 'Sealed auditor changed');
const beforeBytes = fs.readFileSync(resolve(root, target.report));
const before = JSON.parse(beforeBytes.toString('utf8'));

const actualWrite = fs.writeFileSync;
let candidateBytes: Buffer | undefined;
fs.writeFileSync = ((path: any, data: any) => {
  assert.equal(resolve(root, String(path)).toLowerCase(), resolve(root, target.report).toLowerCase(), `Auditor attempted an unexpected write: ${path}`);
  assert.equal(candidateBytes, undefined, 'Auditor attempted multiple report writes');
  candidateBytes = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(String(data), 'utf8');
}) as typeof fs.writeFileSync;
syncBuiltinESMExports();
projectSupersededModules(root);
const restore = projectSuperseded(root);
const restoreChildren = projectSealedChildren(root);
process.chdir(root);
process.argv = [process.execPath, resolve(root, target.auditor), '--write'];
await import(pathToFileURL(resolve(root, target.auditor)).href);
restore(); restoreChildren();
fs.writeFileSync = actualWrite;
syncBuiltinESMExports();

assert.ok(candidateBytes, 'Auditor did not generate a complete candidate');
assert.deepEqual(fs.readFileSync(resolve(root, target.report)), beforeBytes, 'Report changed before review');
const candidate = JSON.parse(candidateBytes.toString('utf8'));
let currentConfig: {path: string; sha256: string; bytes: number} | undefined;
const differences: {path: string; before: unknown; after: unknown}[] = [];
let addedRowsListed: string[] = [];
const sameCurrent = (value: {path: string; sha256: string; bytes: number}, at: string) => {
  currentConfig ??= value;
  assert.deepEqual(value, currentConfig, `Inconsistent current config reference: ${at}`);
  assert.notDeepEqual(value, oldConfig, `Config reference did not move: ${at}`);
};
const compare = (a: any, b: any, at: string): void => {
  if (a && typeof a === 'object' && !Array.isArray(a)) {
    assert.ok(b && typeof b === 'object' && !Array.isArray(b), at);
    assert.deepEqual(Object.keys(b), Object.keys(a), `Schema changed: ${at}`);
    // A historical configuration pin (the scoped validation's historicalConfig) must stay as sealed.
    if (a.path === config && JSON.stringify(a) === JSON.stringify(b)) return;
    if (a.path === config) {
      assert.deepEqual(a, oldConfig, `Unexpected historical config: ${at}`);
      sameCurrent(b, at);
      differences.push({path: at, before: a, after: b});
      return;
    }
    for (const field of Object.keys(a)) {
      if (field === config && typeof a[field] === 'string') {
        // The scoped validation's input map: path -> sha256.
        assert.equal(a[field], oldConfig.sha256, `Unexpected historical config: ${at}/${field}`);
        assert.ok(/^[a-f0-9]{64}$/.test(b[field]) && b[field] !== a[field], `Config input did not move: ${at}/${field}`);
        differences.push({path: `${at}/${field}`, before: a[field], after: b[field]});
      } else compare(a[field], b[field], `${at}/${field}`);
    }
  } else if (Array.isArray(a)) {
    assert.ok(Array.isArray(b), at);
    if (key === 'scoped' && at === '/newConfigRowsWithoutHistoricalScope') {
      assert.deepEqual(b.slice(0, a.length), a, `Earlier rows changed: ${at}`);
      addedRowsListed = b.slice(a.length);
      assert.deepEqual(addedRowsListed, addedRows, `Only the intake's configuration rows may be added: ${at}`);
      return;
    }
    assert.equal(b.length, a.length, `Coverage changed: ${at}`);
    a.forEach((value, index) => compare(value, b[index], `${at}/${index}`));
  } else assert.equal(b, a, `Scientific or non-roster value changed: ${at}`);
};
compare(before, candidate, '');
assert.ok(differences.length, 'No configuration reference changed');
if (currentConfig) assert.equal(currentConfig.path, config);
const statusRows = (doc: any) => key === 'scoped' ? doc.summary : (doc.records ?? []).map((r: any) => ({accession: r.accession, status: r.status}));

fs.mkdirSync(destination, {recursive: true});
const beforePath = resolve(destination, `${key}.before.json`);
if (fs.existsSync(beforePath)) assert.equal(hash(fs.readFileSync(beforePath)), hash(beforeBytes), 'Earlier before-review evidence exists');
else write(`${key}.before.json`, beforeBytes);
write(`${key}.candidate.json`, candidateBytes);
const review = {key, auditor: target.auditor, auditorSha256: PRODUCERS[target.auditor], report: target.report,
  projection: 'scripts/run_sealed_ts_check.mts supersession projection', beforeSha256: hash(beforeBytes), candidateSha256: hash(candidateBytes),
  configReferencesChanged: differences.length, addedRowsListed, allScientificAndOtherFieldsUnchanged: true,
  currentConfig: currentConfig ?? null, statuses: statusRows(candidate), differences};
write(`${key}.review.json`, JSON.stringify(review, null, 2) + '\n');
actualWrite(resolve(root, target.report), candidateBytes);
assert.equal(hash(fs.readFileSync(resolve(root, target.report))), hash(candidateBytes));
console.log(`${key}: ${differences.length} config references refreshed; ${addedRowsListed.length} added rows listed; all other values unchanged.`);
