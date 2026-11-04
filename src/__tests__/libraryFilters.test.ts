import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTERS, facetCounts, filterCards, groupByCategory, hasActiveFilters,
  matchesLibraryQuery, minNCount, sortCards,
} from '../library/libraryFilters';
import type { DatasetCard } from '../data/datasetCatalog';
import { requireAuthorValidation } from '../data/authorValidation';
import type { Dataset } from '../types';

// The library's filter rail. The facet counts are the subtle part: each option's
// count must be computed against every OTHER filter but not its own, or ticking a
// second value in a facet shows 0 beside it and the rail looks broken.

const MOCK_VALIDATION = {
  ...requireAuthorValidation('mouse_arc_hfd_gse225038'),
  status: 'in_progress' as const,
  verification: { ...requireAuthorValidation('mouse_arc_hfd_gse225038').verification, state: 'in_progress' as const },
  summary: 'Author-source comparison in progress',
};

function card(over: Partial<Dataset> & { id: string }, facts: Partial<DatasetCard> = {}): DatasetCard {
  const dataset = {
    id: over.id,
    name: over.name ?? over.id,
    category: over.category ?? 'Diet-induced obesity',
    organism: over.organism ?? 'Mus musculus',
    modality: over.modality ?? 'bulk RNA-seq',
    region: over.region ?? 'Whole hypothalamus',
    perturbation: over.perturbation ?? 'Diet & obesity',
    preparation: over.preparation ?? 'Bulk tissue',
    featureType: 'gene',
    featureLabel: 'Gene',
    supportsPathways: true,
    citation: over.citation ?? '',
    geo: over.geo,
    trackNoun: 'track',
    groups: over.groups ?? [
      { key: 'control', label: 'Chow', color: '#3775BA' },
      { key: 'case', label: 'HFD', color: '#B64342' },
    ],
  } as unknown as Dataset;
  return {
    dataset,
    validation: MOCK_VALIDATION,
    baselineGroup: dataset.groups[0],
    caseGroup: dataset.groups[1],
    nBaseline: 3, nCase: 3, nVaries: false, lowPowerTracks: 0,
    trackCount: 1, trackLabel: 'Whole hypothalamus', nGenes: 1000,
    discoveries: null,
    ...facts,
  };
}

const CARDS: DatasetCard[] = [
  card({ id: 'a', region: 'Arcuate nucleus', perturbation: 'Genetic', name: 'Arcuate Klf4 KO' }),
  card({ id: 'b', region: 'Arcuate nucleus', perturbation: 'Diet & obesity', name: 'Arcuate HFD', geo: 'GSE225038' }),
  card({ id: 'c', region: 'Whole hypothalamus', perturbation: 'Genetic', name: 'Hypothalamus ob/ob' }),
  card({ id: 'd', region: 'Preoptic area', perturbation: 'Drug & hormone', name: 'POA DHT' }, { nBaseline: 10, nCase: 10 }),
  card({ id: 'e', region: 'Whole hypothalamus', perturbation: 'Diet & obesity', name: 'Unmeasured' },
    { nBaseline: null, nCase: null, trackCount: null }),
];

const withFilters = (over: Partial<typeof EMPTY_FILTERS>) => ({ ...EMPTY_FILTERS, ...over });

describe('matchesLibraryQuery', () => {
  it('matches on the study name', () => {
    expect(matchesLibraryQuery(CARDS[0], 'klf4')).toBe(true);
    expect(matchesLibraryQuery(CARDS[0], 'zzz')).toBe(false);
  });

  it('matches on an accession pasted verbatim', () => {
    expect(matchesLibraryQuery(CARDS[1], 'GSE225038')).toBe(true);
  });

  it('matches on arm labels, which is how a user searches for a design', () => {
    // "HFD" appears in no study name here; it is only an arm label.
    expect(matchesLibraryQuery(CARDS[2], 'chow')).toBe(true);
  });

  it('matches validation language', () => {
    expect(matchesLibraryQuery(CARDS[0], 'verification in progress')).toBe(true);
  });

  it('treats an empty query as matching everything', () => {
    expect(CARDS.every((c) => matchesLibraryQuery(c, '   '))).toBe(true);
  });
});

describe('filterCards', () => {
  it('intersects across facets and unions within one', () => {
    expect(filterCards(CARDS, withFilters({ region: ['Arcuate nucleus'] })).map((c) => c.dataset.id))
      .toEqual(['a', 'b']);
    // Two values in the SAME facet widen; a second facet narrows.
    expect(filterCards(CARDS, withFilters({ region: ['Arcuate nucleus', 'Preoptic area'] })).length).toBe(3);
    expect(filterCards(CARDS, withFilters({ region: ['Arcuate nucleus'], perturbation: ['Genetic'] }))
      .map((c) => c.dataset.id)).toEqual(['a']);
  });

  it('excludes unmeasured cards from the N floor rather than assuming they pass', () => {
    const kept = filterCards(CARDS, withFilters({ minN: 4 })).map((c) => c.dataset.id);
    expect(kept).toEqual(['d']);
    // 'e' has no measured N — unknown is not evidence of adequacy.
    expect(kept).not.toContain('e');
  });

  it('filters by scientific verification state', () => {
    const reviewed = card(
      { id: 'reviewed', name: 'Review case' },
      { validation: { ...CARDS[0].validation, datasetId: 'reviewed', status: 'review_required', verification: { ...CARDS[0].validation.verification, state: 'unresolved' } } },
    );
    expect(filterCards([...CARDS, reviewed], withFilters({ validation: ['unresolved'] })))
      .toEqual([reviewed]);
  });
  it('separates evidence claims inside the legacy partial group and preserves its saved filter', () => {
    const evidenceCards = (['source_only', 'reconstructed', 'author_results', 'none'] as const).map((evidenceLevel) => card(
      { id: evidenceLevel }, { validation: { ...MOCK_VALIDATION,
        verification: { ...MOCK_VALIDATION.verification, state: 'partial', evidenceLevel } } },
    ));
    expect(filterCards(evidenceCards, withFilters({ validation: ['source_only'] }))).toEqual([evidenceCards[0]]);
    expect(filterCards(evidenceCards, withFilters({ validation: ['author_results'] }))).toEqual([evidenceCards[2]]);
    expect(filterCards(evidenceCards, withFilters({ validation: ['no_evidence'] }))).toEqual([evidenceCards[3]]);
    expect(filterCards(evidenceCards, withFilters({ validation: ['partial'] }))).toEqual(evidenceCards);
    expect(facetCounts(evidenceCards, withFilters({}), 'validation'))
      .toEqual({ source_only: 1, reconstructed: 1, author_results: 1, no_evidence: 1 });
    expect(matchesLibraryQuery(evidenceCards[0], 'Author results untested')).toBe(true);
    expect(matchesLibraryQuery(evidenceCards[2], 'Author results compared, limits remain')).toBe(true);
  });

  it('keeps unresolved comparisons out of positive evidence-claim filters', () => {
    const unresolved = card({ id: 'unresolved-direct' }, { validation: { ...MOCK_VALIDATION,
      verification: { ...MOCK_VALIDATION.verification, state: 'unresolved', evidenceLevel: 'author_results' } } });
    expect(filterCards([unresolved], withFilters({ validation: ['author_results'] }))).toEqual([]);
    expect(filterCards([unresolved], withFilters({ validation: ['unresolved'] }))).toEqual([unresolved]);
  });
  it('filters missing reference evidence independently from scientific decision', () => {
    const available = card({ id: 'available' }, { validation: { ...MOCK_VALIDATION,
      verification: { ...MOCK_VALIDATION.verification, resultAvailability: 'available' } } });
    expect(filterCards([...CARDS, available], withFilters({ availability: ['available'] }))).toEqual([available]);
    expect(facetCounts([...CARDS, available], withFilters({ availability: ['available'] }), 'availability'))
      .toEqual({ not_located: 5, available: 1 });
  });
});

describe('facetCounts', () => {
  it('counts a facet against the OTHER filters, not its own selection', () => {
    const f = withFilters({ region: ['Arcuate nucleus'] });
    const counts = facetCounts(CARDS, f, 'region');
    // Own facet ignored, so every region still reports its unconstrained count —
    // which is what makes ticking a second region look like it will widen.
    expect(counts['Arcuate nucleus']).toBe(2);
    expect(counts['Whole hypothalamus']).toBe(2);
    expect(counts['Preoptic area']).toBe(1);
  });

  it('narrows a facet when a DIFFERENT facet is active', () => {
    const counts = facetCounts(CARDS, withFilters({ perturbation: ['Genetic'] }), 'region');
    expect(counts['Arcuate nucleus']).toBe(1);
    expect(counts['Whole hypothalamus']).toBe(1);
    expect(counts['Preoptic area']).toBeUndefined();
  });

  it('respects the search box', () => {
    const counts = facetCounts(CARDS, withFilters({ q: 'arcuate' }), 'perturbation');
    expect(counts.Genetic).toBe(1);
    expect(counts['Diet & obesity']).toBe(1);
  });
});

describe('minNCount', () => {
  it('counts only cards with a measured N at or above the floor', () => {
    expect(minNCount(CARDS, EMPTY_FILTERS, 4)).toBe(1);
    expect(minNCount(CARDS, EMPTY_FILTERS, 3)).toBe(4);
  });
});

describe('sortCards by discoveries', () => {
  const withGenes = (id: string, genes: number | 'unmeasured') => card({ id }, {
    discoveries: genes === 'unmeasured' ? null : {
      genes, genesUp: genes, genesDown: 0, genesTested: 10000,
      paths: 0, pathsUp: 0, pathsDown: 0, pathsTested: 100, pathsByDb: {}, tracksWithGenes: genes > 0 ? 1 : 0,
    },
  });

  it('ranks studies by what they found', () => {
    const out = sortCards([withGenes('a', 3), withGenes('b', 900), withGenes('c', 40)], 'discoveries');
    expect(out.map((c) => c.dataset.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts an unmeasured study below one measured at zero', () => {
    // Zero is a finding and belongs above a count this build cannot know.
    const out = sortCards([withGenes('unknown', 'unmeasured'), withGenes('none', 0)], 'discoveries');
    expect(out.map((c) => c.dataset.id)).toEqual(['none', 'unknown']);
  });
});

describe('sortCards', () => {
  it('sorts by weakest arm, putting unmeasured last rather than first', () => {
    const ids = sortCards(CARDS, 'replicates').map((c) => c.dataset.id);
    expect(ids[0]).toBe('d');
    expect(ids[ids.length - 1]).toBe('e');
  });

  it('sorts by track count with unmeasured last', () => {
    expect(sortCards(CARDS, 'tracks').map((c) => c.dataset.id).at(-1)).toBe('e');
  });

  it('sorts by name', () => {
    expect(sortCards(CARDS, 'name').map((c) => c.dataset.name)[0]).toBe('Arcuate HFD');
  });
});

describe('groupByCategory', () => {
  it('drops empty categories and keeps the registry order', () => {
    const groups = groupByCategory(CARDS);
    expect(groups.length).toBe(1);
    expect(groups[0].category).toBe('Diet-induced obesity');
    expect(groups[0].cards.length).toBe(5);
  });
});

describe('hasActiveFilters', () => {
  it('is false for the empty state and true for any one filter', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters(withFilters({ q: '  ' }))).toBe(false);
    expect(hasActiveFilters(withFilters({ q: 'pomc' }))).toBe(true);
    expect(hasActiveFilters(withFilters({ minN: 4 }))).toBe(true);
    expect(hasActiveFilters(withFilters({ preparation: ['Bulk tissue'] }))).toBe(true);
    expect(hasActiveFilters(withFilters({ validation: ['processed_source_match'] }))).toBe(true);
  });
});
