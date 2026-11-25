import { describe, expect, it } from 'vitest';
import {
  applyPage, initialPage, landHash, landRoute, REFUSAL_MESSAGE, settleExplorer, type Landing,
} from '../routeLanding';
import { getDataset, getDefaultDataset } from '../data/datasets';
import { DB_NAMES } from '../data/constants';
import type { ExplorerAnalysisState } from '../utils/analysisState';

// The route-landing module is the one reader of a route, at boot and after.
// It is pure, so every rule is pinned here as a table without mounting the
// router; the router tests cover the driver (metadata, history writes).

const MACAQUE = getDefaultDataset();
const MOUSE = getDataset('mouse_hypo_hfd_gse220533')!;

const ANALYSIS: ExplorerAnalysisState = {
  version: 1, contrastId: null, genes: [], chartScale: 'log2',
  volcano: { metric: 'fdr', logFCThresh: 1, sigThresh: 0.05 },
  pathway: { search: '', dbFilter: Object.fromEntries(DB_NAMES.map((db) => [db, true])), fdrThresh: 0.05, sortKey: 'pval' },
};
const withAnalysis = (path: string, analysis: unknown = ANALYSIS) =>
  `${path}?analysis=${encodeURIComponent(JSON.stringify(analysis))}`;
const BAD = encodeURIComponent('{"version":99}');

describe('landHash', () => {
  it.each<[string, Landing]>([
    ['#some-anchor', { kind: 'ignore' }],
    [`#/dataset/${MACAQUE.id}/compare?pops=e9,i23&junk=1`, { kind: 'ignore' }],
    [`#/gene/POMC?analysis=${BAD}`, { kind: 'refuse', refusal: 'invalid-analysis' }],
    [`#/dataset/${MACAQUE.id}/compare?analysis=${BAD}`, { kind: 'refuse', refusal: 'invalid-analysis' }],
    [`#/dataset/${MACAQUE.id}/compare?pops=e9,i23&analysis=${BAD}`, { kind: 'refuse', refusal: 'invalid-analysis' }],
    [`#/dataset/${MACAQUE.id}/compare?genes=POMC&analysis=${BAD}`, { kind: 'refuse', refusal: 'invalid-analysis' }],
    ['#/dataset/no_such_dataset', { kind: 'stay' }],
    [withAnalysis('#/dataset/no_such_dataset'), { kind: 'refuse', refusal: 'dataset-unavailable' }],
    [withAnalysis(`#/dataset/${MACAQUE.id}`, { ...ANALYSIS, contrastId: 'no_such' }), { kind: 'refuse', refusal: 'contrast-unavailable' }],
  ])('lands %s', (hash, landing) => {
    expect(landHash(hash)).toEqual(landing);
  });

  it('opens a retired search landing on the search page, dropping its analysis', () => {
    const studyAnalysis = encodeURIComponent(JSON.stringify({ version: 1, datasetIds: null, categories: null, filters: { minSamples: 0, requiredChecks: [] } }));
    expect(landHash(`#/gene?analysis=${studyAnalysis}`)).toEqual({ kind: 'page', page: { view: 'search', query: '', filter: 'all' } });
  });
});

describe('landRoute — pages', () => {
  it.each([
    ['hub', { view: 'hub' }],
    ['methodology', { view: 'methodology' }],
    ['tracker', { view: 'tracker', acc: 'GSE1' }],
    ['search', { view: 'search', query: 'insulin', filter: 'pathway' }],
  ] as const)('lands %s as a page', (_name, page) => {
    const route = page.view === 'search' ? { ...page, query: '  insulin ' } : page;
    expect(landRoute(route)).toEqual({ kind: 'page', page });
  });

  it('drops an unknown library record and an empty category list', () => {
    expect(landRoute({ view: 'library', datasetId: 'no_such', categories: [] }))
      .toEqual({ kind: 'page', page: { view: 'library', datasetId: null, categories: null } });
    expect(landRoute({ view: 'library', datasetId: MOUSE.id, categories: ['Circadian'] }))
      .toEqual({ kind: 'page', page: { view: 'library', datasetId: MOUSE.id, categories: ['Circadian'] } });
  });

  it('carries a report link\'s chart scale, and no scale without an analysis', () => {
    const report = landRoute({ view: 'report', gene: 'POMC', scope: ['Circadian'] });
    expect(report).toMatchObject({ kind: 'page', page: { view: 'report', gene: 'POMC' } });
    expect(report).not.toHaveProperty('chartScale');
    const scaled = landRoute({
      view: 'pathway-report', pathway: 'P',
      analysis: { version: 1, datasetIds: null, categories: null, filters: { minSamples: 0, requiredChecks: [] }, chartScale: 'log2' },
    });
    expect(scaled).toMatchObject({ kind: 'page', chartScale: 'log2' });
  });

  it('resolves compare-set columns, and lands an all-stale set in the library', () => {
    expect(landRoute({ view: 'compare-set', items: [{ datasetId: MOUSE.id }, { datasetId: 'no_such' }, { datasetId: MOUSE.id }] }))
      .toEqual({ kind: 'page', page: { view: 'compare-set', items: [{ datasetId: MOUSE.id, trackId: MOUSE.defaultTrack }] } });
    expect(landRoute({ view: 'compare-set', items: [{ datasetId: 'no_such' }] }))
      .toEqual({ kind: 'page', page: { view: 'library', datasetId: null, categories: null } });
  });
});

describe('landRoute — explorer', () => {
  it('names the default track when the link names none (a URL is absolute)', () => {
    expect(landRoute({ view: 'explorer', datasetId: MOUSE.id })).toEqual({
      kind: 'explorer',
      intent: { type: 'open', datasetId: MOUSE.id, compare: false, trackId: MOUSE.defaultTrack, tab: undefined, analysis: undefined },
    });
  });

  it('leaves a named track or Compare to be verified', () => {
    expect(landRoute({ view: 'explorer', datasetId: MACAQUE.id, trackId: 'i23' })).toMatchObject({ kind: 'verify' });
    expect(landRoute({ view: 'explorer', datasetId: MACAQUE.id, trackId: 'compare' })).toMatchObject({ kind: 'verify' });
  });
});

describe('settleExplorer', () => {
  const route = (trackId: string, analysis?: ExplorerAnalysisState) =>
    ({ view: 'explorer' as const, datasetId: MACAQUE.id, trackId, tab: 'pathway', ...(analysis ? { analysis } : {}) });
  const pops = ['e9', 'i23'];

  it('opens a known track at its tab', () => {
    expect(settleExplorer(route('i23'), MACAQUE, pops)).toEqual({
      kind: 'explorer', intent: { type: 'open', datasetId: MACAQUE.id, compare: false, trackId: 'i23', tab: 'pathway', analysis: undefined },
    });
  });

  it('degrades an unknown track, or unverifiable metadata, to the default track without an analysis', () => {
    for (const populations of [pops, null]) {
      expect(settleExplorer(route('no_such'), MACAQUE, populations))
        .toMatchObject({ kind: 'explorer', intent: { trackId: MACAQUE.defaultTrack } });
    }
  });

  it.each([
    ['no_such', pops, 'population-unavailable'],
    ['compare', ['e9'], 'compare-unavailable'],
    ['i23', null, 'population-unverifiable'],
  ] as const)('refuses %s with an analysis (%j → %s)', (trackId, populations, refusal) => {
    expect(settleExplorer(route(trackId, ANALYSIS), MACAQUE, populations)).toEqual({ kind: 'refuse', refusal });
  });

  it('opens Compare with its known populations, carrying no tab', () => {
    const compare = { view: 'explorer' as const, datasetId: MACAQUE.id, trackId: 'compare', compare: { pops: ['e9', 'gone', 'i23'], genes: ['POMC'] } };
    expect(settleExplorer(compare, MACAQUE, pops)).toEqual({
      kind: 'explorer',
      intent: { type: 'open', datasetId: MACAQUE.id, compare: true, compareView: { genes: ['POMC'], pops: ['e9', 'i23'] }, analysis: undefined },
    });
  });

  it('lands Compare on a one-population dataset on its default track', () => {
    expect(settleExplorer({ view: 'explorer', datasetId: MOUSE.id, trackId: 'compare' }, MOUSE, ['whole']))
      .toMatchObject({ kind: 'explorer', intent: { compare: false, trackId: MOUSE.defaultTrack } });
  });
});

describe('applyPage', () => {
  it('leaves the other report kind\'s study selection alone', () => {
    const pathwaySelection = { categories: ['Circadian' as const], datasetIds: null, filters: { minSamples: 3, requiredChecks: [] } };
    const before = { ...initialPage('hub'), pathwayStudySelection: pathwaySelection };
    const after = applyPage(before, { view: 'report', gene: 'POMC', selection: before.geneStudySelection });
    expect(after.view).toBe('report');
    expect(after.reportGene).toBe('POMC');
    expect(after.pathwayStudySelection).toBe(pathwaySelection);
  });

  it('starts a report-less initial view on the hub', () => {
    expect(initialPage('report').view).toBe('hub');
    expect(initialPage('explorer').view).toBe('explorer');
  });
});

it('has a message for every refusal', () => {
  for (const message of Object.values(REFUSAL_MESSAGE)) expect(message).toMatch(/not been applied/);
});
