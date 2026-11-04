/** Report new scientific evidence separately from the requested acceptance-policy correction. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { QualityAssessment } from '../src/data/qualityChecks';

const folder = 'data/quality/round2-2026-09-05';
// This completed round is historical. Later evidence belongs in later reports.
const closed = JSON.parse(gunzipSync(readFileSync(`${folder}/closed-inputs.json.gz`)).toString('utf8'));
const input = (path: string): string => {
  if (closed.schemaVersion !== 1 || typeof closed.files[path] !== 'string') throw new Error(`Missing historical input: ${path}`);
  return closed.files[path];
};
const read = (path: string) => JSON.parse(input(path));
const baseline = read(`${folder}/baseline.json`);
const current = read('data/quality/assessments.generated.json');
const validation = read('data/author-validation/validation-records.generated.json');
const policy = read(`${folder}/policy-only-impact.json`);
const source = read('data/internal-qc/source-authenticity-2026-09-05/round2/reader-evaluations.json');
const conservation = read('data/internal-qc/conservation-2026-09-05/conservation-evidence.json');
const replication = read('data/internal-qc/replication-2026-09-05/replication-evidence.json');
type Row = { datasetId: string; accession: string; internalQc: QualityAssessment; authorConcordance: QualityAssessment };
const statuses = ['pass', 'review', 'fail', 'not_assessed', 'not_applicable'];
const count = (rows: Row[], key: 'internalQc' | 'authorConcordance') => Object.fromEntries(statuses.map(status => [status, rows.filter(row => row[key].status === status).length]));
const records = current.records.map((row: Row) => {
  const before: Row = baseline.quality.records.find((old: Row) => old.datasetId === row.datasetId);
  const unchangedEvidence = policy.records.find((old: any) => old.datasetId === row.datasetId);
  const author = validation.records.find((entry: any) => entry.datasetId === row.datasetId);
  const changes = (kind: 'internalQc' | 'authorConcordance') => row[kind].checks.flatMap(check => {
    const old = before[kind].checks.find(item => item.id === check.id);
    return old?.status === check.status && old?.required === check.required ? []
      : [{ id: check.id, before: old?.status ?? 'not_assessed', after: check.status, required: check.required !== false, note: check.note }];
  });
  const blockers = (kind: 'internalQc' | 'authorConcordance') => row[kind].checks.filter(check => check.required !== false && !['pass', 'not_applicable'].includes(check.status));
  return { datasetId: row.datasetId, accession: row.accession,
    before: { internalQc: before.internalQc.status, authorConcordance: before.authorConcordance.status },
    policyOnlyAuthorStatus: unchangedEvidence.after,
    after: { internalQc: row.internalQc.status, authorConcordance: row.authorConcordance.status },
    newlyPassedInternalQc: before.internalQc.status !== 'pass' && row.internalQc.status === 'pass',
    authorPolicyChangedStatus: unchangedEvidence.changedStatus,
    authorEvidenceChangedStatus: unchangedEvidence.after !== row.authorConcordance.status,
    changes: { internalQc: changes('internalQc'), authorConcordance: changes('authorConcordance') },
    blockers: { internalQc: blockers('internalQc'), authorConcordance: blockers('authorConcordance') },
    contextualAuthorChecks: row.authorConcordance.checks.filter(check => check.required === false),
    authorScope: row.authorConcordance.scope, authorNextStep: author.verification.nextStep,
  };
});
const summary = { datasets: records.length,
  before: { internalQc: count(baseline.quality.records, 'internalQc'), authorConcordance: count(baseline.quality.records, 'authorConcordance'), comparisons: baseline.validation.records.filter((row: any) => row.directComparison).length },
  after: { internalQc: count(current.records, 'internalQc'), authorConcordance: count(current.records, 'authorConcordance'), comparisons: validation.records.filter((row: any) => row.directComparison).length },
  policyOnlyAuthorPasses: policy.afterPasses,
  newInternalQcPasses: records.filter((row: any) => row.newlyPassedInternalQc).map((row: any) => row.datasetId),
  sourceSetsAuthenticated: source.records.filter((row: any) => row.sourceAuthentication === 'pass').length,
  exactReconstructedInputs: source.records.filter((row: any) => row.derivedInputReconstruction === 'pass').length,
  conservation: Object.fromEntries(statuses.map(status => [status, conservation.records.filter((row: any) => row.status === status).length])),
  biologicalReplicationDatasets: replication.records.length,
};
const dependencies = [`${folder}/baseline.json`, `${folder}/policy-only-impact.json`,
  'data/quality/assessments.generated.json', 'data/author-validation/validation-records.generated.json',
  'data/internal-qc/source-authenticity-2026-09-05/round2/reader-evaluations.json',
  'data/internal-qc/conservation-2026-09-05/conservation-evidence.json',
  'data/internal-qc/replication-2026-09-05/replication-evidence.json',
  'data/author-validation/continued-sources/round2-2026-09-05/comparison-specs.json',
].map(path => ({ path, sha256: createHash('sha256').update(input(path)).digest('hex') }));
const clean = (value: string) => value.replace(/[|\r\n\t]/g, ' ');
const md = ['# Dataset verification: second continuation', '',
  'Continued on 2026-09-05 from a preserved baseline of 32 internal-QC passes, 19 author-concordance passes and 51 structured comparisons. Three subagents divided source reconstruction, count accounting and biological replication, then reviewed the work independently. Registered scientific inputs, sample assignments and DE outputs were preserved.', '',
  '| Measure | Before | Current |', '|---|---:|---:|',
  `| Complete internal QC | ${summary.before.internalQc.pass} | ${summary.after.internalQc.pass} |`,
  `| Author concordance | ${summary.before.authorConcordance.pass} | ${summary.after.authorConcordance.pass} |`,
  `| Structured author comparisons | ${summary.before.comparisons} | ${summary.after.comparisons} |`, '',
  '## Evidence and policy are counted separately', '',
  `The prior implementation required correlation, direction and magnitude together. The user requested strong correlation or matched-gene direction as sufficient evidence of pipeline quality. Version 2 corrects that logic, keeping the existing numerical thresholds and required scientific compatibility/coverage gates. On unchanged baseline evidence this changes ${policy.beforePasses} author passes to ${policy.afterPasses}: GSE68177 POMC and GSE231617. These are policy changes, not newly measured scientific agreement. Magnitude differences and P/FDR remain visible as context. Invalid metrics cannot be hidden behind a passing alternative. [Full policy-only counterfactual](./policy-only-impact.json).`, '',
  `Fresh official sources authenticate ${summary.sourceSetsAuthenticated} additional source sets. ${summary.exactReconstructedInputs} entire registered inputs and sample sheets are reproduced in isolated directories. GSE254155 has identical feature counts but different gene row order; GSE205313 lacks the original transcript-to-symbol conversion evidence. Those limitations remain explicit. [Source recovery and reconstruction](../../internal-qc/source-authenticity-2026-09-05/round2/README.md).`, '',
  `The independent count-accounting audit covers ${conservation.records.length} previously incomplete cases: ${summary.conservation.pass} pass, ${summary.conservation.review} need review and ${summary.conservation.not_assessed} remain unassessed. For measured cases, it compares complete source feature counts with registered input values for every selected sample; unresolved cases retain their specific blockers. Any declared rounding is separately measured and does not claim raw totals were unchanged. [Conservation evidence](../../internal-qc/conservation-2026-09-05/README.md).`, '',
  `Primary-source biological replication now covers ${summary.biologicalReplicationDatasets} datasets, up from 16. The new review preserves technical-pool ambiguity, treatment-confounded incubators and missing independent culture experiments. [Replication findings](../../internal-qc/replication-2026-09-05/README.md).`, '',
  'Three full selected-author tables now supply structured metrics: GSE156859 retains 168/168 matches and agreeing directions; GSE299412 retains all 231 selected genes, including 52 filtered-out genes and nine direction reversals among 179 matches; GSE298648 expands six examples to all 18 original Ensembl rows, with 15 local matches and matching directions. Estimator, cohort, coverage and statistical discrepancies remain visible. [Original sources, extraction and every unmatched gene](../../author-validation/continued-sources/round2-2026-09-05/README.md).', '',
  '## Review, validation and remaining work', '',
  '- [Independent review](./REVIEW.md)', '- [Final validation](./VALIDATION.md)',
  '- [Every changed check, required blocker and contextual result](./round2-report.json)',
  '- [Preserved checkout bytes](./checkout-preservation.json)', '',
  'The following table records all 145 dataset outcomes. A passing author badge describes the stated biological-effect comparison; detailed author-reproduction work may still remain.', '',
  '| Dataset | Internal QC | Author concordance | Next author task |', '|---|---|---|---|',
  ...records.map((row: any) => `| ${clean(row.accession || row.datasetId)} | ${row.before.internalQc} → ${row.after.internalQc} | ${row.before.authorConcordance} → ${row.after.authorConcordance} | ${clean(row.authorNextStep)} |`), '',
].join('\n');
for (const [name, body] of Object.entries({ 'round2-report.json': `${JSON.stringify({ schemaVersion: 1, summary, dependencies, records }, null, 2)}\n`, 'ADVANCEMENT_REPORT.md': md })) {
  const path = `${folder}/${name}`;
  if (process.argv.includes('--check')) { if (readFileSync(path, 'utf8') !== body) throw new Error(`Stale round-two report: ${path}`); }
  else writeFileSync(path, body);
}
console.log(JSON.stringify(summary));
