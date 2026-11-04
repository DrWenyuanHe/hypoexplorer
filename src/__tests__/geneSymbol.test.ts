// Pins the mouse gene-symbol normalizer (scripts/lib/geneSymbol.mts), the single
// gate every bundle builder puts raw feature ids through. What it lets past
// becomes a browsable "gene" on the volcano and a row in the nomenclature table,
// so each drop rule here is a data-product guarantee, not a formatting nicety.
import { describe, it, expect } from 'vitest';
import { normalizeGene } from '../../scripts/lib/geneSymbol.mjs';

describe('normalizeGene — kept symbols', () => {
  it('passes an ordinary symbol through unchanged', () => {
    expect(normalizeGene('Agrp')).toBe('Agrp');
    expect(normalizeGene('Igfbp2')).toBe('Igfbp2');
  });

  it('keeps LOC###### NCBI placeholder symbols (they resolve in the authority)', () => {
    expect(normalizeGene('LOC102640715')).toBe('LOC102640715');
  });

  it('keeps the Mir* host genes that DO carry a symbol', () => {
    expect(normalizeGene('Mir100hg')).toBe('Mir100hg');
    expect(normalizeGene('Mir9-3hg')).toBe('Mir9-3hg');
  });

  it('repairs Excel-corrupted March/Septin symbols', () => {
    expect(normalizeGene('1-Mar')).toBe('Marchf1');
    expect(normalizeGene('Sep-2')).toBe('Septin2');
    expect(normalizeGene('Sep-01')).toBe('Septin1');
    expect(normalizeGene('Mar-03')).toBe('Marchf3');
    expect(normalizeGene('08-Sep')).toBe('Septin8');
  });
});

describe('normalizeGene — dropped identifiers', () => {
  it('drops unmapped Ensembl / RefSeq / bare-Entrez ids', () => {
    expect(normalizeGene('ENSMUST00000193812')).toBeNull();
    expect(normalizeGene('NM_001081979')).toBeNull();
    expect(normalizeGene('100503605')).toBeNull();
  });

  // GSE68177 shipped these as points on the volcano: htseq-count appends its
  // counting stats as rows of the count matrix, so DE ran on them and gave them
  // a logFC and a p-value. They were also inside the CPM library-size
  // denominator — __no_feature alone is 24-53% of those libraries.
  it('drops the htseq-count summary rows', () => {
    for (const counter of [
      '__no_feature',
      '__ambiguous',
      '__too_low_aQual',
      '__not_aligned',
      '__alignment_not_unique',
    ]) {
      expect(normalizeGene(counter)).toBeNull();
    }
  });

  // GSE314029's matrix names its 599 symbol-less features "-1".."-599",
  // numbered sequentially down the file. The index carries no gene identity,
  // and nothing upstream can recover one.
  it('drops bare "-<n>" unnamed-feature placeholders', () => {
    expect(normalizeGene('-1')).toBeNull();
    expect(normalizeGene('-100')).toBeNull();
    expect(normalizeGene('-599')).toBeNull();
  });

  it('does not mistake a real hyphenated symbol for a placeholder index', () => {
    expect(normalizeGene('n-R5s97')).toBe('n-R5s97');
    expect(normalizeGene('Nkx2-1')).toBe('Nkx2-1');
    expect(normalizeGene('H2-K1')).toBe('H2-K1');
  });
});
