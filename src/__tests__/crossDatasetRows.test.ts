import { describe, it, expect } from 'vitest';
import { geneRow, pathwayRow } from '../data/crossDatasetRows';

// geneRow/pathwayRow are the ONE place a cross-dataset report row gets its
// direction and its significance verdict. Both are called from two fetch paths —
// the precomputed query index and the full bundle download — which is exactly
// the setup where a cutoff can drift so the fast and slow paths disagree about
// whether a track is significant. queryIndex.test.ts pins the paths end to end;
// these pin the boundary directly on the pure builders.

describe('geneRow', () => {
  const base = { trackId: 't1', label: 'POMC neurons', type: 'Neuronal', logFC: 1.5, fdr: 0.01, pval: 0.001, se: 0.3, lowPower: false };

  it('encodes direction from the sign of logFC, with 0 as flat', () => {
    expect(geneRow({ ...base, logFC: 1.5 }).direction).toBe('up');
    expect(geneRow({ ...base, logFC: -1.5 }).direction).toBe('down');
    expect(geneRow({ ...base, logFC: 0 }).direction).toBe('flat');
  });

  it('is significant strictly below FDR 0.05', () => {
    expect(geneRow({ ...base, fdr: 0.049 }).significant).toBe(true);
    expect(geneRow({ ...base, fdr: 0.05 }).significant).toBe(false);
    expect(geneRow({ ...base, fdr: 0.06 }).significant).toBe(false);
  });

  it('treats a missing FDR as NOT significant (an unknown q is not a small one)', () => {
    expect(geneRow({ ...base, fdr: null }).significant).toBe(false);
  });

  it('passes the numbers through untouched, including a null se and the lowPower INPUT', () => {
    // lowPower is supplied by the caller — the index reads the generator's flag,
    // the fallback computes isLowPower — so the builder must never derive it.
    const row = geneRow({ ...base, se: null, lowPower: true });
    expect(row).toEqual({ ...base, se: null, lowPower: true, direction: 'up', significant: true });
  });
});

describe('pathwayRow', () => {
  const base = { trackId: 't1', label: 'POMC neurons', type: 'Neuronal', NES: 2.1, padj: 0.01, pval: 0.002, size: 120, db: 'HALLMARK' as const };

  it('encodes direction from the sign of NES, with 0 as flat', () => {
    expect(pathwayRow({ ...base, NES: 2.1 }).direction).toBe('up');
    expect(pathwayRow({ ...base, NES: -2.1 }).direction).toBe('down');
    expect(pathwayRow({ ...base, NES: 0 }).direction).toBe('flat');
  });

  it('is significant strictly below padj 0.05 — the same cutoff geneRow uses', () => {
    expect(pathwayRow({ ...base, padj: 0.049 }).significant).toBe(true);
    expect(pathwayRow({ ...base, padj: 0.05 }).significant).toBe(false);
  });

  it('passes NES/padj/pval/size/db through untouched', () => {
    expect(pathwayRow(base)).toEqual({ ...base, direction: 'up', significant: true });
  });
});
