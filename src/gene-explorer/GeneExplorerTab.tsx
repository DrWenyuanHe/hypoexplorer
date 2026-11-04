import { useState, useMemo, useCallback, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { withHtml2Canvas } from '../utils/lazyExport';
import { pToStar, fmtP, fmtSigned } from '../utils/format';
import { rawValueRows, groupMeanColumns } from '../utils/excelExport';
import { writeWorkbook } from '../utils/workbook';
import { useExportAction, downloadFile } from '../utils/exportAction';
import { LP_TH, LP_TD, btnStyle, UP_TEXT_COLOR, DOWN_TEXT_COLOR, FONT_MONO, FONT_SANS } from '../styles/constants';
import { exportName, metadataSheet, trackSubject } from '../utils/exportProvenance';
import type { ExportKind } from '../utils/exportProvenance';
import { VolcanoPlot } from './VolcanoPlot';
import { BarSEMChart, type ChartComparison } from './BarSEMChart';
import { SummaryTable } from './SummaryTable';
import { ContrastMatrix, type ContrastSlice } from './ContrastMatrix';
import { exportGenesCSV, exportGenesExcel, geneExportProvenance } from './geneExport';
import { Modal } from '../common/Modal';
import { ExportButton } from '../common/ExportButton';
import { ChartScaleToggle } from '../common/ChartScaleToggle';
import { useChartScale } from '../common/chartScaleStore';
import { GenePicker, SelectionSearchBox } from '../common/GenePicker';
import { DbPill } from '../common/DbPill';
import { PathwayDetailPanel } from '../pathway-explorer/PathwayDetailPanel';
import { pathwayDetailSheets } from '../pathway-explorer/pathwayExport';
import { designCells } from '../data/contrasts';
import type { NomenclatureAuthority } from '../data/nomenclature';
import type { PathwayRecordWithDb, PopData } from '../types';
import type { GeneSelection, VolcanoView } from '../explorer/explorerSession';
import { geneVocabulary, useBoundGeneSelection, type BoundGeneSelection } from '../explorer/geneVocabulary';

/**
 * What a view pop-up shows when nothing is selected yet.
 *
 * This is the other half of putting the three view buttons on the toolbar
 * unconditionally: a button that opens an empty box teaches nothing, so the
 * empty box says what it needs and hands over the means to supply it. The search
 * box is the SAME component as the toolbar's, so anything the toolbar can find
 * (aliases, previous symbols, redirects) is findable from here too.
 */
function SelectGenesPrompt({
  view, selection,
}: {
  view: 'charts' | 'table' | 'contrasts';
  selection: BoundGeneSelection;
}) {
  const what = view === 'charts'
    ? 'group mean bar charts with SEM, one panel per gene'
    : view === 'table'
      ? 'a row per gene with logFC, p, FDR and group means'
      : 'a column for each comparison in the dataset';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 14, padding: '48px 24px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', fontFamily: FONT_SANS }}>
        Select a gene
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-muted)', fontFamily: FONT_SANS, maxWidth: '46ch' }}>
        This view shows {what}. Search for a gene below, or close this and click any
        point on the volcano plot.
      </div>
      <SelectionSearchBox selection={selection} autoFocus />
    </div>
  );
}

interface GeneExplorerTabProps {
  /** The gene list plus its operations. Owned by App so it survives a tab
   *  switch; the tab is handed the selection, not four raw setters. */
  geneSelection: GeneSelection;
  /** The volcano's metric + thresholds. Separate from the selection because the
   *  Compare tab holds a gene selection and has no volcano. */
  volcano: VolcanoView;
  popData: PopData;
  /** Namespace for this dataset's stored gene symbols. */
  nomenclatureAuthority?: NomenclatureAuthority | null;
  /**
   * One (contrast, popData) slice per contrast the dataset declares — the same
   * raw track transformed under each contrast. Present (length > 1) only for
   * multi-contrast datasets; it unlocks the "Across comparisons" pop-up that
   * reads a selected gene from every angle of a factorial design at once.
   */
  contrastSlices?: ContrastSlice[];
}

export function GeneExplorerTab({
  geneSelection,
  volcano,
  popData,
  contrastSlices,
  nomenclatureAuthority,
}: GeneExplorerTabProps) {
  // The selection bound to THIS track's vocabulary: one source, the dataset's
  // authority. Everything that enters it — typed, loaded, clicked on the
  // volcano — goes through the vocabulary's case policy, and its chips carry
  // the authority's notes.
  const vocabulary = useMemo(
    () => geneVocabulary([{ geneNames: popData.geneNames, authority: nomenclatureAuthority ?? null }]),
    [popData.geneNames, nomenclatureAuthority],
  );
  const selection = useBoundGeneSelection(geneSelection, vocabulary);
  const { genes: selectedGenes, add: addGene, addMany: addGenes, remove: removeGene } = selection;
  const chartScale = useChartScale();
  const exportSettings = useMemo(() => ({
    volcano: { metric: volcano.metric, logFCThresh: volcano.logFCThresh, sigThresh: volcano.sigThresh },
    chartScale,
  }), [volcano.metric, volcano.logFCThresh, volcano.sigThresh, chartScale]);

  // Prominent, filled toolbar buttons that open the two pop-up views.
  const viewBtn = (bg: string): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 7,
    padding: '8px 18px', fontSize: 14, fontWeight: 700, letterSpacing: 0.2,
    border: 'none', borderRadius: 6, cursor: 'pointer',
    background: bg, color: '#fff', fontFamily: FONT_SANS,
    boxShadow: '0 1px 4px rgba(0,0,0,0.22)',
  });

  // PNG snapshot is the one genuinely-async export (html2canvas can take a
  // second on a large grid), so surface a busy state while it runs. Through the
  // export-action seam like every other button: the hand-rolled `.finally()`
  // this replaces had neither a re-entrancy check (a second click started a
  // second html2canvas pass) nor an unmount guard (closing the pop-up mid-render
  // set state on a gone component).
  const { busy: exportingPNG, run: runPNGExport } = useExportAction();

  // Snapshot the bar-chart grid (rendered inside the charts pop-up) to PNG.
  const exportChartsPNG = useCallback(() => {
    const el = document.getElementById('bar-chart-grid');
    if (!el) return;
    // html2canvas is fetched on first use (see utils/lazyExport). The busy state
    // is already up, so the one-off chunk download is covered by the same
    // spinner that covers the render itself.
    runPNGExport(() => withHtml2Canvas(async (html2canvas) => {
      const canvas = await html2canvas(el, { backgroundColor: '#ffffff', scale: 2 });
      downloadFile(exportName(trackSubject(popData), ['bar_charts'], 'png'), canvas.toDataURL('image/png'));
    }));
  }, [popData, runPNGExport]);

  const hasGenes = selectedGenes.length > 0;

  // Which on-demand view is popped open: 'charts' (bar charts), 'table'
  // (summary table), 'contrasts' (across-comparisons matrix; multi-contrast
  // datasets only), or null. All hidden by default so the volcano stays the
  // focus; the toolbar buttons open them as modals.
  //
  // The three buttons are ALWAYS on the toolbar, including with nothing
  // selected. They used to appear only once a gene was picked, which hid the
  // app's three main views behind a step you could only discover by guessing:
  // the toolbar read as a bare search box, and nothing said that selecting a
  // gene would reveal anything. Opening one empty is now a legitimate way in —
  // each modal explains what it needs and puts a search box under it, so the
  // buttons advertise the views AND lead to them.
  const [viewModal, setViewModal] = useState<'charts' | 'table' | 'contrasts' | null>(null);
  // NOTE: deliberately no "close the modal when the selection empties" effect.
  // Clearing the last gene from inside a pop-up now lands on its empty state
  // (which can refill it) rather than throwing the view away underneath you.
  const hasContrastMatrix = (contrastSlices?.length ?? 0) > 1;

  // ── The design's conditions, and the charts pop-up's two modes ─────────────
  //
  // A factorial dataset has more conditions than any one comparison draws, and
  // the two-bar chart can only ever show the pair the active contrast names.
  // GSE135639 is the case in hand: four cells (maternal chow/HFD × P0/P21), four
  // declared contrasts, and no way to see a gene's level in all four at once —
  // "is the diet effect there at P0 too, or only after weaning?" was a question
  // you had to answer by switching contrasts and remembering the last picture.
  //
  // So the charts pop-up gains a mode. 'contrast' is the historical chart,
  // unchanged and still the default. 'conditions' puts every design cell on one
  // axis and brackets EACH declared contrast with its OWN p-value — which is the
  // reason this is not just "draw more bars": the active contrast's p says
  // nothing about the other three, and a single star over four bars would be a
  // lie about three of them.
  const designGroups = useMemo(
    () => designCells((contrastSlices ?? []).map((s) => s.contrast)),
    [contrastSlices],
  );
  const hasConditionsMode = designGroups.length > 2;
  const [chartMode, setChartMode] = useState<'contrast' | 'conditions'>('contrast');
  const conditionsMode = hasConditionsMode && chartMode === 'conditions';

  // One bracket per declared contrast, carrying that contrast's own star and a
  // tooltip with its stats. A gene the contrast's table does not carry gets the
  // bracket anyway, marked 'ns' and saying so — silently dropping it would read
  // as "this comparison does not exist".
  const comparisonsFor = useCallback((gene: string): ChartComparison[] =>
    (contrastSlices ?? []).map((s) => {
      const de = s.popData.deByGene[gene];
      return {
        from: s.contrast.baseline.key,
        to: s.contrast.caseGroup.key,
        star: pToStar(de?.PValue ?? 1),
        title: de
          ? `${s.contrast.label}: logFC ${fmtSigned(de.logFC, 3)} · P ${fmtP(de.PValue)}`
            + ` · FDR ${de.FDR == null ? 'n/a' : fmtP(de.FDR)}`
          : `${s.contrast.label}: not detected`,
      };
    }), [contrastSlices]);

  // What the pop-up's CSV/Excel cover — the same scope the chart draws, so a
  // download taken from under the four-condition view carries all four cells'
  // samples and every comparison's statistics, not the active contrast's pair.
  const exportScope = useMemo(() => ({
    ...(conditionsMode ? { groups: designGroups, slices: contrastSlices } : {}),
    settings: { ...exportSettings, chartMode: conditionsMode ? 'all-conditions' : 'active-contrast' },
  }), [conditionsMode, designGroups, contrastSlices, exportSettings]);

  // A pop-up's title. The gene count is dropped when there is none, because
  // "· 0 genes" reads as a failure state on a view that is working exactly as
  // intended — it is waiting for you.
  const modalTitle = useCallback((label: string) => (
    hasGenes
      ? `${label} · ${popData.meta?.code} · ${selectedGenes.length} gene${selectedGenes.length === 1 ? '' : 's'}`
      : `${label} · ${popData.meta?.code}`
  ), [hasGenes, popData.meta?.code, selectedGenes.length]);

  // Leading-edge pathway modal state
  const [modalGene, setModalGene] = useState<string | null>(null);
  const [modalPathway, setModalPathway] = useState<PathwayRecordWithDb | null>(null);
  const [modalShowGenes, setModalShowGenes] = useState(false);
  const { busy: exportingModal, run: runModalExport } = useExportAction();

  const closeModal = useCallback(() => {
    setModalGene(null);
    setModalPathway(null);
    setModalShowGenes(false);
  }, []);

  const modalPathways = useMemo<PathwayRecordWithDb[]>(() => {
    if (!modalGene || !popData?.allPathways) return [];
    return popData.allPathways
      .filter((p) => p.leadingEdge?.includes(modalGene))
      .sort((a, b) => (a.padj ?? 1) - (b.padj ?? 1));
  }, [modalGene, popData.allPathways]);

  // Close modal if the gene it's showing gets removed from the selection
  useEffect(() => {
    if (modalGene && !selectedGenes.includes(modalGene)) closeModal();
  }, [selectedGenes, modalGene, closeModal]);

  const exportModal = useCallback(() => {
    if (!modalGene || !popData?.meta) return;
    const meta = popData.meta;
    const contrasts = contrastSlices?.length ? contrastSlices.map((slice) => slice.contrast) : (popData.contrast ? [popData.contrast] : []);
    const metadata = (kind: ExportKind) => metadataSheet(geneExportProvenance(
      kind, popData, modalPathway?.leadingEdge.length ?? 1, popData.groups, contrasts, exportSettings,
    ));
    // The filename keeps naming the active contrast only, as it always has; the
    // Metadata sheet records every contrast slice the workbook covers.
    const subject = trackSubject(popData);

    if (modalPathway) {
      runModalExport(() => writeWorkbook(
        exportName(subject, [`${modalGene}_${modalPathway.pathway}`], 'xlsx'),
        [...pathwayDetailSheets(modalPathway, popData, contrastSlices, { queryGene: modalGene }), metadata('gene_pathway_detail')],
      ));
    } else {
      const pathwayRows = modalPathways.map((p) => ({
        Database: p.db,
        Pathway: p.pathway,
        NES: p.NES,
        FDR: p.padj,
        PValue: p.pval,
        Size: p.size,
        LeadingEdgeCount: (p.leadingEdge ?? []).length,
      }));
      const de = popData.deByGene[modalGene];
      const geneCtx = [{
        Gene: modalGene,
        Population: meta.code,
        logFC: de?.logFC ?? '',
        PValue: de?.PValue ?? '',
        FDR: de?.FDR ?? '',
        Stars: pToStar(de?.PValue ?? 1),
        ...groupMeanColumns(popData, modalGene),
        PathwayCount: modalPathways.length,
      }];
      runModalExport(() => writeWorkbook(exportName(subject, [`${modalGene}_leading_pathways`], 'xlsx'), [
        { name: 'Pathways', rows: pathwayRows },
        { name: 'GeneContext', rows: geneCtx },
        { name: 'GeneCPM', rows: rawValueRows(popData, [modalGene]) },
        metadata('gene_leading_pathways'),
      ]));
    }
  }, [modalGene, modalPathway, modalPathways, popData, contrastSlices, runModalExport, exportSettings]);

  return (
    <div className="explorer-tab" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* The shared picker: search, list tools, count, chips. The three view
          buttons are this tab's own, between the count and Clear all. */}
      <div style={{ flexShrink: 0, padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <GenePicker selection={selection} filenameParts={[popData.meta?.code]}>
          <button type="button" onClick={() => setViewModal('charts')}
            title="Open the per-gene bar charts in a pop-up"
            style={viewBtn('#4C78A8')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="6" y1="20" x2="6" y2="11" />
              <line x1="12" y1="20" x2="12" y2="5" />
              <line x1="18" y1="20" x2="18" y2="14" />
            </svg>
            Bar charts
          </button>
          <button type="button" onClick={() => setViewModal('table')}
            title="Open the summary table in a pop-up"
            style={viewBtn('#E07A1E')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
              <line x1="3" y1="9.5" x2="21" y2="9.5" />
              <line x1="9.5" y1="9.5" x2="9.5" y2="19.5" />
            </svg>
            Summary table
          </button>
          {/* Still gated — but on the DATASET, not on the selection. A
              single-contrast study has no second comparison to read a gene
              across, so this button would open a view that can only ever say
              so. That is a different question from "have you picked a gene
              yet", which is the one the other two buttons no longer ask. */}
          {hasContrastMatrix && (
            <button type="button" onClick={() => setViewModal('contrasts')}
              title="View the selected genes across all comparisons in this dataset"
              style={viewBtn('#59A14F')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
                <line x1="3" y1="9.5" x2="21" y2="9.5" />
                <line x1="9" y1="4.5" x2="9" y2="19.5" />
                <line x1="15" y1="4.5" x2="15" y2="19.5" />
              </svg>
              Across comparisons
            </button>
          )}
        </GenePicker>
      </div>

      {/* Main content — the volcano fills the view. The bar charts and summary
          table open on demand via the toolbar buttons (modals below). */}
      <div className="gene-plot-panel" style={{ flex: 1, minHeight: 0, padding: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <VolcanoPlot
          selectedGenes={selectedGenes}
          volcano={volcano}
          onAddGene={addGene}
          onAddGenes={addGenes}
          popData={popData}
        />
      </div>

      {/* Bar charts pop-up */}
      {viewModal === 'charts' && (
        <Modal
          title={modalTitle('Bar charts')}
          // The empty state is a paragraph and a search box; the default 80vh
          // would frame it in an acre of nothing. The chart grid still gets the
          // full pane the moment there is something to draw.
          {...(hasGenes ? {} : { height: 'auto' })}
          onClose={() => setViewModal(null)}
          headerRight={hasGenes ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {hasConditionsMode && (
                <fieldset aria-label="Chart mode" style={{
                  display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 3,
                  overflow: 'hidden', padding: 0, margin: '0 4px 0 0',
                }}>
                  {([
                    ['contrast', 'Active comparison', 'Two bars: the arms of the comparison the explorer is showing'],
                    ['conditions', `All ${designGroups.length} conditions`,
                      'One bar per design cell, with every declared comparison bracketed by its own p-value'],
                  ] as const).map(([mode, label, title]) => (
                    <button key={mode} type="button" onClick={() => setChartMode(mode)}
                      aria-pressed={chartMode === mode} title={title}
                      style={{
                        fontSize: 12, padding: '4px 10px', border: 'none', cursor: 'pointer',
                        fontFamily: FONT_SANS,
                        background: chartMode === mode ? 'var(--color-selected)' : 'var(--bg-app)',
                        color: chartMode === mode ? '#fff' : 'var(--text-muted)',
                        fontWeight: chartMode === mode ? 600 : 400,
                      }}>
                      {label}
                    </button>
                  ))}
                </fieldset>
              )}
              <ChartScaleToggle style={{ marginRight: 4 }} />
              <button type="button" onClick={() => exportGenesCSV(selectedGenes, popData, exportScope)} disabled={exportingPNG} style={btnStyle}>Export CSV</button>
              <button type="button" onClick={() => exportGenesExcel(selectedGenes, popData, exportScope)} disabled={exportingPNG} style={btnStyle}>Export Excel</button>
              <ExportButton onClick={exportChartsPNG} busy={exportingPNG} busyLabel="Exporting…" spinnerSize={11}
                style={btnStyle}>
                Export PNG
              </ExportButton>
            </div>
          ) : undefined}
        >
          {!hasGenes ? <SelectGenesPrompt view="charts" selection={selection} /> : (
          <div style={{ padding: 8 }}>
            {conditionsMode && (
              <div style={{
                fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-muted)', fontFamily: FONT_SANS,
                marginBottom: 8, maxWidth: '92ch',
              }}>
                All conditions share one axis. Each bracket marks a comparison, with stars based on
                its raw p-value. Hover over a bracket for that comparison's logFC, P and FDR.
              </div>
            )}
            {/* A four-condition tile needs the width its labels take; the
                two-bar tile keeps the denser grid it has always had. */}
            <div id="bar-chart-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${conditionsMode ? 340 : 260}px, 1fr))`, gap: 8 }}>
              {selectedGenes.map((gene) => (
                <BarSEMChart
                  key={gene}
                  gene={gene}
                  onRemove={() => removeGene(gene)}
                  popData={popData}
                  contrast={popData.contrast}
                  groups={conditionsMode ? designGroups : undefined}
                  comparisons={conditionsMode ? comparisonsFor(gene) : undefined}
                  onShowPathways={setModalGene}
                />
              ))}
            </div>
          </div>
          )}
        </Modal>
      )}

      {/* Across-comparisons matrix pop-up (multi-contrast datasets only) */}
      {viewModal === 'contrasts' && hasContrastMatrix && (
        <Modal
          title={modalTitle('Across comparisons')}
          width="min(1000px, 94vw)" height="auto"
          onClose={() => setViewModal(null)}
        >
          {!hasGenes ? <SelectGenesPrompt view="contrasts" selection={selection} /> : (
          <ContrastMatrix
            selectedGenes={selectedGenes}
            slices={contrastSlices ?? []}
            activeContrastId={popData.contrast?.id}
            onRemove={removeGene}
          />
          )}
        </Modal>
      )}

      {/* Summary table pop-up */}
      {viewModal === 'table' && (
        <Modal
          title={`Summary table · ${popData.meta?.code}`}
          width="70vw" height="auto"
          onClose={() => setViewModal(null)}
        >
          {!hasGenes
            ? <SelectGenesPrompt view="table" selection={selection} />
            : <SummaryTable selectedGenes={selectedGenes} onRemove={removeGene} popData={popData} exportSettings={exportSettings} scrollMaxHeight="65vh" />}
        </Modal>
      )}

      {/* Leading-edge pathway modal */}
      {modalGene && (
        <Modal
          // The visible title is markup (mono gene name, muted count) and swaps
          // to the pathway name in the detail view; the dialog's name stays put.
          ariaLabel={`Pathways where ${modalGene} is a leading gene`}
          title={<>
            {modalPathway && (
              <button type="button"
                onClick={() => { setModalPathway(null); setModalShowGenes(false); }}
                style={{
                  fontSize: 12, padding: '4px 10px', border: '1px solid var(--border)',
                  borderRadius: 3, background: 'var(--bg-app)', cursor: 'pointer',
                  fontFamily: FONT_SANS, fontWeight: 400, marginRight: 8,
                }}
              >← Back to pathway list</button>
            )}
            {modalPathway
              ? modalPathway.pathway
              : <>Pathways where <span style={{ fontFamily: FONT_MONO }}>{modalGene}</span> is a leading gene <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {modalPathways.length}</span></>}
          </>}
          headerRight={
            <ExportButton
              onClick={exportModal}
              busy={exportingModal} busyLabel="Exporting…" spinnerSize={11}
              disabled={!modalPathway && modalPathways.length === 0}
              title={modalPathway
                ? 'Download pathway metadata, leading-edge gene statistics, and per-sample values as Excel'
                : 'Download the pathway list with this gene\'s DE context and per-sample values as Excel'}
              style={{
                fontSize: 12, padding: '4px 12px', border: '1px solid var(--border)',
                borderRadius: 3, background: 'var(--bg-app)', cursor: 'pointer',
                fontFamily: FONT_SANS, fontWeight: 500,
                color: 'var(--text-primary)', flexShrink: 0,
                opacity: (!modalPathway && modalPathways.length === 0) ? 0.5 : 1,
              }}
            >↓ Export {modalPathway ? 'pathway data' : 'pathway list'}</ExportButton>
          }
          onClose={closeModal}
        >
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
            {modalPathway ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <PathwayDetailPanel
                  pathway={modalPathway}
                  onClose={() => { setModalPathway(null); setModalShowGenes(false); }}
                  popData={popData}
                  contrastSlices={contrastSlices}
                  showGenes={modalShowGenes}
                  setShowGenes={setModalShowGenes}
                  onSendGenes={addGenes}
                />
              </div>
            ) : modalPathways.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                {modalGene} is not a leading-edge gene in any pathway for this population.
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto' }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-panel)', position: 'sticky', top: 0, zIndex: 1, borderBottom: '1px solid var(--border-dark)' }}>
                      <th style={{ ...LP_TH, padding: '6px 10px' }}>DB</th>
                      <th style={{ ...LP_TH, padding: '6px 10px', textAlign: 'left' }}>Pathway</th>
                      <th style={{ ...LP_TH, padding: '6px 10px' }}>NES</th>
                      <th style={{ ...LP_TH, padding: '6px 10px' }}>FDR</th>
                      <th style={{ ...LP_TH, padding: '6px 10px' }}><i>p</i></th>
                      <th style={{ ...LP_TH, padding: '6px 10px' }}>Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalPathways.map((p) => (
                      <tr key={`${p.pathway}\x00${p.db}`}
                        className="hover-row"
                        onClick={() => setModalPathway(p)}
                        style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                      >
                        <td style={{ ...LP_TD, padding: '6px 10px' }}>
                          <DbPill db={p.db} padding="2px 6px" style={{ display: 'inline-block' }} />
                        </td>
                        <td style={{ ...LP_TD, padding: '6px 10px', textAlign: 'left' }}>{p.pathway}</td>
                        <td style={{ ...LP_TD, padding: '6px 10px', color: p.NES > 0 ? UP_TEXT_COLOR : DOWN_TEXT_COLOR, fontWeight: 600 }}>
                          {typeof p.NES === 'number' ? fmtSigned(p.NES, 3) : 'N/A'}
                        </td>
                        {/* The 'N/A' guards stay: fmtP renders a missing value as
                            '–', which is this table's neighbour convention, not
                            its own. Past the guard fmtP IS the inline rule. */}
                        <td style={{ ...LP_TD, padding: '6px 10px' }}>
                          {p.padj == null || Number.isNaN(p.padj) ? 'N/A' : fmtP(p.padj)}
                        </td>
                        <td style={{ ...LP_TD, padding: '6px 10px' }}>
                          {p.pval == null || Number.isNaN(p.pval) ? 'N/A' : fmtP(p.pval)}
                        </td>
                        <td style={{ ...LP_TD, padding: '6px 10px' }}>{typeof p.size === 'number' ? p.size : 'N/A'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
