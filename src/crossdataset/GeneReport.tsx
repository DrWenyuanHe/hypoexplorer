import { useState, useEffect, useId, useMemo, useCallback } from 'react';
import type { Dispatch, MouseEvent, ReactNode, SetStateAction } from 'react';
import { queryGeneAcrossDatasets } from '../data/crossDataset';
import { datasetCategory, DATASET_CATEGORIES } from '../data/datasets';
import type { DatasetCategory } from '../data/datasets';
import { datasetHref, libraryHref, isPlainLeftClick } from '../utils/appLinks';
import { fmtFDR, fmtP, fmtSigned } from '../utils/format';
import { FONT_MONO } from '../styles/constants';
import { directionTextColor } from '../statistics/direction';
import { nominalCaveat, noneLeads, leadingTracks } from '../statistics/listingWords';
import { useReportQuery, ReportLoading } from './forestReport';
import { categoryColor } from '../library/LibraryToolbar';
import { useStudySelection, type StudyQuery } from './studySelection';
import type { StudySelection } from './studySelectionLink';
import { StudySelectionPanel } from './StudySelectionPanel';
import { PageShell } from '../common/PageShell';
import { EmptyState } from '../common/EmptyState';
import { DEFAULT_FDR_CUTOFF, NOMINAL_P_CUTOFF } from '../statistics/policy';
import { GENE_KEYS, listCrossStudy, type Listed } from '../statistics/crossStudyListing';
import { TierLabel } from '../statistics/TierLabel';
import { useListingMode, type ListingMode } from '../statistics/listingModeStore';
import { ListingModeToggle, QTerm } from '../statistics/ListingModeToggle';
import { CompareSetToggle } from '../compareset/CompareSetToggle';
import { toggleItem, useCompareSet } from '../compareset/compareSetStore';
import { GeneEffectPreview } from './GeneEffectPreview';
import { GeneContextCards, GeneExpressionCards } from '../search/portalCards';
import type { SurveyScope } from '../expression-survey/expressionSurvey';
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
// Searching another gene from the box in its header keeps the chosen scope.
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
// compare set. The tracks at raw p < 0.05 lead: FDR survivors first, labelled
// FDR < 0.05, then the nominal ones, labelled p < 0.05 only and never counted
// as significant. The rest are one toggle away.

type StudyRow = Listed<DatasetGroup, TrackRow>;

interface AreaGroup {
  category: DatasetCategory;
  /** The rows the table shows for this area, in the listing's order. */
  rows: StudyRow[];
  significant: number;
  /** Tracks at raw p < 0.05 that fail FDR: labelled, never counted as significant. */
  nominal: number;
  up: number;
  down: number;
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

/**
 * The research areas, each its own cross-study listing over the area's
 * studies. `showRest`: list every measured track; otherwise only the tracks
 * that lead in the mode, and an area with none is left out.
 */
function areaGroups(groups: DatasetGroup[], mode: ListingMode, showRest: boolean): AreaGroup[] {
  const byArea = new Map<DatasetCategory, DatasetGroup[]>();
  for (const group of groups) {
    const category = datasetCategory(group.dataset.id);
    byArea.set(category, [...(byArea.get(category) ?? []), group]);
  }
  return [...byArea].flatMap(([category, inArea]): AreaGroup[] => {
    const { lead, rest, tracks, nominal } = listCrossStudy(inArea, mode, GENE_KEYS, 'significance');
    const rows = showRest ? [...lead, ...rest] : lead;
    if (rows.length === 0) return [];
    return [{ category, rows, significant: tracks.fdr, nominal: nominal?.tracks ?? 0, up: tracks.up, down: tracks.down }];
  }).sort((a, b) => b.significant - a.significant || b.nominal - a.nominal || b.rows.length - a.rows.length
    || DATASET_CATEGORIES.indexOf(a.category) - DATASET_CATEGORIES.indexOf(b.category));
}

function GeneStudyTable({ gene, groups, onOpenDataset }: {
  gene: string;
  groups: DatasetGroup[];
  onOpenDataset?: OpenDataset;
}) {
  const mode = useListingMode();
  const nominalMode = mode === 'nominal';
  // What the table leads with: the FDR survivors and, in the p < 0.05 listing,
  // the nominal tracks after them, labelled.
  const { lead, tracks, datasets, nominal: nominalCounts } = useMemo(
    () => listCrossStudy(groups, mode, GENE_KEYS, 'significance'),
    [groups, mode],
  );
  const nominal = nominalCounts?.tracks ?? 0;
  const measured = groups.filter((g) => g.tracks.length > 0);
  // A study whose data did not load says nothing about the gene, so it is
  // named rather than counted as not measuring it.
  const failed = groups.filter((g) => g.error);
  const failedNote = failed.length > 0 && (
    <p className="portal-note" role="status">
      {failed.length} selected {failed.length === 1 ? 'study' : 'studies'} could not be loaded
      ({failed.map((g) => g.dataset.name).join(', ')}), so {gene} may be measured there.
    </p>
  );
  const significantCount = tracks.fdr;
  const studiesSignificant = datasets.fdr;
  const { up, down } = tracks;
  const areasSignificant = new Set(lead.filter((r) => r.track.tier === 'fdr').map((r) => datasetCategory(r.group.dataset.id))).size;
  const [showAll, setShowAll] = useState(false);
  // With nothing to lead with, the measured tracks are the table.
  const showRest = showAll || lead.length === 0;
  const areas = useMemo(() => areaGroups(groups, mode, showRest), [groups, mode, showRest]);
  // Areas measured here with nothing to lead with, named in one line instead of drawn empty.
  const quietAreas = useMemo(() => {
    if (showRest) return [];
    const shown = new Set(areas.map((a) => a.category));
    return [...new Set(measured.map((g) => datasetCategory(g.dataset.id)))]
      .filter((c) => !shown.has(c))
      .sort((a, b) => DATASET_CATEGORIES.indexOf(a) - DATASET_CATEGORIES.indexOf(b));
  }, [showRest, areas, measured]);
  // One axis for every bar on the page: |log2FC| rounded up, 1 to 8.
  const bound = Math.min(8, Math.max(1, Math.ceil(Math.max(0, ...areas.flatMap((a) => a.rows.map((r) => Math.abs(r.track.logFC)))))));
  const compareSet = useCompareSet();
  // Each area folds. An area with a track the table leads with starts open; one
  // without (listed by "Show all") starts closed, unless nothing leads at all.
  const [folded, setFolded] = useState<Partial<Record<DatasetCategory, boolean>>>({});
  const isOpen = (area: AreaGroup) => !(folded[area.category] ?? (area.significant + area.nominal === 0 && lead.length > 0));
  const toggleArea = (area: AreaGroup) => setFolded((f) => ({ ...f, [area.category]: isOpen(area) }));
  const areasId = useId();

  if (measured.length === 0) {
    if (failed.length === 0) return <p className="portal-note">{gene} is not measured in any selected study.</p>;
    return (
      <>
        {failed.length < groups.length && <p className="portal-note">{gene} is not measured in any selected study that loaded.</p>}
        {failedNote}
      </>
    );
  }

  return (
    <>
      {failedNote}
      <div className="report-de-mode"><ListingModeToggle /></div>
      <p className="portal-verdict">
        Significant in <b>{studiesSignificant}</b> of <b>{measured.length}</b> datasets
        {significantCount > 0 && (
          <>
            , across <b>{areasSignificant}</b> research {areasSignificant === 1 ? 'area' : 'areas'}
            {' · '}<span style={{ color: directionTextColor('up', 'fdr') }}><b>{up}</b> {up === 1 ? 'track' : 'tracks'} up</span>
            {' · '}<span style={{ color: directionTextColor('down', 'fdr') }}><b>{down}</b> down</span>
          </>
        )}
        <span className="portal-cutoff"> (FDR &lt; {DEFAULT_FDR_CUTOFF})</span>
        {nominal > 0 && (
          <span className="portal-cutoff"> · {nominal} more {nominal === 1 ? 'track' : 'tracks'} at p &lt; {NOMINAL_P_CUTOFF} only</span>
        )}
      </p>
      {nominal > 0 ? (
        <p className="portal-note">
          {significantCount === 0 ? `No track reaches FDR < ${DEFAULT_FDR_CUTOFF}. ` : ''}
          Tracks at p &lt; {NOMINAL_P_CUTOFF} that do not pass FDR are listed after the FDR results and marked{' '}
          <i>p &lt; {NOMINAL_P_CUTOFF} only</i>: they are {nominalCaveat('gene')}
        </p>
      ) : significantCount === 0 && (
        nominalMode
          ? <p className="portal-note">No track reaches p &lt; {NOMINAL_P_CUTOFF}. Every measured track is listed, lowest p first.</p>
          : <p className="portal-note">No track reaches FDR &lt; {DEFAULT_FDR_CUTOFF}. Every measured track is listed, lowest q first.</p>
      )}
      <div className="report-de-legend">
        <span>
          Each change is {gene} in the <b>first group</b> of the comparison, relative to the second.
          {' '}<QTerm /> is the FDR-adjusted p-value.
        </span>
        <span className="report-de-legend-dirs">
          <span style={{ color: directionTextColor('down', 'fdr') }}>◀ lower in the first group</span>
          <span aria-hidden="true" className="report-de-legend-rule" />
          <span style={{ color: directionTextColor('up', 'fdr') }}>higher in the first group ▶</span>
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
                    {area.significant > 0 ? <><b>{area.significant}</b> significant</> : area.nominal > 0 ? 'none significant' : `${area.rows.length} measured, none significant`}
                    {area.nominal > 0 && <> · <b>{area.nominal}</b> at p &lt; {NOMINAL_P_CUTOFF} only</>}
                  </span>
                  {/* Closed, the area still says what leads it. */}
                  {!open && lead && (
                    <span className="report-de-area-lead">
                      Top: <span style={{ color: directionTextColor(lead.track.direction, lead.track.tier) }}>{foldPhrase(lead.track, lead.group.contrast)}</span>
                    </span>
                  )}
                  {area.significant > 0 && (
                    <span className="report-de-area-dirs">
                      <span style={{ color: directionTextColor('up', 'fdr') }}>{area.up} up</span> · <span style={{ color: directionTextColor('down', 'fdr') }}>{area.down} down</span>
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
                  <th scope="col">q (FDR) and call</th>
                  <th scope="col">Study actions</th>
                </tr>
              </thead>
              <tbody id={bodyId} hidden={!open}>
                {area.rows.map(({ group, track }) => {
                  const { dataset, contrast } = group;
                  const item = { datasetId: dataset.id, trackId: track.trackId };
                  const inSet = compareSet.some((entry) => entry.datasetId === item.datasetId && entry.trackId === item.trackId);
                  const color = directionTextColor(track.direction, track.tier);
                  const half = (Math.min(Math.abs(track.logFC), bound) / bound) * 50;
                  const { tier } = track;
                  return (
                    <tr key={`${dataset.id}:${track.trackId}`} data-significant={track.significant || undefined} data-tier={tier}>
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
                          <span className="report-de-fc">
                            log2FC {fmtSigned(track.logFC, 2)}
                            {tier === 'nominal' ? ` · p ${fmtP(track.pval)}` : tier === 'none' ? ' · n.s.' : ''}
                          </span>
                        </GeneEffectPreview>
                      </td>
                      <td className="num mono">
                        {/* Named in the cell: the column headers are for screen readers only, and a bare
                            number above "p < 0.05 only" reads as the p-value. */}
                        {/* Hover-only per row: one tab stop per row would bury the actions.
                            The legend's q is the keyboard-reachable copy. */}
                        <span className="report-de-qlabel"><QTerm focusable={false} /></span> {fmtFDR(track.fdr)}
                        {/* The change cell already says "n.s." for the untiered rows. */}
                        {tier !== 'none' && <TierLabel tier={tier} className="report-de-tier" />}
                      </td>
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

      {(quietAreas.length > 0 || (lead.length > 0 && tracks.measured > lead.length)) && (
        <div className="report-de-quiet">
          {quietAreas.length > 0 && (
            <>
              <span className="report-de-quiet-label">{noneLeads(mode)}</span>
              <span>{quietAreas.join(' · ')}</span>
            </>
          )}
          <span className="report-de-quiet-gap" />
          {lead.length > 0 && tracks.measured > lead.length && (
            <button type="button" className="search-more" aria-expanded={showAll} onClick={() => setShowAll((s) => !s)}>
              {showAll ? `Show only the ${leadingTracks(mode, lead.length)}` : `Show all ${tracks.measured} measured tracks`}
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
  /** The gene to report on. */
  gene: string;
  /**
   * The gene report's study selection (categories, individual studies,
   * filters) and its setter. Owned by the router rather than by this component
   * because searching another gene remounts the report (the ErrorBoundary is
   * keyed by gene), and the selection has to survive that; the router also
   * writes it into the URL.
   */
  selection: StudySelection;
  onSelectionChange: Dispatch<SetStateAction<StudySelection>>;
  onHome: () => void;
  /** Search a gene, carrying the scope it was searched under. */
  onSearchGene: (gene: string, scope?: DatasetCategory[] | null) => void;
  /** Open a dataset (optionally at one track) in the explorer — the report's in-app links. */
  onOpenDataset?: OpenDataset;
  /** Show a pathway's search summary; with onOpenPathway, enables the pathways-in-these-conditions card. */
  onShowPathway?: (pathwayId: string) => void;
  /** Open a pathway's full report. */
  onOpenPathway?: (pathwayId: string) => void;
  /** Open the expression survey page (multi-gene comparison, catalog) from the expression card. */
  onOpenExpression?: () => void;
  /** The survey page's scope when it handed this gene over: the card opens every source in it. */
  expressionScope?: SurveyScope;
  headerRight?: ReactNode;
}

/** Query the selected studies; an empty selection asks for nothing. */
async function queryGene({ term, datasets }: StudyQuery, options: { onProgress: (loaded: number, total: number) => void }) {
  if (datasets.length === 0) return { gene: term, total: 0, loaded: 0, groups: [] };
  return queryGeneAcrossDatasets(term, { ...options, datasets });
}

export function GeneReport({
  gene, selection: value, onSelectionChange,
  onHome, onSearchGene, onOpenDataset, onShowPathway, onOpenPathway, onOpenExpression, expressionScope, headerRight,
}: GeneReportProps) {
  const [query, setQuery] = useState(gene);
  const selection = useStudySelection({ kind: 'gene', term: gene, value, onChange: onSelectionChange });
  const { activeCategories, selectedDatasets, awaitingCounts, visibleGroups: selectGroups } = selection;
  const { result, loading, progress, bytes, error } = useReportQuery(
    selection.query, queryGene, 'Could not load cross-dataset data.',
  );

  useEffect(() => { setQuery(gene); }, [gene]);

  // A follow-up search keeps the categories the user is currently reading
  // under. Dropping them here (as an unscoped search would) silently widens the
  // report back to the whole corpus on every gene change.
  const categories = value.categories;
  const submit = useCallback(() => {
    const g = query.trim();
    if (g && g !== gene) onSearchGene(g, categories);
  }, [query, gene, onSearchGene, categories]);

  const visibleGroups = useMemo(() => (result ? selectGroups(result.groups) : []), [result, selectGroups]);
  const scopeLabel = activeCategories ? [...activeCategories].join(' + ') : null;
  // The studies the pathways card follows: the selection the table shows.
  // null until sample counts settle it.
  const contextStudies = awaitingCounts ? null : selectedDatasets;

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
        </div>

        {/* Where the gene is expressed, before how it changes. */}
        <div className="report-gene-cards">
          <GeneExpressionCards symbol={gene} surveyScope={expressionScope} onOpenExpression={onOpenExpression} />
        </div>

        {/* How it changes. The study filters sit with the table they narrow; the
            pathways card below follows the same selection. */}
        <section className="portal-card report-de-card" data-section="differential-expression" aria-labelledby="report-de-title">
          <h2 id="report-de-title" className="portal-card-title">Differential expression across studies</h2>
          <StudySelectionPanel selection={selection} />

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
