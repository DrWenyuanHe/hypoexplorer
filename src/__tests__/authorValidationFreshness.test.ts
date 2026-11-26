import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTHOR_VALIDATION_INPUTS, authorValidationInputSha256 } from '../../scripts/lib/authorValidationInputs.mjs';

// The generators need evidence that the public checkout does not hold, so CI
// cannot rebuild validation-records.generated.json. These checks catch a ledger
// edit that was committed without regenerating it: run compare_author_results.mts,
// build_author_validation.mts and `pnpm run build:quality` where the evidence lives.
const ROOT = resolve(__dirname, '../..');
const readJson = (path: string) => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));

interface GeneratedRecord {
  datasetId: string;
  status: string;
  pipelineTrace: string;
  verification: Record<string, unknown> & { comparisonOutcome: string };
}
const generated = readJson('data/author-validation/validation-records.generated.json') as {
  inputSha256?: Record<string, string>;
  records: GeneratedRecord[];
};
const byId = new Map(generated.records.map((record) => [record.datasetId, record]));
const verificationLedger = readJson('data/author-validation/verification-review.json').records as Record<string, Record<string, unknown>>;
const comparabilityLedger = readJson('data/author-validation/comparability-review.json').records as Record<string, unknown>;

// Fields assessAuthorVerification copies from the verification-review ledger.
const COPIED_FIELDS = ['resultAvailability', 'reason', 'nextStep', 'followUp'] as const;

// The records committed on 2026-10-25 predate the Nov 15-24 ledger merges and
// cannot be rebuilt in CI, so these checks are expected to fail until they are
// regenerated. The commit that regenerates them must change `it.fails` to `it`:
// a passing check fails while it is still marked.
const freshness = it.fails;

describe('author-validation records match their review ledgers', () => {
  freshness('carries every verification-review field into the generated record', () => {
    const drift: string[] = [];
    for (const [datasetId, review] of Object.entries(verificationLedger)) {
      const record = byId.get(datasetId);
      if (!record) {
        drift.push(`${datasetId}: no generated record`);
        continue;
      }
      const verification = record.verification;
      for (const field of COPIED_FIELDS) {
        if (verification[field] !== review[field]) drift.push(`${datasetId}.${field}`);
      }
      if (JSON.stringify(verification.fullyVerifiedContrasts) !== JSON.stringify(review.fullyVerifiedContrasts ?? [])) {
        drift.push(`${datasetId}.fullyVerifiedContrasts`);
      }
      // The builder forces 'unresolved' over a review_required status or a pipeline mismatch.
      const forced = verification.comparisonOutcome === 'unresolved'
        && (record.status === 'review_required' || record.pipelineTrace === 'mismatch');
      if (verification.comparisonOutcome !== review.comparisonOutcome && !forced) drift.push(`${datasetId}.comparisonOutcome`);
    }
    expect(drift, 'verification-review.json changed after validation-records.generated.json was built').toEqual([]);
  });

  freshness('carries every comparability review unchanged', () => {
    const drift = Object.entries(comparabilityLedger)
      .filter(([datasetId, review]) => JSON.stringify(byId.get(datasetId)?.verification.comparability) !== JSON.stringify(review))
      .map(([datasetId]) => datasetId);
    expect(drift, 'comparability-review.json changed after validation-records.generated.json was built').toEqual([]);
  });

  freshness('was built from the committed ledgers and direct comparisons', () => {
    expect(Object.keys(generated.inputSha256 ?? {}), 'validation-records.generated.json predates its input hashes').toEqual([...AUTHOR_VALIDATION_INPUTS]);
    expect(generated.inputSha256).toEqual(authorValidationInputSha256(ROOT));
  });
});
