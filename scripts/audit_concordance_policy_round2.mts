/** Isolate acceptance-policy effects using unchanged pre-round-two evidence. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { assessAuthorConcordance, AUTHOR_CONCORDANCE_POLICY } from '../src/data/authorConcordance';
import type { AuthorValidationRecord } from '../src/data/authorValidation';
import type { QualityAssessment } from '../src/data/qualityChecks';
import historicalDefinitionReviews from '../data/quality/round2-2026-09-05/concordance-reviews.snapshot.json';

const folder = 'data/quality/round2-2026-09-05';
const raw = readFileSync(`${folder}/baseline.json`);
const baseline = JSON.parse(raw.toString('utf8')) as {
  validation: { records: AuthorValidationRecord[] };
  quality: { authorConcordancePolicy: unknown; records: { datasetId: string; authorConcordance: QualityAssessment }[] };
};
const records = baseline.validation.records.map((record) => {
  const before = baseline.quality.records.find((entry) => entry.datasetId === record.datasetId)!.authorConcordance;
  const after = assessAuthorConcordance(record, undefined, historicalDefinitionReviews);
  return { datasetId: record.datasetId, accession: record.accession, before: before.status, after: after.status,
    route: after.checks.find((check) => check.id === 'author_concordance_route') ?? null,
    changedStatus: before.status !== after.status,
    outstanding: after.checks.filter((check) => check.required !== false && !['pass', 'not_applicable'].includes(check.status)),
    contextualConcerns: after.checks.filter((check) => check.required === false && !['pass', 'not_applicable'].includes(check.status)) };
});
const body = `${JSON.stringify({ schemaVersion: 1,
  scope: 'Policy-only counterfactual on the unchanged round-two baseline. No new author or internal-QC evidence is used.',
  baselineSha256: createHash('sha256').update(raw).digest('hex'),
  oldPolicy: baseline.quality.authorConcordancePolicy, newPolicy: AUTHOR_CONCORDANCE_POLICY,
  beforePasses: records.filter((record) => record.before === 'pass').length,
  afterPasses: records.filter((record) => record.after === 'pass').length,
  changed: records.filter((record) => record.changedStatus), records,
}, null, 2)}\n`;
const output = `${folder}/policy-only-impact.json`;
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== body) throw new Error('Policy-only impact is stale');
} else writeFileSync(output, body);
console.log(JSON.stringify({ unchangedEvidence: true, beforePasses: records.filter((record) => record.before === 'pass').length,
  afterPasses: records.filter((record) => record.after === 'pass').length,
  changed: records.filter((record) => record.changedStatus).map(({ accession, before, after }) => ({ accession, before, after })) }));
