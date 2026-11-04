// The genes half of a side-by-side comparison: one bar chart per column for
// every selected gene, and the summary table underneath.
//
// Extracted from the Compare tab so the compare-set view — whose columns are
// studies rather than populations — draws the identical grid and table. The
// two differences it needed are props: a leading TALLY column, and columns
// that may be `unavailable` (still loading, failed, or naming a track the
// dataset lacks). Such a column renders its reason; it must never render "No
// detected expression", which is a claim about data nobody has read.

import { Fragment, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { pToStar, fmtP, fmtFDR } from '../utils/format';
import { BarSEMChart } from '../gene-explorer/BarSEMChart';
import { PopWarningBadge } from '../common/PopWarningBadge';
import { Spinner } from '../common/Spinner';
import { EmptyState } from '../common/EmptyState';
import { ChartScaleToggle } from '../common/ChartScaleToggle';
import { COLOR_WARNING_TEXT, DOWN_TEXT_COLOR, FONT_MONO, UP_TEXT_COLOR } from '../styles/constants';
import type { PopData } from '../types';
import type { CompareColumn } from './compareColumns';
import { resolveGeneCI } from './resolveGene';
import { tallyGene } from './compareSummary';

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
}

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
}: CompareGenesViewProps) {
  const [showAllCharts, setShowAllCharts] = useState(false);
  // A fresh selection gets the cap back: "show all" was an answer about the
  // list that asked, not a standing preference.
  const nGenes = selectedGenes.length;
  useEffect(() => { if (nGenes <= CHART_CAP) setShowAllCharts(false); }, [nGenes]);
  const chartGenes = showAllCharts ? selectedGenes : selectedGenes.slice(0, CHART_CAP);

  return (
    <>
      {/* Bar chart comparison grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
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
            <div key={gene} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 13, fontFamily: FONT_MONO }}>{gene}</span>
                <button type="button" onClick={() => onRemoveGene(gene)} aria-label={`Remove ${gene} row`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>× Remove</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
                {columns.map((col) => {
                  const pd = popDataMap[col.key];
                  const de = col.unavailable ? undefined : resolveGeneCI(pd, gene);
                  const qc = col.qc;
                  if (pd && de) {
                    return (
                      <div key={col.key} style={{ borderTop: `2px solid ${col.color}`, position: 'relative' }}>
                        {qc && qc.is3v3 === false && (
                          <div style={{ position: 'absolute', top: 2, right: 2, zIndex: 1 }}>
                            <PopWarningBadge is3v3={false} nNormal={qc.nNormal} nObese={qc.nObese} samplesKept={qc.samplesKept} compact />
                          </div>
                        )}
                        {/* The column's own spelling of the gene, so a mouse
                            column captions its bars Pomc while the row is
                            headed POMC. */}
                        <BarSEMChart gene={de.gene} popData={pd} contrast={pd.contrast} popLabel={col.chartLabel ?? col.label} />
                      </div>
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
        <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', padding: '4px 8px', background: 'var(--bg-panel)', maxHeight: 200, overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>Compare summary</span>
            {summaryActions}
          </div>
          <div style={{ overflowX: 'auto' }}>
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
          </div>
        </div>
      )}
    </>
  );
}
