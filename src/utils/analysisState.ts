import { DATASET_CATEGORIES, type DatasetCategory } from '../data/datasetCategories';
import { DB_NAMES } from '../data/constants';
import type { GeneStudyFilters } from '../crossdataset/geneStudyScope';
import { PATHWAY_SORT_DIRS } from '../pathway-explorer/pathwayTable';
import { CHART_SCALES, type ChartScale } from './chartScale';

/** Public URL contract. Add a new version when its meaning changes. */
export interface StudyAnalysisState {
  version: 1;
  datasetIds: string[] | null;
  categories: DatasetCategory[] | null;
  filters: GeneStudyFilters;
  chartScale?: ChartScale;
}

export interface ExplorerAnalysisState {
  version: 1;
  contrastId: string | null;
  genes: string[];
  chartScale?: ChartScale;
  volcano: { metric: 'pval' | 'fdr'; logFCThresh: number; sigThresh: number };
  pathway: { search: string; dbFilter: Record<string, boolean>; fdrThresh: number; sortKey: string };
}

export const DEFAULT_STUDY_ANALYSIS: StudyAnalysisState = {
  version: 1, datasetIds: null, categories: null, filters: { minSamples: 0, requiredChecks: [] },
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function strings(value: unknown, limit = 1000): value is string[] {
  return Array.isArray(value) && value.length <= limit
    && value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 256);
}

function numberIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function validScale(value: unknown): value is ChartScale | undefined {
  return value === undefined || (CHART_SCALES as readonly unknown[]).includes(value);
}

/** Fail closed: malformed or newer filters must never become an unfiltered analysis. */
export function parseStudyAnalysis(value: unknown): StudyAnalysisState | null {
  if (!object(value) || value.version !== 1 || !object(value.filters) || !validScale(value.chartScale)) return null;
  if (!onlyKeys(value, ['version', 'datasetIds', 'categories', 'filters', 'chartScale'])
    || !onlyKeys(value.filters, ['minSamples', 'requiredChecks'])) return null;
  if (value.datasetIds !== null && !strings(value.datasetIds)) return null;
  if (value.categories !== null && (!strings(value.categories, DATASET_CATEGORIES.length)
    || !value.categories.every((category) => (DATASET_CATEGORIES as readonly string[]).includes(category)))) return null;
  const { minSamples, requiredChecks } = value.filters;
  if (!numberIn(minSamples, 0, 100000) || !Number.isInteger(minSamples) || !strings(requiredChecks, 3)
    || !requiredChecks.every((key) => ['pipelineQc', 'experimentalDesign', 'authorConcordance'].includes(key))) return null;
  return {
    version: 1,
    ...(value.chartScale ? { chartScale: value.chartScale } : {}),
    datasetIds: value.datasetIds === null ? null : [...new Set(value.datasetIds)],
    categories: value.categories === null ? null : [...new Set(value.categories)] as DatasetCategory[],
    filters: { minSamples, requiredChecks: [...new Set(requiredChecks)] as GeneStudyFilters['requiredChecks'] },
  };
}

export function parseExplorerAnalysis(value: unknown): ExplorerAnalysisState | null {
  if (!object(value) || value.version !== 1 || !strings(value.genes, 100000) || !validScale(value.chartScale)
    || (value.contrastId !== null && (typeof value.contrastId !== 'string' || value.contrastId.length > 256))
    || !object(value.volcano) || !object(value.pathway)) return null;
  if (!onlyKeys(value, ['version', 'contrastId', 'genes', 'volcano', 'pathway', 'chartScale'])
    || !onlyKeys(value.volcano, ['metric', 'logFCThresh', 'sigThresh'])
    || !onlyKeys(value.pathway, ['search', 'dbFilter', 'fdrThresh', 'sortKey'])) return null;
  const { metric, logFCThresh, sigThresh } = value.volcano;
  const { search, dbFilter, fdrThresh, sortKey } = value.pathway;
  if ((metric !== 'pval' && metric !== 'fdr') || !numberIn(logFCThresh, 0, 1000)
    || !numberIn(sigThresh, 0, 1000) || typeof search !== 'string' || search.length > 1000
    || !object(dbFilter) || Object.keys(dbFilter).length !== DB_NAMES.length
    || !DB_NAMES.every((db) => typeof dbFilter[db] === 'boolean')
    || !numberIn(fdrThresh, 0, 1) || !Object.keys(PATHWAY_SORT_DIRS).includes(String(sortKey))) return null;
  return {
    version: 1, contrastId: value.contrastId, genes: [...new Set(value.genes)],
    ...(value.chartScale ? { chartScale: value.chartScale } : {}),
    volcano: { metric, logFCThresh, sigThresh },
    pathway: { search, dbFilter: Object.fromEntries(DB_NAMES.map((db) => [db, dbFilter[db] as boolean])), fdrThresh, sortKey: sortKey as string },
  };
}

/** Default links remain short; any restriction (including an empty set) is explicit. */
export function hasStudyAnalysis(state: StudyAnalysisState): boolean {
  return state.datasetIds !== null || state.categories !== null
    || state.filters.minSamples !== 0 || state.filters.requiredChecks.length > 0;
}
