import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';
import { DataSourcesTab } from '../acknowledgements/DataSourcesTab';

// ─── Unit: the component renders the source citation + reference table ───────────
describe('DataSourcesTab', () => {
  it('credits the source macaque dataset with a resolvable DOI', () => {
    render(<DataSourcesTab />);
    expect(screen.getByText('Data sources & acknowledgements')).toBeTruthy();
    expect(
      screen.getByText(/Region-specific transcriptomic responses to obesity and diabetes/i),
    ).toBeTruthy();
    // The Cell Metab DOI link is present and points at doi.org.
    const doi = screen.getByText('doi:10.1016/j.cmet.2024.01.003');
    expect(doi.getAttribute('href')).toBe('https://doi.org/10.1016/j.cmet.2024.01.003');
  });

  it('lists the analysis software and gene-set databases', () => {
    render(<DataSourcesTab />);
    expect(screen.getAllByText('edgeR').length).toBeGreaterThan(0);
    expect(screen.getAllByText('fgsea').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reactome').length).toBeGreaterThan(0);
    expect(screen.getAllByText('KEGG').length).toBeGreaterThan(0);
  });
});

// ─── Integration: tab is wired into App and switchable ──────────────────────────
describe('Data Sources tab in App', () => {
  it('clicking the Data Sources tab shows the source citation', () => {
    render(<App initialView="explorer" />);
    fireEvent.click(screen.getByRole('button', { name: /^Data Sources$/ }));
    expect(
      screen.getByText(/Region-specific transcriptomic responses to obesity and diabetes/i),
    ).toBeTruthy();
  });
});
