/**
 * Successor source-relationship audit for the R 4.6.0 regeneration.
 *
 *   npx tsx scripts/audit_source_relationship_r460.mts [--check]
 *
 * Six datasets had a passing source-to-input relationship whose sealed reader
 * pins a file the regeneration replaced: four re-prepared count inputs (rule B1,
 * unrounded) and the DE tables of the two dedicated studies. The sealed readers
 * and their evidence stay byte-identical. For each dataset this audit
 *
 * 1. runs the sealed reader exactly as scripts/build_internal_qc.mts calls it,
 *    through the supersession projection of scripts/run_sealed_ts_check.mts: the
 *    replaced files are read as their verified pre-regeneration bytes and every
 *    other file, including the authenticated deposited sources, is read as it is.
 *    A pass re-establishes the authenticated source and the September relationship.
 * 2. links each replaced file the reader read to R 4.6.0 evidence that describes
 *    the current bytes and starts from the same authenticated source:
 *    - the registered input: its bytes are the re-prepared input recorded in
 *      r460-inputs.json, and the R 4.6.0 count conservation
 *      (data/internal-qc/conservation-r460-2026-09-25) reproduces every
 *      registered count from a deposited source the sealed reader authenticated;
 *    - a dedicated DE table: the R 4.6.0 dedicated replay
 *      (data/internal-qc/advancement-r460-2026-09-25/dedicated-evidence.json)
 *      pins it, is current, passes every contrast and consumes only deposited
 *      matrices the sealed reader authenticated.
 *    - a file rewritten with LF endings only (producers now write LF): its
 *      current bytes equal the verified pre-swap blob after CRLF-to-LF
 *      normalization, so its content is unchanged.
 *    Any other replaced file leaves the dataset not assessed.
 *
 * The evidence pins every file it relied on; scripts/lib/sourceRelationshipR460.mts
 * reads it for scripts/build_internal_qc_r460.mts. Rerun after the supersession manifest,
 * a re-prepared input, the conservation or the dedicated evidence changes.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { SUPERSESSION_SHA256, supersession } from './lib/historicalEvidence.mjs';
import { measureMatrix, parseTsv, type EvidenceRow } from './lib/internalQc.mjs';
import { CONSERVATION_R460_EVIDENCE, createR460ConservationReader } from './lib/countConservationR460.mjs';
import { R460_DEDICATED } from './lib/internalQcR460.mjs';
import {
  SOURCE_RELATIONSHIP_R460, SOURCE_RELATIONSHIP_R460_READER, SOURCE_RELATIONSHIP_R460_SCRIPT, SOURCE_RELATIONSHIP_R460_VERSION,
  evidencePin, sourceRelationshipAvailability, type EvidencePin, type SourceRelationshipDocument, type SourceRelationshipRecord, type SuccessorLink,
} from './lib/sourceRelationshipR460.mjs';
import { projectSuperseded } from './run_sealed_ts_check.mjs';
import { createSourceInputRelationshipReader } from '../data/internal-qc/source-authenticity-2026-09-05/round4/sourceInputRelationship.mjs';
import { createRound5SourceInputRelationshipReader } from '../data/internal-qc/source-authenticity-2026-09-05/round5/sourceInputRelationship.mjs';
import { createSourceRecoveryReader } from '../data/internal-qc/source-recovery-2026-09-11/sourceRecovery.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const R460_INPUTS = 'data/quality/regeneration-r460-2026-09-25/r460-inputs.json';
const READERS = {
  round4: { module: 'data/internal-qc/source-authenticity-2026-09-05/round4/sourceInputRelationship.mts', create: createSourceInputRelationshipReader },
  round5: { module: 'data/internal-qc/source-authenticity-2026-09-05/round5/sourceInputRelationship.mts', create: createRound5SourceInputRelationshipReader },
  recovery: { module: 'data/internal-qc/source-recovery-2026-09-11/sourceRecovery.mts', create: createSourceRecoveryReader },
} as const;
/** The datasets and the sealed reader scripts/build_internal_qc.mts routes each to. */
const SCOPE: { datasetId: string; accession: string; reader: keyof typeof READERS }[] = [
  { datasetId: 'mouse_hypo_hfhs_gse235479', accession: 'GSE235479', reader: 'round4' },
  { datasetId: 'mouse_pomc_maternal_hfd_gse135639', accession: 'GSE135639', reader: 'round4' },
  { datasetId: 'mouse_scn_hfd_gse157077', accession: 'GSE157077', reader: 'round4' },
  { datasetId: 'mouse_hypo_treg_gse282067', accession: 'GSE282067', reader: 'round5' },
  { datasetId: 'mouse_hypo_pel_gse229838', accession: 'GSE229838', reader: 'round5' },
  { datasetId: 'mouse_hypo_hfd_emtab6929', accession: 'E-MTAB-6929', reader: 'recovery' },
];

const posix = (path: string): string => relative(ROOT, resolve(ROOT, path)).replaceAll('\\', '/');
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const text = (path: string): string => {
  const bytes = readFileSync(resolve(ROOT, path));
  return (path.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8');
};
const json = <T,>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T;

const regeneration = supersession(ROOT);
const configs = parseTsv(text('geo_replication/config/datasets.tsv'));
const bindings = json<{ datasets: { datasetId: string; configId: string | null }[] }>('data/author-validation/mechanical-audit.generated.json').datasets;
const inputs = json<{ inputs: { storedPath: string; sha256: string; bytes: number }[] }>(R460_INPUTS).inputs;
const conservation = json<{ records: { datasetId: string; specification?: { source: string } }[] }>(CONSERVATION_R460_EVIDENCE);
const dedicated = json<{ script: string; records: { datasetId: string; producer: string; fingerprints: Record<string, string>; replayFile: string; replaySha256: string;
  contrasts: Record<string, { status: string; existingRows: number; matchedRows: number }> }[] }>(R460_DEDICATED);

/** 1. The sealed reader against the pre-regeneration bytes of the files it pins. */
function historical(scope: typeof SCOPE[number], inputPath: string | null) {
  const served = new Set<string>(), touched = new Set<string>();
  const restore = projectSuperseded(ROOT, undefined, (name) => served.add(name));
  try {
    const reader = READERS[scope.reader].create(ROOT, { fingerprint: (path: string) => {
      touched.add(posix(path));
      return digest(readFileSync(path));
    } });
    const result = reader.evaluate({ datasetId: scope.datasetId, currentInputPath: inputPath });
    for (const path of result.evidence) touched.add(posix(path));
    return { result, served: [...served].sort(), touched };
  } finally {
    restore();
  }
}

/** 2. R 4.6.0 evidence for one replaced file, starting from a source the sealed reader authenticated. */
function successor(scope: typeof SCOPE[number], name: string, config: EvidenceRow | undefined, authenticated: Set<string>, pins: Set<string>): SuccessorLink {
  const row = regeneration.records.get(name);
  const link = (successorKind: SuccessorLink['successor'], successorEvidence: string | null, status: SuccessorLink['status'], note: string): SuccessorLink => ({
    path: name, oldSha256: row?.oldSha256 ?? '', newSha256: row?.newSha256 ?? '', successor: successorKind, successorEvidence, status, note,
  });
  try {
    assert.ok(row, 'not an output record of the supersession manifest');
    // Proves the current bytes are the recorded regeneration and the pre-swap blob the recorded one.
    regeneration.readOutput(name, regeneration.servedPin(name));
  } catch (error) {
    return link('none', null, 'not_assessed', `The replaced file is not verified as the recorded regeneration: ${error instanceof Error ? error.message : String(error)}`);
  }
  pins.add(name);
  // A file the regeneration rewrote with LF endings only: its content is the pre-swap blob's.
  const before = regeneration.oldBytes(name), now = readFileSync(resolve(ROOT, name));
  if (before.includes(13) && !now.includes(13) && Buffer.from(before.toString('latin1').replaceAll('\r\n', '\n'), 'latin1').equals(now)) {
    return link('line_endings_only', null, 'pass', `${name.split('/').pop()} was rewritten with LF line endings only; its bytes equal the pre-regeneration blob after CRLF-to-LF normalization.`);
  }
  if (config && name === `geo_replication/${config.input_path}`) {
    const stored = inputs.filter((entry) => entry.storedPath === name);
    const bytes = readFileSync(resolve(ROOT, name));
    if (stored.length !== 1 || digest(bytes) !== stored[0].sha256 || bytes.length !== stored[0].bytes) {
      return link('none', null, 'not_assessed', 'The registered input is not the re-prepared input recorded in r460-inputs.json.');
    }
    pins.add(R460_INPUTS);
    const record = conservation.records.find((entry) => entry.datasetId === scope.datasetId);
    const source = record?.specification?.source;
    if (!source || !authenticated.has(source)) {
      return link('r460_count_conservation', CONSERVATION_R460_EVIDENCE, 'not_assessed', `The R 4.6.0 count conservation does not start from a deposited source the sealed reader authenticated${source ? ` (${source})` : ''}.`);
    }
    const sheet = parseTsv(text(`geo_replication/${config.samplesheet}`)).filter((entry) => entry.group === 'control' || entry.group === 'case');
    const matrix = measureMatrix(text(name), sheet.map((entry) => entry.sample));
    const check = createR460ConservationReader(ROOT).evaluate({ datasetId: scope.datasetId, config, currentInputPath: name, matrix });
    for (const path of [CONSERVATION_R460_EVIDENCE, `geo_replication/${config.samplesheet}`, 'geo_replication/config/datasets.tsv', ...(check.evidence ?? [])]) pins.add(posix(path));
    return link('r460_count_conservation', CONSERVATION_R460_EVIDENCE, check.status === 'pass' ? 'pass' : 'not_assessed',
      `Re-prepared under rule B1 (count estimates unrounded) and recorded in r460-inputs.json. ${check.status === 'pass' ? `R 4.6.0 count conservation from the authenticated ${source.split('/').pop()}: ${check.note}` : check.note}`);
  }
  const replay = dedicated.records.find((entry) => entry.datasetId === scope.datasetId);
  if (replay && Object.hasOwn(replay.fingerprints, name)) {
    const stale = Object.entries(replay.fingerprints).filter(([path, expected]) => !existsSync(resolve(ROOT, path)) || digest(readFileSync(resolve(ROOT, path))) !== expected).map(([path]) => path);
    const replayCurrent = existsSync(resolve(ROOT, replay.replayFile)) && digest(readFileSync(resolve(ROOT, replay.replayFile))) === replay.replaySha256;
    const sources = Object.keys(replay.fingerprints).filter((path) => path.includes('/raw/'));
    const contrasts = Object.values(replay.contrasts);
    for (const path of [R460_DEDICATED, replay.replayFile, ...Object.keys(replay.fingerprints)]) pins.add(path);
    if (stale.length || !replayCurrent) return link('r460_dedicated_replay', R460_DEDICATED, 'not_assessed', `The R 4.6.0 dedicated replay is stale: ${[...stale, ...(replayCurrent ? [] : [replay.replayFile])].join(', ')}.`);
    if (!sources.length || sources.some((path) => !authenticated.has(path))) {
      return link('r460_dedicated_replay', R460_DEDICATED, 'not_assessed', 'The R 4.6.0 dedicated replay consumes a deposited matrix the sealed reader did not authenticate.');
    }
    const pass = contrasts.length > 0 && contrasts.every((entry) => entry.status === 'pass' && entry.existingRows > 0 && entry.matchedRows === entry.existingRows);
    return link('r460_dedicated_replay', R460_DEDICATED, pass ? 'pass' : 'not_assessed', pass
      ? `Regenerated by ${replay.producer}; the independent R 4.6.0 replay from the same ${sources.length} authenticated deposited ${sources.length === 1 ? 'matrix' : 'matrices'} reproduces every published row of all ${contrasts.length} ${contrasts.length === 1 ? 'contrast' : 'contrasts'}.`
      : 'The R 4.6.0 dedicated replay does not reproduce every published row.');
  }
  return link('none', null, 'not_assessed', 'No R 4.6.0 successor evidence describes this replaced file.');
}

const records: SourceRelationshipRecord[] = SCOPE.map((scope) => {
  const configId = bindings.find((entry) => entry.datasetId === scope.datasetId)?.configId ?? null;
  const config = configId ? configs.find((row) => row.id === configId) : undefined;
  assert.ok(!configId || config, `${scope.datasetId}: configuration ${configId} is not registered`);
  const inputPath = config ? `geo_replication/${config.input_path}` : null;
  const { result, served, touched } = historical(scope, inputPath);
  const availability = sourceRelationshipAvailability(ROOT, result, served, touched);
  const authenticated = new Set(availability.authenticated.filter((path) => !served.includes(path)));
  const pins = new Set<string>([...availability.available.filter((path) => !served.includes(path)), READERS[scope.reader].module]);
  const superseded = served.map((name) => successor(scope, name, config, authenticated, pins));
  const historicalPass = availability.historicalPass;
  const status: SourceRelationshipRecord['status'] = result.status === 'fail' ? 'fail'
    : historicalPass && superseded.every((link) => link.status === 'pass') ? 'pass' : 'not_assessed';
  const replaced = superseded.map((link) => link.path.split('/').pop()).join(', ');
  const note = status === 'pass'
    ? `${result.note} This sealed relationship was re-verified against the pre-regeneration bytes of the ${superseded.length === 1 ? 'file' : 'files'} the R 4.6.0 regeneration replaced (${replaced}); every other pinned file, including the authenticated deposited sources, is current. ${superseded.map((link) => link.note).join(' ')}`
    : historicalPass
      ? `The sealed source relationship holds for the pre-regeneration bytes, but a replaced file has no passing R 4.6.0 successor. ${superseded.filter((link) => link.status !== 'pass').map((link) => `${link.path}: ${link.note}`).join(' ')}`
      : `The sealed source relationship does not hold even for the pre-regeneration bytes: ${result.note}`;
  return {
    datasetId: scope.datasetId, accession: scope.accession, configId, inputPath, sealedReader: READERS[scope.reader].module,
    historical: { status: result.status, sourceAuthentication: result.sourceAuthentication, derivedInputRelationship: result.derivedInputRelationship, note: result.note },
    superseded, status, note, unavailable: availability.unavailable,
    pins: [...pins].sort().map((path) => evidencePin(path, readFileSync(resolve(ROOT, path)))),
  };
});

const pin = (path: string): EvidencePin => evidencePin(path, readFileSync(resolve(ROOT, path)));
const document: SourceRelationshipDocument = {
  schemaVersion: 1, version: SOURCE_RELATIONSHIP_R460_VERSION,
  record: 'Source integrity for datasets whose sealed source-relationship reader pins a file the R 4.6.0 regeneration replaced. '
    + 'Each sealed reader is re-run against the verified pre-regeneration bytes of the replaced files (supersession manifest) with every other file current, '
    + 'and each replaced file is linked to R 4.6.0 evidence that starts from a source the sealed reader authenticated. Pins use the stated scheme. '
    + 'Written by scripts/audit_source_relationship_r460.mts; read by scripts/lib/sourceRelationshipR460.mts.',
  script: pin(SOURCE_RELATIONSHIP_R460_SCRIPT), reader: pin(SOURCE_RELATIONSHIP_R460_READER), supersessionSha256: SUPERSESSION_SHA256, records,
};
const body = `${JSON.stringify(document, null, 2)}\n`;
if (CHECK) {
  assert.equal(readFileSync(resolve(ROOT, SOURCE_RELATIONSHIP_R460), 'utf8').replace(/\r\n/g, '\n'), body, 'R 4.6.0 source-relationship evidence is stale; rerun scripts/audit_source_relationship_r460.mts.');
} else {
  writeFileSync(resolve(ROOT, SOURCE_RELATIONSHIP_R460), body);
}
for (const record of records) console.log(`${record.accession}: ${record.status}; ${record.superseded.map((link) => `${link.path.split('/').pop()} -> ${link.successor} ${link.status}`).join('; ')}`);
