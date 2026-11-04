import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EffectDefinitionReviews } from '../../src/data/authorConcordance';
import type { AuthorValidationRecord } from '../../src/data/authorValidation';
import { validateConcordanceReviews } from './concordanceReviewEvidence.mjs';
import { isRecordedCurrentOutput, supersession, supersessionNames } from './historicalEvidence.mjs';

type Review = EffectDefinitionReviews['reviews'][number] & {
  reason?: string;
  supersedes?: { reviewedAt: string; evidenceFingerprint: string };
};

/**
 * Validate the definition-review ledger, including reviews that later reviews replaced.
 *
 * A source-bound review expires when its comparison changes. It stays in its
 * ledger as history, and a later review of the same dataset and dimension (in a successor ledger) names it
 * in `supersedes` with a `reason`. The one active review per dataset and dimension
 * must bind to the current comparison and current source bytes (a successor may
 * re-review an unchanged comparison whose pinned source bytes changed); that check is the
 * sealed validateConcordanceReviews, unchanged. An expired review must still be
 * well formed, and each source it pins must be either the current bytes or the
 * bytes the R 4.6.0 regeneration recorded as replaced for that path.
 */
export function validateConcordanceReviewLedger(root: string, definitions: EffectDefinitionReviews,
  records: AuthorValidationRecord[], readBytes: (path: string) => Buffer = readFileSync): { active: number; expired: number } {
  if (definitions.schemaVersion !== 1 || !Array.isArray(definitions.reviews)) throw new Error('Unsupported definition-review schema');
  const reviews = definitions.reviews as Review[];
  const byKey = new Map<string, Review[]>();
  for (const entry of reviews) {
    const key = `${entry.datasetId}/${entry.dimension}`;
    byKey.set(key, [...(byKey.get(key) ?? []), entry]);
  }
  const expired: Review[] = [];
  const active: Review[] = [];
  for (const [key, chain] of byKey) {
    chain.forEach((entry, index) => {
      const previous = chain[index - 1];
      if (!previous) {
        if (entry.supersedes || entry.reason !== undefined) throw new Error(`First definition review cannot supersede another: ${key}`);
        return;
      }
      if (!entry.reason?.trim() || !entry.supersedes
        || entry.supersedes.evidenceFingerprint !== previous.evidenceFingerprint
        || entry.supersedes.reviewedAt !== previous.reviewedAt || entry.reviewedAt < previous.reviewedAt
        || (entry.evidenceFingerprint === previous.evidenceFingerprint
          && JSON.stringify(entry.sources) === JSON.stringify(previous.sources))
        || entry.contrastId !== previous.contrastId) {
        throw new Error(`Definition review does not supersede its predecessor: ${key}`);
      }
    });
    expired.push(...chain.slice(0, -1));
    active.push(chain[chain.length - 1]);
  }
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  for (const entry of expired) {
    if (entry.status !== 'compatible' || !entry.note.trim() || !/^[a-f0-9]{64}$/.test(entry.evidenceFingerprint)
      || entry.sources.length < 2 || new Set(entry.sources.map(source => source.path)).size !== entry.sources.length) {
      throw new Error(`Malformed expired definition review: ${entry.datasetId}/${entry.dimension}`);
    }
    for (const source of entry.sources) {
      const current = readBytes(resolve(root, source.path));
      if (hash(current) === source.sha256) continue;
      const replaced = supersessionNames(root, source.path) ? supersession(root).records.get(source.path) : undefined;
      if (!replaced?.newSha256 || replaced.oldSha256 !== source.sha256 || !isRecordedCurrentOutput(root, source.path, current, replaced, readBytes)) {
        throw new Error(`Expired definition-review source is neither current nor the recorded replaced bytes: ${source.path}`);
      }
    }
  }
  const verified = validateConcordanceReviews(root, { schemaVersion: 1, reviews: active } as EffectDefinitionReviews, records, readBytes);
  return { active: verified, expired: expired.length };
}
