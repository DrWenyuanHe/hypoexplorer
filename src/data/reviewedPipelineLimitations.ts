import reviewed from '../../data/quality/pipeline-separation-2026-09-11/reviewed-pipeline-limitations.json';
import type { QualityAssessment, QualityCheck } from './qualityChecks';

export const PIPELINE_LIMITATIONS_PATH = 'data/quality/pipeline-separation-2026-09-11/reviewed-pipeline-limitations.json';
export interface PipelineReviewScope { datasetId: string; contrastId?: string; trackId?: string }
export interface ReviewedPipelineScope {
  datasetId: string; contrastId: string | null; trackId: string | null; scope: string;
  sourceChecks: QualityCheck[]; check: QualityCheck;
}

// Independently reviewed membership: losing an approval cannot create a pass.
const requiredDatasets = new Set([
  'mouse_hypo_overfeed_gse247825', 'mouse_hypo_hfd_gse236077', 'mouse_hypo_maternal_care_gse305688',
  'mouse_arc_mettl14_gse289461', 'mouse_hypo_fasting_gse87544', 'rat_son_dehydration_gse175461',
  'rat_rph_noise_stress_gse229159', 'chicken_poah_ehc_gse298648', 'pig_hypo_mia_gse227725',
  'pig_hypo_genotype_gse201408', 'pig_hypo_mia_gse245146', 'pig_hypo_formula_gse281726',
  'gse135007', 'mouse_hypo_clic1_gse229799', 'human_htnsc_differentiation_gse214877',
]);

export function reviewedPipelineLimitations(source: QualityAssessment, scope: PipelineReviewScope,
  approvals: readonly ReviewedPipelineScope[] = reviewed.records as ReviewedPipelineScope[]): QualityCheck[] {
  if (!requiredDatasets.has(scope.datasetId)) return [];
  const matches = approvals.filter(entry => entry.datasetId === scope.datasetId
    && entry.contrastId === (scope.contrastId ?? null) && entry.trackId === (scope.trackId ?? null));
  const entry = matches.length === 1 ? matches[0] : undefined;
  const valid = reviewed.schemaVersion === 1 && reviewed.status === 'reviewed' && entry?.scope === source.scope
    && entry.sourceChecks.length === 2
    && ['independent_replication', 'model_validity'].every(id => {
      const expected = entry.sourceChecks.filter(check => check.id === id);
      const actual = source.checks.filter(check => check.id === id);
      return expected.length === 1 && actual.length === 1 && JSON.stringify(actual[0]) === JSON.stringify(expected[0]);
    })
    && entry.check.id === 'reviewed_source_model_limitations' && entry.check.status === 'review' && entry.check.required === true;
  return valid ? [entry.check] : [{
    id: 'reviewed_source_model_limitations', label: 'Reviewed source and model limitations',
    status: 'not_assessed', required: true,
    note: 'The scoped source/model review is missing or changed. Re-review the source and model evidence before clearing pipeline QC.',
    evidence: [PIPELINE_LIMITATIONS_PATH],
  }];
}
