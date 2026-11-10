import { ResponsiveDetails } from './common/ResponsiveDetails';
import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from 'react';
import { trackColor } from './data/datasetMeta';
import { COLOR_WARNING_BG, COLOR_WARNING_TEXT, FONT_MONO, FONT_SANS, PAGE_ACCENT_GRADIENT } from './styles/constants';
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
import { GeneExplorerTab } from './gene-explorer/GeneExplorerTab';
import { PathwayExplorerTab } from './pathway-explorer/PathwayExplorerTab';
import { CompareTab } from './compare/CompareTab';
import { CircadianTab } from './circadian/CircadianTab';
import { QCTab } from './qc/QCTab';
import { PopWarningBadge } from './common/PopWarningBadge';
import { ChangelogTab } from './changelog/ChangelogTab';
import { MethodologyView } from './methodology/MethodologyView';
import { DataSourcesTab } from './acknowledgements/DataSourcesTab';
import { UpdateModal } from './pwa/UpdateModal';
import { VersionBadge } from './pwa/VersionBadge';
import { LoadingOverlay } from './common/LoadingOverlay';
import { Spinner } from './common/Spinner';
import { Skeleton } from './common/Skeleton';
import { BetaNotice } from './common/BetaNotice';
import { BrandLink } from './common/BrandLink';
import { LandingHub } from './hub/LandingHub';
import { CellNavigator } from './explorer/CellNavigator';
import { EXPLORER_TABS, DEFAULT_EXPLORER_TAB, explorerTabAvailable, explorerTabLabel } from './explorer/explorerTabs';
import { COMPARE_TRACK, activeTabOf, activeTrackOf, initialPosition, useExplorerPosition, type NavigationIntent } from './explorer/explorerPosition';
import { useExplorerSession } from './explorer/explorerSession';
import { preloadBarSEMChart } from './gene-explorer/BarSEMChart';
import { DatasetInfoPanel } from './common/DatasetInfoPanel';
import { ArmPills, ArmVariesBadge, factsFromMeta } from './common/StudyMetadata';
import { DatasetLibrary } from './library/DatasetLibrary';
import { datasetExternalLinks } from './utils/datasetLinks';
import { GeneReport } from './crossdataset/GeneReport';
import type { GeneStudyFilters } from './crossdataset/geneStudyScope';
import { PathwayReport } from './crossdataset/PathwayReport';
import { ExplorerSearchDialog, type SearchMode } from './crossdataset/ExplorerSearchDialog';
import { SearchPage } from './search/SearchPage';
import { useCategoryScope } from './crossdataset/forestReport';
import type { ExplorerAnalysisState } from './utils/analysisState';
import { DB_DEFAULT_FILTER } from './data/constants';
import { useChartScale, setChartScale } from './common/chartScaleStore';
import { ShareAnalysisButton } from './common/ShareAnalysisButton';
import { CrossDatasetCompare } from './crossdataset/CrossDatasetCompare';
import { DatasetTrackerView } from './dataset-tracker/DatasetTrackerView';
import { StatisticsView } from './statistics/StatisticsView';
import { VerificationView } from './verification/VerificationView';
import { DatasetVerificationContext } from './common/DatasetVerificationContext';
import { NomenclatureView } from './nomenclature/NomenclatureView';
import { CompareSetView } from './compareset/CompareSetView';
import { CompareSetButton } from './compareset/CompareSetButton';
import { CompareSetToggle } from './compareset/CompareSetToggle';
import { compareSetKey, removeItem, toggleItem, useCompareSet, type CompareSetItem } from './compareset/compareSetStore';
import type { PathwayRecordWithDb, PopData } from './types';

const DEFAULT_DATASET = getDefaultDataset();
const LocalDatasetsView = lazy(() => import('./local-datasets/LocalDatasetsView'));
const ExpressionSurveyView = lazy(() => import('./expression-survey/ExpressionSurveyView').then((module) => ({ default: module.ExpressionSurveyView })));

interface AppProps {
  initialView?: string;
}

export default function App({ initialView = 'hub' }: AppProps = {}) {
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
    if (load) ensureTrack(load.trackId, load.dataset);
  }, [applyIntent, resetFor, session.restoreAnalysis, ensureTrack]);
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

  const explorerAnalysis = useMemo<ExplorerAnalysisState | undefined>(() => {
    const nonDefault = chartScale !== 'native' || contrast?.id !== getActiveContrast(dataset)?.id || geneSelection.genes.length > 0
      || volcano.metric !== 'pval' || volcano.logFCThresh !== 0 || volcano.sigThresh !== 2
      || pathway.search !== '' || pathway.fdrThresh !== 1 || pathway.sortKey !== 'nes'
      || Object.entries(DB_DEFAULT_FILTER).some(([db, enabled]) => pathway.dbFilter[db] !== enabled);
    return nonDefault ? {
      version: 1, contrastId: contrast?.id ?? null, genes: geneSelection.genes, chartScale,
      volcano: { metric: volcano.metric, logFCThresh: volcano.logFCThresh, sigThresh: volcano.sigThresh },
      pathway: { search: pathway.search, dbFilter: pathway.dbFilter, fdrThresh: pathway.fdrThresh, sortKey: pathway.sortKey },
    } : undefined;
  }, [dataset, contrast, geneSelection.genes, chartScale, volcano.metric, volcano.logFCThresh, volcano.sigThresh,
    pathway.search, pathway.dbFilter, pathway.fdrThresh, pathway.sortKey]);

  // The read side of that same seam: where the explorer currently IS, so the
  // router can put it in the URL. These three stay shell state — they drive a
  // dozen behaviours that have nothing to do with routing — and the router only
  // ever reads them.
  const explorerAt = useMemo(
    () => ({ datasetId: activeDatasetId, trackId: activeTrackId, tab: activeTab, analysis: explorerAnalysis }),
    [activeDatasetId, activeTrackId, activeTab, explorerAnalysis],
  );

  const {
    view, routeError, reportGene, reportScope, reportPathway, trackerSelectedAcc,
    goHome, enterTool, enterExplorer,
    searchGene: searchGeneFromHub,
    searchPathway: searchPathwayFromHub,
    openGeneExplorer, openPathwayExplorer, switchSearchExplorer, compareDatasets,
    openTracker, openInExplorer, openStatistics, openMethodology, openVerification, openNomenclature, openLocalDatasets, openExpression,
    openLibrary, setLibraryDataset, setLibraryCategories, libraryDatasetId, libraryCategories,
    compareSetItems, openCompareSet, setCompareSetItems,
    geneAnalysis, pathwayAnalysis, setGeneAnalysis, setPathwayAnalysis, setReportScope, setReportGene,
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

  // The hub nav's Genes / Pathways entrances open the search dialog on that
  // side; with no side named it opens on genes. The hub's own search box no
  // longer goes through here: it submits to the unified results page.
  const openSearch = useCallback((mode: SearchMode = 'gene') => {
    if (mode === 'pathway') openPathwayExplorer();
    else openGeneExplorer();
  }, [openGeneExplorer, openPathwayExplorer]);
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
  if (view === 'local-datasets') {
    return <ErrorBoundary><Suspense fallback={<div style={{ padding: 32 }}>Opening local workspace...</div>}><LocalDatasetsView onHome={goHome} /></Suspense></ErrorBoundary>;
  }

  if (view === 'expression') {
    return <ErrorBoundary><Suspense fallback={<div role="status" style={{ padding: 32 }}>Opening expression survey…</div>}><ExpressionSurveyView onHome={goHome} /></Suspense></ErrorBoundary>;
  }

  // Cross-dataset gene report (#/gene/<symbol>), opened from search results.
  const geneReport = (gene: string | null) => (
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
        onCompareDatasets={compareDatasets}
        onOpenDataset={openInExplorer}
        onShowPathway={(pathwayId) => search(pathwayId, 'all')}
        onOpenPathway={(pathwayId) => searchPathwayFromHub(pathwayId)}
        onOpenExpression={openExpression}
        headerRight={<><ShareAnalysisButton /><CompareSetButton onCompare={openCompareSet} onOpenLibrary={openLibraryPlain} /></>}
      />
    </ErrorBoundary>
  );
  const pathwayReport = (pathway: string | null) => (
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

  // Only a submitted search replaces the hub with the full results view. An
  // empty term opens the shared gene and pathway search dialog over the hub.
  if (view === 'report' && reportGene) return <><UpdateModal />{geneReport(reportGene)}</>;
  if (view === 'pathway-report' && reportPathway) return <><UpdateModal />{pathwayReport(reportPathway)}</>;
  const searchMode: SearchMode | null = view === 'report' ? 'gene' : view === 'pathway-report' ? 'pathway' : null;
  const showSearchDialog = searchMode !== null;

  // ── Unified search results (the hub box's destination) ──────────────
  // Keyed by the query alone: a new search starts the page fresh, while
  // switching All / Genes / Pathways keeps it mounted.
  if (view === 'search') {
    return (
      <>
        <UpdateModal />
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
      </>
    );
  }

  // ── Cross-dataset expression Compare (side-by-side bars) ────────────
  if (view === 'compare-datasets') {
    return (
      <>
        <UpdateModal />
        <ErrorBoundary key="compare-datasets">
          <CrossDatasetCompare gene={reportGene ?? ''} scope={reportScope} datasetScope={geneDatasetScope}
            studyFilters={geneStudyFilters} onScopeChange={setReportScope} onGeneChange={setReportGene}
            onHome={goHome} onShowReport={(gene) => searchGeneFromHub(gene, reportScope)} />
        </ErrorBoundary>
      </>
    );
  }

  // ── Dataset Tracker (cross-dataset coverage view; read-only on the public
  //    site, review-editable under the dev server) ──────────────────────
  if (view === 'tracker') {
    return (
      <>
        <UpdateModal />
        <ErrorBoundary key="tracker">
          <DatasetTrackerView onHome={goHome} onOpenInExplorer={openInExplorer} initialSelectedAcc={trackerSelectedAcc} />
        </ErrorBoundary>
      </>
    );
  }

  // ── Statistics explainer (dataset-agnostic reference page) ──────────
  if (view === 'statistics') {
    return (
      <>
        <UpdateModal />
        <ErrorBoundary key="statistics">
          <StatisticsView onHome={goHome} />
        </ErrorBoundary>
      </>
    );
  }

  if (view === 'methodology') {
    return (
      <>
        <UpdateModal />
        <ErrorBoundary key="methodology">
          <MethodologyView onHome={goHome} />
        </ErrorBoundary>
      </>
    );
  }

  if (view === 'verification') {
    return (
      <>
        <UpdateModal />
        <ErrorBoundary key="verification">
          <VerificationView onHome={goHome} />
        </ErrorBoundary>
      </>
    );
  }

  // ── Gene nomenclature reference (dataset-agnostic reference page) ────
  if (view === 'nomenclature') {
    return (
      <>
        <UpdateModal />
        <ErrorBoundary key="nomenclature">
          <NomenclatureView onHome={goHome} onSearchGene={searchGeneFromHub} />
        </ErrorBoundary>
      </>
    );
  }

  // ── Compare set (studies and populations side by side) ──────────────
  // Keyed by the view alone, not by its columns: removing a column must not
  // remount the view and drop the gene selection — the loader hook takes the
  // new list and keeps every column it already has.
  if (view === 'compare-set') {
    return (
      <>
        <UpdateModal />
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
      </>
    );
  }

  // ── Dataset library (browse the corpus) ─────────────────────────────
  // `openInExplorer` is the only way out of here into a dataset, so the library
  // crosses the same explorer-session seam as the reports, the tracker and the
  // deep links — it does not reimplement any part of the explorer position.
  if (view === 'library') {
    return (
      <>
        <UpdateModal />
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
      </>
    );
  }

  // ── Landing hub (default view) ──────────────────────────────────────
  if (view === 'hub' || showSearchDialog) {
    return (
      <>
        <UpdateModal />
        <div aria-hidden={showSearchDialog || undefined}>
          <LandingHub
            onHome={goHome}
            datasets={listDatasets()}
            onEnterTool={enterTool}
            onOpenSearch={openSearch}
            onSearch={searchFromHub}
            onOpenTracker={openTracker}
            onOpenLibrary={(categories) => openLibrary({ categories })}
            onOpenStatistics={openStatistics}
            onOpenMethodology={openMethodology}
            onOpenVerification={openVerification}
            onOpenNomenclature={openNomenclature}
            onOpenLocalDatasets={openLocalDatasets}
            onOpenExpression={openExpression}
            onChangelog={() => { setShowChangelog(true); enterExplorer(); }}
            onCompareSet={openCompareSet}
          />
        </div>
        {searchMode && (
          <ExplorerSearchDialog
            mode={searchMode}
            onModeChange={switchSearchExplorer}
            onClose={goHome}
            gene={() => geneReport(null)}
            pathway={() => pathwayReport(null)}
          />
        )}
      </>
    );
  }

  return (
    <div className="explorer-shell" style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg-app)', overflow: 'hidden' }}>
      {/* New-version-available prompt (only renders when a waiting SW is signalled) */}
      <UpdateModal />

      {/* Slim topbar — logo + breadcrumb + changelog */}
      <header className="site-header">
        <div className="site-header-row" style={{
          flexShrink: 0, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)',
          padding: '8px var(--site-header-padding)', display: 'flex', alignItems: 'center', minHeight: 44, gap: '8px 0',
        }}>
          <BrandLink onHome={goHome} />
          <div className="site-header-breadcrumbs" style={{
            marginLeft: 'var(--site-crumb-offset)', display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 12, color: 'var(--text-muted)', fontFamily: FONT_MONO,
          }}>
            {/* Dataset crumb. With more than one dataset registered this is the
                way back into the library — the surface that can actually show a
                study's design and replicate counts before you commit to it. It
                replaced a 42-option <select> whose own comment conceded it was a
                placeholder: an <option> can carry a name and nothing else, which
                is exactly the information a user does not have enough of.
                A single-dataset build has nothing to browse, so it stays text. */}
            {listDatasets().length > 1 ? (
              <button
                type="button"
                aria-label={`Active dataset: ${dataset.name}. Browse all datasets`}
                title="Browse all datasets"
                onClick={() => openLibrary({ datasetId: dataset.id })}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 12, fontFamily: 'inherit', color: 'var(--text-primary)',
                  background: 'transparent', border: '1px solid var(--border)',
                  borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
                  maxWidth: 280, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                }}>
                {dataset.name}
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                  style={{ flexShrink: 0 }}>
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            ) : (
              <span>{dataset.name}</span>
            )}
            <span style={{ color: 'var(--border-dark)' }}>/</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
              {isCompare ? 'Compare all' : `${activeTrackId} · ${getCellSubname(activeTrackId, datasetMeta?.labels)}`}
            </span>
            {!isCompare && (
              <>
                <span style={{ color: 'var(--border-dark)' }}>/</span>
                <span style={{ color: 'var(--text-mono)' }}>
                  {explorerTabLabel(activeTab)}
                </span>
              </>
            )}
          </div>
          <div style={{ flex: 1 }} />
          <div className="site-header-controls" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Puts the ACTIVE track into the compare set — the way a single
                population joins a set of whole studies. The Compare pseudo-track
                is not a track, so it has no toggle. */}
            {!isCompare && (
              <CompareSetToggle
                size="md"
                inSet={topbarInSet}
                name={activeTrackId === dataset.defaultTrack ? dataset.name : `${dataset.name} ${activeTrackId}`}
                onToggle={() => toggleItem(topbarItem)}
              />
            )}
            <CompareSetButton onCompare={openCompareSet} onOpenLibrary={openLibraryPlain} />
            <ShareAnalysisButton />
            <VersionBadge />
            <a href="#/methodology"
              style={{
                fontSize: 12, padding: '5px 12px',
                border: '1px solid var(--border-dark)', borderRadius: 6,
                color: 'var(--text-mono)', textDecoration: 'none', fontFamily: FONT_SANS,
              }}>
              Methodology
            </a>
            <button type="button" onClick={() => setShowChangelog((c) => !c)}
              style={{
                fontSize: 12, padding: '5px 12px',
                border: '1px solid var(--border-dark)', borderRadius: 6,
                background: showChangelog ? 'var(--accent)' : 'transparent',
                color: showChangelog ? '#fff' : 'var(--text-mono)',
                cursor: 'pointer', fontFamily: FONT_SANS,
                transition: 'background var(--t-fast) var(--ease), color var(--t-fast) var(--ease)',
              }}>
              Changelog
            </button>
          </div>
        </div>
        <BetaNotice />
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

      {/* Study bar — the dataset's identity and provenance, on screen at every
          tab and in Compare mode.
          Until now these facts existed only inside the DatasetInfoPanel modal,
          which meant the answer to "how many animals is this, and where did it
          come from?" was never visible while you were reading a volcano plot.
          Full width rather than inside the main column, because it describes the
          dataset and the sidebar beside it describes tracks within that dataset. */}
      <ResponsiveDetails label={contrast?.exploratory ? "Study details · exploratory comparison" : "Study details & verification"}>
      <div className="explorer-study-bar" style={{
        flexShrink: 0, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)',
        padding: '7px 24px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        fontSize: 11.5, color: 'var(--text-muted)',
      }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{dataset.name}</span>
        <span aria-hidden="true" style={{ width: 1, height: 14, background: 'var(--border)' }} />
        <span style={{ fontStyle: 'italic' }}>{dataset.organism}</span>
        <span>{dataset.modality}</span>
        <span>{dataset.region}</span>
        <span>{dataset.preparation}</span>
        {/* Outside Compare this shows the DESIGN only: the hero below already
            carries N for the selected track, and a second dataset-level N beside
            it would read as a contradiction on any dataset whose tracks disagree
            — the macaque atlas is 3v3 on 55 populations and drops to an arm of 2
            on five.
            Compare mode suppresses the hero's pills entirely, so there the count
            has nowhere else to live and this shows it. */}
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
                here. Gated on the flag, NOT on description presence: a
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
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {listDatasets().length > 1 && (
            <button type="button" onClick={() => openLibrary({ datasetId: dataset.id })}
              style={{
                fontSize: 11.5, fontWeight: 600, color: 'var(--accent)', background: 'none',
                border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
              }}>
              All datasets →
            </button>
          )}
        </span>
      </div>

      <DatasetVerificationContext key={dataset.id} datasetId={dataset.id} contrastId={contrast?.id} />
      </ResponsiveDetails>

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
          {/* Accent strip */}
          <div style={{
            height: 4, flexShrink: 0,
            background: isCompare ? PAGE_ACCENT_GRADIENT : activeTrackColor,
          }} />

          {/* Compact hero */}
          <div className="explorer-hero" style={{
            flexShrink: 0, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)',
            padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {!isCompare && (
                <span style={{
                  width: 14, height: 14, borderRadius: '50%',
                  background: activeTrackColor,
                  boxShadow: `0 0 0 3px ${activeTrackColor}20`,
                  flexShrink: 0,
                }} />
              )}
              <div>
                <div style={{
                  fontFamily: FONT_MONO, fontSize: 28, fontWeight: 700,
                  lineHeight: 1, color: 'var(--text-primary)', letterSpacing: '-0.02em',
                }}>
                  {isCompare ? 'Compare' : activeTrackId}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                  {isCompare
                    ? 'Side-by-side across selected populations'
                    : `${getCellSubname(activeTrackId, datasetMeta?.labels)}${datasetMeta?.types?.[activeTrackId] ? ` · ${datasetMeta?.types?.[activeTrackId]}` : ''}`}
                </div>
              </div>
            </div>

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
                <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>
                  <strong style={{ color: 'var(--color-selected)', fontWeight: 700, fontSize: 13 }}>
                    {(currentMeta?.nGenes || datasetMeta?.nGenes?.[activeTrackId] || 0).toLocaleString()}
                  </strong>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> {dataset.featureLabel?.toLowerCase() || 'gene'}s detected · click a point to add</span>
                </div>
              </>
            )}

            {/* Dataset identity + provenance (always shown — dataset-level, so it
                renders in Compare mode too). Primary external link inline; the ⓘ
                button opens the full DatasetInfoPanel. */}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {/* Organism and modality used to be repeated here. They now live in
                  the study bar above, which is on screen at every tab — the point
                  of that bar is that this information stops being something you
                  open a modal for. */}
              {primaryLink && (
                <a href={primaryLink.href} target="_blank" rel="noopener noreferrer" title={primaryLink.title}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999,
                    fontSize: 11.5, fontWeight: 600, fontFamily: FONT_MONO, textDecoration: 'none',
                    color: 'var(--color-selected)', background: 'color-mix(in srgb, var(--color-selected) 10%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--color-selected) 28%, transparent)',
                  }}>
                  {primaryLink.label}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg>
                </a>
              )}
              <button type="button" onClick={() => setShowDatasetInfo(true)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 7,
                  fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                  border: '1px solid var(--border-dark)', background: 'var(--bg-panel)', color: 'var(--text-primary)',
                }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="7.5" r="0.6" fill="currentColor" /></svg>
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
                  <CompareTab meta={datasetMeta} dataset={dataset} contrast={contrast}
                    defaultPops={dataset.defaultCompareTracks || populations.slice(0, 2)} />
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
                ) : activeTab === 'datasources' ? (
                  <ErrorBoundary key="datasources">
                    <DataSourcesTab onOpenTracker={openTracker} />
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
          onOpenDataSources={() => {
            setShowDatasetInfo(false);
            // A named tab leaves Compare by itself (the explorer position's rule).
            selectTab('datasources');
          }}
          onOpenTracker={(acc) => { setShowDatasetInfo(false); openTracker(acc ?? null); }}
        />
      )}
    </div>
  );
}
