import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readSealedHistoricalInput } from './historicalEvidence.mjs';

export function assertPipelineReviewEvidence(root: string): void {
  const path = 'data/quality/pipeline-separation-2026-09-11/reviewed-pipeline-limitations.json';
  const bytes = readFileSync(resolve(root, path));
  const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
  if (hash(bytes) !== '5b0a393e4c6249a407983f9804804dadb9a7977b15ed922eefd535b3a50f176b') {
    throw new Error('Reviewed pipeline limitations changed; independent review is required before updating the evidence seal.');
  }
  const approved = JSON.parse(bytes.toString('utf8'));
  for (const ref of [approved.proposal, approved.sourceLedger]) {
    if (hash(readSealedHistoricalInput(root, ref.path, ref.sha256)) !== ref.sha256) throw new Error(`Pipeline review evidence is stale: ${ref.path}`);
  }
}
