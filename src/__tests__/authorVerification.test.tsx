import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { assessAuthorVerification, getVerificationClaim, type VerificationReview } from '../data/authorVerification';
import { COMPARABILITY_DIMENSIONS, unestablishedComparison, validateComparisonReview, type ComparisonReview } from '../data/authorComparability';
import { AUTHOR_VALIDATION_REPORT, requireAuthorValidation } from '../data/authorValidation';
import { AuthorReviewBadge as AuthorValidationBadge, AuthorValidationPanel } from '../common/AuthorValidation';

afterEach(cleanup);
const base = {
  status: 'processed_source_match', comparisonLevel: 'processed_source', sourceComparison: 'checksum_match',
  pipelineTrace: 'exact', contrastIds: ['case_vs_control'], reviewFlags: [] as string[],
};
const reviewed: VerificationReview = {
  resultAvailability: 'not_located', comparisonOutcome: 'not_tested',
  reason: 'No same-contrast result was located in the inspected sources.', nextStep: 'Obtain author results.',
};
const comparable: ComparisonReview = {
  target: 'registered_output', resultScope: 'full_results', registeredContrastIds: ['case_vs_control'],
  basis: 'Registered case-minus-control output, not a separate refit.',
  reference: 'Full author case-minus-control results with all tested genes and finite inferential statistics.',
  assessment: 'comparable',
  dimensions: Object.fromEntries(Object.keys(COMPARABILITY_DIMENSIONS).map((key) => [key, {
    status: 'matched', note: `The ${key} requirement was reviewed against the full author result.`,
  }])) as ComparisonReview['dimensions'],
  criteria: 'Same cohort, contrast and tested universe. Effect and statistical differences are within the explicitly reviewed export precision; call sets and directions match.',
  conclusion: 'The registered output agrees with the author result within the documented precision.',
};

describe('scientific verification decisions', () => {
  it('does not infer missing data or full verification from a checksum match', () => {
    expect(assessAuthorVerification(base)).toMatchObject({
      state: 'in_progress', evidenceLevel: 'source_only', resultAvailability: 'not_assessed',
      comparisonOutcome: 'not_tested', fullyVerifiedContrasts: [],
    });
  });
  it('distinguishes documented missing reference data from a disagreement', () => {
    expect(assessAuthorVerification({ ...base, review: reviewed })).toMatchObject({ state: 'partial', comparisonOutcome: 'not_tested', resultAvailability: 'not_located' });
    expect(assessAuthorVerification({ ...base, status: 'review_required', review: reviewed }))
      .toMatchObject({ state: 'unresolved', comparisonOutcome: 'unresolved', resultAvailability: 'not_located' });
  });
  it('keeps an accessible but not compared result in progress', () => {
    expect(assessAuthorVerification({ ...base, review: { ...reviewed, resultAvailability: 'available' } }).state).toBe('in_progress');
  });
  it('requires explicit sign-off for every registered contrast before a full badge', () => {
    const input = { ...base, status: 'author_result_match', comparisonLevel: 'direct', contrastIds: ['a', 'b'], comparability: { ...comparable, registeredContrastIds: ['a', 'b'] },
      review: { ...reviewed, resultAvailability: 'available' as const, comparisonOutcome: 'concordant' as const } };
    expect(assessAuthorVerification(input).state).toBe('partial');
    expect(assessAuthorVerification({ ...input, review: { ...input.review, fullyVerifiedContrasts: ['a'] } }).state).toBe('partial');
    expect(assessAuthorVerification({ ...input, review: { ...input.review, fullyVerifiedContrasts: ['a', 'b'] } }).state).toBe('full');
  });
  it.each([
    { pipelineTrace: 'mismatch' }, { status: 'review_required' }, { sourceComparison: 'manual_structure_match' },
    { reviewFlags: ['Author cohort unknown'] }, { comparisonLevel: 'reconstructed' },
  ])('rejects full sign-off that conflicts with evidence: %j', (conflict) => {
    expect(() => assessAuthorVerification({ ...base, status: 'author_result_match', comparisonLevel: 'direct', comparability: comparable, ...conflict,
      review: { ...reviewed, resultAvailability: 'available', comparisonOutcome: 'concordant', fullyVerifiedContrasts: base.contrastIds } }))
      .toThrow(/sign-off conflicts/);
  });
  it('rejects unknown or duplicate contrast sign-offs and empty review rationales', () => {
    expect(() => assessAuthorVerification({ ...base, review: { ...reviewed, fullyVerifiedContrasts: ['other'] } })).toThrow(/unregistered/);
    expect(() => assessAuthorVerification({ ...base, review: { ...reviewed, fullyVerifiedContrasts: ['case_vs_control', 'case_vs_control'] } })).toThrow(/duplicate/);
    expect(() => assessAuthorVerification({ ...base, review: { ...reviewed, reason: '' } })).toThrow(/reason/);
  });
  it('records exclusion without implied failure', () => {
    expect(assessAuthorVerification({ ...base, status: 'not_applicable' })).toMatchObject({ state: 'excluded', comparisonOutcome: 'excluded', fullyVerifiedContrasts: [] });
  });
  it.each(Object.keys(COMPARABILITY_DIMENSIONS) as (keyof ComparisonReview['dimensions'])[])(
    'cannot trade other passed checks for an unmet %s requirement', (key) => {
      for (const status of ['limited', 'different', 'not_tested'] as const) {
        const incomplete = { ...comparable, assessment: 'limited' as const, dimensions: {
          ...comparable.dimensions, [key]: { status, note: 'This scientific requirement is not met.' },
        } };
        expect(() => assessAuthorVerification({ ...base, status: 'author_result_match', comparisonLevel: 'direct', comparability: incomplete,
          review: { ...reviewed, resultAvailability: 'available', comparisonOutcome: 'concordant', fullyVerifiedContrasts: base.contrastIds } }))
          .toThrow(/sign-off conflicts/);
      }
    },
  );
  it('rejects an asserted comparable assessment with unknown statistics or missing criteria', () => {
    expect(() => validateComparisonReview({ ...comparable, dimensions: { ...comparable.dimensions,
      inference: { status: 'not_tested', note: 'No author FDR.' },
    } })).toThrow(/unmet scientific requirement/);
    expect(() => validateComparisonReview({ ...comparable, criteria: '' })).toThrow(/criteria/);
    expect(() => validateComparisonReview({ ...comparable, dimensions: {} as ComparisonReview['dimensions'] })).toThrow(/cohort/);
  });
  it.each([
    { target: 'author_method_reconstruction' as const }, { target: 'derived_author_effect' as const },
    { resultScope: 'selected_results' as const }, { resultScope: 'effects_only' as const },
  ])('rejects inherited or incomplete result verification even when all dimensions assert a match: %j', (scope) => {
    expect(() => assessAuthorVerification({ ...base, status: 'author_result_match', comparisonLevel: 'direct', comparability: { ...comparable, ...scope },
      review: { ...reviewed, resultAvailability: 'available', comparisonOutcome: 'concordant', fullyVerifiedContrasts: base.contrastIds } }))
      .toThrow(/sign-off conflicts/);
  });
  it('rejects inherited enum properties and hidden extra requirements', () => {
    expect(() => validateComparisonReview({ ...comparable, assessment: 'toString' as ComparisonReview['assessment'] })).toThrow(/Invalid comparability/);
    expect(() => validateComparisonReview({ ...comparable, dimensions: { ...comparable.dimensions,
      inference: { status: 'constructor' as 'matched', note: 'Invalid status.' },
    } })).toThrow(/inference/);
    expect(() => validateComparisonReview({ ...comparable, dimensions: { ...comparable.dimensions,
      hidden: { status: 'different', note: 'Must not be hidden.' },
    } as ComparisonReview['dimensions'] })).toThrow(/unknown scientific requirement/);
  });
  it('does not extend a one-contrast profile to additional contrast sign-offs', () => {
    expect(() => assessAuthorVerification({ ...base, contrastIds: ['case_vs_control', 'second'], status: 'author_result_match', comparisonLevel: 'direct', comparability: comparable,
      review: { ...reviewed, resultAvailability: 'available', comparisonOutcome: 'concordant', fullyVerifiedContrasts: ['case_vs_control', 'second'] } }))
      .toThrow(/lacks comparison evidence/);
    expect(() => assessAuthorVerification({ ...base, comparability: { ...comparable, registeredContrastIds: ['unknown'] } }))
      .toThrow(/unregistered contrast/);
  });
  it('does not infer scientific comparability from a source match or missing result', () => {
    const verification = assessAuthorVerification({ ...base, review: reviewed });
    expect(verification.comparability.assessment).toBe('not_established');
    expect(Object.values(verification.comparability.dimensions).every((d) => d.status === 'not_tested')).toBe(true);
    expect(getVerificationClaim(verification)).toBe('source_only');
    expect(unestablishedComparison('Different age contrast', true).dimensions.contrast.status).toBe('different');
  });
  it('uses explicit evidence claims while preserving discrepancy priority', () => {
    expect(getVerificationClaim({ state: 'partial', evidenceLevel: 'author_results' })).toBe('author_results');
    expect(getVerificationClaim({ state: 'partial', evidenceLevel: 'reconstructed' })).toBe('reconstructed');
    expect(getVerificationClaim({ state: 'partial', evidenceLevel: 'none' })).toBe('no_evidence');
    expect(getVerificationClaim({ state: 'unresolved', evidenceLevel: 'author_results' })).toBe('unresolved');
  });
  it('does not promote any existing limited review to full verification', () => {
    for (const record of AUTHOR_VALIDATION_REPORT.records) {
      expect(record.verification.reason.trim()).toBeTruthy();
      expect(record.verification.nextStep.trim()).toBeTruthy();
      if (record.status === 'review_required') expect(record.verification.state).toBe('unresolved');
      if (record.verification.state === 'full') {
        expect(record.status).toBe('author_result_match');
        expect(record.reviewFlags).toHaveLength(0);
        expect(record.verification.fullyVerifiedContrasts).toHaveLength(record.contrastCount);
        expect(record.verification.comparisonOutcome).toBe('concordant');
        expect(record.verification.comparability.assessment).toBe('comparable');
      }
    }
  });
});

describe('visible verification evidence', () => {
  it('keeps a reproduced author-compatible result partial when registered-method limitations remain', () => {
    const record = requireAuthorValidation('mouse_mhypoa_palmitate_gse280030');
    render(<AuthorValidationPanel record={record} />);
    expect(screen.getByText('Author results compared, limits remain')).toBeTruthy();
    expect(screen.getByText(record.note)).toHaveTextContent('Jaccard 1.0');
    expect(screen.getByRole('rowheader', { name: 'Numerical comparison scope' }).closest('tr')).toHaveTextContent('missing, not nonsignificant');
    expect(screen.queryByText('Fully verified')).toBeNull();
  });
  it('does not label GSE128148 full author results unavailable despite unresolved inference', () => {
    const record = requireAuthorValidation('mouse_arc_corticosterone_gse128148');
    render(<AuthorValidationPanel record={record} />);
    expect(record.verification).toMatchObject({ state: 'unresolved', evidenceLevel: 'author_results', resultAvailability: 'available' });
    expect(screen.getByText(record.note)).toHaveTextContent('exact 43 original');
    expect(screen.getByRole('rowheader', { name: 'Author selection rule' }).closest('tr')).toHaveTextContent('FDR <0.1');
  });
  it('pairs a source-evidence icon with an explicit untested label, never a full badge', () => {
    render(<AuthorValidationBadge record={requireAuthorValidation('mouse_arc_hfd_gse225038')} />);
    const badge = screen.getByText('Author results untested');
    expect(badge).toHaveAttribute('data-verification-state', 'partial');
    expect(badge).toHaveAttribute('data-verification-claim', 'source_only');
    expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByText('Fully verified')).toBeNull();
  });
  it('displays a missing-reference limitation separately from a comparison outcome', () => {
    render(<AuthorValidationPanel record={requireAuthorValidation('mouse_arc_hfd_gse225038')} />);
    expect(screen.getByText('Comparable author results not located in reviewed sources')).toBeTruthy();
    expect(screen.getByText('Author-result agreement not tested')).toBeTruthy();
    expect(screen.getByText('0 of 1 registered contrasts')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'How data verification works' })).toHaveAttribute('href', '#/verification');
  });
  it('keeps a strong selected-effect match visibly unresolved with numerical and scope notes', () => {
    const record = requireAuthorValidation('mouse_hypo_glylow_gse234483');
    render(<AuthorValidationPanel record={record} />);
    expect(screen.getByText('Unresolved, review required')).toBeTruthy();
    expect(screen.getByText('Observed difference remains unresolved')).toBeTruthy();
    expect(screen.getByText(record.note)).toHaveTextContent('1,407');
    expect(screen.queryByText('Fully verified')).toBeNull();
  });
});
