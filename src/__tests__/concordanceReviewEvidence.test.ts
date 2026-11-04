import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import originalDefinitions from '../../data/author-validation/concordance-reviews.json';
import historicalDefinitions from '../../data/quality/round2-2026-09-05/concordance-reviews.snapshot.json';
import { validateConcordanceReviews } from '../../scripts/lib/concordanceReviewEvidence.mjs';
import { validateConcordanceReviewLedger } from '../../scripts/lib/concordanceReviewLedger.mjs';
import { AUTHOR_VALIDATION_REPORT, requireAuthorValidation } from '../data/authorValidation';
import { assessAuthorConcordance } from '../data/authorConcordance';
import { ACTIVE_CONCORDANCE_REVIEWS, ALL_CONCORDANCE_REVIEWS } from '../data/concordanceReviews';

// Current state: the R 4.6.0 regeneration changed every comparison the sealed
// concordance-reviews.json bound, so those reviews expired and the active review of each
// dataset/dimension is its successor re-review (data/quality/regeneration-r460-2026-09-25/README.md).
const definitions = ACTIVE_CONCORDANCE_REVIEWS;
const validate = (reviews = structuredClone(definitions), records = structuredClone(AUTHOR_VALIDATION_REPORT.records)) =>
  validateConcordanceReviews(process.cwd(), reviews, records);

describe('source-bound effect-definition reviews', () => {
  it('verifies every pinned source and current comparison', () => expect(validate()).toBe(8));
  it('keeps each expired original review as verified history behind its successor', () => {
    expect(validateConcordanceReviewLedger(process.cwd(), ALL_CONCORDANCE_REVIEWS, structuredClone(AUTHOR_VALIDATION_REPORT.records)))
      .toEqual({ active: 8, expired: 8 });
    expect(() => validateConcordanceReviews(process.cwd(), originalDefinitions, AUTHOR_VALIDATION_REPORT.records))
      .toThrow('Stale or unsupported');
  });
  it('rejects source bytes changed after semantic review', () => {
    expect(() => validateConcordanceReviews(process.cwd(), definitions, AUTHOR_VALIDATION_REPORT.records,
      path => path.endsWith('GSE128148_DE.tsv') ? Buffer.from('changed') : readFileSync(path))).toThrow('Changed definition-review source');
  });
  it.each(['evidenceFingerprint', 'orientation', 'localMethod', 'authorMethod'] as const)('rejects changed %s', key => {
    const records = structuredClone(AUTHOR_VALIDATION_REPORT.records);
    records.find(row => row.datasetId === definitions.reviews[0].datasetId)!.directComparison![key] = 'changed';
    expect(() => validate(structuredClone(definitions), records)).toThrow('Stale or unsupported');
  });
  it('rejects a replaced scientific concern and duplicated review', () => {
    const records = structuredClone(AUTHOR_VALIDATION_REPORT.records);
    records.find(row => row.datasetId === definitions.reviews[0].datasetId)!.verification.comparability.dimensions.effects.note = 'New concern';
    expect(() => validate(structuredClone(definitions), records)).toThrow('Stale or unsupported');
    const reviews = structuredClone(definitions);
    reviews.reviews.push(reviews.reviews[0]);
    expect(() => validate(reviews)).toThrow('Duplicate definition review');
  });
  it('rejects unpinned or escaped evidence', () => {
    const reviews = structuredClone(definitions);
    reviews.reviews[0].sources = [reviews.reviews[0].sources[0]];
    expect(() => validate(reviews)).toThrow('Incomplete');
    reviews.reviews[0].sources.push({ path: '../outside', sha256: 'a'.repeat(64) });
    expect(() => validate(reviews)).toThrow('escapes repository');
  });
  // Reviews that should flip only the effect check: added since the round-two
  // snapshot (so the historical assessment is still 'review'), effect-only (the
  // THRB pair also needs its cohort review, covered separately), and promotable.
  // A prior finding of 'different' is a real estimator disagreement, never promoted.
  const historical = new Set(historicalDefinitions.reviews.map(entry => `${entry.datasetId}/${entry.dimension}`));
  const alsoCohortReviewed = new Set(definitions.reviews
    .filter(entry => entry.dimension === 'cohort').map(entry => entry.datasetId));
  const effectOnlyPromotions = definitions.reviews.filter(entry => entry.dimension === 'effects'
    && !historical.has(`${entry.datasetId}/${entry.dimension}`)
    && !alsoCohortReviewed.has(entry.datasetId)
    && entry.priorReview.status !== 'different');
  const differentEstimatorReviews = definitions.reviews.filter(entry => entry.priorReview.status === 'different');

  it('covers every promotable effect-only review and at least one refused review', () => {
    expect(effectOnlyPromotions.length).toBeGreaterThan(0);
    expect(differentEstimatorReviews.length).toBeGreaterThan(0);
  });

  it.each(differentEstimatorReviews.map(entry => entry.datasetId))(
    'never promotes a different effect estimator to a concordance pass for %s', id => {
      const record = requireAuthorValidation(id);
      expect(record.verification.comparability.dimensions.effects.status).toBe('different');
      expect(assessAuthorConcordance(record, undefined, definitions).status).toBe('review');
    });

  it.each(effectOnlyPromotions.map(entry => entry.datasetId))('changes only the reviewed effect check for %s', id => {
    const record = requireAuthorValidation(id);
    const before = assessAuthorConcordance(record, undefined, historicalDefinitions);
    const after = assessAuthorConcordance(record, undefined, definitions);
    expect(before.status).toBe('review');
    expect(after.status).toBe('pass');
    expect(after.checks.filter(check => check.id !== 'author_effects')).toEqual(before.checks.filter(check => check.id !== 'author_effects'));
    expect(record.verification.comparability.dimensions.effects.status).not.toBe('compatible');
    expect(assessAuthorConcordance(record, 'unsupported', definitions).status).not.toBe('pass');
  });
  it('preserves other unresolved source, cohort and identifier questions', () => {
    for (const id of ['cattle_hypo_nutrition_gse153495', 'mouse_pvn_hfd_gse198437', 'mouse_hypo_spatial_aging_gse270383', 'mouse_hypo_celastrol_gse252779']) {
      expect(assessAuthorConcordance(requireAuthorValidation(id), undefined, definitions).status).toBe('review');
    }
  });
  it('requires both source-bound cohort and effect reviews for the six-library THRB comparison', () => {
    const id = 'mouse_hypo_thrb_k146q_gse167105';
    const record = requireAuthorValidation(id);
    const before = assessAuthorConcordance(record, undefined, historicalDefinitions);
    const after = assessAuthorConcordance(record, undefined, definitions);
    expect(before.status).toBe('review');
    expect(after.status).toBe('pass');
    expect(after.checks.filter(check => !['author_cohort', 'author_effects'].includes(check.id)))
      .toEqual(before.checks.filter(check => !['author_cohort', 'author_effects'].includes(check.id)));
    for (const dimension of ['cohort', 'effects']) {
      const without = structuredClone(definitions);
      without.reviews = without.reviews.filter(entry => entry.datasetId !== id || entry.dimension !== dimension);
      expect(assessAuthorConcordance(record, undefined, without).status).toBe('review');
    }
    expect(after.checks.find(check => check.id === 'author_effect_correlation')?.status).toBe('review');
    expect(after.checks.find(check => check.id === 'author_cohort')?.note).toContain('absent raw counts');
  });
  it('fails closed if a reviewed cohort concern or original cohort source changes', () => {
    const records = structuredClone(AUTHOR_VALIDATION_REPORT.records);
    const record = records.find(row => row.datasetId === 'mouse_hypo_thrb_k146q_gse167105')!;
    record.verification.comparability.dimensions.cohort.note = 'New mismatched genotype cohort';
    expect(() => validate(structuredClone(definitions), records)).toThrow('Stale or unsupported');
    expect(assessAuthorConcordance(record, undefined, definitions).status).toBe('review');
    expect(() => validateConcordanceReviews(process.cwd(), definitions, AUTHOR_VALIDATION_REPORT.records,
      path => path.endsWith('PMC8410017.xml') ? Buffer.from('different cohort') : readFileSync(path))).toThrow('Changed definition-review source');
  });
});
