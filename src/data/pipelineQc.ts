import { aggregateQualityChecks, type QualityAssessment, type QualityCheck } from './qualityChecks';
import { reviewedPipelineLimitations, type PipelineReviewScope } from './reviewedPipelineLimitations';

/** Separates processing evidence from the source experiment's replication limits. */
export const QC_SEPARATION_POLICY = {
  version: 'qc-separation-v1',
  experimentalDesignChecks: ['independent_replication', 'retained_sample_support'],
  pipelineDefault: 'All other checks, including species mapping and model pairing, remain required as recorded.',
  additionalReview: 'Explicitly reviewed source/model concerns embedded in design notes also receive a required pipeline check. Original design evidence remains unchanged.',
} as const;

const designIds = new Set<string>(QC_SEPARATION_POLICY.experimentalDesignChecks);

export function separateInternalQc(source: QualityAssessment, scope?: PipelineReviewScope) {
  const assessment = (checks: QualityCheck[], domain: 'pipeline' | 'design'): QualityAssessment => {
    // An absent checklist is unknown, not evidence that the domain passed.
    const evidence = checks.length ? checks : [{
      id: `${domain}_evidence`, label: domain === 'pipeline' ? 'Pipeline evidence' : 'Experimental-design evidence',
      status: 'not_assessed' as const,
      note: `No ${domain === 'pipeline' ? 'processing' : 'replication or sample-support'} checks are recorded for this scope.`,
    }];
    return {
      status: aggregateQualityChecks(evidence), checks: evidence,
      scope: source.scope,
      policyVersion: `${QC_SEPARATION_POLICY.version}/${source.policyVersion}`,
    };
  };
  return {
    pipelineQc: assessment([
      ...source.checks.filter(check => !designIds.has(check.id)),
      ...(scope ? reviewedPipelineLimitations(source, scope) : []),
    ], 'pipeline'),
    experimentalDesign: assessment(source.checks.filter(check => designIds.has(check.id)), 'design'),
  };
}
