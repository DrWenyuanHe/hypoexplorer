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
//   * ONE NAVIGATION ATTEMPT AT A TIME. Every URL event, every router verb and
//     every user-originated change reported to the router (`supersede`) starts
//     an attempt: it retires the one before, clears the pending flag and the
//     refusal, and sets the attempt's WRITE POLICY. Only the newest attempt's
//     metadata check may move the app, so a link still landing can never
//     overwrite a click, search or Home made after it. Intents the router
//     itself delivers to the explorer never start one: a landing cannot
//     cancel itself.
//   * THE WRITE POLICY BELONGS TO THE ATTEMPT. A followed URL (boot,
//     Back/Forward, a pasted or edited address) REPLACES: the browser already
//     made its entry, so the canonical form is written in place and Back never
//     lands on a raw link that pushes its own canonical form behind itself. A
//     user action PUSHES. A fragment the router does not recognize (an in-page
//     anchor) HOLDS: nothing is written over it until the page itself changes.
//     The write consumes the policy, and so do a hash that already matches and
//     a refusal; a change that moves only settings (the query) still replaces.
//
// What a route MEANS (the registry checks, refusals, the default track, the
// page it opens) is decided in routeLanding.ts, the one reader for boot and
// for every later URL. This file is its driver: it holds the state, loads a
// dataset's metadata when a named track has to be checked, and writes history.

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { DatasetCategory } from './data/datasets';
// The explorer's side of the seam: the router states intents through one and reads the other.
import type { ExplorerAt, ExplorerNavigation } from './explorer/useExplorer';
import { loadDatasetMeta } from './data/loadDatasetMeta';
import type { CompareSetRouteItem } from './utils/appLinks';
import type { CompareSetItem } from './compareset/compareSetStore';
import type { StudySelection } from './crossdataset/studySelectionLink';
import { setChartScale, useChartScale } from './common/chartScaleStore';
import type { SearchFilter } from './search/searchTypes';
import {
  applyPage, compareSetPage, initialPage, landHash, landRoute, REFUSAL_MESSAGE, routeOf, settleExplorer,
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
  /**
   * Open a dataset in the explorer. With no track it keeps the track already
   * open in that dataset (a report's dataset link). A named track is checked
   * against the dataset's metadata exactly as a followed `#/dataset/<id>/<track>`
   * link is, so a track the dataset lacks lands on its default.
   */
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
  /**
   * Retire whatever navigation attempt is in flight, for a user-originated
   * change the router does not make itself: the shell's track, tab and
   * contrast controls call this and then their own `navigate`. The next write
   * pushes. Referentially stable. Never call it from the explorer adapter: an
   * intent the router delivers would cancel its own landing.
   */
  supersede: () => void;
  /**
   * True while a route read from the URL has not finished landing: the boot
   * route until the mount effect has delivered it, and a link naming a track
   * until that track's check settles. Where the explorer is may still change,
   * so App holds its active-track load until this clears.
   */
  routePending: boolean;
}

/**
 * How the current attempt's next URL write lands in history: `push` a new
 * entry, `replace` the one the browser made for a followed URL, or `hold` the
 * address bar on a fragment the router does not recognize.
 */
type WritePolicy = 'push' | 'replace' | 'hold';

/** The one navigation attempt in flight. */
interface Attempt {
  id: number;
  policy: WritePolicy;
  /** Under `hold`, the target hash at the time of the ignore; a different target releases it. */
  heldAt: string | null;
}

/** True when two page states name the same page, so a view's report of one is no change. */
const samePage = (a: PageState, b: PageState) => a === b || JSON.stringify(a) === JSON.stringify(b);

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
  const [page, setPageState] = useState<PageState>(boot.page);
  const [routeError, setRouteError] = useState(boot.routeError);
  const {
    view, reportGene, reportPathway, geneStudySelection, pathwayStudySelection, trackerSelectedAcc,
    libraryDatasetId, libraryCategories, compareSetItems, searchQuery, searchFilter,
  } = page;

  // The page as last set, read synchronously, so a view's report can be
  // compared with it before it is allowed to start an attempt. Every page
  // change goes through `setPage`, which keeps the two in step.
  const pageRef = useRef(page);
  const setPage = useCallback((next: (state: PageState) => PageState) => {
    const value = next(pageRef.current);
    if (value === pageRef.current) return;
    pageRef.current = value;
    setPageState(value);
  }, []);

  // True while a route read out of the URL has not finished landing in the app.
  // Starts true because the boot route is one, and gates every URL write — see
  // the header. State rather than a ref, so clearing it re-runs the write effect
  // instead of leaving the address bar one interaction stale.
  const [routePending, setRoutePending] = useState(true);

  // A landing can leave the page state exactly as it was (a dead link, Back
  // onto a non-canonical spelling of the page already showing), so the write
  // effect needs a nudge to put the canonical address back.
  const [reconcile, setReconcile] = useState(0);

  // The explorer adapter is read through a ref so the navigation verbs stay
  // referentially stable: the shell rebuilds its callbacks whenever its own state
  // changes, and without this every verb would change identity with it — churning
  // the hub's memoized tiles on every unrelated explorer keystroke.
  const explorerRef = useRef(explorer);
  useEffect(() => { explorerRef.current = explorer; }, [explorer]);

  // ── Navigation attempts ────────────────────────────────────────────────────

  // The boot route is attempt 0, and it writes by replace: the URL the app was
  // opened at is normalized in place, never pushed behind (or Back would land
  // the user on the site instead of leaving it). A no-hash mount is a URL
  // attempt too, so the initialView it names is written the same way.
  const attempt = useRef<Attempt>({ id: 0, policy: 'replace', heldAt: null });

  // The hash the app currently names, for an ignored fragment to hold against.
  // Set below, once it is computed for this render.
  const targetHashRef = useRef<string | null>(null);

  /** Start a navigation attempt: retire the one in flight and say how this one writes. */
  const begin = useCallback((policy: WritePolicy) => {
    attempt.current = { id: attempt.current.id + 1, policy, heldAt: null };
    setRouteError(null);
    setRoutePending(false);
    return attempt.current.id;
  }, []);

  const supersede = useCallback(() => { begin('push'); }, [begin]);

  /** Carry out a landing that needs nothing more. */
  const settle = useCallback((landing: Settled) => {
    switch (landing.kind) {
      case 'ignore':
        // Not a route: leave the view, and the fragment, alone.
        attempt.current.policy = 'hold';
        attempt.current.heldAt = targetHashRef.current;
        return;
      case 'refuse':
        setRouteError(REFUSAL_MESSAGE[landing.refusal]);
        return;
      case 'stay':
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
    setReconcile((n) => n + 1);
  }, [setPage]);

  /**
   * Carry out a landing for one attempt, checking a named track first. The
   * check is the only asynchronous step, and its continuation runs only while
   * its attempt is still the newest.
   */
  const land = useCallback((landing: Landing, id: number) => {
    if (landing.kind !== 'verify') { settle(landing); return; }
    const { route, dataset } = landing;
    setRoutePending(true);
    const finish = (populations: readonly string[] | null) => {
      if (id !== attempt.current.id) return;
      settle(settleExplorer(route, dataset, populations));
      setRoutePending(false);
    };
    loadDatasetMeta(dataset).then((meta) => finish(meta.populations ?? []), () => finish(null));
  }, [settle]);

  /** A verb's page: a user attempt, landed the same way a URL lands it. */
  const go = useCallback((landing: PageLanding) => {
    begin('push');
    setPage((state) => applyPage(state, landing));
  }, [begin, setPage]);

  /**
   * A view reporting a change from inside itself. It starts an attempt only
   * when the page actually changes: views report their state on mount, and an
   * echo of the props a view was opened with must not cancel a landing.
   */
  const report = useCallback((next: (state: PageState) => PageState) => {
    const value = next(pageRef.current);
    if (samePage(value, pageRef.current)) return;
    begin('push');
    setPage(() => value);
  }, [begin, setPage]);

  // ── The verbs ──────────────────────────────────────────────────────────────

  const goHome = useCallback(() => go({ view: 'hub' }), [go]);
  const enterExplorer = useCallback(() => {
    begin('push');
    setPage((state) => ({ ...state, view: 'explorer' }));
  }, [begin, setPage]);

  const enterTool = useCallback((tab: string) => {
    begin('push');
    explorerRef.current.navigate({ type: 'tab', tab });
    setPage((state) => ({ ...state, view: 'explorer' }));
  }, [begin, setPage]);

  // A gene search. The report lazy-loads every track on first query, then
  // caches. A null/omitted scope means "all categories"; the gene report's own
  // search box passes the categories it is reading under. Only the categories
  // change: the individual studies and filters chosen on the report carry over.
  const searchGene = useCallback((gene: string, scope: DatasetCategory[] | null = null) => {
    begin('push');
    setPage((state) => ({
      ...state, view: 'report', reportGene: gene,
      geneStudySelection: { ...state.geneStudySelection, categories: scope?.length ? [...scope] : null },
    }));
  }, [begin, setPage]);

  // The pathway analog: a pathway search lands in the FGSEA cross-dataset
  // report. Pathway-capable datasets only. Its selection carries over.
  const searchPathway = useCallback((pathway: string) => {
    begin('push');
    setPage((state) => ({ ...state, view: 'pathway-report', reportPathway: pathway }));
  }, [begin, setPage]);

  // The unified search: one query, genes and pathways side by side. Trimmed
  // here as well as in the landing, so the state always equals what the URL
  // can carry and Back/Forward restores exactly what was on screen.
  const search = useCallback((query: string, filter: SearchFilter = 'all') => {
    go({ view: 'search', query: query.trim(), filter });
  }, [go]);

  // An update from INSIDE the results page, so the query is left alone.
  const setSearchFilter = useCallback((filter: SearchFilter) => {
    report((state) => ({ ...state, searchFilter: filter }));
  }, [report]);

  const setGeneStudySelection = useCallback((action: SetStateAction<StudySelection>) => {
    report((state) => ({
      ...state, geneStudySelection: typeof action === 'function' ? action(state.geneStudySelection) : action,
    }));
  }, [report]);
  const setPathwayStudySelection = useCallback((action: SetStateAction<StudySelection>) => {
    report((state) => ({
      ...state, pathwayStudySelection: typeof action === 'function' ? action(state.pathwayStudySelection) : action,
    }));
  }, [report]);

  const openTracker = useCallback((acc: string | null = null) => go({ view: 'tracker', acc }), [go]);

  // Reached from the tracker's dossiers and the cross-dataset report's dataset
  // and track links. With no track named it is an in-app command that keeps the
  // track already open in that dataset. A named track is checked the way a
  // followed link's is (through the dataset's metadata, usually cached by the
  // page offering the link), so the caller need not vouch for it, and a later
  // click can supersede the check while it is in flight.
  const openInExplorer = useCallback((datasetId: string, trackId?: string) => {
    const id = begin('push');
    if (trackId === undefined) {
      explorerRef.current.navigate({ type: 'open', datasetId });
      setPage((state) => ({ ...state, view: 'explorer' }));
      return;
    }
    land(landRoute({ view: 'explorer', datasetId, trackId }), id);
  }, [begin, land, setPage]);

  const openMethodology = useCallback(() => go({ view: 'methodology' }), [go]);
  const openVerification = useCallback(() => go({ view: 'verification' }), [go]);
  const openNomenclature = useCallback(() => go({ view: 'nomenclature' }), [go]);
  const openExpression = useCallback(() => go({ view: 'expression' }), [go]);

  const openLibrary = useCallback(({ datasetId = null, categories = null }: LibraryEntry = {}) => {
    go({ view: 'library', datasetId, categories: categories?.length ? [...categories] : null });
  }, [go]);

  const setLibraryDataset = useCallback((datasetId: string | null) => {
    report((state) => ({ ...state, libraryDatasetId: datasetId }));
  }, [report]);

  // An empty rail is "all categories", which is what a scopeless URL means, so
  // clearing the last checkbox has to shorten the URL rather than write an empty
  // `/in/` segment that would not round-trip.
  const setLibraryCategories = useCallback((categories: DatasetCategory[]) => {
    report((state) => ({ ...state, libraryCategories: categories.length ? categories : null }));
  }, [report]);

  // The compare set as a VIEW. Its columns are resolved against the registry
  // the same way a link's are; fewer than one usable column is not a
  // comparison, so that lands in the library instead.
  const openCompareSet = useCallback((items: readonly CompareSetRouteItem[]) => {
    go(compareSetPage(items));
  }, [go]);

  // The view reporting a column removed. Same floor: an emptied set leaves.
  const setCompareSetItems = useCallback((items: readonly CompareSetItem[]) => {
    report((state) => (items.length ? { ...state, compareSetItems: [...items] } : applyPage(state, PLAIN_LIBRARY)));
  }, [report]);

  // ── Reading the URL ────────────────────────────────────────────────────────

  // The boot route's remainder. The page and any refusal were landed
  // synchronously in bootFrom; what is left is the chart scale a page link
  // carries, and telling the shell where to be, which can only happen once it
  // exists. A refused link applies nothing, its chart scale included.
  // Mount only: re-applying the URL the app was OPENED at would fight every
  // later track and tab click the user makes. The boot attempt keeps its
  // replace policy, and its refusal, so it does not go through `begin`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount only; see above
  useEffect(() => {
    const id = ++attempt.current.id;
    const landing = boot.landing;
    if (landing?.kind === 'verify') { land(landing, id); return; }
    if (landing?.kind === 'page') {
      if (landing.chartScale) setChartScale(landing.chartScale);
    } else if (landing && landing.kind !== 'refuse') {
      settle(landing);
    }
    setRoutePending(false);
  }, []);

  // User-driven URL changes: Back/Forward, an edited address bar, a pasted link
  // into the open tab. Our own writes go through history.pushState, which fires
  // neither event, so nothing here ever sees an echo of a route we wrote. The
  // browser has already made the entry, so the attempt writes by replace: a
  // retired or non-canonical spelling is corrected in place.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onNavigate = () => land(landHash(window.location.hash), begin('replace'));
    window.addEventListener('hashchange', onNavigate);
    window.addEventListener('popstate', onNavigate);
    return () => {
      window.removeEventListener('hashchange', onNavigate);
      window.removeEventListener('popstate', onNavigate);
    };
  }, [begin, land]);

  // ── Writing the URL ────────────────────────────────────────────────────────

  // The hash that names where the app currently is (routeLanding's routeOf,
  // the write side of the same module that reads a route).
  const targetHash = useMemo(() => routeOf(page, chartScale, explorerAt), [page, chartScale, explorerAt]);

  targetHashRef.current = targetHash;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `reconcile` re-runs the write after a landing that left the page state as it was
  useEffect(() => {
    if (typeof window === 'undefined' || targetHash === null) return;
    // Never write over a route that is still landing: the shell is reporting its
    // OLD position, and writing it would overwrite the link being followed.
    if (routePending) return;
    const current = attempt.current;
    // A refusal writes nothing, and spends its attempt's policy.
    if (routeError) { current.policy = 'push'; return; }
    if (current.policy === 'hold') {
      if (targetHash === current.heldAt) return;
      current.policy = 'push';
      current.heldAt = null;
    }
    const policy = current.policy;
    current.policy = 'push';
    if (window.location.hash === targetHash) return;
    // A hub URL is the fragment-less root, which pushState can only produce from
    // an explicit path (passing '' or '#' would keep the current fragment).
    const url = targetHash || `${window.location.pathname}${window.location.search}`;
    const settingsOnly = window.location.hash.split('?')[0] === targetHash.split('?')[0];
    if (policy === 'push' && !settingsOnly) window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
  }, [targetHash, routePending, routeError, reconcile]);

  return {
    view, routeError, reportGene, reportPathway, trackerSelectedAcc, libraryDatasetId, libraryCategories,
    compareSetItems, searchQuery, searchFilter,
    geneStudySelection, pathwayStudySelection, setGeneStudySelection, setPathwayStudySelection,
    goHome, enterTool, enterExplorer, searchGene, searchPathway, search, setSearchFilter,
    openTracker, openInExplorer, openMethodology, openVerification, openNomenclature, openExpression, openLibrary,
    setLibraryDataset, setLibraryCategories,
    openCompareSet, setCompareSetItems, supersede, routePending,
  };
}
