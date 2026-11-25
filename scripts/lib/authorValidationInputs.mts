import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Reviewed ledgers and the generated comparison table that
 * `build_author_validation.mts` turns into `validation-records.generated.json`.
 * `additional-comparison-specs.json` reaches the records through
 * `compare_author_results.mts`, so a spec change also needs that step first.
 */
export const AUTHOR_VALIDATION_INPUTS = [
  'data/author-validation/verification-review.json',
  'data/author-validation/manual-review.json',
  'data/author-validation/comparability-review.json',
  'data/author-validation/additional-comparison-specs.json',
  'data/author-validation/direct-comparisons.generated.json',
] as const;

/**
 * SHA-256 of each input's LF-normalized text, keyed by repository path. The
 * generated records store this map so a check without the untracked evidence
 * can still tell that a ledger changed after the records were built.
 */
export function authorValidationInputSha256(root: string): Record<string, string> {
  return Object.fromEntries(AUTHOR_VALIDATION_INPUTS.map((path) => [
    path,
    createHash('sha256').update(readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n')).digest('hex'),
  ]));
}
