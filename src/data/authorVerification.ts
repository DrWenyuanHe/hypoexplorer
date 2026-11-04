import { unestablishedComparison, validateComparisonReview, type ComparisonReview } from './authorComparability';

/** Scientific verification is separate from completion of an audit checklist. */
export const VERIFICATION_STATES = {
  full: { label: 'Fully verified', shortLabel: 'Fully verified', tone: '#2F7D4A', rank: 0, description: 'Author-compatible results reconciled for every registered contrast, with no unresolved limitations.' },
  partial: { label: 'Full verification not established', shortLabel: 'Not fully verified', tone: '#2B6F77', rank: 1, description: 'Administrative grouping only. Read the evidence claim and scientific comparison requirements; this is not a score or a shared level of assurance.' },
  unresolved: { label: 'Unresolved, review required', shortLabel: 'Unresolved', tone: '#B42318', rank: 2, description: 'An observed result, cohort, or metadata difference remains unresolved. Not fully verified.' },
  in_progress: { label: 'Verification in progress', shortLabel: 'Review incomplete', tone: '#946200', rank: 3, description: 'The author-result review is incomplete. Evidence missing from the review may still be available.' },
  excluded: { label: 'Outside verification scope', shortLabel: 'Outside scope', tone: '#6B7280', rank: 4, description: 'Explicitly excluded from this verification review.' },
} as const;

/** The primary badge states the evidence claim, never the broad partial bucket. */
export const VERIFICATION_CLAIMS = {
  full: { ...VERIFICATION_STATES.full, iconState: 'full' },
  author_results: { label: 'Author results compared, limits remain', shortLabel: 'Results compared, limits remain', description: 'Direct author results were compared. Read which effects, statistics and genes were checked and which limitations remain.', tone: '#2B6F77', rank: 1, iconState: 'partial' },
  reconstructed: { label: 'Author effects reconstructed', shortLabel: 'Author effects reconstructed', description: 'A derived effect or separate author-method analysis was checked. This does not verify all statistics in the registered Explorer output.', tone: '#2B6F77', rank: 2, iconState: 'partial' },
  source_only: { label: 'Author results untested', shortLabel: 'Author results untested', description: 'Input/source evidence is recorded, but agreement with comparable author analysis results has not been tested. This is not a mismatch.', tone: '#6B7280', rank: 3, iconState: 'partial' },
  no_evidence: { label: 'No comparison evidence', shortLabel: 'No comparison evidence', description: 'No source or author-result comparison supports a verification claim.', tone: '#6B7280', rank: 4, iconState: 'partial' },
  unresolved: { ...VERIFICATION_STATES.unresolved, iconState: 'unresolved' },
  in_progress: { ...VERIFICATION_STATES.in_progress, iconState: 'in_progress' },
  excluded: { ...VERIFICATION_STATES.excluded, iconState: 'excluded' },
} as const;

export type VerificationClaim = keyof typeof VERIFICATION_CLAIMS;

export function getVerificationClaim(verification: Pick<AuthorVerification, 'state' | 'evidenceLevel'>): VerificationClaim {
  if (verification.state !== 'partial') return verification.state;
  return verification.evidenceLevel === 'none' ? 'no_evidence' : verification.evidenceLevel;
}

export const EVIDENCE_LEVELS = {
  author_results: { label: 'Author results compared' },
  reconstructed: { label: 'Author effect reconstructed' },
  source_only: { label: 'Processed source only' },
  none: { label: 'No comparison evidence' },
} as const;

export const RESULT_AVAILABILITY = {
  available: { label: 'Author results accessible; see comparison scope' },
  located: { label: 'Author result file located; retrieval not confirmed' },
  partial: { label: 'Only partial or non-equivalent author results available' },
  not_located: { label: 'Comparable author results not located in reviewed sources' },
  access_blocked: { label: 'Author-result access blocked or restricted' },
  not_assessed: { label: 'Author-result availability not yet reviewed' },
  excluded: { label: 'Not assessed: outside scope' },
} as const;

export const COMPARISON_OUTCOMES = {
  concordant: { label: 'Compared results agree within the documented scope' },
  method_differences: { label: 'Method-dependent differences documented' },
  unresolved: { label: 'Observed difference remains unresolved' },
  not_comparable: { label: 'Available author result is not the same comparison' },
  not_tested: { label: 'Author-result agreement not tested' },
  excluded: { label: 'Outside scope' },
} as const;

export type VerificationState = keyof typeof VERIFICATION_STATES;
export interface AuthorVerification {
  state: VerificationState;
  evidenceLevel: keyof typeof EVIDENCE_LEVELS;
  resultAvailability: keyof typeof RESULT_AVAILABILITY;
  comparisonOutcome: keyof typeof COMPARISON_OUTCOMES;
  reason: string;
  nextStep: string;
  /** Explicit sign-off, never inferred from correlations, filenames, or audit completion. */
  fullyVerifiedContrasts: string[];
  comparability: ComparisonReview;
}

export type VerificationReview = Pick<AuthorVerification, 'resultAvailability' | 'comparisonOutcome' | 'reason' | 'nextStep'> & {
  fullyVerifiedContrasts?: string[];
};

interface VerificationInput {
  status: string;
  comparisonLevel: string;
  sourceComparison: string;
  pipelineTrace: string;
  contrastIds: string[];
  reviewFlags: string[];
  review?: VerificationReview;
  comparability?: ComparisonReview;
}

export function assessAuthorVerification(input: VerificationInput): AuthorVerification {
  if (input.status === 'not_applicable') return {
    state: 'excluded', evidenceLevel: 'none', resultAvailability: 'excluded', comparisonOutcome: 'excluded',
    reason: 'The macaque single-cell atlas is explicitly excluded from this review.',
    nextStep: 'No verification claim is made for this dataset.', fullyVerifiedContrasts: [],
    comparability: unestablishedComparison('The macaque single-cell atlas is explicitly outside this review.'),
  };
  const evidenceLevel = input.comparisonLevel === 'direct' ? 'author_results'
    : input.comparisonLevel === 'reconstructed' ? 'reconstructed'
      : input.comparisonLevel === 'unavailable' ? 'none' : 'source_only';
  const review: VerificationReview = input.review ?? (
    evidenceLevel === 'author_results' || evidenceLevel === 'reconstructed' ? {
      resultAvailability: evidenceLevel === 'author_results' ? 'available' : 'partial',
      comparisonOutcome: 'method_differences',
      reason: 'Author evidence was compared within the scope described below. Method, coverage, or inferential limitations remain; this is not full verification.',
      nextStep: 'Reconcile author-compatible cohort, effects, and statistical results for every registered contrast before full sign-off.',
    } : {
      resultAvailability: 'not_assessed', comparisonOutcome: 'not_tested',
      reason: 'Processed-source checks are recorded, but author-result availability has not yet been explicitly reviewed. This is unfinished review, not evidence of absent data or disagreement.',
      nextStep: 'Review the official publication, supplementary files, and repository for comparable author results; record access attempts and comparison scope.',
    }
  );
  for (const [key, values] of [
    ['resultAvailability', RESULT_AVAILABILITY], ['comparisonOutcome', COMPARISON_OUTCOMES],
  ] as const) {
    if (!(review[key] in values)) throw new Error(`Invalid verification ${key}: ${review[key]}`);
  }
  if (!review.reason.trim() || !review.nextStep.trim()) throw new Error('Verification review needs a reason and next step');
  const comparability = input.comparability ?? unestablishedComparison(review.reason, review.comparisonOutcome === 'not_comparable');
  validateComparisonReview(comparability);
  if (comparability.registeredContrastIds.some((id) => !input.contrastIds.includes(id))) {
    throw new Error('Comparability review names an unregistered contrast');
  }
  // A results-compared badge is a claim that an author result was actually put
  // beside the registered output. comparisonLevel alone does not establish
  // that: a record can say 'direct' while its comparability review still names
  // target 'not_tested' with no reviewed contrast, which is how the claim can
  // outrun its evidence. Demote to source_only — evidence recorded, agreement
  // untested — which is the honest reading of that combination.
  // Established here means the comparison was actually carried out: a real
  // target and at least one reviewed contrast. It deliberately does NOT test
  // `assessment`: a review that ran and concluded not_established still tested
  // the author result, so demoting it to source_only ("agreement has not been
  // tested") would state the opposite of what happened. Those records keep the
  // results-compared claim and disclose the limitation through the six
  // comparability dimensions instead.
  const comparisonEstablished = comparability.target !== 'not_tested'
    && comparability.registeredContrastIds.length > 0;
  const claimedEvidence = evidenceLevel === 'author_results' && !comparisonEstablished
    ? 'source_only' as const
    : evidenceLevel;
  const contrasts = review.fullyVerifiedContrasts ?? [];
  if (new Set(contrasts).size !== contrasts.length || contrasts.some((id) => !input.contrastIds.includes(id))) {
    throw new Error('Verification sign-off names duplicate or unregistered contrasts');
  }
  const unresolved = input.status === 'review_required' || input.pipelineTrace === 'mismatch'
    || review.comparisonOutcome === 'unresolved';
  const fullEligible = !unresolved && input.status === 'author_result_match'
    && input.comparisonLevel === 'direct' && input.pipelineTrace === 'exact'
    && ['checksum_match', 'staging_checksum_match', 'semantic_match'].includes(input.sourceComparison)
    && review.resultAvailability === 'available' && review.comparisonOutcome === 'concordant'
    && input.reviewFlags.length === 0 && comparability.assessment === 'comparable'
    && comparability.target === 'registered_output' && comparability.resultScope === 'full_results';
  if (contrasts.some((id) => !comparability.registeredContrastIds.includes(id))) {
    throw new Error('Full verification sign-off lacks comparison evidence for a registered contrast');
  }
  if (contrasts.length && !fullEligible) throw new Error('Full verification sign-off conflicts with source, result, or limitation evidence');
  const full = fullEligible && input.contrastIds.length > 0 && contrasts.length === input.contrastIds.length;
  return {
    ...review, fullyVerifiedContrasts: contrasts, evidenceLevel: claimedEvidence, comparability,
    // A mismatch cannot be downgraded to mere missing evidence by a manual note.
    comparisonOutcome: unresolved ? 'unresolved' : review.comparisonOutcome,
    state: unresolved ? 'unresolved' : full ? 'full'
      : input.status === 'in_progress' || review.resultAvailability === 'not_assessed'
        || review.resultAvailability === 'located'
        || (review.resultAvailability === 'available' && review.comparisonOutcome === 'not_tested') ? 'in_progress' : 'partial',
  };
}
