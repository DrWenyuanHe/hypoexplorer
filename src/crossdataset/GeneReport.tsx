import { useState, useEffect, useId, useMemo, useCallback } from 'react';
import type { Dispatch, MouseEvent, ReactNode, SetStateAction } from 'react';
import { queryGeneAcrossDatasets, loadGeneIndex } from '../data/crossDataset';
import { datasetCategory, DATASET_CATEGORIES, listDatasets } from '../data/datasets';
import type { DatasetCategory } from '../data/datasets';
import { datasetHref, libraryHref, isPlainLeftClick } from '../utils/appLinks';
import { fmtFDR, fmtSigned } from '../utils/format';
import { FONT_MONO, UP_TEXT_COLOR as UP, DOWN_TEXT_COLOR as DOWN } from '../styles/constants';
import { useReportQuery, useCategoryScope, ReportLoading } from './forestReport';
import { categoryColor } from '../library/LibraryToolbar';
import {
  SearchHero, DatasetScopePanel, ScopeSummary, useSearchIndex, NOOP_SCOPE,
} from './searchLanding';
import { useStudySelection, GeneStudySuggestions, type GeneStudyFilters } from './geneStudyScope';
import { PageShell } from '../common/PageShell';
import { EmptyState } from '../common/EmptyState';
import { DEFAULT_FDR_CUTOFF } from '../statistics/policy';
import { dirColor } from '../search/portalCards';
import { CompareSetToggle } from '../compareset/CompareSetToggle';
import { toggleItem, useCompareSet } from '../compareset/compareSetStore';
import { GeneEffectPreview } from './GeneEffectPreview';
import { GeneContextCards, GeneExpressionCards } from '../search/portalCards';
import './forestReport.css';
import type {
  DatasetGroup,
  ResolvedContrast,
  TrackRow,
} from '../types';


// The gene page: where a gene is expressed (baseline expression, single-cell
// slots), how it changes across the selected studies (grouped by research area, one table row per
// track, significant first, each log2FC opening its expression preview), and
// what changes with it (the pathways of the conditions where it changes).
// Dataset details live in the library record; tracks can be saved to the
// shared compare set. Expression previews load their track only when requested.
//
// With no gene, this draws the search and scope controls; App shows them in the
// shared gene and pathway search dialog over the hub.
// Submitting a gene opens this page under the chosen scope.
//
// Not to be confused with the explorer's per-dataset "Gene Explorer" tab, which
// draws one study's volcano. This one spans the corpus; that one goes deep on a
// single dataset, and the dataset library is the way in to it.

/** Callback used by every in-app dataset/track link in the report. */
type OpenDataset = (datasetId: string, trackId?: string) => void;

// An in-app hyperlink to a dataset (optionally at one track). A real href, so
// copy-link / middle-click / ⌘-click behave like any other link; a plain click is
// handled in place by the app.
function AppLink({
  datasetId, trackId, onOpen, title, style, children,
}: {
  datasetId: string;
  trackId?: string;
  onOpen: OpenDataset;
  title?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainLeftClick(e)) return;
    e.preventDefault();
    onOpen(datasetId, trackId);
  };
  return (
    <a href={datasetHref(datasetId, trackId)} onClick={onClick} title={title}
      style={{ color: 'var(--accent)', textDecoration: 'none', cursor: 'pointer', ...style }}>
      {children}
    </a>
  );
}

// ── Differential expression across studies ─────────────────────────────────
//
// The gene's tracks grouped by research area, the areas with the most
// significant tracks first and each with its own tally. Every row says which
// way the gene moved in words: the comparison names its first group in bold,
// and "4.1× lower in Stat3 KO" reads the log2FC as a fold change of that first
// (case) group against the second (baseline), the direction log2FC is defined
// in. A bar on one shared axis shows size and sign; the effect cell opens the
// track's expression preview on hover, focus or tap. Each row carries its
// study's actions: the library record, the explorer at that track, and the
// compare set. The significant tracks lead; the rest are one toggle away.

interface StudyRow { group: DatasetGroup; track: TrackRow }

interface AreaGroup {
  category: DatasetCategory;
  rows: StudyRow[];
  significant: number;
  up: number;
  down: number;
}

function byFdr(a: StudyRow, b: StudyRow): number {
  return (a.track.fdr ?? Number.POSITIVE_INFINITY) - (b.track.fdr ?? Number.POSITIVE_INFINITY)
    || Math.abs(b.track.logFC) - Math.abs(a.track.logFC);
}

/** "4.1× lower in Stat3 KO": the case group against its baseline, as log2FC is defined. */
function foldPhrase(track: TrackRow, contrast: ResolvedContrast | null): string {
  if (!track.logFC) return 'No change';
  const fold = 2 ** Math.abs(track.logFC);
  const times = fold >= 10 ? fold.toFixed(0) : fold.toFixed(1);
  return `${times}× ${track.logFC > 0 ? 'higher' : 'lower'} in ${contrast?.caseGroup.label ?? 'the case group'}`;
}

/** The comparison, first group in bold: the group the change describes. */
function Comparison({ contrast }: { contrast: ResolvedContrast | null }) {
  if (!contrast) return <>–</>;
  return <><b className="report-de-first">{contrast.caseGroup.label}</b> vs {contrast.baseline.label}</>;
}

function areaGroups(rows: StudyRow[]): AreaGroup[] {
  const byArea = new Map<DatasetCategory, StudyRow[]>();
  for (const row of rows) {
    const category = datasetCategory(row.group.dataset.id);
    byArea.set(category, [...(byArea.get(category) ?? []), row]);
  }
  return [...byArea].map(([category, areaRows]) => {
    const sig = areaRows.filter((r) => r.track.significant);
    return {
      category,
      rows: areaRows.sort(byFdr),
      significant: sig.length,
      up: sig.filter((r) => r.track.direction === 'up').length,
      down: sig.filter((r) => r.track.direction === 'down').length,
    };
  }).sort((a, b) => b.significant - a.significant || b.rows.length - a.rows.length
    || DATASET_CATEGORIES.indexOf(a.category) - DATASET_CATEGORIES.indexOf(b.category));
}

function GeneStudyTable({ gene, groups, onOpenDataset }: {
  gene: string;
  groups: DatasetGroup[];
  onOpenDataset?: OpenDataset;
}) {
  const all = useMemo(() => groups.flatMap((group) => group.tracks.map((track) => ({ group, track }))), [groups]);
  const significant = useMemo(() => all.filter((r) => r.track.significant), [all]);
  const measured = groups.filter((g) => g.tracks.length > 0);
  const studiesSignificant = measured.filter((g) => g.tracks.some((t) => t.significant)).length;
  const up = significant.filter((r) => r.track.direction === 'up').length;
  const down = significant.filter((r) => r.track.direction === 'down').length;
  const areasSignificant = new Set(significant.map((r) => datasetCategory(r.group.dataset.id))).size;
  const [showAll, setShowAll] = useState(false);
  // With nothing significant, the measured tracks are the table.
  const listed = showAll || significant.length === 0 ? all : significant;
  const areas = useMemo(() => areaGroups(listed), [listed]);
  // Areas measured here with no significant track, named in one line instead of drawn empty.
  const quietAreas = useMemo(() => {
    if (listed === all) return [];
    const shown = new Set(areas.map((a) => a.category));
    return [...new Set(measured.map((g) => datasetCategory(g.dataset.id)))]
      .filter((c) => !shown.has(c))
      .sort((a, b) => DATASET_CATEGORIES.indexOf(a) - DATASET_CATEGORIES.indexOf(b));
  }, [listed, all, areas, measured]);
  // One axis for every bar on the page: |log2FC| rounded up, 1 to 8.
  const bound = Math.min(8, Math.max(1, Math.ceil(Math.max(0, ...listed.map((r) => Math.abs(r.track.logFC))))));
  const compareSet = useCompareSet();
  // Each area folds. An area with significant tracks starts open; one without
  // (listed by "Show all") starts closed, unless nothing is significant at all.
  const [folded, setFolded] = useState<Partial<Record<DatasetCategory, boolean>>>({});
  const isOpen = (area: AreaGroup) => !(folded[area.category] ?? (area.significant === 0 && significant.length > 0));
  const toggleArea = (area: AreaGroup) => setFolded((f) => ({ ...f, [area.category]: isOpen(area) }));
  const areasId = useId();

  if (measured.length === 0) return <p className="portal-note">{gene} is not measured in any selected study.</p>;

  return (
    <>
      <p className="portal-verdict">
        Significant in <b>{studiesSignificant}</b> of <b>{measured.length}</b> datasets
        {significant.length > 0 && (
          <>
            , across <b>{areasSignificant}</b> research {areasSignificant === 1 ? 'area' : 'areas'}
            {' · '}<span style={{ color: UP }}><b>{up}</b> {up === 1 ? 'track' : 'tracks'} up</span>
            {' · '}<span style={{ color: DOWN }}><b>{down}</b> down</span>
          </>
        )}
        <span className="portal-cutoff"> (FDR &lt; {DEFAULT_FDR_CUTOFF})</span>
      </p>
      {significant.length === 0 && (
        <p className="portal-note">No track reaches FDR &lt; {DEFAULT_FDR_CUTOFF}. Every measured track is listed, lowest q first.</p>
      )}
      <div className="report-de-legend">
        <span>Each change is {gene} in the <b>first group</b> of the comparison, relative to the second.</span>
        <span className="report-de-legend-dirs">
          <span style={{ color: DOWN }}>◀ lower in the first group</span>
          <span aria-hidden="true" className="report-de-legend-rule" />
          <span style={{ color: UP }}>higher in the first group ▶</span>
        </span>
      </div>

      <div className="report-de-areas">
        {areas.map((area, areaIndex) => {
          const open = isOpen(area);
          const bodyId = `${areasId}-${areaIndex}`;
          const lead = area.rows[0];
          return (
          <div key={area.category} className="report-de-area portal-table-wrap" data-open={open || undefined}>
            <table className="report-de-table" data-area={area.category}>
              <caption>
                <button type="button" className="report-de-caption" aria-expanded={open} aria-controls={bodyId}
                  onClick={() => toggleArea(area)}>
                  <svg className="report-de-chevron" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
                  <span className="report-de-dot" aria-hidden="true" style={{ background: categoryColor(area.category) }} />
                  <span className="report-de-area-name">{area.category}</span>
                  <span className="report-de-area-count">
                    {area.significant > 0 ? <><b>{area.significant}</b> significant</> : `${area.rows.length} measured, none significant`}
                  </span>
                  {/* Closed, the area still says what leads it. */}
                  {!open && lead && (
                    <span className="report-de-area-lead">
                      Top: <span style={{ color: dirColor(lead.track.direction, lead.track.significant) }}>{foldPhrase(lead.track, lead.group.contrast)}</span>
                    </span>
                  )}
                  {area.significant > 0 && (
                    <span className="report-de-area-dirs">
                      <span style={{ color: UP }}>{area.up} up</span> · <span style={{ color: DOWN }}>{area.down} down</span>
                    </span>
                  )}
                </button>
              </caption>
              <colgroup>
                <col className="report-de-col-comparison" />
                <col />
                <col className="report-de-col-bar" />
                <col className="report-de-col-effect" />
                <col className="report-de-col-q" />
                <col className="report-de-col-actions" />
              </colgroup>
              <thead className="portal-sr" hidden={!open}>
                <tr>
                  <th scope="col">Comparison</th>
                  <th scope="col">Population and source</th>
                  <th scope="col">Effect bar</th>
                  <th scope="col">Change</th>
                  <th scope="col">q (FDR)</th>
                  <th scope="col">Study actions</th>
                </tr>
              </thead>
              <tbody id={bodyId} hidden={!open}>
                {area.rows.map(({ group, track }) => {
                  const { dataset, contrast } = group;
                  const item = { datasetId: dataset.id, trackId: track.trackId };
                  const inSet = compareSet.some((entry) => entry.datasetId === item.datasetId && entry.trackId === item.trackId);
                  const color = dirColor(track.direction, track.significant);
                  const half = (Math.min(Math.abs(track.logFC), bound) / bound) * 50;
                  return (
                    <tr key={`${dataset.id}:${track.trackId}`} data-significant={track.significant || undefined}>
                      <td className="report-de-comparison"><Comparison contrast={contrast} /></td>
                      {/* The population, then where it comes from. The study's full name
                          (which mostly restates the comparison) is the cell's title and
                          the Info link's label. */}
                      <td className="report-de-study" title={dataset.name}>
                        <span className="report-de-population">{track.label || track.trackId}</span>
                        {track.lowPower && (
                          <span className="portal-lowpower" title="Fewer than 3 replicates in a group: treat this result with caution.">low power</span>
                        )}
                        <span className="report-de-source">
                          <i>{dataset.organism}</i> · {dataset.preparation}
                          {dataset.geo && <> · <span className="report-de-acc">{dataset.geo}</span></>}
                        </span>
                      </td>
                      <td aria-hidden="true">
                        <span className="report-de-bar">
                          <span className="report-de-bar-zero" />
                          <span className="report-de-bar-fill" style={{ left: `${track.logFC > 0 ? 50 : 50 - half}%`, width: `${half}%`, background: color }} />
                        </span>
                      </td>
                      <td>
                        <GeneEffectPreview gene={gene} dataset={dataset} track={track} contrast={contrast}>
                          <span className="report-de-phrase" style={{ color }}>{foldPhrase(track, contrast)}</span>
                          <span className="report-de-fc">log2FC {fmtSigned(track.logFC, 2)}{!track.significant && ' · n.s.'}</span>
                        </GeneEffectPreview>
                      </td>
                      <td className="num mono">{fmtFDR(track.fdr)}</td>
                      <td className="report-de-actions">
                        <a href={libraryHref(dataset.id)} aria-label={`More information about ${dataset.name}`}>Info</a>
                        {onOpenDataset && (
                          <AppLink datasetId={dataset.id} trackId={track.trackId} onOpen={onOpenDataset}
                            title={`Open ${dataset.name}, ${track.label || track.trackId}, in the explorer`}>
                            Open →
                          </AppLink>
                        )}
                        <CompareSetToggle inSet={inSet} name={`${dataset.name}, ${track.label || track.trackId}`} onToggle={() => toggleItem(item)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          );
        })}
      </div>

      {(quietAreas.length > 0 || (significant.length > 0 && all.length > significant.length)) && (
        <div className="report-de-quiet">
          {quietAreas.length > 0 && (
            <>
              <span className="report-de-quiet-label">No significant track</span>
              <span>{quietAreas.join(' · ')}</span>
            </>
          )}
          <span className="report-de-quiet-gap" />
          {significant.length > 0 && all.length > significant.length && (
            <button type="button" className="search-more" aria-expanded={showAll} onClick={() => setShowAll((s) => !s)}>
              {showAll ? `Show only the ${significant.length} significant ${significant.length === 1 ? 'track' : 'tracks'}` : `Show all ${all.length} measured tracks`}
            </button>
          )}
        </div>
      )}
      <p className="portal-note">
        Bars share one ±{bound} log2FC axis. The fold change is 2 to the power |log2FC|. Hover or focus a
        change to preview the samples behind it. Each estimate belongs to its own dataset and comparison;
        the table does not pool them.
      </p>
    </>
  );
}

interface GeneReportProps {
  /**
   * The gene to report on. `null` is the LANDING state — the search interface
   * with nothing searched yet, which is what the hub's Gene Explorer card opens.
   */
  gene: string | null;
  /** Optional category filter the report opens with (a preset, or a `#/gene/<g>/<cat>` link). null = all. */
  scope?: DatasetCategory[] | null;
  onScopeChange?: (scope: DatasetCategory[] | null) => void;
  /**
   * Which datasets are in scope; null = all.
   *
   * Owned by App rather than by this component because submitting a gene from
   * the landing state remounts the report (the ErrorBoundary is keyed by gene),
   * and a selection made just before searching has to survive that. App also
   * serializes these restrictions into the versioned analysis URL.
   */
  datasetScope?: string[] | null;
  onDatasetScopeChange?: Dispatch<SetStateAction<string[] | null>>;
  studyFilters?: GeneStudyFilters;
  onStudyFiltersChange?: (filters: GeneStudyFilters) => void;
  onHome: () => void;
  /** Search a gene, carrying the scope it was searched under. */
  onSearchGene: (gene: string, scope?: DatasetCategory[] | null) => void;
  /** Open the side-by-side expression Compare for this gene + the current category scope. */
  onCompareDatasets?: (gene: string, scope: DatasetCategory[] | null, datasetIds: string[]) => void;
  /** Open a dataset (optionally at one track) in the explorer — the report's in-app links. */
  onOpenDataset?: OpenDataset;
  /** Show a pathway's search summary; with onOpenPathway, enables the pathways-in-these-conditions card. */
  onShowPathway?: (pathwayId: string) => void;
  /** Open a pathway's full report. */
  onOpenPathway?: (pathwayId: string) => void;
  /** Open the baseline expression survey from the expression card. */
  onOpenExpression?: () => void;
  headerRight?: ReactNode;
}

/** The serialized selection keeps the report hook's key and requested corpus aligned. */
async function querySelectedGene(key: string, options: { onProgress: (loaded: number, total: number) => void }) {
  const [gene, ids]: [string, string[]] = JSON.parse(key);
  const datasets = listDatasets().filter((dataset) => ids.includes(dataset.id));
  if (datasets.length === 0) return { gene, total: 0, loaded: 0, groups: [] };
  return queryGeneAcrossDatasets(gene, { ...options, datasets });
}

export function GeneReport({
  gene, scope, onScopeChange, datasetScope = null, onDatasetScopeChange,
  studyFilters, onStudyFiltersChange,
  onHome, onSearchGene, onCompareDatasets, onOpenDataset, onShowPathway, onOpenPathway, onOpenExpression, headerRight,
}: GeneReportProps) {
  const [query, setQuery] = useState(gene || '');
  const categories = useCategoryScope(scope, onScopeChange);
  const { activeCats, toggleCat } = categories;
  const geneIndex = useSearchIndex(loadGeneIndex);
  const { cards, eligibleCards, availableDatasets, selectedDatasets, awaitingCounts,
    queryKey, filters, changeFilters, reset } = useStudySelection({
    kind: 'gene', term: gene || '', categories, datasetScope,
    studyFilters, onStudyFiltersChange, onDatasetScopeChange,
  });
  const { result, loading, progress, bytes, error } = useReportQuery(
    queryKey, querySelectedGene, 'Could not load cross-dataset data.',
  );

  useEffect(() => { setQuery(gene || ''); }, [gene]);

  // A follow-up search keeps the scope the user is currently reading under.
  // Dropping it here (as an unscoped search would) silently widens the report
  // back to the whole corpus on every gene change.
  const currentScope = useCallback(
    () => (activeCats ? [...activeCats] : null),
    [activeCats],
  );

  const submit = useCallback(() => {
    const g = query.trim();
    if (g && g !== gene) onSearchGene(g, currentScope());
  }, [query, gene, onSearchGene, currentScope]);

  // The two filters: the selected datasets, then the visible categories.
  const visibleGroups = useMemo(
    () => result?.groups.filter((group) => selectedDatasets.some((dataset) => dataset.id === group.dataset.id)
      && (!activeCats || activeCats.has(datasetCategory(group.dataset.id)))) ?? [],
    [result, selectedDatasets, activeCats],
  );
  const scopeLabel = activeCats ? [...activeCats].join(' + ') : null;
  // The studies the pathways card follows: the selection, narrowed to the
  // visible categories as the table is. null until sample counts settle it.
  const contextStudies = useMemo(
    () => (awaitingCounts ? null : selectedDatasets.filter((d) => !activeCats || activeCats.has(datasetCategory(d.id)))),
    [awaitingCounts, selectedDatasets, activeCats],
  );

  const scopeControls = (
    <>
      <GeneStudySuggestions cards={cards} eligibleCards={eligibleCards} categories={activeCats} filters={filters}
        hasIndividualSelection={datasetScope !== null} onCategory={toggleCat} onFilters={changeFilters}
        onReset={reset} />
      <DatasetScopePanel datasets={availableDatasets} selected={datasetScope}
        onChange={onDatasetScopeChange ?? NOOP_SCOPE} allowEmpty />
      <ScopeSummary>
        <span role="status">{awaitingCounts ? 'Loading sample counts…' : `${selectedDatasets.length} of ${cards.length} datasets selected`}</span>
        {filters.minSamples > 0 && <span className="qsearch-filter-note">Sample counts apply to the default population and comparison; other populations may differ. Unknown counts are excluded.</span>}
        {filters.requiredChecks.length > 0 && <span className="qsearch-filter-note">Only datasets passing each selected quality check are included.</span>}
        {!awaitingCounts && selectedDatasets.length === 0 && <span className="qsearch-filter-note">No datasets match. Change the filters or choose All datasets.</span>}
      </ScopeSummary>
    </>
  );

  // ── Landing state: the search interface, nothing searched yet ─────────────
  if (!gene) {
    return (
      <div className="report-main report-search-dialog">
        <SearchHero
          headline="Gene Explorer"
          placeholder="Search a gene, e.g. POMC, AGRP, LEPR"
          ariaLabel="Search a gene across all datasets"
          action="Search"
          index={geneIndex}
          onSubmit={(g) => onSearchGene(g, currentScope())}
        >
          {scopeControls}
        </SearchHero>
      </div>
    );
  }

  return (
    <PageShell
      onHome={onHome}
      headerRight={headerRight}
      fill
      breadcrumbs={[
        { label: 'Gene Explorer' },
        { label: gene, current: true },
      ]}
      mainStyle={{ overflowY: 'auto' }}
    >
      <div className="report-main">
        {/* Gene header + search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)', lineHeight: 1 }}>{gene}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{scopeLabel ? `Across the ${scopeLabel} datasets` : 'Where it is expressed and how it changes across datasets'}</div>
          </div>
          <div style={{ position: 'relative', flex: 1, minWidth: 240, maxWidth: 380 }}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              aria-label="Search another gene" placeholder="Search another gene…"
              style={{ width: '100%', height: 38, padding: '0 12px 0 34px', fontSize: 13, fontFamily: 'inherit', border: '1px solid var(--border-dark)', borderRadius: 'var(--r-lg)', background: 'var(--bg-panel)', outline: 'none', color: 'var(--text-primary)' }} />
          </div>
          {onCompareDatasets && (
            <button type="button" disabled={awaitingCounts || selectedDatasets.length === 0}
              onClick={() => onCompareDatasets(gene, currentScope(), selectedDatasets.map((dataset) => dataset.id))}
              title="Compare this gene's expression side by side across datasets"
              style={{ fontSize: 12, padding: '8px 13px', border: '1px solid var(--border-dark)', borderRadius: 'var(--r-lg)', background: 'var(--bg-panel)', color: 'var(--text-mono)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
              Compare as bars →
            </button>
          )}
        </div>

        {/* Where the gene is expressed, before how it changes. */}
        <div className="report-gene-cards">
          <GeneExpressionCards symbol={gene} onOpenExpression={onOpenExpression} />
        </div>

        {/* How it changes. The study filters sit with the table they narrow; the
            pathways card below follows the same selection. */}
        <section className="portal-card report-de-card" data-section="differential-expression" aria-labelledby="report-de-title">
          <h2 id="report-de-title" className="portal-card-title">Differential expression across studies</h2>
          <details className="report-filters">
            <summary>Study filters <span>{selectedDatasets.length} datasets selected</span></summary>
            <div>{scopeControls}</div>
          </details>

          {loading || awaitingCounts ? (
            <ReportLoading
              label={awaitingCounts ? 'Loading sample counts…' : `Loading ${gene} across ${progress.total || 'selected'} tracks…`}
              progress={progress}
              bytes={bytes}
              unit="tracks"
              hint="The first search may take longer while datasets load."
            />
          ) : error ? (
            <EmptyState title="Could not load cross-dataset data." hint={error} />
          ) : result ? (
            visibleGroups.length === 0 ? (
              <EmptyState
                title={selectedDatasets.length === 0 ? 'No datasets selected.' : 'No results for this selection.'}
                hint="Change the study selection above, or choose All datasets."
              />
            ) : (
              <GeneStudyTable gene={gene} groups={visibleGroups} onOpenDataset={onOpenDataset} />
            )
          ) : null}
        </section>

        {/* What changes with it, in the conditions where it changes. */}
        {onShowPathway && onOpenPathway && (
          <div className="report-gene-cards report-gene-cards--after">
            <GeneContextCards symbol={gene} studies={contextStudies} onShowPathway={onShowPathway} onOpenPathway={onOpenPathway} />
          </div>
        )}
      </div>
    </PageShell>
  );
}
