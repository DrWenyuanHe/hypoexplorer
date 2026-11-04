import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// Current decisions: the active definition reviews after the R 4.6.0 regeneration
// (data/quality/regeneration-r460-2026-09-25/README.md).
import { assessCurrentAuthorConcordance as assessAuthorConcordance } from '../data/authorConcordanceR460';
import { AUTHOR_VALIDATION_REPORT, requireAuthorValidation } from '../data/authorValidation';
import { datasetQuality } from '../data/datasetQualityR460';
import type { QualityAssessment } from '../data/qualityChecks';

const exportedQuality = JSON.parse(readFileSync('data/quality/assessments.generated.json', 'utf8')) as {
  records: { datasetId: string; authorConcordance: QualityAssessment;
    contrasts: Record<string, { authorConcordance: QualityAssessment }> }[];
};

describe('existing dataset verification advancement', () => {
  it('keeps near-identical PVN coefficients under review until their effect units are documented', () => {
    const record = requireAuthorValidation('mouse_pvn_hfd_gse198437');
    const metrics = record.directComparison!.metrics;
    expect(metrics.authorGenes).toBe(1796);
    // 1789 before the R 4.6.0 regeneration, which no longer publishes features without a gene
    // symbol (data/quality/regeneration-r460-2026-09-25/README.md).
    expect(metrics.sharedGenes).toBe(1717);
    expect(metrics.pearsonLogFC).toBeGreaterThan(0.9999);
    expect(metrics.signConcordance).toBe(1);
    expect(metrics.authorSignificantGenes).toBeNull();
    expect(metrics.significantInBoth).toBeNull();
    expect(record.verification.comparability.resultScope).toBe('selected_results');
    expect(record.verification.comparability.dimensions.effects.status).toBe('limited');
    expect(assessAuthorConcordance(record, 'hfd_vs_chow').status).toBe('review');
    expect(assessAuthorConcordance(record).status).toBe('review');
    expect(record.directComparison!.note).toContain('coefficient units');
  });

  it('keeps the deposited hamster direction conflict visible instead of flipping effects to pass', () => {
    const record = requireAuthorValidation('hamster_hypo_torpor_gse179663');
    expect(record.directComparison?.type).toBe('direct_author_result');
    expect(record.directComparison?.metrics.sharedGenes).toBe(53);
    expect(record.directComparison?.metrics.pearsonLogFC).toBeLessThan(-0.9);
    expect(record.directComparison?.metrics.signConcordance).toBeLessThan(0.1);
    expect(record.verification.comparability.dimensions.contrast.status).toBe('different');
    expect(assessAuthorConcordance(record).status).toBe('review');
    expect(datasetQuality(record).authorConcordance.status).toBe('review');
    expect(exportedQuality.records.find(row => row.datasetId === record.datasetId)?.authorConcordance.status).toBe('review');
  });

  it('passes spatial-CR effects only for the selected author genes and the registered contrast', () => {
    const record = requireAuthorValidation('mouse_hypo_spatial_cr_gse273038');
    const metrics = record.directComparison!.metrics;
    expect(record.verification.comparability.resultScope).toBe('selected_results');
    expect(record.verification.comparability.registeredContrastIds).toEqual(['cr_vs_al']);
    expect(metrics.authorGenes).toBe(59);
    expect(metrics.sharedGenes).toBe(58);
    expect(metrics.authorCoverage).toBeCloseTo(58 / 59, 7);
    expect(metrics.localCoverage).toBeLessThan(0.01);

    const supported = assessAuthorConcordance(record, 'cr_vs_al');
    expect(supported.status).toBe('pass');
    expect(supported.scope).toContain('Selected author genes only');
    expect(supported.checks.find(check => check.id === 'author_inference')).toMatchObject({ status: 'not_applicable', required: false });
    expect(assessAuthorConcordance(record, 'unsupported_contrast').status).toBe('not_assessed');
    expect(record.verification.fullyVerifiedContrasts).toEqual([]);
    const exported = exportedQuality.records.find(row => row.datasetId === record.datasetId)!;
    expect(exported.authorConcordance.scope).toContain('Selected author genes only');
    expect(exported.contrasts.cr_vs_al.authorConcordance).toEqual(supported);
  });

  it('supports exact identifier agreement without concealing missing maternal-emulsifier author rows', () => {
    const record = requireAuthorValidation('mouse_mbh_maternal_emulsifier_gse231769');
    const metrics = record.directComparison!.metrics;
    const review = record.verification.comparability;
    expect(metrics.localGenes).toBe(14592);
    expect(metrics.sharedGenes).toBe(14483);
    expect(metrics.localGenes! - metrics.sharedGenes!).toBe(109);
    expect(metrics.localCoverage).toBeCloseTo(14483 / 14592, 7);
    expect(review.dimensions.features.status).toBe('compatible');
    expect(review.dimensions.features.note).toContain('109');
    expect(review.dimensions.coverage.status).toBe('limited');
    expect(assessAuthorConcordance(record).status).toBe('pass');
    expect(record.verification.fullyVerifiedContrasts).toEqual([]);
    expect(exportedQuality.records.find(row => row.datasetId === record.datasetId)?.authorConcordance.status).toBe('pass');
  });

  it('emits only HTTP(S) evidence links while local provenance remains outside web navigation', () => {
    for (const record of AUTHOR_VALIDATION_REPORT.records) {
      for (const link of record.evidenceLinks) {
        expect(link.url, `${record.datasetId}: ${link.label}`).toMatch(/^https?:\/\//);
        expect(['http:', 'https:'], `${record.datasetId}: ${link.url}`).toContain(new URL(link.url).protocol);
      }
    }
  });

  it('keeps the compound cattle source label unmatched without splitting it into invented rows', () => {
    const lines = readFileSync('data/author-validation/continued-sources/advancement-sources-a-2026-09-05/GSE49540/author-effects.tsv', 'utf8').trimEnd().split(/\r?\n/);
    const header = lines.shift()!.split('\t');
    const outputIdColumn = header.indexOf('output_id');
    expect(lines).toHaveLength(132);
    const compound = lines.find(line => line.includes('Q1KLR3') && line.includes('DDX58'))!;
    expect(compound).toBeTruthy();
    expect(compound.split('\t')[outputIdColumn]).toMatch(/^__AUTHOR_UNMAPPED/);
    const metrics = requireAuthorValidation('cattle_hypo_diet_restriction_gse49540').directComparison!.metrics;
    expect(metrics.authorGenes).toBe(132);
    expect(metrics.sharedGenes).toBe(102);
  });
});
