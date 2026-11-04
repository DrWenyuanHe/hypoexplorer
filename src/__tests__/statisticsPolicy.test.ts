import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FDR_CUTOFF,
  NORMAL_975,
  effectDirection,
  isFdrSignificant,
} from '../statistics/policy';
import { geneRow, pathwayRow } from '../data/crossDatasetRows';

// The significance policy is the one number this app applies AND documents.
// These cases pin the boundary behaviour that eight files used to re-decide by
// hand, plus the two rules that are easy to get subtly wrong on a rewrite.

describe('isFdrSignificant', () => {
  it('is strictly below the cutoff — exactly 0.05 is NOT significant', () => {
    expect(isFdrSignificant(0.049)).toBe(true);
    expect(isFdrSignificant(DEFAULT_FDR_CUTOFF)).toBe(false);
    expect(isFdrSignificant(0.051)).toBe(false);
  });

  it('treats an unknown q as not significant, never as a small one', () => {
    // `null < 0.05` is true in JS. Every hand-written call site had to remember
    // the null guard; three of them did not.
    expect(isFdrSignificant(null)).toBe(false);
    expect(isFdrSignificant(undefined)).toBe(false);
    expect(isFdrSignificant(Number.NaN)).toBe(false);
  });

  it('accepts an explicit cutoff for a caller that cuts elsewhere', () => {
    expect(isFdrSignificant(0.2, 0.25)).toBe(true);
    expect(isFdrSignificant(0.3, 0.25)).toBe(false);
  });

  it('admits a q of exactly 0 (an underflowed q is the strongest hit, not a falsy one)', () => {
    expect(isFdrSignificant(0)).toBe(true);
  });
});

describe('effectDirection', () => {
  it('calls exactly 0 flat, never down', () => {
    expect(effectDirection(0)).toBe('flat');
    expect(effectDirection(-0)).toBe('flat');
  });

  it('signs a real effect', () => {
    expect(effectDirection(0.0001)).toBe('up');
    expect(effectDirection(-2)).toBe('down');
  });

  it('calls NaN flat rather than down', () => {
    // `NaN > 0` and `NaN < 0` are both false, so the ternary must land on flat.
    expect(effectDirection(Number.NaN)).toBe('flat');
  });
});

describe('NORMAL_975', () => {
  it('is the 97.5th percentile of N(0,1), not the 1.96 shorthand', () => {
    expect(NORMAL_975).toBeCloseTo(1.959963984540054, 12);
    expect(NORMAL_975).not.toBe(1.96);
  });
});

describe('crossDatasetRows reads its policy from the shared module', () => {
  const base = {
    datasetId: 'd', trackId: 't', trackLabel: 'T', trackType: 'Tissue',
    logFC: 1.5, pval: 0.001, lowPower: false,
  } as unknown as Parameters<typeof geneRow>[0];

  it('derives direction and significance for a gene row', () => {
    const row = geneRow({ ...base, fdr: 0.01 });
    expect(row.direction).toBe('up');
    expect(row.significant).toBe(true);
  });

  it('does not call a null-FDR gene significant', () => {
    expect(geneRow({ ...base, fdr: null }).significant).toBe(false);
  });

  it('does not call an exactly-at-cutoff gene significant', () => {
    expect(geneRow({ ...base, fdr: DEFAULT_FDR_CUTOFF }).significant).toBe(false);
  });

  it('derives a pathway row from NES and padj', () => {
    const p = pathwayRow({
      datasetId: 'd', trackId: 't', trackLabel: 'T', trackType: 'Tissue',
      NES: -2.1, padj: 0.001, pval: 0.0001, size: 40,
    } as unknown as Parameters<typeof pathwayRow>[0]);
    expect(p.direction).toBe('down');
    expect(p.significant).toBe(true);
  });
});
