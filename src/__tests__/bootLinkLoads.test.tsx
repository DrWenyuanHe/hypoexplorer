import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { preloadAppViews } from '../appViews';
import { _resetTrackCache } from '../data/loadTrack';
import { _resetDatasetMetaCache, loadDatasetMeta } from '../data/loadDatasetMeta';
import { loadTrackData } from '../data/trackData';
import { POP_META_FIXTURE } from './fixtures';

// What a cold link costs: the bundles and metadata the app asks for when it is
// OPENED at a link, before the user does anything.
//
// The explorer used to start on the default dataset whatever the link named,
// so a link to any other study also fetched the macaque default track (409 KB
// compressed, plus its 192 KB pathway sibling) and the macaque metadata,
// none of which was ever shown. These count the calls instead of trusting the
// screen, with the setup's seeded macaque globals removed so every macaque
// read would show up as a call.

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
const metas = () => vi.mocked(loadDatasetMeta).mock.calls.map(([dataset]) => dataset.id);
const touchedMacaque = () => [...tracks(), ...metas()].filter((id) => id.startsWith('macaque_snrna'));
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('App — what a cold link loads', () => {
  it('a link to another study loads that study, and nothing of the default one', async () => {
    window.history.replaceState(null, '', '/#/dataset/mouse_hypo_hfd_gse220533');
    render(<App />);
    await screen.findByRole('button', { name: /Active dataset: Mouse whole hypothalamus/i });
    await waitFor(() => expect(tracks()).toContain('mouse_hypo_hfd_gse220533/whole'));
    await settle();
    expect(touchedMacaque()).toEqual([]);
  });

  it('a link naming another study\'s track checks it, then loads only that track', async () => {
    window.history.replaceState(null, '', '/#/dataset/mouse_hypo_hfd_gse220533/whole');
    render(<App />);
    await screen.findByRole('button', { name: /Active dataset: Mouse whole hypothalamus/i });
    await waitFor(() => expect(tracks()).toContain('mouse_hypo_hfd_gse220533/whole'));
    await settle();
    expect(touchedMacaque()).toEqual([]);
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

  it('the hub loads no track and no study metadata', async () => {
    render(<App />);
    await screen.findByRole('search', { name: 'Search genes and pathways' });
    await settle();
    expect(tracks()).toEqual([]);
  });
});
