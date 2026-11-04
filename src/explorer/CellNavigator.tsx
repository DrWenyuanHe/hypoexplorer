import { useMemo } from 'react';
import { ResponsiveSidebar } from '../common/ResponsiveSidebar';
import { trackColor } from '../data/datasetMeta';
import { getCellSubname } from '../utils/format';
import { isLowPower } from '../utils/qcFlags';
import { groupByType } from '../utils/popGroups';
import { FONT_MONO } from '../styles/constants';
import type { Dataset, DatasetMeta } from '../types';

// The explorer's left sidebar: the track navigator. Owns how a dataset's tracks
// are grouped into categories, how the search query narrows them, and how one is
// selected — the whole "which track am I looking at" surface.
//
// Extracted from App, where the grouping/filter/count derivations sat ~230 lines
// away from the markup that consumed them, and the only way to test that a
// search matched on marker gene (not just track id) was to mount the entire
// application and type into the sidebar.

/**
 * Does a track match the sidebar's search query?
 *
 * Search deliberately spans three fields — the track id, its marker-gene label
 * and its category — because users arrive with any of the three ("e9", "POMC",
 * "GABAergic"). Exported for its own tests.
 */
export function matchesCellQuery(
  meta: DatasetMeta | null | undefined,
  id: string,
  query: string,
): boolean {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const label = (meta?.labels?.[id] || '').toLowerCase();
  const type = (meta?.types?.[id] || '').toLowerCase();
  return id.toLowerCase().includes(q) || label.includes(q) || type.includes(q);
}

interface CellNavigatorProps {
  /** The active dataset — supplies the sidebar's category order + default track. */
  dataset: Dataset;
  /** The active dataset's metadata (labels, types, colors, qcFlags). */
  meta: DatasetMeta | null;
  /** Track ids to list, in the dataset's own order. */
  populations: string[];
  /** The selected track id, or 'compare' in Compare mode. */
  activeTrackId: string;
  /** Whether the Compare pseudo-track is selected. */
  isCompare: boolean;
  /** The current search query (owned by the shell, so it survives a re-render). */
  search: string;
  onSearchChange: (next: string) => void;
  /** Select a track — or 'compare' to enter Compare mode. */
  onSelectTrack: (trackId: string) => void;
  /** Leave Compare for the track and tab it was entered from. */
  onLeaveCompare: () => void;
}

export function CellNavigator({
  dataset, meta, populations, activeTrackId, isCompare, search, onSearchChange, onSelectTrack, onLeaveCompare,
}: CellNavigatorProps) {
  // Group tracks by category. Headers are skipped when every track shares a
  // single category (e.g. a whole-tissue bulk dataset).
  const popGroups = useMemo(
    () => groupByType(populations, {
      types: meta?.types,
      categoryOrder: dataset.trackCategoryOrder,
    }),
    [populations, meta, dataset],
  );
  const singleCategory = Object.keys(popGroups).length <= 1;

  // Filtered groups, preserving the category order.
  const filteredGroups = useMemo(() => {
    const q = search.trim();
    const out: Record<string, string[]> = {};
    for (const [type, ids] of Object.entries(popGroups)) {
      out[type] = q ? ids.filter((id) => matchesCellQuery(meta, id, q)) : ids;
    }
    return out;
  }, [popGroups, search, meta]);

  const totalMatches = useMemo(
    () => Object.values(filteredGroups).reduce((n, arr) => n + arr.length, 0),
    [filteredGroups],
  );

  return (
    <ResponsiveSidebar label="Cells" summary={isCompare ? 'Compare all cells' : activeTrackId}>
      {(close) => {
        const select = (id: string) => { onSelectTrack(id); close(); };
        return <>
      {/* Compare toggle at top — primary sidebar action */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)' }}>
        {isCompare ? (
          <button type="button" onClick={() => { onLeaveCompare(); close(); }}
            style={{
              width: '100%', padding: '8px 12px', background: 'var(--bg-panel)',
              color: 'var(--text-primary)', border: '1px solid var(--border-dark)',
              borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit',
            }}>
            ← Back to single cell
          </button>
        ) : populations.length >= 2 ? (
          // Compare only makes sense across ≥2 tracks; single-track datasets
          // (bulk whole-tissue) don't offer it.
          <button type="button" onClick={() => select('compare')}
            style={{
              width: '100%', padding: '8px 12px', background: 'var(--color-selected)',
              color: '#fff', border: 'none', borderRadius: 7,
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: '0 2px 6px rgba(242, 142, 43, 0.3)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" role="img" aria-label="Compare icon">
              <path d="M8 3v18M16 3v18M3 8h5M3 16h5M16 8h5M16 16h5"/>
            </svg>
            Compare all cells
          </button>
        ) : null}
      </div>

      <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--border)' }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
          color: 'var(--text-muted)', marginBottom: 6, padding: '0 2px',
        }}>
          <span>Cells</span>
          <span style={{ fontFamily: FONT_MONO, fontWeight: 500, letterSpacing: 0 }}>
            {search ? `${totalMatches}/${populations.length}` : populations.length}
          </span>
        </div>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            aria-label="Filter cells by id, marker gene, or type"
            placeholder="Search by id, marker, or type…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            style={{
              width: '100%', padding: '6px 26px 6px 10px', fontSize: 12,
              border: '1px solid var(--border)', borderRadius: 6,
              background: 'var(--bg-panel)', fontFamily: 'inherit',
              color: 'var(--text-primary)',
            }}
          />
          {search && (
            <button type="button" onClick={() => onSearchChange('')} title="Clear search" aria-label="Clear cell search"
              style={{
                position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                width: 20, height: 20, border: 'none', background: 'transparent',
                cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1,
                borderRadius: 4,
              }}>
              ×
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {totalMatches === 0 ? (
          <div style={{ padding: '16px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
            No cells match "{search}".
          </div>
        ) : (
          Object.entries(filteredGroups).map(([type, ids]) => {
            if (!ids.length) return null;
            const totalInGroup = popGroups[type].length;
            return (
              <div key={type} style={{ padding: '8px 0 4px' }}>
                {!singleCategory && (
                  <div style={{
                    padding: '4px 14px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                    color: 'var(--text-muted)',
                  }}>
                    <span>{type}</span>
                    <span style={{ fontFamily: FONT_MONO, fontWeight: 500, letterSpacing: 0 }}>
                      {search && ids.length !== totalInGroup ? `${ids.length}/${totalInGroup}` : totalInGroup}
                    </span>
                  </div>
                )}
                {ids.map((id) => {
                  const active = !isCompare && activeTrackId === id;
                  // Warn only on genuinely under-powered tracks (a group with
                  // n<3) — single-sourced via isLowPower, matching the QC KPI
                  // and PopWarningBadge. Balanced bulk designs (7v8, 3v4) are normal.
                  const is2v3 = isLowPower(meta?.qcFlags?.[id]);
                  const subname = getCellSubname(id, meta?.labels);
                  return (
                    <button key={id} type="button" onClick={() => select(id)}
                      title={(meta?.labels?.[id] || id) + (is2v3 ? ' · 2v3 design' : '')}
                      aria-current={active ? 'page' : undefined}
                      className={active ? 'cell-nav-row' : 'cell-nav-row hover-row'}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        width: '100%', padding: active ? '5px 14px 5px 11px' : '5px 14px',
                        background: active ? 'var(--row-selected)' : undefined,
                        border: 'none', borderLeft: active ? '3px solid var(--color-selected)' : '3px solid transparent',
                        cursor: 'pointer', textAlign: 'left',
                        color: active ? 'var(--text-primary)' : 'var(--text-mono)',
                        fontWeight: active ? 500 : 400,
                        fontFamily: 'inherit', fontSize: 12,
                      }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: trackColor(meta, id), flexShrink: 0 }} />
                      <span style={{ fontFamily: FONT_MONO, minWidth: 34 }}>{id}</span>
                      <span style={{
                        color: active ? 'var(--text-mono)' : 'var(--text-muted)',
                        fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        flex: 1, minWidth: 0,
                      }}>
                        {subname}
                      </span>
                      {is2v3 && (
                        <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#D97706"
                          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                          style={{ flexShrink: 0 }}>
                          <title>2v3 design</title>
                          <path d="M12 3 L22 20 L2 20 Z" />
                          <line x1="12" y1="10" x2="12" y2="14" />
                          <circle cx="12" cy="17" r="0.6" fill="#D97706" stroke="none" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      </>; }}
    </ResponsiveSidebar>
  );
}
