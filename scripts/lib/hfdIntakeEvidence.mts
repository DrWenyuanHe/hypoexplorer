import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { qualityCheck } from './internalQc.mjs';
import type { QualityCheck } from '../../src/data/qualityChecks';

const DIRECTORY = 'data/intake/hfd-2026-09-12';

export function createHfdIntakeReader(root: string, read: (path: string) => Buffer) {
  const studiesPath = `${DIRECTORY}/studies.json`;
  const studies = existsSync(resolve(root, studiesPath)) ? JSON.parse(read(studiesPath).toString('utf8')) : [];
  const auditPath = `${DIRECTORY}/audit.generated.json`;
  let checked: { current: boolean; records: any[] } | undefined;
  function evidence() {
    if (checked) return checked;
    if (!existsSync(resolve(root, auditPath))) {
      checked = { current: false, records: [] };
      return checked;
    }
    const audit = JSON.parse(read(auditPath).toString('utf8'));
    const hashes = Object.entries(audit.fingerprints ?? {});
    const current = audit.schemaVersion === 1 && hashes.length > 0
      && hashes.every(([path, digest]) => existsSync(resolve(root, path))
        && createHash('sha256').update(read(path)).digest('hex') === digest);
    checked = { current, records: audit.analyses ?? [] };
    return checked;
  }
  return {
    evaluate(datasetId: string, trackId: string, contrastId: string): { preparation: QualityCheck; replication: QualityCheck; conservation: QualityCheck; normalization: QualityCheck } | null {
      const study = studies.find((row: any) => row.id === datasetId);
      if (!study) return null;
      const saved = evidence();
      const row = saved.records.find((row: any) => row.datasetId === datasetId && row.track === trackId && row.contrast === contrastId);
      const paths = [studiesPath, auditPath, ...(study.sourceReview.evidencePaths ?? [])];
      const valid = saved.current && row?.preparedInputTrace === 'pass' && row?.deTrace === 'pass' && row?.expressionTrace === 'pass';
      const preparation = qualityCheck('prepared_input_trace', 'Prepared matrix and output trace', valid ? 'pass' : 'not_assessed', valid
        ? 'Every model-input value independently matches the declared prepared-source gene mapping and aggregation. Displayed expression, effects, probabilities, standard errors and pathway outputs trace to the current analysis files. Original deposited artifacts match their retained checksums; unpublished upstream quantification is outside this check.'
        : 'The current HFD intake source/output audit is missing or stale. No earlier passing trace is inherited.', paths);
      const declared = study.sourceReview.replicationStatus;
      const status = !valid ? 'not_assessed' : ['pass', 'pass_with_notes'].includes(declared) ? 'pass'
        : declared === 'fail' ? 'fail' : declared === 'review' ? 'review' : 'not_assessed';
      const replication = qualityCheck('independent_replication', 'Independent biological replication', status,
        valid ? `${study.sourceReview.biologicalUnit} ${study.sourceReview.replicateNote} Source-defined units are retained within this track; library labels do not establish independence across tracks.`
          : 'Current source-bound sample evidence is required before applying the reviewed biological-unit assessment.', paths);
      const isCount = study.tracks.find((track: any) => track.id === trackId)?.kind === 'counts';
      const conservation = qualityCheck('count_conservation', 'Count conservation through preparation', !valid ? 'not_assessed' : isCount ? 'pass' : 'not_applicable',
        !valid ? 'Current independently replayed source and model inputs are required.' : isCount
          ? 'Independent XLSX XML extraction verifies every deposited sample count and row total; the complete prepared-to-model gene aggregation preserves every selected count and library sum. Unassigned symbols remain in the count denominator.'
          : 'The input is author PORT-normalized expression. Raw count conservation is not applicable; the independent source replay verifies aggregation on the deposited linear scale before log2(value + 1).', paths);
      const normalization = qualityCheck('normalization', 'Normalization and transformation', valid ? 'pass' : 'not_assessed', valid
        ? isCount ? 'An independent edgeR replay verifies filtering, TMM factors and effective library sizes, all modeled statistics and fitted QL standard errors against the current inputs. This does not reproduce upstream read alignment or the author significance calls.'
          : 'An independent source replay verifies every log2(PORT-normalized value + 1) entry and an independent limma fit verifies all statistics and standard errors. The author supplied the PORT normalization; raw-read quantification is outside this check.'
        : 'Current independent preparation and numerical replay evidence is required.', paths);
      return { preparation, replication, conservation, normalization };
    },
  };
}
