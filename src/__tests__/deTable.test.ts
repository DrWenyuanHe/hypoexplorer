import { describe, it, expect } from 'vitest';
import {
  REQUIRED_DE_COLUMNS,
  deStats,
  indexDeHeader,
  numCell,
  rankScore,
} from '../../scripts/lib/deTable.mjs';

// The DE-header contract used to be asserted in ONE of the three builders that
// read the identical schema. These pin the rule now that all three share it.

const FULL = ['id', 'symbol', 'logFC', 'stat', 'pvalue', 'padj', 'method', 'direction'];

describe('indexDeHeader', () => {
  it('indexes a well-formed header', () => {
    const di = indexDeHeader(FULL, 'X_DE.tsv');
    expect(di.symbol).toBe(1);
    expect(di.padj).toBe(5);
  });

  it('throws — naming the column and the header — when a required column is renamed', () => {
    // The failure this prevents is NOT an empty table. `indexOf` gives -1, so
    // `row[-1]` is undefined, `+undefined` is NaN, and NaN serialises to null:
    // a full-size gene list with "logFC":null on every row, and nothing thrown.
    const drifted = FULL.map((h) => (h === 'logFC' ? 'log2FoldChange' : h));
    expect(() => indexDeHeader(drifted, 'GSE1_DE.tsv')).toThrow(/no "logFC" column/);
    expect(() => indexDeHeader(drifted, 'GSE1_DE.tsv')).toThrow(/drifted apart/);
    expect(() => indexDeHeader(drifted, 'GSE1_DE.tsv')).toThrow(/GSE1_DE\.tsv/);
  });

  it('checks every column the pipeline reads, not just the headline four', () => {
    for (const col of REQUIRED_DE_COLUMNS) {
      const missing = FULL.filter((h) => h !== col);
      expect(() => indexDeHeader(missing, 'X_DE.tsv')).toThrow(new RegExp(`no "${col}" column`));
    }
  });

  it('checks the extra columns a builder declares it joins on', () => {
    const noId = FULL.filter((h) => h !== 'id');
    // Without this, a drifted `id` yields undefined keys and an SE sidecar that
    // joins to nothing — every se silently null.
    expect(() => indexDeHeader(noId, 'X_DE.tsv', ['id'])).toThrow(/no "id" column/);
    expect(() => indexDeHeader(noId, 'X_DE.tsv')).not.toThrow();
  });
});

describe('numCell', () => {
  it('maps R\'s NA, NaN and the empty string to NaN — never to 0', () => {
    // `fwrite` writes NA as an empty string, and `Number('')` is 0. An empty
    // padj coerced with a bare `+` is a gene with FDR exactly 0: a fabricated
    // maximally-significant hit.
    expect(numCell('')).toBeNaN();
    expect(numCell('  ')).toBeNaN();
    expect(numCell('NA')).toBeNaN();
    expect(numCell('NaN')).toBeNaN();
    expect(numCell(undefined)).toBeNaN();
  });

  it('parses real numbers, including a legitimate zero', () => {
    expect(numCell('0')).toBe(0);
    expect(numCell('-1.25')).toBe(-1.25);
    expect(numCell(' 3e-8 ')).toBe(3e-8);
  });
});

describe('rankScore', () => {
  it('ranks an underflowed q-value FIRST, not last', () => {
    // `Number(fdr) || 1` treated an exact 0 as 1 because 0 is falsy, so the
    // strongest hit sorted last among significant genes.
    expect(rankScore(1, 0)).toBe(300);
    expect(rankScore(-1, 0)).toBe(-300);
  });

  it('carries the sign of the effect', () => {
    expect(rankScore(2, 0.001)).toBeCloseTo(3, 6);
    expect(rankScore(-2, 0.001)).toBeCloseTo(-3, 6);
  });

  it('treats a missing FDR as 1 (rank 0), and caps the range', () => {
    expect(rankScore(1, Number.NaN)).toBe(0);
    expect(rankScore(1, 1)).toBe(0);
    expect(Math.abs(rankScore(1, Number.MIN_VALUE))).toBeLessThanOrEqual(1000);
  });
});

describe('deStats', () => {
  it('reads the five fields NA-safely off one row', () => {
    const di = indexDeHeader(FULL, 'X_DE.tsv', ['id']);
    const row = ['ENSMUSG1', 'Pomc', '1.5', '4.2', '1e-5', '', 'limma', 'up'];
    const s = deStats(row, di);
    expect(s.logFC).toBe(1.5);
    expect(s.PValue).toBe(1e-5);
    // The empty padj is NaN, which serialises to null — NOT 0.
    expect(s.FDR).toBeNaN();
    expect(s.method).toBe('limma');
  });
});
