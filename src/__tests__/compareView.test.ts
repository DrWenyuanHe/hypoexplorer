import { describe, expect, it } from 'vitest';
import {
  compareLink, comparePair, landCompareLink, openCompareView, sameCompareLink,
} from '../compare/compareView';

// What Compare shows and how its link writes it, pinned without mounting the
// tab: the default pair, the known-population rule a link lands through, and
// the link form that leaves defaults out.

const POPS = ['e9', 'i23', 'e33', 'i5'];

describe('comparePair', () => {
  it('opens on the curated pair when the dataset has those populations', () => {
    expect(comparePair({ defaultCompareTracks: ['e9', 'i23'] }, POPS)).toEqual(['e9', 'i23']);
  });

  it('falls back to the first two populations without a curated pair', () => {
    expect(comparePair({}, POPS)).toEqual(['e9', 'i23']);
    expect(comparePair({ defaultCompareTracks: [] }, ['whole', 'other'])).toEqual(['whole', 'other']);
  });

  it('never opens on a curated population the data lacks', () => {
    expect(comparePair({ defaultCompareTracks: ['e9', 'gone'] }, ['e33', 'e9', 'i5'])).toEqual(['e33', 'e9']);
    expect(comparePair({ defaultCompareTracks: ['e9', 'i23'] }, ['whole'])).toEqual(['whole']);
    expect(comparePair({ defaultCompareTracks: ['e9', 'i23'] }, [])).toEqual([]);
  });
});

describe('landCompareLink', () => {
  it('drops populations the dataset lacks and keeps genes and the sub-tab', () => {
    expect(landCompareLink({ pops: ['e9', 'gone', 'i5'], genes: ['POMC'], mode: 'pathways' }, POPS))
      .toEqual({ pops: ['e9', 'i5'], genes: ['POMC'], mode: 'pathways' });
  });

  it('leaves the populations out when fewer than two are known (the default pair)', () => {
    expect(landCompareLink({ pops: ['e9', 'gone'], genes: ['POMC'] }, POPS)).toEqual({ genes: ['POMC'] });
    expect(landCompareLink(undefined, POPS)).toEqual({});
  });
});

describe('openCompareView and compareLink', () => {
  const pair = ['e9', 'i23'];

  it('fills a link\'s left-out defaults back in', () => {
    expect(openCompareView(undefined, pair)).toEqual({ pops: pair, genes: [], mode: 'genes' });
    expect(openCompareView({ genes: ['POMC'] }, pair)).toEqual({ pops: pair, genes: ['POMC'], mode: 'genes' });
    expect(openCompareView({ pops: ['i5', 'e33'], mode: 'pathways' }, pair))
      .toEqual({ pops: ['i5', 'e33'], genes: [], mode: 'pathways' });
  });

  it('leaves the default pair, no genes and the Genes sub-tab out of the link', () => {
    expect(compareLink({ pops: ['e9', 'i23'], genes: [], mode: 'genes' }, pair)).toEqual({});
    expect(compareLink({ pops: ['i23', 'e9'], genes: ['POMC'], mode: 'pathways' }, pair))
      .toEqual({ pops: ['i23', 'e9'], genes: ['POMC'], mode: 'pathways' });
  });

  it('round-trips: a link opened and written again is the same link', () => {
    for (const link of [{}, { genes: ['POMC', 'AGRP'] }, { pops: ['e33', 'i5', 'e9'], mode: 'pathways' as const }]) {
      expect(compareLink(openCompareView(link, pair), pair)).toEqual(link);
    }
  });

  it('copies, so a caller cannot change the pair through a view', () => {
    const view = openCompareView(undefined, pair);
    view.pops.push('i5');
    expect(pair).toEqual(['e9', 'i23']);
  });
});

describe('sameCompareLink', () => {
  it('compares by value, treating an absent field as its default', () => {
    expect(sameCompareLink({}, { mode: 'genes' })).toBe(true);
    expect(sameCompareLink({ genes: ['POMC'] }, { genes: ['POMC'] })).toBe(true);
    expect(sameCompareLink({ pops: ['e9', 'i23'] }, { pops: ['i23', 'e9'] })).toBe(false);
    expect(sameCompareLink({ genes: ['POMC'] }, {})).toBe(false);
    expect(sameCompareLink({ mode: 'pathways' }, {})).toBe(false);
  });
});
