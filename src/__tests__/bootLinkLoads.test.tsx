import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { preloadAppViews } from '../appViews';
import { _resetTrackCache } from '../data/loadTrack';
import { _resetDatasetMetaCache, loadDatasetMeta } from '../data/loadDatasetMeta';
import { loadTrackData } from '../data/trackData';
import { POP_META_FIXTURE } from './fixtures';
import { routeHref } from '../utils/appLinks';
import { DB_NAMES } from '../data/constants';
import type { ExplorerAnalysisState } from '../utils/analysisState';

const ANALYSIS: ExplorerAnalysisState = {
  version: 1, contrastId: null, genes: ['POMC'],
  volcano: { metric: 'fdr', logFCThresh: 0.5, sigThresh: 0.05 },
  pathway: { search: '', dbFilter: Object.fromEntries(DB_NAMES.map((db) => [db, true])), fdrThresh: 0.05, sortKey: 'pval' },
};

// What a cold link costs: the bundles and metadata the app asks for when it is
// OPENED at a link, before the user does anything.
//
// The explorer starts on the default dataset and the link moves it. App used
// to load the active track before the link had landed, so a cold link to any
// other study (or to another macaque track) also fetched the macaque default
// track (409 KB compressed, plus its 192 KB pathway sibling), which was never
// shown. These count the calls instead of trusting the screen, with the
// setup's seeded macaque globals removed so every macaque read shows up.
//
// The macaque METADATA (2.2 KB) still loads: the explorer store reads its
// active dataset's metadata as soon as it mounts, on every view, and these do
// not pin that either way.

vi.mock('../data/trackData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/trackData')>();
  return { ...actual, loadTrackData: vi.fn(actual.loadTrackData) };
});
vi.mock('../data/loadDatasetMeta', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/loadDatasetMeta')>();
  return { ...actual, loadDatasetMeta: vi.fn(actual.loadDatasetMeta) };
});

const g = window as unknown as Record<string, unknown>;
const MACAQUE_SEEDS = ['HX_MACAQUE_SNRNA_META', 'HX_MACAQUE_SNRNA_E9'];
let saved: Record<string, unknown> = {};

beforeAll(() => preloadAppViews());
beforeEach(() => {
  _resetTrackCache();
  _resetDatasetMetaCache();
  vi.mocked(loadTrackData).mockClear();
  vi.mocked(loadDatasetMeta).mockClear();
  saved = Object.fromEntries(MACAQUE_SEEDS.map((key) => [key, g[key]]));
  for (const key of MACAQUE_SEEDS) delete g[key];
  // The mouse study's metadata, so a named track can be checked; its track is
  // not seeded, so asking for it shows up as a call.
  g.HX_MOUSE_HYPO_HFD_GSE220533_META = {
    populations: ['whole'],
    labels: { whole: 'Whole hypothalamus' },
    types: { whole: 'Whole tissue' },
    qcFlags: { whole: { nNormal: 7, nObese: 8, is3v3: false } },
    nGenes: { whole: 2 },
  };
});
afterEach(() => {
  Object.assign(g, saved);
  delete g.HX_MOUSE_HYPO_HFD_GSE220533_META;
  window.history.replaceState(null, '', '/');
});

const tracks = () => vi.mocked(loadTrackData).mock.calls.map(([dataset, trackId]) => `${dataset.id}/${trackId}`);
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('App — what a cold link loads', () => {
  it('a link to another study loads that study\'s track and no track of the default one', async () => {
    window.history.replaceState(null, '', '/#/dataset/mouse_hypo_hfd_gse220533');
    render(<App />);
    await screen.findByRole('button', { name: /Active dataset: Mouse whole hypothalamus/i });
    await waitFor(() => expect(tracks()).toContain('mouse_hypo_hfd_gse220533/whole'));
    await settle();
    expect(tracks()).toEqual(['mouse_hypo_hfd_gse220533/whole']);
  });

  it('a link naming another study\'s track checks it, then loads only that track', async () => {
    window.history.replaceState(null, '', '/#/dataset/mouse_hypo_hfd_gse220533/whole');
    render(<App />);
    await screen.findByRole('button', { name: /Active dataset: Mouse whole hypothalamus/i });
    await waitFor(() => expect(tracks()).toContain('mouse_hypo_hfd_gse220533/whole'));
    await settle();
    expect(tracks()).toEqual(['mouse_hypo_hfd_gse220533/whole']);
  });

  it('a link naming a non-default track of the default study loads that track, not the default first', async () => {
    g.HX_MACAQUE_SNRNA_META = POP_META_FIXTURE;
    window.history.replaceState(null, '', '/#/dataset/macaque_snrna/i23');
    render(<App />);
    await waitFor(() => expect(tracks()).toContain('macaque_snrna/i23'));
    await settle();
    expect(tracks()).toEqual(['macaque_snrna/i23']);
  });

  it('a link refused only after its check loads no track behind the error page', async () => {
    // A saved analysis asking for Compare on a one-population study passes
    // the registry checks, then refuses once the populations are known.
    const link = routeHref({
      view: 'explorer', datasetId: 'mouse_hypo_hfd_gse220533', trackId: 'compare', analysis: ANALYSIS,
    });
    window.history.replaceState(null, '', `/${link}`);
    render(<App />);
    await screen.findByRole('heading', { name: /Analysis link unavailable/i });
    await settle();
    expect(tracks()).toEqual([]);
  });

  it('the hub loads no track', async () => {
    render(<App />);
    await screen.findByRole('search', { name: 'Search genes and pathways' });
    await settle();
    expect(tracks()).toEqual([]);
  });
});
