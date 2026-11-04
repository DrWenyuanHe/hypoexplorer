// The control behind the bar charts' y-axis scale.
//
// Rendered above each grid of bar charts (gene explorer, compare, compare set,
// leading edge, cross-dataset); the pick itself lives in chartScaleStore, so all
// of them show the same state and one click re-scales every chart on screen.
//
// Three options, not two, because "log2 or not" has no single answer across this
// corpus: the macaque atlas is deposited in CPM and most bulk studies are already
// deposited in log2, so 'As deposited' is the only setting that means the same
// thing for both — and it is what the charts did before the toggle existed.
//
// The control is deliberately dataset-BLIND. It sits above grids that mix units,
// where no single answer to "can this be shown linear?" exists, so it always
// offers all three and each chart reports for itself when it had to fall back
// (see resolveChartScale's `unavailable`). A control that disabled options would
// have to pick one dataset's answer for all of them.

import type { CSSProperties } from 'react';
import type { ChartScale } from '../utils/chartScale';
import { setChartScale, useChartScale } from './chartScaleStore';

const OPTIONS: ReadonlyArray<{ value: ChartScale; label: string; title: string }> = [
  {
    value: 'native',
    label: 'As deposited',
    title: 'Use each study\'s deposited expression scale. Exports retain these values.',
  },
  {
    value: 'linear',
    label: 'Linear',
    title: 'Convert logged values to a linear scale when the pseudocount is known. '
      + 'For example, log2(FPKM + 1) becomes FPKM. Values with an unspecified offset remain unchanged.',
  },
  {
    value: 'log2',
    label: 'log₂',
    title: 'Convert linear values to log2(x + 1). Values already deposited on a log2 scale remain unchanged.',
  },
];

export function ChartScaleToggle({ style }: { style?: CSSProperties }) {
  const scale = useChartScale();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...style }}>
      <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Scale</span>
      <fieldset
        style={{
          display: 'flex', border: '1px solid var(--border-dark)', borderRadius: 4,
          overflow: 'hidden', margin: 0, padding: 0, minInlineSize: 'auto',
        }}
      >
        {/* Visually hidden, so the group is named for a screen reader without
            the label taking space in a toolbar that already carries exports. */}
        <legend style={{
          position: 'absolute', width: 1, height: 1, overflow: 'hidden',
          clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
        }}>
          Bar chart scale
        </legend>
        {OPTIONS.map((option, i) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={scale === option.value}
            title={option.title}
            onClick={() => setChartScale(option.value)}
            style={{
              fontSize: 10.5, padding: '2px 8px', border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', lineHeight: 1.6,
              borderLeft: i > 0 ? '1px solid var(--border)' : undefined,
              background: scale === option.value ? 'var(--row-selected)' : 'var(--bg-panel)',
              fontWeight: scale === option.value ? 600 : 400,
              color: scale === option.value ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            {option.label}
          </button>
        ))}
      </fieldset>
    </div>
  );
}
