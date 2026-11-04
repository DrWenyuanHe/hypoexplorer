import { describe, it, expect } from 'vitest';
import { type AppRoute, parseRoute, routeHref } from '../utils/appLinks';

// The router writes the URL with `routeHref` and reads it back with
// `parseRoute`, so the two must be exact inverses. If they disagree for any
// route, the write effect rewrites the URL it just wrote on the very next
// render — a loop that no single-direction test would catch.
//
// One case per view, plus the inputs that actually break naive encodings: a
// pathway name with spaces and a slash, and a category name containing the comma
// that separates a multi-category scope.
const ROUTES: AppRoute[] = [
  { view: 'hub' },
  { view: 'library', datasetId: null, categories: null },
  { view: 'library', datasetId: 'macaque_snrna', categories: null },
  { view: 'library', datasetId: null, categories: ['Circadian'] },
  // The scope segment sits BEFORE the dataset id, so this is the case that
  // proves the two cannot be read as each other.
  { view: 'library', datasetId: 'macaque_snrna', categories: ['Circadian'] },
  { view: 'library', datasetId: null, categories: ['Leptin, insulin & energy signaling', 'Feeding & fasting'] },
  { view: 'explorer', datasetId: 'macaque_snrna' },
  { view: 'explorer', datasetId: 'macaque_snrna', trackId: 'e9' },
  { view: 'explorer', datasetId: 'macaque_snrna', trackId: 'e9', tab: 'pathway' },
  { view: 'report', gene: 'POMC', scope: null },
  { view: 'report', gene: 'POMC', scope: ['Diet-induced obesity'] },
  { view: 'report', gene: 'POMC', scope: ['Leptin, insulin & energy signaling', 'Circadian'] },
  // The explorers' LANDING states — the search interface, nothing searched yet.
  { view: 'report', gene: null, scope: null },
  // A scoped landing cannot use the positional scope segment (`#/gene/Circadian`
  // reads back as a gene called "Circadian"), so it borrows the library's `in`
  // marker. This is the case that proves the two forms stay distinct.
  { view: 'report', gene: null, scope: ['Circadian'] },
  { view: 'report', gene: null, scope: ['Leptin, insulin & energy signaling', 'Circadian'] },
  // ...and the gene that collides with that marker head-on. No real symbol is
  // named 'in', but the codec is total or it is not.
  { view: 'report', gene: 'in', scope: ['Circadian'] },
  { view: 'report', gene: 'in', scope: null },
  { view: 'compare-datasets', gene: 'LEPR', scope: null },
  { view: 'compare-datasets', gene: 'LEPR', scope: ['Primate atlas'] },
  // The compare set: whole studies (no track), two populations of one study,
  // a single column, and ids carrying the two separator characters — the codec
  // is pure, so a track it is handed stays in the URL even when it is the
  // dataset's default (leaving it out is the router's job).
  { view: 'compare-set', items: [{ datasetId: 'macaque_snrna' }, { datasetId: 'mouse_hypo_hfd_gse220533' }] },
  { view: 'compare-set', items: [{ datasetId: 'macaque_snrna', trackId: 'i23' }, { datasetId: 'macaque_snrna', trackId: 'e9' }] },
  { view: 'compare-set', items: [{ datasetId: 'macaque_snrna', trackId: 'e9' }] },
  { view: 'compare-set', items: [{ datasetId: 'a,b', trackId: 'c:d' }, { datasetId: 'e:f' }] },
  { view: 'pathway-report', pathway: null },
  { view: 'pathway-report', pathway: 'HALLMARK_ADIPOGENESIS' },
  { view: 'pathway-report', pathway: 'Signaling by GPCR / second messengers' },
  { view: 'tracker', acc: null },
  { view: 'tracker', acc: 'GSE220533' },
  { view: 'statistics' },
  { view: 'nomenclature' },
  // The unified search: its empty state, both filters, and queries carrying
  // every character a naive path segment would split or truncate on.
  { view: 'search', query: '', filter: 'all' },
  { view: 'search', query: 'insulin', filter: 'all' },
  { view: 'search', query: 'insulin', filter: 'gene' },
  { view: 'search', query: 'insulin', filter: 'pathway' },
  { view: 'search', query: 'Insulin Secretion', filter: 'all' },
  { view: 'search', query: 'Signaling by GPCR / second messengers', filter: 'pathway' },
  { view: 'search', query: '100% match', filter: 'gene' },
  { view: 'search', query: 'what? #1', filter: 'all' },
  { view: 'search', query: 'Ménière ß-catenin 胰岛素', filter: 'all' },
  // Literal filter words as queries stay queries.
  { view: 'search', query: 'genes', filter: 'all' },
  { view: 'search', query: 'pathways', filter: 'pathway' },
];

describe('appRoutes — the codec round-trips', () => {
  for (const route of ROUTES) {
    it(`round-trips ${routeHref(route)}`, () => {
      expect(parseRoute(routeHref(route))).toEqual(route);
    });
  }

  it('keeps a comma-bearing category name whole inside a multi-category scope', () => {
    // 'Leptin, insulin & energy signaling' contains the separator. Encoding each
    // name before joining is what stops it splitting into two unknown halves —
    // which would silently degrade the report's scope to "all categories".
    const href = routeHref({
      view: 'report',
      gene: 'INSR',
      scope: ['Leptin, insulin & energy signaling', 'Feeding & fasting'],
    });
    expect(href).not.toContain('insulin & energy');
    expect(parseRoute(href)).toEqual({
      view: 'report',
      gene: 'INSR',
      scope: ['Leptin, insulin & energy signaling', 'Feeding & fasting'],
    });
  });

  it('drops category names it does not recognize, degrading to "all categories"', () => {
    // A scope from an older deploy selects the report's sections. Carrying an
    // unknown name through would narrow the report to nothing; null is what an
    // unscoped link already means.
    expect(parseRoute('#/gene/POMC/Retired%20category')).toEqual({
      view: 'report', gene: 'POMC', scope: null,
    });
    expect(parseRoute('#/gene/POMC/Circadian,Retired%20category')).toEqual({
      view: 'report', gene: 'POMC', scope: ['Circadian'],
    });
  });
});

describe('appRoutes — reading untrusted hashes', () => {
  it('treats the bare site root as the hub', () => {
    // Back out of the first deep link lands here, so it has to be a route and
    // not "no route" — otherwise Back would leave the user on the old view.
    for (const h of ['', '#', '#/', '/', null, undefined]) {
      expect(parseRoute(h)).toEqual({ view: 'hub' });
    }
  });

  it('returns null for a hash it does not recognize, rather than the hub', () => {
    // Silently yanking someone home because a link had a typo — or because the
    // page used an in-page anchor — is worse than ignoring it.
    // '#/gene' and '#/pathway' are deliberately ABSENT from this list: both
    // now name the explorer's landing state. '#/dataset' stays, because a
    // dataset route without a dataset names nothing.
    // '#/compare-set' with no columns names nothing either: a side-by-side of
    // zero studies is not a view.
    for (const h of ['#section-2', '#/nope/POMC', '#/dataset', '#/compare-set', '#/compare-set/,']) {
      expect(parseRoute(h)).toBeNull();
    }
  });

  it('keeps a compare-set link apart from the one-gene compare', () => {
    // `#/compare/<gene>` and `#/compare-set/<ids>` share a prefix. The gene
    // pattern needs a '/' straight after "compare", so it cannot swallow the
    // set — but the set is parsed first regardless, so nothing rests on that.
    expect(parseRoute('#/compare-set/macaque_snrna,mouse_hypo_hfd_gse220533')).toEqual({
      view: 'compare-set',
      items: [{ datasetId: 'macaque_snrna' }, { datasetId: 'mouse_hypo_hfd_gse220533' }],
    });
    expect(parseRoute('#/compare/POMC')?.view).toBe('compare-datasets');
    // Encoded separators inside an id survive the split.
    expect(parseRoute('#/compare-set/a%2Cb:c%3Ad')).toEqual({
      view: 'compare-set', items: [{ datasetId: 'a,b', trackId: 'c:d' }],
    });
  });

  it('parses the explorer tab segment, and tolerates a missing # or a trailing /', () => {
    expect(parseRoute('#/dataset/macaque_snrna/e9/qc')).toEqual({
      view: 'explorer', datasetId: 'macaque_snrna', trackId: 'e9', tab: 'qc',
    });
    expect(parseRoute('/dataset/macaque_snrna/e9/')).toEqual({
      view: 'explorer', datasetId: 'macaque_snrna', trackId: 'e9',
    });
  });

  it('does not let one view claim another view\'s hash', () => {
    expect(parseRoute('#/gene/POMC')?.view).toBe('report');
    expect(parseRoute('#/compare/POMC')?.view).toBe('compare-datasets');
    expect(parseRoute('#/compare-set/macaque_snrna')?.view).toBe('compare-set');
    expect(parseRoute('#/pathway/POMC')?.view).toBe('pathway-report');
    // The term-less landings resolve to the same views, with a null term.
    expect(parseRoute('#/gene')).toEqual({ view: 'report', gene: null, scope: null });
    expect(parseRoute('#/pathway')).toEqual({ view: 'pathway-report', pathway: null });
    expect(parseRoute('#/library/macaque_snrna')?.view).toBe('library');
    expect(parseRoute('#/dataset/macaque_snrna')?.view).toBe('explorer');
    expect(parseRoute('#/tracker/GSE1')?.view).toBe('tracker');
    expect(parseRoute('#/statistics')?.view).toBe('statistics');
    expect(parseRoute('#/nomenclature')?.view).toBe('nomenclature');
    expect(parseRoute('#/search')?.view).toBe('search');
    expect(parseRoute('#/search/gene')?.view).toBe('search');
    expect(parseRoute('#/search/pathway/genes')?.view).toBe('search');
    // ...and no search-shaped prefix leaks into the other routes.
    expect(parseRoute('#/searching')).toBeNull();
    expect(parseRoute('#/gene/search')).toEqual({ view: 'report', gene: 'search', scope: null });
    expect(parseRoute('#/pathway/search')).toEqual({ view: 'pathway-report', pathway: 'search' });
  });
});

describe('appRoutes — the unified search address', () => {
  it('writes the filter as a segment only when it is not "all"', () => {
    expect(routeHref({ view: 'search', query: '', filter: 'all' })).toBe('#/search');
    expect(routeHref({ view: 'search', query: 'insulin', filter: 'all' })).toBe('#/search/insulin');
    expect(routeHref({ view: 'search', query: 'insulin', filter: 'gene' })).toBe('#/search/insulin/genes');
    expect(routeHref({ view: 'search', query: 'insulin', filter: 'pathway' })).toBe('#/search/insulin/pathways');
  });

  it('keeps the query in one segment, whatever it contains', () => {
    const href = routeHref({ view: 'search', query: 'a/b?c#d%e', filter: 'gene' });
    expect(href).toBe('#/search/a%2Fb%3Fc%23d%25e/genes');
  });

  it('trims the query and gives an empty one the bare address, whatever the filter', () => {
    expect(routeHref({ view: 'search', query: '  POMC  ', filter: 'all' })).toBe('#/search/POMC');
    expect(routeHref({ view: 'search', query: '   ', filter: 'gene' })).toBe('#/search');
    expect(parseRoute('#/search/%20POMC%20')).toEqual({ view: 'search', query: 'POMC', filter: 'all' });
    expect(parseRoute('#/search/%20%20/genes')).toEqual({ view: 'search', query: '', filter: 'all' });
  });

  it('keeps case as typed and tolerates a missing # or a trailing /', () => {
    expect(parseRoute('#/search/Pomc')).toEqual({ view: 'search', query: 'Pomc', filter: 'all' });
    expect(parseRoute('/search/insulin/pathways/')).toEqual({ view: 'search', query: 'insulin', filter: 'pathway' });
    expect(parseRoute('#/search/')).toEqual({ view: 'search', query: '', filter: 'all' });
  });

  it('rejects junk rather than guessing', () => {
    for (const h of [
      '#/search/insulin/all',      // 'all' has no segment
      '#/search/insulin/gene',     // the segment is plural
      '#/search/insulin/genes/x',  // nothing follows the filter
      '#/search/%zz',              // malformed escape
      '#/search/%E0%A4%A',         // truncated escape
      '#/search//genes',           // an empty query has no filter segment
      '#/search/insulin?analysis=%7B%7D', // search carries no saved analysis
    ]) {
      expect(parseRoute(h)).toBeNull();
    }
  });
});
