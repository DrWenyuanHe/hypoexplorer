// The app router: where the user is, every way to get somewhere else, and the
// URL that names it.
//
// HypoExplorer has one tabbed explorer shell plus six full-page views (the
// landing hub, the cross-dataset gene and pathway reports, the cross-dataset
// expression compare, the dataset tracker, and the statistics explainer). Which
// one is on screen — and the parameters that view was opened with — used to be
// five useState hooks, ten useCallbacks and a hashchange effect scattered
// through App, where the only way to test that a stale deep link degrades safely
// was to mount the whole application against a fabricated location.hash.
//
// Contract:
//   useAppRouter(initialView, explorer, explorerAt?) -> AppRouter
//   (initialView exists so tests can mount directly in the explorer)
//
// The router decides WHERE; the `explorer` adapter passed in takes one whole
// navigation intent and the shell's explorer position decides HOW it lands
// (which tab survives, Compare, what resets). That split is what keeps the
// router free of the shell's own state.
//
// ── The URL is now a two-way binding ─────────────────────────────────────────
// The hash used to be read-only: deep links resolved on load, but the app's own
// navigation never touched the address bar, so every one of the ~30 datasets and
// all eight views shared the single URL `hypoexplorer.com`. Nothing was
// linkable, bookmarkable, or reachable with Back.
//
// Now `parseRoute` runs on the way in and `routeHref` on the way out, and the
// hard part is making those two directions not fight:
//
//   * WRITES USE history.pushState, WHICH FIRES NOTHING. Assigning
//     `location.hash` would fire `hashchange`, the reader would re-apply the
//     route we just wrote, and every navigation would round-trip through the
//     parser. pushState mutates the URL silently, so the reader only ever runs
//     for navigation the USER caused (Back/Forward, an edited address bar, a
//     pasted link).
//   * NOTHING IS WRITTEN WHILE A ROUTE IS LANDING. `routePending` covers the
//     window between "we read a route" and "the shell has caught up with it".
//     Validating a track needs the dataset's metadata, so that window can span
//     several renders — and during it the shell still reports its OLD position.
//     Writing then would replace the incoming deep link with wherever the user
//     happened to already be, which is exactly the bug that makes hand-rolled
//     hash routers eat their own deep links.
//   * THE FIRST WRITE REPLACES, THE REST PUSH. Normalizing the URL on arrival
//     must not leave a synthetic entry behind the user's first page, or Back
//     would land them on the site instead of leaving it.

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { getDataset, type DatasetCategory } from './data/datasets';
import { DEFAULT_EXPLORER_TAB } from './explorer/explorerTabs';
import { COMPARE_TRACK, type NavigationIntent } from './explorer/explorerPosition';
import { loadDatasetMeta } from './data/loadDatasetMeta';
import { type AppRoute, type CompareSetRouteItem, parseRoute, routeHref } from './utils/appLinks';
import { COMPARE_SET_MAX, compareSetKey, type CompareSetItem } from './compareset/compareSetStore';
import { DEFAULT_STUDY_ANALYSIS, hasStudyAnalysis, type ExplorerAnalysisState, type StudyAnalysisState } from './utils/analysisState';
import { listContrasts } from './data/contrasts';
import { setChartScale, useChartScale } from './common/chartScaleStore';
import type { SearchFilter } from './search/searchTypes';

/**
 * The views the app can be on.
 *
 * A union rather than a bare string, so a typo in a `setView` call is a compile
 * error instead of a blank screen — every one of these is matched on when the
 * shell decides what to render.
 */
export type AppView =
  | 'hub'
  | 'library'
  | 'explorer'
  | 'report'
  | 'pathway-report'
  | 'compare-datasets'
  | 'compare-set'
  | 'tracker'
  | 'statistics'
  | 'methodology'
  | 'verification'
  | 'nomenclature'
  | 'expression'
  | 'local-datasets'
  | 'search';

/**
 * What the router needs the explorer shell to do when a route lands in it.
 *
 * The router never touches the shell's state directly — it states an intent and
 * the shell applies its own rules (which per-track state resets, which tab is
 * still valid for the target dataset, and so on).
 */
export interface ExplorerNavigation {
  /**
   * Apply one whole navigation intent atomically. The explorer position
   * (explorer/explorerPosition.ts) decides the landing tab, Compare entry and
   * exit, and what the move resets; a saved analysis rides on an open.
   */
  navigate: (intent: NavigationIntent) => void;
}

/**
 * Where the explorer shell currently IS — the read side of the same seam, as
 * the URL spells it (Compare is the track id COMPARE_TRACK).
 *
 * The router owns which VIEW is on screen, but the explorer's position within
 * itself is the shell's state, and the URL has to name it. Rather than lifting
 * dataset/track/tab into the router (they drive a dozen shell behaviours that
 * have nothing to do with routing), the shell reports its position back and the
 * router serializes it. Optional: tests that only exercise the navigation verbs
 * pass no position, and the router then writes no explorer URL.
 */
export interface ExplorerAt {
  datasetId: string;
  trackId: string;
  tab: string;
  analysis?: ExplorerAnalysisState;
}

export interface AppRouter {
  /** The view currently on screen. */
  view: AppView;
  routeError: string | null;
  /** The gene the cross-dataset report / compare was opened for. */
  reportGene: string | null;
  /** Category scope for the report; null means "all categories". */
  reportScope: DatasetCategory[] | null;
  /** The pathway the cross-dataset pathway report was opened for. */
  reportPathway: string | null;
  geneAnalysis: StudyAnalysisState;
  pathwayAnalysis: StudyAnalysisState;
  setGeneAnalysis: Dispatch<SetStateAction<StudyAnalysisState>>;
  setPathwayAnalysis: Dispatch<SetStateAction<StudyAnalysisState>>;
  setReportScope: (scope: DatasetCategory[] | null) => void;
  setReportGene: (gene: string) => void;
  /** A dossier accession the tracker should open focused on, if any. */
  trackerSelectedAcc: string | null;
  /** A study whose record the library should open showing, if any. */
  libraryDatasetId: string | null;
  /** Categories the library's rail should start narrowed to; null means all. */
  libraryCategories: DatasetCategory[] | null;
  /**
   * The columns the compare-set view shows: the ROUTE's snapshot, resolved
   * (every track id present), not the staging store. A shared link therefore
   * renders what it names without touching the reader's own set.
   */
  compareSetItems: CompareSetItem[];
  /** The unified search page's submitted query (trimmed); '' is its empty state. */
  searchQuery: string;
  /** The unified search page's All / Genes / Pathways breakdown. */
  searchFilter: SearchFilter;

  /** Back to the landing hub. */
  goHome: () => void;
  /** Enter the explorer at a tab. Named while in Compare, the tab leaves Compare. */
  enterTool: (tab: string) => void;
  /**
   * Show the explorer shell without changing which tool is selected. Used by the
   * changelog, which is an explorer-shell overlay reachable from the hub.
   */
  enterExplorer: () => void;
  /**
   * Open the cross-dataset gene report.
   *
   * `scope` carries the categories the search was made under; omitting it means
   * "all categories". It is a parameter rather than separate state because the
   * Gene Explorer's landing page lets a scope be chosen BEFORE a gene is typed,
   * and a submit that quietly reset the scope would discard that choice.
   */
  searchGene: (gene: string, scope?: DatasetCategory[] | null) => void;
  /** Open the cross-dataset FGSEA pathway report. */
  searchPathway: (pathway: string) => void;
  /**
   * Open the unified gene + pathway results page for a query (trimmed; case
   * kept as typed). A new history entry, like any other search.
   */
  search: (query: string, filter?: SearchFilter) => void;
  /**
   * Change the results page's breakdown. The filter is a path segment, so this
   * pushes a history entry like every other in-view change that alters the
   * path (a report's scope, the library's record): Back undoes it.
   */
  setSearchFilter: (filter: SearchFilter) => void;
  /** Open the Gene Explorer's landing state — the search interface, no gene yet. */
  openGeneExplorer: () => void;
  /** Open the Pathway Explorer's landing state — the search interface, no pathway yet. */
  openPathwayExplorer: () => void;
  /**
   * Switch the open search dialog between gene and pathway search. Unlike the
   * two openers, the gene category scope is kept, so a scoped landing link
   * survives a visit to the pathway side.
   */
  switchSearchExplorer: (mode: 'gene' | 'pathway') => void;
  /** Open the cross-dataset expression compare, carrying the report's scope. */
  compareDatasets: (gene: string, scope: DatasetCategory[] | null, datasetIds?: string[]) => void;

  /** Open the dataset tracker, optionally focused on one dossier. */
  openTracker: (acc?: string | null) => void;
  /** Open a dataset in the explorer, optionally at a specific track. */
  openInExplorer: (datasetId: string, trackId?: string) => void;
  /** Open the statistics explainer (dataset-agnostic reference page). */
  openStatistics: () => void;
  /** Open the methodology reference page (dataset-agnostic). */
  openMethodology: () => void;
  /** Open the evidence levels and data-verification workflow. */
  openVerification: () => void;
  /** Open the gene nomenclature reference (dataset-agnostic reference page). */
  openNomenclature: () => void;
  openLocalDatasets: () => void;
  openExpression: () => void;
  /**
   * Open the dataset library, optionally with one study's record showing.
   *
   * Deliberately NOT `openInExplorer`: this is browsing, and it must not touch
   * the explorer. An `open` intent eagerly loads a track bundle and resets the
   * explorer's per-track state, so routing a *preview* through it would make
   * looking at a study as expensive — and as destructive — as opening one.
   */
  openLibrary: (opts?: LibraryEntry) => void;
  /**
   * The library reporting what it has on screen, so the URL can name it.
   *
   * Separate from `openLibrary` on purpose. Entering the library is a fresh
   * start — no record, and no scope unless one was asked for — while these are
   * updates from inside it, and each must leave the other alone. One verb doing
   * both would need an "undefined means keep, null means clear" convention that
   * every call site has to remember correctly.
   */
  setLibraryDataset: (datasetId: string | null) => void;
  setLibraryCategories: (categories: DatasetCategory[]) => void;
  /**
   * Open the compare-set view on these columns. Unknown datasets are dropped
   * and a missing track is the dataset's default; fewer than one usable column
   * lands in the library instead, which is where columns come from.
   */
  openCompareSet: (items: readonly CompareSetRouteItem[]) => void;
  /** The view reporting a column removed. An emptied set leaves for the library. */
  setCompareSetItems: (items: readonly CompareSetItem[]) => void;
}

/** The router state a route carries, resolved once at mount. */
interface BootState {
  view: AppView;
  routeError: string | null;
  gene: string | null;
  scope: DatasetCategory[] | null;
  pathway: string | null;
  trackerAcc: string | null;
  libraryDatasetId: string | null;
  libraryCategories: DatasetCategory[] | null;
  compareSetItems: CompareSetItem[];
  searchQuery: string;
  searchFilter: SearchFilter;
  geneAnalysis: StudyAnalysisState;
  pathwayAnalysis: StudyAnalysisState;
  /** The explorer route to hand the shell once it exists; null when not one. */
  explorer: Extract<AppRoute, { view: 'explorer' }> | null;
}

/** Keep an explicitly empty or obsolete study set empty, never widen it. */
function resolveStudyAnalysis(analysis?: StudyAnalysisState): StudyAnalysisState {
  return analysis ? {
    ...analysis,
    datasetIds: analysis.datasetIds?.filter((id) => getDataset(id)) ?? null,
  } : DEFAULT_STUDY_ANALYSIS;
}

/** Where to open the library: on a record, narrowed to categories, or neither. */
export interface LibraryEntry {
  datasetId?: string | null;
  categories?: readonly DatasetCategory[] | null;
}

/**
 * Route columns → the columns the view can actually show: unknown datasets
 * dropped, a missing track filled with the dataset's default, duplicates
 * collapsed, the cap applied. The codec carries what a URL SAYS; this is where
 * the registry gets its vote, the same way the explorer arm validates its
 * dataset in `bootState` rather than in the parser.
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

/**
 * Resolve the URL the app was opened at into initial router state.
 *
 * SYNCHRONOUS ON PURPOSE. Applying the boot route from an effect instead would
 * render one frame of the wrong view, and — worse — give the URL-writing effect
 * a frame in which the state says 'hub' while the address bar says
 * `#/dataset/...`, which is all it takes to overwrite the link that was just
 * followed. Everything decidable from the registry is decided here; only the
 * track (which needs the dataset's metadata) is left to the mount effect.
 */
function bootState(initialView: string): BootState {
  const base: BootState = {
    routeError: null,
    view: initialView as AppView,
    gene: null,
    scope: null,
    pathway: null,
    trackerAcc: null,
    libraryDatasetId: null,
    libraryCategories: null,
    compareSetItems: [],
    searchQuery: '',
    searchFilter: 'all',
    geneAnalysis: DEFAULT_STUDY_ANALYSIS,
    pathwayAnalysis: DEFAULT_STUDY_ANALYSIS,
    explorer: null,
  };
  // No hash means no opinion — honour the caller's initialView (tests mount
  // straight into the explorer this way) rather than forcing the hub.
  if (typeof window === 'undefined' || !window.location.hash) return base;
  const route = parseRoute(window.location.hash);
  if (!route) return window.location.hash.includes('?analysis=')
    ? { ...base, routeError: 'This saved analysis is invalid or uses an unsupported version. Its settings have not been applied.' }
    : base;
  switch (route.view) {
    case 'hub':
    case 'statistics':
    case 'methodology':
    case 'verification':
    case 'nomenclature':
    case 'local-datasets':
    case 'expression':
      return { ...base, view: route.view };
    case 'tracker':
      return { ...base, view: 'tracker', trackerAcc: route.acc };
    case 'search':
      return { ...base, view: 'search', searchQuery: route.query, searchFilter: route.filter };
    case 'library':
      // Browsing, so nothing is validated against the bundles: the library
      // renders from the registry, and an unknown id simply opens with no record
      // showing rather than being worth a round trip.
      return {
        ...base,
        view: 'library',
        libraryDatasetId: route.datasetId && getDataset(route.datasetId) ? route.datasetId : null,
        libraryCategories: route.categories,
      };
    case 'report':
      return { ...base, view: 'report', gene: route.gene, scope: route.analysis?.categories ?? route.scope, geneAnalysis: resolveStudyAnalysis(route.analysis) };
    case 'compare-datasets':
      return { ...base, view: 'compare-datasets', gene: route.gene, scope: route.analysis?.categories ?? route.scope, geneAnalysis: resolveStudyAnalysis(route.analysis) };
    case 'pathway-report':
      return { ...base, view: 'pathway-report', pathway: route.pathway, pathwayAnalysis: resolveStudyAnalysis(route.analysis) };
    case 'compare-set': {
      // A link whose columns have all gone stale is not a comparison; the
      // library is where the next column comes from.
      const items = resolveCompareSetItems(route.items);
      return items.length
        ? { ...base, view: 'compare-set', compareSetItems: items }
        : { ...base, view: 'library' };
    }
    case 'explorer':
      // An unknown dataset is ignored entirely: stay wherever the caller asked
      // for, rather than opening the explorer on a study that isn't there.
      if (!getDataset(route.datasetId)) return route.analysis
        ? { ...base, routeError: 'The saved dataset is not available in this release. Its settings have not been applied.' }
        : base;
      if (route.analysis?.contrastId && !listContrasts(getDataset(route.datasetId)!).some((contrast) => contrast.id === route.analysis?.contrastId)) {
        return { ...base, routeError: 'The saved comparison is not available in this dataset. Its settings have not been applied.' };
      }
      return { ...base, view: 'explorer', explorer: route };
  }
}

export function useAppRouter(
  initialView: string,
  explorer: ExplorerNavigation,
  explorerAt?: ExplorerAt,
): AppRouter {
  const [boot] = useState(() => bootState(initialView));
  const chartScale = useChartScale();
  const [view, setView] = useState<AppView>(boot.view);
  const [routeError, setRouteError] = useState(boot.routeError);
  const [reportGene, setReportGene] = useState<string | null>(boot.gene);
  const [reportScope, setReportScope] = useState<DatasetCategory[] | null>(boot.scope);
  const [reportPathway, setReportPathway] = useState<string | null>(boot.pathway);
  const [geneAnalysis, setGeneAnalysis] = useState(boot.geneAnalysis);
  const [pathwayAnalysis, setPathwayAnalysis] = useState(boot.pathwayAnalysis);
  const [trackerSelectedAcc, setTrackerSelectedAcc] = useState<string | null>(boot.trackerAcc);
  const [libraryDatasetId, setLibraryDatasetId] = useState<string | null>(boot.libraryDatasetId);
  const [libraryCategories, setLibraryCategoriesState] = useState<DatasetCategory[] | null>(boot.libraryCategories);
  const [compareSetItems, setCompareSetItemsState] = useState<CompareSetItem[]>(boot.compareSetItems);
  const [searchQuery, setSearchQuery] = useState<string>(boot.searchQuery);
  const [searchFilter, setSearchFilterState] = useState<SearchFilter>(boot.searchFilter);

  // True while a route read out of the URL has not finished landing in the app.
  // Starts true because the boot route is one, and gates every URL write — see
  // the header. State rather than a ref, so clearing it re-runs the write effect
  // instead of leaving the address bar one interaction stale.
  const [routePending, setRoutePending] = useState(true);

  // The explorer adapter is read through a ref so the navigation verbs stay
  // referentially stable: the shell rebuilds its callbacks whenever its own state
  // changes, and without this every verb would change identity with it — churning
  // the hub's memoized tiles on every unrelated explorer keystroke.
  const explorerRef = useRef(explorer);
  useEffect(() => { explorerRef.current = explorer; }, [explorer]);

  const goHome = useCallback(() => { setRouteError(null); setView('hub'); }, []);
  const enterExplorer = useCallback(() => setView('explorer'), []);

  const enterTool = useCallback((tab: string) => {
    explorerRef.current.navigate({ type: 'tab', tab });
    setView('explorer');
  }, []);

  // A gene search. The report lazy-loads every track on first query, then
  // caches. A null/omitted scope means "all categories"; the Gene Explorer's own
  // scope picker and its physiological-signal presets pass one through.
  const searchGene = useCallback((gene: string, scope: DatasetCategory[] | null = null) => {
    setReportGene(gene);
    setReportScope(scope?.length ? scope : null);
    setView('report');
  }, []);

  // The pathway analog: a pathway search lands in the FGSEA cross-dataset
  // report. Pathway-capable datasets only.
  const searchPathway = useCallback((pathway: string) => {
    setReportPathway(pathway);
    setView('pathway-report');
  }, []);

  // The unified search: one query, genes and pathways side by side. Trimmed
  // here as well as in the codec, so the state always equals what the URL can
  // carry and Back/Forward restores exactly what was on screen.
  const search = useCallback((query: string, filter: SearchFilter = 'all') => {
    setSearchQuery(query.trim());
    setSearchFilterState(filter);
    setView('search');
  }, []);

  // An update from INSIDE the results page, so the query is left alone.
  const setSearchFilter = useCallback((filter: SearchFilter) => {
    setSearchFilterState(filter);
  }, []);

  // The two landing states, reached from the hub's primary cards. A null term is
  // what makes the report render its search interface instead of a result, so
  // these are the same views entered one step earlier — not separate ones.
  const openGeneExplorer = useCallback(() => {
    setReportGene(null);
    setReportScope(null);
    setView('report');
  }, []);

  const openPathwayExplorer = useCallback(() => {
    setReportPathway(null);
    setView('pathway-report');
  }, []);

  const switchSearchExplorer = useCallback((mode: 'gene' | 'pathway') => {
    if (mode === 'gene') {
      setReportGene(null);
      setView('report');
    } else {
      setReportPathway(null);
      setView('pathway-report');
    }
  }, []);

  // Cross-dataset expression compare (side-by-side bars), reached from the forest
  // report. Carries the gene + the report's current category scope.
  const compareDatasets = useCallback((gene: string, scope: DatasetCategory[] | null, datasetIds?: string[]) => {
    setReportGene(gene);
    setReportScope(scope);
    if (datasetIds) setGeneAnalysis((state) => ({ ...state, datasetIds, categories: scope }));
    setView('compare-datasets');
  }, []);


  const openTracker = useCallback((acc: string | null = null) => {
    setTrackerSelectedAcc(acc);
    setView('tracker');
  }, []);

  // Reached from the tracker's dossiers, the cross-dataset report's dataset and
  // track links, and a `#/dataset/<id>[/<trackId>]` deep link.
  const openInExplorer = useCallback((datasetId: string, trackId?: string) => {
    explorerRef.current.navigate({ type: 'open', datasetId, trackId });
    setView('explorer');
  }, []);

  const openStatistics = useCallback(() => setView('statistics'), []);
  const openMethodology = useCallback(() => setView('methodology'), []);
  const openVerification = useCallback(() => setView('verification'), []);
  const openNomenclature = useCallback(() => setView('nomenclature'), []);
  const openLocalDatasets = useCallback(() => setView('local-datasets'), []);
  const openExpression = useCallback(() => setView('expression'), []);

  const openLibrary = useCallback(({ datasetId = null, categories = null }: LibraryEntry = {}) => {
    setLibraryDatasetId(datasetId);
    setLibraryCategoriesState(categories?.length ? [...categories] : null);
    setView('library');
  }, []);

  // An empty rail is "all categories", which is what a scopeless URL means, so
  // clearing the last checkbox has to shorten the URL rather than write an empty
  // `/in/` segment that would not round-trip.
  const setLibraryCategories = useCallback((categories: DatasetCategory[]) => {
    setLibraryCategoriesState(categories.length ? categories : null);
  }, []);

  // The compare set as a VIEW. Its columns are the route's, resolved against
  // the registry here rather than in the codec; fewer than one usable column is
  // not a comparison, so that lands in the library instead.
  const openCompareSet = useCallback((items: readonly CompareSetRouteItem[]) => {
    const resolved = resolveCompareSetItems(items);
    if (!resolved.length) { openLibrary(); return; }
    setCompareSetItemsState(resolved);
    setView('compare-set');
  }, [openLibrary]);

  // The view reporting a column removed. Same floor: an emptied set leaves.
  const setCompareSetItems = useCallback((items: readonly CompareSetItem[]) => {
    if (!items.length) { openLibrary(); return; }
    setCompareSetItemsState([...items]);
  }, [openLibrary]);

  // ── Reading the URL ────────────────────────────────────────────────────────

  // Validating a track requires loading the dataset's metadata, so a route can
  // still be in flight when the next one arrives. Each attempt claims a
  // generation and abandons itself if a newer one has started, so the route that
  // navigates is the one the user asked for LAST, not whichever metadata
  // happened to resolve last. The counter is bumped before validation, so even a
  // route that turns out to be invalid supersedes a pending one rather than
  // landing after the user has moved on.
  const generation = useRef(0);

  /**
   * Drive the app to a route read out of the URL.
   *
   * A hash is UNTRUSTED input, so it is validated before navigating: an unknown
   * dataset is ignored entirely (stay put), and a track or tab the dataset does
   * not have degrades to the default rather than landing on a 404'd track behind
   * an error banner or a tab the study never offers.
   */
  const applyRoute = useCallback((route: AppRoute) => {
    const attempt = ++generation.current;
    setRouteError(null);
    if (route.view !== 'explorer') setRoutePending(false);
    if ('analysis' in route && route.analysis && route.view !== 'explorer') setChartScale(route.analysis.chartScale ?? 'native');
    switch (route.view) {
      case 'hub':
        setView('hub');
        return;
      case 'statistics':
        setView('statistics');
        return;
      case 'methodology':
        setView('methodology');
        return;
      case 'verification':
        setView('verification');
        return;
      case 'nomenclature':
        setView('nomenclature');
        return;
      case 'local-datasets':
        setView('local-datasets');
        return;
      case 'expression':
        setView('expression');
        return;
      case 'tracker':
        openTracker(route.acc);
        return;
      case 'search':
        search(route.query, route.filter);
        return;
      case 'library':
        openLibrary({
          datasetId: route.datasetId && getDataset(route.datasetId) ? route.datasetId : null,
          categories: route.categories,
        });
        return;
      case 'report':
        setReportGene(route.gene);
        setReportScope(route.analysis ? route.analysis.categories : route.scope);
        setGeneAnalysis(resolveStudyAnalysis(route.analysis));
        setView('report');
        return;
      case 'compare-datasets':
        setReportGene(route.gene);
        setReportScope(route.analysis ? route.analysis.categories : route.scope);
        setGeneAnalysis(resolveStudyAnalysis(route.analysis));
        setView('compare-datasets');
        return;
      case 'pathway-report':
        setReportPathway(route.pathway);
        setPathwayAnalysis(resolveStudyAnalysis(route.analysis));
        setView('pathway-report');
        return;
      case 'compare-set':
        openCompareSet(route.items);
        return;
      case 'explorer': {
        const ds = getDataset(route.datasetId);
        if (!ds) {
          if (route.analysis) setRouteError('The saved dataset is not available in this release. Its settings have not been applied.');
          setRoutePending(false);
          return;
        }
        // An unknown saved contrast cannot silently become the default result.
        if (route.analysis?.contrastId && !listContrasts(ds).some((contrast) => contrast.id === route.analysis?.contrastId)) {
          setRouteError('The saved comparison is not available in this dataset. Its settings have not been applied.');
          setRoutePending(false);
          return;
        }
        // One atomic intent: the explorer position applies the tab (degrading
        // one this track does not offer), Compare and the saved contrast
        // together, so no intermediate position ever renders.
        const land = (trackId?: string, compare = false) => {
          explorerRef.current.navigate({
            type: 'open', datasetId: ds.id, compare,
            // A saved default-track analysis must also restore that track when
            // opened from another population of the same dataset.
            trackId: compare ? undefined : trackId ?? (route.analysis ? ds.defaultTrack : undefined),
            // Compare has no tab; a /compare/<tab> link names nothing.
            tab: compare ? undefined : route.tab,
            analysis: route.analysis,
          });
          setView('explorer');
        };
        if (!route.trackId) {
          land();
          setRoutePending(false);
          return;
        }
        const wantsCompare = route.trackId === COMPARE_TRACK;
        setRoutePending(true);
        loadDatasetMeta(ds)
          .then((meta) => {
            if (attempt !== generation.current) return;
            // Compare needs two populations to compare; anything else must be one of them.
            const known = wantsCompare
              ? (meta.populations?.length ?? 0) >= 2
              : meta.populations?.includes(route.trackId as string);
            if (route.analysis && !known) {
              setRouteError(wantsCompare
                ? 'Compare is not available for this dataset. Its settings have not been applied.'
                : 'The saved population is not available in this dataset. Its settings have not been applied.');
              setRoutePending(false);
              return;
            }
            land(known && !wantsCompare ? route.trackId : undefined, Boolean(known && wantsCompare));
            setRoutePending(false);
          })
          .catch(() => {
            if (attempt !== generation.current) return;
            if (route.analysis) {
              setRouteError('The saved population could not be verified. Reload this link to retry; its settings have not been applied.');
              setRoutePending(false);
              return;
            }
            land();
            setRoutePending(false);
          });
        return;
      }
    }
  }, [openCompareSet, openLibrary, openTracker, search]);

  // The boot route's explorer half. The VIEW was already resolved synchronously
  // in bootState; what is left is telling the shell which dataset/track/tab to
  // be on, which can only happen once the shell exists.
  // Mount only: re-applying the URL the app was OPENED at would fight every
  // later track and tab click the user makes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount only; see above
  useEffect(() => {
    if (boot.explorer) applyRoute(boot.explorer);
    else {
      const initialRoute = typeof window === 'undefined' ? null : parseRoute(window.location.hash);
      if (initialRoute && 'analysis' in initialRoute && initialRoute.analysis) setChartScale(initialRoute.analysis.chartScale ?? 'native');
      setRoutePending(false);
    }
  }, []);

  // User-driven URL changes: Back/Forward, an edited address bar, a pasted link
  // into the open tab. Our own writes go through history.pushState, which fires
  // neither event, so nothing here ever sees an echo of a route we wrote.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onNavigate = () => {
      const route = parseRoute(window.location.hash);
      // An unrecognized hash means "leave the user alone" — but the pending flag
      // must still clear, or the address bar would freeze from then on.
      if (!route) {
        ++generation.current;
        if (window.location.hash.includes('?analysis=')) setRouteError('This saved analysis is invalid or uses an unsupported version. Its settings have not been applied.');
        setRoutePending(false);
        return;
      }
      applyRoute(route);
    };
    window.addEventListener('hashchange', onNavigate);
    window.addEventListener('popstate', onNavigate);
    return () => {
      window.removeEventListener('hashchange', onNavigate);
      window.removeEventListener('popstate', onNavigate);
    };
  }, [applyRoute]);

  // ── Writing the URL ────────────────────────────────────────────────────────

  /**
   * The hash that names where the app currently is, or null when it cannot be
   * named yet (the explorer before the shell has reported a position).
   *
   * The hub is the empty string, not '#/': it is the bare site root, and landing
   * there should leave `hypoexplorer.com` looking like `hypoexplorer.com`.
   */
  const targetHash = useMemo<string | null>(() => {
    switch (view) {
      case 'hub':
        return '';
      case 'statistics':
        return routeHref({ view: 'statistics' });
      case 'methodology':
        return routeHref({ view: 'methodology' });
      case 'verification':
        return routeHref({ view: 'verification' });
      case 'nomenclature':
        return routeHref({ view: 'nomenclature' });
      case 'local-datasets':
        return routeHref({ view: 'local-datasets' });
      case 'expression':
        return routeHref({ view: 'expression' });
      case 'tracker':
        return routeHref({ view: 'tracker', acc: trackerSelectedAcc });
      case 'search':
        return routeHref({ view: 'search', query: searchQuery, filter: searchFilter });
      case 'library':
        return routeHref({ view: 'library', datasetId: libraryDatasetId, categories: libraryCategories });
      // Unconditional: a term-less report is the explorer's LANDING state, which
      // has its own address. Returning null here would mean "do not write", and
      // the address bar would keep naming whichever view came before it.
      case 'report':
        return routeHref({ view: 'report', gene: reportGene, scope: reportScope,
          ...(hasStudyAnalysis({ ...geneAnalysis, categories: null }) || chartScale !== 'native' ? { analysis: { ...geneAnalysis, categories: reportScope, chartScale } } : {}) });
      // Still guarded, and for a different reason: comparing nothing is not a
      // view, so `compare-datasets` keeps a non-null gene and this guard is what
      // narrows `reportGene` to `string` for it.
      case 'compare-datasets':
        return reportGene ? routeHref({ view: 'compare-datasets', gene: reportGene, scope: reportScope,
          ...(hasStudyAnalysis({ ...geneAnalysis, categories: null }) || chartScale !== 'native' ? { analysis: { ...geneAnalysis, categories: reportScope, chartScale } } : {}) }) : null;
      case 'pathway-report':
        return routeHref({ view: 'pathway-report', pathway: reportPathway,
          ...(hasStudyAnalysis(pathwayAnalysis) || chartScale !== 'native' ? { analysis: { ...pathwayAnalysis, chartScale } } : {}) });
      case 'compare-set':
        // Shortest URL that round-trips, as the explorer arm does: a dataset's
        // default track is implied by the dataset, so it stays out of the link.
        return compareSetItems.length
          ? routeHref({
              view: 'compare-set',
              items: compareSetItems.map((item) => {
                const ds = getDataset(item.datasetId);
                return ds && item.trackId === ds.defaultTrack
                  ? { datasetId: item.datasetId }
                  : { datasetId: item.datasetId, trackId: item.trackId };
              }),
            })
          : null;
      case 'explorer': {
        if (!explorerAt) return null;
        // Compare is its own segment and carries no tab, so it always names itself.
        if (explorerAt.trackId === COMPARE_TRACK) {
          return routeHref({ view: 'explorer', datasetId: explorerAt.datasetId, trackId: COMPARE_TRACK,
            ...(explorerAt.analysis ? { analysis: explorerAt.analysis } : {}) });
        }
        const ds = getDataset(explorerAt.datasetId);
        const tab = explorerAt.tab !== DEFAULT_EXPLORER_TAB ? explorerAt.tab : undefined;
        // Shortest URL that still round-trips. The default track is implied by
        // the dataset, so it is left out — which keeps the address bar agreeing
        // with the `#/dataset/<id>` links the report already emits. A non-default
        // tab has to sit behind a track segment, so naming one forces the track
        // back in even when it is the default.
        const trackId = !tab && ds && explorerAt.trackId === ds.defaultTrack ? undefined : explorerAt.trackId;
        return routeHref({ view: 'explorer', datasetId: explorerAt.datasetId, trackId, tab,
          ...(explorerAt.analysis ? { analysis: explorerAt.analysis } : {}) });
      }
    }
  }, [view, reportGene, reportScope, reportPathway, trackerSelectedAcc, libraryDatasetId, libraryCategories, compareSetItems, searchQuery, searchFilter, explorerAt, geneAnalysis, pathwayAnalysis, chartScale]);

  // Normalizing the URL on arrival must not push a synthetic entry behind the
  // user's first page — Back from it would land back on the site instead of
  // leaving it — so the first sync replaces and every later one pushes.
  const hasWritten = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || targetHash === null) return;
    // Never write over a route that is still landing: the shell is reporting its
    // OLD position, and writing it would overwrite the link being followed.
    if (routePending || routeError) return;
    if (window.location.hash === targetHash) { hasWritten.current = true; return; }
    // A hub URL is the fragment-less root, which pushState can only produce from
    // an explicit path (passing '' or '#' would keep the current fragment).
    const url = targetHash || `${window.location.pathname}${window.location.search}`;
    const settingsOnly = window.location.hash.split('?')[0] === targetHash.split('?')[0];
    if (hasWritten.current && !settingsOnly) window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
    hasWritten.current = true;
  }, [targetHash, routePending, routeError]);

  return {
    view, routeError, reportGene, reportScope, reportPathway, trackerSelectedAcc, libraryDatasetId, libraryCategories,
    compareSetItems, searchQuery, searchFilter,
    geneAnalysis, pathwayAnalysis, setGeneAnalysis, setPathwayAnalysis, setReportScope, setReportGene,
    goHome, enterTool, enterExplorer, searchGene, searchPathway, search, setSearchFilter,
    openGeneExplorer, openPathwayExplorer, switchSearchExplorer, compareDatasets,
    openTracker, openInExplorer, openStatistics, openMethodology, openVerification, openNomenclature, openLocalDatasets, openExpression, openLibrary,
    setLibraryDataset: setLibraryDatasetId, setLibraryCategories,
    openCompareSet, setCompareSetItems,
  };
}
