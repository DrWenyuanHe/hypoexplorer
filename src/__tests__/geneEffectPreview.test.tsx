import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GeneEffectPreview } from '../crossdataset/GeneEffectPreview';
import { _resetBundleCache, _setBundleTransport } from '../data/bundleSource';
import { _resetTrackCache } from '../data/loadTrack';
import { getActiveContrast } from '../data/contrasts';
import { getGroupedValues } from '../utils/sampleValues';
import type { PopData, RawTrack, ResolvedContrast, TrackRow } from '../types';
import { MULTICONTRAST_DATASET_FIXTURE as dataset, MULTICONTRAST_TRACK_FIXTURE as fixture } from './fixtures';

vi.mock('../gene-explorer/BarSEMChart', () => ({
  BarSEMChart: ({ gene, popData, contrast }: { gene: string; popData: PopData; contrast: ResolvedContrast }) => (
    <div data-testid="expression-chart">{JSON.stringify({ gene, contrast: contrast.id, groups: getGroupedValues(popData, gene, contrast) })}</div>
  ),
}));

const track: TrackRow = { trackId: 'other_population', label: 'Other population', type: 'Tissue', logFC: 0.3, pval: 0.4, fdr: 0.6, se: null, direction: 'up', significant: false, lowPower: false };
const contrast = getActiveContrast(dataset, 'refed_vs_fed');
let requests: string[];
let raw: RawTrack;
let fail: boolean;

beforeEach(() => {
  requests = [];
  raw = { ...fixture, pathways: undefined, pathwaysByContrast: undefined };
  fail = false;
  _resetBundleCache();
  _resetTrackCache();
  _setBundleTransport(async (url) => {
    requests.push(url);
    if (url.endsWith('/meta.js')) return { status: 'ok', value: { populations: ['whole', track.trackId], labels: {}, types: {}, nGenes: {}, colors: {}, qcFlags: {} } };
    if (url.endsWith(`/track_${track.trackId}.js`) && !fail) return { status: 'ok', value: raw };
    return { status: 'load-failed' };
  });
});
afterEach(() => { _setBundleTransport(null); _resetBundleCache(); _resetTrackCache(); vi.useRealTimers(); });

function mount() {
  return render(<GeneEffectPreview gene="igfbp2" dataset={dataset} track={track} contrast={contrast}><span>+0.30</span></GeneEffectPreview>);
}

describe('gene effect expression preview', () => {
  it('loads only on intent and uses the hovered population, source symbol and exact comparison arms', async () => {
    mount();
    expect(requests).toEqual([]);
    fireEvent.mouseEnter(screen.getByRole('button', { name: /^Preview/ }));
    const chart = await screen.findByTestId('expression-chart');
    const shown = JSON.parse(chart.textContent || '{}');
    expect(shown.gene).toBe('IGFBP2');
    expect(shown.contrast).toBe('refed_vs_fed');
    expect(shown.groups.map((group: { values: number[] }) => group.values)).toEqual([[20, 22, 19], [18, 19, 17]]);
    expect(requests.some((url) => url.endsWith('/track_other_population.js'))).toBe(true);
    expect(requests.some((url) => /pathways|qc_global|track_whole/.test(url))).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('supports focus and click, keeping the preview open while the pointer moves into it', async () => {
    mount();
    const button = screen.getByRole('button', { name: /^Preview/ });
    fireEvent.focus(button);
    await screen.findByTestId('expression-chart');
    vi.useFakeTimers();
    fireEvent.mouseLeave(button);
    fireEvent.mouseEnter(screen.getByRole('region'));
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.getByRole('region')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close expression preview' }));
    expect(screen.queryByRole('region')).toBeNull();
    fireEvent.click(button);
    expect(screen.getByRole('region')).toBeVisible();
    fireEvent.scroll(window);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('shows missing samples as unavailable rather than drawing zero bars', async () => {
    raw = { ...raw, cpm: {} };
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^Preview/ }));
    expect(await screen.findByText(/Sample expression is not available/)).toBeVisible();
    expect(screen.queryByTestId('expression-chart')).toBeNull();
  });

  it('lets a failed expression request be retried', async () => {
    fail = true;
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^Preview/ }));
    const retry = await screen.findByRole('button', { name: 'Retry' });
    fail = false;
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByTestId('expression-chart')).toBeVisible());
  });
});
