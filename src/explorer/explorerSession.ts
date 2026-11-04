// The explorer's SESSION state: what the user has selected and configured
// inside a dataset, and what a navigation does to it.
//
// This state is held by App rather than by the tabs because the tabs are
// conditionally rendered (App unmounts the Gene Explorer when you switch to the
// Pathway Explorer), so state owned by a tab would not survive a tab switch.
// That is a LIFETIME requirement, not a reason for App to publish ten raw
// `Dispatch<SetStateAction<…>>` props: App never reads any of these values, it
// only carries them. So the state lives here, with the operations that give it
// meaning, and App hands each tab one cohesive slice.
//
// Three slices, not one object, because they have different consumers:
//   - useGeneSelection  — the gene list. The Compare tab holds its OWN instance
//                         (an independent selection), which is what makes this a
//                         real seam rather than a speculative one. Each view
//                         binds its instance to what it has loaded through
//                         useBoundGeneSelection (geneVocabulary.ts), which owns
//                         the case policy and the chips' nomenclature notes;
//                         the state and its reset stay here.
//   - useVolcanoView    — the volcano's metric and thresholds. Only the Gene
//                         Explorer needs these; bundling them into the gene
//                         selection would hand Compare three fields it has no
//                         use for.
//   - usePathwayView    — the pathway selection, search, DB filter and sort.
//                         Generic over the row type, because the single-track
//                         Pathway Explorer pages over PathwayRecordWithDb while
//                         the Compare view pages over its own unified shape.
//
// NAVIGATION RESETS are deliberately NOT slice methods. "What survives a track
// switch" is one policy over all of the state at once; expressed as
// `genes.resetForTrack(); pathway.resetForTrack();` at the call site it would be
// distributed again, and a fourth navigation path could quietly skip a slice —
// which is exactly how App came to have four different spellings of it. The
// matrix below is the single statement of that policy, and it is plain data so
// it can be read (and tested) without mounting anything.

import { useCallback, useMemo, useState } from 'react';
import { DB_DEFAULT_FILTER } from '../data/constants';
import type { ExplorerAnalysisState } from '../utils/analysisState';

// ── Volcano metric ──────────────────────────────────────────────────────────

/**
 * Which statistic the volcano's y-axis plots.
 *
 * A union, not `string`. As a bare string this silently accepted `"pvalue"` —
 * VolcanoPlot compares against `'pval'`, so a typo fell through to the FDR
 * branch and plotted the wrong axis with no error anywhere. One test harness
 * was passing exactly that.
 */
export type VolcanoMetric = 'pval' | 'fdr';

/**
 * The significance threshold each metric opens at.
 *
 * Metric and threshold are ONE choice, not two: the two live on different
 * scales (a -log10 p of 2 is not a -log10 FDR of 2), so selecting a metric
 * without moving the threshold leaves the cutoff line in a meaningless place.
 * The pairing used to live in a JSX `onClick` inside VolcanoPlot, where nothing
 * outside that button could apply it.
 */
export const METRIC_DEFAULT_SIG_THRESH: Record<VolcanoMetric, number> = {
  pval: 2,
  fdr: 0.5,
};

// ── The reset matrix ────────────────────────────────────────────────────────

/** The three navigations that can invalidate session state. */
export type NavigationScope = 'track' | 'contrast' | 'dataset';

/** A field a navigation can clear. */
export type ResettableField =
  | 'genes'
  | 'pathwaySelection'
  | 'pathwaySearch'
  | 'cellSearch';

/**
 * What each navigation CLEARS. Everything not listed deliberately survives.
 *
 * - Thresholds, the volcano metric, the DB filter and the sort order survive
 *   every navigation: they are how the user has set the instrument up, and a
 *   cross-track or cross-dataset cutoff sweep is a real workflow.
 * - A CONTRAST switch keeps the gene selection — gene names are
 *   contrast-independent — but drops the pathway selection and search, because
 *   the selected row carries that contrast's statistics and would show stale
 *   numbers under the new arm labels even when the same (db, pathway) exists.
 * - A DATASET switch additionally clears the sidebar's track filter: its
 *   vocabulary is the OUTGOING dataset's track list, so a query that matched
 *   there usually matches nothing here.
 * - A TRACK switch keeps the sidebar filter, because that filter describes the
 *   track LIST, not the selection; clearing it collapsed a filtered sidebar
 *   back to full on every click.
 */
export const RESET_MATRIX: Record<NavigationScope, readonly ResettableField[]> = {
  track: ['genes', 'pathwaySelection', 'pathwaySearch'],
  contrast: ['pathwaySelection', 'pathwaySearch'],
  dataset: ['genes', 'pathwaySelection', 'pathwaySearch', 'cellSearch'],
};

/** Whether `scope` clears `field`. The one reader of RESET_MATRIX. */
export function resetClears(scope: NavigationScope, field: ResettableField): boolean {
  return RESET_MATRIX[scope].includes(field);
}

// ── Gene selection ──────────────────────────────────────────────────────────

export interface GeneSelection {
  readonly genes: string[];
  /** Append one gene, ignoring a duplicate. */
  add: (gene: string) => void;
  /** Append many, preserving order and dropping duplicates. */
  addMany: (genes: string[]) => void;
  remove: (gene: string) => void;
  clear: () => void;
  /** Replace the whole list in one update, deduplicated, order preserved. */
  replace: (genes: string[]) => void;
}

/**
 * A list of selected genes, with the operations that mutate it.
 *
 * The append-unique and append-many-unique rules used to be written out at
 * three call sites (App's "send genes to the Gene Explorer" handler, the Gene
 * Explorer itself, and the Compare tab) — and a fourth, inline copy of `remove`
 * sat in the Gene Explorer's own JSX beside the callback it should have used.
 */
export function useGeneSelection(): GeneSelection {
  const [genes, setGenes] = useState<string[]>([]);

  const add = useCallback((gene: string) => {
    setGenes((prev) => (prev.includes(gene) ? prev : [...prev, gene]));
  }, []);

  const addMany = useCallback((incoming: string[]) => {
    if (!incoming?.length) return;
    setGenes((prev) => {
      const seen = new Set(prev);
      const out = prev.slice();
      for (const g of incoming) if (!seen.has(g)) { seen.add(g); out.push(g); }
      return out;
    });
  }, []);

  const remove = useCallback((gene: string) => {
    setGenes((prev) => prev.filter((g) => g !== gene));
  }, []);

  const clear = useCallback(() => setGenes([]), []);

  // "Replace the selection" from a loaded list, and a restored analysis. It
  // used to be `clear(); addMany(list)` at three call sites — correct only
  // because the two queued updaters happened to apply in order — so it is one
  // updater now, and one name.
  const replace = useCallback((incoming: string[]) => {
    setGenes([...new Set(incoming ?? [])]);
  }, []);

  return useMemo(
    () => ({ genes, add, addMany, remove, clear, replace }),
    [genes, add, addMany, remove, clear, replace],
  );
}

// ── Volcano view ────────────────────────────────────────────────────────────

export interface VolcanoView {
  readonly metric: VolcanoMetric;
  /** Select the metric AND move the threshold to that metric's scale. */
  selectMetric: (metric: VolcanoMetric) => void;
  readonly logFCThresh: number;
  setLogFCThresh: (value: number) => void;
  readonly sigThresh: number;
  setSigThresh: (value: number) => void;
}

/**
 * `initial` lets a view open somewhere other than the explorer's default. The
 * library's study record uses it to open on FDR at the app's cutoff, so the
 * points it colours agree with the significant-gene count printed above them.
 */
export function useVolcanoView(initial?: { metric: VolcanoMetric; sigThresh: number }): VolcanoView {
  const [metric, setMetric] = useState<VolcanoMetric>(initial?.metric ?? 'pval');
  const [logFCThresh, setLogFCThresh] = useState(0);
  const [sigThresh, setSigThresh] = useState(initial?.sigThresh ?? METRIC_DEFAULT_SIG_THRESH.pval);

  const selectMetric = useCallback((next: VolcanoMetric) => {
    setMetric(next);
    setSigThresh(METRIC_DEFAULT_SIG_THRESH[next]);
  }, []);

  return useMemo(
    () => ({ metric, selectMetric, logFCThresh, setLogFCThresh, sigThresh, setSigThresh }),
    [metric, selectMetric, logFCThresh, sigThresh],
  );
}

// ── Pathway view ────────────────────────────────────────────────────────────

export interface PathwayView<TRow> {
  readonly selected: TRow | null;
  select: (row: TRow | null) => void;
  deselect: () => void;
  readonly search: string;
  setSearch: (value: string) => void;
  readonly dbFilter: Record<string, boolean>;
  /** Enable or disable ONE database, by name. */
  setDatabaseEnabled: (db: string, enabled: boolean) => void;
  readonly fdrThresh: number;
  setFdrThresh: (value: number) => void;
  readonly sortKey: string;
  setSortKey: (value: string) => void;
  /** Search + DB filter + FDR cutoff back to their defaults. Keeps the sort. */
  resetFilters: () => void;
}

/** The Pathway Explorer's default FDR cutoff: 1.0 shows everything. */
export const PATHWAY_FDR_DEFAULT = 1.0;
/** The default pathway ordering: by effect size. */
export const PATHWAY_SORT_DEFAULT = 'nes';

export function usePathwayView<TRow>(): PathwayView<TRow> {
  const [selected, setSelected] = useState<TRow | null>(null);
  const [search, setSearch] = useState('');
  const [dbFilter, setDbFilter] = useState<Record<string, boolean>>(() => ({ ...DB_DEFAULT_FILTER }));
  const [fdrThresh, setFdrThresh] = useState(PATHWAY_FDR_DEFAULT);
  const [sortKey, setSortKey] = useState(PATHWAY_SORT_DEFAULT);

  const select = useCallback((row: TRow | null) => setSelected(row), []);
  const deselect = useCallback(() => setSelected(null), []);

  // The "spread the previous map, flip one key" updater, written once. Both
  // views used to hand their raw dispatch to the shared toolbar so the toolbar
  // could do this itself; the toolbar now asks for the change it wants.
  const setDatabaseEnabled = useCallback((db: string, enabled: boolean) => {
    setDbFilter((prev) => ({ ...prev, [db]: enabled }));
  }, []);

  const resetFilters = useCallback(() => {
    setSearch('');
    setDbFilter({ ...DB_DEFAULT_FILTER });
    setFdrThresh(PATHWAY_FDR_DEFAULT);
  }, []);

  return useMemo(
    () => ({
      selected, select, deselect,
      search, setSearch,
      dbFilter, setDatabaseEnabled,
      fdrThresh, setFdrThresh,
      sortKey, setSortKey,
      resetFilters,
    }),
    [selected, select, deselect, search, dbFilter, setDatabaseEnabled, fdrThresh, sortKey, resetFilters],
  );
}

// ── The session ─────────────────────────────────────────────────────────────

export interface ExplorerSession<TPathwayRow> {
  genes: GeneSelection;
  volcano: VolcanoView;
  pathway: PathwayView<TPathwayRow>;
  /** The sidebar's track-list filter. */
  readonly cellSearch: string;
  setCellSearch: (value: string) => void;
  /** Apply the reset matrix for one navigation. The only reset entry point. */
  resetFor: (scope: NavigationScope) => void;
  restoreAnalysis: (analysis: ExplorerAnalysisState) => void;
}

export function useExplorerSession<TPathwayRow>(): ExplorerSession<TPathwayRow> {
  const genes = useGeneSelection();
  const volcano = useVolcanoView();
  const pathway = usePathwayView<TPathwayRow>();
  const [cellSearch, setCellSearch] = useState('');

  const { clear: clearGenes, replace: replaceGenes } = genes;
  const { deselect: deselectPathway, setSearch: setPathwaySearch } = pathway;
  const { selectMetric, setLogFCThresh, setSigThresh } = volcano;
  const { setDatabaseEnabled, setFdrThresh, setSortKey } = pathway;

  // Called after route navigation resets, in the same batch. Restore selected
  // identities/settings only; pathway result rows must come from the new data.
  const restoreAnalysis = useCallback((analysis: ExplorerAnalysisState) => {
    replaceGenes(analysis.genes);
    selectMetric(analysis.volcano.metric);
    setLogFCThresh(analysis.volcano.logFCThresh);
    setSigThresh(analysis.volcano.sigThresh);
    deselectPathway();
    setPathwaySearch(analysis.pathway.search);
    for (const [db, enabled] of Object.entries(analysis.pathway.dbFilter)) setDatabaseEnabled(db, enabled);
    setFdrThresh(analysis.pathway.fdrThresh);
    setSortKey(analysis.pathway.sortKey);
  }, [replaceGenes, selectMetric, setLogFCThresh, setSigThresh, deselectPathway, setPathwaySearch, setDatabaseEnabled, setFdrThresh, setSortKey]);

  const resetFor = useCallback((scope: NavigationScope) => {
    if (resetClears(scope, 'genes')) clearGenes();
    if (resetClears(scope, 'pathwaySelection')) deselectPathway();
    if (resetClears(scope, 'pathwaySearch')) setPathwaySearch('');
    if (resetClears(scope, 'cellSearch')) setCellSearch('');
  }, [clearGenes, deselectPathway, setPathwaySearch]);

  return useMemo(
    () => ({ genes, volcano, pathway, cellSearch, setCellSearch, resetFor, restoreAnalysis }),
    [genes, volcano, pathway, cellSearch, resetFor, restoreAnalysis],
  );
}
