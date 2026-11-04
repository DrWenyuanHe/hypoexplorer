import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, promises, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { projectSuperseded, routeSealedChild } from '../run_sealed_ts_check.mjs';
import { canonicalJson, diffRegistry, registrySha256, revertRegistryEdits, withoutAdditiveIntake, type RegistryEdits } from './registryEdits.mjs';
import { SOURCE_RELATIONSHIP_R460, SOURCE_RELATIONSHIP_R460_READER, SOURCE_RELATIONSHIP_R460_SCRIPT, SOURCE_RELATIONSHIP_R460_VERSION,
  createSourceRelationshipR460Reader, evidencePin, sourceRelationshipAvailability } from './sourceRelationshipR460.mjs';
import { ADDITIVE_INTAKE, checkLedgerTransition, GSE135007_SERIALIZATION_SUCCESSOR, GSE157077_UNIT_SUCCESSOR, readAdditiveIntake, readSealedHistoricalInput, readSerializedPredecessor, readSupersededInput, readSupersededLedger, readTimeSeriesUnitPredecessor, SUPERSESSION_DIR, SUPERSESSION_MANIFEST, SUPERSESSION_SHA256 } from './historicalEvidence.mjs';

const root = process.cwd();
const path = 'data/author-validation/manual-review.json';
const seal = 'a77611e9814fbba8b935c3237652cef5b7779a7dc7a05555ce5318cea968bebc';
const current = JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const readWith = (doc: unknown) => (file: string): Buffer => file === resolve(root, path)
  ? Buffer.from(JSON.stringify(doc)) : readFileSync(file);

test('additive intake rows do not replace the original sealed review', () => {
  const changed = structuredClone(current);
  changed.records.hfd_future_fixture = { note: 'Separately audited intake evidence.' };
  const before = readSealedHistoricalInput(root, path, seal, readWith(changed));
  assert.equal(JSON.parse(before.toString('utf8')).records.hfd_future_fixture, undefined);
});

test('historical review edits and deletions are still refused', () => {
  const original = JSON.parse(readSealedHistoricalInput(root, path, seal).toString('utf8'));
  const id = Object.keys(original.records)[0];
  const edited = structuredClone(current);
  edited.records[id].note = 'A substituted scientific decision.';
  assert.throws(() => readSealedHistoricalInput(root, path, seal, readWith(edited)), /Historical dataset evidence changed/);
  delete edited.records[id];
  assert.throws(() => readSealedHistoricalInput(root, path, seal, readWith(edited)), /Historical dataset evidence changed/);
});

test('historical policy and schema changes are refused even when rows are intact', () => {
  const ledgerPath = 'data/internal-qc/assessments.generated.json';
  const ledgerSeal = 'e221814d052e61ab7797e5d8390c169cf9b34707751371ca2ab1f2b926d071e5';
  const ledger = JSON.parse(readFileSync(resolve(root, ledgerPath), 'utf8'));
  const check = (doc: unknown) => readSealedHistoricalInput(root, ledgerPath, ledgerSeal,
    file => file === resolve(root, ledgerPath) ? Buffer.from(JSON.stringify(doc)) : readFileSync(file));
  const policy = structuredClone(ledger);
  policy.policy.replication = 'Automatically pass every dataset';
  assert.throws(() => check(policy), /Historical document semantics changed/);
  const schema = structuredClone(ledger);
  schema.schemaVersion = 999;
  assert.throws(() => check(schema), /Historical document semantics changed/);
  delete schema.policy;
  assert.throws(() => check(schema), /Historical document schema changed/);
});

// A one-job manifest exactly as produce.py's json.dumps writes it in the sealing checkout.
const jobsPath = 'data/internal-qc/intake-numeric-2026-09-11/jobs.json';
const jobsSeal = 'c08475d2289ca4a050c39d1366d2853318d86dde8ac3c3a13d67611ba32dab71';
const sealedDir = String.raw`D:\\Monkey Brain\\MONKEYBRAIN\\geo_replication\\datasets\\GSE000001`;
const jobLine = (field: string, file: string) => `      "${field}": "${sealedDir}\\\\${file.replaceAll('/', '\\\\')}",`;
const sealedJobs = ['{', '  "jobs": [', '    {', '      "analysisId": "GSE000001",', '      "contrast": {',
  '        "id": "case_vs_control",', String.raw`        "label": "Case \u2013 control"`, '      },', '      "datasetId": "gse000001",',
  jobLine('de', 'processed/DE.tsv'), jobLine('expression', 'processed/cpm.tsv.gz'), jobLine('geneMap', 'metadata/map.tsv'),
  jobLine('input', 'processed/counts.tsv.gz'), '      "kind": "counts",', jobLine('normalization', 'processed/norm.tsv'),
  jobLine('se', 'processed/SE.tsv'), jobLine('sheet', 'metadata/sheet.tsv'), jobLine('source', 'raw/source.tsv.gz'),
  jobLine('sourceSheet', 'raw/sheet.tsv'), '      "trackId": "whole"', '    }', '  ]', '}', ''].join('\n');
const checkout = resolve(root, '..', 'another-checkout');
const writtenIn = (base: string, edit: (job: any) => void = () => {}) => {
  const manifest = JSON.parse(sealedJobs);
  for (const job of manifest.jobs) {
    for (const [field, value] of Object.entries(job)) {
      if (typeof value === 'string' && value.startsWith('D:\\')) job[field] = resolve(base, ...value.split('\\').slice(3));
    }
    edit(job);
  }
  return (file: string): Buffer => {
    assert.equal(file, resolve(checkout, jobsPath));
    return Buffer.from(JSON.stringify(manifest, null, 2));
  };
};

test('the fixture is the Python-serialized sealed manifest', () => {
  assert.equal(createHash('sha256').update(sealedJobs).digest('hex'), jobsSeal);
});

test('a job manifest written in another checkout verifies as the sealed manifest', () => {
  assert.equal(readSealedHistoricalInput(checkout, jobsPath, jobsSeal, writtenIn(checkout)).toString('utf8'), sealedJobs);
});

test('changed jobs and jobs located outside the checkout are refused', () => {
  assert.throws(() => readSealedHistoricalInput(checkout, jobsPath, jobsSeal, writtenIn(checkout, (job) => { job.contrast.id = 'borrowed'; })),
    /Historical job manifest changed/);
  assert.throws(() => readSealedHistoricalInput(checkout, jobsPath, jobsSeal, writtenIn(checkout, (job) => { job.extra = 'added'; })),
    /Historical job manifest changed/);
  assert.throws(() => readSealedHistoricalInput(checkout, jobsPath, jobsSeal, writtenIn(resolve(checkout, '..', 'third-checkout'))),
    /outside the checkout/);
});

// R 4.6.0 supersession: a temporary repository commits the pre-swap outputs, then
// the regeneration and a finalized manifest (mirrors scripts/supersession_fixture.py).
const OUTPUT = 'geo_replication/datasets/GSE000001_mmus_test/processed/GSE000001_DE.tsv';
const OTHER = 'geo_replication/datasets/GSE000002_mmus_other/processed/GSE000002_DE.tsv';
const LEDGER = 'data/quality/assessments.generated.json';
const OLD = Buffer.from('gene\tlogFC\nA\t1.25\nB\t-0.5\n');
const NEW = Buffer.from('gene\tlogFC\nA\t1.2501\nB\t-0.4999\n');
const CRLF = Buffer.from(OLD.toString('latin1').replaceAll('\n', '\r\n'), 'latin1');
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const ledger = (changes: Record<string, string> = {}) => ({ schemaVersion: 2, policy: 'unchanged',
  records: Object.entries({ a: 'pass', b: 'review', c: 'pass', ...changes }).map(([datasetId, status]) => ({ datasetId, status })) });

function supersessionRepo() {
  const dir = mkdtempSync(resolve(tmpdir(), 'supersession-'));
  const git = (...args: string[]) => {
    const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (path: string, bytes: Buffer) => {
    mkdirSync(dirname(resolve(dir, path)), { recursive: true });
    writeFileSync(resolve(dir, path), bytes);
  };
  git('init', '-q');
  for (const [name, value] of [['core.autocrlf', 'false'], ['user.name', 'fixture'], ['user.email', 'fixture@example.invalid']]) git('config', name, value);
  const before = json(ledger());
  write(OUTPUT, OLD);
  write(OTHER, Buffer.from('gene\tlogFC\nC\t2\n'));
  write(LEDGER, before);
  git('add', '-A');
  git('commit', '-q', '-m', 'pre-swap');
  const commit = git('rev-parse', 'HEAD');
  const record = { path: OUTPUT, datasetId: 'b', oldSha256: sha(OLD), oldBytes: OLD.length, oldGitBlob: git('rev-parse', `HEAD:${OUTPUT}`),
    oldPinForm: 'crlf', pinnedBy: ['evidence.json'], newSha256: sha(NEW), newBytes: NEW.length };
  const archivePath = `${SUPERSESSION_DIR}/preserved-inputs/${sha(before)}.json.gz`;
  const ledgerRow = { path: LEDGER, sha256: sha(before), bytes: before.length, gitBlob: git('rev-parse', `HEAD:${LEDGER}`), pinForm: 'exact', archivePath };
  const otherBlob = git('rev-parse', `HEAD:${OTHER}`);
  const manifest = (changes: Record<string, unknown> = {}) => {
    const body = json({ schemaVersion: 1, record: 'fixture', state: 'finalized', preSwapCommit: commit, tag: 'superseded/fixture',
      ledgers: [ledgerRow], records: [{ ...record, ...changes }] });
    write(SUPERSESSION_MANIFEST, body);
    return sha(body);
  };
  write(OUTPUT, NEW);
  write(LEDGER, json(ledger({ b: 'pass' })));
  write(archivePath, gzipSync(before));
  const manifestSha = manifest();
  git('add', '-A');
  git('commit', '-q', '-m', 'R 4.6.0 regeneration');
  return { dir, git, write, manifest, manifestSha, before, otherBlob, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('superseded outputs receive the committed old bytes in their pinned form', (t) => {
  const repo = supersessionRepo();
  t.after(repo.cleanup);
  const options = { manifestSha: repo.manifestSha };
  assert.deepEqual(readSupersededInput(repo.dir, OUTPUT, sha(OLD), options), OLD);
  assert.deepEqual(readSupersededInput(repo.dir, OUTPUT, sha(CRLF), options), CRLF);
  assert.throws(() => readSupersededInput(repo.dir, OUTPUT, sha('another pin'), options), /Pin is not the superseded bytes/);
  assert.throws(() => readSupersededInput(repo.dir, OUTPUT, sha(OLD), { manifestSha: null }), /not finalized/);
  // The repository's own constant pins the real manifest, not this fixture's.
  assert.throws(() => readSupersededInput(repo.dir, OUTPUT, sha(OLD)), /Supersession manifest changed/);
  // A checkout's CRLF rendering of LF regenerated bytes is the same regeneration.
  const crlfNew = Buffer.from(NEW.toString('latin1').replaceAll('\n', '\r\n'), 'latin1');
  assert.deepEqual(readSupersededInput(repo.dir, OUTPUT, sha(OLD), { ...options, current: crlfNew }), OLD);
});

test('supersession tampering is refused', (t) => {
  const repo = supersessionRepo();
  t.after(repo.cleanup);
  repo.write(OUTPUT, Buffer.concat([NEW, Buffer.from('C\t3\n')]));
  assert.throws(() => readSupersededInput(repo.dir, OUTPUT, sha(OLD), { manifestSha: repo.manifestSha }), /not the recorded R 4.6.0 regeneration/);
  repo.write(OUTPUT, NEW);
  const wrongBlob = repo.manifest({ oldGitBlob: repo.otherBlob });
  assert.throws(() => readSupersededInput(repo.dir, OUTPUT, sha(OLD), { manifestSha: wrongBlob }), /Superseded blob is not the recorded one/);
  const forged = Buffer.from('gene\tlogFC\nA\t9\n');
  const forgedSha = repo.manifest({ oldSha256: sha(forged), oldBytes: forged.length });
  assert.throws(() => readSupersededInput(repo.dir, OUTPUT, sha(forged), { manifestSha: forgedSha }), /Superseded bytes changed/);
  assert.throws(() => readSupersededInput(repo.dir, OUTPUT, sha(OLD), { manifestSha: repo.manifestSha }), /Supersession manifest changed/);
});

test('a shallow clone fails closed and names the fix', (t) => {
  const repo = supersessionRepo();
  const clone = `${repo.dir}-shallow`;
  t.after(() => { repo.cleanup(); rmSync(clone, { recursive: true, force: true }); });
  const result = spawnSync('git', ['-c', 'core.autocrlf=false', 'clone', '-q', '--depth', '1', pathToFileURL(repo.dir).href, clone]);
  assert.equal(result.status, 0, result.stderr?.toString());
  assert.throws(() => readSupersededInput(clone, OUTPUT, sha(OLD), { manifestSha: repo.manifestSha }), /shallow clone.*git fetch --unshallow/);
});

test('a regenerated ledger resolves to its archive only when other datasets and policy are unchanged', (t) => {
  const repo = supersessionRepo();
  t.after(repo.cleanup);
  const options = { manifestSha: repo.manifestSha };
  assert.deepEqual(readSupersededLedger(repo.dir, LEDGER, options), repo.before);
  const refused: [unknown, RegExp][] = [
    [ledger({ a: 'review', b: 'pass' }), /dataset outside the regeneration: .*\/records\/a/],
    [{ ...ledger({ b: 'pass' }), policy: 'new' }, /Regenerated ledger semantics changed/],
    [ledger({ b: 'pass', d: 'pass' }), /record count changed/],
  ];
  for (const [document, message] of refused) {
    assert.throws(() => readSupersededLedger(repo.dir, LEDGER, { ...options, current: json(document) }), message);
  }
});

const additiveStudy = () => {
  const dir = 'geo_replication/datasets/GSE30733_rnor_son_lactation';
  return { id: 'rat_son_lactation_gse30733', accession: 'GSE30733', organism: 'Rattus norvegicus', dir,
    tracks: [{ id: 'son', analysisId: 'GSE30733', matrix: `${dir}/processed/expression.tsv.gz`, samplesheet: `${dir}/metadata/samplesheet.tsv` }],
    contrasts: [{ id: 'lactating_vs_control' }, { id: 'dehydrated_vs_control' }] };
};

test('new configuration IDs must remain bound to their declared source accession and directory', (t) => {
  const repo = supersessionRepo();
  t.after(repo.cleanup);
  const original = Buffer.from('id\tdir\torganism\tinput_kind\tinput_path\tsamplesheet\nOLD\tdatasets/old\tMus musculus\tcounts\tx\ty\n');
  const pin = sha(original), configPath = 'geo_replication/config/datasets.tsv';
  const archives = 'data/quality/hfd-intake-2026-09-12/preserved-inputs';
  repo.write(`${archives}/${pin}.gz`, gzipSync(original));
  repo.write(`${archives}/manifest.json`, json({ records: [{ path: configPath, sha256: pin, bytes: original.length, archivePath: `${archives}/${pin}.gz` }] }));
  repo.write('data/intake/hfd-2026-09-12/studies.json', json([]));
  repo.write(ADDITIVE_INTAKE, json([additiveStudy()]));
  const directory = additiveStudy().dir.replace(/^geo_replication\//, '');
  const fields = ['GSE30733_dehydrated_vs_control', directory, 'Rattus norvegicus', 'matrix', `${directory}/processed/expression.tsv.gz`, `${directory}/metadata/analysis.tsv`];
  const config = (cells: string[]) => repo.write(configPath, Buffer.concat([original, Buffer.from(`${cells.join('\t')}\n`)]));
  config(fields);
  assert.deepEqual(readSealedHistoricalInput(repo.dir, configPath, pin), original);
  assert.deepEqual([...readAdditiveIntake(repo.dir).configIds.keys()], ['GSE30733', 'GSE30733_dehydrated_vs_control']);
  for (const [index, value] of [[0, 'GSE65663'], [1, 'datasets/another'], [2, 'Mus musculus'], [3, 'counts'],
    [4, `${directory}/../another/expression.tsv`], [5, `${directory}\\metadata\\sheet.tsv`]] as [number, string][]) {
    const changed = [...fields]; changed[index] = value;
    config(changed);
    assert.throws(() => readSealedHistoricalInput(repo.dir, configPath, pin));
  }
  const corrupt = additiveStudy(); corrupt.id = 'macaque_snrna';
  repo.write(ADDITIVE_INTAKE, json([corrupt]));
  assert.throws(() => readAdditiveIntake(repo.dir), /source identity changed/);
  repo.write(ADDITIVE_INTAKE, json([additiveStudy(), additiveStudy()]));
  assert.throws(() => readAdditiveIntake(repo.dir), /Duplicate additive intake dataset/);
  const escaped = additiveStudy(); escaped.tracks[0].matrix = `${escaped.dir}/../../different.tsv`;
  repo.write(ADDITIVE_INTAKE, json([escaped]));
  assert.throws(() => readAdditiveIntake(repo.dir), /outside its source dataset/);
  const otherAccession = additiveStudy(); otherAccession.tracks[0].analysisId = 'GSE65663';
  repo.write(ADDITIVE_INTAKE, json([otherAccession]));
  assert.throws(() => readAdditiveIntake(repo.dir), /another source accession/);
});

test('only declared additive rows disappear from a regenerated ledger historical view', (t) => {
  const repo = supersessionRepo();
  t.after(repo.cleanup);
  repo.write(ADDITIVE_INTAKE, json([additiveStudy()]));
  const added = additiveStudy().id;
  const after = ledger({ b: 'pass', [added]: 'not_assessed' });
  repo.write(LEDGER, json(after));
  assert.deepEqual(readSupersededLedger(repo.dir, LEDGER, { manifestSha: repo.manifestSha }), repo.before);
  assert.deepEqual(JSON.parse(readFileSync(resolve(repo.dir, LEDGER), 'utf8')), after);
  const ids = readAdditiveIntake(repo.dir).datasetIds;
  const check = (document: unknown) => checkLedgerTransition(LEDGER, ledger(), document, new Set(['b']), new Set(), undefined, ids);
  const changes: any[] = [];
  const change = (edit: (doc: any) => void) => { const doc = structuredClone(after); edit(doc); changes.push(doc); };
  change(doc => { doc.policy = 'new'; });
  change(doc => { doc.records[0].status = 'fail'; });
  change(doc => { doc.records.splice(0, 2, doc.records[1], doc.records[0]); });
  change(doc => { doc.records.shift(); });
  change(doc => { doc.records.push(doc.records.at(-1)); });
  change(doc => { doc.records.at(-1).datasetId = 'unreviewed'; });
  for (const document of changes) assert.throws(() => check(document));
  assert.throws(() => checkLedgerTransition('data/internal-qc/advancement-2026-09-05/normalization-evidence.json',
    ledger(), after, new Set(['b']), new Set(), undefined, ids), /record count changed/);
  assert.throws(() => checkLedgerTransition(LEDGER, ledger(), after, new Set(['b']), new Set(), undefined, new Set(['unrelated'])), /Unreviewed additive ledger identities/);
  rmSync(resolve(repo.dir, ADDITIVE_INTAKE));
  assert.throws(() => readSupersededLedger(repo.dir, LEDGER, { manifestSha: repo.manifestSha }), /record count changed/);
});

test('additive validation and mechanical scopes count exactly the declared new records', () => {
  const ids = new Set([additiveStudy().id]);
  const validationPath = 'data/author-validation/validation-records.generated.json';
  const before = { schemaVersion: 2, scope: { registryDatasets: 2, inScopeDatasets: 1, unit: 'dataset x registered contrast' },
    records: [{ datasetId: 'a' }, { datasetId: 'b' }] };
  const after = { ...before, scope: { ...before.scope, registryDatasets: 3, inScopeDatasets: 2 }, records: [...before.records, { datasetId: additiveStudy().id }] };
  const check = (path: string, old: unknown, now: unknown) => checkLedgerTransition(path, old, now, new Set(['b']), new Set(), undefined, ids);
  check(validationPath, before, after);
  for (const scope of [{ ...after.scope, registryDatasets: 4 }, { ...after.scope, unit: 'changed' }, before.scope]) {
    assert.throws(() => check(validationPath, before, { ...after, scope }), /Additive validation scope changed/);
  }
  const mechanicalPath = 'data/author-validation/mechanical-audit.generated.json';
  const old = { schemaVersion: 2, datasetCount: 1, contrastCount: 1, datasets: [{ datasetId: 'a', contrasts: [{ contrastId: 'old' }] }] };
  const now = { ...old, datasetCount: 2, contrastCount: 3,
    datasets: [...old.datasets, { datasetId: additiveStudy().id, contrasts: [{ contrastId: 'x' }, { contrastId: 'y' }] }] };
  check(mechanicalPath, old, now);
  for (const changed of [{ ...now, datasetCount: 3 }, { ...now, contrastCount: 2 }]) {
    assert.throws(() => check(mechanicalPath, old, changed), /Additive mechanical/);
  }
});

test('the TypeScript runner serves verified old bytes and rejects a change during the check', (t) => {
  const repo = supersessionRepo();
  t.after(repo.cleanup);
  const restore = projectSuperseded(repo.dir, repo.manifestSha);
  try {
    // Both the namespace binding and the default export are patched.
    assert.deepEqual(readFileSync(resolve(repo.dir, OUTPUT)), CRLF);
    assert.equal(readFileSync(resolve(repo.dir, OUTPUT), 'utf8'), CRLF.toString('utf8'));
    assert.deepEqual(readFileSync(resolve(repo.dir, LEDGER)), repo.before);
    assert.equal(readFileSync(resolve(repo.dir, OTHER), 'utf8'), 'gene\tlogFC\nC\t2\n');
    writeFileSync(resolve(repo.dir, OUTPUT), Buffer.concat([NEW, Buffer.from('changed\n')]));
    assert.throws(() => readFileSync(resolve(repo.dir, OUTPUT)), /changed during historical check/);
  } finally {
    restore();
  }
  assert.equal(readFileSync(resolve(repo.dir, OUTPUT), 'utf8'), 'gene\tlogFC\nA\t1.2501\nB\t-0.4999\nchanged\n');
  const unpinned = projectSuperseded(repo.dir, null);
  try {
    assert.deepEqual(readFileSync(resolve(repo.dir, LEDGER)), json(ledger({ b: 'pass' })));
  } finally {
    unpinned();
  }
});

test('the TypeScript runner serves superseded bytes through descriptors and reports their size', async (t) => {
  const repo = supersessionRepo();
  t.after(repo.cleanup);
  const served: string[] = [];
  const restore = projectSuperseded(repo.dir, repo.manifestSha, (name) => served.push(name));
  const file = resolve(repo.dir, OUTPUT);
  try {
    // Node's readFileSync calls the patched openSync; the projection does not recurse.
    assert.deepEqual(readFileSync(file), CRLF);
    assert.equal(statSync(file).size, CRLF.length);
    assert.equal(statSync(file, { bigint: true }).size, BigInt(CRLF.length));
    assert.equal(lstatSync(file).size, CRLF.length);
    assert.equal((await promises.stat(file)).size, CRLF.length);
    assert.equal(statSync(resolve(repo.dir, OTHER)).size, 'gene\tlogFC\nC\t2\n'.length);
    const descriptor = openSync(file, 'r');
    try {
      assert.equal(fstatSync(descriptor).size, CRLF.length);
      const buffer = Buffer.alloc(5);
      const chunks: Buffer[] = [];
      for (let count = readSync(descriptor, buffer, 0, buffer.length, null); count > 0; count = readSync(descriptor, buffer, 0, buffer.length, null)) {
        chunks.push(Buffer.from(buffer.subarray(0, count)));
      }
      assert.deepEqual(Buffer.concat(chunks), CRLF);
      const at = Buffer.alloc(4);
      assert.equal(readSync(descriptor, at, { position: 5 }), 4);
      assert.deepEqual(at, CRLF.subarray(5, 9));
    } finally {
      closeSync(descriptor);
    }
    const whole = openSync(file, 'r');
    try { assert.deepEqual(readFileSync(whole), CRLF); } finally { closeSync(whole); }
    assert.deepEqual(served, [OUTPUT]);
    writeFileSync(file, Buffer.concat([NEW, Buffer.from('changed\n')]));
    assert.throws(() => statSync(file), /changed during historical check/);
  } finally {
    restore();
  }
  assert.equal(statSync(file).size, NEW.length + 'changed\n'.length);
});

test('a sealed Python producer spawned by a sealed check runs through its pinned runner', () => {
  const producer = 'data/internal-qc/replication-2026-09-05/round4-d/build_fragment.py';
  const routed = [resolve(root, 'scripts/run_historical_check.py'), producer, '--check'];
  assert.deepEqual(routeSealedChild(root, [resolve(root, producer), '--check']), routed);
  assert.deepEqual(routeSealedChild(root, [producer, '--check']), routed);
  // Only `<producer> --check` of an allow-listed producer is routed.
  for (const args of [[producer], [producer, '--write'], [producer, '--check', 'extra'], ['scripts/other.py', '--check'], ['-c', 'print(1)']]) {
    assert.deepEqual(routeSealedChild(root, args), args);
  }
});

// Registry edits: a registry evaluated before and after the regeneration.
const BEFORE_REGISTRY = [
  { id: 'a', expressionUnit: 'CPM', contrasts: [{ id: 'case_vs_control', isDefault: true }] },
  { id: 'b', expressionUnit: 'log2 intensity', contrasts: [{ id: 'kd_vs_wt', isDefault: true }] },
];
const registryEdits = (changes: Partial<RegistryEdits> = {}): RegistryEdits => ({
  schemaVersion: 1, record: 'fixture', preSwapCommit: 'fixture', module: 'src/data/datasets.ts', export: 'DATASETS',
  preSwapDatasetIds: ['a', 'b'], preSwapRegistrySha256: registrySha256(BEFORE_REGISTRY),
  edits: [
    { datasetId: 'a', field: 'expressionUnit', old: 'CPM', new: 'CPM (TMM-normalized)', reason: 'Rule C2 fixture' },
    { datasetId: 'a', field: 'contrasts', old: BEFORE_REGISTRY[0].contrasts, new: [{ id: 'case_vs_control', isDefault: true, exploratory: true }], reason: 'Exploratory fixture' },
  ],
  ...changes,
});
const currentRegistry = (): any[] => [
  { id: 'a', expressionUnit: 'CPM (TMM-normalized)', contrasts: [{ id: 'case_vs_control', isDefault: true, exploratory: true }] },
  structuredClone(BEFORE_REGISTRY[1]),
];

test('registry edits are exactly the field differences from the pre-swap registry', () => {
  assert.deepEqual(diffRegistry(BEFORE_REGISTRY, currentRegistry()), registryEdits().edits.map(({ reason: _reason, ...edit }) => edit));
  assert.throws(() => diffRegistry(BEFORE_REGISTRY, currentRegistry().slice(0, 1)), /pre-swap dataset was removed: b/);
  assert.throws(() => diffRegistry(BEFORE_REGISTRY, [{ ...currentRegistry()[0], added: true }, currentRegistry()[1]]), /field was added or removed: a\/added/);
});

test('the registry is served as the pre-swap registry only when every difference is a recorded edit', () => {
  const reverted = currentRegistry();
  const added = { id: 'c', expressionUnit: 'CPM (TMM-normalized)', contrasts: [] };
  reverted.push(added);
  revertRegistryEdits(reverted, registryEdits());
  assert.equal(canonicalJson(reverted.slice(0, 2)), canonicalJson(BEFORE_REGISTRY));
  assert.deepEqual(reverted[2], added, 'a dataset added after the swap is served unchanged');
  const refused: [any[], RegistryEdits, RegExp][] = [
    // An unrecorded change to another dataset.
    [[currentRegistry()[0], { ...BEFORE_REGISTRY[1], expressionUnit: 'CPM' }], registryEdits(), /beyond the recorded regeneration edits/],
    // A recorded field whose current value is not the recorded new value.
    [[{ ...currentRegistry()[0], expressionUnit: 'TPM' }, currentRegistry()[1]], registryEdits(), /differs from the recorded regeneration edit: a\/expressionUnit/],
    // A forged old value.
    [currentRegistry(), registryEdits({ edits: [{ ...registryEdits().edits[0], old: 'TPM' }, registryEdits().edits[1]] }), /beyond the recorded regeneration edits/],
    // A removed or reordered pre-swap dataset.
    [currentRegistry().reverse(), registryEdits(), /removed or reordered/],
  ];
  for (const [datasets, document, message] of refused) assert.throws(() => revertRegistryEdits(datasets, document), message);
});

test('sealed producers see the registry without the additive intake that the archived ledgers predate', () => {
  const projected = [...currentRegistry(), { id: 'c', contrasts: [] }, { id: 'd', contrasts: [] }];
  withoutAdditiveIntake(projected, registryEdits(), new Set(['c']));
  assert.deepEqual(projected.map((row) => row.id), ['a', 'b', 'd'], 'only the additive intake dataset is removed');
  assert.throws(() => withoutAdditiveIntake(currentRegistry(), registryEdits(), new Set(['a'])), /is a pre-swap dataset/);
});

test('the runner loads superseded JSON modules and the reverted registry through its loader hooks', (t) => {
  const repo = supersessionRepo();
  t.after(repo.cleanup);
  const registrySource = (rows: unknown) => `export const DATASETS = ${JSON.stringify(rows)};\nexport function getDataset(id) { return DATASETS.find((row) => row.id === id) ?? null; }\n`;
  // As in this repository, .ts files are ES modules.
  repo.write('package.json', Buffer.from('{"type": "module"}\n'));
  repo.write('src/data/datasets.ts', Buffer.from(registrySource(currentRegistry())));
  const editsBody = json(registryEdits());
  repo.write('data/quality/regeneration-r460-2026-09-25/registry-edits.json', editsBody);
  const probe = resolve(repo.dir, 'probe.mts');
  writeFileSync(probe, [
    `import { projectSupersededModules } from ${JSON.stringify(pathToFileURL(resolve(root, 'scripts/run_sealed_ts_check.mts')).href)};`,
    `projectSupersededModules(${JSON.stringify(repo.dir)}, process.argv[2], process.argv[3]);`,
    `const ledger = await import(${JSON.stringify(pathToFileURL(resolve(repo.dir, LEDGER)).href)}, { with: { type: 'json' } });`,
    `const registry = await import(${JSON.stringify(pathToFileURL(resolve(repo.dir, 'src/data/datasets.ts')).href)});`,
    `console.log(JSON.stringify({ ledger: ledger.default, datasets: registry.DATASETS, a: registry.getDataset('a') }));`,
  ].join('\n'));
  const run = (manifestSha: string, editsSha: string) => spawnSync(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), probe, manifestSha, editsSha],
    { cwd: repo.dir, encoding: 'utf8' });
  const ok = run(repo.manifestSha, sha(editsBody));
  assert.equal(ok.status, 0, ok.stderr);
  const result = JSON.parse(ok.stdout);
  assert.deepEqual(result.ledger, JSON.parse(repo.before.toString('utf8')));
  assert.equal(canonicalJson(result.datasets), canonicalJson(BEFORE_REGISTRY));
  assert.equal(result.a.expressionUnit, 'CPM', 'every importer sees the one reverted registry');
  // An edited record, an unrecorded registry change and a changed ledger each fail the import.
  const edited = run(repo.manifestSha, sha('another record'));
  assert.notEqual(edited.status, 0);
  assert.match(edited.stderr, /Registry edit record changed/);
  repo.write('src/data/datasets.ts', Buffer.from(registrySource([currentRegistry()[0], { ...BEFORE_REGISTRY[1], expressionUnit: 'CPM' }])));
  const unrecorded = run(repo.manifestSha, sha(editsBody));
  assert.notEqual(unrecorded.status, 0);
  assert.match(unrecorded.stderr, /beyond the recorded regeneration edits/);
  repo.write('src/data/datasets.ts', Buffer.from(registrySource(currentRegistry())));
  repo.write(LEDGER, json(ledger({ a: 'review', b: 'pass' })));
  const ledgerChanged = run(repo.manifestSha, sha(editsBody));
  assert.notEqual(ledgerChanged.status, 0);
  assert.match(ledgerChanged.stderr, /dataset outside the regeneration/);
});

test('successor source-relationship evidence is read only while everything it pins is current', (t) => {
  const dir = mkdtempSync(resolve(tmpdir(), 'source-relationship-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const put = (path: string, body: string) => {
    mkdirSync(dirname(resolve(dir, path)), { recursive: true });
    writeFileSync(resolve(dir, path), body);
    return evidencePin(path, Buffer.from(body));
  };
  const input = 'geo_replication/datasets/GSE000001_mmus_test/raw/GSE000001_counts.tsv.gz';
  const pins = [put(input, 'gene\tA\nX\t1.5\n'), put('data/internal-qc/source-authenticity-2026-09-05/round4/evidence.json', '{}\n')];
  const record = { datasetId: 'gse000001', accession: 'GSE000001', configId: 'GSE000001', inputPath: input, sealedReader: 'round4',
    historical: { status: 'pass', sourceAuthentication: 'pass', derivedInputRelationship: 'pass', note: 'sealed' },
    superseded: [], status: 'pass', note: 'Re-established from the authenticated source.', pins };
  const write = (changes: Record<string, unknown> = {}) => put(SOURCE_RELATIONSHIP_R460, `${JSON.stringify({ schemaVersion: 1, version: SOURCE_RELATIONSHIP_R460_VERSION,
    record: 'fixture', script: put(SOURCE_RELATIONSHIP_R460_SCRIPT, '// producer\n'), reader: put(SOURCE_RELATIONSHIP_R460_READER, '// reader\n'),
    supersessionSha256: SUPERSESSION_SHA256, records: [record], ...changes }, null, 2)}\n`);
  const evaluate = (request: { currentInputPath?: string | null; previous?: any } = {}) =>
    createSourceRelationshipR460Reader(dir).evaluate({ datasetId: 'gse000001', currentInputPath: input, ...request });
  write();
  assert.ok(createSourceRelationshipR460Reader(dir).covers('gse000001'));
  assert.ok(!createSourceRelationshipR460Reader(dir).covers('gse000002'));
  assert.equal(evaluate().status, 'pass');
  assert.ok(evaluate().evidence!.includes(input));
  // A checkout's CRLF rendering of a text pin is the same evidence; changed bytes are not.
  put(pins[1].path, '{}\r\n');
  assert.equal(evaluate().status, 'pass');
  put(input, 'gene\tA\nX\t2\n');
  assert.match(evaluate().note, /stale pins: .*GSE000001_counts/);
  assert.equal(evaluate().status, 'not_assessed');
  put(input, 'gene\tA\nX\t1.5\n');
  assert.match(evaluate({ currentInputPath: 'geo_replication/datasets/GSE000001_mmus_test/raw/other.tsv.gz' }).note, /input binding changed/);
  const failed = evaluate({ previous: { id: 'source_integrity', label: 'Source file integrity', status: 'fail', note: 'Manifest mismatch.', evidence: ['m.json'] } });
  assert.equal(failed.status, 'fail', 'new evidence never overrides a failure');
  assert.ok(failed.evidence!.includes('m.json'));
  write({ supersessionSha256: 'another manifest' });
  assert.match(evaluate().note, /another supersession manifest/);
  write();
  write({ records: [{ ...record, unavailable: ['data/missing-original-source.tar'] }] });
  assert.equal(evaluate().status, 'not_assessed');
  assert.match(evaluate().note, /unavailable references: data\/missing-original-source.tar/);
  write();
  put(SOURCE_RELATIONSHIP_R460_READER, '// a changed reader\n');
  assert.match(evaluate().note, /producer or reader changed/);
});

test('unavailable source relationships remain not assessed without crashing the audit or granting a pass', () => {
  const root = resolve(tmpdir(), 'missing-relationship-fixture');
  const result = { status: 'not_assessed', sourceAuthentication: 'not_assessed', derivedInputRelationship: 'not_assessed',
    note: 'Missing evidence: data/source/original.download.json' };
  const availability = sourceRelationshipAvailability(root, result, [], ['data/source/review.json'],
    path => path === resolve(root, 'data/source/review.json'));
  assert.equal(availability.historicalPass, false);
  assert.deepEqual(availability.unavailable, ['data/source/original.download.json']);
  assert.deepEqual(availability.available, ['data/source/review.json']);
  assert.deepEqual(availability.authenticated, [], 'a present dependency is not authenticated after a failed source reader');
  const spaced = sourceRelationshipAvailability(root, { ...result,
    note: 'Source-authenticity evidence requires review: File pin changed or is missing: data/source/Supplemental table 1.docx' }, [], [], () => false);
  assert.deepEqual(spaced.unavailable, ['data/source/Supplemental table 1.docx']);
  const quoted = sourceRelationshipAvailability(root, { ...result,
    note: `ENOENT: no such file or directory, open '${resolve(root, 'data/source/protocol with spaces.docx')}'` }, [], [], () => false);
  assert.deepEqual(quoted.unavailable, ['data/source/protocol with spaces.docx']);
  const prose = sourceRelationshipAvailability(root, { ...result,
    note: 'The paper discusses data/source/Supplemental table 1.docx as background.' }, [], [], () => false);
  assert.deepEqual(prose.unavailable, [], 'arbitrary prose must not manufacture missing references');
  assert.throws(() => sourceRelationshipAvailability(root, { ...result,
    note: 'Missing evidence: data/source/../../outside' }, [], [], () => false), /escapes the workspace/);
  assert.throws(() => sourceRelationshipAvailability(root, result, [], ['../outside'], () => false), /escapes the workspace/);
  const claimed = { ...result, status: 'pass', sourceAuthentication: 'pass', derivedInputRelationship: 'pass' };
  assert.throws(() => sourceRelationshipAvailability(root, claimed, [], [], () => true), /reads no replaced file/);
  assert.throws(() => sourceRelationshipAvailability(root, claimed, ['geo_replication/replaced.tsv'], [], () => false), /unavailable evidence/);
});

test('a pinned exact-input GSE135007 successor retains its recorded intermediate bytes and rejects tampering', () => {
  const location = resolve(tmpdir(), 'serialized-predecessor-fixture');
  const input = 'geo_replication/datasets/GSE135007_discovery_20260905/processed/GSE135007_counts.tsv.gz';
  const prior = Buffer.from('independently preserved intermediate bytes');
  const next = Buffer.from('canonical roundtrip exact input bytes');
  const producer = 'scripts/regen-r460/run_gse135007_serialized_r460.R';
  const verificationPath = 'data/quality/gse135007-serialization-2026-10-23/verification.json';
  const archive = `data/quality/gse135007-serialization-2026-10-23/preserved/${sha(prior)}.gz`;
  const predecessorSha = 'a'.repeat(64);
  const row = { datasetId: 'gse135007', newSha256: sha(prior), newBytes: prior.length };
  const verification = { schemaVersion: 1, status: 'PASS', analysisId: 'GSE135007', canonicalSchema: 'hypo-counts-tsv17-v1',
    canonicalInput: input, canonicalInputSha256: sha(next), roundtrip: { exactValues: true, nValues: 12, maxAbsoluteDelta: 0 },
    sourceMapping: { status: 'PASS', authority: 'org.Mm.eg.db', version: '3.23.0', retainedMapIdentical: true },
    separateProcessReplay: { status: 'PASS', absoluteTolerance: 1e-6, relativeTolerance: 1e-6, matchedRows: 2, modelMismatches: 0, normalizationMismatches: 0 } };
  const make = (change: (doc: any, proof: any, files: Map<string, Buffer>) => void = () => {}) => {
    const files = new Map([[resolve(location, input), next], [resolve(location, producer), Buffer.from('# reviewed producer\n')],
      [resolve(location, archive), gzipSync(prior)]]);
    const proof = structuredClone(verification);
    const doc = { schemaVersion: 1, state: 'finalized', analysisId: 'GSE135007', datasetId: 'gse135007',
      predecessorManifest: { path: SUPERSESSION_MANIFEST, sha256: predecessorSha },
      producer: { path: producer, sha256: sha(files.get(resolve(location, producer))!) },
      verification: { path: verificationPath, sha256: '' },
      records: [{ path: input, priorSha256: sha(prior), priorBytes: prior.length, archivePath: archive, newSha256: sha(next), newBytes: next.length }] };
    change(doc, proof, files);
    const proofBytes = json(proof); doc.verification.sha256 = sha(proofBytes);
    files.set(resolve(location, verificationPath), proofBytes);
    const body = json(doc); files.set(resolve(location, GSE135007_SERIALIZATION_SUCCESSOR), body);
    const read = (path: string) => { const value = files.get(path); assert.ok(value, `missing fixture: ${path}`); return value; };
    return { files, read, seal: sha(body) };
  };
  const evaluate = (fixture: ReturnType<typeof make>, current = next, record = row, pin: string | null = fixture.seal) =>
    readSerializedPredecessor(location, input, record, current, fixture.read, pin, predecessorSha);
  assert.deepEqual(evaluate(make()), prior);
  assert.throws(() => evaluate(make(), Buffer.from('changed current product')), /Current bytes are not the recorded GSE135007 serialization successor/);
  assert.throws(() => evaluate(make(), next, { ...row, datasetId: 'another' }), /outside the GSE135007/);
  assert.throws(() => evaluate(make(), next, row, null), /not finalized/);
  assert.throws(() => evaluate(make(), next, row, '0'.repeat(64)), /manifest changed/);
  for (const change of [
    (doc: any) => { doc.predecessorManifest.sha256 = 'b'.repeat(64); },
    (doc: any) => { doc.records[0].priorSha256 = '0'.repeat(64); },
    (doc: any) => { doc.records[0].path = 'geo_replication/datasets/GSE135007_discovery_20260905/../../outside'; },
    (doc: any) => { doc.records.push(doc.records[0]); },
    (_doc: any, proof: any) => { proof.status = 'FAIL'; },
    (_doc: any, proof: any) => { proof.roundtrip.exactValues = false; },
    (_doc: any, proof: any) => { proof.separateProcessReplay.absoluteTolerance = 1e-3; },
    (_doc: any, proof: any) => { proof.separateProcessReplay.modelMismatches = 1; },
    (_doc: any, _proof: any, files: Map<string, Buffer>) => { files.set(resolve(location, archive), gzipSync(Buffer.from('changed archive'))); },
    (_doc: any, _proof: any, files: Map<string, Buffer>) => { files.set(resolve(location, producer), Buffer.from('# changed producer')); },
    (_doc: any, _proof: any, files: Map<string, Buffer>) => { files.set(resolve(location, input), Buffer.from('changed canonical input')); },
  ]) assert.throws(() => evaluate(make(change)));
});

test('the pinned GSE157077 unit-only successor preserves every value and rejects changed products or proof', () => {
  const path = 'public/datasets/mouse_scn_hfd_gse157077/timeseries_scn.js';
  const manifest = JSON.parse(readFileSync(resolve(root, SUPERSESSION_MANIFEST), 'utf8'));
  const row = manifest.records.find((entry: any) => entry.path === path);
  const current = readFileSync(resolve(root, path));
  const prior = readTimeSeriesUnitPredecessor(root, path, row, current);
  assert.equal(sha(prior), row.newSha256);
  assert.equal(prior.length, row.newBytes);
  assert.throws(() => readTimeSeriesUnitPredecessor(root, path, { ...row, datasetId: 'another' }, current), /outside the GSE157077/);
  assert.throws(() => readTimeSeriesUnitPredecessor(root, path, row, Buffer.concat([current, Buffer.from('changed')])), /successor bytes changed/);
  for (const name of [GSE157077_UNIT_SUCCESSOR, 'scripts/build_timeseries_bundles.mts',
    'data/quality/gse157077-timeseries-unit-2026-10-23/verification.json',
    'data/quality/gse157077-timeseries-unit-2026-10-23/verify.py']) {
    assert.throws(() => readTimeSeriesUnitPredecessor(root, path, row, current,
      file => file === resolve(root, name) ? Buffer.from('changed') : readFileSync(file)));
  }
});

test('the real finalized GSE135007 chain serves every intermediate and pre-regeneration product pin', () => {
  const current = JSON.parse(readFileSync(resolve(root, GSE135007_SERIALIZATION_SUCCESSOR), 'utf8'));
  const original = JSON.parse(readFileSync(resolve(root, SUPERSESSION_MANIFEST), 'utf8'));
  assert.equal(current.records.length, 7);
  for (const entry of current.records) {
    const row = original.records.find((record: any) => record.path === entry.path);
    assert.ok(row && row.datasetId === 'gse135007');
    assert.equal(sha(readFileSync(resolve(root, entry.path))), entry.newSha256);
    const intermediate = readSupersededInput(root, entry.path, entry.priorSha256);
    assert.equal(sha(intermediate), row.newSha256);
    assert.equal(intermediate.length, row.newBytes);
    const previous = readSupersededInput(root, entry.path, row.oldSha256);
    assert.equal(sha(previous), row.oldSha256);
    assert.equal(previous.length, row.oldBytes);
  }
});
