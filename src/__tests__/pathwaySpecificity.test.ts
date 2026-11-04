import { describe, expect, it } from 'vitest';
import { hypergeometricUpperTail, pathwaySpecificity } from '../search/pathwaySpecificity';

// The condition-pathways card's rank: a pathway's recurrence among a gene's
// conditions against its base rate across the corpus.

describe('hypergeometricUpperTail', () => {
  it('matches the closed form on small counts', () => {
    // 2 of 3 draws from 39 tracks, 3 of which are hits: (C(3,2)·C(36,1) + C(3,3)) / C(39,3).
    expect(hypergeometricUpperTail(2, 3, 39, 3)).toBeCloseTo(109 / 9139, 12);
    expect(hypergeometricUpperTail(3, 30, 39, 3)).toBeCloseTo(4060 / 9139, 12);
  });

  it('is 1 at or below the smallest possible count and 0 above the largest', () => {
    expect(hypergeometricUpperTail(0, 5, 20, 4)).toBeCloseTo(1, 12);
    // Every track is a hit: all 4 draws are, with certainty.
    expect(hypergeometricUpperTail(4, 20, 20, 4)).toBeCloseTo(1, 12);
    expect(hypergeometricUpperTail(3, 2, 20, 4)).toBe(0);
  });

  it('stays finite at corpus scale', () => {
    // KEGG ribosome as OXT sees it: significant in 104 of 223 tracks.
    const tail = hypergeometricUpperTail(10, 104, 223, 12);
    expect(tail).toBeGreaterThan(0);
    expect(tail).toBeLessThan(0.05);
    // Summed over every outcome, the distribution is a distribution.
    expect(hypergeometricUpperTail(0, 104, 223, 12)).toBeCloseTo(1, 10);
  });
});

describe('pathwaySpecificity', () => {
  it('ranks a confined pathway above a ubiquitous one that recurs more', () => {
    const ubiquitous = pathwaySpecificity(10, 12, { significant: 104, tested: 223 })!;
    const confined = pathwaySpecificity(3, 12, { significant: 4, tested: 223 })!;
    expect(confined.tail).toBeLessThan(ubiquitous.tail);
    expect(ubiquitous.enrichment).toBeCloseTo(10 / (12 * 104 / 223), 12);
    expect(confined.expected).toBeCloseTo(12 * 4 / 223, 12);
  });

  it('scores a pathway significant in every track as unsurprising', () => {
    const s = pathwaySpecificity(5, 5, { significant: 200, tested: 200 })!;
    expect(s.tail).toBeCloseTo(1, 12);
    expect(s.enrichment).toBeCloseTo(1, 12);
  });

  it('caps the draws at the tracks that tested the pathway', () => {
    const s = pathwaySpecificity(2, 12, { significant: 3, tested: 8 })!;
    expect(s.draws).toBe(8);
    expect(s.expected).toBeCloseTo(3, 12);
  });

  it('refuses a missing or inconsistent base rate', () => {
    expect(pathwaySpecificity(2, 12, null)).toBeNull();
    expect(pathwaySpecificity(3, 12, { significant: 2, tested: 200 })).toBeNull();
    expect(pathwaySpecificity(1, 12, { significant: 5, tested: 4 })).toBeNull();
    expect(pathwaySpecificity(1, 12, { significant: 1.5, tested: 4 })).toBeNull();
    expect(pathwaySpecificity(3, 12, { significant: 3, tested: 2 })).toBeNull();
  });
});
