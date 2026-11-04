/** Current fifth-round evidence changes, credited only to the original 145 datasets. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import type { QualityAssessment } from '../src/data/qualityChecks';

const folder = 'data/quality/round5-2026-09-05';
const closedPath = `${folder}/closed-inputs.json.gz`;
const closed = existsSync(closedPath) ? JSON.parse(gunzipSync(readFileSync(closedPath)).toString('utf8')) : null;
if (closed && (closed.schemaVersion !== 1 || closed.encoding !== 'base64')) throw new Error('Invalid closed fifth-round archive');
const dependencies = new Map<string, string>();
const input = (path: string): Buffer => {
  if (closed && typeof closed.files[path] !== 'string') throw new Error(`Missing closed fifth-round input: ${path}`);
  const bytes = closed ? Buffer.from(closed.files[path], 'base64') : readFileSync(path);
  dependencies.set(path, createHash('sha256').update(bytes).digest('hex'));
  return bytes;
};
const read = (path: string) => JSON.parse(input(path).toString('utf8'));
const baseline = read(`${folder}/baseline.json`);
const quality = read('data/quality/assessments.generated.json');
const internalQc = read('data/internal-qc/assessments.generated.json');
const validation = read('data/author-validation/validation-records.generated.json');
const replication = read('data/internal-qc/replication-2026-09-05/replication-evidence.json');
const sources = read('data/internal-qc/source-authenticity-2026-09-05/round5/evidence.json');
const sourceReader = read('data/internal-qc/source-authenticity-2026-09-05/round5/reader-evaluations.json');
const keyed = read('data/internal-qc/source-authenticity-2026-09-05/round5-keyed/evidence.json');
const keyedReader = read('data/internal-qc/source-authenticity-2026-09-05/round5-keyed/reader-evaluations.json');
const archive = JSON.parse(gunzipSync(input('data/quality/round4-2026-09-05/closed-inputs.json.gz')).toString('utf8'));
if (archive.schemaVersion !== 1 || archive.encoding !== 'base64') throw new Error('Invalid closed fourth-round archive');
const historical = (path: string) => {
  if (typeof archive.files[path] !== 'string') throw new Error(`Missing closed historical input: ${path}`);
  return JSON.parse(Buffer.from(archive.files[path], 'base64').toString('utf8'));
};
const priorReplication = historical('data/internal-qc/replication-2026-09-05/replication-evidence.json');
for (const [key, path] of Object.entries({quality:'data/quality/assessments.generated.json',
  internalQc:'data/internal-qc/assessments.generated.json',validation:'data/author-validation/validation-records.generated.json'})) {
  if (!isDeepStrictEqual(baseline[key], historical(path))) throw new Error(`Fifth-round ${key} baseline differs from closed fourth-round final ledger`);
}
const ids = new Set<string>(baseline.originalDatasetIds);
if (ids.size !== 145 || ids.size !== baseline.originalDatasetIds.length) throw new Error('Original scope must contain 145 unique datasets');
if (!isDeepStrictEqual(baseline.originalDatasetIds, historical('data/quality/round4-2026-09-05/baseline.json').originalDatasetIds)) throw new Error('Original dataset scope differs from closed history');
const unique = (rows: {datasetId: string}[], label: string) => {
  const values = rows.map(row => row.datasetId);
  if (values.some(id => !id) || new Set(values).size !== values.length) throw new Error(`Missing or duplicate ${label} dataset`);
  return new Set(values);
};
const baselineIds = unique(baseline.quality.records, 'baseline quality');
if (baselineIds.size !== 159 || [...ids].some(id => !baselineIds.has(id))) throw new Error('Baseline must preserve the original145 and14intake datasets');
for (const [label, ledger] of Object.entries({baselineInternalQc:baseline.internalQc,baselineAuthor:baseline.validation,
  quality,internalQc,validation})) {
  if (!isDeepStrictEqual(unique((ledger as any).records, label), baselineIds)) throw new Error(`${label} scope differs from the exact159-dataset baseline`);
}
for (const [label, rows] of Object.entries({replication:replication.records,priorReplication:priorReplication.records,sources:sources.records,
  sourceReader:sourceReader.records, keyed:[keyed], keyedReader:keyedReader.records})) {
  if ([...unique(rows as any, label)].some(id => !ids.has(id))) throw new Error(`${label} credits datasets outside the original scope`);
}
if (sources.records.length !== 12 || keyedReader.records.length !== 1
  || !isDeepStrictEqual(unique(sources.records,'sources'),unique(sourceReader.records,'sourceReader'))
  || keyedReader.records[0].datasetId !== keyed.datasetId) throw new Error('Complete source evidence and reader scopes differ');
if (!isDeepStrictEqual(baseline.quality.authorConcordancePolicy, quality.authorConcordancePolicy)) throw new Error('Author acceptance policy changed');
type Row = {datasetId: string; accession: string; internalQc: QualityAssessment; authorConcordance: QualityAssessment};
const kinds = ['internalQc', 'authorConcordance'] as const;
const statuses = ['pass', 'review', 'fail', 'not_assessed', 'not_applicable'];
const counts = (rows: Row[], kind: typeof kinds[number]) => Object.fromEntries(statuses.map(status => [status, rows.filter(row => ids.has(row.datasetId) && row[kind].status === status).length]));
const records = baseline.quality.records.filter((row: Row) => ids.has(row.datasetId)).map((before: Row) => {
  const after: Row = quality.records.find((row: Row) => row.datasetId === before.datasetId);
  const author = validation.records.find((row: Row) => row.datasetId === before.datasetId);
  const oldAuthor = baseline.validation.records.find((row: Row) => row.datasetId === before.datasetId);
  if (!isDeepStrictEqual(author.directComparison, oldAuthor.directComparison)) throw new Error(`Numerical author comparison changed: ${before.datasetId}`);
  return {datasetId:before.datasetId,accession:before.accession,
    before:Object.fromEntries(kinds.map(kind => [kind,before[kind].status])),
    after:Object.fromEntries(kinds.map(kind => [kind,after[kind].status])),authorMeasurementsUnchanged:true,
    changes:Object.fromEntries(kinds.map(kind => [kind,[...after[kind].checks.flatMap(check => {
      const previous = before[kind].checks.find(row => row.id === check.id);
      return isDeepStrictEqual(previous,check) ? [] : [{id:check.id,before:previous?.status ?? 'not_assessed',after:check.status,required:check.required !== false,note:check.note}];
    }),...before[kind].checks.filter(check => !after[kind].checks.some(row => row.id === check.id)).map(check => ({id:check.id,before:check.status,after:'removed',required:check.required !== false,note:check.note}))]])),
    blockers:Object.fromEntries(kinds.map(kind => [kind,after[kind].checks.filter(check => check.required !== false && !['pass','not_applicable'].includes(check.status))])),
    contrastAssessments:internalQc.records.find((row: Row) => row.datasetId === before.datasetId).contrasts,
    authorNextStep:author.verification.nextStep};
});
if (records.length !== 145) throw new Error('Baseline omits original records');
const sourceDecisions = [...sourceReader.records,...keyedReader.records];
const summary = {datasets:145,policyUnchanged:true,
  before:Object.fromEntries(kinds.map(kind => [kind,counts(baseline.quality.records,kind)])),
  after:Object.fromEntries(kinds.map(kind => [kind,counts(quality.records,kind)])),
  newInternalQcPasses:records.filter((row: any) => row.before.internalQc !== 'pass' && row.after.internalQc === 'pass').map((row: any) => row.datasetId),
  priorInternalQcPassesRequiringReview:records.filter((row: any) => row.before.internalQc === 'pass' && row.after.internalQc !== 'pass').map((row: any) => row.datasetId),
  authorMeasurementsUnchanged:true,
  comparisons:validation.records.filter((row: any) => ids.has(row.datasetId) && row.directComparison).length,
  replication:{before:priorReplication.records.length,after:replication.records.length,
    mappings:replication.records.reduce((sum: number,row: any) => sum+row.mappings.length,0),
    contrastStatuses:Object.fromEntries(statuses.map(status => [status,replication.records.flatMap((row: any) => Object.values(row.contrasts)).filter((row: any) => row.check.status === status).length]))},
  fullSourceRelationships:{reviewed:sourceDecisions.length,pass:sourceDecisions.filter(row => row.status === 'pass').length,
    decisions:sourceDecisions.map(row => ({datasetId:row.datasetId,accession:row.accession,status:row.status,note:row.note})),
    completeTableCellsCompared:sources.records.reduce((sum: number,row: any) => sum+(row.comparison?.allCellsCompared ?? 0),0)+keyed.comparison.allCellsCompared},
  currentLedgerCoverage:{internalQc:internalQc.records.length,quality:quality.records.length,author:validation.records.length},
  datasetsOutsideAudit:quality.records.filter((row: Row) => !ids.has(row.datasetId)).map((row: Row) => row.datasetId)};
const clean = (value: string) => value.replace(/[|\r\n\t]/g,' ');
const markdown = ['# Existing dataset verification: fifth continuation','',
  'This round audits the original 145 datasets. Two subagents reviewed biological replication for 36 datasets, including earlier passes. A third reconstructed complete original inputs. The parent separately checked a complete gene-keyed input relationship. Concurrent intake receives no credit in these totals.','',
  '| Assessment | Before | After |','|---|---:|---:|',
  `| Complete internal QC | ${summary.before.internalQc.pass} | ${summary.after.internalQc.pass} |`,
  `| Author concordance | ${summary.before.authorConcordance.pass} | ${summary.after.authorConcordance.pass} |`,'',
  `${summary.newInternalQcPasses.length} datasets gained a complete internal QC pass. ${summary.priorInternalQcPassesRequiringReview.length} previous passes no longer pass. All ${summary.comparisons} structured author comparisons and the acceptance thresholds remain unchanged.`, '',
  `Reviewed replication covers ${summary.replication.after} datasets and ${summary.replication.mappings} source-library mappings. This round investigated ${summary.fullSourceRelationships.reviewed} complete input relationships, of which ${summary.fullSourceRelationships.pass} pass. The comparisons cover ${summary.fullSourceRelationships.completeTableCellsCompared.toLocaleString('en-US')} parsed cells.`, '',
  '- [Replication batch E](./REPLICATION_E.md)', '- [Replication batch F](./REPLICATION_F.md)',
  '- [Complete original-input reconstruction](./SOURCE_AUTHENTICITY.md)', '- [Gene-keyed reconstruction and unresolved GSE185074](./KEYED_SOURCE_REVIEW.md)',
  '- [Independent review](./REVIEW.md)', '- [Executed validation and browser checks](./VALIDATION.md)',
  '- [Every changed check, per-contrast decision and remaining blocker](./round5-report.json)',
  '- [Scientific file preservation](./scientific-files.after.json)', '',
  '| Dataset | Internal QC | Author concordance | Next author evidence task |','|---|---|---|---|',
  ...records.map((row: any) => `| ${clean(row.accession || row.datasetId)} | ${row.before.internalQc} → ${row.after.internalQc} | ${row.before.authorConcordance} → ${row.after.authorConcordance} | ${clean(row.authorNextStep)} |`),''].join('\n');
for (const [name,text] of Object.entries({'round5-report.json':`${JSON.stringify({schemaVersion:1,summary,dependencies:[...dependencies].map(([path,sha256])=>({path,sha256})),records},null,2)}\n`,'ADVANCEMENT_REPORT.md':markdown})) {
  const path = `${folder}/${name}`;
  if (process.argv.includes('--check')) {if (readFileSync(path,'utf8') !== text) throw new Error(`Stale fifth-round report: ${path}`);}
  else writeFileSync(path,text);
}
console.log(JSON.stringify(summary));
