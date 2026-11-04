import { describe, expect, it } from 'vitest';
import { assessAuthorConcordance, AUTHOR_CONCORDANCE_POLICY } from '../data/authorConcordance';
import { assessCurrentAuthorConcordance } from '../data/authorConcordanceR460';
import { requireAuthorValidation, type AuthorValidationRecord } from '../data/authorValidation';

function record(): AuthorValidationRecord {
  const result = structuredClone(requireAuthorValidation('mouse_mhypoa_palmitate_gse280030'));
  result.verification.state = 'unresolved';
  result.directComparison!.metrics = {
    localGenes: 100, authorGenes: 200, sharedGenes: 100,
    localCoverage: 1, authorCoverage: 0.5,
    pearsonLogFC: 0.99, spearmanLogFC: 0.99,
    medianAbsLogFCDelta: 0.02, rootMeanSquareLogFCDelta: 0.04,
    signComparableGenes: 100, signConcordance: 0.99,
    effectScaleGenes: 100, effectScaleRatio: 1.02,
  };
  return result;
}

function check(result: AuthorValidationRecord, id: string) {
  return assessAuthorConcordance(result).checks.find((value) => value.id === id)!;
}
// Current state: the active definition reviews after the R 4.6.0 regeneration
// (data/quality/regeneration-r460-2026-09-25/README.md).
function currentCheck(result: AuthorValidationRecord, id: string) {
  return assessCurrentAuthorConcordance(result).checks.find((value) => value.id === id)!;
}

describe('author biological-effect concordance', () => {
  it('passes a registered compatible effect comparison despite missing FDR and old inferential unresolved state', () => {
    const result = assessAuthorConcordance(record());
    expect(result.status).toBe('pass');
    expect(result.policyVersion).toBe(AUTHOR_CONCORDANCE_POLICY.version);
    expect(result.checks.find((entry) => entry.id === 'author_inference')).toMatchObject({ status: 'not_applicable', required: false });
    expect(result.scope).toContain('palmitate_vs_vehicle');
  });

  it('accepts strong correlation or matched-gene direction as alternative evidence', () => {
    const fixture = record();
    fixture.directComparison!.metrics.signConcordance = 0.5;
    expect(assessAuthorConcordance(fixture).status).toBe('pass');
    expect(check(fixture, 'author_gene_direction').status).toBe('review');
    fixture.directComparison!.metrics.signConcordance = 1;
    fixture.directComparison!.metrics.spearmanLogFC = 0.7;
    expect(assessAuthorConcordance(fixture).status).toBe('pass');
    expect(check(fixture, 'author_effect_correlation').status).toBe('review');
    expect(assessAuthorConcordance(fixture).scope).toContain('Numerical acceptance: matched-gene direction');
    fixture.directComparison!.metrics.signConcordance = 0.5;
    expect(assessAuthorConcordance(fixture).status).toBe('review');
  });

  it('reports rescaled effects while accepting correlation and direction evidence', () => {
    const fixture = record();
    Object.assign(fixture.directComparison!.metrics, {
      pearsonLogFC: 1, spearmanLogFC: 1, signConcordance: 1,
      medianAbsLogFCDelta: 0.01, rootMeanSquareLogFCDelta: 0.015, effectScaleRatio: 2,
    });
    expect(check(fixture, 'author_effect_magnitude').status).toBe('review');
    expect(assessAuthorConcordance(fixture).status).toBe('pass');
    expect(check(fixture, 'author_effect_magnitude').required).toBe(false);
  });

  it('does not round a below-threshold correlation into an apparent passing value', () => {
    for (const value of [0.899632, 0.8999999999999999]) {
      const fixture = record();
      fixture.directComparison!.metrics.pearsonLogFC = value;
      fixture.directComparison!.metrics.spearmanLogFC = value;
      const result = check(fixture, 'author_effect_correlation');
      expect(result.status).toBe('review');
      expect(result.note).toContain(`Pearson r ${value}; Spearman rho ${value}`);
      expect(assessAuthorConcordance(fixture).status).toBe('pass');
    }
  });

  it('leaves missing scale evidence unassessed rather than inferring it from correlation', () => {
    const fixture = record();
    delete fixture.directComparison!.metrics.effectScaleRatio;
    expect(check(fixture, 'author_effect_magnitude').status).toBe('not_assessed');
    expect(assessAuthorConcordance(fixture).status).toBe('pass');
  });

  it('can accept an adequately covered direction-only table without inventing effect magnitudes', () => {
    const fixture = record();
    delete fixture.directComparison!.metrics.pearsonLogFC;
    delete fixture.directComparison!.metrics.spearmanLogFC;
    delete fixture.directComparison!.metrics.effectScaleRatio;
    delete fixture.directComparison!.metrics.medianAbsLogFCDelta;
    expect(assessAuthorConcordance(fixture).status).toBe('pass');
    expect(check(fixture, 'author_effect_correlation').status).toBe('not_assessed');
    expect(check(fixture, 'author_effect_magnitude').status).toBe('not_assessed');
    fixture.directComparison!.metrics.signComparableGenes = 10;
    expect(assessAuthorConcordance(fixture).status).toBe('review');
    delete fixture.directComparison!.metrics.signConcordance;
    expect(assessAuthorConcordance(fixture).status).toBe('not_assessed');
  });

  it('does not let a passing alternative hide invalid reported metrics', () => {
    const fixture = record();
    fixture.directComparison!.metrics.pearsonLogFC = 1.1;
    expect(assessAuthorConcordance(fixture).status).toBe('fail');
    fixture.directComparison!.metrics.pearsonLogFC = 0.99;
    fixture.directComparison!.metrics.signConcordance = 1.1;
    expect(assessAuthorConcordance(fixture).status).toBe('fail');
    fixture.directComparison!.metrics.signConcordance = 1;
    fixture.directComparison!.metrics.effectScaleGenes = 99;
    expect(assessAuthorConcordance(fixture).status).toBe('fail');
  });

  it('does not substitute significant-gene or overall upregulated fractions for matched-gene direction', () => {
    const fixture = record();
    delete fixture.directComparison!.metrics.signConcordance;
    fixture.directComparison!.metrics.authorSignificantSignConcordance = 1;
    fixture.directComparison!.metrics.significantSetJaccard = 1;
    expect(check(fixture, 'author_gene_direction').status).toBe('not_assessed');
  });

  it('requires enough directional pairs and discloses excluded zeros', () => {
    const fixture = record();
    fixture.directComparison!.metrics.signComparableGenes = 10;
    fixture.directComparison!.metrics.signConcordance = 1;
    const direction = check(fixture, 'author_gene_direction');
    expect(direction.status).toBe('review');
    expect(direction.note).toContain('nonzero effects in both');
    fixture.directComparison!.metrics.signComparableGenes = 50;
    expect(check(fixture, 'author_gene_direction').status).toBe('review');
  });

  it('does not borrow one metric block for an unsupported or additional contrast', () => {
    const fixture = record();
    expect(assessAuthorConcordance(fixture, 'different_vs_control').status).toBe('not_assessed');
    expect(assessAuthorConcordance(fixture, '').status).toBe('not_assessed');
    fixture.contrastCount = 2;
    expect(assessAuthorConcordance(fixture).status).toBe('not_assessed');
    expect(assessAuthorConcordance(fixture, 'palmitate_vs_vehicle').status).toBe('pass');
    fixture.verification.comparability.registeredContrastIds.push('different_vs_control');
    expect(assessAuthorConcordance(fixture, 'palmitate_vs_vehicle').status).toBe('not_assessed');
  });

  it('requires reviewed contrast IDs to exist in the dataset registry', () => {
    const fixture = record();
    fixture.verification.comparability.registeredContrastIds = ['invented_vs_control'];
    expect(assessAuthorConcordance(fixture, 'invented_vs_control').status).toBe('not_assessed');
  });

  it('uses selected-list coverage with an explicit limited scope', () => {
    const fixture = record();
    fixture.verification.comparability.resultScope = 'selected_results';
    Object.assign(fixture.directComparison!.metrics, {
      localGenes: 2000, localCoverage: 0.05, authorGenes: 100, authorCoverage: 1,
    });
    expect(assessAuthorConcordance(fixture).status).toBe('pass');
    expect(assessAuthorConcordance(fixture).scope).toContain('Selected author genes only');
    fixture.verification.comparability.resultScope = 'full_results';
    expect(check(fixture, 'author_coverage').status).toBe('review');
  });

  it('does not accept tiny selected lists as pipeline evidence', () => {
    const fixture = record();
    fixture.verification.comparability.resultScope = 'selected_results';
    Object.assign(fixture.directComparison!.metrics, {
      localGenes: 100, authorGenes: 10, sharedGenes: 10, localCoverage: 0.1,
      authorCoverage: 1, signComparableGenes: 10, effectScaleGenes: 10,
    });
    expect(check(fixture, 'author_paired_genes').status).toBe('review');
    expect(assessAuthorConcordance(fixture).status).toBe('review');
  });

  it.each(['cohort', 'contrast', 'features', 'effects'] as const)('preserves unresolved %s evidence despite excellent numeric agreement', (dimension) => {
    const fixture = record();
    fixture.verification.comparability.dimensions[dimension] = { status: 'limited', note: 'A specific unresolved scientific issue remains.' };
    expect(check(fixture, `author_${dimension}`).status).toBe('review');
    expect(assessAuthorConcordance(fixture).status).toBe('review');
  });

  it('does not pass the selected spatial-aging result while its retained cohort is unknown', () => {
    const fixture = structuredClone(requireAuthorValidation('mouse_hypo_spatial_aging_gse270383'));
    fixture.directComparison!.metrics.effectScaleGenes = fixture.directComparison!.metrics.sharedGenes;
    fixture.directComparison!.metrics.effectScaleRatio = 1;
    expect(check(fixture, 'author_cohort').status).toBe('review');
    expect(assessAuthorConcordance(fixture).status).toBe('review');
  });

  it('does not apply reconstructed effects or source-only evidence to the registered result', () => {
    const fixture = record();
    fixture.directComparison!.type = 'reconstructed_author_effect';
    expect(assessAuthorConcordance(fixture).status).toBe('not_assessed');
    fixture.directComparison = null;
    expect(assessAuthorConcordance(fixture).status).toBe('not_assessed');
  });

  it('rejects impossible metric values and mismatched denominators', () => {
    const fixture = record();
    fixture.directComparison!.metrics.signConcordance = 1.1;
    expect(check(fixture, 'author_gene_direction').status).toBe('fail');
    fixture.directComparison!.metrics.signConcordance = 1;
    fixture.directComparison!.metrics.effectScaleGenes = 99;
    expect(check(fixture, 'author_effect_magnitude').status).toBe('fail');
    fixture.directComparison!.metrics.localCoverage = 0.5;
    expect(check(fixture, 'author_coverage').status).toBe('fail');
  });

  it('does not select whichever expressed subset has the highest correlation', () => {
    const fixture = record();
    fixture.directComparison!.metrics.pearsonLogFC = 0.4;
    fixture.directComparison!.metrics.expressedPearsonLogFC = 1;
    expect(check(fixture, 'author_effect_correlation').status).toBe('review');
  });

  it('separates explicitly reviewed effect definitions from legacy numerical limitations', () => {
    // The R 4.6.0 regeneration changed this comparison, so the original ledger's review
    // expired and its successor re-review applies (data/quality/regeneration-r460-2026-09-25/README.md).
    const fixture = structuredClone(requireAuthorValidation('chicken_hypo_development_gse104255'));
    expect(fixture.verification.comparability.dimensions.effects.status).toBe('limited');
    expect(check(fixture, 'author_effects').status).toBe('review');
    expect(currentCheck(fixture, 'author_effects').status).toBe('pass');
    expect(currentCheck(fixture, 'author_effects').evidence?.[0])
      .toBe('data/author-validation/regeneration-r460-2026-09-25/concordance-reviews-r460.json');
    expect(assessCurrentAuthorConcordance(fixture).status).toBe('pass');
    expect(fixture.verification.comparability.dimensions.effects.status).toBe('limited');
  });

  it('does not reuse a definition review after the evidence or scientific concern changes', () => {
    const fixture = structuredClone(requireAuthorValidation('chicken_hypo_development_gse104255'));
    const fingerprint = fixture.directComparison!.evidenceFingerprint;
    fixture.directComparison!.evidenceFingerprint = 'stale';
    expect(currentCheck(fixture, 'author_effects').status).toBe('review');
    fixture.directComparison!.evidenceFingerprint = fingerprint;
    fixture.verification.comparability.dimensions.effects.note = 'A new unresolved effect-definition issue.';
    expect(currentCheck(fixture, 'author_effects').status).toBe('review');
  });
});
