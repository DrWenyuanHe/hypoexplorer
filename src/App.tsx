import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from 'react';
import type { CSSProperties } from 'react';
import { trackColor } from './data/datasetMeta';
import { COLOR_WARNING_BG, COLOR_WARNING_TEXT, FONT_MONO, FONT_SANS } from './styles/constants';
import { popDataFor } from './data/trackData';
import { useExplorerStore } from './data/explorerStore';
import { useOriginDiagnosis } from './data/useOriginDiagnosis';
import { CLOUDFLARE_STATUS_URL, explainOrigin, shouldLinkStatusPage } from './data/originHealth';
import { useAppRouter } from './appRouter';
import { getDefaultDataset, getDataset, listDatasets } from './data/datasets';
import type { DatasetCategory } from './data/datasets';
import { nomenclatureAuthorityForStoredDatasetSymbols } from './data/nomenclature';
import { contrastArmCounts, getActiveContrast, listContrasts } from './data/contrasts';
import { getCellSubname } from './utils/format';
import { ErrorBoundary } from './ErrorBoundary';
import { PopWarningBadge } from './common/PopWarningBadge';
import { UpdateModal } from './pwa/UpdateModal';
import { VersionBadge } from './pwa/VersionBadge';
import { LoadingOverlay } from './common/LoadingOverlay';
import { Spinner } from './common/Spinner';
import { Skeleton } from './common/Skeleton';
import { BetaNotice } from './common/BetaNotice';
import { BrandLink } from './common/BrandLink';
import { LandingHub } from './hub/LandingHub';
import { CellNavigator } from './explorer/CellNavigator';
import { EXPLORER_TABS, DEFAULT_EXPLORER_TAB, explorerTabAvailable } from './explorer/explorerTabs';
import { COMPARE_TRACK, activeTabOf, activeTrackOf, initialPosition, useExplorerPosition, type NavigationIntent } from './explorer/explorerPosition';
import type { CompareViewState } from './utils/analysisState';
import { useExplorerSession } from './explorer/explorerSession';
import { preloadBarSEMChart } from './gene-explorer/BarSEMChart';
import { ArmPills, ArmVariesBadge, factsFromMeta } from './common/StudyMetadata';
import { datasetExternalLinks } from './utils/datasetLinks';
import type { GeneStudyFilters } from './crossdataset/geneStudyScope';
import { useCategoryScope } from './crossdataset/forestReport';
import { useChartScale, setChartScale } from './common/chartScaleStore';
import { ShareAnalysisButton } from './common/ShareAnalysisButton';
import { CompareSetButton } from './compareset/CompareSetButton';
import { CompareSetToggle } from './compareset/CompareSetToggle';
import { compareSetKey, removeItem, toggleItem, useCompareSet, type CompareSetItem } from './compareset/compareSetStore';
import type { PathwayRecordWithDb, PopData } from './types';
import {
  ChangelogTab, CircadianTab, CompareSetView, CompareTab, DatasetInfoPanel, DatasetLibrary, DatasetTrackerView,
  DatasetVerificationContext, GeneExplorerTab, GeneReport, MethodologyView, NomenclatureView, PathwayExplorerTab,
  PathwayReport, QCTab, SearchPage, VerificationView,
} from './appViews';
import { preloadWhenIdle } from './common/lazyView';
import './common/headerControl.css';

const DEFAULT_DATASET = getDefaultDataset();

// The hero's provenance controls (the paper link and Dataset info): one
// neutral bordered treatment, so neither reads as the view's one accent.
const HERO_LINK_STYLE: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, boxSizing: 'border-box', height: 22, padding: '0 8px',
  borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: FONT_SANS, lineHeight: 1,
  textDecoration: 'none', whiteSpace: 'nowrap', cursor: 'pointer',
  border: '1px solid var(--border-dark)', background: 'var(--bg-panel)', color: 'var(--text-mono)',
};
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
  // ── The explorer position ──────────────────────────────────────────
  // Dataset, track-or-Compare, contrast and tab are ONE value, moved only by
  // navigation intents (explorer/explorerPosition.ts). Every caller — the
  // sidebar, the tab bar, the QC tables, the router — sends an intent; the
  // position decides where it lands and what the move resets and loads, and
  // `navigate` below carries those effects out.
  const { position, apply: applyIntent } = useExplorerPosition(() => initialPosition(DEFAULT_DATASET));
  const activeDatasetId = position.datasetId;
  const dataset = useMemo(() => getDataset(activeDatasetId) || DEFAULT_DATASET, [activeDatasetId]);
  // Datasets with a single contrast never surface a selector; multi-contrast
  // datasets do.
  const contrast = useMemo(
    () => getActiveContrast(dataset, position.contrastId),
    [dataset, position.contrastId],
  );
  // Resolved contrasts for the selector (one entry per declared contrast).
  const datasetContrasts = useMemo(() => listContrasts(dataset), [dataset]);
  // Selector rows bucketed by their authored `group` (adjacent runs preserve
  // manifest order; `null` = ungrouped, rendered as flat options).
  const contrastOptGroups = useMemo(() => {
    const out: Array<{ group: string | null; contrasts: typeof datasetContrasts }> = [];
    for (const c of datasetContrasts) {
      const g = c.group ?? null;
      const last = out[out.length - 1];
      if (last && last.group === g) last.contrasts.push(c);
      else out.push({ group: g, contrasts: [c] });
    }
    return out;
  }, [datasetContrasts]);

  // The edges that still speak in track ids (the explorer store, the sidebar,
  // the URL) see Compare as COMPARE_TRACK.
  const activeTrackId = activeTrackOf(position);

  const [showChangelog, setShowChangelog] = useState(false);
  // The dataset-metadata panel (the hero's ⓘ button) — dataset-level provenance.
  const [showDatasetInfo, setShowDatasetInfo] = useState(false);
  // The study line's disclosure: region, preparation and the dataset's
  // verification record stay one click away instead of stacking above the data.
  const [showStudyDetails, setShowStudyDetails] = useState(false);

  // Everything the user has SELECTED or CONFIGURED inside the dataset: the gene
  // list, the volcano's metric and thresholds, the pathway selection/filters,
  // and the sidebar's track filter. Held here rather than in the tabs because
  // the tabs unmount on a tab switch — but App never READS any of it, so it is
  // one cohesive value per tab rather than ten raw setters. `resetFor` is the
  // single statement of what each navigation clears; see explorerSession.ts.
  const session = useExplorerSession<PathwayRecordWithDb>();
  const chartScale = useChartScale();
  const { genes: geneSelection, volcano, pathway, cellSearch, setCellSearch, resetFor } = session;

  // Which track-level tab is showing. Compare has none; the tab bar and the
  // breadcrumb are not rendered there, so they read the Gene Explorer default.
  const isCompare = position.focus.kind === 'compare';
  const [compareView, setCompareView] = useState<{ datasetId: string; view: CompareViewState; epoch: number }>(
    { datasetId: '', view: {}, epoch: 0 },
  );
  const activeTab = activeTabOf(position) ?? DEFAULT_EXPLORER_TAB;
  const isQC = activeTabOf(position) === 'qc';

  // Everything the explorer LOADS for the active dataset — its metadata, its QC
  // blob, and the cache of loaded tracks — plus the loading/error state of those
  // loads. App decides what is active; the store owns what follows from that,
  // including the stale-write guards that drop a load resolving after a switch.
  const {
    meta: datasetMeta, qc: datasetQC, getTrack, ensureTrack, loadingTrack, loadingProgress, loadError, retry: retryLoad,
  } = useExplorerStore({ dataset, activeTrackId, wantQC: isQC });

  // Data bundles come from a SEPARATE origin (the R2 custom domain). When that
  // origin is unreachable the app renders perfectly while every dataset fails,
  // which reads as "this site is broken" unless we say otherwise. Probe only
  // while an error is actually on screen.
  const originDiagnosis = useOriginDiagnosis(Boolean(loadError));
  const originExplanation = explainOrigin(originDiagnosis);

  // Build popData for the current track. Pass dataset + contrast so buildPopData
  // can expose resolved groups / groupSamples / sampleOrder. `getTrack`'s
  // identity changes with the cache, so this re-reads when a pathway sibling
  // hydrates after first paint.
  const popData = useMemo(
    () => popDataFor(getTrack(activeTrackId), dataset, contrast),
    [getTrack, activeTrackId, dataset, contrast],
  );

  // One popData slice per declared contrast (multi-contrast datasets only) —
  // the Gene Explorer's "Across comparisons" matrix reads a selected gene from
  // every angle of a factorial design at once. Cheap: the raw track is already
  // loaded, popCache memoizes per (raw, contrast), and the [] for
  // single-contrast datasets skips the transform entirely.
  const contrastSlices = useMemo(() => {
    if (datasetContrasts.length < 2) return [];
    const raw = getTrack(activeTrackId);
    if (!raw) return [];
    const out = [];
    for (const c of datasetContrasts) {
      const pd = popDataFor(raw, dataset, c);
      if (pd) out.push({ contrast: c, popData: pd });
    }
    return out;
  }, [datasetContrasts, getTrack, activeTrackId, dataset]);

  // Every explorer navigation goes through here: commit the intent's next
  // position, then carry out what the move costs — the session reset its scope
  // names (explorerSession's RESET_MATRIX) before any saved analysis is
  // restored over it, and the track bundle it needs. The load names its dataset
  // explicitly because `ensureTrack` is still bound to the OUTGOING dataset
  // until this render commits, and because a move can be made from a view
  // where the explorer's load effect does not run.
  const navigate = useCallback((intent: NavigationIntent) => {
    const { reset, load } = applyIntent(intent);
    if (reset) resetFor(reset);
    if (intent.type === 'open' && intent.analysis) {
      setChartScale(intent.analysis.chartScale ?? 'native');
      session.restoreAnalysis(intent.analysis);
    }
    // A Compare link (or Back/Forward onto one) restarts Compare on its view.
    if (intent.type === 'open' && intent.compareView) {
      const view = intent.compareView;
      setCompareView((prev) => ({ datasetId: intent.datasetId, view, epoch: prev.epoch + 1 }));
    }
    if (load) ensureTrack(load.trackId, load.dataset);
  }, [applyIntent, resetFor, session.restoreAnalysis, ensureTrack]);

  // Compare's view lives in CompareTab, which reports each change here so it
  // can ride in the URL and survive leaving Compare and coming back. `epoch`
  // remounts CompareTab when a link lands, since it reads its view only once.
  const onCompareViewChange = useCallback((view: CompareViewState) => {
    setCompareView((prev) => (prev.datasetId === activeDatasetId && JSON.stringify(prev.view) === JSON.stringify(view)
      ? prev : { datasetId: activeDatasetId, view, epoch: prev.epoch }));
  }, [activeDatasetId]);
  const compareViewHere = compareView.datasetId === activeDatasetId ? compareView.view : undefined;
  const selectTrack = useCallback((trackId: string) => navigate({ type: 'track', trackId }), [navigate]);
  const selectTab = useCallback((tab: string) => navigate({ type: 'tab', tab }), [navigate]);

  // Cross-tab action: merge a list of genes into the Gene Explorer selection
  // and switch to the Gene Explorer tab. Used by Pathway Explorer's
  // "Send leading-edge genes →" button.
  const { addMany: addGenes } = geneSelection;
  const sendGenesToGeneExplorer = useCallback((genes: string[]) => {
    if (!genes?.length) return;
    addGenes(genes);
    navigate({ type: 'tab', tab: 'gene' });
  }, [addGenes, navigate]);


  // ── Navigation ──────────────────────────────────────────────────────
  // Where the user is lives in the router; how an explorer route lands is the
  // explorer position's. The adapter is the seam between the two: the router
  // hands over one whole intent and never sets a position field itself.
  const explorerNav = useMemo(() => ({ navigate }), [navigate]);

  // What counts as non-default, and how it is written down, is the session's
  // call (explorerSession's `snapshot`, the inverse of `restoreAnalysis`); App
  // only supplies the two pieces the session does not hold.
  const { snapshot: snapshotAnalysis } = session;
  const explorerAnalysis = useMemo(() => snapshotAnalysis({
    contrastId: contrast?.id ?? null,
    defaultContrastId: getActiveContrast(dataset)?.id ?? null,
    chartScale,
  }), [snapshotAnalysis, contrast, dataset, chartScale]);

  // The read side of that same seam: where the explorer currently IS, so the
  // router can put it in the URL. These three stay shell state — they drive a
  // dozen behaviours that have nothing to do with routing — and the router only
  // ever reads them.
  const explorerAt = useMemo(
    () => ({
      datasetId: activeDatasetId, trackId: activeTrackId, tab: activeTab, analysis: explorerAnalysis,
      ...(isCompare && compareViewHere && Object.keys(compareViewHere).length ? { compare: compareViewHere } : {}),
    }),
    [activeDatasetId, activeTrackId, activeTab, explorerAnalysis, isCompare, compareViewHere],
  );

  const {
    view, routeError, reportGene, reportScope, reportPathway, trackerSelectedAcc,
    goHome, enterTool, enterExplorer,
    searchGene: searchGeneFromHub,
    searchPathway: searchPathwayFromHub,
    openTracker, openInExplorer, openMethodology, openVerification, openNomenclature, openExpression,
    openLibrary, setLibraryDataset, setLibraryCategories, libraryDatasetId, libraryCategories,
    compareSetItems, openCompareSet, setCompareSetItems,
    geneAnalysis, pathwayAnalysis, setGeneAnalysis, setPathwayAnalysis, setReportScope,
    searchQuery, searchFilter, search, setSearchFilter,
  } = useAppRouter(initialView, explorerNav, explorerAt);

  // The compare set, for the explorer topbar's toggle — subscribed here so the
  // toggle follows a change made from any other surface. The toggle names the
  // ACTIVE track, which is how a single macaque population gets into the set.
  const compareSet = useCompareSet();
  const topbarItem = useMemo<CompareSetItem>(
    () => ({ datasetId: dataset.id, trackId: activeTrackId }),
    [dataset.id, activeTrackId],
  );
  const topbarInSet = compareSet.some((it) => it.datasetId === topbarItem.datasetId && it.trackId === topbarItem.trackId);
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

  // The hub's search box submits to the unified results page.
  const searchFromHub = useCallback((query: string) => search(query), [search]);

  // Which studies the cross-dataset explorers are scoped to; null = all.
  //
  // The router owns these above the term-keyed report ErrorBoundaries, so they
  // survive searches and restore from copied analysis URLs. Keep independent
  // gene/pathway selections; these adapters expose the existing view contracts.
  const geneDatasetScope = geneAnalysis.datasetIds;
  const geneStudyFilters = geneAnalysis.filters;
  const pathwayDatasetScope = pathwayAnalysis.datasetIds;
  const pathwayStudyFilters = pathwayAnalysis.filters;
  const setGeneDatasetScope = useCallback<React.Dispatch<React.SetStateAction<string[] | null>>>((action) => {
    setGeneAnalysis((state) => ({ ...state, datasetIds: typeof action === 'function' ? action(state.datasetIds) : action }));
  }, [setGeneAnalysis]);
  const setPathwayDatasetScope = useCallback<React.Dispatch<React.SetStateAction<string[] | null>>>((action) => {
    setPathwayAnalysis((state) => ({ ...state, datasetIds: typeof action === 'function' ? action(state.datasetIds) : action }));
  }, [setPathwayAnalysis]);
  const setGeneStudyFilters = useCallback((filters: GeneStudyFilters) => {
    setGeneAnalysis((state) => ({ ...state, filters }));
  }, [setGeneAnalysis]);
  const setPathwayStudyFilters = useCallback((filters: GeneStudyFilters) => {
    setPathwayAnalysis((state) => ({ ...state, filters }));
  }, [setPathwayAnalysis]);
  const setPathwayCategories = useCallback((categories: DatasetCategory[] | null) => {
    setPathwayAnalysis((state) => ({ ...state, categories }));
  }, [setPathwayAnalysis]);
  // Preserve category selection through the same term-keyed remount and retries.
  const pathwayCategoryScope = useCategoryScope<DatasetCategory>(pathwayAnalysis.categories, setPathwayCategories);

  // Load the active track whenever the explorer is on screen.
  //
  // This is what replaced index.html's eager <script> tags. Before, the default
  // track arrived synchronously as a window global and trackCache was seeded from
  // it in useState — so no code path ever had to ask for it. Every other entry
  // point assumes that seed still happens: a tab intent on the current track
  // loads nothing, and re-selecting the active track is effect-free (which it is
  // on mount — the position starts at the dataset's defaultTrack). Without this
  // effect, hub → "Gene Explorer" would render the loading skeleton forever, and
  // nothing in the test suite would notice, because src/__tests__/setup.ts seeds
  // those same globals so App keeps its synchronous seed under test.
  //
  // Safe to fire on every render: ensureTrack short-circuits on both the cache
  // and the in-flight map, so a redundant call costs one Map lookup. Skipped on
  // the hub so the landing page still touches no bundle, and skipped for the
  // 'compare' pseudo-track, which has no bundle of its own (CompareTab
  // lazy-loads the populations the user actually selects).
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
    if (activeTrackId === COMPARE_TRACK) return;
    ensureTrack(activeTrackId);
  }, [view, activeTrackId, ensureTrack]);

  // Warm the view a visitor most likely opens next, once the current one has
  // painted and the main thread is idle: the hub's search box submits to the
  // results page, and a results row opens the gene report. Every view still
  // loads on demand if this has not run (or failed).
  useEffect(() => {
    if (view === 'hub') return preloadWhenIdle(SearchPage);
    if (view === 'search') return preloadWhenIdle(GeneReport, PathwayReport);
    return undefined;
  }, [view]);

  const currentMeta = isCompare ? null : popData?.meta;
  const currentQC   = isCompare ? null : popData?.qc;

  const populations = datasetMeta?.populations || [];
  // Guard: getActiveContrast returns null for a (hypothetical) dataset authored
  // with no contrasts. Every registered dataset has one, so this never fires
  // today — but degrade gracefully (skip the hero chips) instead of crashing.
  const baselineGroup = contrast?.baseline;
  const caseGroup = contrast?.caseGroup;

  // Hero replicate counts follow the ACTIVE contrast's arms. The loaded track's
  // groupSamples (∩ samplesKept) is authoritative for factorial cells, with
  // groupN and the loaded/meta pooled counts as fallbacks. Compare explicitly
  // suppresses loaded membership/QC here as an App policy guard.
  const { nBaseline, nCase, baselineTitle, caseTitle } = contrastArmCounts(
    contrast, isCompare ? null : popData, datasetMeta, activeTrackId,
  );

  const activeTrackColor = trackColor(datasetMeta, activeTrackId);

  // Dataset-level facts for the study bar, derived from the meta this shell has
  // already loaded. The library reads the same facts from the precomputed
  // catalog instead; factsFromMeta exists so both report identical numbers.
  const datasetFacts = useMemo(() => factsFromMeta(dataset, datasetMeta), [dataset, datasetMeta]);

  // Dataset-level external links (GEO/ArrayExpress · DOI · PubMed). The hero shows
  // the primary one inline; the full set lives in the DatasetInfoPanel.
  const datasetLinks = useMemo(() => datasetExternalLinks(dataset), [dataset]);
  const primaryLink = datasetLinks.find((l) => l.kind === 'repository') ?? datasetLinks[0] ?? null;

  // ── Full-page views outside the explorer shell ──
  if (view === 'expression') {
    return <ErrorBoundary><Suspense fallback={<div role="status" style={{ padding: 32 }}>Opening expression survey…</div>}><ExpressionSurveyView onHome={goHome} /></Suspense></ErrorBoundary>;
  }

  // Cross-dataset gene report (#/gene/<symbol>), opened from search results.
  const geneReport = (gene: string) => (
    <ErrorBoundary key={`report-${gene}-${(reportScope ?? []).join(',')}`}>
      <GeneReport
        gene={gene}
        scope={reportScope}
        onScopeChange={setReportScope}
        datasetScope={geneDatasetScope}
        onDatasetScopeChange={setGeneDatasetScope}
        studyFilters={geneStudyFilters}
        onStudyFiltersChange={setGeneStudyFilters}
        onHome={goHome}
        onSearchGene={searchGeneFromHub}
        onOpenDataset={openInExplorer}
        onShowPathway={(pathwayId) => search(pathwayId, 'all')}
        onOpenPathway={(pathwayId) => searchPathwayFromHub(pathwayId)}
        onOpenExpression={openExpression}
        headerRight={<><ShareAnalysisButton /><CompareSetButton onCompare={openCompareSet} onOpenLibrary={openLibraryPlain} /></>}
      />
    </ErrorBoundary>
  );
  const pathwayReport = (pathway: string) => (
    <ErrorBoundary key={`pathway-${pathway}`}>
      <PathwayReport
        pathway={pathway}
        categoryScope={pathwayCategoryScope}
        datasetScope={pathwayDatasetScope}
        onDatasetScopeChange={setPathwayDatasetScope}
        studyFilters={pathwayStudyFilters}
        onStudyFiltersChange={setPathwayStudyFilters}
        onHome={goHome}
        onSearchPathway={searchPathwayFromHub}
        headerRight={<><ShareAnalysisButton /><CompareSetButton onCompare={openCompareSet} onOpenLibrary={openLibraryPlain} /></>}
      />
    </ErrorBoundary>
  );

  if (routeError) return (
    <main style={{ maxWidth: 640, margin: '64px auto', padding: 24 }}>
      <h1>Analysis link unavailable</h1>
      <p role="alert">{routeError}</p>
      <button type="button" onClick={goHome}>Return home</button>
    </main>
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

  return (
    <div className="explorer-shell" style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg-app)', overflow: 'hidden' }}>
      {/* Slim topbar: logo and utilities on one row. The dataset, population
          and tab are named once each below it (study line, hero, active tab),
          so the topbar repeats none of them. */}
      <header className="site-header">
        <div className="site-header-row" style={{
          flexShrink: 0, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)',
          padding: '8px var(--site-header-padding)', display: 'flex', alignItems: 'center', minHeight: 44, gap: '8px 16px',
        }}>
          <BrandLink onHome={goHome} />
          <div className="site-header-controls" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Puts the ACTIVE track into the compare set — the way a single
                population joins a set of whole studies. The Compare pseudo-track
                is not a track, so it has no toggle. */}
            {!isCompare && (
              <CompareSetToggle
                size="header"
                inSet={topbarInSet}
                name={activeTrackId === dataset.defaultTrack ? dataset.name : `${dataset.name} ${activeTrackId}`}
                onToggle={() => toggleItem(topbarItem)}
              />
            )}
            <CompareSetButton onCompare={openCompareSet} onOpenLibrary={openLibraryPlain} />
            <ShareAnalysisButton />
            <VersionBadge />
            <a href="#/methodology" className="header-control">
              Methods
            </a>
            <button type="button" onClick={() => setShowChangelog((c) => !c)}
              className={showChangelog ? 'header-control header-control--on header-control--strong' : 'header-control'}>
              Changelog
            </button>
          </div>
        </div>
        <BetaNotice compact />
      </header>

      {/* Load error (pinned above body-row so it appears even on initial load failure) */}
      {loadError && (
        <div role="alert" style={{ padding: '8px 16px', background: 'var(--danger-bg)', borderBottom: '1px solid var(--danger-border)', fontSize: 12, display: 'flex', gap: 8, alignItems: 'flex-start', flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ color: 'var(--danger-text)' }}>{loadError}</span>
            {/* Why it failed, once the probe has an answer. Kept on its own line
                and in the muted tone: it is context for the error above, not a
                second error. */}
            {originExplanation && (
              <div style={{ color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5, maxWidth: '78ch' }}>
                {originExplanation}
                {shouldLinkStatusPage(originDiagnosis) && (
                  <>
                    {' '}
                    <a href={CLOUDFLARE_STATUS_URL} target="_blank" rel="noreferrer noopener"
                      style={{ color: 'var(--text-link, var(--danger-text))' }}>
                      Check Cloudflare status
                    </a>
                    .
                  </>
                )}
              </div>
            )}
          </div>
          <button type="button" onClick={retryLoad}
            style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg-panel)', cursor: 'pointer', flexShrink: 0 }}>
            Retry
          </button>
        </div>
      )}

      {/* Study line — the dataset's identity, on screen at every tab and in
          Compare mode, in ONE line: name, organism, modality and the design's
          arms. Region, preparation and the dataset's verification record sit
          behind the "Study details & verification" disclosure, so they stay one
          click away without stacking above the data on every view.
          Full width rather than inside the main column, because it describes the
          dataset and the sidebar beside it describes tracks within that dataset. */}
      <div className="explorer-study" style={{ flexShrink: 0, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}>
      <div className="explorer-study-bar" style={{
        padding: '5px 24px', display: 'flex', alignItems: 'center', gap: '4px 10px', flexWrap: 'wrap',
        fontSize: 11.5, color: 'var(--text-muted)',
      }}>
        {/* The dataset name. With more than one dataset registered it is the
            way back into the library — the surface that can show a study's
            design and replicate counts before you commit to it. A
            single-dataset build has nothing to browse, so it stays text. */}
        {listDatasets().length > 1 ? (
          <button
            type="button"
            className="explorer-study-dataset"
            aria-label={`Active dataset: ${dataset.name}. Browse all datasets`}
            title="Browse all datasets"
            onClick={() => openLibrary({ datasetId: dataset.id })}
          >
            <span className="explorer-study-dataset-name">{dataset.name}</span>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
              style={{ flexShrink: 0 }}>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        ) : (
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{dataset.name}</span>
        )}
        <span aria-hidden="true" style={{ width: 1, height: 14, background: 'var(--border)' }} />
        <span style={{ fontStyle: 'italic' }}>{dataset.organism}</span>
        <span>{dataset.modality}</span>
        {/* Outside Compare this shows the DESIGN only: the hero below already
            carries N for the selected track, and a second dataset-level N beside
            it would read as a contradiction on any dataset whose tracks disagree
            — the macaque atlas is 3v3 on 55 populations and drops to an arm of 2
            on five.
            Compare mode has no hero pills, so there the count has nowhere else
            to live and this shows it. */}
        {baselineGroup && caseGroup && (
          <>
            <span aria-hidden="true" style={{ width: 1, height: 14, background: 'var(--border)' }} />
            <ArmPills
              size="sm"
              variant={isCompare ? 'counts' : 'design'}
              baseline={baselineGroup} caseGroup={caseGroup}
              nBaseline={datasetFacts.nBaseline} nCase={datasetFacts.nCase}
              nVaries={isCompare && datasetFacts.nVaries}
              trackNoun={dataset.trackNoun || 'track'}
            />
            {/* A contrast authored `exploratory` is one the source paper never
                ran — a re-analysis whose meaning does not follow from its arm
                names. That warning belongs beside the volcano the user is
                reading, not only inside the Dataset info modal, so it rides
                here, outside the disclosure: a scientific caveat is never
                folded away. Gated on the flag, NOT on description presence: a
                description can also annotate a faithful re-fit of the paper's
                own axis (e.g. the GSE135639 maturation contrasts), which must
                not be branded exploratory. */}
            {contrast?.description && contrast.exploratory && (
              // A <button>, not a <span title>: a title attribute on a
              // non-focusable element is unreachable by keyboard and by touch,
              // which would leave the actual explanation available only to a
              // mouse user hovering. This opens the full dataset record, where
              // the contrast row carries the same text as readable content.
              <button
                type="button"
                onClick={() => setShowDatasetInfo(true)}
                title={contrast.description}
                aria-label={`Exploratory contrast. ${contrast.description} Open the full dataset record.`}
                style={{
                  fontSize: 10, fontFamily: FONT_MONO, fontWeight: 600, cursor: 'pointer',
                  padding: '2px 7px', borderRadius: 999, color: COLOR_WARNING_TEXT,
                  background: COLOR_WARNING_BG, border: '1px solid rgba(217, 119, 6, 0.34)',
                }}
              >
                exploratory contrast
              </button>
            )}
            {!isCompare && datasetFacts.nVaries && (
              <ArmVariesBadge
                trackNoun={dataset.trackNoun || 'track'}
                fontSize={10}
                title={`Replicate counts differ across this dataset's ${dataset.trackNoun || 'track'}s — the hero shows the selected one's.`}
              />
            )}
          </>
        )}
        <span className="explorer-study-actions" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" className="explorer-study-toggle"
            aria-expanded={showStudyDetails} aria-controls="explorer-study-details"
            onClick={() => setShowStudyDetails((open) => !open)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 11.5, fontWeight: 600, color: 'var(--text-mono)', background: 'none',
              border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
            }}>
            Study details &amp; verification
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
              style={{ flexShrink: 0, transform: showStudyDetails ? 'rotate(180deg)' : undefined }}>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </span>
      </div>

      {/* Mounted only while open, so the collapsed line costs no layout. The
          verification record is the same component the explorer always showed. */}
      {showStudyDetails && (
        <div id="explorer-study-details" className="explorer-study-details" style={{ borderTop: '1px solid var(--border)' }}>
          <dl className="explorer-study-facts" style={{
            margin: 0, padding: '7px 24px', display: 'flex', flexWrap: 'wrap', gap: '4px 18px',
            fontSize: 11.5, color: 'var(--text-primary)',
          }}>
            {([
              ['Organism', dataset.organism],
              ['Modality', dataset.modality],
              ['Region', dataset.region],
              ['Preparation', dataset.preparation],
            ] as const).filter(([, value]) => Boolean(value)).map(([term, value]) => (
              <div key={term} style={{ display: 'flex', gap: 5 }}>
                <dt style={{ color: 'var(--text-muted)' }}>{term}</dt>
                <dd style={{ margin: 0, fontStyle: term === 'Organism' ? 'italic' : undefined }}>{value}</dd>
              </div>
            ))}
          </dl>
          <DatasetVerificationContext key={dataset.id} datasetId={dataset.id} contrastId={contrast?.id} />
        </div>
      )}
      </div>

      {/* Body row — sidebar + main */}
      <div className="explorer-body" style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
        {/* Sidebar — cell navigator */}
        <CellNavigator
          dataset={dataset}
          meta={datasetMeta}
          populations={populations}
          activeTrackId={activeTrackId}
          isCompare={isCompare}
          search={cellSearch}
          onSearchChange={setCellSearch}
          onSelectTrack={selectTrack}
          onLeaveCompare={() => navigate({ type: 'leaveCompare' })}
        />

        {/* Main column */}
        <div className="explorer-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          {/* Accent strip: the active track's colour. Compare has no single
              track, so it has no strip. */}
          {!isCompare && (
            <div aria-hidden="true" style={{ height: 4, flexShrink: 0, background: activeTrackColor }} />
          )}

          {/* Hero. Single-track mode carries the track, its arms, the contrast
              selector and the detected-gene count; Compare mode is one slim
              line, because the populations it compares are chosen right below. */}
          <div className={isCompare ? 'explorer-hero explorer-hero--compare' : 'explorer-hero'} style={{
            flexShrink: 0, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)',
            padding: isCompare ? '5px 20px' : '8px 20px', display: 'flex', alignItems: 'center',
            gap: isCompare ? 12 : '8px 18px', flexWrap: 'wrap',
          }}>
            {isCompare ? (
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: 'var(--text-mono)',
              }}>
                Compare populations
              </span>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span aria-hidden="true" style={{
                  width: 11, height: 11, borderRadius: '50%',
                  background: activeTrackColor,
                  boxShadow: `0 0 0 3px ${activeTrackColor}20`,
                  flexShrink: 0,
                }} />
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0 10px', flexWrap: 'wrap', minWidth: 0 }}>
                  <div style={{
                    fontFamily: FONT_MONO, fontSize: 20, fontWeight: 700,
                    lineHeight: 1.15, color: 'var(--text-primary)', letterSpacing: '-0.02em',
                  }}>
                    {activeTrackId}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {`${getCellSubname(activeTrackId, datasetMeta?.labels)}${datasetMeta?.types?.[activeTrackId] ? ` · ${datasetMeta?.types?.[activeTrackId]}` : ''}`}
                  </div>
                </div>
              </div>
            )}

            {!isCompare && baselineGroup && caseGroup && (
              <>
                {/* Low-power warning judged on the ACTIVE contrast's arm
                    counts (a factorial cell contrast can be 3v4 while the
                    pooled track is 8v9, and vice versa). The badge itself
                    stays silent when both arms have ≥3 replicates. */}
                <ArmPills
                  size="lg"
                  baseline={baselineGroup} caseGroup={caseGroup}
                  nBaseline={nBaseline} nCase={nCase}
                  baselineTitle={baselineTitle} caseTitle={caseTitle}
                  after={currentQC && (
                    <PopWarningBadge
                      nNormal={nBaseline ?? undefined}
                      nObese={nCase ?? undefined}
                      samplesKept={currentQC.samplesKept}
                    />
                  )}
                />
                {/* Contrast selector — only when the dataset declares >1 contrast.
                    Single-contrast datasets render nothing here (unchanged UX).
                    Contrasts sharing an authored `group` (the axes of a
                    factorial design — diet effect vs maturation) render under
                    one <optgroup>, so the 2×2's structure is visible in the
                    selector itself; ungrouped contrasts stay flat. */}
                {datasetContrasts.length > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                      textTransform: 'uppercase', color: 'var(--text-muted)',
                    }}>
                      Contrast
                    </span>
                    <select
                      aria-label="Active contrast"
                      value={contrast?.id ?? ''}
                      onChange={(e) => navigate({ type: 'contrast', contrastId: e.target.value })}
                      style={{
                        fontSize: 12, fontFamily: FONT_MONO,
                        color: 'var(--text-primary)', background: 'var(--bg-panel)',
                        border: '1px solid var(--border-dark)', borderRadius: 6,
                        padding: '3px 8px', cursor: 'pointer',
                      }}>
                      {contrastOptGroups.map((og) => og.group === null
                        ? og.contrasts.map((c) => (
                          <option key={c.id} value={c.id} title={c.description}>{c.label}</option>
                        ))
                        : (
                          <optgroup key={og.group} label={og.group}>
                            {og.contrasts.map((c) => (
                              <option key={c.id} value={c.id} title={c.description}>{c.label}</option>
                            ))}
                          </optgroup>
                        ))}
                    </select>
                  </div>
                )}
                {/* The count is a figure (ink, mono); the words around it are
                    prose (muted, sans). Not Signal Orange: that marks the one
                    active element, and this is a readout. */}
                <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  <strong style={{ fontFamily: FONT_MONO, color: 'var(--text-primary)', fontWeight: 600, fontSize: 13 }}>
                    {(currentMeta?.nGenes || datasetMeta?.nGenes?.[activeTrackId] || 0).toLocaleString()}
                  </strong>
                  {' '}{dataset.featureLabel?.toLowerCase() || 'gene'}s detected
                </div>
              </>
            )}

            {/* Dataset provenance, in both modes as compact controls: the
                primary external link inline, and the ⓘ button for the full
                DatasetInfoPanel. Organism and modality live in the study line
                above, which is on screen at every tab. */}
            <div className="explorer-hero-links" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {primaryLink && (
                <a href={primaryLink.href} target="_blank" rel="noopener noreferrer" title={primaryLink.title}
                  className="explorer-hero-link" style={HERO_LINK_STYLE}>
                  {primaryLink.label}
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg>
                </a>
              )}
              <button type="button" onClick={() => setShowDatasetInfo(true)}
                className="explorer-hero-link" style={HERO_LINK_STYLE}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="7.5" r="0.6" fill="currentColor" /></svg>
                Dataset info
              </button>
            </div>
          </div>

          {/* Content */}
          {showChangelog ? (
            <ErrorBoundary><ChangelogTab onClose={() => setShowChangelog(false)} /></ErrorBoundary>
          ) : isCompare ? (
            <div className="explorer-compare" style={{ flex: 1, overflow: 'hidden' }}>
              <ErrorBoundary key={`compare-${dataset.id}`}>
                {/* Compare loads its populations itself, as track columns (see
                    ../data/trackColumns): each has its own loading / failed /
                    Retry state, and none drives the global overlay.
                    It waits for THIS dataset's meta: a `/compare` link lands in
                    the same render as the dataset switch, when the store's meta
                    is still null, and CompareTab takes its starting selection
                    once — mounting early chose populations the dataset lacks. */}
                {datasetMeta ? (
                  <CompareTab key={compareView.epoch} meta={datasetMeta} dataset={dataset} contrast={contrast}
                    defaultPops={dataset.defaultCompareTracks || populations.slice(0, 2)}
                    initialView={compareViewHere} onViewChange={onCompareViewChange} />
                ) : (
                  <div role="status" style={{ padding: 24 }}><Spinner size={14} label="Loading populations…" /></div>
                )}
              </ErrorBoundary>
            </div>
          ) : (popData || isQC) ? (
            <>
              <div className="explorer-tabs" style={{
                flexShrink: 0, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)',
                display: 'flex', padding: '0 16px',
              }}>
                {/* Which tabs this dataset/track can answer is now one rule in
                    explorerTabs — shared with the router, so a `.../<tab>` deep
                    link can never open a tab this bar would not have rendered
                    (a Pathway Explorer with no enrichment behind it, a Circadian
                    tab for a track with no time course). */}
                {EXPLORER_TABS
                  .filter(([id]) => explorerTabAvailable(dataset, activeTrackId, id))
                  .map(([id, label]) => (
                    <button type="button" key={id} onClick={() => selectTab(id)}
                      className={activeTab === id ? 'tab-btn tab-btn--active' : 'tab-btn'}>{label}</button>
                  ))}
              </div>

              <div className="fade-in explorer-tab-content" key={activeTab} style={{ flex: 1, overflow: 'hidden' }}>
                {activeTab === 'qc' ? (
                  <ErrorBoundary key={`qc-${dataset.id}`}>
                    <QCTab onSelectTrack={selectTrack} qcData={datasetQC} meta={datasetMeta} dataset={dataset} contrast={contrast} getTrack={getTrack} />
                  </ErrorBoundary>
                ) : activeTab === 'gene' ? (
                  <ErrorBoundary key={`gene-${dataset.id}-${activeTrackId}`}>
                    <GeneExplorerTab
                      geneSelection={geneSelection}
                      volcano={volcano}
                      popData={popData as PopData}
                      contrastSlices={contrastSlices}
                      nomenclatureAuthority={nomenclatureAuthorityForStoredDatasetSymbols(dataset)}
                    />
                  </ErrorBoundary>
                ) : activeTab === 'circadian' ? (
                  <ErrorBoundary key={`circadian-${dataset.id}-${activeTrackId}`}>
                    <CircadianTab
                      dataset={dataset}
                      trackId={activeTrackId}
                      initialGene={geneSelection.genes[0]}
                    />
                  </ErrorBoundary>
                ) : (
                  <ErrorBoundary key={`pathway-${activeTrackId}`}>
                    <PathwayExplorerTab
                      pathway={pathway}
                      popData={popData as PopData}
                      contrastSlices={contrastSlices}
                      onSendGenesToGeneExplorer={sendGenesToGeneExplorer}
                    />
                  </ErrorBoundary>
                )}
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', padding: 'var(--sp-4)', position: 'relative', minHeight: 0 }}>
              <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                <Skeleton width={300} height={32} radius="var(--r-md)" />
                <Skeleton width={90} height={24} radius="var(--r-md)" />
              </div>
              <Skeleton height="auto" style={{ flex: 1, minHeight: 120 }} />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <Spinner size={22} label="Loading population data…" />
              </div>
            </div>
          )}
        </div>

        {/* Loading overlay (covers the whole body-row) */}
        {loadingTrack && (
          <LoadingOverlay
            message={`Loading ${datasetMeta?.labels?.[loadingTrack] || loadingTrack}…`}
            progress={loadingProgress}
          />
        )}
      </div>

      {showDatasetInfo && (
        <DatasetInfoPanel
          dataset={dataset}
          meta={datasetMeta}
          contrasts={datasetContrasts}
          activeContrast={contrast}
          onClose={() => setShowDatasetInfo(false)}
          onOpenMethods={() => { setShowDatasetInfo(false); openMethodology(); }}
          onOpenTracker={(acc) => { setShowDatasetInfo(false); openTracker(acc ?? null); }}
        />
      )}
    </div>
  );
}
