/** Read-only scientific audit; only the derived QC ledger is written without --check. */
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { DATASETS } from '../src/data/datasets';
import type { Dataset, GeneDERecord, RawTrack } from '../src/types';
import { aggregateQualityChecks, type QualityAssessment, type QualityCheck, type QualityStatus } from '../src/data/qualityChecks';
import { roundProb } from './lib/bundleSlim.mjs';
import { normalizeGene } from './lib/geneSymbol.mjs';
import {
  INTERNAL_QC_POLICY, assessment, countConservationSampleStatus, manifestRowForFile, matrixValueCheck, measureMatrix, modelCheck,
  normalizationSampleStatus, numeric, parseTsv, qualityCheck, replicationCheck, replayArtifactMatches, replayIsCurrent, sourceHashMatches, type EvidenceRow, type MatrixMeasurement, type NormalizationReplay,
} from './lib/internalQc.mjs';
import { aggregateMacaqueTracks, atlasFingerprint, macaqueEvidenceCurrent, parseMacaqueBundle, type MacaqueTrackAudit } from './lib/macaqueQc.mjs';
import { reviewedReplicationCheck } from './lib/replicationEvidence.mjs';
import { createSourceAuthenticityReader } from '../data/internal-qc/source-authenticity-2026-09-05/sourceAuthenticity.mjs';
import { createPseudobulkReplayReader } from '../data/internal-qc/source-authenticity-2026-09-05/pseudobulkReplay.mjs';
import { createRound2ReplayReader } from '../data/internal-qc/source-authenticity-2026-09-05/round2/round2Replay.mjs';
import { createSourceInputRelationshipReader } from '../data/internal-qc/source-authenticity-2026-09-05/round4/sourceInputRelationship.mjs';
import { createRound5SourceInputRelationshipReader } from '../data/internal-qc/source-authenticity-2026-09-05/round5/sourceInputRelationship.mjs';
import { createKeyedSourceInputRelationshipReader } from '../data/internal-qc/source-authenticity-2026-09-05/round5-keyed/sourceInputRelationship.mjs';
import { createCountConservationReader } from './lib/countConservationEvidence.mjs';
import { createSourceRecoveryReader, type RecoveryProposal } from '../data/internal-qc/source-recovery-2026-09-11/sourceRecovery.mjs';
import { createIntakeReplicationReader } from '../data/internal-qc/intake-replication-2026-09-11/intakeReplication.mjs';
import { createIntakeNumericReader } from '../data/internal-qc/intake-numeric-2026-09-11/intakeNumericEvidence.mjs';
import { createRecoveredConservationReader } from '../data/internal-qc/conservation-round2-2026-09-11/conservation.mjs';
import { createReplicationReviewSupplementReader } from '../data/internal-qc/replication-round2-2026-09-11/replicationReviews.mjs';
import { createGlucoseReplicationReader } from '../data/internal-qc/replication-round2-2026-09-11/glucoseReplication.mjs';
import { createHfdIntakeReader } from './lib/hfdIntakeEvidence.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(ROOT, 'data/internal-qc/assessments.generated.json');
const CHECK = process.argv.includes('--check');
const fingerprints = new Map<string, string>();
const posix = (path: string): string => relative(ROOT, path).replaceAll('\\', '/');
const isTextEvidence = (path: string): boolean => /\.(?:ts|tsx|mts|js|json|csv|tsv|txt|xml|md|r|py|soft)$/i.test(path);
function recordFingerprint(path: string, bytes: Buffer, exactHash: string): void {
  // Reporting hashes tolerate checkout line endings. Return values used to validate original-file pins remain exact.
  let digest = exactHash;
  if (isTextEvidence(path)) {
    try { digest = atlasFingerprint(bytes); } catch { /* Non-UTF8 source files keep exact byte hashes. */ }
  }
  fingerprints.set(posix(path), digest);
}
function read(path: string): Buffer {
  const bytes = readFileSync(path);
  recordFingerprint(path, bytes, createHash('sha256').update(bytes).digest('hex'));
  return bytes;
}
function readText(path: string): string {
  const bytes = read(path);
  return (path.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8');
}
function fingerprint(path: string): string {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = openSync(path, 'r');
  try {
    let count = readSync(descriptor, buffer, 0, buffer.length, null);
    while (count > 0) {
      hash.update(buffer.subarray(0, count));
      count = readSync(descriptor, buffer, 0, buffer.length, null);
    }
  } finally { closeSync(descriptor); }
  const digest = hash.digest('hex');
  if (isTextEvidence(path)) recordFingerprint(path, readFileSync(path), digest);
  else fingerprints.set(posix(path), digest);
  return digest;
}
function rows(path: string): EvidenceRow[] { return existsSync(path) ? parseTsv(readText(path)) : []; }
const authenticatedSources = createSourceAuthenticityReader(ROOT, { fingerprint });
const reconstructedSources = createPseudobulkReplayReader(ROOT, { fingerprint });
const round2Sources = createRound2ReplayReader(ROOT, { fingerprint });
const round4Sources = createSourceInputRelationshipReader(ROOT, { fingerprint });
const round5Sources = createRound5SourceInputRelationshipReader(ROOT, { fingerprint });
const keyedSources = createKeyedSourceInputRelationshipReader(ROOT, { fingerprint });
const independentConservation = createCountConservationReader(ROOT, { readBytes: read, fingerprint });
const recoveredSources = createSourceRecoveryReader(ROOT, { fingerprint });
const intakeReplication = createIntakeReplicationReader(ROOT, path => read(resolve(ROOT, path)));
const intakeNumeric = createIntakeNumericReader(ROOT, { readBytes: read, fingerprint });
const recoveredConservation = createRecoveredConservationReader(ROOT, { readBytes: read, fingerprint });
const replicationSupplements = createReplicationReviewSupplementReader(ROOT, { readBytes: read, fingerprint });
const glucoseReplication = createGlucoseReplicationReader(ROOT, { readBytes: read, fingerprint });
const hfdReader = createHfdIntakeReader(ROOT, path => read(resolve(ROOT, path)));
fingerprint(resolve(ROOT, 'data/internal-qc/replication-round2-2026-09-11/replicationReviews.mts'));
fingerprint(resolve(ROOT, 'data/internal-qc/replication-round2-2026-09-11/glucoseReplication.mts'));
const recoveredConservationScope = new Set(['mouse_hypo_hfd_gse236077', 'mouse_hypo_treg_gse282067']);
const recoveryScope = new Set(['mouse_hypo_hfd_emtab6929', 'mouse_vlpo_galanin_sleep_gse132308', 'human_ipsc_hypo_obesity_gse95243']);
const recoveryCache = new Map<string, RecoveryProposal>();
function recoveredSource(datasetId: string, inputPath: string | null): RecoveryProposal {
  const key = `${datasetId}:${inputPath}`;
  if (!recoveryCache.has(key)) recoveryCache.set(key, recoveredSources.evaluate({ datasetId, currentInputPath: inputPath }));
  return recoveryCache.get(key)!;
}
const septemberStudies = JSON.parse(readText(resolve(ROOT, 'data/intake/september5-2026/studies.json'))) as Array<{
  id: string; dir: string; tracks: Array<{ id: string; samplesheet: string }>;
}>;
const septemberAnalyses = JSON.parse(readText(resolve(ROOT, 'data/intake/september5-2026/analyses.json'))) as Array<{
  studyId: string; track: string; contrast: string; analysisId: string;
}>;
const hfdStudiesPath = resolve(ROOT, 'data/intake/hfd-2026-09-12/studies.json');
const hfdAnalysesPath = resolve(ROOT, 'data/intake/hfd-2026-09-12/analyses.json');
const hfdStudies = existsSync(hfdStudiesPath) ? JSON.parse(readText(hfdStudiesPath)) as typeof septemberStudies : [];
const hfdAnalyses = existsSync(hfdAnalysesPath) ? JSON.parse(readText(hfdAnalysesPath)) as typeof septemberAnalyses : [];
const intakeStudies = [...septemberStudies, ...hfdStudies];
const intakeAnalyses = [...septemberAnalyses, ...hfdAnalyses];
for (const path of ['scripts/build_internal_qc.mts', 'scripts/lib/internalQc.mts',
  'scripts/lib/countConservationEvidence.mts', 'scripts/round_conservation_values.R',
  'scripts/lib/hfdIntakeEvidence.mts',
  'src/data/reviewedStudyMetadata.ts',
  'data/internal-qc/intake-replication-2026-09-11/intakeReplication.mts',
  'data/internal-qc/intake-numeric-2026-09-11/intakeNumericEvidence.mts',
  'data/internal-qc/conservation-round2-2026-09-11/conservation.mts',
  'data/internal-qc/source-authenticity-2026-09-05/scopedConfiguration.mts',
  'data/internal-qc/source-authenticity-2026-09-05/sourceAuthenticity.mts',
  'data/internal-qc/source-authenticity-2026-09-05/pseudobulkReplay.mts',
  'data/internal-qc/source-authenticity-2026-09-05/round2/round2Replay.mts',
  'data/internal-qc/source-authenticity-2026-09-05/round4/sourceInputRelationship.mts',
  'data/internal-qc/source-authenticity-2026-09-05/round5/sourceInputRelationship.mts',
  'data/internal-qc/source-authenticity-2026-09-05/round5-keyed/sourceInputRelationship.mts']) fingerprint(resolve(ROOT, path));
function advanceSourceIntegrity(current: QualityCheck, datasetId: string, inputPath: string | null, accession: string | undefined): QualityCheck {
  if (recoveryScope.has(datasetId)) {
    const recovered = recoveredSource(datasetId, inputPath ? posix(inputPath) : null);
    return qualityCheck(current.id, current.label, current.status === 'fail' ? 'fail' : recovered.status,
      current.status === 'fail' ? `${current.note} ${recovered.note}` : recovered.note,
      [...new Set([...(current.evidence ?? []), ...recovered.evidence])]);
  }
  if (accession && ['GSE236077', 'GSE282067', 'GSE329539', 'GSE212299', 'GSE217420', 'GSE224780',
    'GSE229838', 'GSE234483', 'GSE242187', 'GSE242245', 'GSE98519', 'GSE99690', 'GSE254155'].includes(accession)) {
    const reader = accession === 'GSE254155' ? keyedSources : round5Sources;
    const replay = reader.evaluate({ datasetId, currentInputPath: inputPath ? posix(inputPath) : null, previous: current });
    return qualityCheck(current.id, current.label, replay.status, replay.note,
      [...new Set([...(current.evidence ?? []), ...replay.evidence])]);
  }
  if (accession && ['GSE225038', 'GSE235479', 'GSE167264', 'GSE314029', 'GSE123983', 'GSE135639',
    'GSE305688', 'GSE157077', 'GSE185074', 'GSE160802', 'GSE295250', 'GSE181204'].includes(accession)) {
    const replay = round4Sources.evaluate({ datasetId, currentInputPath: inputPath ? posix(inputPath) : null, previous: current });
    return qualityCheck(current.id, current.label, replay.status, replay.note,
      [...new Set([...(current.evidence ?? []), ...replay.evidence])]);
  }
  if (inputPath && accession && ['GSE201207', 'GSE245727', 'GSE289833', 'GSE212491', 'GSE289461',
    'GSE314817', 'GSE270383', 'GSE273038', 'GSE205313', 'GSE254155'].includes(accession)) {
    const replay = round2Sources.evaluate({ accession, currentInputPath: inputPath, previous: current });
    return qualityCheck(current.id, current.label, replay.status, replay.note,
      [...new Set([...(current.evidence ?? []), ...replay.evidence])]);
  }
  if (inputPath && accession && ['GSE130597', 'GSE143818', 'GSE174085'].includes(accession)) {
    const replay = reconstructedSources.evaluate({ accession, currentInputPath: inputPath, previous: current });
    return qualityCheck(current.id, current.label, replay.status, replay.note, [...new Set([...(current.evidence ?? []), ...replay.evidence])]);
  }
  const reviewed = authenticatedSources.evaluate({ datasetId, currentInputPath: inputPath, previous: current });
  const evidence = [...new Set([...(current.evidence ?? []), ...reviewed.evidence])];
  if (current.status === 'fail' || reviewed.status === 'pass' || reviewed.status === 'fail' || reviewed.sourceScope === 'discrepancy') {
    return qualityCheck(current.id, current.label, reviewed.status, reviewed.note, evidence);
  }
  // A new upstream-only audit cannot certify a derived input or invalidate an independently valid prior source manifest.
  return qualityCheck(current.id, current.label, current.status, `${current.note} ${reviewed.note}`, evidence);
}
function findReports(directory: string | null, suffix: string): { rows: EvidenceRow[]; paths: string[] } {
  if (!directory) return { rows: [], paths: [] };
  const absolute = resolve(ROOT, directory, 'processed');
  if (!existsSync(absolute)) return { rows: [], paths: [] };
  const paths = readdirSync(absolute).filter((file) => file.endsWith(suffix)).sort().map((file) => resolve(absolute, file));
  return { rows: paths.flatMap(rows), paths: paths.map(posix) };
}
function parseBundle(path: string): RawTrack {
  const source = readText(path).trim();
  const assignment = source.match(/^(?:var|let|const)\s+[A-Za-z0-9_]+\s*=\s*([\s\S]+?);?$/);
  if (!assignment) throw new Error(`Unsupported bundle assignment: ${posix(path)}`);
  return JSON.parse(assignment[1].replace(/;$/, '')) as RawTrack;
}

interface MechanicalRecord {
  datasetId: string;
  directory: string | null;
  configId: string | null;
  sourceManifest: string | null;
  sourceFiles: { file: string; expectedSha256: string | null; expectedBytes: number | null }[];
  contrasts: { contrastId: string; table: string }[];
}
// This file supplies explicit path bindings, never its pass/fail decisions.
const mechanicalPath = resolve(ROOT, 'data/author-validation/mechanical-audit.generated.json');
const bindings = JSON.parse(readText(mechanicalPath)) as { datasets: MechanicalRecord[] };
const configsPath = resolve(ROOT, 'geo_replication/config/datasets.tsv');
const configs = rows(configsPath);
const advancementPath = resolve(ROOT, 'data/internal-qc/advancement-2026-09-05/normalization-evidence.json');
const advancement = existsSync(advancementPath) ? JSON.parse(readText(advancementPath)) as { script: string; records: NormalizationReplay[] } : null;
const conservationPath = resolve(ROOT, 'data/internal-qc/advancement-2026-09-05/conservation-evidence.json');
const conservationReplays = existsSync(conservationPath) ? JSON.parse(readText(conservationPath)) as { script: string; records: (NormalizationReplay & { archivePath: string })[] } : null;
interface DedicatedReplay {
  datasetId: string;
  configId: string;
  sheet: string;
  fingerprints: Record<string, string>;
  replayFile: string;
  replaySha256: string;
  measurement: MatrixMeasurement;
  designRank: number;
  designColumns: number;
  residualDf: number;
  designNote: string;
  transformedRows: number;
  contrasts: Record<string, { status: QualityStatus; existingRows: number; matchedRows: number }>;
}
const dedicatedPath = resolve(ROOT, 'data/internal-qc/advancement-2026-09-05/dedicated-evidence.json');
const dedicatedReplays = existsSync(dedicatedPath) ? JSON.parse(readText(dedicatedPath)) as { records: DedicatedReplay[] } : null;

function advanceConservation(current: QualityCheck, binding: MechanicalRecord, config: EvidenceRow | undefined, matrix: MatrixMeasurement | null): QualityCheck {
  if (recoveredConservationScope.has(binding.datasetId) && config && matrix) {
    return recoveredConservation.evaluate({datasetId: binding.datasetId, config,
      currentInputPath: `geo_replication/${config.input_path}`, matrix, previous: current});
  }
  if (recoveryScope.has(binding.datasetId) && config && matrix && config.input_kind === 'counts') {
    const recovered = recoveredSource(binding.datasetId, `geo_replication/${config.input_path}`);
    return qualityCheck(current.id, current.label, current.status === 'fail' ? 'fail' : recovered.conservation,
      current.status === 'fail' ? `${current.note} ${recovered.note}` : recovered.note,
      [...new Set([...(current.evidence ?? []), ...recovered.evidence])]);
  }
  const legacy = advanceLegacyConservation(current, binding, config, matrix);
  if (legacy.status !== 'not_assessed' || !config || !matrix || config.input_kind !== 'counts') return legacy;
  const reviewed = independentConservation.evaluate({ datasetId: binding.datasetId, config,
    currentInputPath: `geo_replication/${config.input_path}`, matrix, previous: legacy });
  return qualityCheck(reviewed.id, reviewed.label, reviewed.status, reviewed.note, reviewed.evidence ?? []);
}

function advanceLegacyConservation(current: QualityCheck, binding: MechanicalRecord, config: EvidenceRow | undefined, matrix: MatrixMeasurement | null): QualityCheck {
  if (current.status !== 'not_assessed' || !conservationReplays || !config || !matrix) return current;
  const replay = conservationReplays.records.find((entry) => entry.datasetId === binding.datasetId);
  if (!replay?.samples) return current;
  const evidence = [...(current.evidence ?? []), posix(conservationPath), replay.archivePath, conservationReplays.script];
  const paths = [`geo_replication/${config.input_path}`, `geo_replication/${config.samplesheet}`, replay.archivePath];
  const hashes = Object.fromEntries(paths.filter((path) => existsSync(resolve(ROOT, path))).map((path) => [path, fingerprint(resolve(ROOT, path))]));
  const script = fingerprint(resolve(ROOT, conservationReplays.script));
  if (!replayIsCurrent(replay, config, paths, hashes, script)) return { ...current, evidence, note: `${current.note} The source-to-input replay is stale; rerun the conservation audit.` };
  const report = replay.samples.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value)])));
  const result = countConservation(matrix, config.input_kind, report, evidence);
  const invalid = report.some((row) => numeric(row.maximum_retained_count_delta) == null || numeric(row.maximum_retained_count_delta)! > 1e-6);
  return { ...result, status: invalid ? 'fail' : result.status, note: `${result.note} ${replay.note}${invalid ? ' Retained source values differ from the current input.' : ''}` };
}

function advanceNormalization(current: QualityCheck, binding: MechanicalRecord, config: EvidenceRow | undefined, matrix: MatrixMeasurement | null): QualityCheck {
  if (current.status === 'fail' || !advancement || !config || !matrix || binding.contrasts.length !== 1) return current;
  const replay = advancement.records.find((entry) => entry.datasetId === binding.datasetId && entry.contrastId === binding.contrasts[0].contrastId);
  if (!replay) return current;
  const evidence = [...(current.evidence ?? []), posix(advancementPath), replay.replayFile, advancement.script];
  const paths = [`geo_replication/${config.input_path}`, `geo_replication/${config.samplesheet}`, binding.contrasts[0].table];
  const hashes = Object.fromEntries(paths.filter((path) => existsSync(resolve(ROOT, path))).map((path) => [path, fingerprint(resolve(ROOT, path))]));
  const currentScript = existsSync(resolve(ROOT, advancement.script)) ? fingerprint(resolve(ROOT, advancement.script)) : '';
  const replayPath = resolve(ROOT, replay.replayFile);
  const replayFileCurrent = existsSync(replayPath) && replayArtifactMatches(replay, fingerprint(replayPath), JSON.parse(readText(replayPath)));
  if (!replayFileCurrent || !replayIsCurrent(replay, config, paths, hashes, currentScript)) return { ...current, evidence, note: `${current.note} Saved numeric-replay evidence is stale against the current input, sample sheet, DE table, configuration, replay artifact or replay script; rerun the advancement script.` };
  if (replay.status !== 'pass' || !replay.samples || !replay.existingRows || replay.matchedRows !== replay.existingRows) return { ...current, status: replay.status === 'review' ? 'review' : current.status, evidence, note: `${current.note} Numeric replay was attempted: ${replay.note}` };
  // Recheck every measured factor and library total rather than trusting the saved overall status.
  const replayRows = replay.samples.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value)])));
  const result = normalizationCheck(matrix, config.input_kind, replayRows, evidence);
  if (result.status !== 'pass') return result;
  const runtime = replay.software ? `R ${replay.software.R}, edgeR ${replay.software.edgeR}, limma ${replay.software.limma}` : 'the recorded runtime';
  return { ...result, note: `${result.note} Independently replayed the declared numeric model with ${runtime}; all ${replay.existingRows.toLocaleString('en-US')} existing DE rows agree within absolute 0.000001 + relative 0.000001 tolerance. ${config.input_kind === 'matrix' ? 'This verifies identity consumption of the declared normalized input, not unpublished upstream normalization.' : 'The measured filterByExpr and TMM evidence is linked to the current input and existing output.'}` };
}

function sourceIntegrity(binding: MechanicalRecord): QualityCheck {
  const evidence = binding.sourceManifest ? [binding.sourceManifest] : [];
  if (!binding.sourceManifest || !binding.sourceFiles.length) return qualityCheck('source_integrity', 'Source file integrity', 'not_assessed', 'No checksummed source manifest is available.', evidence);
  const manifestRows = rows(resolve(ROOT, binding.sourceManifest));
  let matches = 0;
  let missing = 0;
  let unverifiable = 0;
  let mismatches = 0;
  for (const file of binding.sourceFiles) {
    const path = resolve(ROOT, file.file);
    const manifest = manifestRowForFile(manifestRows, posix(path));
    const expected = manifest?.sha256;
    if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) { unverifiable++; continue; }
    if (!existsSync(path)) { missing++; continue; }
    const actual = fingerprint(path);
    const normalized = actual !== expected && /\.(tsv|txt|csv|soft|xml|json|ipynb|r|py|md|html|yml|yaml)$/i.test(path)
      ? createHash('sha256').update(readText(path).replace(/\r\n/g, '\n')).digest('hex') : null;
    if (sourceHashMatches(actual, normalized, expected, manifest?.normalized_sha256)) matches++;
    else mismatches++;
  }
  return qualityCheck('source_integrity', 'Source file integrity', mismatches ? 'fail' : missing || unverifiable ? 'not_assessed' : 'pass',
    `${matches} local source files match their pinned SHA-256${matches === 1 ? '' : ' checksums'}; ${missing} are absent and ${unverifiable} lack a usable checksum.${mismatches ? ` ${mismatches} files differ from the pinned source.` : ''} Text line-ending normalization is allowed.`, evidence);
}

function selectedReportRows(report: EvidenceRow[], samples: string[]): EvidenceRow[] {
  const selected = report.filter((row) => samples.includes(row.sample));
  return selected.length === samples.length && new Set(selected.map((row) => row.sample)).size === samples.length ? selected : [];
}

function countConservation(matrix: MatrixMeasurement | null, inputKind: string | undefined, preprocessing: EvidenceRow[], evidence: string[]): QualityCheck {
  if (inputKind === 'matrix') return qualityCheck('count_conservation', 'Count conservation', 'not_applicable', 'The configured input is normalized expression. Raw-count conservation does not apply.');
  if (!matrix || inputKind !== 'counts') return qualityCheck('count_conservation', 'Count conservation', 'not_assessed', 'The count matrix and per-sample preprocessing evidence are required.', evidence);
  const selected = selectedReportRows(preprocessing, matrix.samples);
  let measured = 0;
  let disagreements = 0;
  for (const row of selected) {
    const status = countConservationSampleStatus(row, matrix.sums[row.sample]);
    if (status === 'not_assessed') continue;
    measured++;
    if (status === 'fail') disagreements++;
  }
  return qualityCheck('count_conservation', 'Count conservation', disagreements ? 'fail' : measured !== matrix.samples.length ? 'not_assessed' : 'pass',
    disagreements ? `${disagreements} samples have a recorded conservation discrepancy or a current matrix total that differs from preprocessing evidence.`
      : measured !== matrix.samples.length ? `Current matrix totals can be reconciled with recorded source-to-output conservation for ${measured}/${matrix.samples.length} samples.`
        : `Source-to-output conservation deltas are within tolerance and all ${measured} recorded output totals match the current count matrix.`, evidence);
}

function normalizationCheck(matrix: MatrixMeasurement | null, inputKind: string | undefined, reports: EvidenceRow[], evidence: string[]): QualityCheck {
  if (!matrix) return qualityCheck('normalization', 'Normalization and transformation', 'not_assessed', 'The current input matrix could not be measured.', evidence);
  // Prefer the sample-QC report when both sample and preprocessing reports contain a sample.
  const bySample = new Map<string, EvidenceRow>();
  for (const row of reports) if (matrix.samples.includes(row.sample)) bySample.set(row.sample, { ...bySample.get(row.sample), ...row });
  let measured = 0;
  let invalid = 0;
  for (const sample of matrix.samples) {
    const row = bySample.get(sample);
    if (!row) continue;
    const status = normalizationSampleStatus(row, inputKind, matrix.sums[sample]);
    if (status === 'not_assessed') continue;
    measured++;
    if (status === 'fail') invalid++;
  }
  return qualityCheck('normalization', 'Normalization and transformation', invalid ? 'fail' : measured === matrix.samples.length ? 'pass' : 'not_assessed',
    invalid ? `${invalid} samples have invalid factors, a transformation discrepancy, or totals that differ from the current input matrix.`
      : measured === matrix.samples.length ? inputKind === 'counts'
        ? `All ${measured} recorded TMM factors are positive and finite; input library totals match the current matrix. Effective-library consistency is checked only when its filtered library total is recorded.`
        : `All ${measured} recorded transformation errors are at most 0.000001 and transformed expression totals match the current matrix.`
        : `Measured normalization or transformation evidence linked to the current matrix covers ${measured}/${matrix.samples.length} samples. Method names alone are insufficient.`, evidence);
}

function sampleAssignment(raw: RawTrack, sheet: EvidenceRow[], dataset: Dataset, contrast: Dataset['contrasts'][number], matrix: MatrixMeasurement | null, evidence: string[]): QualityCheck {
  const baseline = raw.meta?.groupSamples?.[contrast.baseline] ?? [];
  const cases = raw.meta?.groupSamples?.[contrast.case] ?? [];
  const selected = [...baseline, ...cases];
  const order = raw.meta?.sampleOrder ?? raw.meta?.sampleNames ?? [];
  if (!sheet.length || !baseline.length || !cases.length || !order.length || !matrix) return qualityCheck('sample_assignment', 'Sample and group assignments', 'not_assessed', 'The sample sheet, both contrast arms, sample order and input matrix are needed.', evidence);
  const sheetMap = new Map(sheet.map((row) => [row.sample, row]));
  const expectedBaseline = dataset.contrasts.length === 1 ? ['control', contrast.baseline] : [contrast.baseline];
  const expectedCase = dataset.contrasts.length === 1 ? ['case', contrast.case] : [contrast.case];
  const identityError = new Set(selected).size !== selected.length || new Set(order).size !== order.length || new Set(sheet.map((row) => row.sample)).size !== sheet.length || selected.some((sample) => !order.includes(sample) || !sheetMap.has(sample) || matrix.missingSamples.includes(sample));
  const groupError = baseline.some((sample) => !expectedBaseline.includes(sheetMap.get(sample)?.group ?? '')) || cases.some((sample) => !expectedCase.includes(sheetMap.get(sample)?.group ?? ''));
  return qualityCheck('sample_assignment', 'Sample and group assignments', identityError ? 'fail' : groupError ? 'review' : 'pass', identityError
    ? 'The sample sheet, contrast arms, sample order or input columns have missing or duplicate sample identities.'
    : groupError ? 'Sample identities are present, but source and displayed group assignments need an explicit mapping review.'
      : `${baseline.length} baseline and ${cases.length} case samples agree across the sample sheet, input columns and displayed contrast; sample identities are unique.`, evidence);
}

function outputCheck(bundle: GeneDERecord[], table: EvidenceRow[], evidence: string[]): QualityCheck {
  if (!bundle.length || !table.length) return qualityCheck('output_integrity', 'Result integrity and statistical values', 'not_assessed', 'A nonempty current DE table and displayed comparison are required.', evidence);
  const source = new Map<string, EvidenceRow>();
  let invalidSource = 0;
  let missingFdr = 0;
  for (const row of table) {
    const p = numeric(row.pvalue);
    const effect = numeric(row.logFC);
    const adjusted = numeric(row.padj);
    if (effect == null || p == null || p < 0 || p > 1 || (adjusted != null && (adjusted < 0 || adjusted > 1))) invalidSource++;
    if (adjusted == null) missingFdr++;
    const gene = normalizeGene(row.symbol) ?? row.symbol;
    if (!gene || p == null) continue;
    if (!source.has(gene) || p < numeric(source.get(gene)!.pvalue)!) source.set(gene, row);
  }
  let discrepancies = 0;
  const seen = new Set<string>();
  for (const row of bundle) {
    const gene = normalizeGene(row.gene) ?? row.gene;
    const original = source.get(gene);
    const p = numeric(row.PValue);
    const effect = numeric(row.logFC);
    const adjusted = numeric(row.FDR);
    if (seen.has(gene) || !gene || effect == null || p == null || p < 0 || p > 1 || (adjusted != null && (adjusted < 0 || adjusted > 1)) || (row.se != null && (!Number.isFinite(row.se) || row.se < 0))) discrepancies++;
    seen.add(gene);
    if (!original || effect !== +Number(original.logFC).toFixed(4) || p !== roundProb(numeric(original.pvalue)) || adjusted !== roundProb(numeric(original.padj))) discrepancies++;
  }
  return qualityCheck('output_integrity', 'Result integrity and statistical values', invalidSource || discrepancies ? 'fail' : missingFdr ? 'review' : 'pass',
    invalidSource || discrepancies ? `${invalidSource} source rows have invalid statistics; ${discrepancies} displayed-row checks fail uniqueness, probability bounds, standard-error validity or exact trace to the current analysis table.`
      : missingFdr ? `All ${bundle.length.toLocaleString('en-US')} displayed rows trace to the current analysis; ${missingFdr} source rows lack an adjusted P value.`
        : `All ${bundle.length.toLocaleString('en-US')} displayed genes are unique and trace to the current analysis table, with finite effects and probabilities in [0, 1].`, evidence);
}

function auditAtlas(dataset: Dataset): { datasetId: string; assessment: QualityAssessment; contrasts: Record<string, QualityAssessment> } {
  const evidencePath = 'data/internal-qc/advancement-2026-09-05/macaque/atlas-evidence.json';
  let result = assessment([qualityCheck('audit_scope', 'Atlas audit coverage', 'not_assessed', 'All app tracks require a current saved-output audit. Run scripts/audit_macaque_internal_qc.mts.', [evidencePath])], 'macaque_snrna; current atlas evidence missing');
  if (existsSync(resolve(ROOT, evidencePath))) {
    const saved = JSON.parse(readText(resolve(ROOT, evidencePath))) as {
      auditVersion: string; fingerprintScheme: string; trackIds: string[]; tracks: MacaqueTrackAudit[]; fingerprints: Record<string, string>;
    };
    const meta = parseMacaqueBundle(readText(resolve(ROOT, 'public/datasets/macaque_snrna/meta.js')));
    const current = Object.fromEntries(Object.keys(saved.fingerprints).map((path) => {
      const digest = existsSync(resolve(ROOT, path)) ? atlasFingerprint(readFileSync(resolve(ROOT, path))) : '';
      if (digest) fingerprints.set(path, digest);
      return [path, digest];
    }));
    if (macaqueEvidenceCurrent(saved, meta.populations, current)) result = aggregateMacaqueTracks(saved.tracks);
    else result.checks[0].note = 'Saved atlas evidence is stale or does not cover every current app track and required input. Rerun scripts/audit_macaque_internal_qc.mts; no previous passing checks are inherited.';
  }
  return { datasetId: dataset.id, assessment: result, contrasts: Object.fromEntries(dataset.contrasts.map((contrast) => [contrast.id, result])) };
}

interface DatasetAudit {
  datasetId: string; assessment: QualityAssessment; contrasts: Record<string, QualityAssessment>;
  tracks?: Record<string, { trackId: string; assessment: QualityAssessment; contrasts: Record<string, QualityAssessment> }>;
}

function aggregateAssessments(entries: QualityAssessment[], scope: string): QualityAssessment {
  if (!entries.length) return assessment([qualityCheck('audit_scope', 'Audit coverage', 'not_assessed', 'No assessments were available.')], scope);
  const ids = [...new Set(entries.flatMap(entry => entry.checks.map(check => check.id)))];
  return assessment(ids.map(id => {
    const checks = entries.map(entry => entry.checks.find(check => check.id === id)
      ?? qualityCheck(id, id, 'not_assessed', 'This check is missing for a registered track or comparison.'));
    const status = aggregateQualityChecks(checks);
    const representative = checks.find(check => check.status === status) ?? checks[0];
    return { ...representative, status,
      note: `${checks.filter(check => check.status === 'pass').length}/${checks.length} assessments pass this check. ${representative.note}`,
      evidence: [...new Set(checks.flatMap(check => check.evidence ?? []))] };
  }), scope);
}

function auditDataset(dataset: Dataset): DatasetAudit {
  const intake = intakeStudies.find(study => study.id === dataset.id);
  if (!intake) return auditTrack(dataset);
  const tracks = Object.fromEntries(intake.tracks.map(track => {
    const result = auditTrack({ ...dataset, defaultTrack: track.id });
    return [track.id, { trackId: track.id, assessment: result.assessment, contrasts: result.contrasts }];
  }));
  const contrasts = Object.fromEntries(dataset.contrasts.map(contrast => [contrast.id,
    aggregateAssessments(Object.values(tracks).map(track => track.contrasts[contrast.id]),
      `${dataset.name}; ${contrast.label ?? contrast.id}; all ${intake.tracks.length} registered tracks`)]));
  return { datasetId: dataset.id, tracks, contrasts,
    assessment: aggregateAssessments(Object.values(tracks).flatMap(track => Object.values(track.contrasts)),
      `${dataset.name}; all ${intake.tracks.length} registered tracks and ${intake.tracks.length * dataset.contrasts.length} comparisons`) };
}

function auditTrack(dataset: Dataset): DatasetAudit {
  if (dataset.id === 'macaque_snrna') return auditAtlas(dataset);
  const originalBinding = bindings.datasets.find((record) => record.datasetId === dataset.id);
  const intake = intakeStudies.find(study => study.id === dataset.id);
  const trackAnalyses = intakeAnalyses.filter(row => row.studyId === dataset.id && row.track === dataset.defaultTrack);
  if (intake && (trackAnalyses.length !== dataset.contrasts.length || dataset.contrasts.some(contrast => trackAnalyses.filter(row => row.contrast === contrast.id).length !== 1))) {
    throw new Error(`Incomplete or duplicate intake comparison bindings: ${dataset.id}/${dataset.defaultTrack}`);
  }
  const firstContrast = dataset.contrasts.find(contrast => contrast.isDefault) ?? dataset.contrasts[0];
  const binding = intake && originalBinding ? { ...originalBinding,
    configId: trackAnalyses.find(row => row.contrast === firstContrast.id)!.analysisId,
    contrasts: trackAnalyses.map(row => ({ contrastId: row.contrast, table: `${intake.dir}/processed/${row.analysisId}_DE.tsv` })) } : originalBinding;
  if (!binding) {
    const excluded = qualityCheck('audit_scope', 'Audit coverage', 'not_assessed', 'This dataset has no registered local QC input binding. No passing assessment is inferred.');
    return { datasetId: dataset.id, assessment: assessment([excluded], `Dataset ${dataset.id}`), contrasts: Object.fromEntries(dataset.contrasts.map((contrast) => [contrast.id, assessment([excluded], `${dataset.id}/${contrast.id}`)])) };
  }
  const config = configs.find((row) => row.id === binding.configId);
  const dedicated = dedicatedReplays?.records.find((record) => record.datasetId === dataset.id);
  const dedicatedArtifact = dedicated && existsSync(resolve(ROOT, dedicated.replayFile)) ? JSON.parse(readText(resolve(ROOT, dedicated.replayFile))) : null;
  const dedicatedRequired = dedicated ? [dedicated.sheet, 'scripts/audit_internal_dedicated.R', `scripts/de_${dedicated.configId.toLowerCase()}.R`, ...binding.contrasts.map((c) => c.table)] : [];
  const dedicatedCurrent = dedicated && dedicatedArtifact && dedicatedRequired.every((file) => !!dedicated.fingerprints[file])
    && Object.keys(dedicated.fingerprints).some((file) => file.includes('/raw/'))
    && Object.entries(dedicated.fingerprints).every(([file, expected]) => existsSync(resolve(ROOT, file)) && fingerprint(resolve(ROOT, file)) === expected)
    && fingerprint(resolve(ROOT, dedicated.replayFile)) === dedicated.replaySha256
    && ['configId', 'measurement', 'designRank', 'designColumns', 'residualDf', 'contrasts'].every((key) => JSON.stringify(dedicatedArtifact[key]) === JSON.stringify(dedicated[key as keyof DedicatedReplay]));
  const dedicatedEvidence = dedicated ? [posix(dedicatedPath), dedicated.replayFile, ...Object.keys(dedicated.fingerprints)] : [];
  const inputKind = config?.input_kind ?? (dedicatedCurrent ? 'matrix' : undefined);
  const inputPath = config?.input_path ? resolve(ROOT, 'geo_replication', config.input_path) : null;
  const intakeTrack = intakeStudies.find((study) => study.id === dataset.id)?.tracks.find((track) => track.id === dataset.defaultTrack);
  // An intake study's displayed arms span multiple pairwise fits. The primary
  // config row deliberately contains only its default fit; use the reviewed
  // complete track sheet when checking all registered comparison memberships.
  const sheetPath = intakeTrack ? resolve(ROOT, intakeTrack.samplesheet)
    : config?.samplesheet ? resolve(ROOT, 'geo_replication', config.samplesheet) : dedicatedCurrent ? resolve(ROOT, dedicated.sheet) : null;
  const sheet = (sheetPath ? rows(sheetPath) : []).filter((row) => !intakeTrack || row.included?.toLowerCase() === 'true');
  const inputEvidence = inputPath ? [posix(inputPath)] : dedicatedEvidence;
  const sheetEvidence = sheetPath ? [posix(sheetPath)] : [];
  const preprocessing = findReports(binding.directory, '_preprocessing_qc.tsv');
  const sampleQc = findReports(binding.directory, '_sample_qc.tsv');
  const bundlePath = resolve(ROOT, 'public', dataset.bundleFileTemplate.replace('{trackId}', dataset.defaultTrack).replace(/^\//, ''));
  const raw = parseBundle(bundlePath);
  const analysisSamples = intakeTrack ? sheet : sheet.filter((row) => row.group === 'control' || row.group === 'case');
  const sampleNames = analysisSamples.map((row) => row.sample);
  let matrix: MatrixMeasurement | null = dedicatedCurrent ? dedicated.measurement : null;
  let matrixError = '';
  if (inputPath && existsSync(inputPath) && sampleNames.length) {
    try { matrix = measureMatrix(readText(inputPath), sampleNames); }
    catch (error) { matrixError = error instanceof Error ? error.message : String(error); }
  }
  const matrixCheck = matrixValueCheck(matrix, inputKind, inputEvidence);
  if (matrixError) matrixCheck.note += ` ${matrixError}`;
  const libraryCheck = !matrix ? qualityCheck('library_detection', 'Library size and detected features', 'not_assessed', 'No current input matrix measurements are available.', inputEvidence)
    : inputKind === 'counts' ? qualityCheck('library_detection', 'Library size and detected features', matrix.samples.every((sample) => matrix!.sums[sample] > 0 && matrix!.detected[sample] > 0) ? 'pass' : 'fail',
      `All selected libraries are checked for positive total counts and at least one detected feature. This is an integrity gate, not a universal sequencing-depth threshold.`, inputEvidence)
      : qualityCheck('library_detection', 'Library size and detected features', 'not_applicable', 'Library sizes cannot be inferred from normalized log-expression values.');
  const common = [advanceSourceIntegrity(sourceIntegrity(binding), dataset.id, inputPath, dataset.geo), matrixCheck, libraryCheck,
    advanceConservation(countConservation(matrix, inputKind, preprocessing.rows, [...preprocessing.paths, ...inputEvidence]), binding, config, matrix),
    advanceNormalization(normalizationCheck(matrix, inputKind, [...preprocessing.rows, ...sampleQc.rows], [...preprocessing.paths, ...sampleQc.paths, ...inputEvidence]), binding, config, matrix)];
  const defaultContrast = dataset.contrasts.find((contrast) => contrast.isDefault) ?? dataset.contrasts[0];
  const contrasts: Record<string, QualityAssessment> = {};
  for (const contrast of dataset.contrasts) {
    const tablePath = binding.contrasts.find((entry) => entry.contrastId === contrast.id)?.table;
    const table = tablePath ? rows(resolve(ROOT, tablePath)) : [];
    const bundleRows = contrast.id === defaultContrast.id ? raw.de ?? [] : raw.deByContrast?.[contrast.id] ?? [];
    const baseline = raw.meta?.groupSamples?.[contrast.baseline] ?? [];
    const cases = raw.meta?.groupSamples?.[contrast.case] ?? [];
    const contrastConfig = intakeTrack ? configs.find((row) => tablePath?.endsWith(`/${row.id}_DE.tsv`)) : config;
    const modelSamples = intakeTrack ? sheet.filter((row) => baseline.includes(row.sample) || cases.includes(row.sample))
      .map((row) => ({ ...row, group: cases.includes(row.sample) ? 'case' : 'control' })) : analysisSamples;
    const metadata = sheet.map((row) => ({ ...preprocessing.rows.find((extra) => extra.sample === row.sample), ...sampleQc.rows.find((extra) => extra.sample === row.sample), ...row }));
    const assignmentSheet = dedicatedCurrent && dataset.id === 'mouse_pomc_maternal_hfd_gse135639'
      ? sheet.map((row) => ({ ...row, group: `${row.group === 'control' ? 'chow' : 'hfd'}_${row.age.toLowerCase()}` })) : sheet;
    const comparison = dedicatedCurrent ? dedicated.contrasts[contrast.id] : null;
    let normalization = comparison ? qualityCheck('normalization', 'Normalization and transformation', comparison.status,
      `Independently replayed the documented highest-mean duplicate-symbol selection, detection filter, log2(value + 1) transformation and limma-trend model. ${comparison.matchedRows}/${comparison.existingRows} existing DE rows were joined by feature ID; all four statistical columns ${comparison.status === 'pass' ? 'agree' : 'require review'} within absolute 0.000001 + relative 0.000001 tolerance. Upstream author normalization remains outside this check.`, dedicatedEvidence) : common[4];
    const model = dedicatedCurrent ? qualityCheck('model_validity', 'Model design and input scale', dedicated.designRank === dedicated.designColumns && dedicated.residualDf > 0 ? 'pass' : 'fail',
      `${dedicated.designNote} Recomputed design rank ${dedicated.designRank}/${dedicated.designColumns}, residual degrees of freedom ${dedicated.residualDf}.`, dedicatedEvidence)
      : modelCheck(modelSamples, inputKind, contrastConfig?.batch_var, [...new Set(table.map((row) => row.method).filter(Boolean))], ['geo_replication/config/datasets.tsv', ...sheetEvidence, ...(tablePath ? [tablePath] : [])]);
    let conservation = common[3];
    const intakeChecks: QualityCheck[] = [];
    if (intakeTrack && contrastConfig && septemberStudies.some(study => study.id === dataset.id)) {
      const currentInputPath = `geo_replication/${contrastConfig.input_path}`;
      const contrastMatrix = measureMatrix(readText(resolve(ROOT, currentInputPath)), [...baseline, ...cases]);
      const numeric = intakeNumeric.evaluate({ datasetId: dataset.id, trackId: dataset.defaultTrack, contrastId: contrast.id,
        config: contrastConfig, currentInputPath, matrix: contrastMatrix });
      if (normalization.status !== 'fail') normalization = numeric.normalization;
      if (conservation.status !== 'fail') conservation = numeric.countConservation;
      intakeChecks.push(numeric.sourceRelationship);
    }
    for (const check of [intakeReplication.speciesCheck(dataset.id, dataset.defaultTrack, contrast.id),
      intakeReplication.pairedModelCheck(dataset.id, dataset.defaultTrack, contrast.id)]) if (check) intakeChecks.push(check);
    const hfdEvidence = hfdReader.evaluate(dataset.id, dataset.defaultTrack, contrast.id);
    if (hfdEvidence) {
      intakeChecks.push(hfdEvidence.preparation);
      if (conservation.status !== 'fail') conservation = hfdEvidence.conservation;
      if (normalization.status !== 'fail') normalization = hfdEvidence.normalization;
    }
    const replication = hfdEvidence?.replication ?? (intakeTrack ? intakeReplication.check({ datasetId: dataset.id, trackId: dataset.defaultTrack,
      contrastId: contrast.id, config: contrastConfig ?? {}, baseline, cases }) : null);
    const baseReplication = replication ?? reviewedReplicationCheck(ROOT, dataset.id, contrast.id, config, baseline, cases, read)
      ?? replicationCheck(metadata, baseline, cases, [...sheetEvidence, ...preprocessing.paths, ...sampleQc.paths]);
    const sourceReviewedReplication = glucoseReplication.evaluate({ datasetId: dataset.id, trackId: dataset.defaultTrack,
      contrastId: contrast.id, config: contrastConfig ?? {}, baseline, cases, previous: baseReplication }) ?? baseReplication;
    const completeReplication = replicationSupplements.evaluate({ datasetId: dataset.id, trackId: dataset.defaultTrack,
      contrastId: contrast.id, config: config ?? {}, baseline, cases, previous: sourceReviewedReplication }) ?? sourceReviewedReplication;
    const checks = [common[0], sampleAssignment(raw, assignmentSheet, dataset, contrast, matrix, [...sheetEvidence, posix(bundlePath), ...inputEvidence]),
      completeReplication, common[1], common[2], conservation, normalization, model, ...intakeChecks,
      outputCheck(bundleRows, table, [posix(bundlePath), ...(tablePath ? [tablePath] : [])])];
    contrasts[contrast.id] = assessment(checks, `${dataset.name}; ${contrast.label ?? contrast.id}; default track ${dataset.defaultTrack}`);
  }
  const all = Object.values(contrasts);
  const datasetChecks = all[0]?.checks.map((check) => {
    const entries = all.map((entry) => entry.checks.find((item) => item.id === check.id)!);
    const status = aggregateQualityChecks(entries);
    return { ...check, status, note: all.length === 1 ? check.note : `${entries.filter((entry) => entry.status === 'pass').length}/${all.length} registered contrasts pass this check. ${entries.find((entry) => entry.status === status)?.note ?? check.note}`, evidence: [...new Set(entries.flatMap((entry) => entry.evidence ?? []))] };
  }) ?? [];
  return { datasetId: dataset.id, assessment: assessment(datasetChecks, `${dataset.name}; all ${dataset.contrasts.length} registered contrasts on default track ${dataset.defaultTrack}`), contrasts };
}

const records = DATASETS.map(auditDataset);
const statuses: QualityStatus[] = ['pass', 'review', 'fail', 'not_assessed', 'not_applicable'];
const ledger = {
  schemaVersion: 1,
  policyVersion: INTERNAL_QC_POLICY,
  fingerprintConventions: { inputs: 'SHA-256 over UTF-8 with only CRLF converted to LF for ts, tsx, mts, js, json, csv, tsv, txt, xml, md, R, py and soft files. Other extensions and non-UTF8 text use exact bytes. This applies only to this ledger input inventory.', sourceEvidence: 'Original source, acquisition, replay and reviewed-unit file pins are validated against exact bytes independently of the ledger inventory. Atlas saved-output evidence explicitly uses sha256-utf8-crlf-to-lf-v1.' },
  coverage: 'Current local inputs and default-track bundles for original non-atlas datasets; all 22 tracks and 51 comparisons in the fourteen-dataset September intake are assessed. All current macaque atlas app tracks have a dedicated saved-output audit. Missing data never pass. Raw sequencing read quality and unrecorded biological confounders remain outside this audit. Atlas raw count processing remains unverified without its original objects.',
  policy: {
    aggregation: 'Every required applicable check must pass. Failure takes priority over review, then missing evidence. Not-applicable checks are neutral.',
    replication: 'At least three distinct recorded biological units per arm; two require review; fewer than two fail. Reused units require model review.',
    conservationTolerance: 'absolute 0.000001 + relative 0.00000001',
    transformationAbsoluteTolerance: 0.000001,
  },
  summary: Object.fromEntries(statuses.map((status) => [status, records.filter((record) => record.assessment.status === status).length])),
  inputs: Object.fromEntries([...fingerprints.entries()].sort(([a], [b]) => a.localeCompare(b))),
  records,
};
const serialized = `${JSON.stringify(ledger, null, 2)}\n`;
if (CHECK) {
  if (!existsSync(OUTPUT) || readFileSync(OUTPUT, 'utf8').replace(/\r\n/g, '\n') !== serialized) throw new Error('Internal QC ledger is stale or missing. Run npm run build:internal-qc.');
  process.stdout.write(`Internal QC ledger is current: ${records.length} datasets.\n`);
} else {
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, serialized);
  process.stdout.write(`Wrote ${posix(OUTPUT)}: ${JSON.stringify(ledger.summary)}\n`);
}
