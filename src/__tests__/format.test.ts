import { describe, it, expect } from 'vitest';
import { pToStar, fmtP, fmtFDR, fmtSigned, fmtCutoff, truncate } from '../utils/format';

// These formatters are pure and threshold-driven; the value is in pinning the
// boundary behaviour (every comparison is strict `<` / `>=`), since the display
// of p-values and FDRs across the gene + pathway explorers depends on them.

describe('pToStar — significance stars', () => {
  it('returns **** below 0.0001', () => {
    expect(pToStar(0.00005)).toBe('****');
  });

  it('0.0001 is *** (boundary is strict <)', () => {
    expect(pToStar(0.0001)).toBe('***');
    expect(pToStar(0.0005)).toBe('***');
  });

  it('0.001 is ** (boundary is strict <)', () => {
    expect(pToStar(0.001)).toBe('**');
    expect(pToStar(0.005)).toBe('**');
  });

  it('0.01 is * (boundary is strict <)', () => {
    expect(pToStar(0.01)).toBe('*');
    expect(pToStar(0.03)).toBe('*');
  });

  it('0.05 and above is ns (boundary is strict <)', () => {
    expect(pToStar(0.05)).toBe('ns');
    expect(pToStar(0.5)).toBe('ns');
  });
});

// p and q share ONE display rule by decision: 2 significant figures below 0.001,
// 3 decimals above. fmtFDR no longer floors at '< 0.001' (that floor erased the
// ranking of thousands of q-values spanning ~19 orders of magnitude), and fmtP no
// longer renders a digit more than its estimator supports.
describe('fmtP / fmtFDR — the shared p+q display rule', () => {
  it('fmtFDR agrees with fmtP everywhere — one rule, two names', () => {
    for (const v of [0, 1e-300, 1.7e-22, 0.0005, 0.000999, 0.001, 0.05, 0.5, 1, NaN]) {
      expect(fmtFDR(v)).toBe(fmtP(v));
    }
    expect(fmtFDR(null)).toBe(fmtP(null));
  });

  it('uses 2-sig exponential below 0.001, down to the smallest normals', () => {
    expect(fmtP(0.0005)).toBe('5.0e-4');
    expect(fmtP(0.00014)).toBe('1.4e-4');
    expect(fmtP(1.7e-22)).toBe('1.7e-22');
    expect(fmtP(4.9e-300)).toBe('4.9e-300');
  });

  it('uses 3-decimal fixed at and above 0.001', () => {
    expect(fmtP(0.001)).toBe('0.001');
    expect(fmtP(0.05)).toBe('0.050');
    expect(fmtP(0.5)).toBe('0.500');
  });

  it('renders an underflowed (non-positive) value as the "< 1e-300" sentinel', () => {
    // twoSidedNormalP underflows float64 on large |z|; the old code rendered the
    // resulting 0 as "0.0e+0", which reads as a p of exactly zero.
    expect(fmtP(0)).toBe('< 1e-300');
    expect(fmtP(-0)).toBe('< 1e-300');
  });

  it('renders a missing or non-finite value as an en dash', () => {
    expect(fmtP(null)).toBe('–');
    expect(fmtP(undefined)).toBe('–');
    expect(fmtP(NaN)).toBe('–');
    expect(fmtP(Infinity)).toBe('–');
  });

  it('KNOWN artifact: [9.95e-4, 1e-3) rounds up into exponential form', () => {
    // Accepted cosmetic noise — "1.0e-3" can sit beside a neighbouring "0.001"
    // rather than complicate the rule with a second rounding pass.
    expect(fmtP(0.000999)).toBe('1.0e-3');
    expect(fmtP(0.001)).toBe('0.001');
  });
});

describe('fmtSigned — signed effect sizes (logFC / NES)', () => {
  it('prefixes a plus only for strictly positive values', () => {
    expect(fmtSigned(1.2345, 3)).toBe('+1.234');
    expect(fmtSigned(-1.2345, 3)).toBe('-1.234');
  });

  it('leaves zero (and -0) unsigned', () => {
    expect(fmtSigned(0, 3)).toBe('0.000');
    expect(fmtSigned(-0, 3)).toBe('0.000');
  });

  it('honours the requested precision — 2dp and 3dp sites must not unify', () => {
    expect(fmtSigned(1.5, 2)).toBe('+1.50');
    expect(fmtSigned(1.5, 3)).toBe('+1.500');
  });
});

describe('fmtCutoff — threshold-label display', () => {
  it('3-decimal fixed at and above 0.01', () => {
    expect(fmtCutoff(0.05)).toBe('0.050');
    expect(fmtCutoff(0.01)).toBe('0.010');
  });

  it('4-decimal fixed in [0.001, 0.01)', () => {
    expect(fmtCutoff(0.005)).toBe('0.0050');
    expect(fmtCutoff(0.001)).toBe('0.0010');
  });

  it('1-sig exponential below 0.001', () => {
    expect(fmtCutoff(0.0005)).toBe('5.0e-4');
  });
});

describe('truncate', () => {
  it('leaves strings at or under the limit untouched', () => {
    expect(truncate('hello', 10)).toBe('hello');
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('clips to n-1 chars plus an ellipsis when over the limit', () => {
    expect(truncate('hello world', 5)).toBe('hell…');
    expect(truncate('hello!', 5)).toBe('hell…');
  });
});
