// One study's volcano, above the side-by-side tables, over the SHARED gene
// selection: a point clicked here is a row across every study below.
//
// The volcano component is the explorer's own, with its threshold controls
// and its "Add all" for the threshold-passing set. The shared selection is
// bound to the set's case-folded vocabulary, so a point clicked here (Pomc)
// enters it as the set's key (POMC) with no adapter. What the volcano still
// needs is the reverse: the highlighted points on a mouse volcano must be its
// Pomc, so the keys are resolved to this study's spelling below, and only the
// genes this study carries are highlighted.

import { useMemo, useState } from 'react';
import { VolcanoPlot } from '../gene-explorer/VolcanoPlot';
import { Spinner } from '../common/Spinner';
import { resolveGeneCI } from '../compare/resolveGene';
import type { CompareColumn } from '../compare/compareColumns';
import type { VolcanoView } from '../explorer/explorerSession';
import type { BoundGeneSelection } from '../explorer/geneVocabulary';
import { COLOR_WARNING_TEXT, FONT_MONO } from '../styles/constants';
import type { CompareSetColumnState } from './useCompareSetColumns';

interface CompareSetVolcanoPanelProps {
  state: CompareSetColumnState;
  column: CompareColumn;
  /** The set's shared selection, bound to its case-folded vocabulary. */
  geneSelection: BoundGeneSelection;
  /** The set's shared metric + thresholds: a cutoff set on one study's volcano is the cutoff on the next. */
  volcano: VolcanoView;
}

const PLOT_HEIGHT = 380;

export function CompareSetVolcanoPanel({ state, column, geneSelection, volcano }: CompareSetVolcanoPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { popData } = state;

  // The shared selection, as this study spells it and only where it has it.
  const ownGenes = useMemo(
    () => geneSelection.genes
      .map((g) => resolveGeneCI(popData, g)?.gene)
      .filter((g): g is string => typeof g === 'string'),
    [geneSelection.genes, popData],
  );

  const title = `Volcano · ${column.label}`;

  return (
    <section aria-label={title} style={{ flexShrink: 0, borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Volcano
        </span>
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: column.color, flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{column.label}</span>
        {column.sublabel && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: FONT_MONO }}>{column.sublabel}</span>
        )}
        <button type="button" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed}
          style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 9px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-panel)', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-muted)' }}>
          {collapsed ? 'Show volcano' : 'Hide volcano'}
        </button>
      </div>
      {!collapsed && (
        <div className="compare-volcano-frame" style={{ height: PLOT_HEIGHT, padding: '0 8px 8px', display: 'flex', flexDirection: 'column' }}>
          {state.status === 'ready' && popData ? (
            <VolcanoPlot
              selectedGenes={ownGenes}
              volcano={volcano}
              onAddGene={geneSelection.add}
              onAddGenes={geneSelection.addMany}
              popData={popData}
            />
          ) : state.status === 'loading' ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spinner size={16} label={`Loading ${column.label}…`} />
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: COLOR_WARNING_TEXT, textAlign: 'center', padding: '0 24px' }}>
              {state.status === 'failed'
                ? `${column.label} could not be loaded${state.error ? `: ${state.error}` : ''}.`
                : `${column.label} names a track this dataset does not have.`}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
