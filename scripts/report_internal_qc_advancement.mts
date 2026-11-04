import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { QualityCheck } from '../src/data/qualityChecks';

const ROOT = process.cwd();
const FOLDER = 'data/internal-qc/advancement-2026-09-05';
const read = (path: string): any => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));
const baseline = read(`${FOLDER}/baseline.json`);
const current = read('data/internal-qc/assessments.generated.json');
const replays = read(`${FOLDER}/normalization-evidence.json`);
const dedicated = read(`${FOLDER}/dedicated-evidence.json`);
const nextAction: Record<string, string> = {
  source_integrity: 'Recover the missing original payload or checksum from the official source; retain the source URL and verify against an existing pin before claiming provenance.',
  independent_replication: 'Review original sample metadata/publication for explicit animal, donor or independent culture identifiers. Assess pairing/pooling and sample size; do not substitute library counts.',
  count_conservation: 'Reconcile the source-to-analysis transformation per sample, including every discarded or merged feature, against the original count payload.',
  normalization: 'Inspect the numeric-replay discrepancy and the dataset-specific model/runtime; rerun with its recorded method without modifying the existing output to fit the audit.',
  audit_scope: 'Supply a dedicated source/input/contrast binding and audit for this dataset, including atlas tracks where applicable.',
  matrix_values: 'Restore the configured analysis input and remeasure its dimensions and values.',
  sample_assignment: 'Recover the full sample sheet, input column identities and explicit contrast mapping.',
  library_detection: 'Restore and measure the current count matrix.',
  model_validity: 'Recover and review the actual fitted design and configured input scale.',
  output_integrity: 'Reconcile the displayed bundle with the current statistical output, preserving unresolved discrepancies.',
};
const records = current.records.map((r: any) => {
  const before = baseline.records.find((b: any) => b.datasetId === r.datasetId);
  const changes = r.assessment.checks.filter((c: QualityCheck) => before?.checks[c.id] !== c.status).map((c: QualityCheck) => ({ check: c.id, before: before?.checks[c.id] ?? 'absent', after: c.status, note: c.note, evidence: c.evidence ?? [] }));
  const remaining = r.assessment.checks.filter((c: QualityCheck) => !['pass', 'not_applicable'].includes(c.status)).map((c: QualityCheck) => ({ check: c.id, status: c.status, note: c.note, evidence: c.evidence ?? [], nextAction: nextAction[c.id] ?? 'Review the documented evidence gap.' }));
  const special = dedicated.records.find((v: any) => v.datasetId === r.datasetId);
  const replay = replays.records.find((v: any) => v.datasetId === r.datasetId) ?? (special ? { ...special, status: Object.values(special.contrasts).every((c: any) => c.status === 'pass') ? 'pass' : 'review', existingRows: Object.values(special.contrasts).reduce((sum: number, c: any) => sum + c.existingRows, 0), note: special.designNote } : null);
  return { datasetId: r.datasetId, previousStatus: before?.status, status: r.assessment.status, advancedChecks: changes.filter((c: any) => c.after === 'pass').length, changes, remaining, replay: replay ? { status: replay.status, rows: replay.existingRows, software: replay.software, maxAbsoluteDeltas: replay.maxAbsoluteDeltas, note: replay.note, evidence: replay.replayFile } : null, contrasts: Object.fromEntries(Object.entries(r.contrasts).map(([id, a]: any) => [id, a.status])) };
});
const checkIds = [...new Set(current.records.flatMap((r: any) => r.assessment.checks.map((c: any) => c.id)))] as string[];
const checkCoverage = checkIds.map((id) => ({ id, before: baseline.records.filter((r: any) => r.checks[id] === 'pass').length, after: current.records.filter((r: any) => r.assessment.checks.some((c: any) => c.id === id && c.status === 'pass')).length }));
const report = { date: '2026-09-05', baseline: baseline.summary, current: current.summary, datasetsWithAdvancement: records.filter((r: any) => r.advancedChecks > 0).length, checksAdvanced: records.reduce((sum: number, r: any) => sum + r.advancedChecks, 0), checkCoverage, records };
writeFileSync(resolve(ROOT, `${FOLDER}/advancement-report.json`), `${JSON.stringify(report, null, 2)}\n`);
const clean = (text: string): string => text.replace(/[\t\r\n]/g, ' ');
const tsv = ['dataset_id\tprevious_status\tcurrent_status\tnewly_passing_checks\tremaining_checks\tnext_actions', ...records.map((r: any) => [r.datasetId, r.previousStatus, r.status, r.changes.filter((c: any) => c.after === 'pass').map((c: any) => c.check).join('; '), r.remaining.map((c: any) => `${c.check}:${c.status}`).join('; '), r.remaining.map((c: any) => `${c.check}: ${c.nextAction}`).join('; ')].map(clean).join('\t'))].join('\n');
writeFileSync(resolve(ROOT, `${FOLDER}/advancement-report.tsv`), `${tsv}\n`);
const markdown = [
  '# Internal QC advancement — 2026-09-05', '',
  `Audited all ${records.length} registered datasets. ${report.datasetsWithAdvancement} datasets gained ${report.checksAdvanced} passing checks. Complete internal-QC passes increased from ${baseline.summary.pass} to ${current.summary.pass}.`, '',
  `Current overall statuses: ${Object.entries(current.summary).map(([s, n]) => `${s}: ${n}`).join('; ')}.`, '',
  'No original count matrices, sample sheets, DE tables or public bundles were changed. New evidence is derived in this folder. Missing provenance, biological independence, raw sequencing quality and unsupported atlas scope are not inferred from successful numerical replay.', '',
  '## Check coverage', '', '| Check | Previously passing | Now passing |', '|---|---:|---:|', ...checkCoverage.map((c) => `| ${c.id} | ${c.before} | ${c.after} |`), '',
  '## Dataset record', '',
  'Each remaining entry states the observed result and the next action. The JSON also includes evidence paths, full numeric replay diagnostics and every registered contrast status.', '',
  ...records.flatMap((r: any) => [`### ${r.datasetId}`, '', `Status: **${r.previousStatus} → ${r.status}**. Newly passing checks: ${r.changes.filter((c: any) => c.after === 'pass').map((c: any) => c.check).join(', ') || 'none'}.`, '', ...(r.replay ? [`Numeric replay: ${r.replay.status}; ${r.replay.rows ?? 0} existing rows; R ${r.replay.software?.R}${r.replay.software?.edgeR ? `, edgeR ${r.replay.software.edgeR}` : ''}, limma ${r.replay.software?.limma}.`, ''] : []), ...(r.remaining.length ? r.remaining.flatMap((c: any) => [`- **${c.check} (${c.status})**: ${c.note} Next: ${c.nextAction}`]) : ['All required applicable checks pass.']), '']),
];
writeFileSync(resolve(ROOT, `${FOLDER}/ADVANCEMENT_REPORT.md`), markdown.join('\n'));
process.stdout.write(`Documented ${report.checksAdvanced} passing-check advancements across ${report.datasetsWithAdvancement} datasets.\n`);
