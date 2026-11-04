import type { EffectDefinitionReviews } from './authorConcordance';
import original from '../../data/author-validation/concordance-reviews.json';
import r460 from '../../data/author-validation/regeneration-r460-2026-09-25/concordance-reviews-r460.json';

type Review = EffectDefinitionReviews['reviews'][number];

/**
 * Definition reviews in ledger order. concordance-reviews.json is sealed (pinned by
 * retained evidence); reviews made after the R 4.6.0 regeneration live in its
 * successor ledger and name the review they replace in `supersedes`.
 */
export const CONCORDANCE_REVIEW_LEDGERS = [
  { path: 'data/author-validation/concordance-reviews.json', document: original as EffectDefinitionReviews },
  { path: 'data/author-validation/regeneration-r460-2026-09-25/concordance-reviews-r460.json', document: r460 as unknown as EffectDefinitionReviews },
] as const;

/** Every review, original ledger first, so each dataset/dimension chain is in review order. */
export const ALL_CONCORDANCE_REVIEWS: EffectDefinitionReviews = {
  schemaVersion: 1,
  reviews: CONCORDANCE_REVIEW_LEDGERS.flatMap(({ document }) => document.reviews as Review[]),
} as EffectDefinitionReviews;

/** The latest review of each dataset/dimension: the definitions assessAuthorConcordance should receive. */
export const ACTIVE_CONCORDANCE_REVIEWS: EffectDefinitionReviews = (() => {
  const latest = new Map<string, Review>();
  for (const entry of ALL_CONCORDANCE_REVIEWS.reviews as Review[]) latest.set(`${entry.datasetId}/${entry.dimension}`, entry);
  return { schemaVersion: 1, reviews: [...latest.values()] } as EffectDefinitionReviews;
})();
