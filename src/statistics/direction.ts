// How a result states its direction in text.
//
// Direction is encoded by sign + arrow + text, never colour alone (DESIGN.md,
// PRODUCT.md). Colour is the extra cue, and it is earned by the FDR call
// alone: a nominal row states its direction in the neutral colour, like a
// result that passes nothing (listingModeStore.ts).
//
// The colours are the result TEXT tokens from styles/constants.ts, which
// resultTextContrast.test.tsx holds above 4.5:1 on every result surface. The
// chart fills (UP_COLOR / DOWN_COLOR, DIRECTION_*_COLOR) are lighter and are
// for marks only: the cross-dataset pathway report once drew its NES figures
// and headline tallies in them, at 3.4:1. A view that colours a direction in
// text asks here, so the rule and the tokens cannot drift apart again.

import type { Direction } from '../types';
import type { SignificanceTier } from './policy';
import { DOWN_TEXT_COLOR, NEUTRAL_TEXT_COLOR, UP_TEXT_COLOR } from '../styles/constants';

/** The arrow that goes with the sign. */
export function dirGlyph(direction: Direction): '▲' | '▼' | '–' {
  return direction === 'up' ? '▲' : direction === 'down' ? '▼' : '–';
}

/**
 * The colour for normal-size result text that states a direction: red or blue
 * for an FDR result, neutral for a nominal one, one that passes nothing, or no
 * change. Never for plot marks.
 */
export function directionTextColor(direction: Direction, tier: SignificanceTier): string {
  if (tier !== 'fdr') return NEUTRAL_TEXT_COLOR;
  return direction === 'up' ? UP_TEXT_COLOR : direction === 'down' ? DOWN_TEXT_COLOR : NEUTRAL_TEXT_COLOR;
}
