import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { preloadAppViews } from '../appViews';
import { _resetTrackCache } from '../data/loadTrack';
import { getDefaultDataset } from '../data/datasets';
import { loadTrackData } from '../data/trackData';
import { resolveTrackGlobalKey } from '../data/bundleLocators';

// What App does on its own while the explorer is on screen, and what outlives
// a trip out of it.
//
// src/__tests__/setup.ts seeds the default track's globals, so most App tests
// never notice whether anything asks for the track: the explorer position
// starts on it and a tab intent loads nothing. These count the loads instead.
// Entering the explorer from the hub must load the active track (or the Gene
// Explorer shows its skeleton for good); the hub and Compare load none.

vi.mock('../data/trackData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/trackData')>();
  return { ...actual, loadTrackData: vi.fn(actual.loadTrackData) };
});

const HOME = getDefaultDataset();
// The seeded global the store would build its cache from; without it, only a
// call to ensureTrack loads the default track.
const SEED_KEY = resolveTrackGlobalKey(HOME, HOME.defaultTrack);
const g = window as unknown as Record<string, unknown>;
let seeded: unknown;

beforeAll(() => preloadAppViews());
beforeEach(() => {
  _resetTrackCache();
  vi.mocked(loadTrackData).mockClear();
  seeded = g[SEED_KEY];
  delete g[SEED_KEY];
});
afterEach(() => {
  g[SEED_KEY] = seeded;
});

const loadedTracks = () => vi.mocked(loadTrackData).mock.calls.map(([dataset, trackId]) => `${dataset.id}/${trackId}`);

describe('App — the explorer on screen', () => {
  it('loads no track on the hub, and the active track once the explorer opens', async () => {
    render(<App />);
    await screen.findByRole('search', { name: 'Search genes and pathways' });
    expect(loadedTracks()).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Quality control' }));
    await waitFor(() => expect(loadedTracks()).toContain(`${HOME.id}/${HOME.defaultTrack}`));
  });

  it('loads nothing for Compare itself', async () => {
    render(<App initialView="explorer" />);
    await waitFor(() => expect(loadedTracks()).toContain(`${HOME.id}/${HOME.defaultTrack}`));
    fireEvent.click(screen.getByRole('button', { name: /Compare all cells/i }));
    await screen.findByRole('button', { name: /Back to single cell/i });
    expect(loadedTracks().some((id) => id.endsWith('/compare'))).toBe(false);
  });

  it('keeps "Study details & verification" open across a trip home, and the dataset-info panel closed', async () => {
    render(<App initialView="explorer" />);
    const details = await screen.findByRole('button', { name: /Study details & verification/i });
    fireEvent.click(details);
    expect(details.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /^Dataset info$/i }));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('link', { name: /HypoExplorer home/i }));
    await screen.findByRole('search', { name: 'Search genes and pathways' });
    fireEvent.click(screen.getByRole('button', { name: 'Quality control' }));

    const back = await screen.findByRole('button', { name: /Study details & verification/i });
    expect(back.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
