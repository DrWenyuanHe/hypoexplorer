import { describe, expect, it } from 'vitest';
import ledger from '../../data/internal-qc/assessments.generated.json';
import { separateInternalQc } from '../data/pipelineQc';
import { aggregateQualityChecks, type QualityAssessment, type QualityCheck } from '../data/qualityChecks';
import { datasetQuality } from '../data/datasetQualityR460';
import { requireAuthorValidation } from '../data/authorValidation';

const check = (id: string, status: QualityCheck['status'], required?: boolean): QualityCheck => ({
  id, status, required, label: id, note: 'Retained evidence note', evidence: ['source.json'],
});
const source = (checks: QualityCheck[]): QualityAssessment => ({
  checks, status: aggregateQualityChecks(checks), scope: 'Selected comparison', policyVersion: 'internal-qc-v1',
});

describe('pipeline and experimental-design separation', () => {
  it.each(['review', 'not_assessed', 'fail'] as const)('keeps replication %s visible beside passing processing', status => {
    const input = source([check('normalization', 'pass'), check('independent_replication', status)]);
    const before = JSON.stringify(input);
    const result = separateInternalQc(input);
    expect(result.pipelineQc.status).toBe('pass');
    expect(result.experimentalDesign.status).toBe(status);
    expect(result.experimentalDesign.checks[0]).toBe(input.checks[1]);
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each(['normalization', 'source_integrity', 'count_conservation', 'source_species_feature_mapping', 'source_pairing_model', 'future_check'])('keeps unresolved %s in pipeline QC', id => {
    const result = separateInternalQc(source([check(id, 'review'), check('independent_replication', 'pass')]));
    expect(result.pipelineQc.status).toBe('review');
    expect(result.experimentalDesign.status).toBe('pass');
  });

  it('does not transfer missing evidence into a pass in either domain', () => {
    expect(separateInternalQc(source([])).pipelineQc.status).toBe('not_assessed');
    expect(separateInternalQc(source([])).experimentalDesign.status).toBe('not_assessed');
    expect(separateInternalQc(source([check('matrix_values', 'pass')])).experimentalDesign.status).toBe('not_assessed');
    expect(separateInternalQc(source([check('independent_replication', 'pass')])).pipelineQc.status).toBe('not_assessed');
  });

  it('retains optional and explicitly inapplicable evidence without changing aggregation', () => {
    const result = separateInternalQc(source([
      check('normalization', 'pass'), check('optional_diagnostic', 'review', false),
      check('independent_replication', 'not_applicable'), check('retained_sample_support', 'review', false),
    ]));
    expect(result.pipelineQc.status).toBe('pass');
    expect(result.experimentalDesign.status).toBe('not_applicable');
    expect(result.experimentalDesign.checks).toHaveLength(2);
    expect(result.pipelineQc.checks[1].required).toBe(false);
  });

  it('preserves every recorded check exactly once across every dataset, contrast and intake track', () => {
    for (const row of ledger.records) {
      const tracks = 'tracks' in row ? Object.values(row.tracks ?? {}) : [];
      const inputs = [row.assessment, ...Object.values(row.contrasts), ...tracks.flatMap(track => [track.assessment, ...Object.values(track.contrasts)])];
      for (const input of inputs) {
        const result = separateInternalQc(input as QualityAssessment);
        const combined = [...result.pipelineQc.checks, ...result.experimentalDesign.checks];
        expect(combined).toHaveLength(input.checks.length);
        for (const original of input.checks) expect(combined.filter(item => item.id === original.id)).toEqual([original]);
        expect(result.pipelineQc.scope).toBe(input.scope);
        expect(result.experimentalDesign.scope).toBe(input.scope);
      }
    }
  });

  it('preserves known pipeline problems and scoped replication decisions', () => {
    for (const id of ['gse135007', 'gse314184']) {
      expect(datasetQuality(requireAuthorValidation(id)).pipelineQc.status).toBe('review');
    }
    const glucose = requireAuthorValidation('gse262407');
    const quality = datasetQuality(glucose);
    expect(quality.pipelineQc.status).toBe('pass');
    expect(quality.experimentalDesign.status).toBe('review');
    for (const [id, input] of Object.entries(ledger.records.find(row => row.datasetId === 'gse262407')!.contrasts)) {
      const expected = input.checks.find((item: QualityCheck) => item.id === 'independent_replication')!;
      expect(datasetQuality(glucose, id).experimentalDesign.status).toBe(expected.status);
    }
  });

  it('never borrows the dataset pass for an unknown comparison', () => {
    const result = datasetQuality(requireAuthorValidation('gse262407'), 'unknown');
    expect(result.pipelineQc.status).toBe('not_assessed');
    expect(result.experimentalDesign.status).toBe('not_assessed');
  });
});
