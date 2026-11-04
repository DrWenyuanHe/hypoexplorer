import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { VolcanoPlot } from '../gene-explorer/VolcanoPlot';
import { stubVolcanoView } from './fixtures';
import type { PopData, VolcanoPoint } from '../types';
import { DOWN_COLOR, UP_COLOR } from '../styles/constants';

// Minimal props; only popData.volcanoPts / deByGene matter for these cases.
const noop = () => {};
function renderVolcano(popData: any) {
  return render(
    <VolcanoPlot
      selectedGenes={[]}
      volcano={stubVolcanoView()}
      onAddGene={noop}
      onAddGenes={noop}
      popData={popData}
    />,
  );
}

describe('VolcanoPlot — empty state', () => {
  it('shows an empty-state message when there are no points to plot', () => {
    renderVolcano({ volcanoPts: [], deByGene: {} });
    expect(screen.getByText(/No differential-expression results to plot/i)).toBeTruthy();
    // The plot itself is not rendered.
    expect(screen.queryByRole('img', { name: /Volcano plot/i })).toBeNull();
  });

  it('renders the plot (not the empty state) when points exist', () => {
    renderVolcano({
      volcanoPts: [{ gene: 'POMC', logfc: 1.2, pval: 0.001, fdr: 0.02, yPval: 3, yFdr: 1.7 }],
      deByGene: { POMC: { gene: 'POMC', logFC: 1.2, PValue: 0.001, FDR: 0.02 } },
    });
    expect(screen.queryByText(/No differential-expression results to plot/i)).toBeNull();
    expect(screen.getByRole('img', { name: /Volcano plot/i })).toBeTruthy();
  });
});

function point(gene: string, logfc: number, pval: number, fdr: number | null): VolcanoPoint {
  return { gene, logfc, pval, fdr, yPval: -Math.log10(pval), yFdr: fdr == null ? 0 : -Math.log10(fdr) };
}

const points = [
  point('Pomc', 2, 0.001, 0.01),
  point('Agrp', -3, 0.0001, 0.2),
  point('Npy', 10, 0.3, null),
  point('Lepr', -0.1, 0.2, 0.3),
];

function dataFor(volcanoPts = points): PopData {
  return {
    volcanoPts,
    deByGene: Object.fromEntries(volcanoPts.map((p) => [p.gene, { gene: p.gene, logFC: p.logfc, PValue: p.pval, FDR: p.fdr }])),
  } as PopData;
}

function tableGenes() {
  return within(screen.getByRole('table', { name: 'Volcano gene results' })).getAllByRole('row').slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent);
}

function openTable() { fireEvent.click(screen.getByRole('button', { name: 'Table' })); }

describe('VolcanoPlot — table view', () => {
  it('includes every plotted gene, with sortable signed effects and missing FDR last in both directions', () => {
    renderVolcano(dataFor());
    openTable();
    expect(screen.queryByRole('img', { name: /Volcano plot/ })).toBeNull();
    expect(tableGenes()).toEqual(['Agrp', 'Pomc', 'Lepr', 'Npy']);
    fireEvent.click(screen.getByRole('button', { name: 'log₂FC' }));
    expect(tableGenes()).toEqual(['Agrp', 'Lepr', 'Pomc', 'Npy']);
    fireEvent.click(screen.getByRole('button', { name: 'log₂FC' }));
    expect(tableGenes()).toEqual(['Npy', 'Pomc', 'Lepr', 'Agrp']);
    const table = screen.getByRole('table', { name: 'Volcano gene results' });
    fireEvent.click(within(table).getByRole('button', { name: 'FDR' }));
    expect(tableGenes()).toEqual(['Pomc', 'Agrp', 'Lepr', 'Npy']);
    fireEvent.click(within(table).getByRole('button', { name: 'FDR' }));
    expect(tableGenes()).toEqual(['Lepr', 'Agrp', 'Pomc', 'Npy']);
    expect(within(table).getByRole('columnheader', { name: 'FDR' })).toHaveAttribute('aria-sort', 'descending');
  });

  it('combines case-insensitive search with current threshold and direction filters', () => {
    renderVolcano(dataFor());
    openTable();
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter volcano genes' }), { target: { value: 'passing' } });
    expect(tableGenes()).toEqual(['Agrp', 'Pomc']);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '  pOM  ' } });
    expect(tableGenes()).toEqual(['Pomc']);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'down' } });
    expect(screen.getByText('No genes match these filters.')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    expect(tableGenes()).toEqual(['Agrp']);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'up' } });
    expect(tableGenes()).toEqual(['Pomc']);
  });

  it('updates the passing list when the metric or contrast data changes', () => {
    const props = { selectedGenes: [], onAddGene: noop, onAddGenes: noop, popData: dataFor(), volcano: stubVolcanoView() };
    const view = render(<VolcanoPlot {...props} />);
    openTable();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'passing' } });
    expect(tableGenes()).toEqual(['Agrp', 'Pomc']);
    view.rerender(<VolcanoPlot {...props} volcano={stubVolcanoView({ metric: 'fdr', sigThresh: -Math.log10(0.05) })} />);
    expect(tableGenes()).toEqual(['Pomc']);
    view.rerender(<VolcanoPlot {...props} popData={dataFor([point('NewContrastGene', -1, 0.001, 0.01)])} />);
    expect(tableGenes()).toEqual(['NewContrastGene']);
  });

  it('adds a gene from any row, marks the selection and keeps it in the threshold results', () => {
    const onAdd = vi.fn();
    function Selection() {
      const [selected, setSelected] = useState<string[]>([]);
      return <VolcanoPlot selectedGenes={selected} volcano={stubVolcanoView()} popData={dataFor()}
        onAddGene={(gene) => { onAdd(gene); setSelected((genes) => [...genes, gene]); }} />;
    }
    render(<Selection />);
    openTable();
    fireEvent.click(screen.getByRole('button', { name: 'Add Pomc' }));
    expect(onAdd).toHaveBeenCalledWith('Pomc');
    expect(screen.getByRole('button', { name: 'Pomc selected' })).toBeDisabled();
    expect(screen.getByText('◆ Selected (1)')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'selected' } });
    expect(tableGenes()).toEqual(['Pomc']);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'passing' } });
    expect(tableGenes()).toEqual(['Agrp', 'Pomc']);
    fireEvent.click(screen.getByRole('button', { name: 'Plot' }));
    expect(screen.getByRole('img', { name: /Volcano plot/ })).toHaveAttribute('aria-description', expect.stringContaining('purple diamonds'));
  });

  it('sorts the full data before paging, then returns to the first page when searching', () => {
    const manyPoints = Array.from({ length: 120 }, (_, i) => point(`Gene${String(i + 1).padStart(3, '0')}`, i + 1, 0.01, 0.02));
    renderVolcano(dataFor(manyPoints));
    openTable();
    expect(tableGenes()).toHaveLength(50);
    fireEvent.click(screen.getByRole('button', { name: 'Next gene page' }));
    expect(tableGenes()[0]).toBe('Gene051');
    fireEvent.click(screen.getByRole('button', { name: 'log₂FC' }));
    fireEvent.click(screen.getByRole('button', { name: 'log₂FC' }));
    expect(tableGenes()[0]).toBe('Gene120');
    fireEvent.click(screen.getByRole('button', { name: 'Next gene page' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Gene001' } });
    expect(tableGenes()).toEqual(['Gene001']);
    expect(screen.getByText('Page 1 of 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next gene page' })).toBeDisabled();
  });

  it('keeps the current page when a gene is selected from a later page', () => {
    const manyPoints = Array.from({ length: 60 }, (_, i) => point(`Gene${String(i + 1).padStart(3, '0')}`, i + 1, 0.01, 0.02));
    const popData = dataFor(manyPoints);
    function Selection() {
      const [selected, setSelected] = useState<string[]>([]);
      return <VolcanoPlot selectedGenes={selected} volcano={stubVolcanoView()} popData={popData}
        onAddGene={(gene) => setSelected((genes) => [...genes, gene])} />;
    }
    render(<Selection />);
    openTable();
    fireEvent.click(screen.getByRole('button', { name: 'Next gene page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Gene051' }));
    expect(screen.getByText('Page 2 of 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Gene051 selected' })).toBeDisabled();
  });
});

describe('VolcanoPlot — selected markers', () => {
  it('selects a point from a tap without prior hover, and ignores a later tap on empty space', () => {
    const add = vi.fn();
    render(<VolcanoPlot selectedGenes={[]} volcano={stubVolcanoView()}
      popData={dataFor([point('Pomc', 0, 0.001, 0.01)])} onAddGene={add} />);
    const plot = screen.getByRole('img', { name: /Volcano plot/ });
    // The single point is centered on x=0; the SVG's initial 600×360 view
    // places it at (319, 45), including margins and the padded y domain.
    fireEvent.click(plot, { clientX: 319, clientY: 45 });
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith('Pomc');
    fireEvent.click(plot, { clientX: 319, clientY: 280 });
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('draws selection with a different color and shape while preserving the passing count', () => {
    const fills: { color: string; shape: string }[] = [];
    let shape = '';
    const context = {
      fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
      setTransform: noop, clearRect: noop, beginPath: () => { shape = ''; },
      arc: () => { shape = 'circle'; }, moveTo: () => { shape = 'diamond'; }, lineTo: noop,
      closePath: noop, stroke: noop,
      fill() { fills.push({ color: this.fillStyle, shape }); },
    };
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    try {
      render(<VolcanoPlot selectedGenes={['Pomc']} volcano={stubVolcanoView()} onAddGene={noop} popData={dataFor()} />);
      expect(fills.some((fill) => fill.shape === 'circle' && fill.color === DOWN_COLOR)).toBe(true);
      const selected = fills.find((fill) => fill.shape === 'diamond');
      expect(selected).toBeDefined();
      expect(selected?.color).not.toBe(UP_COLOR);
      expect(selected?.color).not.toBe(DOWN_COLOR);
      expect(selected?.color).not.toBe('#F28E2B');
      fireEvent.click(screen.getByRole('button', { name: 'Show list' }));
      expect(screen.getByRole('button', { name: 'Pomc ✓' })).toBeTruthy();
      expect(screen.getByText('↑ Up in Case (1)')).toBeTruthy();
    } finally { spy.mockRestore(); }
  });
});
