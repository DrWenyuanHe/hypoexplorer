import { describe, expect, it } from 'vitest';
import { parseRoute, routeHref } from '../utils/appLinks';
import { DEFAULT_STUDY_ANALYSIS, type ExplorerAnalysisState } from '../utils/analysisState';

const explorer: ExplorerAnalysisState = {
  version: 1, contrastId: 'refed_vs_fed', genes: ['Pomc', 'Agrp'], chartScale: 'log2',
  volcano: { metric: 'fdr', logFCThresh: 1.5, sigThresh: 3 },
  pathway: { search: 'insulin', dbFilter: { GO_BP: false, HALLMARK: true, KEGG: false, REACTOME: true }, fdrThresh: 0.05, sortKey: 'pval' },
};

describe('versioned analysis links', () => {
  it('round-trips contrast, genes, thresholds, scale and pathway settings', () => {
    const route = { view: 'explorer' as const, datasetId: 'mouse_fasting_tc', trackId: 'whole', tab: 'gene', analysis: explorer };
    expect(parseRoute(routeHref(route))).toEqual(route);
  });

  it.each(['nes', 'pval', 'rawpval', 'name'])('round-trips every pathway sort the explorer offers (%s)', (sortKey) => {
    const route = { view: 'explorer' as const, datasetId: 'example', analysis: { ...explorer, pathway: { ...explorer.pathway, sortKey } } };
    expect(parseRoute(routeHref(route))).toEqual(route);
  });

  it('parses links where URLSearchParams has no size property (Safari/iOS before 17)', () => {
    const descriptor = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, 'size');
    Object.defineProperty(URLSearchParams.prototype, 'size', { get: () => undefined, configurable: true });
    try {
      const route = { view: 'explorer' as const, datasetId: 'example', analysis: explorer };
      expect(parseRoute(routeHref(route))).toEqual(route);
    } finally {
      if (descriptor) Object.defineProperty(URLSearchParams.prototype, 'size', descriptor);
    }
  });

  it.each(['report', 'pathway-report', 'compare-datasets'] as const)('preserves explicit empty study sets in %s', (view) => {
    const route = view === 'pathway-report'
      ? { view, pathway: 'A/B & C', analysis: { ...DEFAULT_STUDY_ANALYSIS, datasetIds: [] } }
      : { view, gene: 'POMC', scope: null, analysis: { ...DEFAULT_STUDY_ANALYSIS, datasetIds: [] } };
    expect(parseRoute(routeHref(route))).toEqual(route);
  });

  it.each([
    { ...DEFAULT_STUDY_ANALYSIS, version: 2 },
    { ...DEFAULT_STUDY_ANALYSIS, datasetIds: 'all' },
    { ...DEFAULT_STUDY_ANALYSIS, categories: ['unknown category'] },
    { ...DEFAULT_STUDY_ANALYSIS, filters: { minSamples: -1, requiredChecks: [] } },
    { ...DEFAULT_STUDY_ANALYSIS, filters: { minSamples: 5, requiredChecks: ['unknownCheck'] } },
    { ...DEFAULT_STUDY_ANALYSIS, filters: { minSamples: 5, requiredChecks: [], unknownRestriction: true } },
    { ...DEFAULT_STUDY_ANALYSIS, chartScale: 'unsupported' },
  ])('rejects malformed filters without widening the result: %j', (analysis) => {
    expect(parseRoute(`#/gene/POMC?analysis=${encodeURIComponent(JSON.stringify(analysis))}`)).toBeNull();
  });

  it('rejects invalid numeric thresholds and duplicate state parameters', () => {
    const bad = { ...explorer, volcano: { ...explorer.volcano, sigThresh: '3' } };
    expect(parseRoute(`#/dataset/example?analysis=${encodeURIComponent(JSON.stringify(bad))}`)).toBeNull();
    const hash = routeHref({ view: 'explorer', datasetId: 'example', analysis: explorer });
    expect(parseRoute(`${hash}&analysis={}`)).toBeNull();
  });
});
