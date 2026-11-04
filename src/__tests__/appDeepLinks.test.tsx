import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { _resetTrackCache } from '../data/loadTrack';
import { _resetDatasetMetaCache } from '../data/loadDatasetMeta';
import { BULK_TRACK_FIXTURE } from './fixtures';

// `#/dataset/<id>[/<trackId>]` deep links — the hrefs the cross-dataset report
// puts on every dataset and track. The hash is untrusted input (hand-typed,
// stale, from an older deploy), so the routes must degrade rather than land the
// app on a track that doesn't exist.

function seedMouseDataset() {
  (window as any).HX_MOUSE_HYPO_HFD_GSE220533_META = {
    populations: ['whole'],
    labels: { whole: 'Whole hypothalamus' },
    types: { whole: 'Whole tissue' },
    qcFlags: { whole: { nNormal: 7, nObese: 8, is3v3: false } },
    nGenes: { whole: 2 },
  };
  (window as any).HX_MOUSE_HYPO_HFD_GSE220533_WHOLE = BULK_TRACK_FIXTURE;
}

afterEach(() => {
  window.location.hash = '';
  delete (window as any).HX_MOUSE_HYPO_HFD_GSE220533_META;
  delete (window as any).HX_MOUSE_HYPO_HFD_GSE220533_WHOLE;
  _resetTrackCache();
  _resetDatasetMetaCache();
});

describe('App — dataset deep links', () => {
  it('opens the named dataset at the named track', async () => {
    seedMouseDataset();
    window.location.hash = '#/dataset/mouse_hypo_hfd_gse220533/whole';
    render(<App />);
    // The active dataset is named by the topbar crumb, which is now a button
    // into the dataset library rather than a <select> of every dataset.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Active dataset: Mouse whole hypothalamus/i })).toBeTruthy();
    });
    expect(screen.queryByText(/Failed to load/i)).toBeNull();
  });

  it('degrades a track the dataset does not have to its default track', async () => {
    window.location.hash = '#/dataset/macaque_snrna/not_a_real_track';
    const { container } = render(<App />);
    // Explorer opens on the macaque default track (e9), not on the bogus one.
    await waitFor(() => expect(container.textContent).toContain('e9'));
    expect(container.textContent).not.toContain('not_a_real_track');
    expect(screen.queryByText(/Failed to load/i)).toBeNull();
  });

  it('ignores an unknown dataset and stays on the hub', async () => {
    window.location.hash = '#/dataset/no_such_dataset';
    render(<App />);
    // The hub is identified by its search box, which no other view draws.
    expect(await screen.findByRole('search', { name: 'Search genes and pathways' })).toBeTruthy();
  });
});
