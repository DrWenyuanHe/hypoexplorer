import { describe, expect, it } from 'vitest';
import { recoverSourceSymbols, requireUniqueKeys } from '../../scripts/lib/authorSourceRecovery.mjs';
import comparisonData from '../../data/author-validation/direct-comparisons.generated.json';

describe('author source recovery', () => {
  it('disambiguates colliding spreadsheet dates by stable ID and locus, preserving effects', () => {
    const workbook = [{ __EMPTY: 40603, ensembl_id: 'id1', locus: 'locus1', effect: -0.25 },
      { __EMPTY: 40603, ensembl_id: 'id2', locus: 'locus2', effect: 0.39 }];
    const recovered = recoverSourceSymbols(workbook, [{ symbol: 'Marc2', ensembl_id: 'id1', locus: 'locus1' },
      { symbol: 'March2', ensembl_id: 'id2', locus: 'locus2' }]);
    expect(recovered.map(row => [row.__EMPTY, row.effect])).toEqual([['Marc2', -0.25], ['March2', 0.39]]);
    expect(workbook[0].__EMPTY).toBe(40603);
  });
  it('rejects ambiguity and changed loci rather than guessing a gene', () => {
    const workbook = [{ __EMPTY: 40603, ensembl_id: 'id1', locus: 'locus1' }];
    const source = { symbol: 'Marc2', ensembl_id: 'id1', locus: 'locus1' };
    expect(() => recoverSourceSymbols(workbook, [source, source])).toThrow('Ambiguous');
    expect(() => recoverSourceSymbols(workbook, [{ ...source, locus: 'changed' }])).toThrow('Ambiguous');
  });
  it('keeps existing symbols and rejects duplicate join keys', () => {
    const row = { __EMPTY: 'valid' };
    expect(recoverSourceSymbols([row], [])[0]).toBe(row);
    expect(() => requireUniqueKeys([{ key: 'a' }, { key: 'a' }], 'source')).toThrow('duplicate');
    expect(() => requireUniqueKeys([{ key: '' }], 'source')).toThrow('missing');
  });
  it('retains the newly resolved paired genes in both registered GSE68177 comparisons', () => {
    for (const [id, shared] of [['mouse_agrp_fedfast_gse68177', 14548], ['mouse_pomc_fedfast_gse68177', 14270]] as const) {
      const record = comparisonData.comparisons.find(row => row.datasetId === id)!;
      expect(record.metrics.sharedGenes).toBe(shared);
      expect(record.metrics.authorGenes).toBe(16513);
      expect(record.references.some(source => source.path.endsWith('GSE68177_Agrp.Pomc.fedfast.counts.txt.gz'))).toBe(true);
    }
  });
  it('does not expose bROC confidence as author FDR or FDR overlap', () => {
    const record = comparisonData.comparisons.find(row => row.datasetId === 'rat_pvn_adolescent_stress_gse169296')!;
    expect(record.metrics.authorSignificantGenes).toBeNull();
    expect(record.metrics.significantInBoth).toBeNull();
    expect(record.metrics.significantSetJaccard).toBeNull();
    expect(record.metrics.authorSignificantSignConcordance).toBeNull();
    // 11/11 before the R 4.6.0 regeneration; two of those genes were unmapped features that are no
    // longer published (data/quality/regeneration-r460-2026-09-25/README.md).
    expect(record.note).toContain('9/9 shared CLC confidence >=0.95 effects agree');
  });
});
