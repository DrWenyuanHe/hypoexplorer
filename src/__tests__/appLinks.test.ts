import { describe, it, expect } from 'vitest';
import { datasetHref, libraryHref, parseDatasetHash, parseLibraryHash, parseSearchHash, searchHref } from '../utils/appLinks';

// The report's dataset/track links are real URLs, so the href builder and the
// hash parser must round-trip — a link that renders but doesn't resolve on load
// would silently drop the user on the default dataset.
describe('appLinks', () => {
  it('builds a dataset href, with and without a track', () => {
    expect(datasetHref('macaque_snrna')).toBe('#/dataset/macaque_snrna');
    expect(datasetHref('macaque_snrna', 'e9')).toBe('#/dataset/macaque_snrna/e9');
  });

  it('round-trips through the parser', () => {
    expect(parseDatasetHash(datasetHref('mouse_hypo_hfd_gse220533'))).toEqual({
      datasetId: 'mouse_hypo_hfd_gse220533',
    });
    expect(parseDatasetHash(datasetHref('macaque_snrna', 'i23'))).toEqual({
      datasetId: 'macaque_snrna',
      trackId: 'i23',
    });
  });

  it('accepts a hash with no leading # and a trailing slash', () => {
    expect(parseDatasetHash('/dataset/macaque_snrna/')).toEqual({ datasetId: 'macaque_snrna' });
  });

  it('ignores hashes that are not dataset routes', () => {
    for (const h of ['', '#', '#/', '#/gene/POMC', '#section-2', null, undefined]) {
      expect(parseDatasetHash(h)).toBeNull();
    }
  });

  it('decodes percent-escaped segments and survives a malformed one', () => {
    expect(parseDatasetHash('#/dataset/a%20b')).toEqual({ datasetId: 'a b' });
    expect(parseDatasetHash('#/dataset/a%zz')).toEqual({ datasetId: 'a%zz' });
  });
});

// The library is a shareable destination: `#/library` for the browse surface,
// `#/library/<id>` for one study's record.
describe('appLinks — library routes', () => {
  it('builds a library href, with and without a study or a scope', () => {
    expect(libraryHref()).toBe('#/library');
    expect(libraryHref('macaque_snrna')).toBe('#/library/macaque_snrna');
    expect(libraryHref(null, ['Circadian'])).toBe('#/library/in/Circadian');
    expect(libraryHref('macaque_snrna', ['Circadian'])).toBe('#/library/in/Circadian/macaque_snrna');
    // An empty scope is "all categories", which is what no scope means — it must
    // not emit a bare `/in/` segment, which would not parse back.
    expect(libraryHref(null, [])).toBe('#/library');
  });

  it('round-trips every form', () => {
    expect(parseLibraryHash(libraryHref())).toEqual({ datasetId: null, categories: null });
    expect(parseLibraryHash(libraryHref('macaque_snrna')))
      .toEqual({ datasetId: 'macaque_snrna', categories: null });
    expect(parseLibraryHash(libraryHref(null, ['Circadian'])))
      .toEqual({ datasetId: null, categories: ['Circadian'] });
    expect(parseLibraryHash(libraryHref('macaque_snrna', ['Circadian'])))
      .toEqual({ datasetId: 'macaque_snrna', categories: ['Circadian'] });
  });

  it('keeps a category name containing a comma whole', () => {
    // 'Leptin, insulin & energy signaling' carries the very character that
    // separates one category from the next. encodeURIComponent escapes it, which
    // is the only reason a comma-separated list is safe here.
    const scope = ['Leptin, insulin & energy signaling', 'Feeding & fasting'] as const;
    expect(parseLibraryHash(libraryHref(null, scope))).toEqual({ datasetId: null, categories: [...scope] });
  });

  it('drops a category the build no longer knows', () => {
    // A link from an older deploy: keeping the unknown name would narrow the
    // rail to nothing, which reads as an empty corpus rather than a stale link.
    expect(parseLibraryHash('#/library/in/Circadian,Nonesuch'))
      .toEqual({ datasetId: null, categories: ['Circadian'] });
    expect(parseLibraryHash('#/library/in/Nonesuch'))
      .toEqual({ datasetId: null, categories: null });
  });

  it('distinguishes "the bare library route" from "not a library route"', () => {
    // Collapsing these two would make `#/library` unroutable — the router needs
    // to tell "open the library with nothing selected" from "this hash is not mine".
    expect(parseLibraryHash('#/library')).toEqual({ datasetId: null, categories: null });
    expect(parseLibraryHash('#/dataset/macaque_snrna')).toBeNull();
    expect(parseLibraryHash('')).toBeNull();
    expect(parseLibraryHash('#section')).toBeNull();
  });

  it('tolerates a trailing slash and a missing leading hash', () => {
    expect(parseLibraryHash('/library/')).toEqual({ datasetId: null, categories: null });
    expect(parseLibraryHash('#/library/macaque_snrna/'))
      .toEqual({ datasetId: 'macaque_snrna', categories: null });
  });

  it('does not claim the dataset route, and vice versa', () => {
    expect(parseDatasetHash('#/library')).toBeNull();
    expect(parseLibraryHash('#/dataset/x/y')).toBeNull();
  });
});

// The unified search page is the hub box's destination, so its link is the one
// people copy most: `#/search/<q>`, with the breakdown only when it is not "all".
describe('appLinks — search routes', () => {
  it('builds a search href, with and without a filter', () => {
    expect(searchHref('')).toBe('#/search');
    expect(searchHref('insulin')).toBe('#/search/insulin');
    expect(searchHref('insulin', 'gene')).toBe('#/search/insulin/genes');
    expect(searchHref('insulin', 'pathway')).toBe('#/search/insulin/pathways');
  });

  it('round-trips every form', () => {
    expect(parseSearchHash(searchHref(''))).toEqual({ query: '', filter: 'all' });
    expect(parseSearchHash(searchHref('a b/c', 'gene'))).toEqual({ query: 'a b/c', filter: 'gene' });
    expect(parseSearchHash(searchHref('insulin', 'pathway'))).toEqual({ query: 'insulin', filter: 'pathway' });
  });

  it('does not claim other routes, and they do not claim it', () => {
    expect(parseSearchHash('#/gene/POMC')).toBeNull();
    expect(parseSearchHash('#/searchx')).toBeNull();
    expect(parseDatasetHash('#/search/insulin')).toBeNull();
    expect(parseLibraryHash('#/search/insulin')).toBeNull();
  });
});
