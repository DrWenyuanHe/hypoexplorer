import { describe, expect, it } from 'vitest';
import { dirGlyph, directionTextColor } from '../statistics/direction';
import { DOWN_TEXT_COLOR, NEUTRAL_TEXT_COLOR, UP_TEXT_COLOR } from '../styles/constants';
import type { Direction } from '../types';
import type { SignificanceTier } from '../statistics/policy';

// Direction text is coloured by one rule: red or blue for an FDR result only,
// in the text tokens resultTextContrast.test.tsx holds to 4.5:1. The contrast
// ratios themselves are pinned there, not recomputed here.

const DIRECTIONS: Direction[] = ['up', 'down', 'flat'];
const TIERS: SignificanceTier[] = ['fdr', 'nominal', 'none'];

describe('direction text', () => {
  it('pairs every direction with an arrow', () => {
    expect(DIRECTIONS.map(dirGlyph)).toEqual(['▲', '▼', '–']);
  });

  it.each([
    ['up', 'fdr', UP_TEXT_COLOR],
    ['down', 'fdr', DOWN_TEXT_COLOR],
    ['flat', 'fdr', NEUTRAL_TEXT_COLOR],
  ] as const)('colours an FDR %s result', (direction, tier, colour) => {
    expect(directionTextColor(direction, tier)).toBe(colour);
  });

  it('gives a nominal result, or one that passes nothing, the neutral colour', () => {
    for (const direction of DIRECTIONS) {
      expect(directionTextColor(direction, 'nominal')).toBe(NEUTRAL_TEXT_COLOR);
      expect(directionTextColor(direction, 'none')).toBe(NEUTRAL_TEXT_COLOR);
    }
  });

  it('only ever returns a text token, never a chart fill', () => {
    const tokens = new Set([UP_TEXT_COLOR, DOWN_TEXT_COLOR, NEUTRAL_TEXT_COLOR]);
    for (const direction of DIRECTIONS) {
      for (const tier of TIERS) expect(tokens).toContain(directionTextColor(direction, tier));
    }
  });
});
