import { afterEach, describe, it, expect, vi, beforeAll } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { preloadAppViews } from '../appViews';
import { MethodologyView } from '../methodology/MethodologyView';
import { isExplorerTab } from '../explorer/explorerTabs';
import { parseRoute, routeHref } from '../utils/appLinks';

// App's views are separate chunks (src/appViews.tsx); load them first so every
// render below is synchronous.
beforeAll(() => preloadAppViews());

afterEach(() => { cleanup(); window.history.replaceState(null, '', '#/'); });

// ─── Unit: the page renders the missing-pathway explanation ─────────────────────
describe('MethodologyView', () => {
  it('renders the pipeline + missing-pathway explanation', () => {
    render(<MethodologyView onHome={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Methods & statistics' })).toBeTruthy();
    // Core explanation content must actually ship.
    expect(screen.getByRole('heading', { name: /Why some macaque pathways are missing/i })).toBeTruthy();
    expect(screen.getAllByText(/maxSize = 500/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Worked example: GOBP_CELL_CELL_ADHESION/)).toBeTruthy();
  });

  it('lists every section in the contents and states the shared FDR cutoff', () => {
    const { container } = render(<MethodologyView onHome={vi.fn()} />);
    const nav = screen.getByRole('navigation', { name: 'On this page' });
    const sections = container.querySelectorAll('section[id]');
    expect(nav.querySelectorAll('button')).toHaveLength(sections.length);
    for (const s of sections) {
      expect(screen.getByRole('region', { name: s.querySelector('h2')!.textContent! })).toBe(s);
    }
    expect(screen.getByText(/FDR \(or fgsea adjusted P\) is below 0\.05/)).toBeTruthy();
  });

  it('carries the statistics guide that used to be its own page', () => {
    render(<MethodologyView onHome={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Reading the statistics within one study' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Reading results across studies' })).toBeTruthy();
    // The a-priori vs discovery distinction is the whole point of showing both p and FDR.
    expect(screen.getByText(/A-priori vs discovery/)).toBeTruthy();
    // Nothing is pooled across datasets, and the page says why.
    expect(screen.getByText(/Why there is no pooled number/)).toBeTruthy();
    expect(screen.getByText(/A significant-dataset count is a tally/)).toBeTruthy();
    expect(screen.getByText(/The macaque atlas is one study/)).toBeTruthy();
    expect(screen.getByText(/Stars use the raw p-value/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Glossary' })).toBeTruthy();
    // The FDR cutoff is stated once, not in two sections.
    expect(screen.getAllByText(/FDR \(or fgsea adjusted P\) is below 0\.05/)).toHaveLength(1);
  });

  it('renders the worked-example table with dropped clusters', () => {
    render(<MethodologyView onHome={vi.fn()} />);
    // The three clusters that drop the parent term are named (prose + table).
    expect(screen.getAllByText('e9').length).toBeGreaterThan(0);
    expect(screen.getAllByText('i23').length).toBeGreaterThan(0);
    expect(screen.getAllByText('e33').length).toBeGreaterThan(0);
    // Both "kept" and "dropped" outcomes appear in the table.
    expect(screen.getAllByText('dropped').length).toBe(3);
    expect(screen.getAllByText('kept').length).toBe(2);
  });
});

// ─── Routing: a page of its own, not an explorer tab ───────────────────────────
describe('Methodology page routing', () => {
  it('has its own route, and old explorer-tab links open it', () => {
    expect(routeHref({ view: 'methodology' })).toBe('#/methodology');
    expect(parseRoute('#/methodology')).toEqual({ view: 'methodology' });
    expect(parseRoute('#/dataset/macaque_snrna/e9/methodology')).toEqual({ view: 'methodology' });
    // Statistics merged into this page; its old links open it.
    expect(parseRoute('#/statistics')).toEqual({ view: 'methodology' });
    expect(parseRoute('/statistics/')).toEqual({ view: 'methodology' });
    expect(isExplorerTab('methodology')).toBe(false);
  });

  it('opens from the hub footer and returns home', () => {
    window.history.replaceState(null, '', window.location.pathname);
    const { container } = render(<App initialView="hub" />);
    const footer = container.querySelector('nav[aria-label="Reference"]') as HTMLElement;
    const labels = [...footer.querySelectorAll('button, a')].map((node) => node.textContent);
    expect(labels).toContain('Methods & statistics');
    expect(labels).not.toContain('Statistics');
    expect(labels).not.toContain('Sources & acknowledgements');
    fireEvent.click([...footer.querySelectorAll('button')].find((b) => b.textContent === 'Methods & statistics')!);
    expect(container.querySelector('h1')?.textContent).toBe('Methods & statistics');
    fireEvent.click(screen.getByRole('button', { name: /^Home$/ }));
    expect(container.querySelector('h1')?.textContent).not.toBe('Methods & statistics');
  });

  it('opens from the explorer header link, outside the dataset explorer', async () => {
    // No hash: '#/' is the hub route and would override initialView.
    window.history.replaceState(null, '', window.location.pathname);
    const { container } = render(<App initialView="explorer" />);
    // Scoped DOM queries: document-wide role queries are slow on an App mount.
    const tabLabels = [...container.querySelectorAll('button')].map((b) => b.textContent);
    expect(tabLabels).not.toContain('Methodology');
    fireEvent.click(container.querySelector('a[href="#/methodology"]')!);
    await waitFor(() => expect(container.querySelector('h1')?.textContent).toBe('Methods & statistics'));
    expect(container.querySelector('#methods-missing')).toBeTruthy();
  });
});
