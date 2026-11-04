/** Record advances in the original corpus, without attributing concurrent intake to this audit. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { QualityAssessment } from '../src/data/qualityChecks';

const folder = 'data/quality/round3-2026-09-05';
// Completed reports use their original bytes; later evidence belongs in a later round.
const snapshot = JSON.parse(gunzipSync(readFileSync(`${folder}/closed-inputs.json.gz`)).toString('utf8'));
const input = (path: string): Buffer => {
  if (snapshot.schemaVersion !== 1 || snapshot.encoding !== 'base64' || typeof snapshot.files[path] !== 'string') {
    throw new Error(`Missing historical input: ${path}`);
  }
  return Buffer.from(snapshot.files[path], 'base64');
};
const read = (path: string) => JSON.parse(input(path).toString('utf8'));
const baseline = read(`${folder}/baseline.json`);
const current = read('data/quality/assessments.generated.json');
const internalQc = read('data/internal-qc/assessments.generated.json');
const validation = read('data/author-validation/validation-records.generated.json');
const conservation = read('data/internal-qc/conservation-2026-09-05/conservation-evidence.json');
const replication = read('data/internal-qc/replication-2026-09-05/replication-evidence.json');
const definitions = read('data/author-validation/concordance-reviews.json');
const historicalDefinitions = read('data/quality/round2-2026-09-05/concordance-reviews.snapshot.json');
const closed = JSON.parse(gunzipSync(input('data/quality/round2-2026-09-05/closed-inputs.json.gz')).toString('utf8'));
const previousConservation = JSON.parse(closed.files['data/internal-qc/conservation-2026-09-05/conservation-evidence.json']);
const previousReplication = JSON.parse(closed.files['data/internal-qc/replication-2026-09-05/replication-evidence.json']);
if (JSON.stringify(baseline.quality.authorConcordancePolicy) !== JSON.stringify(current.authorConcordancePolicy)) {
  throw new Error('Round-three policy changed; report must explicitly distinguish that change');
}
type Row = { datasetId: string; accession: string; internalQc: QualityAssessment; authorConcordance: QualityAssessment };
const keys = ['internalQc', 'authorConcordance'] as const;
const statuses = ['pass', 'review', 'fail', 'not_assessed', 'not_applicable'];
const counts = (rows: Row[], key: typeof keys[number]) => Object.fromEntries(statuses.map(status => [status, rows.filter(row => row[key].status === status).length]));
const records = baseline.quality.records.map((before: Row) => {
  const after: Row = current.records.find((row: Row) => row.datasetId === before.datasetId);
  if (!after) throw new Error(`Original dataset missing: ${before.datasetId}`);
  const priorAuthor = baseline.validation.records.find((row: any) => row.datasetId === before.datasetId);
  const author = validation.records.find((row: any) => row.datasetId === before.datasetId);
  const checks = Object.fromEntries(keys.map(key => [key, after[key].checks.flatMap(check => {
    const prior = before[key].checks.find(old => old.id === check.id);
    return check.status === prior?.status && check.required === prior?.required ? []
      : [{ id: check.id, before: prior?.status ?? 'not_assessed', after: check.status, note: check.note }];
  })]));
  const newlyReviewedDefinition = definitions.reviews.some((entry: any) => entry.datasetId === before.datasetId)
    && !historicalDefinitions.reviews.some((entry: any) => entry.datasetId === before.datasetId);
  const authorMeasurementsUnchanged = JSON.stringify(author?.directComparison) === JSON.stringify(priorAuthor?.directComparison);
  if (newlyReviewedDefinition && !authorMeasurementsUnchanged) throw new Error(`Semantic review attribution has changed measurements: ${before.datasetId}`);
  return { datasetId: before.datasetId, accession: before.accession,
    before: Object.fromEntries(keys.map(key => [key, before[key].status])), after: Object.fromEntries(keys.map(key => [key, after[key].status])),
    changes: checks, newlyReviewedDefinition, authorMeasurementsUnchanged,
    blockers: Object.fromEntries(keys.map(key => [key, after[key].checks.filter(check => check.required !== false && !['pass', 'not_applicable'].includes(check.status))])),
    authorScope: after.authorConcordance.scope, internalScope: after.internalQc.scope,
    contextualAuthorChecks: after.authorConcordance.checks.filter(check => check.required === false),
    authorNextStep: author.verification.nextStep };
});
const targetIds = new Set(records.map((row: any) => row.datasetId));
const currentScope = current.records.filter((row: Row) => targetIds.has(row.datasetId));
const replicationScope = replication.records.filter((row: any) => targetIds.has(row.datasetId));
const previousReplicationScope = previousReplication.records.filter((row: any) => targetIds.has(row.datasetId));
const newConservation = conservation.records.filter((row: any) => targetIds.has(row.datasetId) && row.status === 'pass'
  && previousConservation.records.find((old: any) => old.datasetId === row.datasetId)?.status !== 'pass');
const summary = { datasets: records.length, policyUnchanged: true,
  before: Object.fromEntries(keys.map(key => [key, counts(baseline.quality.records, key)])),
  after: Object.fromEntries(keys.map(key => [key, counts(currentScope, key)])),
  comparisons: { before: baseline.validation.records.filter((row: any) => row.directComparison).length,
    after: validation.records.filter((row: any) => targetIds.has(row.datasetId) && row.directComparison).length },
  newInternalQcPasses: records.filter((row: any) => row.before.internalQc !== 'pass' && row.after.internalQc === 'pass').map((row: any) => row.datasetId),
  authorSemanticReviewPasses: records.filter((row: any) => row.newlyReviewedDefinition && row.before.authorConcordance !== 'pass' && row.after.authorConcordance === 'pass').map((row: any) => row.datasetId),
  newlyConservedDatasets: newConservation.map((row: any) => row.datasetId),
  newlyComparedCountValues: newConservation.reduce((sum: number, row: any) => sum + row.comparedCells, 0),
  newlyComparedLibraries: newConservation.reduce((sum: number, row: any) => sum + row.samples.length, 0),
  replication: { before: previousReplicationScope.length, after: replicationScope.length,
    currentStatuses: Object.fromEntries(statuses.map(status => [status, replicationScope.filter((row: any) => row.proposedStatus === status).length])) },
  currentLedgerCoverage: { internalQc: internalQc.records.length, quality: current.records.length, author: validation.records.length },
  concurrentNewDatasetIdsOutsideAudit: internalQc.records.filter((row: Row) => !targetIds.has(row.datasetId)).map((row: Row) => row.datasetId) };
const dependencies = [`${folder}/baseline.json`, 'data/quality/assessments.generated.json',
  'data/internal-qc/assessments.generated.json',
  'data/author-validation/validation-records.generated.json', 'data/author-validation/concordance-reviews.json',
  'data/quality/round2-2026-09-05/closed-inputs.json.gz', 'data/internal-qc/conservation-2026-09-05/conservation-evidence.json',
  'data/quality/round2-2026-09-05/concordance-reviews.snapshot.json',
  'data/internal-qc/replication-2026-09-05/replication-evidence.json',
].map(path => ({ path, sha256: createHash('sha256').update(input(path)).digest('hex') }));
const clean = (text: string) => text.replace(/[|\r\n\t]/g, ' ');
const md = ['# Existing dataset verification: third continuation', '',
  'This round starts from the preserved 145-dataset baseline with 44 internal-QC passes, 21 author-concordance passes and 54 structured comparisons. Three subagents divided original-source conservation and two primary-source replication batches. Reviews, unresolved cases and original evidence remain separate from the status totals.', '',
  '| Assessment | Before | Current |', '|---|---:|---:|',
  `| Complete internal QC | ${summary.before.internalQc.pass} | ${summary.after.internalQc.pass} |`,
  `| Author concordance | ${summary.before.authorConcordance.pass} | ${summary.after.authorConcordance.pass} |`,
  `| Structured author comparisons | ${summary.comparisons.before} | ${summary.comparisons.after} |`, '',
  `Five complete original-source count comparisons account for ${summary.newlyComparedCountValues.toLocaleString('en-US')} additional values across ${summary.newlyComparedLibraries} libraries. GSE254155 is equal by complete unique gene identity despite different row order; its exact-byte reconstruction remains unassessed. GSE205313 still lacks the original versioned transcript-to-gene projection. [Conservation source review](./SOURCE_CONSERVATION.md).`, '',
  `Primary-source replication now covers ${summary.replication.after} datasets, previously ${summary.replication.before}. The reviews distinguish animals, pools, litters, sequencing records and multiplexed sources. Chamber, housing and unknown pool/litter membership remain explicit findings. [Batch A](./REPLICATION_A.md), [batch B](./REPLICATION_B.md).`, '',
  `Author acceptance thresholds are unchanged. ${summary.authorSemanticReviewPasses.length} author badges change after explicit source-bound reviews separate known effect units and biological direction from legacy numerical or exact-method limitations. Their original comparisons and metrics are unchanged. These are review corrections, not new measurements or successful author-model reproductions. Prior notes, magnitude differences, missing statistics and selected-reference scope remain visible. [Semantic reviews and attribution](./AUTHOR_SEMANTICS.md).`, '',
  '## Review and verification', '',
  '- [Independent review and resolved findings](./REVIEW.md)',
  '- [Executed validation and browser checks](./VALIDATION.md)',
  '- [Every changed check and remaining required blocker](./round3-report.json)',
  '- [Scientific file preservation and concurrent intake](./scientific-files.after.json)', '',
  'The separate task adding September 5 datasets shares this checkout. Its new intake and registry work is outside the original-corpus before/after totals. The completed second-round report now uses retained compressed input snapshots, so later work cannot rewrite its historical outcome.', '',
  '| Dataset | Internal QC | Author concordance | Remaining author task |', '|---|---|---|---|',
  ...records.map((row: any) => `| ${clean(row.accession || row.datasetId)} | ${row.before.internalQc} → ${row.after.internalQc} | ${row.before.authorConcordance} → ${row.after.authorConcordance} | ${clean(row.authorNextStep)} |`), '',
].join('\n');
for (const [name, body] of Object.entries({ 'round3-report.json': `${JSON.stringify({ schemaVersion: 1, summary, dependencies, records }, null, 2)}\n`, 'ADVANCEMENT_REPORT.md': md })) {
  const path = `${folder}/${name}`;
  if (process.argv.includes('--check')) { if (readFileSync(path, 'utf8') !== body) throw new Error(`Stale round-three report: ${path}`); }
  else writeFileSync(path, body);
}
console.log(JSON.stringify(summary));
