import { describe, it, expect } from 'vitest';
import { benjaminiHochberg } from '../utils/fdr';

describe('benjaminiHochberg', () => {
  it('returns [] for empty input', () => {
    expect(benjaminiHochberg([])).toEqual([]);
  });
  it('adjusts a known set and preserves input order', () => {
    // Classic worked example.
    const q = benjaminiHochberg([0.01, 0.02, 0.03, 0.04, 0.05]);
    expect(q[0]).toBeCloseTo(0.05, 10);
    expect(q[4]).toBeCloseTo(0.05, 10);
    for (const v of q) expect(v).toBeLessThanOrEqual(1);
  });
  it('is monotonic in p-value rank', () => {
    const q = benjaminiHochberg([0.9, 0.001, 0.5, 0.02]);
    // Smallest raw p (0.001, index 1) must have the smallest q.
    expect(q[1]).toBeLessThanOrEqual(q[3]);
    expect(q[3]).toBeLessThanOrEqual(q[2]);
    expect(q[2]).toBeLessThanOrEqual(q[0]);
  });
});
