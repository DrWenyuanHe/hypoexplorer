// The compare-set view: the single-cell Compare tab's idea — pick some
// columns, then read genes and pathways across them — with a column being a
// study (or one population of one) from anywhere in the corpus.
//
// The columns are the ROUTE's, not the staging store's: `#/compare-set/…`
// names them, so the page is a link that can be shared, and opening someone
// else's changes nothing in the reader's own set. Removing a column here
// updates that route; App also drops it from the store so the two agree.
//
// What this view must NOT do is combine its columns. Each column is its own
// study, its own contrast and its own expression unit; the tables line them
// up on a shared axis and the one row-level figure — the tally — is a count
// of per-study verdicts, labelled as such. See the Statistics page.

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { PageShell } from '../common/PageShell';
import { EmptyState } from '../common/EmptyState';
import { Spinner } from '../common/Spinner';
import { ExportButton } from '../common/ExportButton';
import { GenePicker } from '../common/GenePicker';
import { CompareGenesView } from '../compare/CompareGenesView';
import { ComparePathwayView } from '../compare/ComparePathwayView';
import { STUDY_NOUN } from '../compare/compareColumns';
import { compareSummaryRows, tallyGene } from '../compare/compareSummary';
import { useGeneSelection, useVolcanoView } from '../explorer/explorerSession';
import { geneVocabulary, useBoundGeneSelection } from '../explorer/geneVocabulary';
import { nomenclatureAuthorityForStoredDatasetSymbols } from '../data/nomenclature';
import { useBundleBytes } from '../data/useBundleProgress';
import { contrastArmCounts } from '../data/contrasts';
import { contrastLabel } from '../crossdataset/forestReport';
import { useExportAction } from '../utils/exportAction';
import { columnsSubject, exportName, exportProvenance, metadataSheet } from '../utils/exportProvenance';
import { writeWorkbook, type WorkbookRow } from '../utils/workbook';
import { fmtBytes } from '../utils/format';
import { COLOR_WARNING_TEXT, DOWN_TEXT_COLOR, UP_TEXT_COLOR } from '../styles/constants';
import type { PopData } from '../types';
import type { CompareSetItem } from './compareSetStore';
import { useCompareSetColumns } from './useCompareSetColumns';
import { columnLabel, columnsForStates, pathwayAbsenceReason, pathwayEligible, sameStudyGroups } from './compareSetColumns';
import { CompareSetRail } from './CompareSetRail';
import { CompareSetVolcanoPanel } from './CompareSetVolcanoPanel';

export interface CompareSetViewProps {
  items: readonly CompareSetItem[];
  /** A column removed. App keeps the route and the store in step. */
  onItemsChange: (items: readonly CompareSetItem[]) => void;
  onHome: () => void;
  onOpenDataset: (datasetId: string, trackId?: string) => void;
  onOpenLibrary: () => void;
  /** The header's compare-set indicator, mounted by App so this view stays store-free. */
  headerRight?: ReactNode;
}

const strip = {
  flexShrink: 0, padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)',
} as const;

export function CompareSetView({ items, onItemsChange, onHome, onOpenDataset, onOpenLibrary, headerRight }: CompareSetViewProps) {
  const { states, loadingCount, settled } = useCompareSetColumns(items);
  const columns = useMemo(() => columnsForStates(states), [states]);
  const popDataMap = useMemo(() => {
    const map: Record<string, PopData | null> = {};
    for (const s of states) map[s.key] = s.popData;
    return map;
  }, [states]);
  const bytes = useBundleBytes(loadingCount > 0);

  const [mode, setMode] = useState<'genes' | 'pathways'>('genes');
  const geneSelection = useGeneSelection();
  // One volcano configuration for every study in the set: a cutoff chosen on
  // one study's volcano is the cutoff on the next — the explorer's own rule
  // that thresholds survive navigation, applied across columns.
  const volcano = useVolcanoView();
  const { busy: exporting, run: runExport } = useExportAction();

  // Whose volcano sits above the tables: the study picked in the sidebar, else
  // the first column. A pick that has since been removed falls back the same
  // way, so there is always a volcano while there is a column.
  const [volcanoKey, setVolcanoKey] = useState<string | null>(null);
  const volcanoIndex = (() => {
    const picked = volcanoKey ? states.findIndex((s) => s.key === volcanoKey) : -1;
    return picked >= 0 ? picked : (states.length ? 0 : -1);
  })();
  const selectedKey = volcanoIndex >= 0 ? states[volcanoIndex].key : null;

  // The selection is bound to the union of every ready column's genes, CASE-
  // FOLDED: a set can span species that spell one gene POMC and Pomc, so the
  // selected key is the upper-cased symbol (picking `pomc` selects POMC, and
  // each column resolves its own POMC or Pomc — see resolveGeneCI). Each column
  // brings its OWN dataset's authority. The set used to pass no authority at
  // all, because one namespace cannot speak for columns of several species: an
  // HGNC redirect or "now X" note on a mouse column would be wrong. Per column,
  // each chip's note is read in the namespace of the study that stores the
  // spelling; search and list redirects use the shared authority when every
  // column agrees, and are unscoped (failing closed on an alias they cannot
  // attribute) when the set mixes species.
  const vocabulary = useMemo(() => geneVocabulary(
    states.flatMap((s) => (s.popData ? [{
      geneNames: s.popData.geneNames,
      authority: s.dataset ? nomenclatureAuthorityForStoredDatasetSymbols(s.dataset) : null,
    }] : [])),
    { caseFolded: true },
  ), [states]);
  const selection = useBoundGeneSelection(geneSelection, vocabulary);
  const { genes: selectedGenes, remove: removeGene } = selection;

  const remove = useCallback((item: CompareSetItem) => {
    onItemsChange(items.filter((it) => it.datasetId !== item.datasetId || it.trackId !== item.trackId));
  }, [items, onItemsChange]);

  const nDatasets = new Set(items.map((it) => it.datasetId)).size;
  const crumb = nDatasets === items.length
    ? `${items.length} ${items.length === 1 ? 'study' : 'studies'}`
    : `${nDatasets} ${nDatasets === 1 ? 'study' : 'studies'} · ${items.length} columns`;

  const sameStudy = useMemo(() => sameStudyGroups(states), [states]);
  const allFailed = states.length > 0 && states.every((s) => s.status === 'failed' || s.status === 'unknown-track');

  // The pathway matrix takes only columns that can honestly be in it; the
  // rest are named above it rather than shown as "–" down every row.
  const pathwayColumns = useMemo(() => columns.filter((_, i) => pathwayEligible(states[i])), [columns, states]);
  const pathwayAbsent = useMemo(
    () => states.map((s) => ({ label: columnLabel(s), reason: pathwayAbsenceReason(s) })).filter((x) => x.reason !== null),
    [states],
  );

  const readyColumns = useMemo(() => columns.filter((c) => !c.unavailable), [columns]);

  const exportExcel = () => runExport(() => {
    const summary = compareSummaryRows(readyColumns, popDataMap, selectedGenes).map((row, i) => {
      const { Gene, ...rest } = row;
      const tally = tallyGene(readyColumns, popDataMap, selectedGenes[i]);
      return { Gene, Detected: tally.detected, SigFDR05: tally.sig, Up: tally.up, Down: tally.down, ...rest } as WorkbookRow;
    });
    const legend: WorkbookRow[] = states.map((s) => {
      const counts = contrastArmCounts(s.contrast, s.popData, s.meta, s.item.trackId);
      return {
        Key: s.key,
        Dataset: s.dataset?.name ?? s.item.datasetId,
        Track: s.item.trackId,
        Organism: s.dataset?.organism ?? '',
        Contrast: contrastLabel(s.contrast),
        nBaseline: counts.nBaseline,
        nCase: counts.nCase,
        Unit: s.popData?.expressionUnit ?? '',
        Status: s.status,
      };
    });
    // The provenance covers the columns whose data is IN the summary; the
    // Columns sheet still lists every column, unavailable ones with their status.
    const subject = columnsSubject(readyColumns, popDataMap);
    return writeWorkbook(exportName(subject, ['compare_set'], 'xlsx'), [
      { name: 'Compare', rows: summary },
      { name: 'Columns', rows: legend },
      metadataSheet(exportProvenance('compare_set', subject, {
        geneCount: selectedGenes.length,
        geneSelection: 'Explicit genes in the exported row order.',
        columnsInSet: items.length,
        columnsWithData: readyColumns.length,
      })),
    ]);
  });

  const unitCaveat = (
    <>
      Bars show baseline and case group means ± SEM in each study&apos;s expression unit.
      Compare direction and effect size across studies. Absolute expression levels are not comparable.
      Each column shows the contrast named in its header. Results are not pooled.{' '}
      <span style={{ color: UP_TEXT_COLOR }}>Red = up in case</span> · <span style={{ color: DOWN_TEXT_COLOR }}>blue = down</span>.
    </>
  );

  return (
    <PageShell
      onHome={onHome}
      breadcrumbs={[{ label: 'Compare set' }, { label: crumb, current: true }]}
      fill
      mainClassName="compare-set-main"
      mainStyle={{ display: 'flex', minHeight: 0, overflow: 'hidden' }}
      headerRight={headerRight}
    >
      {items.length === 0 ? (
        <EmptyState
          style={{ flex: 1 }}
          title="Your compare set is empty."
          hint="Add studies from the dataset library or populations from the explorer to compare them here."
          action={
            <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" className="btn btn--primary" onClick={onOpenLibrary}>Browse the dataset library →</button>
              <button type="button" className="btn btn--ghost" onClick={onHome}>Back to home</button>
            </span>
          }
        />
      ) : (
        <>
        <CompareSetRail states={states} columns={columns} selectedKey={selectedKey} onSelect={setVolcanoKey} onRemove={remove} onOpenDataset={onOpenDataset} />
        <div className="compare-set-content" style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {(loadingCount > 0 || sameStudy.length > 0) && (
          <div style={{ ...strip, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {loadingCount > 0 && (
              <Spinner size={12} label={`Loading ${loadingCount} of ${states.length} ${states.length === 1 ? 'study' : 'studies'}${bytes > 0 ? ` · ${fmtBytes(bytes)} so far` : ''}`} />
            )}
            {sameStudy.map(({ dataset, count }) => (
              <div key={dataset.id} style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, maxWidth: '84ch' }}>
                {count} columns are populations from {dataset.name} and share the same animals.
                They are not independent replications.
              </div>
            ))}
          </div>
          )}

          {/* Genes / Pathways sub-tab toggle */}
          <div style={{ flexShrink: 0, display: 'flex', padding: '0 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)' }}>
            {([['genes', 'Genes'], ['pathways', 'Pathways']] as const).map(([id, label]) => (
              <button type="button" key={id} onClick={() => setMode(id)}
                className={mode === id ? 'tab-btn tab-btn--active' : 'tab-btn'}>{label}</button>
            ))}
          </div>

          {/* Gene search — genes mode only */}
          {mode === 'genes' && (
            <div style={strip}>
              <GenePicker selection={selection} scopeLabel="the studies in this compare set" filenameParts={['hypoexplorer_compare_set']} />
            </div>
          )}

          {/* Content */}
          <div className="compare-set-results" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {allFailed ? (
              <EmptyState
                style={{ flex: 1 }}
                title={`Could not load any of the ${states.length} ${states.length === 1 ? 'study' : 'studies'}.`}
                hint="Data is unavailable, so this report cannot show whether a gene is present in these studies. Check the column notes above, or try again later."
              />
            ) : mode === 'pathways' ? (
              <>
                {pathwayAbsent.length > 0 && (
                  <div role="status" style={{ ...strip, fontSize: 11, color: COLOR_WARNING_TEXT, lineHeight: 1.5 }}>
                    Not in this matrix: {pathwayAbsent.map((x) => `${x.label} (${x.reason})`).join(' · ')}
                  </div>
                )}
                {pathwayColumns.length === 0 ? (
                  <EmptyState
                    style={{ flex: 1 }}
                    title="No pathway results to compare yet."
                    hint={loadingCount > 0 || states.some((s) => s.status === 'ready' && !s.pathwaysSettled)
                      ? 'Enrichment tables are still loading.'
                      : 'None of the studies in this set has enrichment results.'}
                  />
                ) : (
                  <ComparePathwayView columns={pathwayColumns} popDataMap={popDataMap} columnNoun={STUDY_NOUN} />
                )}
              </>
            ) : (
              <>
                {/* The selected study, drawn in full above the grid: the way to
                    pick genes by looking rather than by name. */}
                {volcanoIndex >= 0 && (
                  <CompareSetVolcanoPanel
                    key={states[volcanoIndex].key}
                    state={states[volcanoIndex]}
                    column={columns[volcanoIndex]}
                    geneSelection={selection}
                    volcano={volcano}
                  />
                )}
              <CompareGenesView
                columns={columns}
                popDataMap={popDataMap}
                selectedGenes={selectedGenes}
                onRemoveGene={removeGene}
                showTally
                caveat={unitCaveat}
                emptyState={{
                  title: 'Search for a gene above to compare it across your studies.',
                  hint: 'Add genes to see bar charts and a comparison table for each study. Symbol matching ignores case, so POMC finds Pomc.',
                }}
                summaryActions={
                  <ExportButton onClick={exportExcel} busy={exporting} busyLabel="Exporting…" spinnerSize={10}
                    disabled={!settled}
                    title={!settled ? 'Waiting for all studies to finish loading…' : ''}
                    style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg-panel)', cursor: 'pointer' }}>
                    Export Excel
                  </ExportButton>
                }
              />
              </>
            )}
          </div>
        </div>
        </>
      )}
    </PageShell>
  );
}
