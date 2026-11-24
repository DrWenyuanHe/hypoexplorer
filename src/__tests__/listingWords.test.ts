import { describe, expect, it } from 'vitest';
import { leadingTracks, nominalCaveat, noneLeads, notLeading } from '../statistics/listingWords';
import type { ListingMode } from '../statistics/listingModeStore';

// The words a cross-study listing uses for its mode, pinned as a table. The
// views' own sentences stay literal in their render tests; these are the
// pieces they share.

describe('listing words', () => {
  it.each<[ListingMode, number, boolean, string]>([
    ['fdr', 1, false, '1 significant track'],
    ['fdr', 2, false, '2 significant tracks'],
    ['fdr', 1, true, '1 more significant track'],
    ['fdr', 3, true, '3 more significant tracks'],
    ['nominal', 0, false, '0 tracks at p < 0.05'],
    ['nominal', 1, false, '1 track at p < 0.05'],
    ['nominal', 2, false, '2 tracks at p < 0.05'],
    ['nominal', 1, true, '1 more track at p < 0.05'],
    ['nominal', 2, true, '2 more tracks at p < 0.05'],
  ])('counts %s mode, n = %i, more = %s', (mode, n, more, words) => {
    expect(leadingTracks(mode, n, { more })).toBe(words);
  });

  it('says what the rest are not, and what leads when nothing does', () => {
    expect(notLeading('fdr')).toBe('not significant');
    expect(notLeading('nominal')).toBe('not at p < 0.05');
    expect(noneLeads('fdr')).toBe('No significant track');
    expect(noneLeads('nominal')).toBe('No track at p < 0.05');
  });

  it('never calls the nominal tier significant, and never names it in FDR mode', () => {
    const words = (mode: ListingMode) =>
      [leadingTracks(mode, 2), leadingTracks(mode, 1, { more: true }), notLeading(mode), noneLeads(mode)];
    for (const text of words('nominal')) expect(text).not.toMatch(/significant/);
    for (const text of words('fdr')) expect(text).not.toMatch(/p < /);
  });

  it('names the multiple-testing family each kind was not corrected across', () => {
    expect(nominalCaveat('gene')).toBe(
      'not corrected for the genes each study tested or the tracks searched here, so some are expected by chance.');
    expect(nominalCaveat('pathway')).toBe(
      'not corrected for testing many pathways and tracks, so some are expected by chance.');
    expect(nominalCaveat()).toBe('not corrected for multiple testing, so some are expected by chance.');
  });
});
