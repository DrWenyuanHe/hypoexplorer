import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import { CompareTab } from '../compare/CompareTab';
import { getActiveContrast } from '../data/contrasts';
import { _resetTrackCache } from '../data/loadTrack';
import { _resetBundleCache, _setBundleTransport, type BundleOutcome } from '../data/bundleSource';
import { MULTICONTRAST_DATASET_FIXTURE as DS, MULTICONTRAST_TRACK_FIXTURE as FIXTURE } from './fixtures';

// Regression: Compare loaded its populations through the explorer store's
// `quiet` path, whose catch swallowed a failed bundle and resolved undefined.
// The tab could not tell "still loading" from "will never load", so a
// population whose bundle failed showed "Loading X…" for the rest of the
// session and nothing offered a retry. Populations are track columns now: a
// failed one says so, offers Retry, and the others keep working.

const BASE = '/datasets/mouse_fasting_tc';
let requests: string[];
let failing: Set<string>;

beforeEach(() => {
  requests = [];
  failing = new Set([`${BASE}/track_other_population.js`]);
  _resetBundleCache();
  _resetTrackCache();
  _setBundleTransport(async (url): Promise<BundleOutcome> => {
    requests.push(url);
    if (failing.has(url)) return { status: 'load-failed' };
    if (url.endsWith('/track_whole.js') || url.endsWith('/track_other_population.js')) return { status: 'ok', value: { ...FIXTURE } };
    return { status: 'load-failed' };
  });
});
afterEach(() => { cleanup(); _setBundleTransport(null); _resetBundleCache(); _resetTrackCache(); });

function renderCompare() {
  return render(
    <CompareTab meta={null} dataset={DS} contrast={getActiveContrast(DS)} defaultPops={['whole', 'other_population']} />,
  );
}

function selectGene(gene: string) {
  const input = screen.getByPlaceholderText(/Search gene/i);
  fireEvent.change(input, { target: { value: gene } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('CompareTab — a population that fails to load', () => {
  it('shows the failure with Retry instead of an endless spinner, and the other population still works', async () => {
    renderCompare();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Could not load other_population/);
    // No spinner claims it is still coming.
    expect(screen.queryByText(/Loading other_population/)).toBeNull();
    expect(screen.queryByText(/Loading /)).toBeNull();

    // The population that did load is usable: its genes search and summarise.
    selectGene('IGFBP2');
    expect(screen.getByRole('button', { name: 'Remove IGFBP2 row' })).toBeTruthy();
  });

  it('loads the population on Retry once its bundle is reachable', async () => {
    renderCompare();
    const alert = await screen.findByRole('alert');
    expect(requests.filter((url) => url.endsWith('/track_other_population.js'))).toHaveLength(1);

    failing.clear();
    fireEvent.click(within(alert).getByRole('button', { name: /Retry/ }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.queryByText(/Loading /)).toBeNull();
    expect(requests.filter((url) => url.endsWith('/track_other_population.js'))).toHaveLength(2);
  });

  it('does not re-request a failed population on its own', async () => {
    const { rerender } = renderCompare();
    await screen.findByRole('alert');
    // Unrelated re-renders used to re-fire the load whenever getTrack changed
    // identity; a failed column waits for the user's Retry.
    rerender(<CompareTab meta={null} dataset={DS} contrast={getActiveContrast(DS, 'refed_vs_fed')} defaultPops={['whole', 'other_population']} />);
    selectGene('IGFBP2');
    expect(requests.filter((url) => url.endsWith('/track_other_population.js'))).toHaveLength(1);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
