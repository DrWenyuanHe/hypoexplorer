import { useState, useMemo, useCallback } from 'react';
import type { ChangeEvent, CSSProperties } from 'react';
import { Modal } from './Modal';
import { trackColor } from '../data/datasetMeta';
import { matchesCellQuery } from '../explorer/CellNavigator';
import { getCellSubname } from '../utils/format';
import { GROUP_ORDER, groupByType } from '../utils/popGroups';
import { FONT_MONO } from '../styles/constants';
import type { DatasetMeta } from '../types';

interface CellSelectorPopupProps {
  /** The active dataset's metadata (populations, labels, types, colors). */
  meta: DatasetMeta | null;
  selectedPops: string[];
  onChange: (pops: string[]) => void;
  minSelection?: number;
  defaultSelection?: string[];
}

export function CellSelectorPopup({
  meta,
  selectedPops,
  onChange,
  minSelection = 2,
  defaultSelection,
}: CellSelectorPopupProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const allPops = meta?.populations || [];
  const grouped = useMemo(() => groupByType(allPops, { types: meta?.types }), [allPops, meta]);
  const dflt = defaultSelection && defaultSelection.length >= minSelection
    ? defaultSelection
    : allPops.slice(0, Math.max(minSelection, 2));

  // Escape, the backdrop click, the focus trap and the body-scroll lock all
  // come from <Modal>; this component only owns the picker's own layout.

  const togglePop = useCallback((id: string) => {
    const isIn = selectedPops.includes(id);
    if (isIn && selectedPops.length <= minSelection) return;
    onChange(isIn ? selectedPops.filter((p) => p !== id) : [...selectedPops, id]);
  }, [selectedPops, onChange, minSelection]);

  const selectAll = () => onChange([...allPops]);
  const clearSelection = () => onChange([...dflt]);
  const selectGroup = (type: string) => { if (grouped[type]) onChange([...grouped[type]]); };

  const removeChip = useCallback((id: string) => {
    if (selectedPops.length <= minSelection) return;
    onChange(selectedPops.filter((p) => p !== id));
  }, [selectedPops, onChange, minSelection]);

  const filteredGroups = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const [type, ids] of Object.entries(grouped)) {
      const match = ids.filter((id) => matchesCellQuery(meta, id, search));
      if (match.length) out[type] = match;
    }
    return out;
  }, [grouped, meta, search]);

  const totalMatches = useMemo(
    () => Object.values(filteredGroups).reduce((n, ids) => n + ids.length, 0),
    [filteredGroups],
  );

  const lockRemove = selectedPops.length <= minSelection;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Select cells to compare"
        style={triggerStyle}>
        <span style={{ fontWeight: 500 }}>Cells</span>
        <span style={countPillStyle}>{selectedPops.length} selected</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>▼</span>
      </button>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {selectedPops.map((id) => (
          <span key={id} style={chipStyle}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: trackColor(meta, id) }} />
            <strong style={{ fontWeight: 600 }}>{id}</strong>
            <span style={{ color: 'var(--text-muted)' }}>{getCellSubname(id, meta?.labels)}</span>
            <button type="button" onClick={() => removeChip(id)} aria-label={`Remove ${id}`}
              disabled={lockRemove}
              style={{
                background: 'none', border: 'none', color: 'var(--text-muted)',
                fontSize: 14, lineHeight: 1, padding: '0 3px',
                cursor: lockRemove ? 'default' : 'pointer',
                opacity: lockRemove ? 0.35 : 1,
              }}>×</button>
          </span>
        ))}
      </div>

      {open && (
        // No `title`: the picker brings its own header (heading + × + search),
        // so Modal renders none and takes its accessible name from `ariaLabel`.
        // `height: auto` keeps the panel content-sized (Modal caps it at 90vh).
        <Modal onClose={() => setOpen(false)} ariaLabel="Select cells to compare"
          width="min(560px, 92vw)" height="auto">
          <div style={{ padding: '14px 18px 10px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Select cells to compare</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close"
                style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--text-muted)', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>×</button>
            </div>
            <input type="text"
              placeholder="Search by id, marker, or type (e.g. POMC, AGRP, Glutamatergic)…"
              value={search} onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
              style={{
                width: '100%', padding: '6px 10px', fontSize: 12,
                fontFamily: 'inherit', border: '1px solid var(--border-dark)',
                borderRadius: 6, outline: 'none',
              }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              <button type="button" onClick={selectAll} style={btnPrimary}>
                Select all <span style={countBadge}>{allPops.length}</span>
              </button>
              <button type="button" onClick={clearSelection} style={btnGhost}>Clear</button>
              {GROUP_ORDER.filter((g) => grouped[g]).map((g) => (
                <button key={g} type="button" onClick={() => selectGroup(g)} style={btnGhost}>
                  All {g} <span style={countBadge}>{grouped[g].length}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
            {totalMatches === 0 ? (
              <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                No cells match "{search}".
              </div>
            ) : (
              Object.entries(filteredGroups).map(([type, ids]) => {
                const totalInGroup = grouped[type]?.length ?? ids.length;
                const onInGroup = ids.filter((id) => selectedPops.includes(id)).length;
                return (
                  <div key={type}>
                    <div style={{
                      padding: '6px 18px 4px',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                      textTransform: 'uppercase', color: 'var(--text-muted)',
                    }}>
                      <span>{type}</span>
                      <span style={{ fontFamily: FONT_MONO, fontWeight: 500, letterSpacing: 0 }}>
                        {onInGroup} / {totalInGroup}
                      </span>
                    </div>
                    {ids.map((id) => {
                      const on = selectedPops.includes(id);
                      const lockUncheck = on && selectedPops.length <= minSelection;
                      return (
                        <label key={id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '5px 18px', cursor: lockUncheck ? 'default' : 'pointer',
                            fontSize: 12,
                            background: on ? '#FFF8F0' : 'transparent',
                          }}>
                          <input type="checkbox" checked={on} disabled={lockUncheck}
                            onChange={() => togglePop(id)}
                            aria-label={`Toggle ${id}`} />
                          <span style={{ width: 9, height: 9, borderRadius: '50%', background: trackColor(meta, id), flexShrink: 0 }} />
                          <span style={{
                            fontFamily: FONT_MONO, fontWeight: 600, minWidth: 36,
                            color: on ? 'var(--color-selected)' : 'inherit',
                          }}>{id}</span>
                          <span style={{
                            color: 'var(--text-muted)', flex: 1,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>{getCellSubname(id, meta?.labels)}</span>
                        </label>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>

          <div style={{
            padding: '10px 18px', borderTop: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: 11, color: 'var(--text-muted)',
          }}>
            <span>
              {selectedPops.length} of {allPops.length} selected
              <span style={{ marginLeft: 8 }}>· minimum {minSelection} required</span>
            </span>
            <button type="button" onClick={() => setOpen(false)}
              style={{
                padding: '5px 14px', fontSize: 12, fontWeight: 600,
                background: 'var(--color-selected)', color: '#fff',
                border: 'none', borderRadius: 6, cursor: 'pointer',
                fontFamily: 'inherit',
              }}>Done</button>
          </div>
        </Modal>
      )}
    </>
  );
}

const triggerStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '4px 10px', background: 'var(--bg-panel)',
  border: '1px solid var(--border-dark)', borderRadius: 6,
  cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
  color: 'var(--text-primary)',
};
const countPillStyle: CSSProperties = {
  fontFamily: FONT_MONO, fontSize: 11, fontWeight: 600,
  padding: '1px 6px', background: '#FEF1E2', color: 'var(--color-selected)',
  borderRadius: 3,
};
const chipStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '2px 4px 2px 7px', borderRadius: 10, background: 'var(--row-selected)',
  fontFamily: FONT_MONO, fontSize: 11,
  color: 'var(--text-mono)',
};
const btnPrimary: CSSProperties = {
  fontSize: 11, padding: '3px 9px',
  background: 'var(--color-selected)', color: '#fff',
  border: '1px solid var(--color-selected)', borderRadius: 999,
  cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
};
const btnGhost: CSSProperties = {
  fontSize: 11, padding: '3px 9px',
  background: 'var(--bg-app)', color: 'var(--text-mono)',
  border: '1px solid var(--border)', borderRadius: 999,
  cursor: 'pointer', fontFamily: 'inherit',
};
const countBadge: CSSProperties = {
  fontFamily: FONT_MONO, fontSize: 10,
  marginLeft: 3, opacity: 0.75,
};
