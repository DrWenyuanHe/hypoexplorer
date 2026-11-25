// Route landing: what the app should do with a route it read.
//
// The app router used to answer that question twice. A synchronous `bootState`
// read the URL the app was opened at, and `applyRoute` read every later one
// (Back/Forward, an edited address bar, a pasted link). The two switched over
// the same views and disagreed in the places that matter: a refused boot link
// still saved its chart scale, a Compare link whose bad `analysis` was not the
// first query key was refused at neither, and the same `#/dataset/<id>` link
// landed on a different track depending on where the user already was.
//
// This module is the one reader. It is pure: no React, no `window`, no network.
// The router (appRouter.ts) is its driver. It holds the state, loads a
// dataset's metadata when a track has to be checked, and writes history.
//
// Contract:
//   landHash(hash)   -> Landing   the URL as typed (adds the refusal a parse failure implies)
//   landRoute(route) -> Landing   the registry's vote on one parsed route
//   settleExplorer(route, dataset, populations | null) -> Settled
//                                  the explorer decision once the dataset's populations are known
//   applyPage(state, page) -> PageState
//                                  the one transition for a page landing, at boot and after
//
// Rules:
//   * A URL IS UNTRUSTED INPUT. The codec (utils/appLinks.ts) says what a URL
//     names; this module checks it against the registry.
//   * A REFUSAL APPLIES NOTHING: no view, no explorer intent, no chart scale.
//   * A URL DESTINATION IS ABSOLUTE. An explorer route that names no track, or
//     names one the dataset lacks, lands on the dataset's default track, so the
//     same link lands in the same place whatever was open. "Keep the current
//     track" belongs to the in-app `openInExplorer(id)` verb, which never reads
//     a URL.
//   * THE CHART SCALE TRAVELS ONLY WITH A PAGE LANDING. An explorer analysis's
//     scale is applied by the shell along with the rest of its analysis.

import type { AppView } from './appRouter';
import { getDataset, type DatasetCategory } from './data/datasets';
import type { Dataset } from './types';
import { listContrasts } from './data/contrasts';
import { COMPARE_TRACK, type NavigationIntent } from './explorer/explorerPosition';
import { type AppRoute, type CompareSetRouteItem, parseRoute } from './utils/appLinks';
import { COMPARE_SET_MAX, compareSetKey, type CompareSetItem } from './compareset/compareSetStore';
import type { CompareViewState } from './utils/analysisState';
import type { ChartScale } from './utils/chartScale';
import { DEFAULT_STUDY_SELECTION, selectionFromLink, type StudySelection } from './crossdataset/studySelectionLink';
import type { SearchFilter } from './search/searchTypes';

/** Why a route was refused. Each one shows the error page and applies nothing. */
export type RouteRefusal =
  | 'invalid-analysis'
  | 'dataset-unavailable'
  | 'contrast-unavailable'
  | 'population-unavailable'
  | 'compare-unavailable'
  | 'population-unverifiable';

export const REFUSAL_MESSAGE: Readonly<Record<RouteRefusal, string>> = {
  'invalid-analysis': 'This saved analysis is invalid or uses an unsupported version. Its settings have not been applied.',
  'dataset-unavailable': 'The saved dataset is not available in this release. Its settings have not been applied.',
  'contrast-unavailable': 'The saved comparison is not available in this dataset. Its settings have not been applied.',
  'population-unavailable': 'The saved population is not available in this dataset. Its settings have not been applied.',
  'compare-unavailable': 'Compare is not available for this dataset. Its settings have not been applied.',
  'population-unverifiable': 'The saved population could not be verified. Reload this link to retry; its settings have not been applied.',
};

/** Everything the router holds about which page is showing, as one value. */
export interface PageState {
  view: AppView;
  reportGene: string | null;
  reportPathway: string | null;
  geneStudySelection: StudySelection;
  pathwayStudySelection: StudySelection;
  trackerSelectedAcc: string | null;
  libraryDatasetId: string | null;
  libraryCategories: DatasetCategory[] | null;
  compareSetItems: CompareSetItem[];
  searchQuery: string;
  searchFilter: SearchFilter;
}

/** A full-page destination, already checked against the registry. */
export type PageLanding =
  | { view: 'hub' | 'methodology' | 'verification' | 'nomenclature' | 'expression' }
  | { view: 'tracker'; acc: string | null }
  | { view: 'search'; query: string; filter: SearchFilter }
  | { view: 'library'; datasetId: string | null; categories: DatasetCategory[] | null }
  | { view: 'report'; gene: string; selection: StudySelection }
  | { view: 'pathway-report'; pathway: string; selection: StudySelection }
  | { view: 'compare-set'; items: CompareSetItem[] };

type ExplorerRoute = Extract<AppRoute, { view: 'explorer' }>;
type OpenIntent = Extract<NavigationIntent, { type: 'open' }>;

export type Landing =
  /** Not a route (an in-page anchor, junk): leave the view alone. */
  | { kind: 'ignore' }
  /** Names nothing the registry has, and carries no analysis: stay, and restore the address bar. */
  | { kind: 'stay' }
  | { kind: 'refuse'; refusal: RouteRefusal }
  | { kind: 'page'; page: PageLanding; chartScale?: ChartScale }
  /** Always names a track or Compare: a URL destination is absolute. */
  | { kind: 'explorer'; intent: OpenIntent }
  /** A named track or Compare needs the dataset's populations; the driver loads them and calls `settleExplorer`. */
  | { kind: 'verify'; route: ExplorerRoute; dataset: Dataset };

export type Settled = Exclude<Landing, { kind: 'verify' }>;

/** The page state before any route has landed. A report cannot open without its term, so it starts on the hub. */
export function initialPage(initialView: AppView): PageState {
  return {
    view: initialView === 'report' || initialView === 'pathway-report' ? 'hub' : initialView,
    reportGene: null,
    reportPathway: null,
    geneStudySelection: DEFAULT_STUDY_SELECTION,
    pathwayStudySelection: DEFAULT_STUDY_SELECTION,
    trackerSelectedAcc: null,
    libraryDatasetId: null,
    libraryCategories: null,
    compareSetItems: [],
    searchQuery: '',
    searchFilter: 'all',
  };
}

/**
 * One page landing applied to the page state. It sets what the landing names
 * and leaves the rest alone, so the other report kind's study selection
 * survives a visit to this one.
 */
export function applyPage(state: PageState, page: PageLanding): PageState {
  switch (page.view) {
    case 'hub':
    case 'methodology':
    case 'verification':
    case 'nomenclature':
    case 'expression':
      return { ...state, view: page.view };
    case 'tracker':
      return { ...state, view: 'tracker', trackerSelectedAcc: page.acc };
    case 'search':
      return { ...state, view: 'search', searchQuery: page.query, searchFilter: page.filter };
    case 'library':
      return { ...state, view: 'library', libraryDatasetId: page.datasetId, libraryCategories: page.categories };
    case 'report':
      return { ...state, view: 'report', reportGene: page.gene, geneStudySelection: page.selection };
    case 'pathway-report':
      return { ...state, view: 'pathway-report', reportPathway: page.pathway, pathwayStudySelection: page.selection };
    case 'compare-set':
      return { ...state, view: 'compare-set', compareSetItems: page.items };
  }
}

/** The library opened fresh: no record, no scope. */
const PLAIN_LIBRARY: PageLanding = { view: 'library', datasetId: null, categories: null };

/**
 * Route columns → the columns the view can actually show: unknown datasets
 * dropped, a missing track filled with the dataset's default, duplicates
 * collapsed, the cap applied. The codec carries what a URL SAYS; this is where
 * the registry gets its vote.
 */
function resolveCompareSetItems(items: readonly CompareSetRouteItem[]): CompareSetItem[] {
  const seen = new Set<string>();
  const out: CompareSetItem[] = [];
  for (const item of items) {
    const ds = getDataset(item.datasetId);
    if (!ds) continue;
    const resolved = { datasetId: ds.id, trackId: item.trackId ?? ds.defaultTrack };
    const key = compareSetKey(resolved);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
    if (out.length >= COMPARE_SET_MAX) break;
  }
  return out;
}

/** The compare-set page for these columns, or the library when none is usable. */
export function compareSetPage(items: readonly CompareSetRouteItem[]): PageLanding {
  const resolved = resolveCompareSetItems(items);
  return resolved.length ? { view: 'compare-set', items: resolved } : PLAIN_LIBRARY;
}

/**
 * True when the hash's query carries an `analysis` key in any position. Read
 * from the parsed keys, not a substring, so `?genes=X&analysis=…` counts.
 */
function carriesAnalysis(hash: string): boolean {
  const queryAt = hash.indexOf('?');
  return queryAt >= 0 && new URLSearchParams(hash.slice(queryAt + 1)).has('analysis');
}

/**
 * Land a hash as the browser hands it over. A hash the codec cannot parse is
 * left alone, unless it carries a saved analysis: an analysis link that does
 * not parse is refused rather than ignored, wherever its `analysis` key sits.
 */
export function landHash(hash: string): Landing {
  const route = parseRoute(hash);
  if (!route) return carriesAnalysis(hash) ? { kind: 'refuse', refusal: 'invalid-analysis' } : { kind: 'ignore' };
  return landRoute(route);
}

/** The registry's vote on one parsed route. */
export function landRoute(route: AppRoute): Landing {
  switch (route.view) {
    case 'hub':
    case 'methodology':
    case 'verification':
    case 'nomenclature':
    case 'expression':
      return { kind: 'page', page: { view: route.view } };
    case 'tracker':
      return { kind: 'page', page: { view: 'tracker', acc: route.acc } };
    case 'search':
      return { kind: 'page', page: { view: 'search', query: route.query.trim(), filter: route.filter } };
    case 'library':
      // Browsing, so nothing is validated against the bundles: the library
      // renders from the registry, and an unknown id opens with no record.
      return {
        kind: 'page',
        page: {
          view: 'library',
          datasetId: route.datasetId && getDataset(route.datasetId) ? route.datasetId : null,
          categories: route.categories?.length ? route.categories : null,
        },
      };
    case 'report':
      return {
        kind: 'page',
        page: { view: 'report', gene: route.gene, selection: selectionFromLink(route) },
        ...(route.analysis ? { chartScale: route.analysis.chartScale ?? 'native' } : {}),
      };
    case 'pathway-report':
      return {
        kind: 'page',
        page: { view: 'pathway-report', pathway: route.pathway, selection: selectionFromLink(route) },
        ...(route.analysis ? { chartScale: route.analysis.chartScale ?? 'native' } : {}),
      };
    case 'compare-set':
      return { kind: 'page', page: compareSetPage(route.items) };
    case 'explorer': {
      const dataset = getDataset(route.datasetId);
      if (!dataset) return route.analysis ? { kind: 'refuse', refusal: 'dataset-unavailable' } : { kind: 'stay' };
      // An unknown saved contrast cannot silently become the default result.
      const contrastId = route.analysis?.contrastId;
      if (contrastId && !listContrasts(dataset).some((contrast) => contrast.id === contrastId)) {
        return { kind: 'refuse', refusal: 'contrast-unavailable' };
      }
      if (!route.trackId) return { kind: 'explorer', intent: openTrack(route, dataset, dataset.defaultTrack) };
      return { kind: 'verify', route, dataset };
    }
  }
}

/**
 * The explorer decision once the dataset's populations are known; `null`
 * means its metadata could not be loaded. A saved analysis refuses rather than
 * landing somewhere it did not name; a plain link degrades to the default track.
 */
export function settleExplorer(route: ExplorerRoute, dataset: Dataset, populations: readonly string[] | null): Settled {
  const wantsCompare = route.trackId === COMPARE_TRACK;
  if (populations === null) {
    return route.analysis
      ? { kind: 'refuse', refusal: 'population-unverifiable' }
      : { kind: 'explorer', intent: openTrack(route, dataset, dataset.defaultTrack) };
  }
  // Compare needs two populations to compare; anything else must be one of them.
  const known = wantsCompare ? populations.length >= 2 : populations.includes(route.trackId as string);
  if (!known) {
    if (route.analysis) return { kind: 'refuse', refusal: wantsCompare ? 'compare-unavailable' : 'population-unavailable' };
    return { kind: 'explorer', intent: openTrack(route, dataset, dataset.defaultTrack) };
  }
  if (wantsCompare) {
    // Compare has no tab; a /compare/<tab> link names nothing.
    return {
      kind: 'explorer',
      intent: {
        type: 'open', datasetId: dataset.id, compare: true,
        compareView: compareViewFor(route.compare, populations), analysis: route.analysis,
      },
    };
  }
  return { kind: 'explorer', intent: openTrack(route, dataset, route.trackId as string) };
}

/**
 * One atomic intent: the explorer position applies the tab (degrading one the
 * track does not offer) and the saved contrast together, so no intermediate
 * position ever renders.
 */
function openTrack(route: ExplorerRoute, dataset: Dataset, trackId: string): OpenIntent {
  return { type: 'open', datasetId: dataset.id, compare: false, trackId, tab: route.tab, analysis: route.analysis };
}

/**
 * A Compare link's view, checked against the dataset's real populations: an id
 * the dataset no longer has is dropped, and fewer than two left means the
 * dataset's default pair (a comparison of one is not a comparison). Genes and
 * the sub-tab need no check here; a gene a population lacks shows as such.
 */
function compareViewFor(view: CompareViewState | undefined, populations: readonly string[]): CompareViewState {
  if (!view) return {};
  const { pops, ...rest } = view;
  const known = pops?.filter((id) => populations.includes(id));
  return known && known.length >= 2 ? { ...rest, pops: known } : rest;
}
