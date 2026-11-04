import { useCallback, useMemo, useState } from 'react';

// The sortable-table core: the click-to-sort state and the one null-last
// comparator. QCTab's SortableTable and the Pathway Explorer's leading-edge gene
// summary each used to spell this out for themselves, byte for byte — including
// the detail that is easy to get wrong on a re-write: the null block returns
// ±1 WITHOUT the direction multiplier, so a missing value sorts last in BOTH
// directions rather than jumping to the top when the user flips the arrow.
//
// Deliberately NOT a shared <SortableTable>: the two tables render structurally
// different markup (QC's has scope/align/render columns and row click-through;
// the gene summary is a fixed 7-column layout), and folding them together would
// mean exposing every one of those differences as interface. What they genuinely
// share is the ordering, which is what lives here.
//
// NOT for SummaryTable.tsx: its comparator relies on the row builder having
// already coerced nulls, so routing it through here would change its output.

export type SortValue = string | number | null | undefined;

function compareSortValues(av: SortValue, bv: SortValue, dir: number): number {
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === 'string') return dir * av.localeCompare(bv as string);
  return dir * ((av as number) - (bv as number));
}

/**
 * Sort state over `rows`, reading each row's comparable value through
 * `sortValue(row, key)`. With no sort key the ORIGINAL array is returned by
 * reference (source order); a sort always copies, never mutates the input.
 *
 * `toggle(key)` flips the direction when `key` is already active and otherwise
 * selects it ascending; `arrow(key)` is the `' ↑'` / `' ↓'` header suffix (the
 * empty string for an inactive column).
 */
export function useSortedRows<Row, Key extends string>(
  rows: Row[],
  sortValue: (row: Row, key: Key) => SortValue,
  initialSort?: { key: Key; dir: number } | null,
) {
  const [sortKey, setSortKey] = useState<Key | null>(initialSort?.key ?? null);
  const [sortDir, setSortDir] = useState(initialSort?.dir ?? 1);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) =>
      compareSortValues(sortValue(a, sortKey), sortValue(b, sortKey), sortDir));
  }, [rows, sortKey, sortDir, sortValue]);

  const toggle = useCallback((key: Key) => {
    if (sortKey === key) setSortDir((d) => -d);
    else { setSortKey(key); setSortDir(1); }
  }, [sortKey]);

  const arrow = useCallback(
    (key: Key) => (sortKey === key ? (sortDir === 1 ? ' ↑' : ' ↓') : ''),
    [sortKey, sortDir],
  );

  return { sortKey, sortDir, sorted, toggle, arrow };
}
