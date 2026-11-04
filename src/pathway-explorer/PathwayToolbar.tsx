import type { ChangeEvent, ReactNode } from 'react';
import { DB_NAMES } from '../data/constants';
import { btnStyle, LP_DB_COLOR } from '../styles/constants';
import type { PathwayPageSize } from './pathwayTable';

// The visual chrome that sits above the pathway-table seam: the database
// checkboxes that feed `dbFilter`, and the paging strip that renders what
// `usePathwayTable` returns.
//
// `pathwayTable.ts` consolidated the RULES; this consolidates the CONTROLS that
// drive them. Both views above the seam — the single-track Pathway Explorer and
// the Compare tab's cross-population view — had re-spelled the same toolbar, and
// it had drifted four ways: the Compare copy was missing the 'All' page size (so
// its select's `Number(e.target.value)` would have produced NaN had the option
// existed), guarded the pager on `totalPages > 1` alone, wrote the page
// indicator unspaced, and let a drag over the checkbox labels select text.
// Converged here onto the Pathway Explorer's variant, which is the one users had
// been given the fixes in.
//
// What is deliberately NOT here: the per-view controls. The single-track FDR
// slider, sort buttons, search box and 2v3 badge sit between the toggles and the
// paging strip (`children`), and each view keeps its own ExportButton
// (`actions`) — the labels ("Exporting…" vs "Downloading...") and button styling
// are per-site copy, exactly as ExportButton itself assumes.

/** The paged sizes the picker offers, ahead of the unpaged 'All'. */
const PAGE_SIZES = [25, 50, 100, 250];

export interface PathwayToolbarProps {
  /** Enabled databases, by name — the same value handed to `usePathwayTable`. */
  dbFilter: Record<string, boolean>;
  /**
   * Enable or disable ONE database. A semantic callback rather than the view's
   * raw dispatch: the "spread the previous map, flip one key" updater now lives
   * in usePathwayView, which both call sites share, so the toolbar asks for the
   * change it wants instead of reaching into the caller's state shape.
   */
  onDatabaseToggle: (db: string, enabled: boolean) => void;
  /** …and the rest is `usePathwayTable`'s return value, rendered. */
  pageSize: PathwayPageSize;
  setPageSize: (next: PathwayPageSize) => void;
  setPage: (updater: number | ((prev: number) => number)) => void;
  totalPages: number;
  safePage: number;
  /** How many rows survived the filters — `filtered.length`. */
  total: number;
  /** Per-view controls, between the DB toggles and the paging strip. */
  children?: ReactNode;
  /** Per-view buttons, after the row count — in both views, the ExportButton. */
  actions?: ReactNode;
}

export function PathwayToolbar({
  dbFilter, onDatabaseToggle,
  pageSize, setPageSize, setPage, totalPages, safePage, total,
  children, actions,
}: PathwayToolbarProps) {
  return (
    <div style={{
      flexShrink: 0, padding: '6px 12px', borderBottom: '1px solid var(--border)',
      display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
    }}>
      {/* DB toggles — rendered in DB_NAMES order, which is the order the tests
          (and users scanning the row) address them by. */}
      <div style={{ display: 'flex', gap: 6 }}>
        {DB_NAMES.map((db) => (
          <label key={db} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={!!dbFilter[db]}
              onChange={(e) => onDatabaseToggle(db, e.target.checked)} />
            <span style={{ color: LP_DB_COLOR[db], fontWeight: 500 }}>{db}</span>
          </label>
        ))}
      </div>

      {children}

      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Page size picker — 'all' is a string sentinel, so the handler must
            check for it before Number(). */}
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Show</span>
        <select
          value={pageSize}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setPageSize(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          style={{ fontSize: 11, padding: '1px 4px', border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg-panel)', cursor: 'pointer' }}
        >
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          <option value="all">All</option>
        </select>
        {/* Page navigation. `pageSize !== 'all'` is not redundant with
            `totalPages > 1`: it states the intent (an unpaged table has no
            pager) rather than leaning on the seam's totalPages === 1. */}
        {pageSize !== 'all' && totalPages > 1 && (
          <>
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}
              style={{ ...btnStyle, padding: '1px 6px' }}>‹</button>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
              {safePage} / {totalPages}
            </span>
            <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
              style={{ ...btnStyle, padding: '1px 6px' }}>›</button>
          </>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          ({total} total)
        </span>
        {actions}
      </div>
    </div>
  );
}
