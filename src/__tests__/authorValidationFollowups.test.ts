import { describe, expect, it } from 'vitest';
import { requireAuthorValidation } from '../data/authorValidation';

const ids = [
  'mouse_arc_hfd_gse284408',
  'mouse_arc_pnoc_trap_gse292416',
  'rat_son_dehydration_gse175461',
  'mouse_mpoa_pnoc_bactrap_gse306829',
  'mouse_hypo_pomc_estrogen_gse328990',
];

describe('five-dataset scientific follow-up', () => {
  it.each(ids)('%s exposes source availability, cohort progress and a concrete next step', (id) => {
    const record = requireAuthorValidation(id);
    expect(record.verification.resultAvailability).toBe('available');
    expect(record.verification.comparability.dimensions.cohort.status).toBe('matched');
    expect(record.verification.comparability.target).toBe('registered_output');
    expect(record.verification.fullyVerifiedContrasts).toEqual([]);
    expect(record.verification.state).not.toBe('full');
    expect(record.verification.nextStep).not.toMatch(/^Reconcile author-compatible cohort/);
    expect(record.note).toContain('five-dataset-followup-2026-09-04');
  });

  it('does not turn reproduced author-method results into an Explorer sign-off', () => {
    const son = requireAuthorValidation(ids[2]);
    // R 4.6.0 regeneration (edgeR 4.10, org.*.eg.db 3.23, unmapped features unpublished):
    // data/quality/regeneration-r460-2026-09-25/README.md.
    expect(son.directComparison?.metrics.localSignificantGenes).toBe(1805);
    expect(son.directComparison?.metrics.significantInBoth).toBe(1788);
    expect(son.directComparison?.metrics.significantSetJaccard).toBe(0.84339623);
    expect(son.verification.comparability.dimensions.coverage.note).toContain('700');
    const pnoc = requireAuthorValidation(ids[3]);
    // GSE306829 is a flagged table of the R 4.6.0 regeneration (symbol reassignments by
    // org.Mm.eg.db 3.23): data/quality/regeneration-r460-2026-09-25/README.md.
    expect(pnoc.directComparison?.metrics.localSignificantGenes).toBe(7500);
    expect(pnoc.directComparison?.metrics.significantInBoth).toBe(6409);
    expect(pnoc.directComparison?.metrics.significantSetJaccard).toBe(0.84207069);
    expect(pnoc.directComparison?.note).toContain('19 are registered discoveries');
  });

  it('flags available-data discrepancies separately from access gaps', () => {
    for (const id of [ids[0], ids[4]]) {
      const record = requireAuthorValidation(id);
      expect(record.verification.state).toBe('unresolved');
      expect(record.verification.comparisonOutcome).toBe('unresolved');
      expect(record.verification.resultAvailability).toBe('available');
    }
    expect(requireAuthorValidation(ids[0]).note).toContain('Table S1');
    expect(requireAuthorValidation(ids[4]).verification.nextStep).toContain('Cenpf');
  });
});

const nextTen = [
  'mouse_tanycyte_insulin_gse185074',
  'mouse_arc_pomc_drd2_gse210311',
  'mouse_hypo_obob_fgf1_gse153551',
  'mouse_hypo_lef1_gse98519',
  'mouse_gt17_mkrn3_gse160467',
  'mouse_mhypoa_cbd_gse270378',
  'mouse_gt17_orexin_gse99690',
  'mouse_hypo_maternal_hcd_gse242187',
  'mouse_hypo_hibernation_gse295250',
  'mouse_arc_agrp_trap_gse240484',
];

describe('ten additional scientific follow-ups', () => {
  it.each(nextTen)('%s shares the new evidence and next action with Explorer and tracker', (id) => {
    const record = requireAuthorValidation(id);
    expect(record.verification.resultAvailability).toBe('available');
    expect(record.verification.evidenceLevel).toBe('author_results');
    expect(record.verification.comparability.target).toBe('registered_output');
    expect(record.verification.fullyVerifiedContrasts).toEqual([]);
    expect(record.verification.state).not.toBe('full');
    expect(record.verification.nextStep).not.toMatch(/^Reconcile author-compatible cohort/);
    expect(record.note).toContain('ten-dataset-followup-2026-09-04');
    expect(record.verification.comparability.dimensions.inference.status).toBe('different');
  });

  it('keeps reproduced author code separate from the registered AgRP analysis', () => {
    const record = requireAuthorValidation('mouse_arc_agrp_trap_gse240484');
    expect(record.note).toContain('four-batch');
    expect(record.note).toContain('3,255');
    expect(record.verification.comparability.dimensions.coverage.note).toContain(
      '46 Explorer discoveries',
    );
    expect(record.verification.nextStep).toContain('batch');
  });

  it('does not count the missing orexin author FDR as a negative result', () => {
    const record = requireAuthorValidation('mouse_gt17_orexin_gse99690');
    // R 4.6.0 regeneration (edgeR 4.10, org.*.eg.db 3.23, unmapped features unpublished):
    // data/quality/regeneration-r460-2026-09-25/README.md.
    expect(record.directComparison?.metrics.localSignificantGenes).toBe(6389);
    expect(record.directComparison?.metrics.significantInBoth).toBe(5101);
    expect(record.directComparison?.note).toContain('Crtam');
    expect(record.verification.comparability.dimensions.inference.note).toContain('15,799');
  });

  it('distinguishes unresolved observed results from unavailable data', () => {
    for (const id of [nextTen[2], nextTen[7], nextTen[8]]) {
      const record = requireAuthorValidation(id);
      expect(record.verification.state).toBe('unresolved');
      expect(record.verification.resultAvailability).toBe('available');
    }
    expect(requireAuthorValidation(nextTen[8]).verification.nextStep).toContain('Holm');
  });
});
