import { describe, expect, it } from 'vitest';
import { assessAuthorConcordance } from '../data/authorConcordance';
import { requireAuthorValidation } from '../data/authorValidation';

function fixture() {
  const row = structuredClone(requireAuthorValidation('mouse_mhypoa_palmitate_gse280030'));
  row.directComparison!.metrics = {
    localGenes: 100, authorGenes: 200, sharedGenes: 100, localCoverage: 1, authorCoverage: 0.5,
    pearsonLogFC: 0.99, spearmanLogFC: 0.99, signComparableGenes: 100, signConcordance: 0.99,
    medianAbsLogFCDelta: 0.02, effectScaleGenes: 100, effectScaleRatio: 1,
  };
  return row;
}

describe('independent review of alternative author-concordance routes', () => {
  it.each([
    { pearsonLogFC: 1.1, spearmanLogFC: null },
    { pearsonLogFC: null, spearmanLogFC: -1.1 },
    { signConcordance: 1.1, signComparableGenes: null },
    { signConcordance: null, signComparableGenes: -1 },
    { medianAbsLogFCDelta: -1, effectScaleRatio: null },
    { medianAbsLogFCDelta: null, effectScaleGenes: 99 },
    { localGenes: -1 },
    { localGenes: null, authorGenes: 50, sharedGenes: 100 },
    { signComparableGenes: 0, signConcordance: 1 },
  ])('does not treat a reported invalid component as missing when another component is absent: %j', (metrics) => {
    const row = fixture();
    Object.assign(row.directComparison!.metrics, metrics);
    expect(assessAuthorConcordance(row).status).toBe('fail');
  });

  it('allows a missing unused route while keeping missing common scientific evidence unassessed', () => {
    const row = fixture();
    row.directComparison!.metrics.pearsonLogFC = null;
    row.directComparison!.metrics.spearmanLogFC = null;
    expect(assessAuthorConcordance(row).status).toBe('pass');
    row.verification.comparability.dimensions.cohort = { status: 'not_tested', note: 'Cohort was not established.' };
    const result = assessAuthorConcordance(row);
    expect(result.status).toBe('not_assessed');
    expect(result.scope).toContain('Numerical acceptance: matched-gene direction');
    expect(result.checks.find(check => check.id === 'author_concordance_route')?.note).toContain('must also pass');
  });

  it('preserves a reviewed scientific discrepancy despite both numerical criteria passing', () => {
    const row = fixture();
    row.verification.comparability.dimensions.effects = { status: 'limited', note: 'Effect units remain undocumented.' };
    const result = assessAuthorConcordance(row);
    expect(result.status).toBe('review');
    expect(result.scope).toContain('Numerical acceptance:');
    expect(result.scope).not.toMatch(/fully verified|full verification/i);
  });

  it('gives invalid evidence priority over missing common metadata', () => {
    const row = fixture();
    row.verification.comparability.dimensions.cohort = { status: 'not_tested', note: 'Cohort was not established.' };
    row.directComparison!.metrics.localCoverage = 0.5;
    expect(assessAuthorConcordance(row).status).toBe('fail');
  });

  it('does not label an unsupported requested contrast as numerically accepted', () => {
    const result = assessAuthorConcordance(fixture(), 'unsupported_vs_control');
    expect(result.status).toBe('not_assessed');
    expect(result.scope).not.toContain('Numerical acceptance:');
  });
});
