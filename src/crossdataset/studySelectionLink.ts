// Study selection's value and its URL form: the half of the study-selection
// module the router holds and writes into report links.
//
// Kept apart from the derivation hook (studySelection.ts) on purpose. The
// router is in the entry bundle, and the hook reads the dataset catalog and the
// quality checks, which pull in both evidence ledgers (several MB). Those load
// with the report views, never on the hub's first paint. This file therefore
// imports nothing but the registry and types; a test pins that the entry graph
// does not reach either ledger.
//
// Contract:
//   StudySelection                       the value (categories, individual studies, filters)
//   selectionFromLink / selectionLink    its URL form (path scope + `analysis=` snapshot)

import type { DatasetCategory } from '../data/datasetCategories';
import { getDataset } from '../data/datasets';
import type { QUALITY_BADGES } from '../data/datasetQualityR460';
import type { StudyAnalysisState } from '../utils/analysisState';
import type { ChartScale } from '../utils/chartScale';

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
