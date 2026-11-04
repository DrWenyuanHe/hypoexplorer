import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {test} from 'node:test';
import {gunzipSync, gzipSync} from 'node:zlib';
import {readSealedHistoricalInput} from './historicalEvidence.mjs';
import {QC_INPUT_BASELINE, fingerprintQcIdentity, qcInputAvailabilityDocument, qcLedgerDowngrades, readQcInputBaseline, retainQcInputIdentities, retainedAdditionAvailability, retainedRetirementAvailability} from './qcInputAvailability.mjs';

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
function fixture(run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'qc-input-availability-'));
  try { run(root); } finally { rmSync(root, {recursive: true, force: true}); }
}

test('absent old identity is retained as metadata without reading it or changing QC statuses', () => fixture(root => {
  const inputs = new Map<string, string>([['current.json', hash('current')]]);
  const expected = hash('old source');
  const retained = retainQcInputIdentities(root, inputs, {'raw/missing.gz': expected}, () => { throw Error('must not read absent source'); });
  assert.equal(inputs.get('raw/missing.gz'), expected);
  assert.deepEqual(retained, [{path: 'raw/missing.gz', sha256: expected, availability: 'unavailable_not_verified'}]);
  const report = qcInputAvailabilityDocument(1, retained);
  assert.equal(report.unavailableIdentityCount, 1);
  assert.match(report.policy, /never grants a passing QC check/);
  assert.throws(() => readFileSync(resolve(root, 'raw/missing.gz')), /ENOENT/);
  assert.throws(() => readSealedHistoricalInput(root, 'raw/missing.gz', expected), /ENOENT/);
}));

test('available retained identity must match and a changed source is rejected', () => fixture(root => {
  mkdirSync(join(root, 'raw'));
  const path = join(root, 'raw/source.gz');
  writeFileSync(path, 'reviewed source');
  const baseline = {'raw/source.gz': hash('reviewed source')};
  const readHash = (absolute: string) => hash(readFileSync(absolute));
  const good = retainQcInputIdentities(root, new Map(), baseline, readHash);
  assert.equal(good[0].availability, 'available_identity_checked');
  writeFileSync(path, 'different source');
  assert.throws(() => retainQcInputIdentities(root, new Map(), baseline, readHash), /available retained dependency changed/);
}));

test('current measurements are kept, malformed paths and pins are rejected', () => fixture(root => {
  const observed = new Map([['live.json', hash('current')]]);
  assert.deepEqual(retainQcInputIdentities(root, observed, {'live.json': hash('older')}, () => { throw Error('already measured'); }), []);
  assert.equal(observed.get('live.json'), hash('current'));
  assert.throws(() => retainQcInputIdentities(root, new Map(), {'../outside': hash('x')}, hash as any), /leaves workspace/);
  assert.throws(() => retainQcInputIdentities(root, new Map(), {'raw/x': 'not-a-pin'}, hash as any), /invalid retained identity/);
}));

test('the pre-intake artifact is fixed and rejects a different compressed payload', () => {
  const root = resolve('.');
  assert.equal(Object.keys(readQcInputBaseline(root)).length, 3932);
  const bytes = readFileSync(resolve(root, QC_INPUT_BASELINE));
  const corrupted = Buffer.from(bytes);
  corrupted[Math.floor(corrupted.length / 2)] ^= 1;
  assert.throws(() => readQcInputBaseline(root, () => corrupted));
  const changed = Buffer.from(gunzipSync(bytes));
  changed[changed.indexOf(Buffer.from('internal-qc-v1'))] ^= 1;
  const validChangedArchive = gzipSync(changed);
  assert.throws(() => readQcInputBaseline(root, () => validChangedArchive), /pre-intake artifact identity differs/);
});

test('text identities use the ledger CRLF policy while binary identities stay exact', () => {
  assert.equal(fingerprintQcIdentity('old.json', Buffer.from('{\r\n}\r\n')), hash('{\n}\n'));
  assert.equal(fingerprintQcIdentity('old.rds', Buffer.from('a\r\nb')), hash('a\r\nb'));
  assert.equal(fingerprintQcIdentity('invalid.txt', Buffer.from([255, 13, 10])), hash(Buffer.from([255, 13, 10])));
});

test('an absent retirement is allowed only when already sealed; new missing retirement still fails', () => {
  const expected = hash('sealed previous identity');
  assert.throws(() => retainedRetirementAvailability('old.gz', expected, new Set(), false), /newly retired evidence is missing/);
  assert.deepEqual(retainedRetirementAvailability('old.gz', expected, new Set(['old.gz']), false),
    {path: 'old.gz', sha256: expected, availability: 'previously_retired_unavailable_not_reverified'});
  assert.equal(retainedRetirementAvailability('old.gz', expected, new Set(['old.gz']), true, expected), null);
  assert.throws(() => retainedRetirementAvailability('old.gz', expected, new Set(['old.gz']), true, hash('changed source')), /available retired dependency changed/);
  assert.throws(() => retainedRetirementAvailability('old.gz', 'changed pin', new Set(['old.gz']), false), /invalid retirement identity/);
});

test('an absent successor must be previously declared and retain its exact baseline identity', () => {
  const expected = hash('retained source');
  const baseline = {'source.gz': expected};
  assert.throws(() => retainedAdditionAvailability('source.gz', expected, new Set(), baseline, false), /new successor evidence is missing/);
  assert.throws(() => retainedAdditionAvailability('source.gz', hash('changed'), new Set(['source.gz']), baseline, false), /unavailable successor identity changed/);
  assert.equal(retainedAdditionAvailability('source.gz', expected, new Set(['source.gz']), baseline, false)?.availability,
    'previously_added_unavailable_not_verified');
});

test('a rebuild that loses passes or inputs is reported as a downgrade', () => {
  const ledger = (statuses: Record<string, string>) => ({records: Object.entries(statuses).map(([datasetId, status]) => ({datasetId, assessment: {status}}))});
  const committed = ledger({a: 'pass', b: 'pass', c: 'review'});
  assert.deepEqual(qcLedgerDowngrades(committed, ledger({a: 'pass', b: 'pass', c: 'pass'}), 0, 0), []);
  assert.deepEqual(qcLedgerDowngrades(null, ledger({a: 'review'}), 0, 0), []);
  const partialCache = qcLedgerDowngrades(committed, ledger({a: 'pass', b: 'not_assessed', c: 'review'}), 0, 404);
  assert.equal(partialCache.length, 2);
  assert.match(partialCache[0], /404 more retained inputs are unavailable/);
  assert.match(partialCache[1], /b \(pass -> not_assessed\)/);
  assert.match(qcLedgerDowngrades(committed, ledger({a: 'pass'}), 0, 0)[0], /b \(pass -> absent\)/);
});
