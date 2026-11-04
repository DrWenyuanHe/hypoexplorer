import { describe, expect, it } from 'vitest';
import { aggregateQualityChecks, type QualityCheck } from '../data/qualityChecks';
import { getInternalQc, validateInternalQcRecords } from '../data/internalQc';
import { DATASETS } from '../data/datasets';
import { countConservationSampleStatus, designRank, manifestRowForFile, matrixValueCheck, measureMatrix, modelCheck, normalizationSampleStatus, numeric, replicationCheck, replayArtifactMatches, replayIsCurrent, sourceHashMatches, type NormalizationReplay } from '../../scripts/lib/internalQc.mjs';
import ledger from '../../data/internal-qc/assessments.generated.json';

const check = (status: QualityCheck['status'], required = true): QualityCheck => ({ id: status, label: status, status, required, note: '' });

describe('independent internal QC status', () => {
  it('never turns missing evidence or an empty checklist green', () => {
    expect(aggregateQualityChecks([])).toBe('not_applicable');
    expect(aggregateQualityChecks([check('pass'), check('not_assessed')])).toBe('not_assessed');
    expect(aggregateQualityChecks([check('pass'), check('not_applicable')])).toBe('pass');
    expect(aggregateQualityChecks([check('pass'), check('fail')])).toBe('fail');
    expect(aggregateQualityChecks([check('review'), check('fail')])).toBe('fail');
    expect(aggregateQualityChecks([check('pass'), check('review', false)])).toBe('pass');
  });

  it('does not inherit the dataset assessment for an unknown comparison', () => {
    expect(getInternalQc(DATASETS[0].id, 'unregistered-contrast')).toBeUndefined();
    expect(getInternalQc('unknown-dataset')).toBeUndefined();
  });

  it('records all registered comparisons without using the author outcome', () => {
    for (const dataset of DATASETS) {
      const result = getInternalQc(dataset.id);
      expect(result, dataset.id).toBeDefined();
      for (const contrast of dataset.contrasts) expect(getInternalQc(dataset.id, contrast.id), `${dataset.id}/${contrast.id}`).toBeDefined();
      if (result?.status === 'pass') expect(result.checks.every((item) => item.status === 'pass' || item.status === 'not_applicable' || item.required === false)).toBe(true);
    }
  });

  it('audits all dedicated limma-trend contrasts without borrowing another comparison result', () => {
    for (const id of ['mouse_pomc_maternal_hfd_gse135639', 'mouse_scn_hfd_gse157077']) {
      const dataset = DATASETS.find((item) => item.id === id)!;
      for (const contrast of dataset.contrasts) {
        const result = getInternalQc(id, contrast.id)!;
        for (const checkId of ['matrix_values', 'sample_assignment', 'normalization', 'model_validity']) {
          expect(result.checks.find((item) => item.id === checkId)?.status, `${id}/${contrast.id}/${checkId}`).toBe('pass');
        }
        const replicationStatus = id === 'mouse_pomc_maternal_hfd_gse135639' ? 'review' : 'not_assessed';
        expect(result.checks.find((item) => item.id === 'independent_replication')?.status).toBe(replicationStatus);
        expect(result.status).toBe(replicationStatus);
      }
      expect(getInternalQc(id, 'unregistered-comparison')).toBeUndefined();
    }
  });

  it('rejects omitted comparisons, duplicate datasets, invalid check states and forged overall passes', () => {
    expect(() => validateInternalQcRecords([])).toThrow(/missing registered/);
    expect(() => validateInternalQcRecords([...ledger.records, ledger.records[0]])).toThrow(/duplicate/);
    const missingContrast = structuredClone(ledger.records);
    missingContrast[0].contrasts = {} as typeof missingContrast[0]['contrasts'];
    expect(() => validateInternalQcRecords(missingContrast)).toThrow(/contrast coverage/);
    const forged = structuredClone(ledger.records);
    forged[0].assessment.status = 'pass';
    forged[0].assessment.checks[0].status = 'not_assessed';
    expect(() => validateInternalQcRecords(forged)).toThrow(/aggregate/);
    const contrastFailure = structuredClone(ledger.records);
    const comparison = Object.values(contrastFailure[0].contrasts).find((value) => value !== undefined)!;
    comparison.checks[0].status = 'fail';
    comparison.status = 'fail';
    expect(() => validateInternalQcRecords(contrastFailure)).toThrow(/disagree with its contrasts/);
  });
});

describe('source and preprocessing evidence', () => {
  it('reads existing local_path manifests without matching a different source directory', () => {
    const rows = [{ local_path: 'data/source.tsv', sha256: 'pinned' }];
    expect(manifestRowForFile(rows, 'data/source.tsv')?.sha256).toBe('pinned');
    expect(manifestRowForFile(rows, 'other/source.tsv')).toBeUndefined();
    expect(manifestRowForFile([{ file: 'source.tsv', sha256: 'pinned' }], 'data/source.tsv')?.sha256).toBe('pinned');
  });
  it('accepts a pinned normalized-text checksum while rejecting unpinned content changes', () => {
    expect(sourceHashMatches('new-crlf', 'normalized', 'original-lf', 'normalized')).toBe(true);
    expect(sourceHashMatches('new-crlf', 'original-lf', 'original-lf')).toBe(true);
    expect(sourceHashMatches('modified', 'modified', 'original', 'normalized-original')).toBe(false);
  });

  it('requires conservation evidence to agree with the current matrix, not only a recorded zero', () => {
    const row = { count_conservation_delta: '0', output_library_size: '120' };
    expect(countConservationSampleStatus(row, 120)).toBe('pass');
    expect(countConservationSampleStatus(row, 140)).toBe('fail');
    expect(countConservationSampleStatus({ ...row, count_conservation_delta: '2' }, 120)).toBe('fail');
    expect(countConservationSampleStatus({ output_library_size: '120' }, 120)).toBe('not_assessed');
    expect(countConservationSampleStatus({ collapsed_sum: '120', partition_delta: '0' }, 120)).toBe('pass');
    expect(countConservationSampleStatus({ collapsed_sum: '120', partition_delta: '0' }, 121)).toBe('fail');
  });

  it('invalidates numeric replays when the input, output, configuration or replay code changes', () => {
    const replay: NormalizationReplay = { datasetId: 'x', contrastId: 'c', config: { input_kind: 'counts' }, fingerprints: { input: 'a', sheet: 'b', output: 'c' }, scriptSha256: 'script', replayFile: 'audit.json', status: 'pass', note: '' };
    const paths = ['input', 'sheet', 'output'];
    expect(replayIsCurrent(replay, replay.config, paths, replay.fingerprints, 'script')).toBe(true);
    for (const path of paths) expect(replayIsCurrent(replay, replay.config, paths, { ...replay.fingerprints, [path]: 'changed' }, 'script')).toBe(false);
    expect(replayIsCurrent(replay, { input_kind: 'matrix' }, paths, replay.fingerprints, 'script')).toBe(false);
    expect(replayIsCurrent(replay, replay.config, paths, replay.fingerprints, 'modified-script')).toBe(false);
    expect(replayIsCurrent(replay, replay.config, ['input', 'sheet'], replay.fingerprints, 'script')).toBe(false);
  });

  it('cannot reuse a prior pass against a replaced runtime artifact or altered result', () => {
    const replay: NormalizationReplay = { datasetId: 'x', contrastId: 'c', config: {}, fingerprints: {}, scriptSha256: 's', replayFile: 'pinned.json', replaySha256: 'bytes', evidenceId: 'runtime-a', status: 'pass', existingRows: 30, matchedRows: 30, samples: [], note: '' };
    expect(replayArtifactMatches(replay, 'bytes', replay)).toBe(true);
    expect(replayArtifactMatches(replay, 'replaced-bytes', replay)).toBe(false);
    expect(replayArtifactMatches(replay, 'bytes', { ...replay, evidenceId: 'runtime-b' })).toBe(false);
    expect(replayArtifactMatches(replay, 'bytes', { ...replay, status: 'review' })).toBe(false);
    expect(replayArtifactMatches(replay, 'bytes', { ...replay, matchedRows: 29 })).toBe(false);
  });

  it('does not compare filtered effective libraries to unfiltered input libraries', () => {
    const row = { library_size: '57888914', tmm_norm_factor: '1.01906880227632', effective_library_size: '58947262.4135216' };
    expect(normalizationSampleStatus(row, 'counts', 57888914)).toBe('pass');
    expect(normalizationSampleStatus({ ...row, normalization_library_size: '1' }, 'counts', 57888914)).toBe('fail');
    expect(normalizationSampleStatus({ ...row, tmm_norm_factor: '0' }, 'counts', 57888914)).toBe('fail');
    for (const invalid of ['-1', '0', 'NaN', 'Infinity']) {
      expect(normalizationSampleStatus({ ...row, effective_library_size: invalid }, 'counts', 57888914)).toBe('fail');
      expect(normalizationSampleStatus({ ...row, normalization_library_size: invalid }, 'counts', 57888914)).toBe('fail');
    }
    expect(normalizationSampleStatus({}, 'counts', 57888914)).toBe('not_assessed');
  });

  it('checks normalized transformation totals against the current matrix', () => {
    const row = { transform_max_abs_delta: '0', log2_expression_sum: '-100' };
    expect(normalizationSampleStatus(row, 'matrix', -100)).toBe('pass');
    expect(normalizationSampleStatus(row, 'matrix', 100)).toBe('fail');
    expect(normalizationSampleStatus({ ...row, transform_max_abs_delta: '0.1' }, 'matrix', -100)).toBe('fail');
  });
});

describe('matrix measurements', () => {
  it('distinguishes missing values from measured zero and rejects infinities', () => {
    expect(numeric('')).toBeNull();
    expect(numeric('NA')).toBeNull();
    expect(numeric(null)).toBeNull();
    expect(numeric('Infinity')).toBeNull();
    expect(numeric('0')).toBe(0);
  });

  it('accepts negative normalized log values but rejects negative counts', () => {
    const matrix = measureMatrix('gene\tA\tB\ng1\t-4.17\t2\ng2\t0\t1', ['A', 'B']);
    expect(matrixValueCheck(matrix, 'matrix', []).status).toBe('pass');
    expect(matrixValueCheck(matrix, 'counts', []).status).toBe('fail');
  });

  it('preserves fractional estimated counts and excludes unselected sample columns', () => {
    const matrix = measureMatrix('gene,A,B,excluded\ng1,1.25,2.5,NA', ['A', 'B']);
    expect(matrixValueCheck(matrix, 'counts', []).status).toBe('pass');
    expect(matrix.sums).toEqual({ A: 1.25, B: 2.5 });
    expect(matrix.fractionalValues).toBe(2);
  });

  it('handles quoted series-matrix headers and whitespace count matrices', () => {
    expect(measureMatrix('!Series_title = test\n!series_matrix_table_begin\n"ID_REF"\t"A"\n"g1"\t"5"\n!series_matrix_table_end', ['A']).sums.A).toBe(5);
    expect(measureMatrix('gene   A B\ng1  2 3\ng2 4 5', ['A', 'B']).sums).toEqual({ A: 6, B: 8 });
  });

  it('fails missing sample columns, duplicated columns and malformed numeric rows', () => {
    for (const matrix of [
      measureMatrix('gene\tA\ng1\t2', ['A', 'B']),
      measureMatrix('gene\tA\tA\ng1\t2\t3', ['A']),
      measureMatrix('gene\tA\ng1\tNA', ['A']),
      measureMatrix('gene\tA\ng1\t2\t3', ['A']),
    ]) expect(matrixValueCheck(matrix, 'counts', []).status).toBe('fail');
    expect(matrixValueCheck(null, 'counts', []).status).toBe('not_assessed');
  });
});

describe('biological replication and model validity', () => {
  const samples = ['a', 'b', 'c', 'd', 'e', 'f'].map((sample, i) => ({ sample, group: i < 3 ? 'control' : 'case', donor: sample, batch: i < 3 ? 'one' : 'two' }));
  const baseline = ['a', 'b', 'c'];
  const cases = ['d', 'e', 'f'];

  it('requires biological units, with no shortcut through sample or BioSample counts', () => {
    expect(replicationCheck([], [], [], []).status).toBe('not_assessed');
    expect(replicationCheck(samples, baseline, cases, []).status).toBe('pass');
    expect(replicationCheck(samples.map(({ sample, group }) => ({ sample, group, biosample: sample })), baseline, cases, []).status).toBe('not_assessed');
    expect(replicationCheck(samples.map((row, i) => ({ ...row, donor: i === 0 ? '' : row.donor, biosample: row.sample, independent_biosample: 'TRUE' })), baseline, cases, []).status).toBe('not_assessed');
  });

  it('recognizes explicit animal and subject identifier fields without substituting library IDs', () => {
    for (const key of ['mouse_id', 'animal_id', 'rat', 'pig_id', 'subject_id']) {
      const identified = samples.map(({ donor, ...row }) => ({ ...row, [key]: donor }));
      expect(replicationCheck(identified, baseline, cases, []).status).toBe('pass');
      expect(replicationCheck(identified.map((row, i) => ({ ...row, [key]: String(i % 3) })), baseline, cases, []).status).toBe('review');
    }
  });

  it('does not misread a pool description as one repeated biological identity', () => {
    const pools = samples.map(({ sample, group }) => ({ sample, group, biological_unit: 'pool of three zebrafish' }));
    expect(replicationCheck(pools, baseline, cases, []).status).toBe('not_assessed');
  });

  it('flags donor pseudoreplication and low replication', () => {
    expect(replicationCheck(samples.map((row) => ({ ...row, donor: row.group })), baseline, cases, []).status).toBe('fail');
    expect(replicationCheck(samples.filter((row) => row.sample !== 'c'), ['a', 'b'], cases, []).status).toBe('review');
    expect(replicationCheck(samples.map((row, i) => ({ ...row, donor: String(i % 3) })), baseline, cases, []).status).toBe('review');
  });

  it('detects completely confounded batch and treatment rather than trusting a success flag', () => {
    expect(modelCheck(samples, 'counts', 'batch', ['edgeR-QL'], []).status).toBe('fail');
    expect(modelCheck(samples, 'counts', 'NA', ['edgeR-QL'], []).status).toBe('pass');
    expect(modelCheck(samples, 'matrix', 'NA', ['edgeR-QL'], []).status).toBe('review');
    expect(modelCheck(samples, 'counts', 'missing', ['edgeR-QL'], []).status).toBe('fail');
    expect(designRank([[1, 0, 0], [1, 0, 0], [1, 1, 1], [1, 1, 1]])).toBe(2);
  });
});
