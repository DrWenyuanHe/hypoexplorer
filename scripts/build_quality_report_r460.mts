// Successor to the sealed scripts/build_quality_report.mts (pinned by the September 11
// pipeline-separation reader review). Identical output format; author concordance uses the
// active definition reviews after the R 4.6.0 regeneration through src/data/datasetQualityR460.ts
// (data/quality/regeneration-r460-2026-09-25/README.md).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTHOR_VALIDATION_REPORT } from '../src/data/authorValidation';
import { DATASETS } from '../src/data/datasets';
import { datasetQuality, QUALITY_BADGES, QUALITY_STATUS } from '../src/data/datasetQualityR460';
import { AUTHOR_CONCORDANCE_POLICY } from '../src/data/authorConcordance';
import { QC_SEPARATION_POLICY } from '../src/data/pipelineQc';
import { assertPipelineReviewEvidence } from './lib/pipelineQcEvidence.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assertPipelineReviewEvidence(root);
const out = resolve(root, 'data/quality');
const records = AUTHOR_VALIDATION_REPORT.records.map((record) => ({
  datasetId: record.datasetId, accession: record.accession, ...datasetQuality(record),
  contrasts: Object.fromEntries(DATASETS.find((d) => d.id === record.datasetId)!.contrasts
    .map((contrast) => [contrast.id, datasetQuality(record, contrast.id)])),
}));
const clean = (text: string) => text.replace(/[\t\r\n]/g, ' ');
const tsv = ['dataset_id\taccession\tcontrast_id\tpipeline_qc\texperimental_design\tauthor_concordance\tpipeline_scope\tdesign_scope\tauthor_scope\tlegacy_combined_internal_qc',
  ...records.flatMap((r) => [['', r] as const, ...Object.entries(r.contrasts)].map(([id, q]) =>
    [r.datasetId, r.accession, id, q.pipelineQc.status, q.experimentalDesign.status, q.authorConcordance.status,
      q.pipelineQc.scope, q.experimentalDesign.scope, q.authorConcordance.scope, q.internalQc.status].map(clean).join('\t'))), ''].join('\n');
const md = ['# Pipeline quality, experimental design and author concordance', '',
  'Three separate assessments. A pass applies only to the recorded checks and scope. Exact author P values or FDR are not required for biological-effect concordance. Detailed author-reproduction classifications remain in the separate author-validation ledger.', '',
  '| Status | Pipeline QC | Experimental design | Author concordance |', '|---|---:|---:|---:|',
  ...Object.entries(QUALITY_STATUS).map(([key, meta]) => `| ${meta.label} | ${QUALITY_BADGES.map(badge => records.filter(r => r[badge.key].status === key).length).join(' | ')} |`), '',
  'Experimental design covers independent biological replication and retained sample support. All other recorded checks remain in pipeline QC, including source integrity, species mapping, normalization and model pairing. The separation preserves each source check, status, requirement and evidence reference.', '',
  'Explicitly reviewed source/model concerns embedded in replication notes also remain required pipeline checks. These companion checks reuse the original evidence and grant no new positive evidence.', '',
  'A pipeline pass does not resolve experimental-design limitations. Empty evidence is not assessed. The JSON internalQc field retains the original combined assessment for historical audit compatibility; it is not the Pipeline QC badge.', '',
  `QC separation policy: ${QC_SEPARATION_POLICY.version}. The source internal-QC policy and all underlying evidence remain unchanged.`, '',
  `Author concordance policy: ${AUTHOR_CONCORDANCE_POLICY.version}. See the JSON policy for exact thresholds; these are project defaults, not universal scientific cutoffs.`, '',
  'The JSON includes every checklist and per-comparison assessment. The TSV includes dataset and comparison decisions. Regenerate with `npm run build:quality`; verify freshness with `npm run check:quality`.', ''].join('\n');
const outputs = {
  'assessments.generated.json': `${JSON.stringify({ schemaVersion: 2, qcSeparationPolicy: QC_SEPARATION_POLICY, legacyInternalQc: 'Combined processing and experimental-design assessment retained for historical audits.', authorConcordancePolicy: AUTHOR_CONCORDANCE_POLICY, records }, null, 2)}\n`,
  'assessments.generated.tsv': tsv,
  'QUALITY_REPORT.generated.md': md,
};
if (!process.argv.includes('--check')) mkdirSync(out, { recursive: true });
for (const [name, body] of Object.entries(outputs)) {
  const file = resolve(out, name);
  if (process.argv.includes('--check')) {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== body) throw new Error(`${name} is missing or stale; run npm run build:quality`);
  } else writeFileSync(file, body);
}
process.stdout.write(`Quality assessments ${process.argv.includes('--check') ? 'current' : 'written'}: ${records.length} datasets\n`);
