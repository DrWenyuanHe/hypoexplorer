import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CompareTab } from '../compare/CompareTab';
import { getActiveContrast } from '../data/contrasts';
import { _resetTrackCache } from '../data/loadTrack';
import { _resetBundleCache, _setBundleTransport } from '../data/bundleSource';
import { MULTICONTRAST_DATASET_FIXTURE, MULTICONTRAST_TRACK_FIXTURE } from './fixtures';

// Regression: the Compare tab used to build its popData with NEITHER dataset nor
// contrast — `getPopData(popCache[id])` — and buildPopData's old fallback then
// resolved both to the macaque defaults. On a multi-contrast dataset that meant
// Compare rendered the DEFAULT contrast's DE table while the shell had another
// one selected: a wrong answer that looks like a real one, with no error.
//
// It stayed invisible in production because the contrast selector is hidden in
// compare mode and macaque (single-contrast) is the only dataset with enough
// tracks to reach Compare. This pins the behaviour at the seam instead of
// relying on that coincidence.

const DS = MULTICONTRAST_DATASET_FIXTURE;

// CompareTab loads its own populations (track columns), so the fixture arrives
// through a map-backed bundle transport, exactly as a real bundle would.
beforeEach(() => {
  _resetBundleCache();
  _setBundleTransport(async (url) => (url.endsWith('/track_whole.js')
    ? { status: 'ok', value: MULTICONTRAST_TRACK_FIXTURE }
    : { status: 'load-failed' }));
});

async function renderCompare(contrastId?: string) {
  const view = render(
    <CompareTab
      meta={null}
      dataset={DS}
      contrast={getActiveContrast(DS, contrastId)}
      defaultPops={['whole']}
    />,
  );
  await waitFor(() => expect(screen.queryByText(/Loading whole/)).toBeNull());
  return view;
}

// Type an exact gene symbol and press Enter — GeneSearchBox's Enter path matches
// against the full gene list directly, so it needs no debounce flush.
function selectGene(gene: string) {
  const input = screen.getByPlaceholderText(/Search gene/i);
  fireEvent.change(input, { target: { value: gene } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

// The summary row renders logFC via toFixed(3), so the two contrasts are
// distinguishable by string: IGFBP2 is -1.4 fasted-vs-fed and +0.3 refed-vs-fed.
// Scoped to the summary table — the gene also appears as a selection chip.
function summaryCells(container: HTMLElement): string[] {
  const row = container.querySelector('tbody tr')!;
  return [...row.querySelectorAll('td')].map((td) => td.textContent ?? '');
}

afterEach(() => {
  cleanup();
  _setBundleTransport(null);
  _resetBundleCache();
  _resetTrackCache();
});

describe('CompareTab — renders the contrast it is given', () => {
  it('shows the default contrast DE values when handed the default contrast', async () => {
    const { container } = await renderCompare();
    selectGene('IGFBP2');
    const cells = summaryCells(container);
    expect(cells[0]).toBe('IGFBP2');
    expect(cells).toContain('-1.400');
  });

  it('shows the NON-default contrast DE values when handed that contrast', async () => {
    const { container } = await renderCompare('refed_vs_fed');
    selectGene('IGFBP2');
    const cells = summaryCells(container);
    expect(cells[0]).toBe('IGFBP2');
    expect(cells).toContain('0.300');
    // The old code ignored the contrast entirely and always showed this.
    expect(cells).not.toContain('-1.400');
  });
});
