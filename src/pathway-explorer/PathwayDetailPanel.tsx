import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { fmtP, fmtFDR, fmtSigned } from '../utils/format';
import { UP_TEXT_COLOR, DOWN_TEXT_COLOR, FONT_MONO, FONT_SANS } from '../styles/constants';
import { DbPill } from '../common/DbPill';
import { ExportButton } from '../common/ExportButton';
import { LeadingEdgeHeatmap } from './LeadingEdgeHeatmap';
import { RunningScorePlot } from './RunningScorePlot';
import { LeadingEdgeGenesView } from './LeadingEdgeGenesView';
import { PathwayComparisons } from './PathwayComparisons';
import { designCells } from '../data/contrasts';
import type { ContrastSlice } from '../gene-explorer/ContrastMatrix';
import type { PathwayRecordWithDb, PopData } from '../types';

interface PathwayDetailPanelProps {
  pathway: PathwayRecordWithDb;
  onClose: () => void;
  onExport?: () => void;
  /** True while the owner's `onExport` is still writing its workbook. Optional:
   *  a host that doesn't track it (the gene modal renders its own button) gets
   *  the previous always-idle behaviour. */
  exportBusy?: boolean;
  popData: PopData;
  contrastSlices?: ContrastSlice[];
  showGenes: boolean;
  setShowGenes: Dispatch<SetStateAction<boolean>>;
  onSendGenes?: (genes: string[]) => void;
}

export function PathwayDetailPanel({ pathway, onClose, onExport, exportBusy, popData, contrastSlices, showGenes, setShowGenes, onSendGenes }: PathwayDetailPanelProps) {
  const leadingEdge = pathway.leadingEdge ?? [];
  const designGroups = useMemo(() => designCells(contrastSlices?.map((slice) => slice.contrast)), [contrastSlices]);
  const [chartMode, setChartMode] = useState<'conditions' | 'contrast'>('conditions');
  const hasConditions = designGroups.length > 2;
  const conditionsMode = hasConditions && chartMode === 'conditions';
  const displayGroups = conditionsMode ? designGroups : popData.groups;

  return (
    <section style={{
      height: '100%', background: 'var(--bg-panel)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }} aria-label="Pathway detail">
      {/* Header */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <DbPill db={pathway.db} style={{ fontFamily: FONT_SANS }} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            {onExport && (
              <ExportButton onClick={onExport} busy={!!exportBusy} busyLabel="Exporting…" spinnerSize={11}
                title={hasConditions
                  ? 'Download pathway metadata, all-condition values, and statistics for each comparison as Excel'
                  : 'Download pathway metadata, leading-edge gene statistics, and per-sample values as Excel'}
                style={{
                  fontSize: 12, padding: '4px 12px', border: '1px solid var(--border)',
                  borderRadius: 3, background: 'var(--bg-app)', cursor: 'pointer',
                  fontFamily: FONT_SANS, fontWeight: 500,
                  color: 'var(--text-primary)',
                }}>
                ↓ Export {showGenes ? 'gene data' : 'pathway data'}
              </ExportButton>
            )}
            <button type="button" onClick={onClose} aria-label="Close pathway detail"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)', lineHeight: 1, padding: '0 4px' }}>×</button>
          </div>
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginTop: 4, wordBreak: 'break-word', lineHeight: 1.4 }}>
          {pathway.pathway}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          {popData.contrast?.label ?? 'Selected comparison'}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11, fontFamily: FONT_MONO }}>
          <span style={{ color: pathway.NES > 0 ? UP_TEXT_COLOR : DOWN_TEXT_COLOR, fontWeight: 600 }}>
            NES {fmtSigned(pathway.NES, 3)}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>FDR {fmtFDR(pathway.padj)}</span>
          <span style={{ color: 'var(--text-muted)' }}><i>p</i> {fmtP(pathway.pval)}</span>
          <span style={{ color: 'var(--text-muted)' }}>n={pathway.size}</span>
        </div>
      </div>

      {hasConditions && (
        <div style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <fieldset aria-label="Pathway condition view" style={{ display: 'flex', gap: 6, margin: '0 0 5px', padding: 0, border: 0 }}>
            {(['conditions', 'contrast'] as const).map((mode) => (
              <button key={mode} type="button" aria-pressed={chartMode === mode} onClick={() => setChartMode(mode)}
                style={{ padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer',
                  background: chartMode === mode ? '#4C78A8' : 'var(--bg-panel)', color: chartMode === mode ? '#fff' : 'var(--text-primary)' }}>
                {mode === 'conditions' ? `All ${designGroups.length} conditions` : 'Selected comparison'}
              </button>
            ))}
          </fieldset>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Leading-edge genes and gene logFC use {popData.contrast?.label ?? 'the selected comparison'}.
            {conditionsMode && ' Each enrichment result and significance bracket uses its own comparison.'}
          </div>
        </div>
      )}

      {/* Action row */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '6px 10px', display: 'flex', gap: 6, flexShrink: 0 }}>
        <button type="button" onClick={() => setShowGenes((g) => !g)}
          style={{ flex: 1, fontSize: 13, fontWeight: 500, padding: '8px 12px', border: '1px solid var(--border)',
            borderRadius: 4, background: showGenes ? '#4C78A8' : 'var(--bg-panel)',
            color: showGenes ? '#fff' : 'var(--text-primary)', cursor: 'pointer',
            textAlign: 'left' }}>
          {showGenes ? '← Heatmap & enrichment' : '⊞ Explore leading-edge genes'}
        </button>
        {onSendGenes && (
          <button type="button"
            onClick={() => onSendGenes(leadingEdge)}
            disabled={leadingEdge.length === 0}
            title={leadingEdge.length === 0
              ? 'No leading-edge genes for this pathway'
              : `Add all ${leadingEdge.length} leading-edge genes to the Gene Explorer`}
            style={{
              fontSize: 13, fontWeight: 600, padding: '8px 14px',
              border: '1px solid #F28E2B', borderRadius: 4,
              background: leadingEdge.length === 0 ? 'var(--bg-panel)' : '#FFF8F0',
              color: '#F28E2B',
              cursor: leadingEdge.length === 0 ? 'not-allowed' : 'pointer',
              opacity: leadingEdge.length === 0 ? 0.5 : 1,
              whiteSpace: 'nowrap', flexShrink: 0,
            }}>
            + Add {leadingEdge.length} → Gene Explorer
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        {showGenes ? (
          <LeadingEdgeGenesView pathway={pathway} popData={popData} groups={displayGroups}
            contrastSlices={conditionsMode ? contrastSlices : undefined} />
        ) : (
          <>
            {conditionsMode && contrastSlices && (
              <PathwayComparisons pathway={pathway} slices={contrastSlices} activeContrastId={popData.contrast?.id} />
            )}
            <LeadingEdgeHeatmap leadingEdge={pathway.leadingEdge} popData={popData} groups={displayGroups} />
            <RunningScorePlot pathway={pathway} popData={popData} />
          </>
        )}
      </div>
    </section>
  );
}
