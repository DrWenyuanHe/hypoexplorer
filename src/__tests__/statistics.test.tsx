import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';
import { StatisticsView } from '../statistics/StatisticsView';

// ─── Unit: the explainer renders both statistical layers + glossary ─────────────
describe('StatisticsView', () => {
  it('renders both scopes, the no-pooling statement, and key definitions', () => {
    render(<StatisticsView onHome={() => {}} />);
    expect(screen.getByText('Statistics in HypoExplorer')).toBeTruthy();
    expect(screen.getByText(/Within a single dataset/)).toBeTruthy();
    expect(screen.getByText(/Across many datasets/)).toBeTruthy();
    // The a-priori vs discovery distinction is the whole point of showing both.
    expect(screen.getByText(/A-priori vs discovery/)).toBeTruthy();
    // The page must state that nothing is pooled across datasets, and why.
    expect(screen.getByText(/Why there is no pooled number/)).toBeTruthy();
    expect(screen.getByText(/A significant-dataset count is a tally/)).toBeTruthy();
    expect(screen.getByText(/The macaque atlas is one study/)).toBeTruthy();
    // Glossary present.
    expect(screen.getByText('Glossary')).toBeTruthy();
  });

  it('fires onHome from the nav', () => {
    const onHome = vi.fn();
    render(<StatisticsView onHome={onHome} />);
    fireEvent.click(screen.getByRole('button', { name: /^Home$/ }));
    expect(onHome).toHaveBeenCalled();
  });
});

// ─── Integration: reachable from the hub and back ───────────────────────────────
describe('Statistics view in App', () => {
  it('opens from the hub Statistics link and returns home', () => {
    render(<App initialView="hub" />);
    fireEvent.click(screen.getByRole('button', { name: /^Statistics$/ }));
    expect(screen.getByText('Statistics in HypoExplorer')).toBeTruthy();
    // Back to the hub.
    fireEvent.click(screen.getByRole('button', { name: /^Home$/ }));
    expect(screen.queryByText('Statistics in HypoExplorer')).toBeNull();
  });
});
