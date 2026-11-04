import { describe, expect, it } from 'vitest';
import { requireAuthorValidation } from '../data/authorValidation';
import { assessAuthorConcordance } from '../data/authorConcordance';

describe('complete round-two author tables', () => {
  it('retains the rat table without treating a different effect estimator as verified', () => {
    const record = requireAuthorValidation('rat_fetal_hypo_ozone_gse156859');
    expect(record.directComparison?.metrics).toMatchObject({ authorGenes: 168, sharedGenes: 168,
      signConcordance: 1, authorSignificantGenes: null, significantInBoth: null });
    expect(record.verification.comparability.dimensions.effects.status).toBe('different');
    expect(assessAuthorConcordance(record).status).toBe('review');
  });

  it('keeps missing fish genes and opposite effects in the denominators', () => {
    const record = requireAuthorValidation('zebrafish_hypo_cyp19a1b_gse299412');
    const metrics = record.directComparison!.metrics;
    expect(metrics.authorGenes).toBe(231);
    // R 4.6.0 regeneration: features without a gene symbol are no longer published, so fewer
    // author genes pair (data/quality/regeneration-r460-2026-09-25/README.md).
    expect(metrics.sharedGenes).toBe(157);
    expect(metrics.authorCoverage).toBeCloseTo(157 / 231, 7);
    expect(metrics.signConcordance).toBeCloseTo(149 / 157, 7);
    expect(assessAuthorConcordance(record).status).toBe('review');
  });

  it('does not promote a small chicken table despite strong correlation and direction', () => {
    const record = requireAuthorValidation('chicken_poah_ehc_gse298648');
    const metrics = record.directComparison!.metrics;
    expect(metrics.authorGenes).toBe(18);
    // R 4.6.0 regeneration: features without a gene symbol are no longer published, so fewer
    // author genes pair (data/quality/regeneration-r460-2026-09-25/README.md).
    expect(metrics.sharedGenes).toBe(7);
    expect(metrics.authorCoverage).toBeCloseTo(7 / 18, 7);
    expect(metrics.signConcordance).toBe(1);
    expect(metrics.pearsonLogFC).toBeGreaterThan(0.96);
    expect(assessAuthorConcordance(record).status).toBe('review');
    expect(record.verification.nextStep).toContain('incubation replicate');
  });
});
