// Cross-dataset pathway report: the FGSEA analog of GeneReport. Search a
// pathway, see its enrichment (NES) across every track of every pathway-capable
// dataset on one shared NES axis, grouped by model category.
//
// FGSEA is computed for both macaque (per cell population) and the mouse datasets
// (scripts/run_mouse_fgsea.R), so the report resolves across the whole resource;
// the methods note states how the ranking/coverage work.

import { useState, useMemo } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { queryPathwayAcrossDatasets, loadPathwayIndex } from '../data/crossDataset';
import { datasetCategory, DATASET_CATEGORIES, listDatasets } from '../data/datasets';
import { datasetHref, libraryHref } from '../utils/appLinks';
import { CompareSetToggle } from '../compareset/CompareSetToggle';
import { toggleItem, useCompareSet } from '../compareset/compareSetStore';
import { PathwayEffectPreview } from './PathwayEffectPreview';
import './forestReport.css';
import type { DatasetCategory } from '../data/datasets';
import { fmtP, fmtFDR, fmtSigned } from '../utils/format';
import { FONT_MONO, DIRECTION_UP_COLOR as UP, DIRECTION_DOWN_COLOR as DOWN } from '../styles/constants';
import {
  FOREST_GRID, axisPct, directionColor, contrastLabel, groupForestCategories, useReportQuery,
  useCategoryScope, ReportLoading, type CategoryScope,
} from './forestReport';
import {
  SearchHero, DatasetScopePanel, ScopeSummary, useSearchIndex, NOOP_SCOPE,
} from './searchLanding';
import { useStudySelection, GeneStudySuggestions as StudySuggestions, type GeneStudyFilters } from './geneStudyScope';
import { PageShell } from '../common/PageShell';
import { DEFAULT_FDR_CUTOFF, NOMINAL_P_CUTOFF, significanceTier, type SignificanceTier } from '../statistics/policy';
import { TierLabel } from '../search/portalCards';
import { useListingMode } from '../statistics/listingModeStore';
import { ListingModeToggle, QTerm } from '../statistics/ListingModeToggle';
import { EmptyState } from '../common/EmptyState';
import type { PathwayDatasetGroup, PathwayTrackRow } from '../types';

function fmtNes(nes: number): string {
  return fmtSigned(nes, 2);
}

/**
 * The row's tier. `track.significant` is the row builder's FDR call, so the
 * tier agrees with it by construction and adds the nominal raw-p tier beneath.
 */
function tierOf(track: PathwayTrackRow): SignificanceTier {
  return track.significant ? 'fdr' : significanceTier(null, track.pval);
}

const TIER_RANK: Record<SignificanceTier, number> = { fdr: 0, nominal: 1, none: 2 };

/** FDR survivors, then nominal tracks, then the rest; each by |NES|, the forest's own order. */
function byTierThenEffect(a: PathwayTrackRow, b: PathwayTrackRow): number {
  return TIER_RANK[tierOf(a)] - TIER_RANK[tierOf(b)] || Math.abs(b.NES) - Math.abs(a.NES);
}

// One NES forest row on a shared zero-centered axis. Point-only by design (no
// CI whisker): fgsea reports no SE for NES, so the dot
// stands alone rather than implying an interval we don't have.
function ForestRow({ track, bound, group, pathway }: { track: PathwayTrackRow; bound: number; group: PathwayDatasetGroup; pathway: string }) {
  const pct = axisPct(track.NES, bound);
  const color = directionColor(track.direction, track.significant);
  return (
    <div className="report-forest-row" data-tier={tierOf(track)} style={{ display: 'grid', gridTemplateColumns: FOREST_GRID, alignItems: 'center', gap: 12, padding: '5px 8px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <a href={datasetHref(group.dataset.id, track.trackId, 'pathway')} title={`Open ${track.trackId} in the pathway explorer`}
          style={{ fontFamily: FONT_MONO, color: 'var(--accent)', minWidth: 34, textDecoration: 'underline dotted', textUnderlineOffset: 2 }}>{track.trackId}</a>
        <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {track.label.replace(/^[a-z]\d+\s*/i, '')}
        </span>
      </span>
      <PathwayEffectPreview pathway={pathway} dataset={group.dataset} track={track} contrast={group.contrast}>
      <div style={{ position: 'relative', height: 18 }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--border-dark)' }} />
        <span style={{ position: 'absolute', top: '50%', left: `${pct}%`, transform: 'translate(-50%, -50%)', width: 11, height: 11, borderRadius: '50%', background: track.significant ? color : 'var(--bg-panel)', border: `2px solid ${color}` }} />
      </div>
      <span style={{ fontFamily: FONT_MONO, textAlign: 'right', color }}>{fmtNes(track.NES)}</span>
      </PathwayEffectPreview>
      <span style={{ fontFamily: FONT_MONO, textAlign: 'right', color: 'var(--text-muted)' }}>{fmtP(track.pval)}</span>
      <span style={{ fontFamily: FONT_MONO, textAlign: 'right', color: 'var(--text-mono)' }}>{fmtFDR(track.padj)}</span>
      {/* The call, in the words the search portal and the gene report use. The
          direction is the NES sign beside it and the dot's side of zero. */}
      <span style={{ justifySelf: 'end' }}><TierLabel tier={tierOf(track)} /></span>
    </div>
  );
}

function categorize(groups: PathwayDatasetGroup[]) {
  return groupForestCategories(groups, {
    order: DATASET_CATEGORIES,
    categoryOf: (g) => datasetCategory(g.dataset.id),
  });
}

function AxisHeader({ bound }: { bound: number }) {
  return <div className="report-forest-axis" style={{ display: 'grid', gridTemplateColumns: FOREST_GRID, gap: 12, padding: '2px 8px 4px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)' }}>
    <span>TRACK</span>
    <span style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-dark)', fontFamily: FONT_MONO, fontSize: 9, fontWeight: 400 }}>
      <span>−{bound.toFixed(1)}</span><span>0</span><span>+{bound.toFixed(1)}</span>
    </span>
    {/* Hover-only here, one header per dataset block; the legend's FDR is the keyboard-reachable copy. */}
    <span style={{ textAlign: 'right' }}>NES</span><span style={{ textAlign: 'right' }}>P</span><span style={{ textAlign: 'right' }}><QTerm focusable={false}>FDR</QTerm></span><span style={{ justifySelf: 'end' }}>CALL</span>
  </div>;
}

function DatasetBlock({ group, bound, pathway }: { group: PathwayDatasetGroup; bound: number; pathway: string }) {
  const byEffect = useMemo(() => group.tracks.slice().sort((a, b) => Math.abs(b.NES) - Math.abs(a.NES)), [group.tracks]);
  const ordered = useMemo(() => byEffect.slice().sort(byTierThenEffect), [byEffect]);
  const significant = byEffect.filter((track) => track.significant);
  const nominalMode = useListingMode() === 'nominal';
  // The order rows list in: FDR survivors, then (p < 0.05 listing) nominal tracks.
  const listOrder = nominalMode ? ordered : byEffect;
  // What the block leads with: the FDR survivors and, in the p < 0.05 listing,
  // the nominal tracks after them, labelled.
  const lead = nominalMode ? ordered.filter((track) => tierOf(track) !== 'none') : significant;
  const nominal = lead.length - significant.length;
  const shown = listOrder.length <= 3 ? listOrder : lead;
  const hidden = listOrder.length - shown.length;
  const strongest = significant[0] ?? byEffect[0];
  // Null until the reader folds or opens it, so a mode switch re-derives the default.
  const [openPick, setOpen] = useState<boolean | null>(null);
  const open = openPick ?? (lead.length > 0 || byEffect.length <= 3);
  const [showAll, setShowAll] = useState(false);
  const compareSet = useCompareSet();
  const item = { datasetId: group.dataset.id, trackId: group.dataset.defaultTrack };
  const inSet = compareSet.some((entry) => entry.datasetId === item.datasetId && entry.trackId === item.trackId);

  return <div className="report-dataset">
    <div className="report-dataset-header">
      <button type="button" className="report-dataset-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden="true" style={{ color: 'var(--text-muted)', fontSize: 10, width: 10 }}>{open ? '▾' : '▸'}</span>
        <span className="report-dataset-identity">
          <span className="report-dataset-name">{group.dataset.name}</span>
          <span className="report-dataset-comparison">{contrastLabel(group.contrast)}</span>
          <span className="report-dataset-summary">
            {byEffect.length} track{byEffect.length === 1 ? '' : 's'} · {significant.length} significant
            {nominal > 0 && <> · {nominal} at p &lt; {NOMINAL_P_CUTOFF} only</>}
            {!open && strongest && <span style={{ color: directionColor(strongest.direction, strongest.significant) }}> · strongest {fmtNes(strongest.NES)}</span>}
          </span>
        </span>
      </button>
      <div className="report-dataset-actions">
        <a href={libraryHref(group.dataset.id)} aria-label={`More information about ${group.dataset.name}`}>More information</a>
        <a href={datasetHref(group.dataset.id, group.dataset.defaultTrack, 'pathway')} title={`Browse ${group.dataset.name} in the pathway explorer`} style={{ fontWeight: 600 }}>Open →</a>
        <CompareSetToggle inSet={inSet} name={group.dataset.name} onToggle={() => toggleItem(item)} />
      </div>
    </div>
    {open && <div className="report-dataset-results">
      <div className="report-forest-table">
        <AxisHeader bound={bound} />
        {(showAll ? listOrder : shown).map((track) => <ForestRow key={track.trackId} track={track} bound={bound} group={group} pathway={pathway} />)}
        {shown.length === 0 && !showAll && <div style={{ padding: '6px 8px', fontSize: 12, color: 'var(--text-muted)' }}>
          {group.error ? 'Could not load this dataset.'
            : byEffect.length === 0 ? 'Pathway not present in any track.'
              : nominalMode ? `No track at p < ${NOMINAL_P_CUTOFF}. Show the full list below.` : 'No significant tracks. Show the full list below.'}
        </div>}
        {hidden > 0 && <button type="button" className="report-show-tracks" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
          <span aria-hidden="true">{showAll ? '▾' : '▸'} </span>
          {showAll
            ? nominalMode
              ? `Show only the ${lead.length} track${lead.length === 1 ? '' : 's'} at p < ${NOMINAL_P_CUTOFF}`
              : `Show only the ${lead.length} significant track${lead.length === 1 ? '' : 's'}`
            : `Show all ${byEffect.length} tracks`}
          {!showAll && <span style={{ color: 'var(--text-muted)' }}> ({hidden} {nominalMode ? <>not at p &lt; {NOMINAL_P_CUTOFF}</> : 'not significant'})</span>}
        </button>}
      </div>
    </div>}
  </div>;
}

function CategorySection({ category, groups, bound, pathway, forceOpen }: { category: DatasetCategory; groups: PathwayDatasetGroup[]; bound: number; pathway: string; forceOpen: boolean }) {
  const significant = groups.filter((group) => group.tracks.some((track) => track.significant)).length;
  const nominalMode = useListingMode() === 'nominal';
  // Datasets whose best track is nominal: one or more at p < 0.05, none passing
  // FDR. Counted only in the p < 0.05 listing.
  const nominalOnly = nominalMode ? groups.filter((group) => !group.tracks.some((track) => track.significant)
    && group.tracks.some((track) => tierOf(track) === 'nominal')).length : 0;
  // Null until the reader folds or opens it, so a mode switch re-derives the default.
  const [openPick, setOpen] = useState<boolean | null>(null);
  const open = openPick ?? significant + nominalOnly > 0;
  const isOpen = forceOpen || open;
  return <section className="card" style={{ padding: 0, marginBottom: 14, overflow: 'hidden' }}>
    <button type="button" aria-expanded={isOpen} onClick={() => setOpen(!open)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', flexWrap: 'wrap' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 12, width: 12 }}>{isOpen ? '▾' : '▸'}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{category}</span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: FONT_MONO }}>{groups.length} dataset{groups.length === 1 ? '' : 's'} · {significant} significant{nominalOnly > 0 && <> · {nominalOnly} at p &lt; {NOMINAL_P_CUTOFF} only</>}</span>
    </button>
    {isOpen && <div className="report-category-results">
      {groups.map((group) => <DatasetBlock key={group.dataset.id} group={group} bound={bound} pathway={pathway} />)}
    </div>}
  </section>;
}

// Pathway search autocomplete over the loaded gs_name index (substring match —
// pathway tokens are long, so prefix-priority like the gene box does not fit).
function PathwaySearch({ index, onPick }: { index: string[]; onPick: (p: string) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const suggestions = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (q.length < 2) return [];
    return index.filter((p) => p.toUpperCase().includes(q)).slice(0, 15);
  }, [query, index]);
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 260, maxWidth: 460 }}>
      <input type="text" value={query} onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === 'Enter' && suggestions.length) { onPick(suggestions[0]); setQuery(''); setOpen(false); } }}
        aria-label="Search a pathway" placeholder="Search a pathway, e.g. ADIPOGENESIS"
        style={{ width: '100%', height: 38, padding: '0 12px', fontSize: 13, fontFamily: FONT_MONO, border: '1px solid var(--border-dark)', borderRadius: 'var(--r-lg)', background: 'var(--bg-panel)', outline: 'none', color: 'var(--text-primary)' }} />
      {open && suggestions.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 100, background: 'var(--bg-panel)', border: '1px solid var(--border-dark)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', width: '100%', maxHeight: 300, overflowY: 'auto', marginTop: 2 }}>
          {suggestions.map((p) => (
            <button type="button" key={p} className="hover-row" onMouseDown={() => { onPick(p); setQuery(''); setOpen(false); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', cursor: 'pointer', fontSize: 11, fontFamily: FONT_MONO, color: 'var(--text-primary)', border: 'none', background: 'none' }}>
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface PathwayReportProps {
  /**
   * The pathway to report on. `null` is the LANDING state — the search
   * interface, which is what the hub's Pathway Explorer card opens.
   */
  pathway: string | null;
  /** Held above the report's error boundary so searches and retries retain it. */
  categoryScope?: CategoryScope<DatasetCategory>;
  /**
   * Which datasets are in scope; null = all. App preserves this in the analysis URL.
   */
  datasetScope?: string[] | null;
  onDatasetScopeChange?: Dispatch<SetStateAction<string[] | null>>;
  studyFilters?: GeneStudyFilters;
  onStudyFiltersChange?: (filters: GeneStudyFilters) => void;
  headerRight?: ReactNode;
  onHome: () => void;
  onSearchPathway: (pathway: string) => void;
}

/** Query only the pathway-capable studies identified by the current selection. */
async function querySelectedPathway(key: string, options: { onProgress: (loaded: number, total: number) => void }) {
  const [pathway, ids]: [string, string[]] = JSON.parse(key);
  const datasets = listDatasets().filter((dataset) => dataset.supportsPathways && ids.includes(dataset.id));
  if (datasets.length === 0) return { pathway, total: 0, loaded: 0, groups: [] };
  return queryPathwayAcrossDatasets(pathway, { ...options, datasets });
}

export function PathwayReport({
  pathway, categoryScope, datasetScope = null, onDatasetScopeChange, studyFilters, onStudyFiltersChange, headerRight, onHome, onSearchPathway,
}: PathwayReportProps) {
  const index = useSearchIndex(loadPathwayIndex);
  const localCategoryScope = useCategoryScope<DatasetCategory>(null);
  const categories = categoryScope ?? localCategoryScope;
  const { activeCats, toggleCat } = categories;
  const { cards, eligibleCards, availableDatasets, selectedDatasets, awaitingCounts,
    queryKey, filters, changeFilters, reset } = useStudySelection({
    kind: 'pathway', term: pathway || '', categories, datasetScope,
    studyFilters, onStudyFiltersChange, onDatasetScopeChange,
  });
  const { result, loading, progress, bytes, error } = useReportQuery(
    queryKey, querySelectedPathway, 'Could not load cross-dataset pathway data.',
  );

  const bound = useMemo(() => {
    if (!result) return 2;
    let max = 0;
    for (const g of result.groups) for (const t of g.tracks) max = Math.max(max, Math.abs(t.NES));
    return Math.max(1, Math.ceil(max));
  }, [result]);

  // Datasets first, then categorize, then categories — the same order the Gene
  // Explorer uses, so an emptied category disappears rather than rendering as a
  // headed, empty section.
  const datasetGroups = useMemo(
    () => result?.groups.filter((group) => selectedDatasets.some((dataset) => dataset.id === group.dataset.id)) ?? [],
    [result, selectedDatasets],
  );
  const categorized = useMemo(() => categorize(datasetGroups), [datasetGroups]);
  const visibleCategorized = useMemo(
    () => (activeCats ? categorized.filter((c) => activeCats.has(c.category)) : categorized),
    [categorized, activeCats],
  );
  const visibleGroups = useMemo(() => visibleCategorized.flatMap((c) => c.groups), [visibleCategorized]);

  const nominalMode = useListingMode() === 'nominal';

  // Counted over the VISIBLE groups, not over every group in the result. A
  // headline that tallies datasets the scope controls just hid is a claim about
  // a survey the reader is not looking at.
  const summary = useMemo(() => {
    if (!result) return null;
    let sigTracks = 0, up = 0, down = 0, nTracks = 0, nominalTracks = 0;
    for (const g of visibleGroups) for (const t of g.tracks) {
      nTracks++;
      if (t.significant) { sigTracks++; if (t.direction === 'up') up++; else if (t.direction === 'down') down++; }
      else if (tierOf(t) === 'nominal') nominalTracks++;
    }
    return { sigTracks, up, down, nTracks, nominalTracks };
  }, [result, visibleGroups]);

  const scopeControls = (
    <>
      <StudySuggestions cards={cards} eligibleCards={eligibleCards} categories={activeCats} filters={filters}
        hasIndividualSelection={datasetScope !== null} onCategory={toggleCat} onFilters={changeFilters}
        onReset={reset} />
      <DatasetScopePanel datasets={availableDatasets} selected={datasetScope}
        onChange={onDatasetScopeChange ?? NOOP_SCOPE} allowEmpty />
      <ScopeSummary>
        <span role="status">{awaitingCounts ? 'Loading sample counts…' : `${selectedDatasets.length} of ${cards.length} pathway-capable datasets selected`}</span>
        {filters.minSamples > 0 && <span className="qsearch-filter-note">Sample counts apply to the default population and comparison; other populations may differ. Unknown counts are excluded.</span>}
        {filters.requiredChecks.length > 0 && <span className="qsearch-filter-note">Only datasets passing each selected quality check are included.</span>}
        {!awaitingCounts && selectedDatasets.length === 0 && <span className="qsearch-filter-note">No datasets match. Change the filters or choose All datasets.</span>}
      </ScopeSummary>
    </>
  );

  // ── Landing state: the search interface, nothing searched yet ─────────────
  if (!pathway) {
    return (
      <div className="report-main report-search-dialog">
        <SearchHero
          headline="Pathway Explorer"
          placeholder="Search a pathway, e.g. ADIPOGENESIS"
          ariaLabel="Search a pathway across all datasets"
          action="Search"
          index={index}
          substring
          onSubmit={(p) => onSearchPathway(p.toUpperCase())}
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
        { label: 'Pathway Explorer' },
        { label: pathway, current: true, maxWidth: 360 },
      ]}
      mainStyle={{ overflowY: 'auto' }}
    >
      <div className="report-main">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: FONT_MONO, fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text-primary)', lineHeight: 1.15, wordBreak: 'break-word' }}>{pathway}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>FGSEA enrichment across datasets with pathway results</div>
          </div>
          <div style={{ flex: '1 1 300px', maxWidth: 460 }}>
            <PathwaySearch index={index} onPick={onSearchPathway} />
          </div>
        </div>

        <details className="report-filters">
          <summary>Study filters <span>{selectedDatasets.length} datasets selected</span></summary>
          <div>{scopeControls}</div>
        </details>

        {loading || awaitingCounts ? (
          <ReportLoading label={awaitingCounts ? 'Loading sample counts…' : 'Loading pathway across selected datasets…'} progress={progress} bytes={bytes} unit="tracks" />
        ) : error ? (
          <EmptyState title="Could not load pathway data." hint={error} />
        ) : result && summary ? (
            summary.nTracks === 0 ? (
              <EmptyState
                title={selectedDatasets.length === 0
                  ? 'No datasets selected.'
                  : `No enrichment found for "${pathway}".`}
                hint={selectedDatasets.length === 0
                  ? 'Change the study selection above, or choose All datasets.'
                  : 'Check the MSigDB name in the search box. The pathway may also fall outside the gene-set size limits in every track.'}
              />
            ) : (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '6px 16px', marginBottom: 6 }}>
                  <div style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--text-primary)', maxWidth: '72ch' }}>
                    Enriched (FDR &lt; {DEFAULT_FDR_CUTOFF}) in <span style={{ fontWeight: 700 }}>{summary.sigTracks}</span> of {summary.nTracks} tracks
                    {summary.sigTracks > 0 ? (
                      <>. <span style={{ color: UP, fontWeight: 600 }}>{summary.up} up</span> · <span style={{ color: DOWN, fontWeight: 600 }}>{summary.down} down</span>.</>
                    ) : '.'}
                    {nominalMode && summary.nominalTracks > 0 && (
                      <span className="portal-cutoff"> {summary.nominalTracks} more {summary.nominalTracks === 1 ? 'track reaches' : 'tracks reach'} p &lt; {NOMINAL_P_CUTOFF} only.</span>
                    )}
                  </div>
                  <ListingModeToggle />
                </div>
                {nominalMode && summary.nominalTracks > 0 && (
                  <p className="portal-note" style={{ maxWidth: '72ch', margin: '0 0 8px' }}>
                    Tracks marked <i>p &lt; {NOMINAL_P_CUTOFF} only</i> do not pass FDR. They are not corrected for testing many
                    pathways and tracks, so some are expected by chance.
                  </p>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: FONT_MONO, marginBottom: 14 }}>
                  Hover or focus a score to preview enrichment · red = up in case, blue = down · <QTerm>FDR</QTerm> is the q-value, the adjusted p-value
                </div>

                {visibleCategorized.map(({ category, groups }) => (
                  <CategorySection key={category} category={category} groups={groups} bound={bound} pathway={pathway} forceOpen={visibleCategorized.length === 1} />
                ))}
                <details className="report-methods">
                  <summary>About enrichment scores</summary>
                  <p>NES is the fgsea normalized enrichment score. Within each track, genes are ranked by
                    signed quasi-likelihood F from edgeR or moderated t from limma. Enrichment is computed
                    against the MSigDB collections for each track. Each score belongs to its own study and comparison.</p>
                  <p>Previews use the available leading-edge genes to approximate the running enrichment score.
                    Open a study or population for the full pathway explorer. More information opens its study record in the data library.</p>
                </details>
                {visibleCategorized.length === 0 && (
                  <EmptyState title="No categories selected." hint="Change the study selection above, or choose All datasets." />
                )}
              </>
            )
        ) : null}
      </div>
    </PageShell>
  );
}
