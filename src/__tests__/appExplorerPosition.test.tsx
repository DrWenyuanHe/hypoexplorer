import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

// The explorer position's rules as the user meets them in the mounted app. The
// transition table itself is pinned in explorerPosition.test.ts; these check
// that the shell routes its real controls through it.

const activeTab = () => document.querySelector('.tab-btn--active')?.textContent;

describe('App — explorer position', () => {
  it('the hub "Quality control" link opens QC even when Compare was showing', async () => {
    render(<App initialView="explorer" />);
    fireEvent.click(screen.getByRole('button', { name: /Compare all cells/i }));
    await screen.findByRole('button', { name: /Back to single cell/i });

    fireEvent.click(screen.getByRole('link', { name: /HypoExplorer home/i }));
    await screen.findByRole('search', { name: 'Search genes and pathways' });
    fireEvent.click(screen.getByRole('button', { name: 'Quality control' }));

    // Before: the tab was set underneath Compare, which kept rendering.
    await waitFor(() => expect(activeTab()).toBe('Quality Control'));
    expect(screen.queryByRole('button', { name: /Back to single cell/i })).toBeNull();
  });

  it('a fresh Compare link to another dataset compares that dataset\'s own populations', async () => {
    // The link lands in the same render as the dataset switch, before the
    // store has this dataset's meta. Compare used to mount then and take the
    // macaque pair e9/i23, which the study does not have, as its selection.
    (window as any).HX_GSE262407_META = {
      populations: ['arcuate', 'vmh', 'dmh'],
      labels: { arcuate: 'Arcuate', vmh: 'VMH', dmh: 'DMH' },
      types: { arcuate: 'Region', vmh: 'Region', dmh: 'Region' },
      nGenes: { arcuate: 2, vmh: 2, dmh: 2 },
    };
    window.history.replaceState(null, '', '/#/dataset/gse262407/compare');
    try {
      render(<App />);
      await screen.findByRole('button', { name: /Back to single cell/i });
      await waitFor(() => expect(document.body.textContent).toMatch(/arcuate, vmh/));
      expect(document.body.textContent).not.toMatch(/\be9\b|\bi23\b/);
    } finally {
      delete (window as any).HX_GSE262407_META;
      window.history.replaceState(null, '', '/');
    }
  });

  it('leaving Compare returns to the tab it was entered from', async () => {
    render(<App initialView="explorer" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pathway Explorer' }));
    await waitFor(() => expect(activeTab()).toBe('Pathway Explorer'));

    fireEvent.click(screen.getByRole('button', { name: /Compare all cells/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Back to single cell/i }));

    await waitFor(() => expect(activeTab()).toBe('Pathway Explorer'));
  });
});
