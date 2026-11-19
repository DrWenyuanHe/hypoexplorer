import { describe, expect, it } from 'vitest';
import {
  AUTHOR_VALIDATION_REPORT,
  AUTHOR_VALIDATION_STATUS,
  getAuthorValidation,
  requireAuthorValidation,
} from '../data/authorValidation';
import { listDatasets } from '../data/datasets';
import { getVerificationClaim } from '../data/authorVerification';
import { registryCards } from '../data/datasetCatalog';
import { filterAndSort, trackerValidationKey, validationForTrackerRow } from '../dataset-tracker/trackerLogic';
import type { TrackerRow } from '../types';
import SEPTEMBER5_STUDIES from '../data/september5Studies.generated.json';

describe('author-validation sidecar', () => {
  it('has exact registry closure and one explicit scope exclusion', () => {
    const registryIds = listDatasets().map((dataset) => dataset.id).sort();
    const validationIds = AUTHOR_VALIDATION_REPORT.records.map((record) => record.datasetId).sort();
    expect(validationIds).toEqual(registryIds);
    expect(AUTHOR_VALIDATION_REPORT.records.filter((record) => record.status === 'not_applicable'))
      .toEqual([expect.objectContaining({ datasetId: 'macaque_snrna' })]);
  });

  it('traces every in-scope public bundle exactly to its committed analysis output', () => {
    const inScope = AUTHOR_VALIDATION_REPORT.records.filter((record) => record.datasetId !== 'macaque_snrna');
    const registered = listDatasets().filter(dataset => dataset.id !== 'macaque_snrna');
    expect(inScope).toHaveLength(registered.length);
    expect(inScope.every((record) => record.pipelineTrace === 'exact')).toBe(true);
    expect(inScope.reduce((sum, record) => sum + record.contrastCount, 0))
      .toBe(registered.reduce((sum, dataset) => sum + dataset.contrasts.length, 0));
  });

  it('includes checksum-verified pathway rebuild evidence for every registered in-scope contrast', () => {
    const inScope = AUTHOR_VALIDATION_REPORT.records.filter((record) => record.datasetId !== 'macaque_snrna');
    expect(inScope).toHaveLength(listDatasets().length - 1);
    for (const record of inScope) {
      const pathway = record.pathwayValidation;
      expect(pathway).toEqual(expect.objectContaining({
        provenanceSchemaVersion: 3,
        contrastCount: record.contrastCount,
      }));
      expect(pathway?.provenanceFiles).toHaveLength(record.contrastCount);
      if (pathway?.state === 'current_provenance_checked') {
        expect(['rat_son_lactation_gse30733', 'rat_son_salt_gse65663']).toContain(record.datasetId);
        expect(pathway.currentRows).toBeGreaterThanOrEqual(pathway.nonFiniteRows);
        expect(pathway.nonFiniteRows).toBeGreaterThanOrEqual(0);
        expect(pathway.evidencePath).toBe('data/intake/oxt-avp-2026-10-19/audit.generated.json');
        expect(pathway).not.toHaveProperty('totals');
        expect(pathway).not.toHaveProperty('baselineCommit');
        continue;
      }
      expect(pathway?.state).toBe('rebuilt_provenance_checked');
      if (!pathway) throw new Error('Missing pathway evidence');
      expect(pathway.totals.nonFiniteRowsBefore).toBeGreaterThanOrEqual(0);
      expect(pathway.totals.nonFiniteRowsBefore).toBeLessThanOrEqual(pathway.totals.previousRows);
      expect(pathway.totals.nonFiniteRowsAfter).toBeGreaterThanOrEqual(0);
      expect(pathway.totals.nonFiniteRowsAfter).toBeLessThanOrEqual(pathway.totals.currentRows);
      if (pathway.baselineKind === 'git_commit') {
        expect(pathway.baselineCommit).toMatch(/^[0-9a-f]{40}$/);
      } else {
        expect(pathway.baselineKind).toBe('local_snapshot');
        expect(pathway.baselineCommit).toBeNull();
        expect(pathway.baselineNote.trim()).toBeTruthy();
      }
    }
    const migrated = inScope.flatMap(record => record.pathwayValidation?.state === 'rebuilt_provenance_checked' ? [record.pathwayValidation] : []);
    expect(migrated).toHaveLength(160);
    expect(migrated.reduce((sum, pathway) => sum + pathway.contrastCount, 0)).toBe(174);
    expect(requireAuthorValidation('macaque_snrna').pathwayValidation).toBeNull();
    const snapshot = requireAuthorValidation('mouse_hypo_lps_gse281503').pathwayValidation;
    expect(snapshot?.state === 'rebuilt_provenance_checked' ? snapshot.baselineKind : null).toBe('local_snapshot');
  });

  it('retains the audited untestable-row counts instead of treating missing statistics as zero', () => {
    const newIds = new Set(SEPTEMBER5_STUDIES.map((study) => study.id));
    const pathways = AUTHOR_VALIDATION_REPORT.records.filter((record) => !newIds.has(record.datasetId))
      .flatMap((record) => record.pathwayValidation?.state === 'rebuilt_provenance_checked' ? [record.pathwayValidation] : []);
    expect(pathways.reduce((sum, pathway) => sum + pathway.totals.nonFiniteRowsBefore, 0)).toBe(208);
    // The R 4.6.0 FGSEA rerun changed the non-finite rows (193 in 12 datasets before; now 208 in 13):
    // data/quality/regeneration-r460-2026-09-25/README.md.
    expect(pathways.reduce((sum, pathway) => sum + pathway.totals.nonFiniteRowsAfter, 0)).toBe(208);
    expect(pathways.filter((pathway) => pathway.totals.nonFiniteRowsAfter > 0)).toHaveLength(13);
  });

  it('keeps direct author-result evidence distinct from processed-source evidence', () => {
    const direct = requireAuthorValidation('mouse_mpoa_pnoc_bactrap_gse306829');
    expect(direct.comparisonLevel).toBe('direct');
    expect(['author_result_match', 'validated_with_notes']).toContain(direct.status);
    expect(direct.directComparison?.metrics.pearsonLogFC).toBeGreaterThan(0.99);
    expect(AUTHOR_VALIDATION_STATUS[direct.status].label).toMatch(/Author result match|Validated with notes/);
  });

  it('records processed-data subseries separately from their parent SuperSeries', () => {
    expect(requireAuthorValidation('mouse_gnrh_androgen_gse162563').processedDataAccession)
      .toBe('GSE155314');
    expect(requireAuthorValidation('mouse_hypo_obob_fgf1_gse153551').processedDataAccession)
      .toBe('GSE153549');
  });

  it('distinguishes externally staged checksum evidence from files present in the checkout', () => {
    const staged = requireAuthorValidation('mouse_hypo_spatial_aging_gse270383');
    const checkedOut = requireAuthorValidation('mouse_hypo_diabetes_gse235792');
    expect(staged.sourceComparison).toBe('staging_checksum_match');
    expect(checkedOut.sourceComparison).toBe('checksum_match');
  });

  it('retains the expressed-gene sensitivity analysis for GSE243287', () => {
    const metrics = requireAuthorValidation('mouse_hypo_smc3_gse243287').directComparison?.metrics;
    expect(metrics?.expressedGeneCount).toBe(15_567);
    expect(metrics?.expressedPearsonLogFC).toBeGreaterThan(0.96);
    expect(metrics?.expressedSignConcordance).toBeGreaterThan(0.98);
  });

  it('exposes the GSE270383 author-effect match while preserving its cohort review flag', () => {
    const record = requireAuthorValidation('mouse_hypo_spatial_aging_gse270383');
    expect(record.status).toBe('review_required');
    expect(record.comparisonLevel).toBe('direct');
    expect(record.directComparison?.metrics.sharedGenes).toBe(33);
    expect(record.directComparison?.metrics.pearsonLogFC).toBeGreaterThan(0.98);
    expect(record.directComparison?.metrics.signConcordance).toBe(1);
    expect(record.reviewFlags.join(' ')).toContain('retained-profile/cluster list');
  });

  it('records the reconstructed GSE285906 author-method validation and publisher evidence', () => {
    const record = requireAuthorValidation('mouse_hypo_oxaliplatin_gse285906');
    expect(record.status).toBe('validated_with_notes');
    expect(record.comparisonLevel).toBe('reconstructed');
    expect(record.sourceComparison).toBe('checksum_match');
    expect(record.sourceManifest).toContain('GSE285906_source_files.tsv');
    expect(record.note).toContain('Npy fold change 5.87533 versus 5.88');
    expect(record.note).toContain('FDR 0.002734 versus 0.0024');
    expect(record.paperAccess).toBe('publisher_full_text');
    const isNatureHost = (url: string) => {
      const { hostname } = new URL(url);
      return hostname === 'nature.com' || hostname.endsWith('.nature.com');
    };
    expect(record.evidenceLinks.some((link) => link.kind === 'paper' && isNatureHost(link.url)))
      .toBe(true);
  });

  it('ships validation on first-frame registry cards', () => {
    const cards = registryCards();
    expect(cards).toHaveLength(listDatasets().length);
    expect(cards.every((card) => card.validation.datasetId === card.dataset.id)).toBe(true);
  });
});

describe('tracker validation join', () => {
  it('joins integrated candidates by registry id and buckets other candidates explicitly', () => {
    const integrated = {
      acc: 'GSE306829', integrated: true,
      match: { tier: 'dataset', id: 'mouse_mpoa_pnoc_bactrap_gse306829', name: 'PNOC', via: 'GEO' },
    } as TrackerRow;
    const directStatus = requireAuthorValidation('mouse_mpoa_pnoc_bactrap_gse306829').status;
    expect(validationForTrackerRow(integrated)?.status).toBe(directStatus);
    expect(trackerValidationKey(integrated)).toBe(getVerificationClaim(requireAuthorValidation('mouse_mpoa_pnoc_bactrap_gse306829').verification));

    const candidate = { acc: 'GSE999999', integrated: false } as TrackerRow;
    expect(validationForTrackerRow(candidate)).toBeUndefined();
    expect(trackerValidationKey(candidate)).toBe('not_in_explorer');
    expect(getAuthorValidation('not-a-dataset')).toBeUndefined();
  });

  it('filters candidate rows by their joined validation state or absence from the explorer', () => {
    const integrated = {
      acc: 'GSE306829', integrated: true,
      match: { tier: 'dataset', id: 'mouse_mpoa_pnoc_bactrap_gse306829', name: 'PNOC', via: 'GEO' },
    } as TrackerRow;
    const candidate = { acc: 'GSE999999', integrated: false } as TrackerRow;
    const filters = {
      q: '', status: 'all', feas: 'all', nok: 'all', mod: 'all', sp: 'all', model: 'all',
      tag: 'all', integ: 'all', validation: trackerValidationKey(integrated),
    };
    expect(filterAndSort([integrated, candidate], {}, filters, { key: 'acc', dir: 1 }))
      .toEqual([integrated]);
    expect(filterAndSort(
      [integrated, candidate], {}, { ...filters, validation: 'not_in_explorer' }, { key: 'acc', dir: 1 },
    )).toEqual([candidate]);
  });
});
