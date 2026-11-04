import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PathwayExplorerTab } from '../pathway-explorer/PathwayExplorerTab';
import { buildPopData } from '../data/buildPopData';
import { POP_E9_FIXTURE, MACAQUE_DATASET, MACAQUE_CONTRAST } from './fixtures';
import type { PathwayRecordWithDb } from '../types';
import { usePathwayView } from '../explorer/explorerSession';

// PathwayExplorerTab is a controlled component (search/DB/FDR/sort live in App).
// A small stateful harness lets us drive the filter + sort controls and observe
// the rendered table. The POP_E9 fixture has 8 pathways across the 4 DBs, with
// GOBP_NEURON_DIFFERENTIATION the strongest by |NES| and lowest by padj.
const popData = buildPopData(POP_E9_FIXTURE, MACAQUE_DATASET, MACAQUE_CONTRAST)!;

function Harness() {
  // The REAL slice, not a stub — its defaults (all DBs on, FDR 1.0, sort 'nes')
  // are the ones App opens with, so the harness cannot drift from production.
  const pathway = usePathwayView<PathwayRecordWithDb>();
  return <PathwayExplorerTab pathway={pathway} popData={popData} />;
}

const firstRow = (container: HTMLElement) => container.querySelector('tbody tr')?.textContent ?? '';

describe('PathwayExplorerTab — filters', () => {
  it('drops a database\'s pathways when its toggle is unchecked', () => {
    render(<Harness />);
    expect(screen.getByText('(8 total)')).toBeTruthy();
    // HALLMARK contributes 2 pathways.
    fireEvent.click(screen.getByRole('checkbox', { name: 'HALLMARK' }));
    expect(screen.getByText('(6 total)')).toBeTruthy();
  });

  it('filters by the FDR (padj) threshold slider', () => {
    const { container } = render(<Harness />);
    expect(screen.getByText('(8 total)')).toBeTruthy();
    const slider = container.querySelector('input[type="range"]')!;
    fireEvent.change(slider, { target: { value: '0.1' } });
    // padj ≤ 0.10 keeps GOBP_NEURON_DIFFERENTIATION (0.05), HALLMARK_INFLAMMATORY (0.06), KEGG_INSULIN (0.10).
    expect(screen.getByText('(3 total)')).toBeTruthy();
  });
});

describe('PathwayExplorerTab — sorting', () => {
  it('reorders rows by the sort buttons and column headers', () => {
    const { container } = render(<Harness />);
    // Default sort = By Magnitude (|NES| desc).
    expect(firstRow(container)).toMatch(/GOBP_NEURON_DIFFERENTIATION/);

    fireEvent.click(screen.getByRole('button', { name: 'Alphabetical' }));
    expect(firstRow(container)).toMatch(/GOBP_APOPTOSIS/);

    // Clicking the FDR column header sorts by padj ascending.
    const thead = container.querySelector('thead')!;
    fireEvent.click(within(thead).getByText('FDR'));
    expect(firstRow(container)).toMatch(/GOBP_NEURON_DIFFERENTIATION/);
  });
});
