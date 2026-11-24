// The app router: where the user is, every way to get somewhere else, and the
// URL that names it.
//
// HypoExplorer has one tabbed explorer shell plus full-page views (the landing
// hub, search, the cross-dataset gene and pathway reports, the library, the
// compare set, the dataset tracker and the reference pages). Which
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
//
// What a route MEANS (the registry checks, refusals, the default track, the
// page it opens) is decided in routeLanding.ts, the one reader for boot and
// for every later URL. This file is its driver: it holds the state, loads a
// dataset's metadata when a named track has to be checked, and writes history.

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { getDataset, type DatasetCategory } from './data/datasets';
import { DEFAULT_EXPLORER_TAB } from './explorer/explorerTabs';
import { COMPARE_TRACK, type NavigationIntent } from './explorer/explorerPosition';
import { loadDatasetMeta } from './data/loadDatasetMeta';
import { type CompareSetRouteItem, isRetiredSearchLanding, parseRoute, routeHref } from './utils/appLinks';
import type { CompareSetItem } from './compareset/compareSetStore';
import type { CompareViewState, ExplorerAnalysisState } from './utils/analysisState';
import { selectionLink, type StudySelection } from './crossdataset/studySelectionLink';
import { setChartScale, useChartScale } from './common/chartScaleStore';
import type { SearchFilter } from './search/searchTypes';
import {
  applyPage, compareSetPage, initialPage, landHash, REFUSAL_MESSAGE, settleExplorer,
  type Landing, type PageLanding, type PageState, type Settled,
} from './routeLanding';

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
  | 'compare-set'
  | 'tracker'
  | 'methodology'
  | 'verification'
  | 'nomenclature'
  | 'expression'
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
  /** In Compare: what it shows, defaults already left out (see CompareViewState). */
  compare?: CompareViewState;
}

export interface AppRouter {
  /** The view currently on screen. */
  view: AppView;
  routeError: string | null;
  /** The gene the cross-dataset report / compare was opened for. */
  reportGene: string | null;
  /** The pathway the cross-dataset pathway report was opened for. */
  reportPathway: string | null;
  /**
   * Each report's study selection, one value per report kind. Held here, above
   * the term-keyed report boundaries, so it survives searches and is written
   * into the report's URL (crossdataset/studySelectionLink.ts owns that form).
   */
  geneStudySelection: StudySelection;
  pathwayStudySelection: StudySelection;
  setGeneStudySelection: Dispatch<SetStateAction<StudySelection>>;
  setPathwayStudySelection: Dispatch<SetStateAction<StudySelection>>;
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
   * "all categories". It replaces only the selection's categories: the
   * individual studies and filters chosen on the report carry over.
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

  /** Open the dataset tracker, optionally focused on one dossier. */
  openTracker: (acc?: string | null) => void;
  /** Open a dataset in the explorer, optionally at a specific track. */
  openInExplorer: (datasetId: string, trackId?: string) => void;
  /** Open the Methods & statistics reference page (dataset-agnostic). */
  openMethodology: () => void;
  /** Open the evidence levels and data-verification workflow. */
  openVerification: () => void;
  /** Open the gene nomenclature reference (dataset-agnostic reference page). */
  openNomenclature: () => void;
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

/** Where to open the library: on a record, narrowed to categories, or neither. */
export interface LibraryEntry {
  datasetId?: string | null;
  categories?: readonly DatasetCategory[] | null;
}

/** The URL the app was opened at, landed before the first render. */
interface Boot {
  page: PageState;
  routeError: string | null;
  /** What is left for the mount effect: the chart scale, the explorer intent or the track check. */
  landing: Landing | null;
}

/**
 * Land the URL the app was opened at.
 *
 * SYNCHRONOUS ON PURPOSE. Applying the boot route from an effect instead would
 * render one frame of the wrong view, and — worse — give the URL-writing effect
 * a frame in which the state says 'hub' while the address bar says
 * `#/dataset/...`, which is all it takes to overwrite the link that was just
 * followed. Everything decidable from the registry is decided here; only the
 * explorer (which needs the shell, and sometimes the dataset's metadata) is
 * left to the mount effect.
 */
function bootFrom(initialView: AppView): Boot {
  const page = initialPage(initialView);
  // No hash means no opinion — honour the caller's initialView (tests mount
  // straight into the explorer this way) rather than forcing the hub.
  if (typeof window === 'undefined' || !window.location.hash) return { page, routeError: null, landing: null };
  const landing = landHash(window.location.hash);
  switch (landing.kind) {
    case 'page':
      return { page: applyPage(page, landing.page), routeError: null, landing };
    case 'refuse':
      return { page, routeError: REFUSAL_MESSAGE[landing.refusal], landing };
    case 'explorer':
    case 'verify':
      return { page: { ...page, view: 'explorer' }, routeError: null, landing };
    default:
      return { page, routeError: null, landing };
  }
}

/** The library entered fresh: no record, no scope. */
const PLAIN_LIBRARY: PageLanding = { view: 'library', datasetId: null, categories: null };

export function useAppRouter(
  initialView: string,
  explorer: ExplorerNavigation,
  explorerAt?: ExplorerAt,
): AppRouter {
  const [boot] = useState(() => bootFrom(initialView as AppView));
  const chartScale = useChartScale();
  const [page, setPage] = useState<PageState>(boot.page);
  const [routeError, setRouteError] = useState(boot.routeError);
  const {
    view, reportGene, reportPathway, geneStudySelection, pathwayStudySelection, trackerSelectedAcc,
    libraryDatasetId, libraryCategories, compareSetItems, searchQuery, searchFilter,
  } = page;

  // True while a route read out of the URL has not finished landing in the app.
  // Starts true because the boot route is one, and gates every URL write — see
  // the header. State rather than a ref, so clearing it re-runs the write effect
  // instead of leaving the address bar one interaction stale.
  const [routePending, setRoutePending] = useState(true);

  // A route that names nothing ('stay') changes no state, so the write effect
  // needs a nudge to put the address bar back; and that write replaces the
  // entry the browser just made for the dead link rather than pushing behind it.
  const [reconcile, setReconcile] = useState(0);
  const replaceNextWrite = useRef(false);

  // The explorer adapter is read through a ref so the navigation verbs stay
  // referentially stable: the shell rebuilds its callbacks whenever its own state
  // changes, and without this every verb would change identity with it — churning
  // the hub's memoized tiles on every unrelated explorer keystroke.
  const explorerRef = useRef(explorer);
  useEffect(() => { explorerRef.current = explorer; }, [explorer]);

  /** A verb that lands a page the same way a URL does. */
  const toPage = useCallback((landing: PageLanding) => setPage((state) => applyPage(state, landing)), []);

  const goHome = useCallback(() => { setRouteError(null); toPage({ view: 'hub' }); }, [toPage]);
  const enterExplorer = useCallback(() => setPage((state) => ({ ...state, view: 'explorer' })), []);

  const enterTool = useCallback((tab: string) => {
    explorerRef.current.navigate({ type: 'tab', tab });
    setPage((state) => ({ ...state, view: 'explorer' }));
  }, []);

  // A gene search. The report lazy-loads every track on first query, then
  // caches. A null/omitted scope means "all categories"; the gene report's own
  // search box passes the categories it is reading under. Only the categories
  // change: the individual studies and filters chosen on the report carry over.
  const searchGene = useCallback((gene: string, scope: DatasetCategory[] | null = null) => {
    setPage((state) => ({
      ...state, view: 'report', reportGene: gene,
      geneStudySelection: { ...state.geneStudySelection, categories: scope?.length ? [...scope] : null },
    }));
  }, []);

  // The pathway analog: a pathway search lands in the FGSEA cross-dataset
  // report. Pathway-capable datasets only. Its selection carries over.
  const searchPathway = useCallback((pathway: string) => {
    setPage((state) => ({ ...state, view: 'pathway-report', reportPathway: pathway }));
  }, []);

  // The unified search: one query, genes and pathways side by side. Trimmed
  // here as well as in the landing, so the state always equals what the URL
  // can carry and Back/Forward restores exactly what was on screen.
  const search = useCallback((query: string, filter: SearchFilter = 'all') => {
    toPage({ view: 'search', query: query.trim(), filter });
  }, [toPage]);

  // An update from INSIDE the results page, so the query is left alone.
  const setSearchFilter = useCallback((filter: SearchFilter) => {
    setPage((state) => ({ ...state, searchFilter: filter }));
  }, []);

  const setGeneStudySelection = useCallback((action: SetStateAction<StudySelection>) => {
    setPage((state) => ({
      ...state, geneStudySelection: typeof action === 'function' ? action(state.geneStudySelection) : action,
    }));
  }, []);
  const setPathwayStudySelection = useCallback((action: SetStateAction<StudySelection>) => {
    setPage((state) => ({
      ...state, pathwayStudySelection: typeof action === 'function' ? action(state.pathwayStudySelection) : action,
    }));
  }, []);

  const openTracker = useCallback((acc: string | null = null) => toPage({ view: 'tracker', acc }), [toPage]);

  // Reached from the tracker's dossiers and the cross-dataset report's dataset
  // and track links. An in-app command, not a URL: with no track named it
  // keeps the track already open in that dataset.
  const openInExplorer = useCallback((datasetId: string, trackId?: string) => {
    explorerRef.current.navigate({ type: 'open', datasetId, trackId });
    setPage((state) => ({ ...state, view: 'explorer' }));
  }, []);

  const openMethodology = useCallback(() => toPage({ view: 'methodology' }), [toPage]);
  const openVerification = useCallback(() => toPage({ view: 'verification' }), [toPage]);
  const openNomenclature = useCallback(() => toPage({ view: 'nomenclature' }), [toPage]);
  const openExpression = useCallback(() => toPage({ view: 'expression' }), [toPage]);

  const openLibrary = useCallback(({ datasetId = null, categories = null }: LibraryEntry = {}) => {
    toPage({ view: 'library', datasetId, categories: categories?.length ? [...categories] : null });
  }, [toPage]);

  const setLibraryDataset = useCallback((datasetId: string | null) => {
    setPage((state) => ({ ...state, libraryDatasetId: datasetId }));
  }, []);

  // An empty rail is "all categories", which is what a scopeless URL means, so
  // clearing the last checkbox has to shorten the URL rather than write an empty
  // `/in/` segment that would not round-trip.
  const setLibraryCategories = useCallback((categories: DatasetCategory[]) => {
    setPage((state) => ({ ...state, libraryCategories: categories.length ? categories : null }));
  }, []);

  // The compare set as a VIEW. Its columns are resolved against the registry
  // the same way a link's are; fewer than one usable column is not a
  // comparison, so that lands in the library instead.
  const openCompareSet = useCallback((items: readonly CompareSetRouteItem[]) => {
    toPage(compareSetPage(items));
  }, [toPage]);

  // The view reporting a column removed. Same floor: an emptied set leaves.
  const setCompareSetItems = useCallback((items: readonly CompareSetItem[]) => {
    if (!items.length) { toPage(PLAIN_LIBRARY); return; }
    setPage((state) => ({ ...state, compareSetItems: [...items] }));
  }, [toPage]);

  // ── Reading the URL ────────────────────────────────────────────────────────

  // Validating a track requires loading the dataset's metadata, so a route can
  // still be in flight when the next one arrives. Each attempt claims a
  // generation and abandons itself if a newer one has started, so the route that
  // navigates is the one the user asked for LAST, not whichever metadata
  // happened to resolve last. The counter is bumped before landing, so even a
  // route that turns out to be invalid supersedes a pending one rather than
  // landing after the user has moved on.
  const generation = useRef(0);

  /** Carry out a landing that needs nothing more. */
  const settle = useCallback((landing: Settled) => {
    switch (landing.kind) {
      case 'ignore':
        break;
      case 'stay':
        replaceNextWrite.current = true;
        setReconcile((n) => n + 1);
        break;
      case 'refuse':
        setRouteError(REFUSAL_MESSAGE[landing.refusal]);
        break;
      case 'page':
        setPage((state) => applyPage(state, landing.page));
        if (landing.chartScale) setChartScale(landing.chartScale);
        break;
      case 'explorer':
        explorerRef.current.navigate(landing.intent);
        setPage((state) => ({ ...state, view: 'explorer' }));
        break;
    }
    setRoutePending(false);
  }, []);

  /** Carry out a landing for one attempt, checking a named track first. */
  const land = useCallback((landing: Landing, attempt: number) => {
    if (landing.kind !== 'verify') { settle(landing); return; }
    const { route, dataset } = landing;
    setRoutePending(true);
    loadDatasetMeta(dataset).then(
      (meta) => { if (attempt === generation.current) settle(settleExplorer(route, dataset, meta.populations ?? [])); },
      () => { if (attempt === generation.current) settle(settleExplorer(route, dataset, null)); },
    );
  }, [settle]);

  // The boot route's remainder. The page and any refusal were landed
  // synchronously in bootFrom; what is left is the chart scale a page link
  // carries, and telling the shell where to be, which can only happen once it
  // exists. A refused link applies nothing, its chart scale included.
  // Mount only: re-applying the URL the app was OPENED at would fight every
  // later track and tab click the user makes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount only; see above
  useEffect(() => {
    const attempt = ++generation.current;
    const landing = boot.landing;
    if (!landing || landing.kind === 'refuse') { setRoutePending(false); return; }
    if (landing.kind === 'page') {
      if (landing.chartScale) setChartScale(landing.chartScale);
      setRoutePending(false);
      return;
    }
    land(landing, attempt);
  }, []);

  // User-driven URL changes: Back/Forward, an edited address bar, a pasted link
  // into the open tab. Our own writes go through history.pushState, which fires
  // neither event, so nothing here ever sees an echo of a route we wrote.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onNavigate = () => {
      const attempt = ++generation.current;
      setRouteError(null);
      const hash = window.location.hash;
      // A retired search landing (`#/gene`, `#/pathway`) is swapped for the
      // search page's own address in place: no history entry is left naming it,
      // and the address bar is corrected even when search is already showing.
      const route = parseRoute(hash);
      if (route && isRetiredSearchLanding(hash)) window.history.replaceState(null, '', routeHref(route));
      land(landHash(hash), attempt);
    };
    window.addEventListener('hashchange', onNavigate);
    window.addEventListener('popstate', onNavigate);
    return () => {
      window.removeEventListener('hashchange', onNavigate);
      window.removeEventListener('popstate', onNavigate);
    };
  }, [land]);

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
      case 'methodology':
        return routeHref({ view: 'methodology' });
      case 'verification':
        return routeHref({ view: 'verification' });
      case 'nomenclature':
        return routeHref({ view: 'nomenclature' });
      case 'expression':
        return routeHref({ view: 'expression' });
      case 'tracker':
        return routeHref({ view: 'tracker', acc: trackerSelectedAcc });
      case 'search':
        return routeHref({ view: 'search', query: searchQuery, filter: searchFilter });
      case 'library':
        return routeHref({ view: 'library', datasetId: libraryDatasetId, categories: libraryCategories });
      // A report always names its term; the guards narrow the shared state to
      // `string`. A term-less report is never entered, so it never writes.
      case 'report':
        // The selection's link form supplies the path scope and the snapshot.
        return reportGene ? routeHref({ view: 'report', gene: reportGene, scope: null,
          ...selectionLink('gene', geneStudySelection, chartScale) }) : null;
      case 'pathway-report':
        return reportPathway ? routeHref({ view: 'pathway-report', pathway: reportPathway,
          ...selectionLink('pathway', pathwayStudySelection, chartScale) }) : null;
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
            ...(explorerAt.compare ? { compare: explorerAt.compare } : {}),
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
  }, [view, reportGene, reportPathway, trackerSelectedAcc, libraryDatasetId, libraryCategories, compareSetItems, searchQuery, searchFilter, explorerAt, geneStudySelection, pathwayStudySelection, chartScale]);

  // Normalizing the URL on arrival must not push a synthetic entry behind the
  // user's first page — Back from it would land back on the site instead of
  // leaving it — so the first sync replaces and every later one pushes.
  const hasWritten = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `reconcile` re-runs the write after a 'stay' landing, which changes no other state
  useEffect(() => {
    if (typeof window === 'undefined' || targetHash === null) return;
    // Never write over a route that is still landing: the shell is reporting its
    // OLD position, and writing it would overwrite the link being followed.
    if (routePending || routeError) return;
    const replace = replaceNextWrite.current;
    replaceNextWrite.current = false;
    if (window.location.hash === targetHash) { hasWritten.current = true; return; }
    // A hub URL is the fragment-less root, which pushState can only produce from
    // an explicit path (passing '' or '#' would keep the current fragment).
    const url = targetHash || `${window.location.pathname}${window.location.search}`;
    const settingsOnly = window.location.hash.split('?')[0] === targetHash.split('?')[0];
    if (hasWritten.current && !settingsOnly && !replace) window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
    hasWritten.current = true;
  }, [targetHash, routePending, routeError, reconcile]);

  return {
    view, routeError, reportGene, reportPathway, trackerSelectedAcc, libraryDatasetId, libraryCategories,
    compareSetItems, searchQuery, searchFilter,
    geneStudySelection, pathwayStudySelection, setGeneStudySelection, setPathwayStudySelection,
    goHome, enterTool, enterExplorer, searchGene, searchPathway, search, setSearchFilter,
    openTracker, openInExplorer, openMethodology, openVerification, openNomenclature, openExpression, openLibrary,
    setLibraryDataset, setLibraryCategories,
    openCompareSet, setCompareSetItems,
  };
}
