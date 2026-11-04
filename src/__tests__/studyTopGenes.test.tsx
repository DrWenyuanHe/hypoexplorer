import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { TopGenes } from '../library/StudyVolcano';
import type { VolcanoView } from '../explorer/explorerSession';
import type { PopData, VolcanoPoint } from '../types';

// The study record's top-gene panel: the lists, the gene search and the pass
// list's download. The record's volcano needs a track bundle, which jsdom never
// receives, so the panel is exercised here on a small hand-made table.

const pt = (gene: string, logfc: number, fdr: number, pval = fdr / 10): VolcanoPoint => ({
  gene, logfc, pval, fdr, yPval: -Math.log10(pval), yFdr: -Math.log10(fdr),
});

const POINTS: VolcanoPoint[] = [
  pt('Nr6a1', 2.3, 0.0005),
  pt('Hsph1', 2.0, 0.0006),
  pt('Aldh3a1', -7.4, 0.00005),
  pt('Gapdh', -0.9, 0.091),
];

const popData = {
  volcanoPts: POINTS,
  geneNames: POINTS.map((p) => p.gene),
  deByGene: Object.fromEntries(POINTS.map((p) => [p.gene, { gene: p.gene, logFC: p.logfc, PValue: p.pval, FDR: p.fdr }])),
} as unknown as PopData;

const fdr05: VolcanoView = {
  metric: 'fdr', selectMetric: vi.fn(),
  logFCThresh: 0, setLogFCThresh: vi.fn(),
  sigThresh: -Math.log10(0.05), setSigThresh: vi.fn(),
};

function renderPanel() {
  const onSelect = vi.fn();
  const onToggle = vi.fn();
  render(
    <TopGenes popData={popData} volcano={fdr05} caseLabel="Palmitate" fileStem="test"
      selected={[]} onToggle={onToggle} onSelect={onSelect} />,
  );
  return { panel: within(screen.getByRole('complementary', { name: 'Top genes' })), onSelect, onToggle };
}

describe('Study record top genes', () => {
  it('lists the passing genes each way, and only those', () => {
    const { panel } = renderPanel();
    expect(panel.getByText('Up in Palmitate')).toBeTruthy();
    expect(panel.getByRole('button', { name: /^Nr6a1/ })).toBeTruthy();
    expect(panel.getByRole('button', { name: /^Aldh3a1/ })).toBeTruthy();
    // FDR 0.091 fails the cutoff, so it is not a top gene.
    expect(panel.queryByRole('button', { name: /^Gapdh/ })).toBeNull();
    expect(panel.getByText('3 passing')).toBeTruthy();
    expect(panel.getByRole('button', { name: /Download all/ })).not.toBeDisabled();
  });

  it('finds a gene case-insensitively and says whether it passes', () => {
    const { panel, onSelect } = renderPanel();
    const input = panel.getByRole('searchbox', { name: 'Find a gene in this study' });
    fireEvent.change(input, { target: { value: 'nr6a1' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(onSelect).toHaveBeenCalledWith('Nr6a1');
    expect(panel.getByText(/Up/, { selector: 'span' })).toBeTruthy();
    expect(panel.getByText(/in Palmitate at FDR/)).toBeTruthy();
  });

  it('tells "tested but not passing" apart from "not tested"', () => {
    const { panel, onSelect } = renderPanel();
    const input = panel.getByRole('searchbox', { name: 'Find a gene in this study' });

    fireEvent.change(input, { target: { value: 'GAPDH' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(panel.getByText(/Tested, but does not pass/)).toBeTruthy();
    expect(onSelect).toHaveBeenLastCalledWith('Gapdh');

    fireEvent.change(input, { target: { value: 'Pomc' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    // Absent from the table is not "not significant": there is no statistic.
    expect(panel.getByText(/is not in this track's results/)).toBeTruthy();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('suggests symbols as the reader types', () => {
    const { panel, onSelect } = renderPanel();
    fireEvent.change(panel.getByRole('searchbox', { name: 'Find a gene in this study' }), { target: { value: 'hs' } });
    fireEvent.click(panel.getByRole('button', { name: 'Hsph1' }));
    expect(onSelect).toHaveBeenCalledWith('Hsph1');
  });
});
