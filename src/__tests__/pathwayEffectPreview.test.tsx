import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PathwayEffectPreview } from '../crossdataset/PathwayEffectPreview';
import { _resetBundleCache, _setBundleTransport } from '../data/bundleSource';
import { _resetTrackCache } from '../data/loadTrack';
import { getActiveContrast } from '../data/contrasts';
import type { PathwayTrackRow, RawTrack } from '../types';
import { MULTICONTRAST_DATASET_FIXTURE as dataset, MULTICONTRAST_TRACK_FIXTURE as fixture } from './fixtures';

vi.mock('../data/datasets', async (original) => {
  const actual = await original<typeof import('../data/datasets')>();
  return { ...actual, getDataset: (id: string) => id === dataset.id ? dataset : actual.getDataset(id) };
});

const pathway = 'GOBP_RESPONSE_TO_NUTRIENT_LEVELS';
const track: PathwayTrackRow = { trackId: 'other_population', label: 'Other population', type: 'Tissue', NES: 1.5, padj: 0.1, pval: 0.04, size: 25, db: 'GO_BP', direction: 'up', significant: false };
const contrast = getActiveContrast(dataset, 'refed_vs_fed');
let requests: string[];
let raw: RawTrack;
let failTrack: boolean;
let failPathways: boolean;
let release: () => void;

beforeEach(() => {
  requests = [];
  raw = { ...fixture, pathways: undefined, pathwaysByContrast: undefined };
  failTrack = false;
  failPathways = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  _resetBundleCache();
  _resetTrackCache();
  _setBundleTransport(async (url) => {
    requests.push(url);
    if (url.endsWith('/meta.js')) return { status: 'ok', value: { populations: ['whole', track.trackId], labels: {}, types: {}, nGenes: {}, colors: {}, qcFlags: {} } };
    if (url.endsWith(`/track_${track.trackId}.js`) && !failTrack) return { status: 'ok', value: raw };
    if (url.endsWith(`/track_${track.trackId}.pathways.js`) && !failPathways) {
      await gate;
      return { status: 'ok', value: {
        default: fixture.pathways,
        byContrast: { ...fixture.pathwaysByContrast, refed_vs_fed: {
          ...fixture.pathwaysByContrast?.refed_vs_fed,
          HALLMARK: [{ pathway, NES: 8, pval: 0.001, padj: 0.01, size: 90, leadingEdge: ['IGFBP2'] }],
        } },
      } };
    }
    return { status: 'load-failed' };
  });
});
afterEach(() => { release(); _setBundleTransport(null); _resetBundleCache(); _resetTrackCache(); });

function mount(name = pathway) {
  return render(<PathwayEffectPreview pathway={name} dataset={dataset} track={track} contrast={contrast}><span>+1.50</span></PathwayEffectPreview>);
}

describe('pathway enrichment preview', () => {
  it('loads on intent, waits for hydration and plots the exact population, database and comparison', async () => {
    mount();
    expect(requests).toEqual([]);
    fireEvent.mouseEnter(screen.getByRole('button', { name: /^Preview/ }));
    await screen.findByText('Loading enrichment…');
    expect(screen.queryByRole('img')).toBeNull();
    await act(async () => { release(); });
    expect(await screen.findByRole('img', { name: 'GSEA running enrichment score plot' })).toBeVisible();
    expect(screen.getByText('Ranked genes (Refed vs Fed)')).toBeVisible();
    expect(screen.getByText('NES = +1.500')).toBeVisible();
    expect(screen.getByText(/leading-edge approx. \(n=1 of 25/)).toBeVisible();
    expect(requests.some((url) => url.endsWith('/track_other_population.js'))).toBe(true);
    expect(requests.some((url) => /qc_global|track_whole/.test(url))).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('does not substitute the default comparison when the pathway is absent', async () => {
    mount('GOBP_RESPONSE_TO_FASTING');
    release();
    fireEvent.focus(screen.getByRole('button', { name: /^Preview/ }));
    expect(await screen.findByText(/An enrichment preview is not available/)).toBeVisible();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('retries a failed population load', async () => {
    failTrack = true;
    mount();
    release();
    fireEvent.click(screen.getByRole('button', { name: /^Preview/ }));
    const retry = await screen.findByRole('button', { name: 'Retry' });
    failTrack = false;
    fireEvent.click(retry);
    expect(await screen.findByRole('img')).toBeVisible();
  });

  it('settles and retries a missing pathway sibling instead of showing an endless spinner', async () => {
    failPathways = true;
    mount();
    release();
    fireEvent.click(screen.getByRole('button', { name: /^Preview/ }));
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.queryByText('Loading enrichment…')).toBeNull();
    failPathways = false;
    fireEvent.click(retry);
    expect(await screen.findByRole('img')).toBeVisible();
  });
});
