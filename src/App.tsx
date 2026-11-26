import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { useSurveyHandoff } from './expression-survey/useSurveyHandoff';
import { useAppRouter } from './appRouter';
import { getDefaultDataset, getDataset, listDatasets } from './data/datasets';
import { ErrorBoundary } from './ErrorBoundary';
import { UpdateModal } from './pwa/UpdateModal';
import { LandingHub } from './hub/LandingHub';
import type { NavigationIntent } from './explorer/explorerPosition';
import { useExplorer } from './explorer/useExplorer';
import { ExplorerShell } from './explorer/ExplorerShell';
import { preloadBarSEMChart } from './gene-explorer/BarSEMChart';
import { ShareAnalysisButton } from './common/ShareAnalysisButton';
import { CompareSetButton } from './compareset/CompareSetButton';
import { compareSetKey, removeItem, type CompareSetItem } from './compareset/compareSetStore';
import type { SurveyScope } from './expression-survey/expressionSurvey';
import {
  CompareSetView, DatasetLibrary, DatasetTrackerView, GeneReport, MethodologyView, NomenclatureView,
  PathwayReport, SearchPage, VerificationView,
} from './appViews';
import { preloadWhenIdle } from './common/lazyView';

const DEFAULT_DATASET = getDefaultDataset();

const ExpressionSurveyView = lazy(() => import('./expression-survey/ExpressionSurveyView').then((module) => ({ default: module.ExpressionSurveyView })));

interface AppProps {
  initialView?: string;
}

// The new-version prompt is mounted here, once, above the view switch, so every
// route shows it (the full-page views and the route-error page included) and it
// keeps its countdown across navigation instead of remounting with each view.
export default function App(props: AppProps = {}) {
  return (
    <>
      <UpdateModal />
      <AppViews {...props} />
    </>
  );
}

function AppViews({ initialView = 'hub' }: AppProps) {
  // ── The explorer ────────────────────────────────────────────────────
  // Where it is, what the user configured in it, what it has loaded, and how
  // one navigation intent moves all three (explorer/useExplorer.ts). Held here,
  // above the view switch, because the router delivers intents while the
  // explorer is off screen and its position and session survive a trip to a
  // report and back. App reads none of it: `nav` and `at` go to the router,
  // `screen` to ExplorerShell.
  const explorer = useExplorer(DEFAULT_DATASET);
  const { showActiveTrack } = explorer;

  // The changelog and the study-details disclosure outlive a visit to the
  // explorer: the hub opens the changelog and then enters, and the disclosure
  // stays open as a reviewer steps from study to study through the library.
  const [showChangelog, setShowChangelog] = useState(false);
  const [showStudyDetails, setShowStudyDetails] = useState(false);

  // ── Navigation ──────────────────────────────────────────────────────
  // Where the user is lives in the router; how an explorer route lands is the
  // explorer position's. `explorer.nav` is the seam between the two: the router
  // hands over one whole intent and never sets a position field itself, and
  // reads back `explorer.at` to put it in the URL.
  const {
    view, routeError, reportGene, reportPathway, trackerSelectedAcc,
    goHome, enterTool, enterExplorer,
    searchGene: searchGeneFromHub,
    searchPathway: searchPathwayFromHub,
    openTracker, openInExplorer, openMethodology, openVerification, openNomenclature, openExpression,
    openLibrary, setLibraryDataset, setLibraryCategories, libraryDatasetId, libraryCategories,
    compareSetItems, openCompareSet, setCompareSetItems,
    geneStudySelection, pathwayStudySelection, setGeneStudySelection, setPathwayStudySelection,
    searchQuery, searchFilter, search, setSearchFilter, supersede,
  } = useAppRouter(initialView, explorer.nav, explorer.at);

  // The explorer screen's own controls are user-originated changes the router
  // does not make itself, so each retires any link still landing before it
  // moves the explorer; otherwise that link's metadata check could resolve
  // afterwards and drag the shell back. This is the one place both halves
  // meet: the screen gets only this, and intents the router delivers go
  // through `explorer.nav` untouched (a landing must not cancel itself).
  const { navigate } = explorer.nav;
  const navigateByUser = useCallback((intent: NavigationIntent) => {
    supersede();
    navigate(intent);
  }, [supersede, navigate]);

  // A column removed inside the compare-set view leaves the ROUTE and the set
  // in step: whatever the view dropped comes out of the set too, if it was
  // there. Columns a shared link named that were never in the set are not
  // touched, since they were never in it.
  const changeCompareSetItems = useCallback((next: readonly CompareSetItem[]) => {
    const keep = new Set(next.map(compareSetKey));
    for (const item of compareSetItems) if (!keep.has(compareSetKey(item))) removeItem(item);
    setCompareSetItems(next);
  }, [compareSetItems, setCompareSetItems]);
  const openLibraryPlain = useCallback(() => openLibrary(), [openLibrary]);
  // A single gene surveyed on the expression survey page opens its gene page,
  // whose expression card surveys every source in the scope the page had; the
  // handover lasts only for that visit (useSurveyHandoff).
  const { handOff: handOffSurvey, scopeFor: handedSurveyScope } = useSurveyHandoff(view, reportGene);
  const openGeneSurvey = useCallback((gene: string, scope: SurveyScope) => {
    handOffSurvey(gene, scope);
    searchGeneFromHub(gene);
  }, [handOffSurvey, searchGeneFromHub]);

  // The hub's search box submits to the unified results page.
  const searchFromHub = useCallback((query: string) => search(query), [search]);

  // Load the active track whenever the explorer is on screen.
  //
  // This is what replaced index.html's eager <script> tags. Before, the default
  // track arrived synchronously as a window global and trackCache was seeded from
  // it in useState — so no code path ever had to ask for it. Every other entry
  // point assumes that seed still happens: a tab intent on the current track
  // loads nothing, and re-selecting the active track is effect-free (which it is
  // on mount — the position starts at the dataset's defaultTrack). Without this
  // effect, hub → "Gene Explorer" would render the loading skeleton forever.
  // src/__tests__/setup.ts seeds those same globals, so most App tests keep the
  // synchronous seed; explorerTrackLoad.test.tsx runs without it.
  //
  // It stays here, declared after the router, rather than in ExplorerShell: a
  // child's effects run before its parent's, and this one must run after the
  // router's boot effect has landed a link (the overlay a deep link shows
  // depends on which load is started last). Skipped on the hub so the landing
  // page still touches no bundle; `showActiveTrack` skips Compare, which has no
  // bundle of its own (CompareTab lazy-loads the populations the user selects).
  useEffect(() => {
    if (view !== 'explorer') return;
    // Warm the recharts chunk alongside the track. Both are needed to draw a
    // gene's bars, and neither is needed on the hub — starting the download here
    // overlaps it with the user picking a gene instead of stalling once they
    // have. No-op after the first call, and never reached from the hub.
    // Swallow the rejection: this is fire-and-forget, so a failed chunk fetch
    // (offline, or a deploy that rotated the hashed filename under a long-open
    // tab) would otherwise surface as an unhandled promise rejection outside any
    // React error boundary. The chart's own Suspense boundary handles the real
    // failure when one actually mounts.
    preloadBarSEMChart().catch(() => { /* chart chunk warms on demand instead */ });
    showActiveTrack();
  }, [view, showActiveTrack]);

  // Warm the view a visitor most likely opens next, once the current one has
  // painted and the main thread is idle: the hub's search box submits to the
  // results page, and a results row opens the gene report. Every view still
  // loads on demand if this has not run (or failed).
  useEffect(() => {
    if (view === 'hub') return preloadWhenIdle(SearchPage);
    if (view === 'search') return preloadWhenIdle(GeneReport, PathwayReport);
    return undefined;
  }, [view]);

  // ── Full-page views outside the explorer shell ──
  // A refused link applies nothing, so the view it was followed from is still
  // set; the error page goes ahead of every view, or that view would hide it.
  if (routeError) return (
    <main style={{ maxWidth: 640, margin: '64px auto', padding: 24 }}>
      <h1>Analysis link unavailable</h1>
      <p role="alert">{routeError}</p>
      <button type="button" onClick={goHome}>Return home</button>
    </main>
  );

  if (view === 'expression') {
    return <ErrorBoundary><Suspense fallback={<div role="status" style={{ padding: 32 }}>Opening expression survey…</div>}><ExpressionSurveyView onHome={goHome} onOpenGene={openGeneSurvey} /></Suspense></ErrorBoundary>;
  }

  // Cross-dataset gene report (#/gene/<symbol>), opened from search results.
  const geneReport = (gene: string) => (
    // Keyed on the term alone, as the pathway report is: a study-selection
    // change re-queries in place and keeps the report's own state (the typed
    // search text, the open Study filters, the loaded expression cards); a new
    // gene starts a fresh report.
    <ErrorBoundary key={`report-${gene}`}>
      <GeneReport
        gene={gene}
        selection={geneStudySelection}
        onSelectionChange={setGeneStudySelection}
        onHome={goHome}
        onSearchGene={searchGeneFromHub}
        onOpenDataset={openInExplorer}
        onShowPathway={(pathwayId) => search(pathwayId, 'all')}
        onOpenPathway={(pathwayId) => searchPathwayFromHub(pathwayId)}
        onOpenExpression={openExpression}
        expressionScope={handedSurveyScope(gene)}
        headerRight={<><ShareAnalysisButton /><CompareSetButton onCompare={openCompareSet} onOpenLibrary={openLibraryPlain} /></>}
      />
    </ErrorBoundary>
  );
  const pathwayReport = (pathway: string) => (
    <ErrorBoundary key={`pathway-${pathway}`}>
      <PathwayReport
        pathway={pathway}
        selection={pathwayStudySelection}
        onSelectionChange={setPathwayStudySelection}
        onHome={goHome}
        onSearchPathway={searchPathwayFromHub}
        headerRight={<><ShareAnalysisButton /><CompareSetButton onCompare={openCompareSet} onOpenLibrary={openLibraryPlain} /></>}
      />
    </ErrorBoundary>
  );

  // A report always names its term. The router never opens one without it; a
  // term-less report state is shown as the hub rather than the explorer shell.
  if (view === 'report' && reportGene) return geneReport(reportGene);
  if (view === 'pathway-report' && reportPathway) return pathwayReport(reportPathway);
  const termlessReport = view === 'report' || view === 'pathway-report';

  // ── Unified search results (the hub box's destination) ──────────────
  // Keyed by the query alone: a new search starts the page fresh, while
  // switching All / Genes / Pathways keeps it mounted.
  if (view === 'search') {
    return (
      <ErrorBoundary key={`search-${searchQuery}`}>
        <SearchPage
          query={searchQuery}
          filter={searchFilter}
          onSearch={search}
          onFilterChange={setSearchFilter}
          onHome={goHome}
          onOpenGene={(symbol) => searchGeneFromHub(symbol)}
          onOpenPathway={(pathwayId) => searchPathwayFromHub(pathwayId)}
          headerRight={<CompareSetButton onCompare={openCompareSet} onOpenLibrary={openLibraryPlain} />}
        />
      </ErrorBoundary>
    );
  }

  // ── Dataset Tracker (cross-dataset coverage view; read-only on the public
  //    site, review-editable under the dev server) ──────────────────────
  if (view === 'tracker') {
    return (
      <ErrorBoundary key="tracker">
        <DatasetTrackerView onHome={goHome} onOpenInExplorer={openInExplorer} initialSelectedAcc={trackerSelectedAcc} />
      </ErrorBoundary>
    );
  }


  if (view === 'methodology') {
    return (
      <ErrorBoundary key="methodology">
        <MethodologyView onHome={goHome} />
      </ErrorBoundary>
    );
  }

  if (view === 'verification') {
    return (
      <ErrorBoundary key="verification">
        <VerificationView onHome={goHome} />
      </ErrorBoundary>
    );
  }

  // ── Gene nomenclature reference (dataset-agnostic reference page) ────
  if (view === 'nomenclature') {
    return (
      <ErrorBoundary key="nomenclature">
        <NomenclatureView onHome={goHome} onSearchGene={searchGeneFromHub} />
      </ErrorBoundary>
    );
  }

  // ── Compare set (studies and populations side by side) ──────────────
  // Keyed by the view alone, not by its columns: removing a column must not
  // remount the view and drop the gene selection — the loader hook takes the
  // new list and keeps every column it already has.
  if (view === 'compare-set') {
    return (
      <ErrorBoundary key="compare-set">
        <CompareSetView
          items={compareSetItems}
          onItemsChange={changeCompareSetItems}
          onHome={goHome}
          onOpenDataset={openInExplorer}
          onOpenLibrary={openLibraryPlain}
          headerRight={<CompareSetButton onCompare={openCompareSet} onOpenLibrary={openLibraryPlain} />}
        />
      </ErrorBoundary>
    );
  }

  // ── Dataset library (browse the corpus) ─────────────────────────────
  // `openInExplorer` is the only way out of here into a dataset, so the library
  // crosses the same explorer-session seam as the reports, the tracker and the
  // deep links — it does not reimplement any part of the explorer position.
  if (view === 'library') {
    return (
      <ErrorBoundary key="library">
        <DatasetLibrary
          onHome={goHome}
          // The default track is passed EXPLICITLY: the library opens a study
          // at its front door. An open naming no track keeps the current track
          // when the dataset is already active (the explorer position's rule),
          // which suits a report row but not a fresh look at a study record.
          onOpenInExplorer={(id) => openInExplorer(id, getDataset(id)?.defaultTrack)}
          onOpenTracker={(acc) => openTracker(acc)}
          onCompareSet={openCompareSet}
          initialSelectedId={libraryDatasetId}
          initialCategories={libraryCategories}
          // Keep the URL pointing at what is actually on screen. Both are
          // updates from INSIDE the library, so each leaves the other alone —
          // picking a study must not drop the scope you arrived with.
          onSelectedIdChange={setLibraryDataset}
          onCategoriesChange={setLibraryCategories}
        />
      </ErrorBoundary>
    );
  }

  // ── Landing hub (default view) ──────────────────────────────────────
  if (view === 'hub' || termlessReport) {
    return (
      <LandingHub
        onHome={goHome}
        datasets={listDatasets()}
        onEnterTool={enterTool}
        onSearch={searchFromHub}
        onOpenTracker={openTracker}
        onOpenLibrary={(categories) => openLibrary({ categories })}
        onOpenMethodology={openMethodology}
        onOpenVerification={openVerification}
        onOpenNomenclature={openNomenclature}
        onOpenExpression={openExpression}
        onChangelog={() => { setShowChangelog(true); enterExplorer(); }}
        onCompareSet={openCompareSet}
      />
    );
  }

  // ── The explorer screen ─────────────────────────────────────────────
  // Every other view has its boundary; so does this one, so a throw in the
  // sidebar, the hero or the study line no longer blanks the page.
  return (
    <ErrorBoundary key="explorer">
      <ExplorerShell
        screen={explorer.screen}
        onNavigate={navigateByUser}
        onHome={goHome}
        onOpenLibrary={openLibrary}
        onOpenCompareSet={openCompareSet}
        onOpenMethodology={openMethodology}
        onOpenTracker={openTracker}
        changelogOpen={showChangelog}
        setChangelogOpen={setShowChangelog}
        studyDetailsOpen={showStudyDetails}
        setStudyDetailsOpen={setShowStudyDetails}
      />
    </ErrorBoundary>
  );
}
