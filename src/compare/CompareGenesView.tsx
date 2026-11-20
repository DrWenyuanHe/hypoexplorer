// The genes half of a side-by-side comparison: one bar chart per column for
// every selected gene, and the summary table underneath.
//
// Extracted from the Compare tab so the compare-set view — whose columns are
// studies rather than populations — draws the identical grid and table. The
// two differences it needed are props: a leading TALLY column, and columns
// that may be `unavailable` (still loading, failed, or naming a track the
// dataset lacks). Such a column renders its reason; it must never render "No
// detected expression", which is a claim about data nobody has read.

import { Fragment, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { pToStar, fmtP, fmtFDR } from '../utils/format';
import { BarSEMChart } from '../gene-explorer/BarSEMChart';
import { PopWarningBadge } from '../common/PopWarningBadge';
import { Spinner } from '../common/Spinner';
import { EmptyState } from '../common/EmptyState';
import { ChartScaleToggle } from '../common/ChartScaleToggle';
import { ExportButton } from '../common/ExportButton';
import { useChartScale } from '../common/chartScaleStore';
import { useExportAction } from '../utils/exportAction';
import { withExportEvidence } from '../utils/lazyExport';
import { columnsSubject, exportName } from '../utils/exportProvenance';
import { COLOR_WARNING_TEXT, DOWN_TEXT_COLOR, FONT_MONO, FONT_SANS, UP_TEXT_COLOR } from '../styles/constants';
import type { PopData } from '../types';
import type { CompareColumn } from './compareColumns';
import { resolveGeneCI } from './resolveGene';
import { tallyGene } from './compareSummary';
import { EXPORT_IGNORE_ATTR, chartTileExport, saveChartPng, saveChartSvg, saveElementPng } from './compareFigureExport';
import { DownloadIcon, DownloadMenu } from './DownloadMenu';

interface CompareGenesViewProps {
  columns: readonly CompareColumn[];
  /** Keyed by `column.key`. */
  popDataMap: Record<string, PopData | null>;
  selectedGenes: readonly string[];
  onRemoveGene: (gene: string) => void;
  /** Lead the summary table with a per-gene tally of significant columns. */
  showTally?: boolean;
  /** Right slot of the summary table's header — the export button. */
  summaryActions?: ReactNode;
  /** A muted note above the grid (the cross-study unit caveat). */
  caveat?: ReactNode;
  emptyState: { title: string; hint: string };
  /** Offer figure downloads: a menu on each chart tile (PNG / SVG) and a PNG
   *  of each gene's row. Off by default so a view opts in. */
  chartDownloads?: boolean;
  /**
   * 'fill' (default): the chart grid scrolls inside the space the parent gives
   * it and the summary table is a short footer under it. 'flow': both take
   * their natural height and the PARENT scrolls, for phones and short
   * windows, where a fixed footer and fixed toolbars left the charts a sliver.
   */
  layout?: 'fill' | 'flow';
  /**
   * 'wide' (default): one row per gene, four cells per column across — right
   * for a handful of studies, and where the compare-set tally leads each row.
   * 'long': one row per gene × column, read DOWN, so sixty populations are a
   * list you scroll rather than 240 cells you scroll sideways past.
   */
  summaryLayout?: 'wide' | 'long';
  /** Whether the summary table starts open (default) or as a bar to expand. */
  summaryStartsOpen?: boolean;
}

/** The attribute each gene's block of charts carries, for whole-grid export. */
export const GENE_BLOCK_ATTR = 'data-compare-gene';
/** The attribute each drawn chart tile carries (its column key), for per-chart export. */
export const TILE_ATTR = 'data-compare-tile';

const VISUALLY_HIDDEN: CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

const UNAVAILABLE_LABEL: Record<NonNullable<CompareColumn['unavailable']>['status'], string> = {
  loading: 'Loading…',
  failed: 'Could not load',
  'unknown-track': 'Track not in this dataset',
};

/** The cell text for a column that has no data to show, and why. */
function unavailableText(col: CompareColumn): string {
  const status = col.unavailable?.status ?? 'failed';
  return status === 'failed' ? 'failed' : status === 'loading' ? 'loading…' : 'no such track';
}

// The first cell of every row stays put while the rest scroll: twelve studies
// at four cells each is wider than any screen, and a gene name that scrolls
// away leaves a row of numbers nobody can attribute.
const STICKY_FIRST = {
  position: 'sticky' as const, left: 0, zIndex: 1,
  background: 'var(--bg-panel)', boxShadow: '1px 0 0 var(--border)',
};

// How many genes get a row of bar charts before the grid asks first. A
// volcano's "Add all N" can hand over a few hundred genes at once, and a
// chart per gene per column unbounded freezes the page — the same cap the
// pathway view puts on its gene profiles. The summary table below is not
// capped: a row of numbers is cheap, and it is the table that answers the
// question a list that long asks.
const CHART_CAP = 50;

export function CompareGenesView({
  columns, popDataMap, selectedGenes, onRemoveGene, showTally = false, summaryActions, caveat, emptyState,
  chartDownloads = false, layout = 'fill', summaryLayout = 'wide', summaryStartsOpen = true,
}: CompareGenesViewProps) {
  const long = summaryLayout === 'long';
  const [showAllCharts, setShowAllCharts] = useState(false);
  // The summary table folds away so the charts can have the room; the
  // numbers it holds are also in the Excel/CSV download. A view may start it
  // folded, as the Compare tab does: the charts are what it opens for.
  const [tableOpen, setTableOpen] = useState(summaryStartsOpen);
  const nRows = selectedGenes.length * columns.length;
  const flow = layout === 'flow';
  // A fresh selection gets the cap back: "show all" was an answer about the
  // list that asked, not a standing preference.
  const nGenes = selectedGenes.length;
  useEffect(() => { if (nGenes <= CHART_CAP) setShowAllCharts(false); }, [nGenes]);
  const chartGenes = showAllCharts ? selectedGenes : selectedGenes.slice(0, CHART_CAP);

  return (
    <>
      {/* Bar chart comparison grid */}
      <div style={flow ? { flexShrink: 0, padding: 8 } : { flex: 1, minHeight: 0, overflowY: 'auto', padding: 8 }}>
        {caveat && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 4px 10px', maxWidth: '78ch', lineHeight: 1.5 }}>
            {caveat}
          </div>
        )}
        {/* Above the grid rather than in the page header: the scale is a fact
            about these bars, and the columns here are often a MIX of units, so
            it wants to sit where the axis it changes is visible. */}
        {selectedGenes.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <ChartScaleToggle />
          </div>
        )}
        {selectedGenes.length === 0 ? (
          <EmptyState style={{ height: '100%' }} title={emptyState.title} hint={emptyState.hint} />
        ) : (
          chartGenes.map((gene) => (
            // The block is what a gene's PNG captures: its name and every tile,
            // minus the buttons marked EXPORT_IGNORE_ATTR.
            <div key={gene} {...{ [GENE_BLOCK_ATTR]: gene }} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 13, fontFamily: FONT_MONO }}>{gene}</span>
                <button type="button" onClick={() => onRemoveGene(gene)} aria-label={`Remove ${gene} row`}
                  {...{ [EXPORT_IGNORE_ATTR]: '' }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>× Remove</button>
                {chartDownloads && <GeneRowPngButton gene={gene} columns={columns} popDataMap={popDataMap} />}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
                {columns.map((col) => {
                  const pd = popDataMap[col.key];
                  const de = col.unavailable ? undefined : resolveGeneCI(pd, gene);
                  const qc = col.qc;
                  if (pd && de) {
                    return (
                      <ChartTile key={col.key} col={col} pd={pd} gene={de.gene} pValue={de.PValue} downloads={chartDownloads}>
                        {qc && qc.is3v3 === false && (
                          // Shifted left of the download button when there is one.
                          <div style={{ position: 'absolute', top: 2, right: chartDownloads ? 30 : 2, zIndex: 1 }}>
                            <PopWarningBadge is3v3={false} nNormal={qc.nNormal} nObese={qc.nObese} samplesKept={qc.samplesKept} compact />
                          </div>
                        )}
                        {/* The column's own spelling of the gene, so a mouse
                            column captions its bars Pomc while the row is
                            headed POMC. */}
                        <BarSEMChart gene={de.gene} popData={pd} contrast={pd.contrast} popLabel={col.chartLabel ?? col.label} />
                      </ChartTile>
                    );
                  }
                  const status = col.unavailable?.status;
                  return (
                    <div key={col.key} style={{
                      borderTop: `2px solid ${col.color}`,
                      height: 180,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: '#f9f9f9',
                      borderRadius: 4,
                      gap: 6,
                      padding: '0 12px',
                      textAlign: 'center',
                    }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: col.color }}>
                        {col.chartLabel ?? col.label}
                      </span>
                      {status === 'loading' ? (
                        <Spinner size={12} label={UNAVAILABLE_LABEL.loading} />
                      ) : status ? (
                        <span style={{ fontSize: 12, color: status === 'failed' ? COLOR_WARNING_TEXT : 'var(--text-muted)' }}>
                          {UNAVAILABLE_LABEL[status]}
                          {status === 'failed' && col.unavailable?.message ? `: ${col.unavailable.message}` : ''}
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: '#999', fontStyle: 'italic' }}>
                          No detected expression
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
        {!showAllCharts && selectedGenes.length > CHART_CAP && (
          <button type="button" onClick={() => setShowAllCharts(true)}
            style={{ fontSize: 11, padding: '4px 12px', border: '1px solid var(--border)',
              borderRadius: 4, background: 'var(--bg-panel)', cursor: 'pointer', margin: '4px 0 10px' }}>
            Show charts for all {selectedGenes.length} genes (first {CHART_CAP} shown; the table below lists every gene)
          </button>
        )}
      </div>

      {/* Summary table */}
      {selectedGenes.length > 0 && (
        <div style={flow ? {
          flexShrink: 0, borderTop: '1px solid var(--border)', padding: '4px 8px 8px', background: 'var(--bg-panel)',
        } : {
          // Capped by the viewport too: 200px of a 500px-tall panel was 40% of it.
          flexShrink: 0, borderTop: '1px solid var(--border)', padding: '4px 8px', background: 'var(--bg-panel)',
          // A long table is many short rows; opened on request, it may take
          // half the panel, scrolling under its own sticky header.
          maxHeight: tableOpen ? (long ? 'min(420px, 50vh)' : 'min(200px, 30vh)') : undefined, overflowY: 'auto',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: tableOpen ? 4 : 0 }}>
            <button type="button" onClick={() => setTableOpen((v) => !v)} aria-expanded={tableOpen}
              title={tableOpen ? 'Hide the summary table to give the charts more room' : 'Show the summary table'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 0',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary)', fontFamily: FONT_SANS,
              }}>
              <span aria-hidden="true" style={{ display: 'inline-block', width: 8, transform: tableOpen ? 'rotate(90deg)' : 'none' }}>▸</span>
              Compare summary
              <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                {long
                  ? ` · ${nRows} row${nRows === 1 ? '' : 's'} (${selectedGenes.length} gene${selectedGenes.length === 1 ? '' : 's'} × ${columns.length})`
                  : ` · ${selectedGenes.length} gene${selectedGenes.length === 1 ? '' : 's'}`}
                {tableOpen ? '' : ' — show'}
              </span>
            </button>
            {summaryActions}
          </div>
          {tableOpen && long && <LongSummaryTable columns={columns} popDataMap={popDataMap} genes={selectedGenes} />}
          {tableOpen && !long && <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 'max-content', borderCollapse: 'separate', borderSpacing: 0, fontSize: 11, fontFamily: FONT_MONO }}>
              <thead>
                <tr>
                  <th style={{ ...STICKY_FIRST, padding: '3px 6px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Gene</th>
                  {showTally && (
                    <th
                      title="A tally of per-study FDR < 0.05 calls. Each FDR was computed within its own study; this is a count, not a combined test."
                      style={{ padding: '3px 6px', textAlign: 'center', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}
                    >
                      Sig (tally)
                    </th>
                  )}
                  {columns.map((col) => (
                    <th key={col.key} colSpan={4} title={col.label}
                      style={{ padding: '3px 6px', textAlign: 'center', borderBottom: `2px solid ${col.color}`, whiteSpace: 'nowrap' }}>
                      {col.label}
                    </th>
                  ))}
                </tr>
                <tr style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  <th style={{ ...STICKY_FIRST, borderBottom: '1px solid var(--border)' }} />
                  {showTally && <th style={{ borderBottom: '1px solid var(--border)' }} />}
                  {columns.map((col) => (
                    <Fragment key={col.key}>
                      <th style={{ padding: '2px 4px', borderBottom: '1px solid var(--border)' }}>logFC</th>
                      <th style={{ padding: '2px 4px', borderBottom: '1px solid var(--border)' }}>P</th>
                      <th style={{ padding: '2px 4px', borderBottom: '1px solid var(--border)' }}>FDR</th>
                      <th style={{ padding: '2px 4px', borderBottom: '1px solid var(--border)' }}>Stars</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selectedGenes.map((gene) => {
                  const tally = showTally ? tallyGene(columns, popDataMap, gene) : null;
                  return (
                    <tr key={gene}>
                      <td style={{ ...STICKY_FIRST, padding: '3px 6px', fontWeight: 500, borderBottom: '1px solid var(--border)' }}>{gene}</td>
                      {tally && (
                        <td style={{ padding: '3px 6px', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>
                          {tally.detected === 0 ? '–' : (
                            <>
                              {`sig ${tally.sig}/${tally.detected}`}
                              <span style={{ color: 'var(--text-muted)' }}> · </span>
                              <span style={{ color: UP_TEXT_COLOR }}>▲{tally.up}</span>
                              {' '}
                              <span style={{ color: DOWN_TEXT_COLOR }}>▼{tally.down}</span>
                            </>
                          )}
                        </td>
                      )}
                      {columns.map((col) => {
                        if (col.unavailable) {
                          return (
                            <td key={col.key} colSpan={4} style={{
                              padding: '3px 4px', textAlign: 'center', borderBottom: '1px solid var(--border)',
                              color: col.unavailable.status === 'failed' ? COLOR_WARNING_TEXT : 'var(--text-muted)',
                              fontStyle: 'italic',
                            }}>
                              {unavailableText(col)}
                            </td>
                          );
                        }
                        const de = resolveGeneCI(popDataMap[col.key], gene);
                        return (
                          <Fragment key={col.key}>
                            <td style={{ padding: '3px 4px', textAlign: 'right', borderBottom: '1px solid var(--border)', color: (de?.logFC ?? 0) > 0 ? 'var(--accent-up)' : 'var(--accent-down)' }}>
                              {de ? de.logFC.toFixed(3) : '–'}
                            </td>
                            <td style={{ padding: '3px 4px', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>{de ? fmtP(de.PValue) : '–'}</td>
                            <td style={{ padding: '3px 4px', textAlign: 'right', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>{de && de.FDR != null ? fmtFDR(de.FDR) : '–'}</td>
                            <td style={{ padding: '3px 4px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>{de ? pToStar(de.PValue) : '–'}</td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>}
        </div>
      )}
    </>
  );
}

// ── Long summary table ──────────────────────────────────────────────────────

const LONG_CELL: CSSProperties = { padding: '3px 6px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
// The header stays in view while the rows scroll under it. No horizontal
// scroller wraps this table (it is six columns), so `top: 0` sticks to the
// panel that scrolls vertically.
const LONG_HEAD: CSSProperties = {
  ...LONG_CELL, position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-panel)',
  fontSize: 10, color: 'var(--text-muted)', fontWeight: 600,
};

/**
 * The summary read down: a block per gene, a row per population. The gene is
 * named on its block's first row, and a heavier rule separates blocks, so a
 * long block stays attributable without repeating the name on every row.
 */
function LongSummaryTable({ columns, popDataMap, genes }: {
  columns: readonly CompareColumn[]; popDataMap: Record<string, PopData | null>; genes: readonly string[];
}) {
  return (
    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 11, fontFamily: FONT_MONO }}>
      <thead>
        <tr>
          <th style={{ ...LONG_HEAD, textAlign: 'left' }}>Gene</th>
          <th style={{ ...LONG_HEAD, textAlign: 'left' }}>Population</th>
          <th style={{ ...LONG_HEAD, textAlign: 'right' }}>logFC</th>
          <th style={{ ...LONG_HEAD, textAlign: 'right' }}>P</th>
          <th style={{ ...LONG_HEAD, textAlign: 'right' }}>FDR</th>
          <th style={{ ...LONG_HEAD, textAlign: 'center' }}>Stars</th>
        </tr>
      </thead>
      {genes.map((gene) => (
        <tbody key={gene} data-summary-gene={gene}>
          {columns.map((col, i) => {
            const first = i === 0;
            const rule: CSSProperties = first ? { borderTop: '2px solid var(--border-dark, var(--border))' } : {};
            const de = col.unavailable ? undefined : resolveGeneCI(popDataMap[col.key], gene);
            return (
              <tr key={col.key}>
                <td style={{ ...LONG_CELL, ...rule, fontWeight: 600 }}>{first ? gene : ''}</td>
                <td style={{ ...LONG_CELL, ...rule }} title={col.chartLabel ?? col.label}>
                  <span aria-hidden="true" style={{
                    display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: col.color, marginRight: 6,
                  }} />
                  <span style={{ fontWeight: 600 }}>{col.label}</span>
                  {col.chartLabel && col.chartLabel !== col.label && (
                    <span style={{ color: 'var(--text-muted)', fontFamily: FONT_SANS }}> {col.chartLabel.replace(col.label, '').trim()}</span>
                  )}
                </td>
                {col.unavailable ? (
                  <td colSpan={4} style={{
                    ...LONG_CELL, ...rule, textAlign: 'center', fontStyle: 'italic',
                    color: col.unavailable.status === 'failed' ? COLOR_WARNING_TEXT : 'var(--text-muted)',
                  }}>
                    {unavailableText(col)}
                  </td>
                ) : (
                  <>
                    <td style={{ ...LONG_CELL, ...rule, textAlign: 'right', color: de ? (de.logFC > 0 ? 'var(--accent-up)' : 'var(--accent-down)') : undefined }}>
                      {de ? de.logFC.toFixed(3) : '–'}
                    </td>
                    <td style={{ ...LONG_CELL, ...rule, textAlign: 'right' }}>{de ? fmtP(de.PValue) : '–'}</td>
                    <td style={{ ...LONG_CELL, ...rule, textAlign: 'right', color: 'var(--text-muted)' }}>{de && de.FDR != null ? fmtFDR(de.FDR) : '–'}</td>
                    <td style={{ ...LONG_CELL, ...rule, textAlign: 'center' }}>{de ? pToStar(de.PValue) : '–'}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      ))}
    </table>
  );
}

// ── Figure downloads ────────────────────────────────────────────────────────

const ICON_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 24, height: 24, padding: 0, cursor: 'pointer',
  background: 'var(--bg-panel)', color: 'var(--text-muted)',
  border: '1px solid var(--border)', borderRadius: 4,
};

/**
 * One chart tile, with (when enabled) its own download menu in the corner:
 * this population's chart for this gene as PNG, or as SVG for a figure.
 */
function ChartTile({ col, pd, gene, pValue, downloads, children }: {
  col: CompareColumn; pd: PopData; gene: string; pValue: number | null | undefined;
  downloads: boolean; children: ReactNode;
}) {
  const tileRef = useRef<HTMLDivElement>(null);
  const { busy, run } = useExportAction();
  const chartScale = useChartScale();
  const label = col.chartLabel ?? col.label;
  const file = chartTileExport({ pd, gene, label, pValue, chartScale });

  const savePng = () => {
    const el = tileRef.current;
    if (!el) return;
    run(async () => {
      // Drawn from the chart's own SVG, exactly as in the "individual charts" ZIP.
      const saved = await saveChartPng(el, file.filename('png'), file.caption);
      if (!saved) window.alert('This chart is still drawing. Try again in a moment.');
    });
  };
  const saveSvg = () => {
    const el = tileRef.current;
    if (!el) return;
    // The SVG's <metadata> records the QC ledger, which loads on the first export.
    run(() => withExportEvidence(() => {
      const saved = saveChartSvg(el, file.filename('svg'), file.caption, file.provenance());
      // The chart chunk loads lazily; a tile clicked before it lands has no
      // <svg> yet, and a silent no-op would read as a broken button.
      if (!saved) window.alert('This chart is still drawing. Try again in a moment.');
    }));
  };

  return (
    <div ref={tileRef} {...{ [TILE_ATTR]: col.key }} style={{ borderTop: `2px solid ${col.color}`, position: 'relative' }}>
      {downloads && (
        <div style={{ position: 'absolute', top: 4, right: 4, zIndex: 2 }}>
          <DownloadMenu menuLabel={`Download ${gene} chart for ${label}`} busy={busy} busyLabel="" align="right"
            title={`Download this chart (${gene}, ${label})`} triggerStyle={ICON_BTN}
            sections={[{
              heading: `${gene} · ${col.key}`,
              items: [
                { key: 'png', label: 'PNG image', description: 'This chart as shown, at 2× resolution.', onSelect: savePng },
                { key: 'svg', label: 'SVG (vector)', description: 'Editable vector for figures; fonts and colours embedded.', onSelect: saveSvg },
              ],
            }]}>
            <DownloadIcon size={13} />
            <span style={VISUALLY_HIDDEN}>Download {gene} chart for {label}</span>
          </DownloadMenu>
        </div>
      )}
      {children}
    </div>
  );
}

/** One gene's row of charts (every column) as a single PNG. */
function GeneRowPngButton({ gene, columns, popDataMap }: {
  gene: string; columns: readonly CompareColumn[]; popDataMap: Record<string, PopData | null>;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const { busy, run } = useExportAction();
  const save = () => {
    const block = ref.current?.closest<HTMLElement>(`[${GENE_BLOCK_ATTR}]`);
    if (!block) return;
    run(() => saveElementPng(block, exportName(columnsSubject(columns, popDataMap), [gene, 'bar_charts'], 'png')));
  };
  return (
    <span ref={ref} {...{ [EXPORT_IGNORE_ATTR]: '' }} style={{ marginLeft: 'auto' }}>
      <ExportButton onClick={save} busy={busy} busyLabel="Saving…" spinnerSize={10}
        title={`Save every ${gene} chart in this row as one PNG image`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '2px 8px',
          border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-panel)',
          color: 'var(--text-muted)', cursor: 'pointer', fontFamily: FONT_SANS,
        }}>
        <DownloadIcon size={11} />{gene} charts (PNG)
      </ExportButton>
    </span>
  );
}
