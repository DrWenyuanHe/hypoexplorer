import { describe, expect, it } from 'vitest';
import { datasetBundlePaths, readJsonp } from '../../scripts/lib/bundleReader.mjs';
import {
  applyPage, initialPage, landHash, routeOf, settleExplorer, type Landing, type PageState,
} from '../routeLanding';
import { getDataset, getDefaultDataset, listDatasets } from '../data/datasets';
import { getActiveContrast, listContrasts } from '../data/contrasts';
import { DATASET_CATEGORIES, type DatasetCategory } from '../data/datasetCategories';
import { QUALITY_BADGES } from '../data/datasetQuality';
import { DB_NAMES } from '../data/constants';
import { EXPLORER_TABS, DEFAULT_EXPLORER_TAB, explorerTabAvailable } from '../explorer/explorerTabs';
import {
  COMPARE_TRACK, activeTabOf, activeTrackOf, initialPosition, nextPosition,
} from '../explorer/explorerPosition';
import { DEFAULT_STUDY_SELECTION, type StudySelection } from '../crossdataset/studySelectionLink';
import type { ExplorerAt } from '../explorer/useExplorer';
import { sameCompareLink } from '../compare/compareView';
import { CHART_SCALES, type ChartScale } from '../utils/chartScale';
import type { CompareViewState, ExplorerAnalysisState } from '../utils/analysisState';
import type { Dataset } from '../types';

// The round trip: every address the app writes for where it is (routeOf) must
// read back (landHash) to that same place. The router writes the address after
// every move and reads it on Back, Forward, reload and a shared link, so a
// state whose address lands somewhere else is a link that silently moves the
// user. Enumerated rather than random: every registered dataset, each of its
// tabs and Compare, and strings chosen to stress the codec.

const HOME = initialPage('hub');
const SCALES = CHART_SCALES;

/** Free text a user can type or a link can carry: the codec's hard cases. */
const TEXTS = [
  'POMC', 'Nkx2-1', 'HLA-A', 'C1orf112', 'pomc', 'a b', '  padded  ', 'α-synuclein', 'x/y', 'x?y', 'x#y',
  'x&y=z', '%20', '100%', "o'brien", 'semi;colon', '+plus', 'comma,list', 'GO:0006954', 'HALLMARK_APOPTOSIS',
  'REACTOME_SIGNALING_BY_GPCR', 'a'.repeat(120),
];

function land(hash: string | null): Landing {
  expect(hash, 'routeOf named no address').not.toBeNull();
  return landHash(hash as string);
}

/** The page fields a view's address must carry: what the view shows. */
function shown(page: PageState) {
  switch (page.view) {
    case 'tracker': return { view: page.view, acc: page.trackerSelectedAcc };
    case 'search': return { view: page.view, query: page.searchQuery, filter: page.searchFilter };
    case 'library': return { view: page.view, datasetId: page.libraryDatasetId, categories: page.libraryCategories };
    case 'report': return { view: page.view, gene: page.reportGene, selection: page.geneStudySelection };
    case 'pathway-report': return { view: page.view, pathway: page.reportPathway, selection: page.pathwayStudySelection };
    case 'compare-set': return { view: page.view, items: page.compareSetItems };
    default: return { view: page.view };
  }
}

/** Write the page's address, read it back onto a fresh app, and compare what each shows. */
function expectPageRoundTrip(page: PageState, chartScale: ChartScale = 'native') {
  const hash = routeOf(page, chartScale);
  const landing = land(hash);
  expect(landing.kind, `${hash} did not land as a page`).toBe('page');
  if (landing.kind !== 'page') return;
  expect(shown(applyPage(HOME, landing.page)), hash as string).toEqual(shown(page));
  // A scale that is not the default must ride along; the default may be left out.
  expect(landing.chartScale ?? 'native', hash as string).toBe(chartScale);
}

const SELECTIONS: StudySelection[] = [
  DEFAULT_STUDY_SELECTION,
  { ...DEFAULT_STUDY_SELECTION, categories: [DATASET_CATEGORIES[0]] },
  { ...DEFAULT_STUDY_SELECTION, categories: [...DATASET_CATEGORIES].slice(0, 3) as DatasetCategory[] },
  { ...DEFAULT_STUDY_SELECTION, datasetIds: listDatasets().slice(0, 4).map((d) => d.id) },
  { ...DEFAULT_STUDY_SELECTION, datasetIds: [] },
  { ...DEFAULT_STUDY_SELECTION, filters: { minSamples: 6, requiredChecks: [QUALITY_BADGES[0].key] } },
  {
    categories: [DATASET_CATEGORIES[1]], datasetIds: [listDatasets()[0].id],
    filters: { minSamples: 3, requiredChecks: QUALITY_BADGES.map((b) => b.key) },
  },
];

describe('routeOf → landHash: full pages', () => {
  it('the hub is the bare site root', () => {
    expect(routeOf(HOME, 'native')).toBe('');
  });

  it('the fixed pages', () => {
    for (const view of ['methodology', 'verification', 'nomenclature', 'expression'] as const) {
      expectPageRoundTrip({ ...HOME, view });
    }
  });

  it('the tracker, with and without a record', () => {
    for (const acc of [null, 'GSE220533', 'E-MTAB-1234', 'PRJNA12345']) {
      expectPageRoundTrip({ ...HOME, view: 'tracker', trackerSelectedAcc: acc });
    }
  });

  it('search, for every filter and hard query', () => {
    // The router's `search` verb trims what it is given, so a held query never
    // has outer whitespace; that is the state this address has to name.
    for (const filter of ['all', 'gene', 'pathway'] as const) {
      for (const query of TEXTS) expectPageRoundTrip({ ...HOME, view: 'search', searchQuery: query.trim(), searchFilter: filter });
    }
  });

  it('the library, by record and by category scope', () => {
    const ids = [null, ...listDatasets().slice(0, 5).map((d) => d.id)];
    const scopes: Array<DatasetCategory[] | null> = [null, [DATASET_CATEGORIES[0]], [...DATASET_CATEGORIES] as DatasetCategory[]];
    for (const datasetId of ids) {
      for (const categories of scopes) expectPageRoundTrip({ ...HOME, view: 'library', libraryDatasetId: datasetId, libraryCategories: categories });
    }
  });

  it('the gene report, for hard symbols, every selection and both scales', () => {
    for (const gene of TEXTS) {
      for (const selection of SELECTIONS) {
        for (const scale of SCALES) {
          expectPageRoundTrip({ ...HOME, view: 'report', reportGene: gene, geneStudySelection: selection }, scale);
        }
      }
    }
  });

  it('the pathway report, for hard ids, every selection and both scales', () => {
    for (const pathway of TEXTS) {
      for (const selection of SELECTIONS) {
        for (const scale of SCALES) {
          expectPageRoundTrip({ ...HOME, view: 'pathway-report', reportPathway: pathway, pathwayStudySelection: selection }, scale);
        }
      }
    }
  });

  it('the compare set, with default and named tracks', () => {
    const [a, b, c] = listDatasets();
    const sets = [
      [{ datasetId: a.id, trackId: a.defaultTrack }],
      [{ datasetId: a.id, trackId: a.defaultTrack }, { datasetId: b.id, trackId: b.defaultTrack }],
      [{ datasetId: c.id, trackId: c.defaultTrack }, { datasetId: a.id, trackId: 'some_track' }],
    ];
    for (const items of sets) expectPageRoundTrip({ ...HOME, view: 'compare-set', compareSetItems: items });
  });
});

// ── The explorer ──────────────────────────────────────────────────────────

/**
 * A dataset's real populations, from its committed metadata: exactly what the
 * router checks a named track against. Only these are places the app can be,
 * so only these are written. Read through the shared bundle reader (the
 * locator-named file, parsed not evaluated, under its expected global); a
 * missing file or population list fails the test rather than shrinking what
 * it covers.
 */
function populationsOf(dataset: Dataset): string[] {
  const { meta } = datasetBundlePaths(dataset);
  const populations = readJsonp<{ populations?: unknown }>(meta.file, meta.global).populations;
  if (!Array.isArray(populations) || populations.length === 0 || !populations.every((p) => typeof p === 'string')) {
    throw new Error(`${dataset.id}: ${meta.file} names no populations`);
  }
  return populations as string[];
}

function analysisFor(genes: string[], contrastId: string | null): ExplorerAnalysisState {
  return {
    version: 1, contrastId, genes, chartScale: 'log2',
    volcano: { metric: 'pval', logFCThresh: 1, sigThresh: 0.01 },
    pathway: { search: 'apoptosis', dbFilter: Object.fromEntries(DB_NAMES.map((db) => [db, db === DB_NAMES[0]])), fdrThresh: 0.1, sortKey: 'pval' },
  };
}

/** Land an explorer address, checking a named track against `populations` the way the router does. */
function landExplorer(hash: string, populations: string[]) {
  const landing = landHash(hash);
  const settled = landing.kind === 'verify' ? settleExplorer(landing.route, landing.dataset, populations) : landing;
  expect(settled.kind, `${hash} did not land in the explorer`).toBe('explorer');
  if (settled.kind !== 'explorer') throw new Error('unreachable');
  const { position } = nextPosition(initialPosition(getDefaultDataset()), settled.intent);
  return { position, intent: settled.intent };
}

function expectExplorerRoundTrip(at: ExplorerAt, populations: string[]) {
  const hash = routeOf({ ...HOME, view: 'explorer' }, 'native', at) as string;
  const { position, intent } = landExplorer(hash, populations);
  const where = `${JSON.stringify(at)} → ${hash}`;
  expect(position.datasetId, where).toBe(at.datasetId);
  expect(activeTrackOf(position), where).toBe(at.trackId);
  if (at.trackId !== COMPARE_TRACK) expect(activeTabOf(position) ?? DEFAULT_EXPLORER_TAB, where).toBe(at.tab);
  const dataset = getDataset(at.datasetId) as Dataset;
  expect(position.contrastId, where).toBe(at.analysis?.contrastId ?? getActiveContrast(dataset)?.id ?? null);
  expect(intent.type === 'open' ? intent.analysis : undefined, where).toEqual(at.analysis);
  if (at.trackId === COMPARE_TRACK) {
    // Compared as Compare compares a link: an absent field is its default.
    const landed = intent.type === 'open' ? intent.compareView ?? {} : {};
    expect(sameCompareLink(landed, at.compare ?? {}), `${where}: landed ${JSON.stringify(landed)}`).toBe(true);
  }
}

describe('routeOf → landHash: the explorer, on every registered dataset', () => {
  const datasets = listDatasets();
  // Compare needs two populations; most studies have one.
  const comparable = datasets.filter((d) => populationsOf(d).length >= 2);
  const single = datasets.filter((d) => populationsOf(d).length < 2);

  it('every real track and every tab it offers, plain', () => {
    for (const dataset of datasets) {
      const populations = populationsOf(dataset);
      for (const trackId of populations) {
        for (const [tab] of EXPLORER_TABS) {
          if (!explorerTabAvailable(dataset, trackId, tab)) continue;
          expectExplorerRoundTrip({ datasetId: dataset.id, trackId, tab }, populations);
        }
      }
    }
  });

  it('a saved analysis, on the default and the last contrast, the default and another real track', () => {
    for (const dataset of datasets) {
      const populations = populationsOf(dataset);
      const contrasts = listContrasts(dataset).map((c) => c.id);
      const tracks = [...new Set([dataset.defaultTrack, populations[populations.length - 1]])];
      for (const contrastId of [null, ...contrasts.slice(-1)]) {
        for (const trackId of tracks) {
          expectExplorerRoundTrip(
            { datasetId: dataset.id, trackId, tab: DEFAULT_EXPLORER_TAB, analysis: analysisFor(TEXTS.slice(0, 8), contrastId) },
            populations,
          );
        }
      }
    }
  });

  it('Compare, untouched and with a view of real populations, on every dataset that can compare', () => {
    expect(comparable.length).toBeGreaterThan(0);
    for (const dataset of comparable) {
      const populations = populationsOf(dataset);
      const [a, b, c] = populations;
      const views: Array<CompareViewState | undefined> = [
        undefined,
        { genes: ['POMC', 'Nkx2-1'] },
        { pops: [b, a], mode: 'pathways' },
        { pops: c ? [c, a, b] : [b, a], genes: ['HLA-A'] },
      ];
      for (const compare of views) {
        expectExplorerRoundTrip({ datasetId: dataset.id, trackId: COMPARE_TRACK, tab: DEFAULT_EXPLORER_TAB, compare }, populations);
      }
      // Compare has its own writer branch; a saved analysis must ride along
      // with a Compare view there too, on the default and the last contrast.
      const contrasts = listContrasts(dataset).map((x) => x.id);
      for (const contrastId of [null, ...contrasts.slice(-1)]) {
        expectExplorerRoundTrip({
          datasetId: dataset.id, trackId: COMPARE_TRACK, tab: DEFAULT_EXPLORER_TAB,
          compare: { pops: [b, a], genes: ['POMC'], mode: 'pathways' }, analysis: analysisFor(TEXTS.slice(0, 8), contrastId),
        }, populations);
      }
    }
  });

  it('a Compare link to a study with one population lands on its default track', () => {
    // Not a round trip: the app never shows Compare there, so it never writes
    // this address. A shared or hand-typed one degrades as the router says.
    expect(single.length).toBeGreaterThan(0);
    for (const dataset of single) {
      const hash = routeOf({ ...HOME, view: 'explorer' }, 'native', { datasetId: dataset.id, trackId: COMPARE_TRACK, tab: DEFAULT_EXPLORER_TAB }) as string;
      const { position } = landExplorer(hash, populationsOf(dataset));
      expect(position.datasetId, hash).toBe(dataset.id);
      expect(activeTrackOf(position), hash).toBe(dataset.defaultTrack);
    }
  });
});
