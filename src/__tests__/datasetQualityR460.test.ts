import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assessAuthorConcordance } from '../data/authorConcordance';
import { assessCurrentAuthorConcordance } from '../data/authorConcordanceR460';
import { AUTHOR_VALIDATION_REPORT, requireAuthorValidation } from '../data/authorValidation';
import { datasetQuality as sealedDatasetQuality } from '../data/datasetQuality';
import { datasetQuality, qualitySearchText } from '../data/datasetQualityR460';

// The R 4.6.0 regeneration changed every comparison the sealed concordance-reviews.json bound.
// The sealed datasetQuality.ts still reads only that ledger; its successor applies the active
// re-reviews (data/quality/regeneration-r460-2026-09-25/README.md).
const SUCCESSOR_LEDGER = 'data/author-validation/regeneration-r460-2026-09-25/concordance-reviews-r460.json';
const RESTORED = ['chicken_hypo_development_gse104255', 'mouse_arc_corticosterone_gse128148',
  'mouse_arc_hfd_gse284408', 'mouse_hypo_thrb_k146q_gse167105'];
const count = (quality: typeof datasetQuality, key: 'pipelineQc' | 'experimentalDesign' | 'authorConcordance', status: string) =>
  AUTHOR_VALIDATION_REPORT.records.filter((record) => quality(record)[key].status === status).length;

describe('current quality decisions after the R 4.6.0 regeneration', () => {
  it('restores the 27 author-concordance passes through the successor re-reviews', () => {
    expect(count(datasetQuality, 'authorConcordance', 'pass')).toBe(27);
    // Without the successor ledger, the four re-reviewed comparisons would drop to review.
    expect(count(sealedDatasetQuality, 'authorConcordance', 'pass')).toBe(23);
    const changed = AUTHOR_VALIDATION_REPORT.records
      .filter((record) => datasetQuality(record).authorConcordance.status !== sealedDatasetQuality(record).authorConcordance.status)
      .map((record) => record.datasetId).sort();
    expect(changed).toEqual([...RESTORED].sort());
  });

  it('changes only author concordance, never pipeline QC or experimental design', () => {
    for (const record of AUTHOR_VALIDATION_REPORT.records) {
      const current = datasetQuality(record);
      const sealed = sealedDatasetQuality(record);
      expect(current.internalQc, record.datasetId).toEqual(sealed.internalQc);
      expect(current.pipelineQc, record.datasetId).toEqual(sealed.pipelineQc);
      expect(current.experimentalDesign, record.datasetId).toEqual(sealed.experimentalDesign);
    }
  });

  it.each(RESTORED)('passes %s only through reviews cited from the successor ledger', (id) => {
    const record = requireAuthorValidation(id);
    expect(assessAuthorConcordance(record).status).toBe('review');
    const current = assessCurrentAuthorConcordance(record);
    expect(current.status).toBe('pass');
    const reviewed = current.checks.filter((check) => ['author_cohort', 'author_effects'].includes(check.id) && check.evidence);
    expect(reviewed.length).toBeGreaterThan(0);
    for (const check of reviewed) {
      expect(check.status).toBe('pass');
      expect(check.evidence).toContain(SUCCESSOR_LEDGER);
      expect(check.evidence).not.toContain('data/author-validation/concordance-reviews.json');
    }
    expect(qualitySearchText(record)).toContain('Author concordance passed');
  });

  it('matches the combined quality ledger built by scripts/build_quality_report_r460.mts', () => {
    const report = JSON.parse(readFileSync('data/quality/assessments.generated.json', 'utf8'));
    const passes = report.records.filter((row: { authorConcordance: { status: string } }) => row.authorConcordance.status === 'pass');
    expect(passes).toHaveLength(27);
    for (const id of RESTORED) {
      expect(report.records.find((row: { datasetId: string }) => row.datasetId === id).authorConcordance)
        .toEqual(datasetQuality(requireAuthorValidation(id)).authorConcordance);
    }
  });
});
