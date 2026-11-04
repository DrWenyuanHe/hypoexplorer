// The pathway-table seam: the single place a list of FGSEA pathway rows becomes
// the page of rows a table renders.
//
// HypoExplorer browses pathways in two places — the single-track Pathway
// Explorer and the Compare tab's cross-population view — and both had grown
// their own copy of the same four rules: filter by enabled database, narrow by
// search, sort, and paginate, plus "drop the selection when it falls out of the
// filtered list". The copies were verbatim, down to a shared defect: both wrote
//
//     useEffect(() => { setPage(1); }, [])     // "reset to page 1 when filters change"
//
// with an empty dependency array, so the reset never fired. It was masked by the
// page clamp below, which is why it survived in both. The reset is real here.
//
// Contract:
//   usePathwayTable({ rows, search, dbFilter, include?, compare?, selected?, onDeselect? })
//     -> { displayed, filtered, page, setPage, pageSize, setPageSize, totalPages, safePage }
//
// The row TYPE is the caller's: the single-track view pages over
// PathwayRecordWithDb, the compare view over its own per-population shape. All
// this module requires is that a row can be identified — which is `(db,
// pathway)`, never `pathway` alone.

import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * The minimum a row must carry to be tabulated.
 *
 * `db` is part of the identity, not decoration: GO and Reactome both publish a
 * "Glycolysis", and keying on the name alone silently merges two different gene
 * sets into one row.
 */
export interface PathwayKeyed {
  pathway: string;
  db: string;
}

/** How many rows a page holds. 'all' disables paging entirely. */
export type PathwayPageSize = number | 'all';

/** A row carrying the per-track FGSEA statistics the standard sorts read. */
export interface PathwayStatsKeyed extends PathwayKeyed {
  NES: number;
  padj: number;
  pval: number;
}

/**
 * The sort orders the single-track pathway table offers, by its sort-key id.
 *
 * `nes` ranks by EFFECT SIZE (|NES| descending) while `pval` ranks by adjusted
 * significance and `rawpval` by the unadjusted p — three different questions, so
 * the keys are not interchangeable. Kept here, beside the table that applies
 * them, and as data rather than an if-chain so each is separately testable.
 */
export const PATHWAY_SORTS: Record<string, (a: PathwayStatsKeyed, b: PathwayStatsKeyed) => number> = {
  nes: (a, b) => Math.abs(b.NES) - Math.abs(a.NES),
  pval: (a, b) => a.padj - b.padj,
  rawpval: (a, b) => a.pval - b.pval,
  name: (a, b) => a.pathway.localeCompare(b.pathway),
};

/**
 * Which way each PATHWAY_SORTS comparator actually orders, as the ±1 direction
 * a header reports (1 ascending, -1 descending).
 *
 * Declared beside the comparators because it IS each comparator's own
 * direction. The single-track table SELECTS a sort rather than toggling one —
 * clicking the active header re-selects it, it never flips — so the direction
 * its header announces has to come from the comparator rather than from a piece
 * of view state that does not exist. `nes` ranks |NES| largest-first; the other
 * three rank smallest-first.
 */
export const PATHWAY_SORT_DIRS: Record<string, number> = {
  nes: -1,
  pval: 1,
  rawpval: 1,
  name: 1,
};

/** Do two rows refer to the same pathway? Identity is (db, pathway). */
export function samePathway(a: PathwayKeyed | null | undefined, b: PathwayKeyed | null | undefined): boolean {
  if (!a || !b) return false;
  return a.db === b.db && a.pathway === b.pathway;
}

export interface PathwayTableInput<T extends PathwayKeyed> {
  /** Every candidate row, unfiltered. */
  rows: T[];
  /** The search box's current text; matched case-insensitively on the name. */
  search: string;
  /** Enabled databases, by name (GO_BP, HALLMARK, …). */
  dbFilter: Record<string, boolean>;
  /**
   * An extra per-row predicate, for a filter only one view has — the single-track
   * table's FDR cutoff. Kept as a predicate rather than a threshold field so this
   * module never has to know which statistic a view cuts on.
   */
  include?: (row: T) => boolean;
  /**
   * Row order. Defaults to insertion order, so a caller that does not sort is not
   * silently given one. Must be a stable reference (a useCallback / module-level
   * function), since it participates in the memo.
   */
  compare?: (a: T, b: T) => number;
  /** Rows per page before the user changes it. */
  initialPageSize?: PathwayPageSize;
  /** The currently-selected row, if the view has a selection. */
  selected?: PathwayKeyed | null;
  /** Called when the selection is no longer among the filtered rows. */
  onDeselect?: () => void;
}

export interface PathwayTable<T extends PathwayKeyed> {
  /** Every row surviving the filters, in sort order. */
  filtered: T[];
  /** Just the current page of `filtered` — what the table body renders. */
  displayed: T[];
  page: number;
  setPage: (updater: number | ((prev: number) => number)) => void;
  pageSize: PathwayPageSize;
  setPageSize: (next: PathwayPageSize) => void;
  totalPages: number;
  /**
   * The page actually being shown.
   *
   * Clamped, because `page` can outlive the list it indexes: narrow the filters
   * while on page 7 of 9 and there may now be two pages. Render `safePage`, never
   * `page`.
   */
  safePage: number;
}

export function usePathwayTable<T extends PathwayKeyed>({
  rows, search, dbFilter, include, compare, initialPageSize = 100, selected, onDeselect,
}: PathwayTableInput<T>): PathwayTable<T> {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PathwayPageSize>(initialPageSize);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = rows.filter((row) => {
      if (!dbFilter[row.db]) return false;
      if (q && !row.pathway.toLowerCase().includes(q)) return false;
      if (include && !include(row)) return false;
      return true;
    });
    // Sort the filtered COPY: `rows` belongs to the caller (it is derived from
    // popData, which is memoized and shared), so sorting in place would reorder
    // another view's data as a side effect.
    if (compare) out.sort(compare);
    return out;
  }, [rows, search, dbFilter, include, compare]);

  // Narrowing the filters must return the user to page 1 — otherwise a search
  // typed while deep in the list lands them on a clamped last page with no
  // indication of why. This is the reset both views intended and neither had.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `filtered` is the change signal; reading it here would reset on every re-sort of identical content.
  useEffect(() => { setPage(1); }, [search, dbFilter, include]);

  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const displayed = useMemo(
    () => (pageSize === 'all' ? filtered : filtered.slice((safePage - 1) * pageSize, safePage * pageSize)),
    [filtered, pageSize, safePage],
  );

  // A selection that has been filtered out must be dropped, or the detail panel
  // goes on describing a pathway no longer in the table behind it.
  useEffect(() => {
    if (!selected || !onDeselect) return;
    if (!filtered.some((row) => samePathway(row, selected))) onDeselect();
  }, [filtered, selected, onDeselect]);

  const setPageSizeAndReset = useCallback((next: PathwayPageSize) => {
    setPageSize(next);
    setPage(1);
  }, []);

  return {
    filtered, displayed, page, setPage, pageSize,
    setPageSize: setPageSizeAndReset, totalPages, safePage,
  };
}
