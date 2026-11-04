import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { gunzipSync } from 'node:zlib';

const ARCHIVES = 'data/quality/hfd-intake-2026-09-12/preserved-inputs';
// produce.py writes every job path as str(ROOT / path). The September 11 author
// comparisons pinned the manifest it wrote in this checkout.
const JOBS_MANIFEST = 'data/internal-qc/intake-numeric-2026-09-11/jobs.json';
const SEALED_JOBS_ROOT = 'D:\\Monkey Brain\\MONKEYBRAIN';
const JOB_PATH_FIELDS = ['source', 'sourceSheet', 'geneMap', 'input', 'expression', 'sheet', 'normalization', 'de', 'se'];
export const ADDITIVE_INTAKE = 'data/intake/oxt-avp-2026-10-19/studies.json';
// A manifest can authorize only these new source identities, never an old
// dataset or an unrelated accession declared under a new identifier.
const ADDITIVE_IDENTITIES: Record<string, [string, string]> = {
  GSE30733: ['rat_son_lactation_gse30733', 'geo_replication/datasets/GSE30733_rnor_son_lactation'],
  GSE65663: ['rat_son_salt_gse65663', 'geo_replication/datasets/GSE65663_rnor_son_salt'],
};
const ADDITIVE_CONTAINERS: Record<string, string> = {
  'data/internal-qc/assessments.generated.json': 'records',
  'data/quality/assessments.generated.json': 'records',
  'data/author-validation/validation-records.generated.json': 'records',
  'data/author-validation/direct-comparisons.generated.json': 'comparisons',
  'data/author-validation/mechanical-audit.generated.json': 'datasets',
  'data/author-validation/source-inventory.generated.json': 'datasets',
  'data/author-validation/fgsea-migration.generated.json': 'datasets',
};
function intakeChild(path: unknown, directory: string): asserts path is string {
  assert.ok(typeof path === 'string' && path.startsWith(`${directory}/`) && !path.includes('\\')
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..'), `Intake path outside its source dataset: ${path}`);
}

/** Bounded OXT/AVP source identities and the analysis IDs declared by their intake. */
export function readAdditiveIntake(root: string, read: (path: string) => Buffer = readFileSync): { datasetIds: Set<string>; configIds: Map<string, string> } {
  const target = resolve(root, ADDITIVE_INTAKE);
  if (!existsSync(target)) return { datasetIds: new Set(), configIds: new Map() };
  const studies = JSON.parse(read(target).toString('utf8'));
  assert.ok(Array.isArray(studies) && studies.length > 0 && studies.length <= Object.keys(ADDITIVE_IDENTITIES).length, 'Invalid additive intake studies');
  const datasetIds = new Set<string>(), configIds = new Map<string, string>();
  for (const study of studies) {
    assert.ok(study && typeof study === 'object' && !Array.isArray(study), 'Invalid additive intake study');
    // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn requires ES2022; the app's tests target ES2020.
    const binding = Object.prototype.hasOwnProperty.call(ADDITIVE_IDENTITIES, study.accession) ? ADDITIVE_IDENTITIES[study.accession] : undefined;
    assert.ok(binding, `Unreviewed additive intake accession: ${study.accession}`);
    const [identity, directory] = binding;
    assert.ok(study.id === identity && study.dir === directory && study.organism === 'Rattus norvegicus', `Additive intake source identity changed: ${study.accession}`);
    assert.ok(!datasetIds.has(identity), `Duplicate additive intake dataset: ${identity}`);
    datasetIds.add(identity);
    assert.ok(Array.isArray(study.tracks) && study.tracks.length > 0 && Array.isArray(study.contrasts) && study.contrasts.length > 0, 'Incomplete additive intake bindings');
    const contrastIds = study.contrasts.map((contrast: any) => contrast?.id);
    assert.ok(contrastIds.every((name: unknown) => typeof name === 'string' && /^[A-Za-z0-9_]+$/.test(name))
      && new Set(contrastIds).size === contrastIds.length, 'Invalid additive intake contrast IDs');
    const trackIds = new Set<string>();
    for (const track of study.tracks) {
      assert.ok(track && typeof track.id === 'string' && track.id && !trackIds.has(track.id), 'Invalid or duplicate additive intake track');
      trackIds.add(track.id);
      const analysis = track.analysisId;
      assert.ok(typeof analysis === 'string' && (analysis === study.accession || analysis.startsWith(`${study.accession}_`))
        && /^[A-Za-z0-9_]+$/.test(analysis), 'Analysis ID belongs to another source accession');
      for (const field of ['matrix', 'samplesheet']) intakeChild(track[field], directory);
      contrastIds.forEach((contrast: string, index: number) => {
        const id = index === 0 ? analysis : `${analysis}_${contrast}`;
        assert.ok(!configIds.has(id), `Duplicate additive intake analysis: ${id}`);
        configIds.set(id, directory.replace(/^geo_replication\//, ''));
      });
    }
  }
  return { datasetIds, configIds };
}
/** Pins whose current bytes are verified through readSealedHistoricalInput. */
export const HISTORICAL_PINS = new Set(['geo_replication/config/datasets.tsv', JOBS_MANIFEST]);
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const sortedKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(sortedKeys)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedKeys((value as any)[key])])) : value;
// Python json.dumps(sort_keys=True, indent=2) escapes every character after '~'.
const pythonJson = (value: unknown): string => `${JSON.stringify(sortedKeys(value), null, 2)
  .replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}\n`;

/** Move every job path from this checkout to the sealing checkout, in produce.py's canonical bytes. */
function sealedJobsManifest(root: string, current: Buffer): Buffer {
  const manifest = JSON.parse(current.toString('utf8'));
  assert.deepEqual(Object.keys(manifest), ['jobs'], 'Job manifest schema changed');
  for (const job of manifest.jobs) {
    for (const field of JOB_PATH_FIELDS) {
      const path = relative(root, job[field]);
      assert.ok(isAbsolute(job[field]) && path && !path.startsWith('..') && !isAbsolute(path), `Job path is outside the checkout: ${job[field]}`);
      job[field] = [SEALED_JOBS_ROOT, ...path.split(/[\\/]/)].join('\\');
    }
  }
  return Buffer.from(pythonJson(manifest), 'utf8');
}

/** Keep a historical review sealed while permitting new, separately audited rows. */
export function readSealedHistoricalInput(root: string, path: string, expectedSha256: string, read: (path: string) => Buffer = readFileSync): Buffer {
  const current = read(resolve(root, path));
  if (hash(current) === expectedSha256) return current;
  try {
    return readArchivedInput(root, path, expectedSha256, current, read);
  } catch (error) {
    if (!supersessionNames(root, path, { read })) throw error;
    try {
      return readSupersededPin(root, path, expectedSha256, current, read);
    } catch (fallback) {
      throw new assert.AssertionError({ message: `${(error as Error).message}; R 4.6.0 supersession: ${(fallback as Error).message}` });
    }
  }
}

function readArchivedInput(root: string, path: string, expectedSha256: string, current: Buffer, read: (path: string) => Buffer): Buffer {
  if (path === JOBS_MANIFEST) {
    // Only the checkout prefix of the job paths may differ from the pinned manifest.
    const sealed = sealedJobsManifest(root, current);
    assert.equal(hash(sealed), expectedSha256, `Historical job manifest changed: ${path}`);
    return sealed;
  }
  const manifest = JSON.parse(read(resolve(root, ARCHIVES, 'manifest.json')).toString('utf8'));
  const reference = manifest.records.find((row: any) => row.path === path && row.sha256 === expectedSha256);
  assert.ok(reference, `No sealed historical input for ${path}`);
  assert.equal(reference.archivePath, `${ARCHIVES}/${expectedSha256}.gz`);
  const original = gunzipSync(read(resolve(root, reference.archivePath)));
  assert.equal(hash(original), expectedSha256, `Historical evidence changed: ${path}`);
  assert.equal(original.length, reference.bytes);
  // Only explicit registry containers and their derived inventory fields can
  // grow. The reviewed policy, schema and interpretation remain unchanged.
  if (path === 'geo_replication/config/datasets.tsv') {
    const parse = (bytes: Buffer) => {
      const lines = bytes.toString('utf8').trimEnd().split(/\r?\n/), header = lines.shift()!;
      const width = header.split('\t').length;
      const records = lines.map(line => { assert.equal(line.split('\t').length, width, 'Malformed added configuration row'); return line; });
      const rows = new Map(records.map(line => [line.split('\t')[0], line]));
      assert.equal(rows.size, records.length, 'Duplicate configuration ID');
      return { header, rows };
    };
    const before = parse(original), after = parse(current);
    assert.equal(after.header, before.header, 'Configuration schema changed');
    for (const [id, row] of before.rows) assert.equal(after.rows.get(id), row, `Historical configuration changed: ${id}`);
    const intake = JSON.parse(read(resolve(root, 'data/intake/hfd-2026-09-12/studies.json')).toString('utf8'));
    const allowed = new Set(intake.flatMap((study: any) => study.tracks.map((track: any) => track.analysisId)));
    const additive = readAdditiveIntake(root, read);
    for (const id of after.rows.keys()) {
      assert(before.rows.has(id) || allowed.has(id) || additive.configIds.has(id), `Unreviewed added configuration: ${id}`);
      if (before.rows.has(id) || !additive.configIds.has(id)) continue;
      const cells = after.rows.get(id)!.split('\t');
      const row = Object.fromEntries(after.header.split('\t').map((key, index) => [key, cells[index]]));
      const directory = additive.configIds.get(id)!;
      assert.ok(row.dir === directory && row.organism === 'Rattus norvegicus' && row.input_kind === 'matrix', `Added configuration source binding changed: ${id}`);
      for (const field of ['input_path', 'samplesheet']) intakeChild(row[field], directory);
    }
    return original;
  }
  const before = JSON.parse(original.toString('utf8'));
  const after = JSON.parse(current.toString('utf8'));
  const container = before.records ? 'records' : 'comparisons';
  assert.ok(before[container] && after[container], `Preserved non-registry evidence changed: ${path}`);
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), `Historical document schema changed: ${path}`);
  const mutableByPath: Record<string, string[]> = {
    'data/internal-qc/assessments.generated.json': ['records', 'summary', 'inputs'],
    'data/author-validation/validation-records.generated.json': ['records', 'generatedAt', 'counts', 'scope'],
    'data/author-validation/direct-comparisons.generated.json': ['comparisons', 'generatedAt'],
  };
  const mutable = new Set(mutableByPath[path] ?? [container]);
  for (const key of Object.keys(before)) {
    if (!mutable.has(key)) assert.deepEqual(after[key], before[key], `Historical document semantics changed: ${path}/${key}`);
  }
  if (path === 'data/author-validation/validation-records.generated.json') {
    const staticScope = ({ registryDatasets: _registry, inScopeDatasets: _scope, ...rest }: any) => rest;
    assert.deepEqual(staticScope(after.scope), staticScope(before.scope), `Historical document semantics changed: ${path}/scope`);
    for (const key of ['registryDatasets', 'inScopeDatasets']) {
      assert(Number.isInteger(after.scope[key]) && after.scope[key] >= before.scope[key], `Historical registry scope shrank: ${path}/${key}`);
    }
  }
  const keyed = (records: any): Map<string, any> => {
    if (!Array.isArray(records)) return new Map(Object.entries(records));
    const rows = new Map(records.map((row: any) => [row.datasetId, row]));
    assert.equal(rows.size, records.length, `Duplicate dataset records in ${path}`);
    assert.ok([...rows.keys()].every((id) => typeof id === 'string' && id));
    return rows;
  };
  const oldRows = keyed(before[container]), newRows = keyed(after[container]);
  for (const [id, row] of oldRows) {
    assert.deepEqual(newRows.get(id), row, `Historical dataset evidence changed: ${path}/${id}`);
  }
  return original;
}

// R 4.6.0 regeneration. The manifest names every pinned output the regeneration
// replaced and archives the ledgers it rewrote; its own SHA-256 is pinned here.
// The same rules as read_superseded in scripts/historical_evidence.py.
export const SUPERSESSION_DIR = 'data/quality/regeneration-r460-2026-09-25';
export const SUPERSESSION_MANIFEST = `${SUPERSESSION_DIR}/supersession.json`;
// Written by `npx tsx scripts/regen-r460/build_supersession_manifest.mts --finalize`.
// null until the regenerated outputs are recorded: nothing is superseded.
export const SUPERSESSION_SHA256: string | null = '48b10701d44588a28c16a70645f727fb554e379f6583b4df74bfd1274a4ff93d';
const FULL_HISTORY = (why: string) => `Superseded bytes are read from the pre-regeneration commit, which this clone cannot provide (${why}). `
  + 'Fetch full history first: git fetch --unshallow --tags origin (a partial clone must be re-cloned without --filter).';
// Ledger keys that state a schema or policy. A regenerated ledger must keep them.
const PROTECTED_LEDGER_KEYS = new Set([
  'schemaVersion', 'policyVersion', 'policy', 'scope', 'coverage', 'purpose', 'method', 'script', 'version',
  'auditVersion', 'fingerprintConventions', 'fingerprintConvention', 'fingerprintScheme', 'thresholdDefinitions',
  'legacyInternalQc', 'datasetId', 'contrastId', 'baselineCommit', 'baselineDescription',
]);
// Inventory keys derived from the records; they follow the records they count.
const DERIVED_LEDGER_KEYS = new Set(['generatedAt', 'summary', 'counts', 'totals']);
// Successor evidence: a ledger rebuilt from successor evidence retires the replaced
// evidence in its path -> fingerprint inventory and names the successors. The pinned
// declaration lists the retired and added entries and the new fingerprint of every
// other changed entry outside the supersession manifest. Same rules as
// scripts/historical_evidence.py. Written by
// `npx tsx scripts/regen-r460/build_successor_inventory.mts --finalize`.
export const SUCCESSOR_INVENTORY = `${SUPERSESSION_DIR}/successor-inventory.json`;
export const SUCCESSOR_INVENTORY_SHA256: string | null = '16579bd001fcd6b545925fa08c8faec3593c016507ae39f828862e56ce9dae60';
// The supersession manifest the declaration belongs to; any other manifest (a test fixture) has none.
export const SUCCESSOR_INVENTORY_MANIFEST_SHA256: string | null = '48b10701d44588a28c16a70645f727fb554e379f6583b4df74bfd1274a4ff93d';
export interface SuccessorDeclaration { retired: string[]; added: string[]; updated: Record<string, string> }
export const crlfRendering = (bytes: Buffer): Buffer => Buffer.from(bytes.toString('latin1').replace(/\n/g, '\r\n'), 'latin1');

/** The recorded regenerated bytes, or a checkout's CRLF rendering of recorded LF bytes (text=auto on Windows). */
export function isRecordedRegeneration(current: Buffer, row: { newSha256: string; newBytes: number }): boolean {
  if (current.length === row.newBytes && hash(current) === row.newSha256) return true;
  const text = current.toString('latin1');
  if (!text.includes('\r\n')) return false;
  const lf = text.replace(/\r\n/g, '\n');
  return !lf.includes('\r') && lf.length === row.newBytes && hash(Buffer.from(lf, 'latin1')) === row.newSha256;
}

export const GSE135007_SERIALIZATION_SUCCESSOR = 'data/quality/gse135007-serialization-2026-10-23/successor.json';
// Finalized separately from the sealed September supersession manifest.
export const GSE135007_SERIALIZATION_SUCCESSOR_SHA256: string | null = '473ac2a97966c6fa1b5a3ebe666ea319d14f832fa9cb391b1e246498a8c0aa00';
export const GSE157077_UNIT_SUCCESSOR = 'data/quality/gse157077-timeseries-unit-2026-10-23/successor.json';
export const GSE157077_UNIT_SUCCESSOR_SHA256 = '2fe10aad8472df2a2e4f965a0173dd79326ecd1cbb460eefeb772bfabf1301f1';
interface SerializedPredecessorRow { datasetId?: string | null; newSha256: string; newBytes: number }
const serializationProductPath = (path: string): boolean => path.startsWith('geo_replication/datasets/GSE135007_discovery_20260905/')
  || path === 'public/datasets/gse135007/track_hypothalamus.js';

/**
 * Resolve the one explicitly pinned GSE135007 serialization successor back to
 * the intermediate R 4.6.0 bytes. This never rewrites the sealed manifest and
 * cannot authorize another dataset, an unpinned product, or a missing archive.
 */
export function readSerializedPredecessor(root: string, path: string, row: SerializedPredecessorRow,
  current: Buffer, read: (path: string) => Buffer = readFileSync,
  expectedSha: string | null = GSE135007_SERIALIZATION_SUCCESSOR_SHA256,
  predecessorSha: string | null = SUPERSESSION_SHA256): Buffer {
  assert.ok(expectedSha, 'GSE135007 serialization successor is not finalized');
  assert.ok(row.datasetId === 'gse135007'
    && serializationProductPath(path)
    && !path.includes('\\') && path.split('/').every(part => part && part !== '.' && part !== '..'),
  `Path is outside the GSE135007 serialization successor: ${path}`);
  const body = read(resolve(root, GSE135007_SERIALIZATION_SUCCESSOR));
  assert.equal(hash(body), expectedSha, 'GSE135007 serialization successor manifest changed');
  const doc = JSON.parse(body.toString('utf8'));
  assert.ok(doc.schemaVersion === 1 && doc.state === 'finalized' && doc.analysisId === 'GSE135007' && doc.datasetId === 'gse135007'
    && doc.predecessorManifest?.path === SUPERSESSION_MANIFEST && doc.predecessorManifest.sha256 === predecessorSha,
  'GSE135007 serialization successor identity or predecessor changed');
  const checkDependency = (pin: any, expectedPath: string) => {
    assert.ok(pin?.path === expectedPath && /^[a-f0-9]{64}$/.test(pin.sha256), 'Invalid GSE135007 successor dependency');
    const bytes = read(resolve(root, pin.path));
    assert.equal(hash(bytes), pin.sha256, `GSE135007 successor dependency changed: ${pin.path}`);
    return bytes;
  };
  checkDependency(doc.producer, 'scripts/regen-r460/run_gse135007_serialized_r460.R');
  const verification = JSON.parse(checkDependency(doc.verification,
    'data/quality/gse135007-serialization-2026-10-23/verification.json').toString('utf8'));
  assert.ok(verification.schemaVersion === 1 && verification.status === 'PASS' && verification.analysisId === 'GSE135007'
    && verification.canonicalSchema === 'hypo-counts-tsv17-v1'
    && verification.canonicalInput === 'geo_replication/datasets/GSE135007_discovery_20260905/processed/GSE135007_counts.tsv.gz'
    && /^[a-f0-9]{64}$/.test(verification.canonicalInputSha256)
    && verification.roundtrip?.exactValues === true && verification.roundtrip.nValues > 0 && verification.roundtrip.maxAbsoluteDelta === 0
    && verification.sourceMapping?.status === 'PASS' && verification.sourceMapping.authority === 'org.Mm.eg.db'
    && verification.sourceMapping.version === '3.23.0' && verification.sourceMapping.retainedMapIdentical === true
    && verification.separateProcessReplay?.status === 'PASS' && verification.separateProcessReplay.absoluteTolerance === 1e-6
    && verification.separateProcessReplay.relativeTolerance === 1e-6 && verification.separateProcessReplay.matchedRows > 0
    && verification.separateProcessReplay.modelMismatches === 0 && verification.separateProcessReplay.normalizationMismatches === 0,
  'GSE135007 serialization successor has no passing exact-input and separate-process model verification');
  assert.ok(Array.isArray(doc.records) && doc.records.length > 0
    && new Set(doc.records.map((item: any) => item.path)).size === doc.records.length,
  'Missing or duplicate GSE135007 successor products');
  for (const item of doc.records) {
    assert.ok(typeof item.path === 'string' && serializationProductPath(item.path)
      && !item.path.includes('\\') && item.path.split('/').every((part: string) => part && part !== '.' && part !== '..')
      && /^[a-f0-9]{64}$/.test(item.priorSha256) && /^[a-f0-9]{64}$/.test(item.newSha256)
      && Number.isSafeInteger(item.priorBytes) && item.priorBytes >= 0 && Number.isSafeInteger(item.newBytes) && item.newBytes >= 0
      && item.archivePath === `data/quality/gse135007-serialization-2026-10-23/preserved/${item.priorSha256}.gz`,
    'Invalid GSE135007 successor product binding');
  }
  const canonical = doc.records.find((entry: any) => entry.path === verification.canonicalInput && entry.newSha256 === verification.canonicalInputSha256);
  assert.ok(canonical,
    'Verified GSE135007 canonical input is not the declared successor product');
  assert.ok(isRecordedRegeneration(read(resolve(root, canonical.path)), { newSha256: canonical.newSha256, newBytes: canonical.newBytes }),
    'Current GSE135007 canonical input differs from the verified roundtrip input');
  const item = doc.records.find((entry: any) => entry.path === path);
  assert.ok(item && item.priorSha256 === row.newSha256 && item.priorBytes === row.newBytes,
    `GSE135007 successor does not start from the recorded regeneration: ${path}`);
  assert.ok(isRecordedRegeneration(current, { newSha256: item.newSha256, newBytes: item.newBytes }),
    `Current bytes are not the recorded GSE135007 serialization successor: ${path}`);
  const prior = gunzipSync(read(resolve(root, item.archivePath)));
  assert.ok(prior.length === item.priorBytes && hash(prior) === item.priorSha256,
    `Preserved GSE135007 intermediate bytes changed: ${path}`);
  return prior;
}

/** The fixed GSE157077 label correction changes no sample, gene, value or other metadata. */
export function readTimeSeriesUnitPredecessor(root: string, path: string, row: SerializedPredecessorRow,
  current: Buffer, read: (path: string) => Buffer = readFileSync): Buffer {
  assert.ok(row.datasetId === 'mouse_scn_hfd_gse157077' && path === 'public/datasets/mouse_scn_hfd_gse157077/timeseries_scn.js',
    'Path is outside the GSE157077 time-series unit successor');
  const body = read(resolve(root, GSE157077_UNIT_SUCCESSOR));
  assert.equal(hash(body), GSE157077_UNIT_SUCCESSOR_SHA256, 'GSE157077 unit successor manifest changed');
  const doc = JSON.parse(body.toString('utf8'));
  assert.ok(doc.schemaVersion === 1 && doc.state === 'finalized' && doc.datasetId === row.datasetId && doc.path === path
    && doc.predecessorManifest?.path === SUPERSESSION_MANIFEST && doc.predecessorManifest.sha256 === SUPERSESSION_SHA256
    && doc.priorSha256 === row.newSha256 && doc.priorBytes === row.newBytes
    && doc.field === 'meta.expressionUnit' && doc.oldValue === 'log2-normalized' && doc.newValue === 'log2(FPKM + 1)'
    && doc.archivePath === `data/quality/gse157077-timeseries-unit-2026-10-23/preserved/${doc.priorSha256}.gz`,
  'GSE157077 unit successor identity or predecessor changed');
  const pin = (reference: any, expectedPath: string): Buffer => {
    assert.ok(reference?.path === expectedPath && /^[a-f0-9]{64}$/.test(reference.sha256), 'Invalid GSE157077 unit dependency');
    const bytes = read(resolve(root, expectedPath));
    assert.equal(hash(bytes), reference.sha256, `GSE157077 unit dependency changed: ${expectedPath}`);
    return bytes;
  };
  pin(doc.producer, 'scripts/build_timeseries_bundles.mts');
  const verification = JSON.parse(pin(doc.verification,
    'data/quality/gse157077-timeseries-unit-2026-10-23/verification.json').toString('utf8'));
  assert.ok(verification.status === 'PASS' && verification.path === path && verification.priorSha256 === row.newSha256
    && verification.newSha256 === doc.newSha256 && verification.valuesIdentical === true && verification.geneOrderIdentical === true
    && verification.allOtherMetadataIdentical === true && verification.expressionEntries === 527184,
  'GSE157077 unit successor has no passing value/order verification');
  pin(verification.verifier, 'data/quality/gse157077-timeseries-unit-2026-10-23/verify.py');
  assert.ok(isRecordedRegeneration(current, { newSha256: doc.newSha256, newBytes: doc.newBytes }),
    'Current GSE157077 unit successor bytes changed');
  const prior = gunzipSync(read(resolve(root, doc.archivePath)));
  assert.ok(prior.length === row.newBytes && hash(prior) === row.newSha256, 'Preserved GSE157077 time-series bytes changed');
  const parse = (bytes: Buffer) => JSON.parse(bytes.toString('utf8').split(/=(.*)/s)[1].replace(/;\s*$/, ''));
  const before = parse(prior), after = parse(current);
  assert.ok(before.meta?.expressionUnit === doc.oldValue && after.meta?.expressionUnit === doc.newValue,
    'GSE157077 expression unit transition changed');
  before.meta.expressionUnit = doc.newValue;
  assert.deepEqual(after, before, 'GSE157077 unit successor changed data or other metadata');
  return prior;
}

function readCurrentSuccessorPredecessor(root: string, path: string, row: SerializedPredecessorRow, current: Buffer,
  read: (path: string) => Buffer): Buffer {
  return row.datasetId === 'mouse_scn_hfd_gse157077'
    ? readTimeSeriesUnitPredecessor(root, path, row, current, read)
    : readSerializedPredecessor(root, path, row, current, read);
}

/** A current recorded regeneration, including the two bounded verified successors. */
export function isRecordedCurrentOutput(root: string, path: string, current: Buffer, row: SerializedPredecessorRow,
  read: (path: string) => Buffer = readFileSync): boolean {
  if (isRecordedRegeneration(current, row)) return true;
  try { readCurrentSuccessorPredecessor(root, path, row, current, read); return true; } catch { return false; }
}

export interface SupersessionOptions {
  /** The pinned manifest SHA-256; defaults to SUPERSESSION_SHA256. */
  manifestSha?: string | null;
  /** Reads a file by absolute path; defaults to fs.readFileSync. */
  read?: (path: string) => Buffer;
  /** The current bytes of the file, when the caller already holds them. */
  current?: Buffer;
}
const pinnedSha = (options: SupersessionOptions) => (options.manifestSha === undefined ? SUPERSESSION_SHA256 : options.manifestSha);
const routeCache = new Map<string, Set<string>>();

/** Paths a pinned manifest names. Routing only: every read verifies the manifest and the bytes. */
export function supersededPaths(root: string, options: SupersessionOptions = {}): Set<string> {
  const target = resolve(root, SUPERSESSION_MANIFEST);
  if (!pinnedSha(options) || !existsSync(target)) return new Set();
  const stat = statSync(target);
  const key = `${target}|${stat.size}|${stat.mtimeMs}`;
  if (!routeCache.has(key)) {
    const document = JSON.parse((options.read ?? readFileSync)(target).toString('utf8'));
    routeCache.set(key, new Set([...(document.records ?? []), ...(document.ledgers ?? [])].map((row: any) => row.path)));
  }
  return routeCache.get(key)!;
}
export const supersessionNames = (root: string, path: string, options: SupersessionOptions = {}): boolean =>
  supersededPaths(root, options).has(path);

/** A path -> fingerprint map that retired evidence for declared successors. */
export function checkSuccessorInventory(where: string, old: Record<string, unknown>, now: Record<string, unknown>, paths: Set<string>, declared: SuccessorDeclaration): void {
  const retired = new Set(declared.retired), added = new Set(declared.added);
  assert.ok([...retired].every((name) => name in old) && ![...added].some((name) => name in old), `Successor inventory does not match the archived ledger: ${where}`);
  const expected = [...Object.keys(old).filter((name) => !retired.has(name)), ...added].sort();
  assert.ok(isDeepStrictEqual(Object.keys(now).sort(), expected), `Regenerated ledger inventory differs from its successor declaration: ${where}`);
  for (const name of Object.keys(old)) {
    if (!(name in now) || isDeepStrictEqual(old[name], now[name]) || paths.has(name)) continue;
    assert.equal(declared.updated[name], now[name], `Regenerated ledger changed outside the regeneration and its successor declaration: ${where}: ${name}`);
  }
}

/**
 * Reject any ledger difference other than regenerated datasets' records and their derived inventory.
 * `successors` maps an inventory key of this ledger to its pinned successor declaration.
 */
export function checkLedgerTransition(path: string, before: any, after: any, datasetIds: Set<string>, paths: Set<string>, successors?: Record<string, SuccessorDeclaration>, additiveIds: Set<string> = new Set()): void {
  const isObject = (value: unknown) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  assert.ok(isObject(before) && isObject(after), `Ledger is not a JSON object: ${path}`);
  assert.ok(isDeepStrictEqual(Object.keys(after).sort(), Object.keys(before).sort()), `Regenerated ledger schema changed: ${path}`);
  const boundedIds = new Set(Object.values(ADDITIVE_IDENTITIES).map(([id]) => id));
  assert.ok([...additiveIds].every(id => boundedIds.has(id)), 'Unreviewed additive ledger identities');
  const container = ADDITIVE_CONTAINERS[path];
  let addedCount = 0;
  let newRows: any[] = [];
  if (additiveIds.size && container && Array.isArray(before[container]) && Array.isArray(after[container])) {
    const oldRows = before[container] as any[];
    newRows = after[container];
    const oldIds = oldRows.map(row => row?.datasetId), newIds = newRows.map(row => row?.datasetId);
    assert.ok([...oldIds, ...newIds].every(id => typeof id === 'string' && id), `Invalid dataset identity: ${path}/${container}`);
    assert.ok(new Set(oldIds).size === oldIds.length && new Set(newIds).size === newIds.length, `Duplicate dataset records: ${path}/${container}`);
    const oldSet = new Set(oldIds), additions = new Set(newIds.filter(id => !oldSet.has(id)));
    assert.ok([...additions].every(id => additiveIds.has(id)), `Unreviewed added ledger dataset: ${path}/${container}`);
    assert.deepEqual(newIds.filter(id => !additions.has(id)), oldIds, `Historical ledger dataset removed or reordered: ${path}/${container}`);
    addedCount = additions.size;
    after = { ...after, [container]: newRows.filter(row => !additions.has(row.datasetId)) };
  }
  if (addedCount) {
    // Only corpus counts may change inside the protected validation scope.
    // Scientific units and exclusions remain exact, and the count increment
    // must equal the declared dataset rows actually added to this ledger.
    if (path === 'data/author-validation/validation-records.generated.json') {
      const oldScope = before.scope, newScope = after.scope;
      assert.ok(isObject(oldScope) && isObject(newScope)
        && isDeepStrictEqual(Object.keys(oldScope).sort(), Object.keys(newScope).sort()), 'Additive validation scope schema changed');
      for (const key of Object.keys(oldScope)) {
        const expected = ['registryDatasets', 'inScopeDatasets'].includes(key) ? oldScope[key] + addedCount : oldScope[key];
        assert.deepEqual(newScope[key], expected, `Additive validation scope changed: ${key}`);
      }
      after = { ...after, scope: oldScope };
    }
    if (path === 'data/author-validation/mechanical-audit.generated.json') {
      assert.equal(after.datasetCount, before.datasetCount + addedCount, 'Additive mechanical dataset count changed');
      const count = (rows: any[]) => rows.reduce((sum, row) => sum + (row.contrasts?.length ?? 0), 0);
      assert.equal(after.contrastCount, before.contrastCount + count(newRows) - count(before[container]), 'Additive mechanical contrast count changed');
      after = { ...after, datasetCount: before.datasetCount, contrastCount: before.contrastCount };
    }
  }
  const single = typeof before.datasetId === 'string' ? before.datasetId : null;
  for (const key of Object.keys(before)) {
    const old = before[key], now = after[key];
    if (isDeepStrictEqual(old, now)) continue;
    const where = `${path}/${key}`;
    assert.ok(!PROTECTED_LEDGER_KEYS.has(key) && !key.endsWith('Policy'), `Regenerated ledger semantics changed: ${where}`);
    if (DERIVED_LEDGER_KEYS.has(key)) continue;
    if (single !== null) {
      // A single-dataset document: every non-policy field belongs to that dataset.
      assert.ok(datasetIds.has(single), `Regenerated ledger belongs to a dataset outside the regeneration: ${where}`);
      continue;
    }
    if (isObject(old) && isObject(now) && Object.keys(old).length && Object.keys(old).every((name) => name.includes('/'))) {
      if (successors?.[key]) {
        checkSuccessorInventory(where, old, now, paths, successors[key]);
        continue;
      }
      // A path -> fingerprint map: only regenerated outputs and archived ledgers may change.
      assert.ok(isDeepStrictEqual(Object.keys(now).sort(), Object.keys(old).sort()), `Regenerated ledger inventory changed: ${where}`);
      const changed = Object.keys(old).filter((name) => !isDeepStrictEqual(old[name], now[name]) && !paths.has(name));
      assert.equal(changed.length, 0, `Regenerated ledger changed outside the regeneration: ${where}: ${changed.slice(0, 3).join(', ')}`);
      continue;
    }
    let pairs: [any, any][];
    if (Array.isArray(old) && Array.isArray(now)) {
      assert.equal(now.length, old.length, `Regenerated ledger record count changed: ${where}`);
      pairs = old.map((row, index) => [row, now[index]]);
    } else if (isObject(old) && isObject(now)) {
      assert.ok(isDeepStrictEqual(Object.keys(now).sort(), Object.keys(old).sort()), `Regenerated ledger record set changed: ${where}`);
      const tag = (name: string, row: any) => (isObject(row) ? { datasetId: name, ...row } : row);
      pairs = Object.keys(old).map((name) => [tag(name, old[name]), tag(name, now[name])]);
    } else {
      assert.fail(`Regenerated ledger changed outside the regeneration: ${where}`);
    }
    for (const [a, b] of pairs) {
      if (isDeepStrictEqual(a, b)) continue;
      assert.ok(isObject(a) && isObject(b) && a.datasetId === b.datasetId, `Regenerated ledger record identity changed: ${where}`);
      assert.ok(datasetIds.has(a.datasetId), `Regenerated ledger changed a dataset outside the regeneration: ${where}/${a.datasetId}`);
    }
  }
}

/** The pinned successor declaration, by ledger path; empty until one is finalized. */
export function loadSuccessorInventory(root: string, manifestSha: string, read: (path: string) => Buffer = readFileSync,
  declarationSha: string | null = SUCCESSOR_INVENTORY_SHA256): Record<string, Record<string, SuccessorDeclaration>> {
  if (!declarationSha || (declarationSha === SUCCESSOR_INVENTORY_SHA256 && manifestSha !== SUCCESSOR_INVENTORY_MANIFEST_SHA256)) return {};
  const body = read(resolve(root, SUCCESSOR_INVENTORY));
  assert.equal(hash(body), declarationSha, `Successor inventory declaration changed: ${SUCCESSOR_INVENTORY}`);
  const document = JSON.parse(body.toString('utf8'));
  assert.ok(document.schemaVersion === 1 && document.supersessionSha256 === manifestSha, 'Successor inventory declaration belongs to another supersession manifest');
  return document.ledgers;
}

/** A verified supersession manifest and the pre-regeneration git objects it names. */
export class Supersession {
  readonly root: string;
  private readonly read: (path: string) => Buffer;
  readonly commit: string;
  readonly tag: string;
  readonly records: Map<string, any>;
  readonly ledgers: Map<string, any>;
  readonly datasetIds: Set<string>;
  readonly paths: Set<string>;
  private historyChecked = false;

  constructor(root: string, manifestSha: string | null, read: (path: string) => Buffer = readFileSync) {
    this.root = root;
    this.read = read;
    assert.ok(manifestSha, 'The R 4.6.0 supersession manifest is not finalized; SUPERSESSION_SHA256 is unset');
    const body = read(resolve(root, SUPERSESSION_MANIFEST));
    assert.equal(hash(body), manifestSha, `Supersession manifest changed: ${SUPERSESSION_MANIFEST}`);
    const manifest = JSON.parse(body.toString('utf8'));
    assert.ok(manifest.schemaVersion === 1 && manifest.state === 'finalized', 'Supersession manifest is not finalized');
    this.commit = manifest.preSwapCommit;
    this.tag = manifest.tag;
    this.records = new Map(manifest.records.map((row: any) => [row.path, row]));
    this.ledgers = new Map(manifest.ledgers.map((row: any) => [row.path, row]));
    assert.ok(this.records.size === manifest.records.length && this.ledgers.size === manifest.ledgers.length, 'Duplicate supersession path');
    this.datasetIds = new Set(manifest.records.map((row: any) => row.datasetId).filter(Boolean));
    this.paths = new Set([...this.records.keys(), ...this.ledgers.keys()]);
    this.successors = loadSuccessorInventory(root, manifestSha, read);
  }
  readonly successors: Record<string, Record<string, SuccessorDeclaration>>;

  private git(args: string[], input?: string) {
    return spawnSync('git', ['-C', this.root, ...args], { input, maxBuffer: 2 ** 31 - 1, env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } });
  }

  private checkHistory(): void {
    if (this.historyChecked) return;
    const shallow = this.git(['rev-parse', '--is-shallow-repository']);
    assert.equal(shallow.status, 0, FULL_HISTORY('not a git checkout'));
    assert.notEqual(shallow.stdout.toString().trim(), 'true', FULL_HISTORY('shallow clone'));
    assert.notEqual(this.git(['config', '--get', 'extensions.partialClone']).status, 0, FULL_HISTORY('partial clone'));
    assert.equal(this.git(['cat-file', '-e', `${this.commit}^{commit}`]).status, 0, FULL_HISTORY(`commit ${this.commit} is missing`));
    const tag = this.git(['rev-parse', '-q', '--verify', `refs/tags/${this.tag}^{commit}`]);
    if (tag.status === 0) assert.equal(tag.stdout.toString().trim(), this.commit, `Tag ${this.tag} does not name ${this.commit}`);
    this.historyChecked = true;
  }

  /** The committed pre-regeneration bytes of a superseded output. */
  oldBytes(path: string): Buffer {
    const row = this.records.get(path);
    this.checkHistory();
    const out = this.git(['cat-file', '--batch'], `${this.commit}:${path}\n`).stdout;
    const newline = out.indexOf(10);
    const [oid, kind, size] = out.subarray(0, newline).toString('utf8').split(' ');
    assert.ok(kind === 'blob' && size !== undefined, FULL_HISTORY(`${this.commit}:${path} is missing`));
    const data = out.subarray(newline + 1, newline + 1 + Number(size));
    assert.equal(oid, row.oldGitBlob, `Superseded blob is not the recorded one: ${path}`);
    assert.ok(data.length === row.oldBytes && hash(data) === row.oldSha256, `Superseded bytes changed: ${path}`);
    return Buffer.from(data);
  }

  readOutput(path: string, pin: string, current?: Buffer): Buffer {
    const row = this.records.get(path);
    assert.ok(row, `Not superseded by the R 4.6.0 regeneration: ${path}`);
    assert.ok(row.newSha256, `The R 4.6.0 regeneration removed ${path}`);
    const bytes = current ?? this.read(resolve(this.root, path));
    let intermediate: Buffer | null = null;
    if (!isRecordedRegeneration(bytes, row)) {
      try {
        intermediate = readCurrentSuccessorPredecessor(this.root, path, row, bytes, this.read);
      } catch (error) {
        throw new assert.AssertionError({ message: `Current bytes are not the recorded R 4.6.0 regeneration: ${path}; ${(error as Error).message}` });
      }
    }
    if (intermediate) {
      if (pin === row.newSha256) return intermediate;
      if (!intermediate.includes(13) && hash(crlfRendering(intermediate)) === pin) return crlfRendering(intermediate);
    }
    const old = this.oldBytes(path);
    if (pin === row.oldSha256) return old;
    if (!old.includes(13) && hash(crlfRendering(old)) === pin) return crlfRendering(old);
    assert.fail(`Pin is not the superseded bytes of ${path}`);
  }

  /** The pin served to a producer that reads a superseded output without naming one. */
  servedPin(path: string): string {
    const row = this.records.get(path);
    return row.oldPinForm === 'crlf' ? hash(crlfRendering(this.oldBytes(path))) : row.oldSha256;
  }

  /** The archived pre-regeneration ledger, once the current one differs only for regenerated datasets. */
  ledger(path: string, current?: Buffer): Buffer {
    const row = this.ledgers.get(path);
    assert.ok(row, `Ledger is not archived for the R 4.6.0 regeneration: ${path}`);
    assert.equal(row.archivePath, `${SUPERSESSION_DIR}/preserved-inputs/${row.sha256}.json.gz`, path);
    const before = gunzipSync(this.read(resolve(this.root, row.archivePath)));
    assert.ok(hash(before) === row.sha256 && before.length === row.bytes, `Archived ledger changed: ${path}`);
    const bytes = current ?? this.read(resolve(this.root, path));
    checkLedgerTransition(path, JSON.parse(before.toString('utf8')), JSON.parse(bytes.toString('utf8')), this.datasetIds, this.paths, this.successors[path], readAdditiveIntake(this.root, this.read).datasetIds);
    return before;
  }
}

const supersessionCache = new Map<string, Supersession>();
/** The verified manifest for `root`, loaded once per manifest state. */
export function supersession(root: string, options: SupersessionOptions = {}): Supersession {
  const expected = pinnedSha(options);
  const target = resolve(root, SUPERSESSION_MANIFEST);
  const stat = existsSync(target) ? statSync(target) : null;
  const key = `${resolve(root)}|${expected}|${stat?.size}|${stat?.mtimeMs}`;
  if (!supersessionCache.has(key)) supersessionCache.set(key, new Supersession(resolve(root), expected, options.read));
  return supersessionCache.get(key)!;
}

/**
 * The pinned pre-regeneration bytes of an output the R 4.6.0 regeneration replaced.
 * Served only when the current bytes are the recorded regeneration, the pin is the
 * recorded old bytes (exact or CRLF rendering), the pre-regeneration git blob hashes
 * to them, and the manifest itself is the pinned one.
 */
export function readSupersededInput(root: string, path: string, pin: string, options: SupersessionOptions = {}): Buffer {
  return supersession(root, options).readOutput(path, pin, options.current);
}

/** The pre-regeneration bytes of a ledger the regeneration rewrote, after the rewrite is verified. */
export function readSupersededLedger(root: string, path: string, options: SupersessionOptions = {}): Buffer {
  return supersession(root, options).ledger(path, options.current);
}

function readSupersededPin(root: string, path: string, pin: string, current: Buffer, read: (path: string) => Buffer): Buffer {
  const state = supersession(root, { read });
  if (state.records.has(path)) return state.readOutput(path, pin, current);
  const before = state.ledger(path, current);
  if (hash(before) === pin) return before;
  if (!before.includes(13) && hash(crlfRendering(before)) === pin) return crlfRendering(before);
  // Older pins resolve against the pre-regeneration ledger exactly as they did before the regeneration.
  return readArchivedInput(root, path, pin, before, read);
}
