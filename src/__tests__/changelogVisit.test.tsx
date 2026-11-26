import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { preloadAppViews } from '../appViews';

// The changelog replaces the explorer's content while it is open. It belongs
// to one visit: leaving the explorer closes it, so entering again (from the
// hub's tool links, a report row, Back) shows the explorer, not release notes
// opened on an earlier visit. The hub's own Changelog link still opens it.

beforeAll(() => preloadAppViews());

const changelogShown = () => screen.queryByText(/Release notes\. Features and dataset counts/i) !== null;
const activeTab = () => document.querySelector('.tab-btn--active')?.textContent;

/** Follow a link in the open tab, as the address bar or a pasted link does. */
const follow = (url: string) => act(async () => {
  window.history.pushState(null, '', url);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
});

afterEach(() => { window.history.replaceState(null, '', '/'); });

async function goHome() {
  fireEvent.click(screen.getByRole('link', { name: /HypoExplorer home/i }));
  await screen.findByRole('search', { name: 'Search genes and pathways' });
}

describe('App — the changelog belongs to one visit to the explorer', () => {
  it('is closed when the explorer is entered again after leaving with it open', async () => {
    render(<App initialView="explorer" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Changelog' }));
    await waitFor(() => expect(changelogShown()).toBe(true));

    await goHome();
    fireEvent.click(screen.getByRole('button', { name: 'Quality control' }));

    await waitFor(() => expect(activeTab()).toBe('Quality Control'));
    expect(changelogShown()).toBe(false);
  });

  it('is closed when a refused link replaces the explorer and a valid one follows', async () => {
    // A refusal shows its error page while the router's view stays on the
    // explorer, so this visit ends without the view changing.
    render(<App initialView="explorer" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Changelog' }));
    await waitFor(() => expect(changelogShown()).toBe(true));

    await follow('/#/dataset/macaque_snrna/compare?analysis=%7Bbroken');
    await screen.findByRole('heading', { name: /Analysis link unavailable/i });
    await follow('/#/dataset/macaque_snrna/e9/qc');

    await waitFor(() => expect(activeTab()).toBe('Quality Control'));
    expect(changelogShown()).toBe(false);
  });

  it('still opens from the hub\'s Changelog link', async () => {
    render(<App />);
    await screen.findByRole('search', { name: 'Search genes and pathways' });
    fireEvent.click(screen.getByRole('button', { name: 'Changelog' }));
    await waitFor(() => expect(changelogShown()).toBe(true));
  });
});
