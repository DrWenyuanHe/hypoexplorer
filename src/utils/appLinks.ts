// The URL codec: every place the app can be, written as a hash route and read
// back again.
//
// This started as href builders for two links. The hash was READ on mount and on
// `hashchange` but never written, so the address bar said `hypoexplorer.com` no
// matter which of the eight views — or which of the ~30 datasets — you were
// looking at. Nothing on screen was addressable: no copying the URL for a
// colleague, no bookmark, no Back button, and a reload dropped you on the hub.
//
// So the codec is now total: `routeHref` and `parseRoute` cover every view, and
// `useAppRouter` runs them in both directions. Two rules keep that honest:
//
//   * PURE CODEC, NO REGISTRY VALIDATION. A hash is untrusted input — hand-typed, stale,
//     or from an older deploy — but this module does not know what a real
//     dataset, track or tab is. It reports what the URL SAYS; the router decides
//     what to do about a route naming something that no longer exists. Versioned
//     analysis payloads are structurally validated here before reaching state.
//   * ROUND-TRIPS. `parseRoute(routeHref(r))` must return `r`, because the router
//     writes with one and reads with the other; if they disagree it rewrites the
//     URL it just wrote, forever. The encoding rules below are what make that
//     true for real inputs — pathway names carry spaces and slashes, and one
//     category name ('Leptin, insulin & energy signaling') contains the very
//     comma that separates a multi-category scope.
//
// WHY HASH ROUTES AND NOT CLEAN PATHS. `/dataset/macaque_snrna` would be
// prettier, but it only works if the origin rewrites unknown paths to
// index.html. The Hostinger origin's .htaccess has no such fallback (it is a
// compression + cache policy), and every deep link the app already emits is a
// `#/...` href. A hash route needs no server cooperation at all: the same static
// index.html answers every URL, and the Cloudflare edge in front never even sees
// the fragment. Moving to clean paths later is an .htaccess rewrite plus a change
// to this file, and nothing else.
//
// Plain left-clicks on these hrefs are intercepted and handled in place (no
// reload); modified clicks fall through to the browser, so "open in new tab"
// works on them exactly as on any other link.

import type { MouseEvent } from 'react';
import { DATASET_CATEGORIES, type DatasetCategory } from '../data/datasetCategories';
import { parseExplorerAnalysis, parseStudyAnalysis, type ExplorerAnalysisState, type StudyAnalysisState } from './analysisState';
import type { SearchFilter } from '../search/searchTypes';

export interface DatasetRoute {
  datasetId: string;
  /** Track to select within the dataset; absent → the dataset's default track. */
  trackId?: string;
  /** Track-level tab ('gene', 'pathway', …); absent → the Gene Explorer. */
  tab?: string;
}

/**
 * The deep link for a dataset, optionally at one of its tracks and tabs.
 *
 * The segments are POSITIONAL, so a tab is only expressible behind a track —
 * `#/dataset/<id>/<track>/<tab>`. A caller wanting a specific tab on the default
 * track therefore has to name that track; the router does exactly that when it
 * serializes the explorer's position.
 */
export function datasetHref(datasetId: string, trackId?: string, tab?: string): string {
  const base = `#/dataset/${encodeURIComponent(datasetId)}`;
  if (!trackId) return base;
  const withTrack = `${base}/${encodeURIComponent(trackId)}`;
  return tab ? `${withTrack}/${encodeURIComponent(tab)}` : withTrack;
}

function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    // A malformed escape (e.g. a hand-typed "%zz") decodes to nothing useful —
    // fall back to the raw segment rather than throwing on a bad URL.
    return part;
  }
}

/**
 * Parse a location hash into a dataset route, or null when it isn't one (the
 * empty hash, an in-page anchor, an unknown route). Accepts the hash with or
 * without its leading '#' and tolerates a trailing slash.
 */
export function parseDatasetHash(hash: string | undefined | null): DatasetRoute | null {
  if (!hash) return null;
  const m = /^#?\/dataset\/([^/?#]+)(?:\/([^/?#]+))?(?:\/([^/?#]+))?\/?$/.exec(hash.trim());
  if (!m) return null;
  const datasetId = safeDecode(m[1]);
  if (!datasetId) return null;
  const trackId = m[2] ? safeDecode(m[2]) : undefined;
  const tab = m[3] ? safeDecode(m[3]) : undefined;
  if (!trackId) return { datasetId };
  return tab ? { datasetId, trackId, tab } : { datasetId, trackId };
}

// ── Compare set ─────────────────────────────────────────────────────────────

/** One column of a compare-set link: a dataset, at one of its tracks. */
export interface CompareSetRouteItem {
  datasetId: string;
  /** Absent → the dataset's default track. The router fills it in; the codec
   *  only carries what the URL says. */
  trackId?: string;
}

/**
 * The deep link for a compare set: `#/compare-set/<ds>[:<track>],<ds>[:<track>]`.
 *
 * Every id is percent-encoded BEFORE the separators go in. encodeURIComponent
 * escapes both ':' and ',' (to %3A and %2C), so neither separator can appear
 * inside an id on the way back — the same trick the category scope plays with
 * its comma, and what makes the split below unambiguous.
 */
export function compareSetHref(items: readonly CompareSetRouteItem[]): string {
  const segments = items.map((item) => (
    item.trackId
      ? `${encodeURIComponent(item.datasetId)}:${encodeURIComponent(item.trackId)}`
      : encodeURIComponent(item.datasetId)
  ));
  return `#/compare-set/${segments.join(',')}`;
}

/**
 * Parse a compare-set hash, or null when the hash is not one — including the
 * bare `#/compare-set`, since a comparison of nothing is not a view.
 *
 * Returns items WITHOUT a `trackId` key when the URL named none, so a parsed
 * route equals the route that produced it (the round-trip test compares with
 * toEqual, which treats an explicit `undefined` as a difference).
 */
export function parseCompareSetHash(hash: string | undefined | null): CompareSetRouteItem[] | null {
  if (!hash) return null;
  const m = /^#?\/compare-set\/([^/?#]+)\/?$/.exec(hash.trim());
  if (!m) return null;
  const items: CompareSetRouteItem[] = [];
  for (const segment of m[1].split(',')) {
    const [rawDataset, rawTrack] = segment.split(':');
    const datasetId = safeDecode(rawDataset ?? '');
    if (!datasetId) continue;
    const trackId = rawTrack ? safeDecode(rawTrack) : '';
    items.push(trackId ? { datasetId, trackId } : { datasetId });
  }
  return items.length ? items : null;
}

/**
 * The deep link for the dataset library — optionally scoped to a set of
 * categories, and optionally with one study's record open.
 *
 * The scope sits behind an `in` segment (`#/library/in/<cat>,<cat>`) so it can
 * never be read as the dataset id that may follow it. Only the CATEGORY facet is
 * in the URL, because category is the axis the app navigates BY — the hub links
 * to it and the reports section on it. Region,
 * perturbation, preparation, the search box and the N floor are refinements a
 * user makes once they have arrived; naming them here would turn every checkbox
 * into a history entry.
 */
export function libraryHref(
  datasetId?: string | null,
  categories?: readonly DatasetCategory[] | null,
): string {
  const scope = categories?.length ? `/in/${categories.map(encodeURIComponent).join(',')}` : '';
  const record = datasetId ? `/${encodeURIComponent(datasetId)}` : '';
  return `#/library${scope}${record}`;
}

/**
 * Parse a location hash into a library route.
 *
 * Returns `{ datasetId: null }` for the bare `#/library` — distinct from `null`,
 * which means "this hash is not a library route at all". Collapsing the two
 * would make `#/library` unroutable.
 */
export function parseLibraryHash(
  hash: string | undefined | null,
): { datasetId: string | null; categories: DatasetCategory[] | null } | null {
  if (!hash) return null;
  const m = /^#?\/library(?:\/in\/([^/?#]+))?(?:\/([^/?#]+))?\/?$/.exec(hash.trim());
  if (!m) return null;
  return {
    // Same drop-the-unknown rule a report's scope uses: a category name from an
    // older deploy would narrow the rail to nothing, which reads as an empty
    // corpus rather than as a stale link.
    categories: parseScope(m[1]),
    datasetId: m[2] ? safeDecode(m[2]) || null : null,
  };
}

// ── Unified search ──────────────────────────────────────────────────────────

// The filter as a URL segment. 'all' is the default and has no segment, so the
// plain `#/search/<q>` link is the one people share.
const SEARCH_FILTER_SEGMENT: Record<Exclude<SearchFilter, 'all'>, string> = { gene: 'genes', pathway: 'pathways' };

/**
 * The deep link for the unified search results page:
 * `#/search`, `#/search/<q>`, or `#/search/<q>/genes|pathways`.
 *
 * The query is ONE percent-encoded segment, so spaces, slashes, '%', '?' and '#'
 * all survive (encodeURIComponent escapes every one of them). It is trimmed, and
 * case is kept as typed: matching is the results page's business, not the URL's.
 * An empty query has nothing to filter, so it is always the bare `#/search` —
 * a filter segment needs a query segment to sit behind.
 */
export function searchHref(query: string, filter: SearchFilter = 'all'): string {
  const q = query.trim();
  if (!q) return '#/search';
  const base = `#/search/${encodeURIComponent(q)}`;
  return filter === 'all' ? base : `${base}/${SEARCH_FILTER_SEGMENT[filter]}`;
}

/**
 * Parse a search hash, or null when the hash is not one — including a malformed
 * escape in the query (a hand-typed "%zz") and an unknown filter segment. Both
 * are junk, and junk is "leave the user where they are", as for every route.
 */
export function parseSearchHash(hash: string | undefined | null): { query: string; filter: SearchFilter } | null {
  if (!hash) return null;
  const m = /^#?\/search(?:\/([^/?#]+)(?:\/([^/?#]+))?)?\/?$/.exec(hash.trim());
  if (!m) return null;
  let query = '';
  if (m[1]) {
    try {
      query = decodeURIComponent(m[1]).trim();
    } catch {
      return null;
    }
  }
  let filter: SearchFilter = 'all';
  if (m[2]) {
    const named = (Object.keys(SEARCH_FILTER_SEGMENT) as Array<keyof typeof SEARCH_FILTER_SEGMENT>)
      .find((key) => SEARCH_FILTER_SEGMENT[key] === m[2]);
    if (!named) return null;
    filter = named;
  }
  // Same rule as the writer: no query, nothing to filter.
  return { query, filter: query ? filter : 'all' };
}

// ── The full route union ────────────────────────────────────────────────────

/**
 * Everywhere the app can be, as data.
 *
 * The `view` strings match `AppView` in appRouter structurally rather than by
 * import: the router imports this module, so importing its type back would be a
 * cycle. `setView(route.view)` is where the two meet, and drift between them is
 * a type error there.
 */
export type AppRoute =
  | { view: 'hub' }
  | { view: 'library'; datasetId: string | null; categories: DatasetCategory[] | null }
  | { view: 'explorer'; datasetId: string; trackId?: string; tab?: string; analysis?: ExplorerAnalysisState }
  // A null gene/pathway is the explorer's LANDING state — the search interface
  // with nothing searched yet, which is where the hub's "Gene Explorer" and
  // "Pathway Explorer" cards now lead. `null` rather than '' on purpose: '' is a
  // string, so every site that forgot to handle the term-less case would compile
  // silently and emit `#/gene/` (encodeURIComponent('') === ''). `| null` turns
  // each of them into a tsc error instead.
  //
  // `compare-datasets` is deliberately NOT widened: a side-by-side comparison of
  // nothing is not a view, and keeping it `string` is what lets the router's
  // compare arm stay type-correct behind its existing guard.
  | { view: 'report'; gene: string | null; scope: DatasetCategory[] | null; analysis?: StudyAnalysisState }
  | { view: 'pathway-report'; pathway: string | null; analysis?: StudyAnalysisState }
  | { view: 'compare-datasets'; gene: string; scope: DatasetCategory[] | null; analysis?: StudyAnalysisState }
  // The compare set names its columns, never nothing: an empty list is not a
  // route, so `parseCompareSetHash` returns null for it and the router lands
  // on the library when a link's ids have all gone stale.
  | { view: 'compare-set'; items: CompareSetRouteItem[] }
  | { view: 'tracker'; acc: string | null }
  | { view: 'statistics' }
  | { view: 'methodology' }
  | { view: 'verification' }
  | { view: 'nomenclature' }
  | { view: 'expression' }
  | { view: 'local-datasets' }
  // The unified gene + pathway results page. '' is its empty state, not null:
  // unlike the report landings, an empty query has exactly one address
  // (`#/search`), which `searchHref` always emits for it, so there is no
  // `#/search/` for a forgetful call site to produce.
  | { view: 'search'; query: string; filter: SearchFilter };

// A report's category scope is a LIST inside one URL segment. Each name is
// percent-encoded before joining, which is what makes ',' safe as the separator:
// encodeURIComponent escapes a comma to %2C, so the one category name that
// contains one cannot split itself in half on the way back.
function scopeSegment(scope: DatasetCategory[] | null | undefined): string {
  if (!scope?.length) return '';
  return `/${scope.map(encodeURIComponent).join(',')}`;
}

/**
 * A gene as a URL segment, kept clear of the `in` marker.
 *
 * `#/gene/in/<cats>` is the term-less scoped landing, so a gene symbol of
 * exactly "in" would round-trip into a landing page instead of itself. No real
 * symbol is named that — but the search box will hand over whatever was typed,
 * and the round-trip invariant at the top of this file is stated for every route
 * the router can hold, not merely for the plausible ones. Percent-escaping the
 * first character makes the marker unmatchable; `safeDecode` undoes it on the
 * way back in, so the gene survives intact.
 */
function geneSegment(gene: string): string {
  const encoded = encodeURIComponent(gene);
  if (encoded !== 'in') return encoded;
  return `%${gene.charCodeAt(0).toString(16)}${encoded.slice(1)}`;
}

// Unknown category names are dropped rather than carried through: scope selects
// the report's sections, so a stale name from an older deploy would silently
// narrow the report to nothing. An all-unknown scope
// degrades to null — "all categories" — which is what an unscoped link means.
function parseScope(segment: string | undefined): DatasetCategory[] | null {
  if (!segment) return null;
  const known = segment
    .split(',')
    .map(safeDecode)
    .filter((name): name is DatasetCategory => (DATASET_CATEGORIES as readonly string[]).includes(name));
  return known.length ? known : null;
}

/** The hash for a route. The inverse of `parseRoute`. */
export function routeHref(route: AppRoute): string {
  if ('analysis' in route && route.analysis) {
    const { analysis, ...position } = route;
    return `${routeHref(position)}?analysis=${encodeURIComponent(JSON.stringify(analysis))}`;
  }
  switch (route.view) {
    case 'hub':
      return '#/';
    case 'library':
      return libraryHref(route.datasetId, route.categories);
    case 'explorer':
      return datasetHref(route.datasetId, route.trackId, route.tab);
    case 'report':
      // The scope segment is POSITIONAL, so it cannot simply follow `#/gene`
      // with the gene left out: `#/gene/Circadian` reads back as a gene named
      // "Circadian". A scoped landing therefore borrows the library's `in`
      // disambiguator, which no gene symbol can collide with.
      if (!route.gene) return route.scope?.length ? `#/gene/in/${route.scope.map(encodeURIComponent).join(',')}` : '#/gene';
      return `#/gene/${geneSegment(route.gene)}${scopeSegment(route.scope)}`;
    case 'compare-datasets':
      return `#/compare/${encodeURIComponent(route.gene)}${scopeSegment(route.scope)}`;
    case 'compare-set':
      return compareSetHref(route.items);
    case 'pathway-report':
      // Study scope lives in the versioned analysis payload when present.
      return route.pathway ? `#/pathway/${encodeURIComponent(route.pathway)}` : '#/pathway';
    case 'tracker':
      return route.acc ? `#/tracker/${encodeURIComponent(route.acc)}` : '#/tracker';
    case 'statistics':
      return '#/statistics';
    case 'methodology':
      return '#/methodology';
    case 'verification':
      return '#/verification';
    case 'nomenclature':
      return '#/nomenclature';
    case 'local-datasets':
      return '#/local-datasets';
    case 'expression':
      return '#/expression';
    case 'search':
      return searchHref(route.query, route.filter);
  }
}

/**
 * Parse a location hash into a route, or null when the hash names no route the
 * app knows.
 *
 * `null` means "leave the user where they are" — an in-page anchor, a hash from
 * a future deploy, junk someone typed. Deliberately NOT the hub: yanking someone
 * home because a link had a typo is worse than ignoring the typo.
 *
 * The empty hash IS the hub, though. It is the bare site root, and it is what
 * Back out of the first deep link lands on.
 */
export function parseRoute(hash: string | undefined | null): AppRoute | null {
  const h = (hash ?? '').trim();
  const queryAt = h.indexOf('?');
  if (queryAt >= 0) {
    if (h.length > 2000000) return null;
    const route = parseRoute(h.slice(0, queryAt));
    const params = new URLSearchParams(h.slice(queryAt + 1));
    // Not params.size: Safari/iOS before 17 lacks it, which would reject every link.
    if (!route || [...params.keys()].length !== 1 || !params.has('analysis')) return null;
    try {
      const value: unknown = JSON.parse(params.get('analysis') as string);
      if (route.view === 'explorer') {
        const analysis = parseExplorerAnalysis(value);
        return analysis ? { ...route, analysis } : null;
      }
      if (route.view === 'report' || route.view === 'pathway-report' || route.view === 'compare-datasets') {
        const analysis = parseStudyAnalysis(value);
        return analysis ? { ...route, analysis } : null;
      }
    } catch { /* Invalid saved state is not a request for a wider analysis. */ }
    return null;
  }
  if (h === '' || h === '#' || h === '#/' || h === '/') return { view: 'hub' };

  const library = parseLibraryHash(h);
  if (library) return { view: 'library', ...library };

  const dataset = parseDatasetHash(h);
  // Methodology was an explorer tab until it became its own page; links shared
  // while it was one still open it.
  if (dataset?.tab === 'methodology') return { view: 'methodology' };
  if (dataset) return { view: 'explorer', ...dataset };

  // Ordered before the general gene form, which would otherwise read the `in`
  // marker as a gene literally named "in". Only `#/gene/in/<cats>` is claimed:
  // a bare `#/gene/in` still parses as that (admittedly unlikely) gene.
  const scopedLanding = /^#?\/gene\/in\/([^/?#]+)\/?$/.exec(h);
  if (scopedLanding) return { view: 'report', gene: null, scope: parseScope(scopedLanding[1]) };

  const gene = /^#?\/gene(?:\/([^/?#]+)(?:\/([^/?#]+))?)?\/?$/.exec(h);
  if (gene) return { view: 'report', gene: gene[1] ? safeDecode(gene[1]) : null, scope: parseScope(gene[2]) };

  // Tried before the one-gene compare below. That pattern cannot actually claim
  // this one — it requires a '/' straight after "compare", and here the next
  // character is '-' — but reading the more specific route first keeps the two
  // from ever depending on that detail.
  const compareSet = parseCompareSetHash(h);
  if (compareSet) return { view: 'compare-set', items: compareSet };

  const compare = /^#?\/compare\/([^/?#]+)(?:\/([^/?#]+))?\/?$/.exec(h);
  if (compare) return { view: 'compare-datasets', gene: safeDecode(compare[1]), scope: parseScope(compare[2]) };

  const pathway = /^#?\/pathway(?:\/([^/?#]+))?\/?$/.exec(h);
  if (pathway) return { view: 'pathway-report', pathway: pathway[1] ? safeDecode(pathway[1]) : null };

  const tracker = /^#?\/tracker(?:\/([^/?#]+))?\/?$/.exec(h);
  if (tracker) return { view: 'tracker', acc: tracker[1] ? safeDecode(tracker[1]) || null : null };

  if (/^#?\/statistics\/?$/.test(h)) return { view: 'statistics' };
  if (/^#?\/methodology\/?$/.test(h)) return { view: 'methodology' };
  if (/^#?\/verification\/?$/.test(h)) return { view: 'verification' };

  if (/^#?\/nomenclature\/?$/.test(h)) return { view: 'nomenclature' };
  if (/^#?\/local-datasets\/?$/.test(h)) return { view: 'local-datasets' };
  if (/^#?\/expression\/?$/.test(h)) return { view: 'expression' };

  const search = parseSearchHash(h);
  if (search) return { view: 'search', ...search };

  return null;
}

/**
 * True when a click on an in-app link should be handled by the app rather than
 * the browser: primary button, no modifier keys, not already handled. Modified
 * clicks (⌘/Ctrl/Shift/Alt, middle button) keep their native behavior so
 * "open in new tab" works on these links exactly as it does on any other.
 */
export function isPlainLeftClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;
}
