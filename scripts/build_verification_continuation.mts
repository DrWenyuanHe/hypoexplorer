import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { QualityAssessment } from '../src/data/qualityChecks';

const folder = 'data/quality/continuation-2026-09-05';
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const baseline = read(`${folder}/baseline.json`);
const quality = read('data/quality/assessments.generated.json');
const validation = read('data/author-validation/validation-records.generated.json');
const sources = read('data/internal-qc/source-authenticity-2026-09-05/source-authenticity-evidence.json');
const replication = read('data/internal-qc/replication-2026-09-05/replication-evidence.json');
const atlas = read('data/internal-qc/advancement-2026-09-05/macaque/atlas-evidence.json');
type Row = { datasetId: string; accession: string; internalQc: QualityAssessment; authorConcordance: QualityAssessment };
const count = (rows: Row[], kind: 'internalQc' | 'authorConcordance') => Object.fromEntries(['pass', 'review', 'fail', 'not_assessed', 'not_applicable'].map(status => [status, rows.filter(row => row[kind].status === status).length]));
const targetIds = new Set(baseline.quality.records.map((row: Row) => row.datasetId));
const currentScope: Row[] = baseline.quality.records.map((before: Row) => {
  const after = quality.records.find((row: Row) => row.datasetId === before.datasetId);
  if (!after) throw new Error(`Original dataset missing: ${before.datasetId}`);
  return after;
});
const records = currentScope.map((row: Row) => {
  const before: Row = baseline.quality.records.find((old: Row) => old.datasetId === row.datasetId);
  const author = validation.records.find((entry: any) => entry.datasetId === row.datasetId);
  const changes = (kind: 'internalQc' | 'authorConcordance') => row[kind].checks.flatMap(check => {
    const old = before[kind].checks.find(item => item.id === check.id);
    return old?.status === check.status ? [] : [{ id: check.id, label: check.label, before: old?.status ?? 'not_assessed', after: check.status, note: check.note }];
  });
  const pending = (kind: 'internalQc' | 'authorConcordance') => row[kind].checks.filter(check => check.required !== false && !['pass', 'not_applicable'].includes(check.status));
  return { datasetId: row.datasetId, accession: row.accession,
    before: { internalQc: before.internalQc.status, authorConcordance: before.authorConcordance.status },
    after: { internalQc: row.internalQc.status, authorConcordance: row.authorConcordance.status },
    changes: { internalQc: changes('internalQc'), authorConcordance: changes('authorConcordance') },
    pending: { internalQc: pending('internalQc'), authorConcordance: pending('authorConcordance') },
    authorScope: row.authorConcordance.scope, authorNextStep: author.verification.nextStep,
  };
});
const summary = {
  datasets: records.length,
  before: { internalQc: count(baseline.quality.records, 'internalQc'), authorConcordance: count(baseline.quality.records, 'authorConcordance'), numericalComparisons: baseline.validation.records.filter((row: any) => row.directComparison).length },
  after: { internalQc: count(currentScope, 'internalQc'), authorConcordance: count(currentScope, 'authorConcordance'), numericalComparisons: validation.records.filter((row: any) => targetIds.has(row.datasetId) && row.directComparison).length },
  independentlyAuthenticatedRetainedFiles: sources.files.filter((file: any) => file.status === 'authenticated').length,
  officialExactByteMatches: sources.files.filter((file: any) => file.status === 'authenticated' && file.comparisonMethod === 'exact_bytes').length,
  officialNewlineOnlyMatches: sources.files.filter((file: any) => file.status === 'authenticated' && file.comparisonMethod === 'exact_CRLF_to_LF_bytes').length,
  biologicalReplicationRecords: replication.records.length,
  changedDatasets: records.filter((row: any) => row.changes.internalQc.length || row.changes.authorConcordance.length).length,
  atlas: atlas.summary,
};
const dependencies = [
  `${folder}/baseline.json`, 'data/quality/assessments.generated.json', 'data/author-validation/validation-records.generated.json',
  'data/internal-qc/source-authenticity-2026-09-05/source-authenticity-evidence.json',
  'data/internal-qc/source-authenticity-2026-09-05/pseudobulk-source-replay-evidence.json',
  'data/internal-qc/replication-2026-09-05/replication-evidence.json',
  'data/internal-qc/advancement-2026-09-05/macaque/atlas-evidence.json',
  'data/author-validation/continued-sources/continuation-2026-09-05/retrieval-log.json',
  'data/author-validation/continued-sources/continuation-2026-09-05/comparison-specs.json',
].map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }));
const clean = (text: string) => text.replace(/[|\t\r\n]/g, ' ');
const markdown = [
  '# Dataset verification continuation', '',
  'Continued on 2026-09-05 from the recorded 23 internal-QC passes, 19 author-concordance passes and 50 numerical comparisons. Three subagents handled source authenticity, biological replication and the macaque atlas; they also reviewed the extraction and evidence loaders. Registered scientific inputs, sample assignments and DE outputs were preserved. The later correction to alternative correlation/direction acceptance is recorded separately in the round-two policy impact report; current counts include that versioned policy. Numerical cutoffs were not chosen to force a match.', '',
  '| Measure | Before | Current |', '|---|---:|---:|',
  `| Complete internal QC | ${summary.before.internalQc.pass} | ${summary.after.internalQc.pass} |`,
  `| Author concordance | ${summary.before.authorConcordance.pass} | ${summary.after.authorConcordance.pass} |`,
  `| Numerical author comparisons | ${summary.before.numericalComparisons} | ${summary.after.numericalComparisons} |`, '',
  `Fresh official downloads authenticated ${summary.independentlyAuthenticatedRetainedFiles} retained files: ${summary.officialExactByteMatches} exact byte matches and ${summary.officialNewlineOnlyMatches} explicitly recorded newline-only match. Source files and derived inputs remain separate. Three additional source-to-pseudobulk reconstructions reproduced the existing inputs in isolated directories; their provenance, runtime, scripts and complete-file comparisons are recorded separately.`, '',
  `Primary-source biological replication was reviewed for ${summary.biologicalReplicationRecords} datasets. Documented pools count once; maternal treatments are evaluated at litter level. Distinct library labels alone do not pass. The review preserves the shared-litter issue in GSE201408, missing offspring-to-dam mapping in GSE245146, unresolved induction batches in GSE301692, and the six-published-versus-seven-deposited control discrepancy in GSE49540.`, '',
  `The atlas audit covers all ${atlas.summary.appTracks} displayed populations, ${atlas.summary.deRows.toLocaleString('en-US')} DE rows and ${atlas.summary.cpmValues.toLocaleString('en-US')} retained-sample CPM values. Exports, statistical bounds and BH FDR were checked. Five populations have two retained samples in an arm. Original count objects, normalization evidence and the animal-to-object identity crosswalk remain missing. Matching normalized exports does not certify normalization.`, '',
  'GSE198437 now has a checksum-pinned original selected-gene comparison: 1,789 of all 1,796 original Geneid values join, Pearson r=0.99996387, and every matched direction agrees. It remains under review because the published centered coefficient units are not explicitly defined. Author omnibus P/FDR are not used as pairwise statistics. No selected genes were removed to improve coverage.', '',
  'Public code archives were recovered for GSE204883 and GSE205313. The first explicitly excludes SPIP19, which the registered dataset retains. The second excludes source columns whose exact mapping to the deposited profiles is unresolved. Neither archive contains its saved numerical DE table. The publisher supplement downloads remain unavailable; the browser access outcomes are documented. These findings advance the review but do not earn concordance passes.', '',
  '## Evidence and review', '',
  '- [Official-source download audit and isolated input reconstructions](../../internal-qc/source-authenticity-2026-09-05/README.md)',
  '- [Biological unit mappings and unresolved design issues](../../internal-qc/replication-2026-09-05/README.md)',
  '- [Every atlas population and missing upstream evidence](../../internal-qc/advancement-2026-09-05/macaque/README.md)',
  '- [Recovered author workbook and code archives](../../author-validation/continued-sources/continuation-2026-09-05/README.md)',
  '- [Independent review](./REVIEW.md)', '- [Validation results](./VALIDATION.md)',
  '- [Every changed check and remaining blocker](./continuation-report.json)', '',
  'This is a cumulative report for the original baseline corpus. Later verification rounds are included in current totals; new intake is excluded. The completed second-round result is preserved separately by its immutable input snapshot.', '', '## All dataset outcomes', '', '| Dataset | Internal QC | Author concordance | Next author task |', '|---|---|---|---|',
  ...records.map((row: any) => `| ${clean(row.accession || row.datasetId)} | ${row.before.internalQc} → ${row.after.internalQc} | ${row.before.authorConcordance} → ${row.after.authorConcordance} | ${clean(row.authorNextStep)} |`), '',
].join('\n');
for (const [name, value] of Object.entries({ 'continuation-report.json': `${JSON.stringify({ schemaVersion: 1, summary, dependencies, records }, null, 2)}\n`, 'ADVANCEMENT_REPORT.md': markdown })) {
  const path = `${folder}/${name}`;
  if (process.argv.includes('--check')) { if (readFileSync(path, 'utf8') !== value) throw new Error(`Stale continuation report: ${path}`); }
  else writeFileSync(path, value);
}
console.log(JSON.stringify(summary));
