import {describe, expect, it} from 'vitest';
import {assessAuthorConcordance} from '../data/authorConcordance';
import {requireAuthorValidation, type AuthorValidationRecord} from '../data/authorValidation';
import {getDataset} from '../data/datasets';

function fixture(): AuthorValidationRecord {
  const base = structuredClone(requireAuthorValidation('mouse_mhypoa_palmitate_gse280030'));
  base.datasetId = 'gse148252';
  base.contrastCount = 4;
  base.scopedComparisons = getDataset(base.datasetId)!.contrasts.map((contrast, index) => {
    const comparison = structuredClone(base.directComparison!);
    comparison.contrast = contrast.id;
    comparison.evidenceFingerprint = String(index + 1).repeat(64);
    comparison.metrics = {localGenes: 100, authorGenes: 100, sharedGenes: 100,
      localCoverage: 1, authorCoverage: 1, pearsonLogFC: 0.99, spearmanLogFC: 0.99,
      signComparableGenes: 100, signConcordance: 0.99, effectScaleGenes: 100, effectScaleRatio: 1,
      medianAbsLogFCDelta: 0.01};
    const comparability = structuredClone(base.verification.comparability);
    comparability.registeredContrastIds = [contrast.id];
    return {datasetId: base.datasetId, trackId: 'hypothalamus', contrastId: contrast.id,
      configId: `config-${index}`, localReference: {path: `output-${index}.tsv`, bytes: 100, sha256: String(index + 1).repeat(64)},
      comparison, comparability};
  });
  return base;
}

describe('separate author comparisons', () => {
  it('requires every registered comparison for the dataset badge', () => {
    const record = fixture();
    expect(assessAuthorConcordance(record).status).toBe('pass');
    record.scopedComparisons!.pop();
    expect(assessAuthorConcordance(record).status).toBe('not_assessed');
    expect(assessAuthorConcordance(record, 'ko_vs_wt_dark').status).toBe('pass');
    expect(assessAuthorConcordance(record, 'light_vs_dark_ko').status).toBe('not_assessed');
  });
  it('does not pool coverage or borrow a passing numerical route', () => {
    const record = fixture();
    Object.assign(record.scopedComparisons![1].comparison.metrics,
      {sharedGenes: 89, authorCoverage: 0.89, localCoverage: 0.89, signComparableGenes: 89, effectScaleGenes: 89});
    expect(assessAuthorConcordance(record).status).toBe('review');
    expect(assessAuthorConcordance(record, 'ko_vs_wt_light').status).toBe('review');
    expect(assessAuthorConcordance(record, 'ko_vs_wt_dark').status).toBe('pass');
    const check = assessAuthorConcordance(record).checks.find(c => c.id === 'author_coverage')!;
    expect(check.note).toContain('hypothalamus/ko_vs_wt_light');
    expect(check.note).toContain('hypothalamus/light_vs_dark_ko');
  });
  it('retains optional magnitude findings without blocking independent valid routes', () => {
    const record = fixture();
    record.scopedComparisons![1].comparison.metrics.effectScaleRatio = 2;
    const result = assessAuthorConcordance(record);
    expect(result.status).toBe('pass');
    expect(result.checks.find(c => c.id === 'author_effect_magnitude')).toMatchObject({status: 'review', required: false});
    record.scopedComparisons![0].comparison.metrics.spearmanLogFC = 0.5;
    record.scopedComparisons![0].comparison.metrics.pearsonLogFC = 0.5;
    record.scopedComparisons![1].comparison.metrics.signConcordance = 0.5;
    expect(assessAuthorConcordance(record).status).toBe('pass');
    record.scopedComparisons![0].comparison.metrics.signConcordance = 0.5;
    expect(assessAuthorConcordance(record).status).toBe('review');
  });
  it('does not display below-threshold coverage as 90 percent', () => {
    const record = fixture();
    Object.assign(record.scopedComparisons![0].comparison.metrics,
      {localGenes: 10000, authorGenes: 10000, sharedGenes: 8998, authorCoverage: 0.8998,
        localCoverage: 0.8998, signComparableGenes: 8998, effectScaleGenes: 8998});
    const result = assessAuthorConcordance(record, 'ko_vs_wt_dark');
    expect(result.status).toBe('review');
    expect(result.checks.find(c => c.id === 'author_coverage')!.note).toContain('89.98%');
  });
  it.each(['dataset', 'track', 'contrast', 'review', 'duplicate', 'config', 'output', 'fingerprint', 'malformed', 'empty'])
    ('rejects %s evidence errors', mutation => {
      const record = fixture(), entries = record.scopedComparisons!;
      if (mutation === 'dataset') entries[0].datasetId = 'gse262407';
      if (mutation === 'track') entries[0].trackId = 'other';
      if (mutation === 'contrast') entries[0].comparison.contrast = entries[1].contrastId;
      if (mutation === 'review') entries[0].comparability.registeredContrastIds = [entries[1].contrastId];
      if (mutation === 'duplicate') entries.push(structuredClone(entries[0]));
      if (mutation === 'config') entries[0].configId = entries[1].configId;
      if (mutation === 'output') entries[0].localReference.path = entries[1].localReference.path;
      if (mutation === 'fingerprint') entries[0].comparison.evidenceFingerprint = entries[1].comparison.evidenceFingerprint;
      if (mutation === 'malformed') entries[0].comparability = {} as typeof entries[0]['comparability'];
      if (mutation === 'empty') record.scopedComparisons = [];
      expect(assessAuthorConcordance(record).status).toBe('not_assessed');
    });
  it('retains a failure in any comparison', () => {
    const record = fixture();
    record.scopedComparisons![3].comparison.metrics.pearsonLogFC = 1.01;
    expect(assessAuthorConcordance(record).status).toBe('fail');
  });
});
