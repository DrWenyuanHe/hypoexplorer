import { assessCurrentAuthorConcordance } from './authorConcordanceR460';
import { QUALITY_BADGES, QUALITY_STATUS } from './datasetQuality';
import { getInternalQc } from './internalQc';
import type { AuthorValidationRecord } from './authorValidation';
import type { QualityAssessment } from './qualityChecks';
import { separateInternalQc } from './pipelineQc';

export { QUALITY_BADGES, QUALITY_STATUS };

/**
 * Current quality decisions after the R 4.6.0 regeneration.
 *
 * Successor to the sealed datasetQuality.ts (pinned by the September 11
 * pipeline-separation reader review), which assesses author concordance only
 * against the original definition-review ledger. Pipeline QC and experimental
 * design are unchanged; author concordance uses the active reviews
 * (data/quality/regeneration-r460-2026-09-25/README.md). Sealed audits that
 * reproduce dated decisions keep importing datasetQuality.ts.
 */
export function datasetQuality(record: AuthorValidationRecord, contrastId?: string) {
  const internalQc: QualityAssessment = getInternalQc(record.datasetId, contrastId) ?? {
    status: 'not_assessed', policyVersion: 'internal-qc-v1',
    scope: contrastId ? `Comparison: ${contrastId}` : 'Dataset',
    checks: [{ id: 'evidence', label: 'Internal QC evidence', status: 'not_assessed', note: 'No current internal QC assessment is recorded.' }],
  };
  // Retain the original combined assessment for historical reports and audits.
  return { internalQc, ...separateInternalQc(internalQc, { datasetId: record.datasetId, contrastId }),
    authorConcordance: assessCurrentAuthorConcordance(record, contrastId) };
}

export function qualitySearchText(record: AuthorValidationRecord): string {
  const quality = datasetQuality(record);
  return QUALITY_BADGES.map(({ key, label }) => `${label} ${QUALITY_STATUS[quality[key].status].suffix}`).join(' ');
}
