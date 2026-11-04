/**
 * Check every definition review in the sealed concordance-reviews.json and its R 4.6.0
 * successor ledger (regeneration-r460-2026-09-25/concordance-reviews-r460.json), including expired ones.
 *
 * Successor to the sealed scripts/audit_concordance_reviews.mts, which accepts only
 * one review per dataset and dimension and therefore cannot hold a review that
 * expired when the R 4.6.0 regeneration changed the comparison it bound.
 */
import { readFileSync } from 'node:fs';
import { ALL_CONCORDANCE_REVIEWS } from '../src/data/concordanceReviews';
import { validateConcordanceReviewLedger } from './lib/concordanceReviewLedger.mjs';

const records = JSON.parse(readFileSync('data/author-validation/validation-records.generated.json', 'utf8')).records;
const { active, expired } = validateConcordanceReviewLedger(process.cwd(), ALL_CONCORDANCE_REVIEWS, records);
console.log(JSON.stringify({ definitionReviewsVerified: active, expiredReviewsVerified: expired }));
