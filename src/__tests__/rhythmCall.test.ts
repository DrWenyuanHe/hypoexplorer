import { describe, expect, it } from 'vitest';
import { armVerdict, isRhythmic, rhythmScore } from '../circadian/rhythmCall';
import type { AdjustMethod } from '../circadian/multipleTesting';

// The rhythmic call and the per-arm verdict, as a decision table. The tab's
// filter and counts, the results table's emphasis and the strip under the
// trace all read these, so the raw-versus-adjusted choice and the verdict's
// precedence are pinned once here.

describe('rhythmScore and isRhythmic', () => {
  it('judges the raw p when the correction is off, the adjusted q otherwise', () => {
    const row = { p: 0.01, q: 0.2 };
    expect(rhythmScore(row, 'none')).toBe(0.01);
    expect(rhythmScore(row, 'bh')).toBe(0.2);
    expect(isRhythmic(row, { adjust: 'none', threshold: 0.05 })).toBe(true);
    expect(isRhythmic(row, { adjust: 'bh', threshold: 0.05 })).toBe(false);
  });

  it('counts a row not yet adjusted as q = 1, never as its raw p', () => {
    const raw = { p: 0.001, q: null };
    for (const adjust of ['bh', 'by', 'holm', 'bonferroni'] as AdjustMethod[]) {
      expect(rhythmScore(raw, adjust)).toBe(1);
      expect(isRhythmic(raw, { adjust, threshold: 0.05 })).toBe(false);
    }
    expect(isRhythmic(raw, { adjust: 'none', threshold: 0.05 })).toBe(true);
  });

  it('never calls a non-finite score rhythmic, and the threshold is strict', () => {
    expect(isRhythmic({ p: Number.NaN, q: Number.NaN }, { adjust: 'none', threshold: 0.05 })).toBe(false);
    expect(isRhythmic({ p: Number.NaN, q: Number.NaN }, { adjust: 'bh', threshold: 0.05 })).toBe(false);
    expect(isRhythmic({ p: 0.05, q: 0.05 }, { adjust: 'bh', threshold: 0.05 })).toBe(false);
  });
});

describe('armVerdict', () => {
  const bh = { adjust: 'bh' as const, threshold: 0.05 };
  const none = { adjust: 'none' as const, threshold: 0.05 };

  it.each([
    // fit, q, call, verdict
    [null, undefined, bh, 'not tested'],     // no fit while the arm is still queued
    [null, 0.01, bh, 'not tested'],
    [null, undefined, none, 'not tested'],
    [{ p: 0.01 }, undefined, none, 'rhythmic'],   // uncorrected: judged at once, never pending
    [{ p: 0.2 }, undefined, none, 'not rhythmic'],
    [{ p: 0.01 }, 0.9, none, 'rhythmic'],         // uncorrected ignores q
    [{ p: 0.01 }, undefined, bh, 'pending'],
    [{ p: 0.01 }, null, bh, 'not tested'],        // the scan did not score the gene
    [{ p: 0.01 }, 0.04, bh, 'rhythmic'],
    [{ p: 0.001 }, 0.2, bh, 'not rhythmic'],      // corrected ignores the fit's p
  ] as const)('fit %j, q %s, %j → %s', (fit, q, call, verdict) => {
    expect(armVerdict(fit, q, call)).toBe(verdict);
  });
});
