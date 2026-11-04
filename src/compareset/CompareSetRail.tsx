import { ResponsiveSidebar } from '../common/ResponsiveSidebar';
// Left-side study navigation. Each row selects the volcano and discloses
// sample counts, evidence and explorer navigation on demand.

import { useBundleProgress } from '../data/useBundleProgress';
import { contrastArmCounts } from '../data/contrasts';
import { trackLabel } from '../data/datasetMeta';
import { fmtBytes } from '../utils/format';
import { isLowPower } from '../utils/qcFlags';
import { PopWarningBadge } from '../common/PopWarningBadge';
import { COLOR_WARNING_TEXT, FONT_MONO } from '../styles/constants';
import type { CompareColumn } from '../compare/compareColumns';
import { DatasetVerificationLink } from '../common/DatasetVerificationContext';
import type { CompareSetItem } from './compareSetStore';
import { isMultiTrack } from './compareSetColumns';
import type { CompareSetColumnState } from './useCompareSetColumns';

interface StudyRowProps {
  state: CompareSetColumnState;
  column: CompareColumn;
  selected: boolean;
  onSelect: (key: string) => void;
  onRemove: (item: CompareSetItem) => void;
  onOpenDataset: (datasetId: string, trackId?: string) => void;
}

function statusLine(state: CompareSetColumnState, progress: { loaded: number; total: number | null } | null): { text: string; warn: boolean } {
  switch (state.status) {
    case 'loading': {
      if (progress?.total) return { text: `loading · ${fmtBytes(progress.loaded)} / ${fmtBytes(progress.total)}`, warn: false };
      if (state.expectedBytes) return { text: `loading · ~${fmtBytes(state.expectedBytes)}`, warn: false };
      return { text: 'loading…', warn: false };
    }
    case 'failed':
      return { text: `failed: ${state.error ?? 'could not load'}`, warn: true };
    case 'unknown-track':
      return { text: 'track not in this dataset', warn: true };
    case 'ready':
      return { text: `ready · ${(state.popData?.geneNames.length ?? 0).toLocaleString()} genes`, warn: false };
  }
}

function StudyRow({ state, column, selected, onSelect, onRemove, onOpenDataset }: StudyRowProps) {
  const progress = useBundleProgress(state.status === 'loading' ? state.trackUrl : null);
  const ds = state.dataset;
  const { trackId } = state.item;
  const counts = contrastArmCounts(state.contrast, state.popData, state.meta, trackId);
  const lowPower = isLowPower(state.meta?.qcFlags?.[trackId]);
  const status = statusLine(state, progress);

  return (
    <fieldset
      style={{
        display: 'flex', flexDirection: 'column', gap: 4, margin: 0, minInlineSize: 0,
        padding: '8px 10px', border: 0,
        borderLeft: `3px solid ${selected ? 'var(--color-selected)' : 'transparent'}`,
        background: selected ? 'var(--row-selected)' : 'transparent',
      }}
    >
      <legend style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
        {column.label}
      </legend>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <span aria-hidden="true" style={{ width: 7, height: 7, marginTop: 5, borderRadius: '50%', background: column.color, flexShrink: 0 }} />
          <button type="button" onClick={() => onSelect(state.key)}
            aria-label={`Show volcano for ${column.label}`}
            aria-pressed={selected}
            title="Show this study's volcano"
            style={{
              flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0,
              cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
              color: 'var(--text-primary)', lineHeight: 1.3,
            }}>
            {ds?.name ?? state.item.datasetId}
          </button>
        <button type="button" onClick={() => onRemove(state.item)}
          aria-label={`Remove ${column.label} from compare set`}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1, color: 'var(--text-muted)', padding: '0 2px', flexShrink: 0 }}>
          ×
        </button>
      </div>
      {(isMultiTrack(state) || !ds) && (
        <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: 'var(--text-mono)' }}>
          {trackLabel(state.meta, trackId)}
        </div>
      )}
      {state.contrast && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{state.contrast.label}</div>}
      {state.status !== 'ready' && <div role="status" style={{ fontSize: 11, color: status.warn ? COLOR_WARNING_TEXT : 'var(--text-muted)' }}>
        {status.text}
      </div>}
      <details style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        <summary style={{ cursor: 'pointer', width: 'fit-content' }}>Details</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 7 }}>
      {state.contrast && (
        <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>
            {counts.nBaseline ?? '–'} {state.contrast.baseline.label}
            <span style={{ color: 'var(--text-muted)' }}> v </span>
            {counts.nCase ?? '–'} {state.contrast.caseGroup.label}
          </span>
          {lowPower && (
            <PopWarningBadge nNormal={counts.nBaseline ?? undefined} nObese={counts.nCase ?? undefined}
              samplesKept={state.popData?.qc?.samplesKept} compact />
          )}
        </div>
      )}
          {ds && <span style={{ fontStyle: 'italic' }}>{ds.organism}</span>}
          <DatasetVerificationLink datasetId={state.item.datasetId} />
          {state.status === 'ready' && <span>{status.text}</span>}
          {ds && <button type="button" onClick={() => onOpenDataset(ds.id, trackId)}
            style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, color: 'var(--accent)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}>
            Open in explorer
          </button>}
        </div>
      </details>
    </fieldset>
  );
}

interface CompareSetRailProps {
  states: readonly CompareSetColumnState[];
  columns: readonly CompareColumn[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onRemove: (item: CompareSetItem) => void;
  onOpenDataset: (datasetId: string, trackId?: string) => void;
}

export function CompareSetRail({ states, columns, selectedKey, onSelect, onRemove, onOpenDataset }: CompareSetRailProps) {
  return (
    <ResponsiveSidebar label="Studies in this compare set" summary={`${states.length} studies`}>
      {(close) => <>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>
        <span>Studies</span><span>{states.length}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '6px 0' }}>
      {states.map((state, i) => (
        <StudyRow key={state.key} state={state} column={columns[i]} selected={selectedKey === state.key} onSelect={(key) => { onSelect(key); close(); }} onRemove={onRemove} onOpenDataset={onOpenDataset} />
      ))}
      </div>
      </>}
    </ResponsiveSidebar>
  );
}
