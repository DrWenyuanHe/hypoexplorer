import { fireEvent, render, screen, within, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalExplorer } from './LocalExplorer';
import type { LocalDataset, LocalGene } from './types';

const gene = (name: string, padj: number | null = 0.01): LocalGene => ({
  gene: name,
  logFC: 2,
  pvalue: 0.001,
  padj,
  source: 'DE',
});
const fixture: LocalDataset = {
  id: 'first',
  name: 'Experiment one',
  organism: 'Mus musculus',
  createdAt: '',
  updatedAt: '',
  sources: [],
  genes: [gene('Pomc'), gene('Agrp', null)],
  pathways: [
    {
      pathway: 'GO:0001',
      name: 'NEURON_SIGNALING',
      database: 'GO_BP',
      nes: 2,
      pvalue: 0.001,
      padj: 0.01,
      size: 50,
      genes: ['Pomc', 'Npy'],
      source: 'FGSEA',
    },
  ],
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('local explorer', () => {
  it('follows gene → supplied pathway → gene and compares local evidence without network calls', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const other = {
      ...fixture,
      id: 'other',
      name: 'Experiment two',
      genes: [gene('Pomc', 0.5)],
      pathways: [],
    };
    render(
      <LocalExplorer datasets={[fixture, other]} activeId="first" onSelectDataset={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pomc' }));
    const detail = screen.getByRole('region', { name: 'Selected local result' });
    expect(within(detail).getByText('Linked pathways')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Cross-dataset local evidence' })).getByText(
        'Below cutoff',
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole('button', { name: /NEURON SIGNALING/ }));
    expect(within(detail).getByText('Supplied genes')).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole('button', { name: 'Npy' }));
    expect(within(detail).getByText('Not in imported table')).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: /NEURON SIGNALING/ })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
  });

  it('keeps genes with missing adjusted P visible until passing-only is selected', () => {
    render(<LocalExplorer datasets={[fixture]} activeId="first" onSelectDataset={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Agrp' })).toBeInTheDocument();
    expect(screen.getByText('Adjusted P unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Passing only' }));
    expect(screen.queryByRole('button', { name: 'Agrp' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pomc' })).toBeInTheDocument();
  });

  it('connects pathway members to gene statistics when symbol letter case differs', () => {
    const formatted = {
      ...fixture,
      pathways: fixture.pathways.map((p) => ({ ...p, genes: ['pomc'] })),
    };
    render(<LocalExplorer datasets={[formatted]} activeId="first" onSelectDataset={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pomc' }));
    const detail = screen.getByRole('region', { name: 'Selected local result' });
    fireEvent.click(within(detail).getByRole('button', { name: /NEURON SIGNALING/ }));
    fireEvent.click(within(detail).getByRole('button', { name: 'pomc' }));
    expect(within(detail).getByText('+2.000')).toBeInTheDocument();
    expect(within(detail).getByText('Up')).toBeInTheDocument();
  });

  it('paginates large result tables and resets the page on search', () => {
    const many = {
      ...fixture,
      genes: Array.from({ length: 53 }, (_, i) => gene(`Gene${i.toString().padStart(2, '0')}`)),
    };
    render(<LocalExplorer datasets={[many]} activeId="first" onSelectDataset={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Gene25' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next results page' }));
    expect(screen.getByRole('button', { name: 'Gene25' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search local genes' }), {
      target: { value: 'Gene52' },
    });
    expect(screen.getByRole('button', { name: 'Gene52' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next results page' })).toBeDisabled();
  });
});
