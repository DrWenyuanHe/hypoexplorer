import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { preloadAppViews } from '../appViews';

// The changelog replaces the explorer's content while it is open. It belongs
// to one visit: leaving the explorer closes it, so entering again (from the
// hub's tool links, a report row, Back) shows the explorer, not release notes
// opened on an earlier visit. The hub's own Changelog link still opens it.

beforeAll(() => preloadAppViews());

const changelogShown = () => screen.queryByText(/Release notes\. Features and dataset counts/i) !== null;
const activeTab = () => document.querySelector('.tab-btn--active')?.textContent;

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

  it('still opens from the hub\'s Changelog link', async () => {
    render(<App />);
    await screen.findByRole('search', { name: 'Search genes and pathways' });
    fireEvent.click(screen.getByRole('button', { name: 'Changelog' }));
    await waitFor(() => expect(changelogShown()).toBe(true));
  });
});
