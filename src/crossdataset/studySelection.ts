// Study selection: the studies a cross-dataset report analyses, held as ONE
// value per report and derived in one place.
//
// The gene report and the pathway report used to spell this across six files:
// the router held a gene-only category scope beside each report's analysis
// snapshot and patched one into the other when it wrote the URL; App wrapped
// the snapshot in six setter adapters; each report seeded a category state
// machine, ran a hook with optional controlled/uncontrolled state, decoded a
// JSON string key back into the studies to query, filtered its own result
// groups and rendered its own copy of the scope panel.
//
// Contract:
//   StudySelection                       the value (categories, individual studies, filters)
//   selectionFromLink / selectionLink    its URL form (path scope + `analysis=` snapshot)
//   useStudySelection({ kind, term, value, onChange }) -> StudySelectionState
//
// The router stores one value per report kind and App hands it, with the
// router's own state setter, straight to the report. Everything that follows
// from the value (catalog wait, eligible and selected studies, the typed query,
// which result groups are visible, reset) is derived here; the report renders
// `StudySelectionPanel` and queries `state.query`.

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { DatasetCategory } from '../data/datasetCategories';
import { datasetCategory, getDataset, listDatasets } from '../data/datasets';
import { loadDatasetCatalog, registryCards, type DatasetCard } from '../data/datasetCatalog';
import { datasetQuality, type QUALITY_BADGES } from '../data/datasetQualityR460';
import type { StudyAnalysisState } from '../utils/analysisState';
import type { ChartScale } from '../utils/chartScale';
import type { Dataset } from '../types';

/** Which report a selection belongs to. Pathway reports only list pathway-capable studies. */
export type StudySelectionKind = 'gene' | 'pathway';

export interface StudyFilters {
  minSamples: number;
  requiredChecks: Array<(typeof QUALITY_BADGES)[number]['key']>;
}

export const DEFAULT_STUDY_FILTERS: StudyFilters = { minSamples: 0, requiredChecks: [] };

/**
 * The studies a report is restricted to. Each restriction is independent:
 * `categories` null = every category; `datasetIds` null = every eligible study,
 * and `[]` is an explicit empty selection that must never widen.
 */
export interface StudySelection {
  categories: DatasetCategory[] | null;
  datasetIds: string[] | null;
  filters: StudyFilters;
}

export const DEFAULT_STUDY_SELECTION: StudySelection = {
  categories: null, datasetIds: null, filters: DEFAULT_STUDY_FILTERS,
};

// ── URL form ─────────────────────────────────────────────────────────────────

/** What a report link carries: the gene page's path scope and the versioned snapshot. */
export interface StudySelectionLink {
  scope?: DatasetCategory[] | null;
  analysis?: StudyAnalysisState;
}

/**
 * The selection a report link names. Link input is untrusted: dataset ids the
 * registry no longer has are dropped (an all-stale set stays empty, never all
 * studies). The snapshot's categories win; a gene link's path scope fills in
 * only when the snapshot leaves them unrestricted, so a named scope is never
 * widened. Boot and Back/Forward both read links through here.
 */
export function selectionFromLink({ scope = null, analysis }: StudySelectionLink): StudySelection {
  return {
    categories: analysis?.categories ?? scope,
    datasetIds: analysis?.datasetIds?.filter((id) => getDataset(id)) ?? null,
    filters: analysis?.filters ?? DEFAULT_STUDY_FILTERS,
  };
}

function restricts(selection: StudySelection, { categories }: { categories: boolean }): boolean {
  return selection.datasetIds !== null || (categories && selection.categories !== null)
    || selection.filters.minSamples !== 0 || selection.filters.requiredChecks.length > 0;
}

/**
 * The link fields that name a selection. The gene page keeps its categories in
 * the path (`#/gene/<g>/<cat>,<cat>`), so categories alone add no snapshot; the
 * pathway report has no path scope, so they do. The snapshot's field order is
 * the public version-1 format: version, datasetIds, categories, filters, chartScale.
 */
export function selectionLink(kind: StudySelectionKind, selection: StudySelection, chartScale: ChartScale): StudySelectionLink {
  const snapshot = restricts(selection, { categories: kind === 'pathway' }) || chartScale !== 'native';
  const analysis: StudyAnalysisState = {
    version: 1,
    datasetIds: selection.datasetIds,
    categories: selection.categories,
    filters: selection.filters,
    chartScale,
  };
  return {
    ...(kind === 'gene' ? { scope: selection.categories } : {}),
    ...(snapshot ? { analysis } : {}),
  };
}

// ── Derivation ───────────────────────────────────────────────────────────────

/** Dataset-level evidence and measured default-track counts, as in the library. */
function passesFilters(card: DatasetCard, filters: StudyFilters): boolean {
  if (filters.minSamples > 0 && (card.nBaseline == null || card.nCase == null
    || Math.min(card.nBaseline, card.nCase) < filters.minSamples)) return false;
  if (filters.requiredChecks.length > 0) {
    const quality = datasetQuality(card.validation);
    if (!filters.requiredChecks.every((key) => quality[key].status === 'pass')) return false;
  }
  return true;
}

/** What a report asks its loader for: the term and the registry datasets to query. */
export interface StudyQuery {
  term: string;
  datasets: Dataset[];
}

export interface StudySelectionState {
  kind: StudySelectionKind;
  value: StudySelection;
  /** Every study the report kind can query (pathway: pathway-capable only). */
  cards: DatasetCard[];
  /** `cards` passing the sample and evidence filters; the category cards count these. */
  eligibleCards: DatasetCard[];
  /** Eligible studies in the active categories: what the individual picker lists. */
  availableDatasets: Dataset[];
  /** The study selection itself: available studies narrowed to the individual restriction. */
  selectedDatasets: Dataset[];
  /** The categories in force; null = all (an emptied list is all, too). */
  activeCategories: ReadonlySet<DatasetCategory> | null;
  /** True while a sample minimum waits on measured counts; nothing is queried meanwhile. */
  awaitingCounts: boolean;
  /**
   * The query to run, or null when idle (no term, or counts still loading). Its
   * identity changes only when the term or the selected study ids change.
   */
  query: StudyQuery | null;
  /** Result groups that belong to the selection, in their given order. */
  visibleGroups: <G extends { dataset: { id: string } }>(groups: readonly G[]) => G[];
  toggleCategory: (category: DatasetCategory) => void;
  setFilters: (filters: StudyFilters) => void;
  /** A state setter, so a toggle can be computed from the previous selection. */
  setDatasetIds: Dispatch<SetStateAction<string[] | null>>;
  /** Back to every study: categories, individual selection and filters together. */
  reset: () => void;
}

/**
 * Study selection for one report. `value` and `onChange` are the router's state
 * and setter for this report kind; nothing here holds a second copy, so the
 * selection survives the report's term-keyed remount and Back/Forward.
 * Report loading and cancellation stay with useReportQuery.
 */
export function useStudySelection({ kind, term, value, onChange }: {
  kind: StudySelectionKind;
  term: string;
  value: StudySelection;
  onChange: Dispatch<SetStateAction<StudySelection>>;
}): StudySelectionState {
  const [catalogCards, setCatalogCards] = useState(registryCards);
  const [catalogLoading, setCatalogLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // The catalog always settles, including registry-only fallback. Unknown
    // counts then fail a sample minimum; they must not leave a query waiting.
    loadDatasetCatalog().then((catalog) => {
      if (!cancelled) { setCatalogCards(catalog.cards); setCatalogLoading(false); }
    });
    return () => { cancelled = true; };
  }, []);

  const { filters, datasetIds } = value;
  const activeCategories = useMemo(
    () => (value.categories?.length ? new Set(value.categories) : null),
    [value.categories],
  );
  const cards = useMemo(() => kind === 'pathway'
    ? catalogCards.filter((card) => card.dataset.supportsPathways)
    : catalogCards, [catalogCards, kind]);
  const eligibleCards = useMemo(() => cards.filter((card) => passesFilters(card, filters)), [cards, filters]);
  const availableDatasets = useMemo(() => eligibleCards
    .filter((card) => !activeCategories || activeCategories.has(card.dataset.category))
    .map((card) => card.dataset), [eligibleCards, activeCategories]);
  const selectedDatasets = useMemo(() => availableDatasets
    .filter((dataset) => datasetIds === null || datasetIds.includes(dataset.id)), [availableDatasets, datasetIds]);
  const awaitingCounts = filters.minSamples > 0 && catalogLoading;

  // The query's identity is the term plus the selected ids, so a catalog
  // settling to the same studies does not re-run it. The datasets themselves
  // are read from the registry (in registry order), never from catalog copies.
  const selectedIds = selectedDatasets.map((dataset) => dataset.id);
  const identity = term && !awaitingCounts ? JSON.stringify([term, selectedIds]) : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: `identity` captures the term and the selected ids
  const query = useMemo<StudyQuery | null>(() => {
    if (!identity) return null;
    const ids = new Set(selectedIds);
    return {
      term,
      datasets: listDatasets().filter((dataset) => ids.has(dataset.id) && (kind !== 'pathway' || dataset.supportsPathways)),
    };
  }, [identity, kind]);

  const visibleGroups = useCallback(<G extends { dataset: { id: string } }>(groups: readonly G[]): G[] => {
    const ids = new Set(selectedDatasets.map((dataset) => dataset.id));
    return groups.filter((group) => ids.has(group.dataset.id)
      && (!activeCategories || activeCategories.has(datasetCategory(group.dataset.id))));
  }, [selectedDatasets, activeCategories]);

  const toggleCategory = useCallback((category: DatasetCategory) => {
    onChange((prev) => {
      const next = new Set(prev.categories ?? []);
      if (next.has(category)) next.delete(category); else next.add(category);
      // Unticking the last category widens back to all, never to an empty view.
      return { ...prev, categories: next.size ? [...next] : null };
    });
  }, [onChange]);
  const setFilters = useCallback((next: StudyFilters) => {
    onChange((prev) => ({ ...prev, filters: next }));
  }, [onChange]);
  const setDatasetIds = useCallback<Dispatch<SetStateAction<string[] | null>>>((action) => {
    onChange((prev) => ({ ...prev, datasetIds: typeof action === 'function' ? action(prev.datasetIds) : action }));
  }, [onChange]);
  const reset = useCallback(() => onChange(DEFAULT_STUDY_SELECTION), [onChange]);

  return {
    kind, value, cards, eligibleCards, availableDatasets, selectedDatasets, activeCategories,
    awaitingCounts, query, visibleGroups, toggleCategory, setFilters, setDatasetIds, reset,
  };
}
