import { assessAuthorConcordance, AUTHOR_CONCORDANCE_POLICY } from './authorConcordance';
import type { AuthorValidationRecord } from './authorValidation';
import { ACTIVE_CONCORDANCE_REVIEWS, CONCORDANCE_REVIEW_LEDGERS } from './concordanceReviews';
import type { QualityAssessment, QualityCheck } from './qualityChecks';

export { AUTHOR_CONCORDANCE_POLICY };

/**
 * Current author concordance after the R 4.6.0 regeneration.
 *
 * authorConcordance.ts is sealed (pinned by retained evidence) and defaults to the
 * original concordance-reviews.json, whose source-bound reviews expired when the
 * regeneration changed the comparisons they bound. This successor evaluates the same
 * unchanged policy against the active review of each dataset/dimension (original or
 * its successor ledger; see concordanceReviews.ts and
 * data/quality/regeneration-r460-2026-09-25/README.md), and cites the ledger that
 * actually holds the review that was applied.
 */
const [ORIGINAL_LEDGER] = CONCORDANCE_REVIEW_LEDGERS;
type Review = (typeof ACTIVE_CONCORDANCE_REVIEWS)['reviews'][number];
const ledgerOf = new Map<Review, string>(CONCORDANCE_REVIEW_LEDGERS.flatMap(({ path, document }) =>
  (document.reviews as Review[]).map((review) => [review, path] as const)));
const REVIEWED_DIMENSIONS = { author_cohort: 'cohort', author_effects: 'effects' } as const;

function citeAppliedLedger(check: QualityCheck, datasetId: string): QualityCheck {
  const dimension = REVIEWED_DIMENSIONS[check.id as keyof typeof REVIEWED_DIMENSIONS];
  if (!dimension || !check.evidence?.includes(ORIGINAL_LEDGER.path)) return check;
  const review = (ACTIVE_CONCORDANCE_REVIEWS.reviews as Review[]).find((entry) =>
    entry.datasetId === datasetId && entry.dimension === dimension && check.note.includes(entry.note));
  const path = review && ledgerOf.get(review);
  if (!path || path === ORIGINAL_LEDGER.path) return check;
  return { ...check, evidence: check.evidence.map((item) => item === ORIGINAL_LEDGER.path ? path : item) };
}

/** assessAuthorConcordance with the active definition reviews. */
export function assessCurrentAuthorConcordance(record: AuthorValidationRecord, contrastId?: string): QualityAssessment {
  const assessment = assessAuthorConcordance(record, contrastId, ACTIVE_CONCORDANCE_REVIEWS);
  return { ...assessment, checks: assessment.checks.map((check) => citeAppliedLedger(check, record.datasetId)) };
}
