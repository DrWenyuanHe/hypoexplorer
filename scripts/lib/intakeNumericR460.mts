/**
 * September 5 intake numeric evidence after the R 4.6.0 regeneration.
 *
 * The sealed September 11 package (data/internal-qc/intake-numeric-2026-09-11)
 * replays the replaced fits and cannot certify the regenerated tables. Its
 * deposited-source-to-prepared-matrix reconstruction still applies wherever every
 * source-side file it pins is unchanged. The prepared-matrix-to-fit-matrix
 * projection is verified by scripts/audit_september5_intake_r460.mts, and the
 * numeric model by the R 4.6.0 normalization replay
 * (scripts/audit_internal_normalization_r460.R, per comparison).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { QualityCheck } from '../../src/data/qualityChecks';
import { INTAKE_NUMERIC_EVIDENCE, INTAKE_NUMERIC_EVIDENCE_SHA256 } from '../../data/internal-qc/intake-numeric-2026-09-11/intakeNumericEvidence.mjs';
import { approximatelyEqual, normalizationSampleStatus, parseTsv, qualityCheck, type EvidenceRow, type MatrixMeasurement } from './internalQc.mjs';
import { R460_NORMALIZATION } from './internalQcR460.mjs';

const AUDIT = 'data/intake/september5-2026/audit-current.generated.json';
const digest = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const same = (a: EvidenceRow, b: EvidenceRow): boolean => [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => a[k] === b[k]);

export interface IntakeR460Request {
  datasetId: string; trackId: string; contrastId: string; config: EvidenceRow;
  currentInputPath: string; matrix: Pick<MatrixMeasurement, 'rows' | 'samples' | 'sums'>;
}

export function createIntakeNumericR460Reader(root: string, options: { readBytes?: (absolutePath: string) => Buffer; fingerprint?: (absolutePath: string) => string } = {}) {
  const read = options.readBytes ?? ((path: string) => readFileSync(path));
  const current = (path: string): string => options.fingerprint ? options.fingerprint(resolve(root, path)) : digest(read(resolve(root, path)));
  const json = (path: string): any => JSON.parse(read(resolve(root, path)).toString('utf8'));
  let cache: { sealed: any; replays: any; audit: any; studies: any[]; analyses: any[] } | undefined;
  return {
    evaluate(request: IntakeR460Request): { countConservation: QualityCheck; normalization: QualityCheck; sourceRelationship: QualityCheck } {
      const paths = new Set<string>([R460_NORMALIZATION, AUDIT, INTAKE_NUMERIC_EVIDENCE]);
      const check = (id: string, label: string, status: QualityCheck['status'], note: string): QualityCheck => qualityCheck(id, label, status, note, [...paths]);
      const isMatrix = request.config.input_kind === 'matrix';
      try {
        if (!cache) {
          const sealedBytes = read(resolve(root, INTAKE_NUMERIC_EVIDENCE));
          if (digest(sealedBytes) !== INTAKE_NUMERIC_EVIDENCE_SHA256) throw new Error('Reviewed intake evidence seal differs');
          cache = { sealed: JSON.parse(sealedBytes.toString('utf8')), replays: json(R460_NORMALIZATION), audit: json(AUDIT),
            studies: json('data/intake/september5-2026/studies.json'), analyses: json('data/intake/september5-2026/analyses.json') };
          current(R460_NORMALIZATION); current(AUDIT);
        }
        const { sealed, replays, audit, studies, analyses } = cache;
        const study = studies.find((s) => s.id === request.datasetId), track = study?.tracks.find((t: any) => t.id === request.trackId);
        if (!study || !track) throw new Error('Unknown intake source binding');
        // 1. Deposited source -> prepared matrix: the sealed reconstruction, when every source-side pin is current.
        const entry = sealed.records.find((r: any) => r.datasetId === request.datasetId && r.trackId === request.trackId && r.contrastId === request.contrastId);
        if (!entry) throw new Error('No sealed source reconstruction for this comparison');
        paths.add(entry.artifactPath);
        const artifactBytes = read(resolve(root, entry.artifactPath));
        if (digest(artifactBytes) !== entry.artifactSha256) throw new Error('Sealed artifact checksum differs');
        const artifact = JSON.parse(artifactBytes.toString('utf8'));
        const manifestPath = `${study.dir}/metadata/${study.accession}_source_files.tsv`;
        const rawPaths = parseTsv(read(resolve(root, manifestPath)).toString('utf8')).map((r) => r.local_path);
        const sourceSide = [track.matrix, track.samplesheet, manifestPath, ...rawPaths, 'data/internal-qc/intake-numeric-2026-09-11/source_replay.py'];
        for (const path of sourceSide) {
          paths.add(path);
          if (!artifact.fingerprints?.[path] || current(path) !== artifact.fingerprints[path]) throw new Error(`Source-side dependency changed: ${path}`);
        }
        const s = artifact.source;
        const sourceGood = s.sourceRows === s.preparedRows && s.sourceRows > 0 && s.missingRows === 0 && s.extraRows === 0 && s.invalidValues === 0 && s.mismatches === 0
          && s.comparedValues === s.preparedRows * s.sampleCount
          && s.samples.every((r: any) => finite(r.sourceSum) && finite(r.preparedSum) && r.mismatches === 0 && approximatelyEqual(r.sourceSum, r.preparedSum));
        // 2. Prepared matrix -> fit matrix and displayed outputs: the current September 5 audit.
        const analysis = analyses.find((a: any) => a.studyId === request.datasetId && a.track === request.trackId && a.contrast === request.contrastId);
        const row = audit.analyses?.find((a: any) => a.datasetId === request.datasetId && a.track === request.trackId && a.contrast === request.contrastId);
        const dePath = `${study.dir}/processed/${request.config.id}_DE.tsv`;
        paths.add(dePath);
        const auditGood = !!analysis && analysis.analysisId === request.config.id && !!row && row.analysisId === request.config.id
          && row.deSha256 === digest(read(resolve(root, dePath))) && row.deTrace === 'pass' && row.expressionTrace === 'pass'
          && row.countConservation === (isMatrix ? 'not_applicable_normalized_input' : 'pass');
        const sums = request.matrix.samples.every((sample) => {
          const source = s.samples.find((r: any) => r.sample === sample);
          return !!source && finite(request.matrix.sums[sample]) && (isMatrix || approximatelyEqual(source.sourceSum, request.matrix.sums[sample]));
        });
        // 3. Numeric model: the R 4.6.0 replay of this comparison.
        const replay = replays.records.find((r: any) => r.configId === request.config.id && r.datasetId === request.datasetId && r.trackId === request.trackId && r.contrastId === request.contrastId);
        if (!replay) throw new Error('No R 4.6.0 numeric replay for this comparison');
        paths.add(replay.replayFile);
        const replayCurrent = same(replay.config, request.config) && current(replay.replayFile) === replay.replaySha256
          && current(replays.script) === replay.scriptSha256 && current(replays.deCommon) === replay.deCommonSha256
          && Object.entries(replay.fingerprints as Record<string, string>).every(([path, expected]) => current(path) === expected)
          && Object.keys(replay.fingerprints).includes(request.currentInputPath);
        const samplesGood = replay.samples?.length === request.matrix.samples.length && replay.samples.every((r: any) =>
          normalizationSampleStatus(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)])), request.config.input_kind, request.matrix.sums[String(r.sample)]) === 'pass');
        const modelGood = replayCurrent && replay.status === 'pass' && samplesGood && replay.matchedRows === replay.existingRows;
        return {
          countConservation: check('count_conservation', 'Count conservation', isMatrix ? 'not_applicable' : sourceGood && auditGood && sums ? 'pass' : 'review', isMatrix
            ? 'The deposited source is normalized expression; raw-count conservation does not apply.'
            : `${s.comparedValues.toLocaleString('en-US')} deposited source values were reconstructed into the unchanged prepared matrix, and every prepared count is conserved in the R 4.6.0 symbol-aggregated fit matrix (unmapped source IDs kept) for all ${request.matrix.samples.length} samples in this contrast. This is arithmetic evidence under the declared mapping.`),
          normalization: check('normalization', 'Normalization and transformation', modelGood ? 'pass' : replayCurrent ? 'review' : 'not_assessed',
            modelGood ? `An independent R ${replay.software.R} / edgeR ${replay.software.edgeR} / limma ${replay.software.limma} replay of this comparison reproduces all ${replay.existingRows.toLocaleString('en-US')} published DE rows across logFC, statistic, P value and adjusted P value within absolute 0.000001 + relative 0.000001 tolerance${request.config.input_kind === 'counts' ? ', and its library sizes and TMM factors match the comparison\'s normalization sidecar' : ''}. Biological model appropriateness, species, annotation and author-result agreement remain separate checks.`
              : replayCurrent ? `The R 4.6.0 numeric replay has a discrepancy: ${replay.note}` : 'The R 4.6.0 numeric replay is stale against the current configuration, inputs or outputs.'),
          sourceRelationship: check('source_reconstruction', 'Source to prepared input', sourceGood && auditGood ? 'pass' : 'review',
            'Reconstructed the local deposited source into the unchanged prepared matrix, and the prepared matrix into the current symbol-aggregated fit matrix. This does not establish remote source authenticity or annotation validity.'),
        };
      } catch (error) {
        const note = `Current intake evidence is unavailable or stale: ${error instanceof Error ? error.message : String(error)}`;
        return {
          countConservation: check('count_conservation', 'Count conservation', isMatrix ? 'not_applicable' : 'not_assessed', note),
          normalization: check('normalization', 'Normalization and transformation', 'not_assessed', note),
          sourceRelationship: check('source_reconstruction', 'Source to prepared input', 'not_assessed', note),
        };
      }
    },
  };
}
