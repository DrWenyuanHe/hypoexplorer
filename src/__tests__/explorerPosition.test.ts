import { describe, it, expect } from 'vitest';
import { getDataset } from '../data/datasets';
import {
  COMPARE_TRACK, activeTabOf, activeTrackOf, initialPosition, nextPosition,
  type ExplorerPosition, type NavigationIntent,
} from '../explorer/explorerPosition';
import type { ExplorerTab } from '../explorer/explorerTabs';
import type { Dataset } from '../types';

// The explorer position is the one place that decides where a navigation lands
// and what it costs (the session reset scope, the track to load). These tables
// drive it directly, with no React and no bundle loads.

const MACAQUE = getDataset('macaque_snrna')!;
const FACTORIAL = getDataset('gse148252')!; // four contrasts, one track
const SCN = getDataset('mouse_scn_hfd_gse157077')!;

// No registered multi-track dataset has a time course on only some tracks, so
// the track-scoped Circadian rule needs a fixture: the atlas with i23 as its
// only time-course track, plus a pathway-less copy of it.
const ATLAS_WITH_CLOCK: Dataset = {
  ...MACAQUE, id: 'atlas_clock', timeSeries: { ...SCN.timeSeries!, tracks: ['i23', 'e9'] },
};
const ATLAS_NO_PATHWAYS: Dataset = { ...MACAQUE, id: 'atlas_bare', supportsPathways: false };
const fixtures = (id: string) => ({ atlas_clock: ATLAS_WITH_CLOCK, atlas_bare: ATLAS_NO_PATHWAYS }[id] ?? getDataset(id));

const at = (dataset: Dataset, trackId: string, tab: ExplorerTab = 'gene'): ExplorerPosition => ({
  ...initialPosition(dataset), focus: { kind: 'track', trackId, tab },
});
const go = (position: ExplorerPosition, intent: NavigationIntent) => nextPosition(position, intent, fixtures);

describe('explorer position: selecting a track', () => {
  it.each([
    ['gene', 'gene'],
    ['pathway', 'pathway'],
    ['qc', 'gene'],
    ['datasources', 'gene'],
  ] as const)('from the %s tab lands on %s, resets the track and loads it', (from, to) => {
    const t = go(at(MACAQUE, 'e9', from), { type: 'track', trackId: 'i23' });
    expect(t.position.focus).toEqual({ kind: 'track', trackId: 'i23', tab: to });
    expect(t.reset).toBe('track');
    expect(t.load).toEqual({ dataset: MACAQUE, trackId: 'i23' });
  });

  it('keeps Circadian when the new track has a time course, and drops it when not', () => {
    const keep = go(at(ATLAS_WITH_CLOCK, 'e9', 'circadian'), { type: 'track', trackId: 'i23' });
    expect(activeTabOf(keep.position)).toBe('circadian');
    const drop = go(at(ATLAS_WITH_CLOCK, 'i23', 'circadian'), { type: 'track', trackId: 'e1' });
    expect(activeTabOf(drop.position)).toBe('gene');
  });

  it('re-selecting the current track on a dataset-scoped tab shows the Gene Explorer without a reset', () => {
    for (const tab of ['qc', 'datasources'] as const) {
      const t = go(at(MACAQUE, 'e9', tab), { type: 'track', trackId: 'e9' });
      expect(t.position.focus).toEqual({ kind: 'track', trackId: 'e9', tab: 'gene' });
      expect(t.reset).toBeNull();
      expect(t.load).toBeNull();
    }
  });

  it('re-selecting the current track on a track-scoped tab changes nothing', () => {
    const start = at(MACAQUE, 'e9', 'pathway');
    const t = go(start, { type: 'track', trackId: 'e9' });
    expect(t.position).toBe(start);
    expect(t.reset).toBeNull();
  });

  it('treats the Compare spelling as entering Compare', () => {
    const t = go(at(MACAQUE, 'e9'), { type: 'track', trackId: COMPARE_TRACK });
    expect(t.position.focus.kind).toBe('compare');
  });
});

describe('explorer position: Compare', () => {
  it('remembers the track and tab it was entered from, and carries no tab', () => {
    const t = go(at(MACAQUE, 'i23', 'pathway'), { type: 'compare' });
    expect(t.position.focus).toEqual({ kind: 'compare', returnTo: { trackId: 'i23', tab: 'pathway' } });
    expect(activeTrackOf(t.position)).toBe(COMPARE_TRACK);
    expect(activeTabOf(t.position)).toBeNull();
    expect(t.reset).toBe('track');
    expect(t.load).toBeNull();
  });

  it('leaving returns to where it was entered from, dataset-scoped tab included', () => {
    for (const tab of ['pathway', 'qc'] as const) {
      const inCompare = go(at(MACAQUE, 'i23', tab), { type: 'compare' }).position;
      const t = go(inCompare, { type: 'leaveCompare' });
      expect(t.position.focus).toEqual({ kind: 'track', trackId: 'i23', tab });
      expect(t.reset).toBe('track');
      expect(t.load).toEqual({ dataset: MACAQUE, trackId: 'i23' });
    }
  });

  it('a named tab leaves Compare for the return track — the hub QC link opens QC', () => {
    const inCompare = go(at(MACAQUE, 'i23', 'pathway'), { type: 'compare' }).position;
    const t = go(inCompare, { type: 'tab', tab: 'qc' });
    expect(t.position.focus).toEqual({ kind: 'track', trackId: 'i23', tab: 'qc' });
    expect(t.load).toEqual({ dataset: MACAQUE, trackId: 'i23' });
  });

  it('a track click in Compare keeps the return tab when it is track-scoped', () => {
    const inCompare = go(at(MACAQUE, 'e9', 'pathway'), { type: 'compare' }).position;
    expect(go(inCompare, { type: 'track', trackId: 'i23' }).position.focus).toEqual({ kind: 'track', trackId: 'i23', tab: 'pathway' });
  });

  it('entering twice and leaving when not in Compare are no-ops', () => {
    const inCompare = go(at(MACAQUE, 'e9'), { type: 'compare' }).position;
    expect(go(inCompare, { type: 'compare' }).position).toBe(inCompare);
    const onTrack = at(MACAQUE, 'e9');
    expect(go(onTrack, { type: 'leaveCompare' }).position).toBe(onTrack);
  });
});

describe('explorer position: tabs', () => {
  it('switches to an offered tab with no reset or load', () => {
    const t = go(at(MACAQUE, 'e9'), { type: 'tab', tab: 'qc' });
    expect(activeTabOf(t.position)).toBe('qc');
    expect(t.reset).toBeNull();
    expect(t.load).toBeNull();
  });

  it('ignores an unknown tab, and a tab this track does not offer', () => {
    const start = at(ATLAS_NO_PATHWAYS, 'e9');
    expect(go(start, { type: 'tab', tab: 'nope' }).position).toBe(start);
    expect(go(start, { type: 'tab', tab: 'pathway' }).position).toBe(start);
    expect(go(start, { type: 'tab', tab: 'circadian' }).position).toBe(start);
  });
});

describe('explorer position: contrasts', () => {
  it('switches to a declared contrast with the contrast reset', () => {
    const t = go(initialPosition(FACTORIAL), { type: 'contrast', contrastId: 'light_vs_dark_ko' });
    expect(t.position.contrastId).toBe('light_vs_dark_ko');
    expect(t.reset).toBe('contrast');
  });

  it('ignores a contrast the dataset does not declare', () => {
    const start = initialPosition(FACTORIAL);
    expect(go(start, { type: 'contrast', contrastId: 'obese_vs_normal' }).position).toBe(start);
  });

  it('keeps the contrast across track switches and Compare', () => {
    const start = { ...at(MACAQUE, 'e9'), contrastId: 'obese_vs_normal' };
    const viaTrack = go(start, { type: 'track', trackId: 'i23' }).position;
    const viaCompare = go(viaTrack, { type: 'compare' }).position;
    expect(go(viaCompare, { type: 'leaveCompare' }).position.contrastId).toBe('obese_vs_normal');
  });
});

describe('explorer position: opening from outside the explorer', () => {
  it('a new dataset lands on its default track, default contrast and the Gene Explorer', () => {
    const fromQc = at(MACAQUE, 'i23', 'qc');
    const t = go(fromQc, { type: 'open', datasetId: FACTORIAL.id });
    expect(t.position).toEqual(initialPosition(FACTORIAL));
    expect(t.reset).toBe('dataset');
    expect(t.load).toEqual({ dataset: FACTORIAL, trackId: 'hypothalamus' });
  });

  it('lands on a named track and an offered named tab; an unoffered tab degrades to gene', () => {
    expect(go(initialPosition(FACTORIAL), { type: 'open', datasetId: MACAQUE.id, trackId: 'i23', tab: 'pathway' }).position.focus)
      .toEqual({ kind: 'track', trackId: 'i23', tab: 'pathway' });
    expect(go(initialPosition(FACTORIAL), { type: 'open', datasetId: 'atlas_bare', trackId: 'i23', tab: 'pathway' }).position.focus)
      .toEqual({ kind: 'track', trackId: 'i23', tab: 'gene' });
  });

  it('the open dataset with no track keeps the track but shows the Gene Explorer', () => {
    const t = go(at(MACAQUE, 'i23', 'qc'), { type: 'open', datasetId: MACAQUE.id });
    expect(t.position.focus).toEqual({ kind: 'track', trackId: 'i23', tab: 'gene' });
    expect(t.reset).toBeNull();
    expect(t.load).toBeNull();
  });

  it('the open dataset while in Compare leaves Compare — a tracker link no longer strands it', () => {
    const inCompare = go(at(MACAQUE, 'i23'), { type: 'compare' }).position;
    const t = go(inCompare, { type: 'open', datasetId: MACAQUE.id });
    expect(t.position.focus).toEqual({ kind: 'track', trackId: 'i23', tab: 'gene' });
    expect(t.reset).toBe('track');
    expect(t.load).toEqual({ dataset: MACAQUE, trackId: 'i23' });
  });

  it('opens Compare, returning to the default track and Gene Explorer in a new dataset', () => {
    const t = go(initialPosition(FACTORIAL), { type: 'open', datasetId: MACAQUE.id, compare: true });
    expect(t.position.focus).toEqual({ kind: 'compare', returnTo: { trackId: 'e9', tab: 'gene' } });
    expect(t.reset).toBe('dataset');
    expect(t.load).toBeNull();
  });

  it('adopts a saved analysis contrast, and resets for it within the open dataset', () => {
    const analysis = { version: 1, contrastId: 'ko_vs_wt_light', genes: [], chartScale: 'native',
      volcano: { metric: 'pval', logFCThresh: 0, sigThresh: 2 },
      pathway: { search: '', dbFilter: {}, fdrThresh: 1, sortKey: 'nes' } } as never;
    const t = go(initialPosition(FACTORIAL), { type: 'open', datasetId: FACTORIAL.id, analysis });
    expect(t.position.contrastId).toBe('ko_vs_wt_light');
    expect(t.reset).toBe('contrast');
  });

  it('ignores an unknown dataset', () => {
    const start = at(MACAQUE, 'e9');
    expect(go(start, { type: 'open', datasetId: 'no_such_study' }).position).toBe(start);
  });
});
