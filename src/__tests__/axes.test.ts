import { describe, it, expect } from 'vitest';
import { MAX_LABEL_LINES, niceTicks, wrapLabel } from '../utils/axes';

// wrapLabel(text, maxWidth, fontSize). jsdom has no 2D canvas, so widths come
// from the fallback estimate of 0.56 em per character: 5.6 px a char at 10 px.
describe('wrapLabel', () => {
  it('keeps a label that fits on one line', () => {
    expect(wrapLabel('Chow (n=5)', 100, 10)).toEqual(['Chow (n=5)']);
  });

  it('wraps at word boundaries to the slot width', () => {
    // 17 chars ≈ 95 px fits a 100 px slot; one more word does not.
    expect(wrapLabel('Four-week vehicle (n=3)', 100, 10)).toEqual(['Four-week vehicle', '(n=3)']);
    expect(wrapLabel('Four-week corticosterone (n=4)', 100, 10)).toEqual(['Four-week', 'corticosterone', '(n=4)']);
  });

  it('gives an over-long single word its own line instead of breaking it', () => {
    expect(wrapLabel('a hypercorticosteronaemic b', 40, 10)).toEqual(['a', 'hypercorticosteronaemic', 'b']);
  });

  it('cuts past the line limit with an ellipsis', () => {
    const lines = wrapLabel('one two three four five six', 20, 10);
    expect(lines).toHaveLength(MAX_LABEL_LINES);
    expect(lines[MAX_LABEL_LINES - 1].endsWith('…')).toBe(true);
  });

  it('returns one empty line for an empty label', () => {
    expect(wrapLabel('', 100, 10)).toEqual(['']);
  });
});

// niceTicks(min, max, target) generates evenly-spaced "nice" ticks. The step is
// chosen from the normalized span (norm ∈ [1, 10) for any finite positive rough),
// then halved: norm≥5 → 5·pow, norm≥2 → 2.5·pow, else → pow. Endpoints are
// included only when they land cleanly on a step boundary.

describe('niceTicks — degenerate spans', () => {
  it('returns [min] when span is zero', () => {
    expect(niceTicks(5, 5, 4)).toEqual([5]);
  });

  it('returns [min] when span is negative (max < min)', () => {
    expect(niceTicks(10, 2, 4)).toEqual([10]);
  });

  it('returns [min] when max is non-finite', () => {
    expect(niceTicks(0, Infinity, 4)).toEqual([0]);
  });

  it('returns [min] when the span is NaN', () => {
    // 10 - NaN === NaN, which is not finite → guard returns [min].
    const ticks = niceTicks(Number.NaN, 10, 4);
    expect(ticks).toHaveLength(1);
    expect(Number.isNaN(ticks[0])).toBe(true);
  });
});

describe('niceTicks — step-selection bands', () => {
  // span/target lands rough in a known band; step is verified via tick spacing.
  it('norm ≥ 5 → step = 5·pow', () => {
    const ticks = niceTicks(0, 70, 10); // rough 7 → norm 7 → step 5
    expect(ticks[1] - ticks[0]).toBeCloseTo(5, 10);
  });

  it('2 ≤ norm < 5 → step = 2.5·pow', () => {
    const ticks = niceTicks(0, 30, 10); // rough 3 → norm 3 → step 2.5
    expect(ticks[1] - ticks[0]).toBeCloseTo(2.5, 10);
  });

  it('1 ≤ norm < 2 → step = 1·pow', () => {
    const ticks = niceTicks(0, 15, 10); // rough 1.5 → norm 1.5 → step 1
    expect(ticks[1] - ticks[0]).toBeCloseTo(1, 10);
  });

  it('scales the step by the power of ten (sub-unit spans)', () => {
    const ticks = niceTicks(0, 0.3, 10); // rough 0.03 → pow 0.01 → norm 3 → step 0.025
    expect(ticks[1] - ticks[0]).toBeCloseTo(0.025, 10);
  });
});

describe('niceTicks — endpoints & ranges', () => {
  it('includes both endpoints when they are clean multiples of the step', () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2.5, 5, 7.5, 10]);
  });

  it('starts at the first step boundary ≥ min when min is not clean', () => {
    expect(niceTicks(1, 9, 4)).toEqual([2.5, 5, 7.5]);
  });

  it('handles a negative-to-positive domain symmetrically', () => {
    // span 10, target 5 → step 2.5; first boundary ≥ -5 is -5.
    expect(niceTicks(-5, 5, 5)).toEqual([-5, -2.5, 0, 2.5, 5]);
  });

  it('rounds away binary-float dust (every tick is clean)', () => {
    for (const t of niceTicks(0, 1, 10)) {
      expect(t).toBe(+t.toFixed(10));
    }
  });
});
