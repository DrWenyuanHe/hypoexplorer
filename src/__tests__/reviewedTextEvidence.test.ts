import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchesReviewedTextSha256 } from '../../scripts/lib/reviewedTextEvidence.mjs';

const reviewed = '{\r\n  "gene": "A",\r\n  "row": 1\r\n}\r\n';
const pin = createHash('sha256').update(reviewed).digest('hex');

describe('reviewed text evidence pins', () => {
  it('accepts original bytes and Git LF normalization under the original pin', () => {
    expect(matchesReviewedTextSha256(Buffer.from(reviewed), pin)).toBe(true);
    expect(matchesReviewedTextSha256(Buffer.from(reviewed.replace(/\r\n/g, '\n')), pin)).toBe(true);
  });

  it.each([
    reviewed.replace('"A"', '"B"'),
    reviewed.replace('  "row"', ' "row"'),
    reviewed.trimEnd(),
    `\uFEFF${reviewed}`,
    reviewed.replace('\r\n', '\n'),
    reviewed.replace('\r\n', '\r'),
  ])('rejects content, whitespace, BOM and mixed newline edits', (changed) => {
    expect(matchesReviewedTextSha256(Buffer.from(changed), pin)).toBe(false);
  });

  it('retains the original GSE160467 mapping pin after repository EOL normalization', () => {
    const bytes = readFileSync(resolve('data/author-validation/continued-sources/ten-dataset-followup-2026-09-04/GSE160467/recovered-author-labels.json'));
    expect(matchesReviewedTextSha256(bytes, 'cee7b27ad4de69a23eb2396c167677af797570d95307ebc1877331589285eb0f')).toBe(true);
  });
});
