import { describe, expect, it } from 'vitest';
import reviewed from '../../data/quality/pipeline-separation-2026-09-11/reviewed-pipeline-limitations.json';
import ledger from '../../data/internal-qc/assessments.generated.json';
import { reviewedPipelineLimitations, type ReviewedPipelineScope } from '../data/reviewedPipelineLimitations';
import { separateInternalQc } from '../data/pipelineQc';
import { datasetQuality } from '../data/datasetQualityR460';
import { requireAuthorValidation } from '../data/authorValidation';
import type { QualityAssessment } from '../data/qualityChecks';

const approvals = reviewed.records as ReviewedPipelineScope[];
const inputFor = (entry: ReviewedPipelineScope): QualityAssessment => {
  const dataset = ledger.records.find(row => row.datasetId === entry.datasetId)!;
  const parent = entry.trackId ? (dataset as any).tracks[entry.trackId] : dataset;
  return (entry.contrastId ? parent.contrasts[entry.contrastId] : parent.assessment) as QualityAssessment;
};
const context = (entry: ReviewedPipelineScope) => ({ datasetId: entry.datasetId,
  contrastId: entry.contrastId ?? undefined, trackId: entry.trackId ?? undefined });

describe('explicit source/model concerns remain pipeline blockers', () => {
  it('retains all 15 reviewed cases and all 32 exact aggregate/leaf scopes', () => {
    expect(new Set(approvals.map(row => row.datasetId)).size).toBe(15);
    expect(approvals).toHaveLength(32);
    for (const entry of approvals) {
      const source = inputFor(entry);
      const result = separateInternalQc(source, context(entry));
      expect(reviewedPipelineLimitations(source, context(entry))).toEqual([entry.check]);
      expect(result.pipelineQc.status).toBe('review');
      for (const original of source.checks) {
        expect([...result.pipelineQc.checks, ...result.experimentalDesign.checks].filter(check => check.id === original.id)).toEqual([original]);
      }
    }
  });

  it('does not hide recorded quality exclusions behind a replication pass', () => {
    for (const id of ['mouse_hypo_overfeed_gse247825', 'rat_rph_noise_stress_gse229159']) {
      const quality = datasetQuality(requireAuthorValidation(id));
      expect(quality.internalQc.status).toBe('pass');
      expect(quality.experimentalDesign.status).toBe('pass');
      expect(quality.pipelineQc.status).toBe('review');
      expect(quality.pipelineQc.checks.find(check => check.id === 'reviewed_source_model_limitations')?.note).toMatch(/quality/);
    }
  });

  it('never drops a known limitation when its approval is missing, duplicated, optional or altered to pass', () => {
    for (const entry of approvals) {
      const source = inputFor(entry);
      const mutations: ReviewedPipelineScope[][] = [[], [entry, entry],
        [{ ...entry, check: { ...entry.check, required: false } }],
        [{ ...entry, check: { ...entry.check, status: 'pass' } }],
        [{ ...entry, sourceChecks: [] }],
        [{ ...entry, scope: 'borrowed scope' }],
        [{ ...entry, datasetId: 'borrowed dataset' }],
        [{ ...entry, contrastId: 'borrowed contrast' }],
        [{ ...entry, trackId: 'borrowed track' }]];
      for (const changed of mutations) {
        const [check] = reviewedPipelineLimitations(source, context(entry), changed);
        expect(check.status).toBe('not_assessed');
        expect(check.required).toBe(true);
      }
    }
  });

  it('requires re-review if the current source or model evidence changes', () => {
    for (const entry of approvals) {
      const source = inputFor(entry);
      for (const id of ['independent_replication', 'model_validity']) {
        const changed = { ...source, checks: source.checks.map(check => check.id === id ? { ...check, note: 'Changed evidence' } : check) };
        expect(reviewedPipelineLimitations(changed, context(entry))[0].status).toBe('not_assessed');
      }
    }
  });

  it('does not demand identical author models or create a technical-duplicate fault without evidence', () => {
    for (const id of ['mouse_arc_clock_gse248462', 'mouse_scn_trf_gse190389']) {
      const quality = datasetQuality(requireAuthorValidation(id));
      expect(quality.pipelineQc.status).toBe('pass');
      expect(quality.pipelineQc.checks.some(check => check.id === 'reviewed_source_model_limitations')).toBe(false);
    }
  });
});
