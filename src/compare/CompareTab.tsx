import { useState, useMemo } from 'react';
import { writeWorkbook } from '../utils/workbook';
import { useExportAction } from '../utils/exportAction';
import { useTrackColumns, type TrackColumnPolicy } from '../data/trackColumns';
import { nomenclatureAuthorityForStoredDatasetSymbols } from '../data/nomenclature';
import { GenePicker } from '../common/GenePicker';
import { CellSelectorPopup } from '../common/CellSelectorPopup';
import { Spinner } from '../common/Spinner';
import { ExportButton } from '../common/ExportButton';
import { ComparePathwayView } from './ComparePathwayView';
import { CompareGenesView } from './CompareGenesView';
import { columnsForPops } from './compareColumns';
import { compareGenesWorkbook } from './compareSummary';
import type { Dataset, DatasetMeta, PopData, ResolvedContrast } from '../types';
import { useGeneSelection } from '../explorer/explorerSession';
import { geneVocabulary, useBoundGeneSelection } from '../explorer/geneVocabulary';

const DEFAULT_POPS = ['e9', 'i23'];

interface CompareTabProps {
  /** The active dataset's metadata (labels, colors) — a value from App's state,
   *  not an ambient global. Null mid dataset-switch; ids degrade to themselves. */
  meta: DatasetMeta | null;
  /** The dataset these tracks belong to. Required: it decides the expression
   *  unit and whether pathways are flattened. */
  dataset: Dataset;
  /** The contrast the shell has selected. Required: this view used to build
   *  popData with neither, so it rendered the dataset's DEFAULT contrast while
   *  the shell showed another one. */
  contrast: ResolvedContrast | null;
  defaultPops?: string[];
}

// Each selected population is a track column. Pathways included (the Pathways
// sub-tab); the track list trusted, because every id here came from this
// dataset's own track list (the cell selector, or the shell's default pair).
const COMPARE_POLICY: TrackColumnPolicy = { pathways: 'include', trackList: 'trust' };

export function CompareTab({ meta, dataset, contrast, defaultPops }: CompareTabProps) {
  // Default compare selection comes from the active dataset (App passes
  // dataset.defaultCompareTracks or its first two tracks). Fall back to the
  // macaque curated pair only for direct/test renders with NO prop: an empty
  // list for another dataset must not become two tracks that dataset lacks.
  const initialPops = defaultPops ?? DEFAULT_POPS;
  const [selectedPops, setSelectedPops] = useState(initialPops);
  // The Compare tab's gene selection is its OWN — independent of the Gene
  // Explorer's. Two instances of the same concept is what makes useGeneSelection
  // a seam rather than a hoist.
  const geneSelection = useGeneSelection();
  const { busy: exporting, run: runExport } = useExportAction();
  const [compareMode, setCompareMode] = useState<'genes' | 'pathways'>('genes');

  // Only the pops the user actually wants to compare are fetched, each through
  // the track-column module — NOT the explorer store's quiet path, whose catch
  // swallowed a failed bundle and left this tab showing "Loading X…" forever.
  // A column knows loading from failed, and a failed one offers Retry below.
  // Columns read popData at the CURRENT contrast, so a contrast switch reloads
  // nothing; a hydrating pathway sibling re-reads on its own.
  const trackRequests = useMemo(
    () => selectedPops.map((trackId) => ({ dataset, trackId, contrast })),
    [selectedPops, dataset, contrast],
  );
  const trackColumns = useTrackColumns(trackRequests, COMPARE_POLICY);
  const loadingPops = trackColumns.filter((c) => c.status === 'loading');
  const failedPops = trackColumns.filter((c) => c.status === 'failed' || c.status === 'unknown-track');

  // Memoize activePops so downstream consumers can depend on a stable reference.
  const activePops = useMemo(
    () => trackColumns.filter((c) => c.status === 'ready').map((c) => c.trackId),
    [trackColumns],
  );
  const popDataMap = useMemo(() => {
    const map: Record<string, PopData | null> = {};
    for (const c of trackColumns) if (c.status === 'ready') map[c.trackId] = c.popData;
    return map;
  }, [trackColumns]);

  // The loaded populations as COLUMNS — the shape the genes and pathways views
  // draw from, shared with the compare-set view where a column is a study.
  const columns = useMemo(() => columnsForPops(meta, activePops, popDataMap), [meta, activePops, popDataMap]);

  // The selection is bound to the UNION of the loaded populations' genes,
  // each under the dataset's authority — one species, so a gene keeps its
  // stored spelling and its chip can say "now X". A gene one population lacks
  // still gets its "No detected expression" panel below.
  const vocabulary = useMemo(() => {
    const authority = nomenclatureAuthorityForStoredDatasetSymbols(dataset);
    return geneVocabulary(Object.values(popDataMap)
      .filter((pd): pd is PopData => pd !== null)
      .map((pd) => ({ geneNames: pd.geneNames, authority })));
  }, [popDataMap, dataset]);
  const selection = useBoundGeneSelection(geneSelection, vocabulary);
  const { genes: selectedGenes, remove: removeGene } = selection;

  const exportExcel = () => runExport(() => {
    const { filename, sheets } = compareGenesWorkbook(columns, popDataMap, selectedGenes);
    return writeWorkbook(filename, sheets);
  });

  return (
    <div className="explorer-tab" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Population selector — own row so chips never push the gene search around */}
      <div style={{ flexShrink: 0, padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <CellSelectorPopup meta={meta} selectedPops={selectedPops} onChange={setSelectedPops} defaultSelection={initialPops} />
      </div>
      {/* Gene search — own fixed row, genes mode only */}
      {compareMode === 'genes' && (
        <div style={{ flexShrink: 0, padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
          <GenePicker selection={selection} scopeLabel="the selected populations" filenameParts={['hypoexplorer_compare']} />
        </div>
      )}

      {/* Genes / Pathways sub-tab toggle */}
      <div style={{ flexShrink: 0, display: 'flex', padding: '0 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)' }}>
        {([['genes', 'Genes'], ['pathways', 'Pathways']] as const).map(([id, label]) => (
          <button type="button" key={id} onClick={() => setCompareMode(id)}
            className={compareMode === id ? 'tab-btn tab-btn--active' : 'tab-btn'}>{label}</button>
        ))}
      </div>

      {/* Loading indicator for populations still on their way */}
      {loadingPops.length > 0 && (
        <div style={{ padding: '6px 12px', background: '#fffbe6', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
          <Spinner size={12} label={`Loading ${loadingPops.map((c) => c.trackId).join(', ')}…`} />
        </div>
      )}
      {/* A population that could not be read is said so, with a retry, while
          the populations that did load stay on screen below. */}
      {failedPops.map((c) => (
        <div key={c.key} role="alert" style={{ padding: '6px 12px', background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span>Could not load {meta?.labels?.[c.trackId] ? `${c.trackId} (${meta.labels[c.trackId]})` : c.trackId}. The other populations are shown.</span>
          <button type="button" onClick={c.retry} aria-label={`Retry loading ${c.trackId}`}
            style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg-panel)', cursor: 'pointer' }}>Retry</button>
        </div>
      ))}

      {compareMode === 'pathways' ? (
        <ComparePathwayView columns={columns} popDataMap={popDataMap} />
      ) : (
        <CompareGenesView
          columns={columns}
          popDataMap={popDataMap}
          selectedGenes={selectedGenes}
          onRemoveGene={removeGene}
          emptyState={{
            title: 'Search for a gene above to compare expression across populations.',
            hint: 'Add one or more genes to see side-by-side bar charts and a summary table for every selected population.',
          }}
          summaryActions={
            // Block export until every selected pop has loaded: exporting while one is
            // loading, or after one failed, would silently drop its columns.
            <ExportButton onClick={exportExcel} busy={exporting} busyLabel="Exporting…" spinnerSize={10}
              disabled={selectedPops.length !== activePops.length}
              title={selectedPops.length !== activePops.length ? 'Export is available once every selected population has loaded.' : ''}
              style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg-panel)', cursor: 'pointer' }}>
              Export Excel
            </ExportButton>
          }
        />
      )}
    </div>
  );
}
