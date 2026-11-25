import { useState } from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
    // The key line in the plot's top margin counts the selection.
    expect(document.querySelector('.gx-legend')?.textContent).toContain('◆ 1 selected');
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
      // The pass count still includes the selected gene, and its menu shows the list.
      fireEvent.click(screen.getByRole('button', { name: '2 pass' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Show list' }));
      expect(screen.getByRole('button', { name: 'Pomc ✓' })).toBeTruthy();
      expect(screen.getByText('↑ Up in Case (1)')).toBeTruthy();
    } finally { spy.mockRestore(); }
  });
});

// Selecting a gene changes the layout above the plot, so the plot can move out
// from under a pointer that has not moved.
describe('VolcanoPlot — the clicked point', () => {
  // The single point sits at (319, 45) of the SVG's initial 600×360 view, and
  // the SVG's own top-left is (0, 0) in jsdom.
  const AT = { clientX: 319, clientY: 45 };
  const POMC = [point('Pomc', 0, 0.001, 0.01)];
  const plot = () => screen.getByRole('img', { name: /Volcano plot/ });
  const tooltipBox = () => plot().querySelector('g > rect');
  const tooltipTop = () => Number(tooltipBox()?.getAttribute('y'));
  // jsdom has no PointerEvent, and Testing Library's fallback carries no coordinates.
  const pointer = (type: 'pointermove' | 'pointerdown', target: Element, at: typeof AT) =>
    fireEvent(target, new MouseEvent(type, { bubbles: true, ...at }));

  afterEach(() => vi.restoreAllMocks());

  function Host({ popData = dataFor(POMC), volcano = stubVolcanoView() }: { popData?: PopData; volcano?: ReturnType<typeof stubVolcanoView> }) {
    const [selected, setSelected] = useState<string[]>([]);
    return <VolcanoPlot selectedGenes={selected} volcano={volcano} popData={popData}
      onAddGene={(gene) => setSelected((genes) => (genes.includes(gene) ? genes : [...genes, gene]))}
      toolbarBelow={selected.length > 0 && <div data-testid="strip">{selected.length}</div>} />;
  }

  /** The strip pushes the plot down by `by` px; where the page scrolled comes back. */
  function shiftPlotBy(by: number) {
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, screen.queryByTestId('strip') ? by : 0, 600, 360),
    );
    return vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  }

  it('scrolls the page by as much as the selection moved the plot, and only then', () => {
    const scrollBy = shiftPlotBy(104);
    render(<Host />);
    fireEvent.click(plot(), { clientX: 319, clientY: 280 });
    expect(scrollBy).not.toHaveBeenCalled();
    fireEvent.click(plot(), AT);
    expect(scrollBy.mock.calls).toEqual([[{ top: 104, behavior: 'instant' }]]);
    // Selecting the same gene again moves nothing.
    fireEvent.click(plot(), { clientX: 319, clientY: 149 });
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it('keeps its tooltip when the plot moves under a pointer that has not', () => {
    render(<Host />);
    fireEvent.click(plot(), AT);
    expect(tooltipBox()).not.toBeNull();
    expect(plot()).toHaveTextContent('◆ Selected');
    // What the browser may report once the layout has changed: a move at the
    // click's own place, now over another part of the plot, and a leave at
    // wherever its mouse last was.
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 104, 600, 360));
    fireEvent.mouseMove(plot(), AT);
    pointer('pointermove', document.body, AT);
    fireEvent.mouseLeave(plot(), { clientX: 5, clientY: 5 });
    expect(tooltipBox()).not.toBeNull();
  });

  it('closes its tooltip at the next real move or press outside the plot', () => {
    render(<Host />);
    fireEvent.click(plot(), AT);
    pointer('pointermove', document.body, { clientX: 319, clientY: 20 });
    expect(tooltipBox()).toBeNull();

    fireEvent.click(plot(), AT);
    pointer('pointerdown', screen.getByTestId('strip'), AT);
    expect(tooltipBox()).toBeNull();
  });

  it('follows the pointer again once it moves inside the plot', () => {
    render(<Host />);
    fireEvent.click(plot(), AT);
    // Still on the point, so the tooltip stays, and a leave closes it as on hover.
    fireEvent.mouseMove(plot(), { clientX: 321, clientY: 45 });
    expect(tooltipBox()).not.toBeNull();
    fireEvent.mouseLeave(plot(), { clientX: 319, clientY: -5 });
    expect(tooltipBox()).toBeNull();
  });

  it('moves its tooltip with the point when the plot resizes or changes statistic', () => {
    const observers: Array<{ target: Element; notify: ResizeObserverCallback }> = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(private readonly notify: ResizeObserverCallback) {}
      observe(target: Element) { observers.push({ target, notify: this.notify }); }
      unobserve() {}
      disconnect() {}
    });
    try {
      const points = [...POMC, point('Agrp', -3, 1e-6, 1e-4)];
      const view = render(<Host popData={dataFor(points)} />);
      // Pomc, at half of Agrp's height.
      fireEvent.click(plot(), { clientX: 319, clientY: 178 });
      expect(plot()).toHaveTextContent('Pomc');
      const top = tooltipTop();
      const resize = observers.find(({ target }) => target.classList.contains('volcano-canvas'));
      act(() => resize?.notify([{ contentRect: { width: 600, height: 260 } } as ResizeObserverEntry], {} as ResizeObserver));
      // The 100px come off the plot's height, and the point sits 54% of the way down it.
      expect(tooltipTop()).toBeCloseTo(top - 100 * (1 - 0.5 / 1.08), 5);
      view.rerender(<Host popData={dataFor(points)} volcano={stubVolcanoView({ metric: 'fdr' })} />);
      expect(tooltipBox()).not.toBeNull();
      expect(tooltipTop()).not.toBeCloseTo(top, 0);
    } finally { vi.unstubAllGlobals(); }
  });

  it('closes its tooltip when the data changes, not when the same points are rebuilt', () => {
    const view = render(<Host popData={dataFor(POMC)} />);
    fireEvent.click(plot(), AT);
    view.rerender(<Host popData={dataFor([{ ...POMC[0] }])} />);
    expect(tooltipBox()).not.toBeNull();
    view.rerender(<Host popData={dataFor([point('Pomc', 0, 0.002, 0.01)])} />);
    expect(tooltipBox()).toBeNull();
  });
});
