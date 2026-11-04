/** Attribute this round's evidence changes only to the original 145 datasets. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { QualityAssessment } from '../src/data/qualityChecks';

const folder = 'data/quality/round4-2026-09-05';
// Keep this completed round reproducible after newer evidence advances the live ledgers.
const snapshot = JSON.parse(gunzipSync(readFileSync(`${folder}/closed-inputs.json.gz`)).toString('utf8'));
const input = (path: string): Buffer => {
  if (snapshot.schemaVersion !== 1 || snapshot.encoding !== 'base64' || typeof snapshot.files[path] !== 'string') throw new Error(`Missing historical input: ${path}`);
  return Buffer.from(snapshot.files[path], 'base64');
};
const read = (path: string) => JSON.parse(input(path).toString('utf8'));
const baseline = read(`${folder}/baseline.json`);
const quality = read('data/quality/assessments.generated.json');
const internalQc = read('data/internal-qc/assessments.generated.json');
const validation = read('data/author-validation/validation-records.generated.json');
const replication = read('data/internal-qc/replication-2026-09-05/replication-evidence.json');
const sources = read('data/internal-qc/source-authenticity-2026-09-05/round4/evidence.json');
const closed = JSON.parse(gunzipSync(input('data/quality/round3-2026-09-05/closed-inputs.json.gz')).toString('utf8'));
const priorReplication = JSON.parse(Buffer.from(closed.files['data/internal-qc/replication-2026-09-05/replication-evidence.json'], 'base64').toString('utf8'));
const ids = new Set<string>(baseline.originalDatasetIds);
if (ids.size !== 145 || ids.size !== baseline.originalDatasetIds.length) throw new Error('Invalid original audit scope');
const uniqueIds = (rows: { datasetId: string }[], label: string) => {
  const values = rows.map(row => row.datasetId);
  if (values.some(id => typeof id !== 'string' || !id) || new Set(values).size !== values.length) throw new Error(`${label}: missing or duplicate dataset ID`);
  return new Set(values);
};
const sameIds = (actual: Set<string>, expected: Set<string>, label: string) => {
  if (actual.size !== expected.size || [...expected].some(id => !actual.has(id))) throw new Error(`${label}: dataset scope differs`);
};
const baselineIds = uniqueIds(baseline.quality.records, 'Baseline quality');
if ([...ids].some(id => !baselineIds.has(id))) throw new Error('Baseline omits an original dataset');
const outsideIds = new Set([...baselineIds].filter(id => !ids.has(id)));
if (outsideIds.size !== 14) throw new Error('Baseline intake scope must contain exactly 14 datasets');
for (const [label, ledger] of Object.entries({ 'Baseline internal QC': baseline.internalQc, 'Baseline author': baseline.validation,
  'Current quality': quality, 'Current internal QC': internalQc, 'Current author': validation })) {
  sameIds(uniqueIds((ledger as { records: { datasetId: string }[] }).records, label), baselineIds, label);
}
for (const [label, ledger] of Object.entries({ Replication: replication, 'Prior replication': priorReplication, 'Source relationships': sources })) {
  if ([...uniqueIds(ledger.records, label)].some(id => !ids.has(id))) throw new Error(`${label}: evidence outside original audit scope`);
}
if (JSON.stringify(baseline.quality.authorConcordancePolicy) !== JSON.stringify(quality.authorConcordancePolicy)) throw new Error('Acceptance policy changed');
type Row = { datasetId: string; accession: string; internalQc: QualityAssessment; authorConcordance: QualityAssessment };
const kinds = ['internalQc', 'authorConcordance'] as const;
const statuses = ['pass', 'review', 'fail', 'not_assessed', 'not_applicable'];
const counts = (rows: Row[], kind: typeof kinds[number]) => Object.fromEntries(statuses.map(status => [status, rows.filter(row => ids.has(row.datasetId) && row[kind].status === status).length]));
const records = baseline.quality.records.filter((row: Row) => ids.has(row.datasetId)).map((before: Row) => {
  const matches = quality.records.filter((row: Row) => row.datasetId === before.datasetId);
  if (matches.length !== 1) throw new Error(`Missing unique original dataset: ${before.datasetId}`);
  const after: Row = matches[0];
  const author = validation.records.find((row: Row) => row.datasetId === before.datasetId);
  const oldAuthor = baseline.validation.records.find((row: Row) => row.datasetId === before.datasetId);
  const measurementsUnchanged = JSON.stringify(author.directComparison) === JSON.stringify(oldAuthor.directComparison);
  if (!measurementsUnchanged) throw new Error(`This round's author review changed numerical comparisons: ${before.datasetId}`);
  return { datasetId: before.datasetId, accession: before.accession,
    before: Object.fromEntries(kinds.map(kind => [kind, before[kind].status])),
    after: Object.fromEntries(kinds.map(kind => [kind, after[kind].status])), authorMeasurementsUnchanged: measurementsUnchanged,
    changes: Object.fromEntries(kinds.map(kind => [kind, [...after[kind].checks.flatMap(check => {
      const previous = before[kind].checks.find(row => row.id === check.id);
      return previous?.status === check.status && previous?.note === check.note && previous?.required === check.required ? []
        : [{ id: check.id, before: previous?.status ?? 'not_assessed', after: check.status, required: check.required !== false, note: check.note }];
    }), ...before[kind].checks.filter(check => !after[kind].checks.some(current => current.id === check.id)).map(check => ({
      id: check.id, before: check.status, after: 'removed', required: check.required !== false, note: `Removed check; previous evidence: ${check.note}`,
    }))]])),
    blockers: Object.fromEntries(kinds.map(kind => [kind, after[kind].checks.filter(check => check.required !== false && !['pass', 'not_applicable'].includes(check.status))])),
    contrastAssessments: internalQc.records.find((row: Row) => row.datasetId === before.datasetId)?.contrasts,
    authorNextStep: author.verification.nextStep };
});
const summary = { datasets: ids.size, policyUnchanged: true,
  before: Object.fromEntries(kinds.map(kind => [kind, counts(baseline.quality.records, kind)])),
  after: Object.fromEntries(kinds.map(kind => [kind, counts(quality.records, kind)])),
  newInternalQcPasses: records.filter((row: any) => row.before.internalQc !== 'pass' && row.after.internalQc === 'pass').map((row: any) => row.datasetId),
  authorReviewPasses: records.filter((row: any) => row.before.authorConcordance !== 'pass' && row.after.authorConcordance === 'pass').map((row: any) => row.datasetId),
  comparisons: { before: baseline.validation.records.filter((row: any) => ids.has(row.datasetId) && row.directComparison).length,
    after: validation.records.filter((row: any) => ids.has(row.datasetId) && row.directComparison).length },
  replication: { before: priorReplication.records.length, after: replication.records.length,
    mappings: replication.records.reduce((sum: number, row: any) => sum + row.mappings.length, 0),
    contrastStatuses: Object.fromEntries(statuses.map(status => [status, replication.records.flatMap((row: any) => Object.values(row.contrasts)).filter((contrast: any) => contrast.check.status === status).length])) },
  fullSourceRelationships: { reviewed: sources.records.length, pass: sources.records.filter((row: any) => row.status === 'pass').length,
    unresolved: sources.records.filter((row: any) => row.status !== 'pass').map((row: any) => row.accession),
    completeTableCellsCompared: sources.records.reduce((sum: number, row: any) => sum + (row.comparison?.allCellsCompared ?? 0), 0) },
  currentLedgerCoverage: { internalQc: internalQc.records.length, quality: quality.records.length, author: validation.records.length },
  datasetsOutsideAudit: quality.records.filter((row: Row) => !ids.has(row.datasetId)).map((row: Row) => row.datasetId) };
const dependencies = [`${folder}/baseline.json`, 'data/quality/assessments.generated.json', 'data/internal-qc/assessments.generated.json',
  'data/author-validation/validation-records.generated.json', 'data/author-validation/concordance-reviews.json',
  'data/internal-qc/replication-2026-09-05/replication-evidence.json',
  'data/internal-qc/source-authenticity-2026-09-05/round4/evidence.json', 'data/quality/round3-2026-09-05/closed-inputs.json.gz',
].map(path => ({ path, sha256: createHash('sha256').update(input(path)).digest('hex') }));
const clean = (value: string) => value.replace(/[|\r\n\t]/g, ' ');
const markdown = ['# Existing dataset verification: fourth continuation', '',
  'Three subagents divided two biological-replication batches and complete source-to-input reconstruction. This report counts only the original 145 datasets. Concurrent intake is listed separately and receives no credit in these before/after totals.', '',
  '| Assessment | Before | After |', '|---|---:|---:|',
  `| Complete internal QC | ${summary.before.internalQc.pass} | ${summary.after.internalQc.pass} |`,
  `| Author concordance | ${summary.before.authorConcordance.pass} | ${summary.after.authorConcordance.pass} |`,
  `| Structured author comparisons | ${summary.comparisons.before} | ${summary.comparisons.after} |`, '',
  `${summary.fullSourceRelationships.reviewed} full input relationships were investigated; ${summary.fullSourceRelationships.pass} pass. The complete-table comparisons cover ${summary.fullSourceRelationships.completeTableCellsCompared.toLocaleString('en-US')} parsed cells, including unresolved comparisons. Two dedicated scripts consume authenticated normalized inputs and reproduce all five registered contrasts in isolated directories. [Source reconstruction and limitations](./SOURCE_AUTHENTICITY.md).`, '',
  `Reviewed biological replication now covers ${summary.replication.after} datasets and ${summary.replication.mappings} mapped libraries. Exact library-to-source failures remain separately documented; missing animal, pool, litter or culture independence cannot be replaced by unique labels. [Batch C](./REPLICATION_C.md), [batch D](./REPLICATION_D.md).`, '',
  'Author acceptance thresholds and all 54 structured numerical comparisons are unchanged. GSE167105 receives separately pinned cohort and effect-definition reviews. The original SMC3 preprint exposed unresolved timing and method discrepancies for GSE243287, which remains under review. [Author review and historical preservation](./AUTHOR_REVIEW.md).', '',
  '- [Independent review and resolved findings](./REVIEW.md)',
  '- [Executed checks and browser validation](./VALIDATION.md)',
  '- [Every changed check, contrast assessment and remaining blocker](./round4-report.json)',
  '- [Scientific file preservation](./scientific-files.after.json)', '',
  '| Dataset | Internal QC | Author concordance | Next author evidence task |', '|---|---|---|---|',
  ...records.map((row: any) => `| ${clean(row.accession || row.datasetId)} | ${row.before.internalQc} → ${row.after.internalQc} | ${row.before.authorConcordance} → ${row.after.authorConcordance} | ${clean(row.authorNextStep)} |`), '',
].join('\n');
for (const [name, body] of Object.entries({ 'round4-report.json': `${JSON.stringify({ schemaVersion: 1, summary, dependencies, records }, null, 2)}\n`, 'ADVANCEMENT_REPORT.md': markdown })) {
  const path = `${folder}/${name}`;
  if (process.argv.includes('--check')) { if (readFileSync(path, 'utf8') !== body) throw new Error(`Stale round-four report: ${path}`); }
  else writeFileSync(path, body);
}
console.log(JSON.stringify(summary));
