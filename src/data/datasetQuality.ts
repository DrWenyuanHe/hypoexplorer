import { assessAuthorConcordance } from './authorConcordance';
import { getInternalQc } from './internalQc';
import type { AuthorValidationRecord } from './authorValidation';
import type { QualityAssessment } from './qualityChecks';
import { separateInternalQc } from './pipelineQc';

export const QUALITY_BADGES = [
  { key: 'pipelineQc', label: 'Pipeline QC', description: 'Checks our processing of the available data. Read Experimental design for replication and sample-support limitations.' },
  { key: 'experimentalDesign', label: 'Experimental design', description: 'Checks biological replication and retained sample support. A pass applies to these recorded checks, not every aspect of the original experiment.' },
  { key: 'authorConcordance', label: 'Author concordance', description: 'Checks matched-gene effect agreement with comparable author results.' },
] as const;

export const QUALITY_STATUS = {
  pass: { label: 'Passed', suffix: 'passed', color: '#2F7D4A', symbol: '✓' },
  review: { label: 'Review needed', suffix: 'review needed', color: '#946200', symbol: '!' },
  fail: { label: 'Failed', suffix: 'failed', color: '#B42318', symbol: '×' },
  not_assessed: { label: 'Not assessed', suffix: 'not assessed', color: '#6B7280', symbol: '?' },
  not_applicable: { label: 'Not applicable', suffix: 'not applicable', color: '#6B7280', symbol: '–' },
} as const;

export function datasetQuality(record: AuthorValidationRecord, contrastId?: string) {
  const internalQc: QualityAssessment = getInternalQc(record.datasetId, contrastId) ?? {
    status: 'not_assessed', policyVersion: 'internal-qc-v1',
    scope: contrastId ? `Comparison: ${contrastId}` : 'Dataset',
    checks: [{ id: 'evidence', label: 'Internal QC evidence', status: 'not_assessed', note: 'No current internal QC assessment is recorded.' }],
  };
  // Retain the original combined assessment for historical reports and audits.
  return { internalQc, ...separateInternalQc(internalQc, { datasetId: record.datasetId, contrastId }), authorConcordance: assessAuthorConcordance(record, contrastId) };
}

export function qualitySearchText(record: AuthorValidationRecord): string {
  const quality = datasetQuality(record);
  return QUALITY_BADGES.map(({ key, label }) => `${label} ${QUALITY_STATUS[quality[key].status].suffix}`).join(' ');
}
