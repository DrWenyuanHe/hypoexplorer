import { useCallback } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { FONT_MONO } from '../styles/constants';
import { SortableTh } from './SortableTh';
import { useSortedRows } from './useSortedRows';
import type { SortValue } from './useSortedRows';

export interface SortableColumn<Row> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  sortable?: boolean;
  sortValue?: (r: Row) => SortValue;
  color?: (r: Row) => string | undefined;
  render?: (r: Row) => ReactNode;
}

// Compact sortable table with optional search.
export function SortableTable<Row extends Record<string, unknown>>({ rows, columns, initialSort, onRowClick, rowBgFn }: {
  rows: Row[];
  columns: SortableColumn<Row>[];
  initialSort?: { key: string; dir: number };
  onRowClick?: (r: Row) => void;
  rowBgFn?: (r: Row) => string | undefined;
}) {
  // A column's own `sortValue` selector wins; otherwise the raw cell value.
  const sortValue = useCallback((r: Row, key: string) => {
    const col = columns.find((c) => c.key === key);
    return col?.sortValue ? col.sortValue(r) : r[key] as SortValue;
  }, [columns]);
  const { sorted, toggle, sortKey, sortDir } = useSortedRows(rows, sortValue, initialSort);

  // One style for both kinds of header cell. `cursor` is gone from it: a
  // sortable column takes its pointer from SortableTh's button, which is the
  // element that actually receives the click, and a non-sortable one keeps the
  // ordinary cursor it should always have had.
  const thStyle = (c: SortableColumn<Row>): CSSProperties => ({
    padding: '4px 8px', textAlign: c.align ?? 'left',
    fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
    borderBottom: '1px solid var(--border)',
    userSelect: 'none', whiteSpace: 'nowrap',
  });

  return (
    <div style={{ border: '1px solid var(--border)', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: FONT_MONO }}>
        <thead style={{ background: 'var(--bg-app)', position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>
            {columns.map((c) => (c.sortable === false ? (
              // Not sortable: a plain cell, with no button offering a sort that
              // does not exist and no aria-sort claiming one.
              <th key={c.key} scope="col" style={thStyle(c)}>{c.label}</th>
            ) : (
              <SortableTh key={c.key} scope="col" style={thStyle(c)}
                active={sortKey === c.key} dir={sortDir} onSort={() => toggle(c.key)}>
                {c.label}
              </SortableTh>
            )))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            // Every QC row carries `_key`; the fallback keeps the generic table safe for future callers.
            <tr key={(r._key as string | number | undefined) ?? i}
              onClick={() => onRowClick?.(r)}
              onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && onRowClick) { e.preventDefault(); onRowClick(r); } }}
              tabIndex={onRowClick ? 0 : -1}
              style={{
                cursor: onRowClick ? 'pointer' : 'default',
                background: rowBgFn?.(r) ?? (i % 2 === 0 ? 'var(--bg-panel)' : 'var(--bg-app)'),
                borderBottom: '1px solid var(--border)',
              }}
            >
              {columns.map((c) => (
                <td key={c.key}
                  style={{
                    padding: '3px 8px', textAlign: c.align ?? 'left',
                    color: c.color?.(r) ?? 'var(--text-primary)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >{c.render ? c.render(r) : r[c.key] as ReactNode}</td>
              ))}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={columns.length} style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)' }}>
              No rows.
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
