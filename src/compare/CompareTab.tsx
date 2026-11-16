import { useState, useMemo, useRef, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { writeWorkbook } from '../utils/workbook';
import { writeCsv } from '../utils/csv';
import { useExportAction } from '../utils/exportAction';
import { columnsSubject, exportName, exportProvenance } from '../utils/exportProvenance';
import { useChartScale } from '../common/chartScaleStore';
import { useTrackColumns, type TrackColumnPolicy } from '../data/trackColumns';
import { nomenclatureAuthorityForStoredDatasetSymbols } from '../data/nomenclature';
import { GenePicker } from '../common/GenePicker';
import { CellSelectorPopup } from '../common/CellSelectorPopup';
import { Spinner } from '../common/Spinner';
import { useCompactLayout } from '../common/useCompactLayout';
import { FONT_SANS } from '../styles/constants';
import { ComparePathwayView } from './ComparePathwayView';
import { CompareGenesView, GENE_BLOCK_ATTR, TILE_ATTR } from './CompareGenesView';
import { columnsForPops } from './compareColumns';
import { compareGenesCsv, compareGenesWorkbook, compareValuesCsv } from './compareSummary';
import { chartTileExport, saveChartBlocksPng, saveChartTilesZip, saveElementPng, type ChartTileFile } from './compareFigureExport';
import { resolveGeneCI } from './resolveGene';
import { DownloadIcon, DownloadMenu, type DownloadMenuItem } from './DownloadMenu';
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

// More failed populations than this fold into one alert with "Retry all": a
// dropped connection fails every bundle at once, and sixty alert rows were a
// wall of red between the toolbar and the charts.
const MAX_FAILED_ROWS = 3;

// Per-gene chart downloads listed in the Download menu itself; past this the
// menu would outgrow the screen, and each gene's row keeps its own button.
const MAX_GENE_MENU_ITEMS = 6;

// The same short-window threshold responsive.css uses for the explorer frame.
const SHORT_VIEWPORT_QUERY = '(max-height: 700px)';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

const smallBtn: CSSProperties = {
  fontSize: 11, padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 3,
  background: 'var(--bg-panel)', cursor: 'pointer',
};

const downloadTrigger: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontSize: 12, fontWeight: 600, padding: '5px 12px', fontFamily: FONT_SANS,
  border: '1px solid var(--border-dark)', borderRadius: 6,
  background: 'var(--bg-panel)', color: 'var(--text-primary)', cursor: 'pointer',
};

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
  const chartScale = useChartScale();
  const [compareMode, setCompareMode] = useState<'genes' | 'pathways'>('genes');
  const rootRef = useRef<HTMLDivElement>(null);

  // On a phone, or a laptop window under 700px tall, the fixed rows (cells,
  // gene search, toolbar, status) plus a fixed table footer left the charts a
  // strip a few pixels high. There the whole panel scrolls as one column
  // instead, and every part keeps its natural height.
  const compact = useCompactLayout();
  const shortViewport = useMediaQuery(SHORT_VIEWPORT_QUERY);
  const stacked = compact || shortViewport;

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

  // ── Downloads ─────────────────────────────────────────────────────────────
  // Block every download until every selected pop has loaded: exporting while
  // one is loading, or after one failed, would silently drop its columns.
  const allLoaded = selectedPops.length === activePops.length;
  const hasGenes = selectedGenes.length > 0;
  const blockedReason = !allLoaded
    ? `Downloads are available once every selected population has loaded (${activePops.length} of ${selectedPops.length} loaded).`
    : !hasGenes ? 'Add a gene above to download its data and charts.' : undefined;

  const exportExcel = () => runExport(() => {
    const { filename, sheets } = compareGenesWorkbook(columns, popDataMap, selectedGenes);
    return writeWorkbook(filename, sheets);
  });
  const exportCsv = () => runExport(() => {
    const csv = compareGenesCsv(columns, popDataMap, selectedGenes);
    writeCsv(csv.filename, csv.columns, csv.rows, { provenance: csv.provenance, rowProvenance: csv.rowProvenance });
  });
  const exportValuesCsv = () => runExport(() => {
    const csv = compareValuesCsv(columns, popDataMap, selectedGenes);
    writeCsv(csv.filename, csv.columns, csv.rows, { provenance: csv.provenance, rowProvenance: csv.rowProvenance });
  });
  // Every drawn chart tile as its own file, a folder per gene. A tile is only
  // drawn for a population that detected the gene, so the archive holds
  // exactly the charts on screen.
  const exportChartsZip = (format: 'png' | 'svg') => {
    const tiles: ChartTileFile[] = [];
    for (const block of geneBlocks()) {
      const gene = block.getAttribute(GENE_BLOCK_ATTR);
      if (!gene) continue;
      for (const el of block.querySelectorAll<HTMLElement>(`[${TILE_ATTR}]`)) {
        const col = columns.find((c) => c.key === el.getAttribute(TILE_ATTR));
        const pd = col ? popDataMap[col.key] : null;
        const de = resolveGeneCI(pd, gene);
        if (!col || !pd || !de) continue;
        const file = chartTileExport({ pd, gene: de.gene, label: col.chartLabel ?? col.label, pValue: de.PValue, chartScale });
        tiles.push({ el, folder: gene, ...file });
      }
    }
    const subject = columnsSubject(columns, popDataMap);
    if (tiles.length) {
      runExport(() => saveChartTilesZip(tiles, format,
        exportName(subject, ['bar_charts', format], 'zip'),
        exportProvenance('compare', subject, { figure: 'bar_charts', format, genes: selectedGenes.join(', '), chartScale })));
    }
  };
  // The gene blocks CompareGenesView rendered, found by their marker: the
  // figures are snapshots of what is on screen.
  const geneBlocks = () => [...(rootRef.current?.querySelectorAll<HTMLElement>(`[${GENE_BLOCK_ATTR}]`) ?? [])];
  const chartsName = (gene?: string) =>
    exportName(columnsSubject(columns, popDataMap), gene ? [gene, 'bar_charts'] : ['all_bar_charts'], 'png');
  const exportAllCharts = () => {
    const blocks = geneBlocks().map((el) => ({ el, filename: chartsName(el.getAttribute(GENE_BLOCK_ATTR) ?? undefined) }));
    if (blocks.length) runExport(() => saveChartBlocksPng(blocks, chartsName()));
  };
  const exportGeneCharts = (gene: string) => {
    const block = geneBlocks().find((el) => el.getAttribute(GENE_BLOCK_ATTR) === gene);
    if (block) runExport(() => saveElementPng(block, chartsName(gene)));
  };

  const blocked = blockedReason !== undefined;
  const nPops = selectedPops.length;
  const geneItems: DownloadMenuItem[] = selectedGenes.length > 1
    ? selectedGenes.slice(0, MAX_GENE_MENU_ITEMS).map((gene) => ({
      key: `gene:${gene}`,
      label: `${gene} charts (PNG)`,
      description: `Every population's ${gene} chart, in one image.`,
      onSelect: () => exportGeneCharts(gene),
      disabled: blocked,
    }))
    : [];
  const downloadSections = [
    {
      heading: 'Data',
      items: [
        {
          key: 'xlsx', label: 'Data workbook (Excel)', disabled: blocked, onSelect: exportExcel,
          description: `One row per gene × population (${nPops}): logFC, P, FDR, group n, mean and SEM. A Values sheet lists every animal's value for replotting.`,
        },
        {
          key: 'csv', label: 'Summary (CSV)', disabled: blocked, onSelect: exportCsv,
          description: 'The Excel summary sheet as one CSV, one row per gene × population.',
        },
        {
          key: 'values-csv', label: 'Per-animal values (CSV)', disabled: blocked, onSelect: exportValuesCsv,
          description: 'One row per animal: gene, population, group, sample and value, for replotting.',
        },
      ],
    },
    {
      heading: 'Figures',
      items: [
        {
          key: 'charts', label: 'All charts in one image (PNG)', disabled: blocked, onSelect: exportAllCharts,
          description: 'Every chart on screen in one image; one image per gene if the grid is too large.',
        },
        {
          key: 'zip-png', label: 'Individual charts (ZIP of PNG)', disabled: blocked, onSelect: () => exportChartsZip('png'),
          description: 'Each chart as its own PNG, in a folder per gene.',
        },
        {
          key: 'zip-svg', label: 'Individual charts (ZIP of SVG)', disabled: blocked, onSelect: () => exportChartsZip('svg'),
          description: 'Each chart as an editable vector, in a folder per gene.',
        },
        ...geneItems,
      ],
    },
  ];

  return (
    <div ref={rootRef} className="explorer-tab compare-tab" style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      overflow: stacked ? undefined : 'hidden', overflowY: stacked ? 'auto' : undefined,
    }}>
      {/* Population selector — own row so chips never push the gene search
          around. The selector keeps itself to one line until expanded. */}
      <div style={{ flexShrink: 0, padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', minWidth: 0 }}>
        <CellSelectorPopup meta={meta} selectedPops={selectedPops} onChange={setSelectedPops} defaultSelection={initialPops} />
      </div>
      {/* Gene search — own fixed row, genes mode only */}
      {compareMode === 'genes' && (
        <div style={{ flexShrink: 0, padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
          <GenePicker selection={selection} scopeLabel="the selected populations" filenameParts={['hypoexplorer_compare']} />
        </div>
      )}

      {/* Genes / Pathways sub-tab toggle, with the downloads at the right. The
          pathways view keeps its own exports beside the tables they write. */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)' }}>
        {([['genes', 'Genes'], ['pathways', 'Pathways']] as const).map(([id, label]) => (
          <button type="button" key={id} onClick={() => setCompareMode(id)}
            className={compareMode === id ? 'tab-btn tab-btn--active' : 'tab-btn'}>{label}</button>
        ))}
        {compareMode === 'genes' && (
          <div style={{ marginLeft: 'auto', padding: '4px 0' }}>
            <DownloadMenu menuLabel="Download comparison" sections={downloadSections}
              busy={exporting} busyLabel="Exporting…" notice={blockedReason}
              title={blockedReason ?? 'Download the summary data or the charts'}
              triggerStyle={downloadTrigger}>
              <DownloadIcon />Download <span aria-hidden="true" style={{ fontSize: 9, color: 'var(--text-muted)' }}>▼</span>
            </DownloadMenu>
          </div>
        )}
      </div>

      {/* Loading indicator for populations still on their way: a count, not
          the ids — sixty ids on one line said nothing a count does not. */}
      {loadingPops.length > 0 && (
        <div title={loadingPops.map((c) => c.trackId).join(', ')}
          style={{ flexShrink: 0, padding: '6px 12px', background: '#fffbe6', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
          <Spinner size={12} label={`Loading ${loadingPops.length} of ${selectedPops.length} population${selectedPops.length === 1 ? '' : 's'}…`} />
        </div>
      )}
      {/* A population that could not be read is said so, with a retry, while
          the populations that did load stay on screen below. */}
      {failedPops.length > MAX_FAILED_ROWS ? (
        <div role="alert" style={{ flexShrink: 0, padding: '6px 12px', background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Could not load {failedPops.length} of {selectedPops.length} populations. The other populations are shown.</span>
            <button type="button" onClick={() => { for (const c of failedPops) c.retry(); }} style={smallBtn}>Retry all</button>
          </div>
          <details style={{ marginTop: 4 }}>
            <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--text-muted)' }}>Show which</summary>
            <ul style={{ margin: '4px 0 0', padding: 0, listStyle: 'none', maxHeight: 160, overflowY: 'auto' }}>
              {failedPops.map((c) => (
                <li key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                  <span>{meta?.labels?.[c.trackId] ? `${c.trackId} (${meta.labels[c.trackId]})` : c.trackId}</span>
                  <button type="button" onClick={c.retry} aria-label={`Retry loading ${c.trackId}`} style={smallBtn}>Retry</button>
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : failedPops.map((c) => (
        <div key={c.key} role="alert" style={{ flexShrink: 0, padding: '6px 12px', background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span>Could not load {meta?.labels?.[c.trackId] ? `${c.trackId} (${meta.labels[c.trackId]})` : c.trackId}. The other populations are shown.</span>
          <button type="button" onClick={c.retry} aria-label={`Retry loading ${c.trackId}`} style={smallBtn}>Retry</button>
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
          chartDownloads
          layout={stacked ? 'flow' : 'fill'}
          emptyState={{
            title: 'Search for a gene above to compare expression across populations.',
            hint: 'Add one or more genes to see side-by-side bar charts and a summary table for every selected population.',
          }}
        />
      )}
    </div>
  );
}
