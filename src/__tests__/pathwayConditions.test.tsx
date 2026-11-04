import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PathwayDetailPanel } from '../pathway-explorer/PathwayDetailPanel';
import { pathwayDetailSheets } from '../pathway-explorer/pathwayExport';
import type { ChartComparison } from '../gene-explorer/BarSEMChart';
import type { ContrastSlice } from '../gene-explorer/ContrastMatrix';
import type { Group, PathwayRecordWithDb, ResolvedContrast } from '../types';
import { makePopData } from './fixtures';

vi.mock('../gene-explorer/BarSEMChart', () => ({
  BarSEMChart: ({ gene, groups, comparisons }: { gene: string; groups?: Group[]; comparisons?: ChartComparison[] }) => (
    <div data-testid={`chart-${gene}`}>{JSON.stringify({ groups, comparisons })}</div>
  ),
}));

const cells: Group[] = [
  { key: 'chow_p0', label: 'Chow · P0', color: '#4C78A8' },
  { key: 'hfd_p0', label: 'HFD · P0', color: '#F28E2B' },
  { key: 'chow_p21', label: 'Chow · P21', color: '#76B7B2' },
  { key: 'hfd_p21', label: 'HFD · P21', color: '#B07AA1' },
];
const pairs = [[0, 1], [2, 3], [0, 2], [1, 3]];
const contrasts: ResolvedContrast[] = pairs.map(([baseline, caseGroup], index) => ({
  id: `comparison_${index}`, baseline: cells[baseline], caseGroup: cells[caseGroup],
  label: `${cells[caseGroup].label} vs ${cells[baseline].label}`, supportsPathways: true,
}));
const pathway: PathwayRecordWithDb = {
  pathway: 'TEST_PATHWAY', db: 'GO_BP', NES: 1.7, pval: 0.01, padj: 0.04,
  size: 3, leadingEdge: ['Pomc', 'Agrp'],
};
const slices: ContrastSlice[] = contrasts.map((contrast, index) => ({
  contrast,
  popData: makePopData({
    contrast, groups: [contrast.baseline, contrast.caseGroup],
    // Interleaved samples make positional grouping a detectable error.
    sampleOrder: ['p21h', 'p0c', 'p21c', 'p0h'],
    groupSamples: { chow_p0: ['p0c'], hfd_p0: ['p0h'], chow_p21: ['p21c'], hfd_p21: ['p21h'] },
    cpm: { Pomc: [40, 10, 30, 20], Agrp: [4, 1, 3, 2] },
    de: [
      { gene: 'Pomc', logFC: index + 1, PValue: [0.001, 0.02, 0.2, 0.004][index], FDR: index === 2 ? null : 0.03, rank_score: 2 },
      ...(index === 3 ? [] : [{ gene: 'Agrp', logFC: -1, PValue: 0.2, FDR: 0.4, rank_score: -1 }]),
    ],
    allPathways: index === 3 ? [] : [
      { ...pathway, NES: [1.7, -2.3, 0.6][index], padj: [0.04, 0.001, 0.8][index] },
      // Same name in another DB must not supply missing GO results.
      { ...pathway, db: 'KEGG', NES: 99 },
    ],
  }),
}));
const active = slices[0].popData;

function DetailHarness() {
  const [showGenes, setShowGenes] = useState(false);
  return <PathwayDetailPanel pathway={pathway} popData={active} contrastSlices={slices}
    onClose={() => {}} showGenes={showGenes} setShowGenes={setShowGenes} />;
}

describe('factorial pathway visualizations', () => {
  it('opens with all four conditions and shows each comparison’s own enrichment result', () => {
    render(<DetailHarness />);
    expect(screen.getByRole('button', { name: 'All 4 conditions' })).toHaveAttribute('aria-pressed', 'true');
    const comparisonTable = screen.getByRole('region', { name: 'Pathway enrichment across comparisons' });
    expect(within(comparisonTable).getByRole('img', { name: `${contrasts[1].label}: NES -2.300` })).toBeTruthy();
    expect(within(comparisonTable).getByText('Not available for this comparison')).toBeTruthy();
    expect(comparisonTable).not.toHaveTextContent('99');
    const heatmap = screen.getByRole('img', { name: 'Leading edge gene heatmap' });
    const bars = [...heatmap.querySelectorAll('rect')].filter((rect) => rect.getAttribute('height') === '8');
    expect(bars.map((bar) => bar.getAttribute('fill'))).toEqual([cells[3].color, cells[0].color, cells[2].color, cells[1].color]);
    for (const group of cells) expect(screen.getByText(group.label, { exact: true })).toBeTruthy();
    expect(screen.getByText(`Ranked genes (${contrasts[0].label})`)).toBeTruthy();
  });

  it('narrows sample columns and chart groups when selected-comparison mode is chosen', () => {
    render(<DetailHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Selected comparison' }));
    const heatmap = screen.getByRole('img', { name: 'Leading edge gene heatmap' });
    const bars = [...heatmap.querySelectorAll('rect')].filter((rect) => rect.getAttribute('height') === '8');
    expect(bars.map((bar) => bar.querySelector('title')?.textContent)).toEqual(['p0c · Chow · P0', 'p0h · HFD · P0']);
    expect(screen.queryByRole('region', { name: 'Pathway enrichment across comparisons' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Explore leading-edge genes/ }));
    expect(JSON.parse(screen.getByTestId('chart-Pomc').textContent ?? '{}')).toEqual({});
    expect(screen.queryByRole('button', { name: 'Mean HFD · P21' })).toBeNull();
  });

  it('uses four means and each comparison’s own gene p-value, marking missing results as n/a', () => {
    render(<DetailHarness />);
    fireEvent.click(screen.getByRole('button', { name: /Explore leading-edge genes/ }));
    const chart = JSON.parse(screen.getByTestId('chart-Pomc').textContent ?? '{}');
    expect(chart.groups).toEqual(cells);
    expect(chart.comparisons.map((comparison: ChartComparison) => comparison.star)).toEqual(['**', '*', 'ns', '**']);
    const missing = JSON.parse(screen.getByTestId('chart-Agrp').textContent ?? '{}').comparisons[3];
    expect(missing).toMatchObject({ star: 'n/a', title: `${contrasts[3].label}: not detected` });
    for (const group of cells) expect(screen.getByRole('button', { name: `Mean ${group.label}` })).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('10.0020.0030.0040.00');
    fireEvent.click(screen.getByRole('button', { name: 'Mean HFD · P21' }));
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Agrp');
  });
});

describe('factorial pathway export', () => {
  it('exports every condition and keeps pathway/gene statistics attached to their real comparison', () => {
    const sheets = pathwayDetailSheets(pathway, active, slices, { queryGene: 'Pomc' });
    const sheet = (name: string) => sheets.find((entry) => entry.name === name)!.rows;
    expect(sheet('LeadingEdge')[0]).toMatchObject({
      'MeanChow · P0CPM': 10, 'MeanHFD · P0CPM': 20,
      'MeanChow · P21CPM': 30, 'MeanHFD · P21CPM': 40,
      Comparison: contrasts[0].label, IsQueryGene: 'YES',
    });
    expect(sheet('RawCPM').filter((row) => row.Gene === 'Pomc').map((row) => row.Condition)).toEqual(cells.map((group) => group.label));
    expect(sheet('GeneComparisons').find((row) => row.Gene === 'Agrp' && row.Comparison === contrasts[3].label))
      .toMatchObject({ Status: 'Not detected', logFC: '', PValue: '', FDR: '', Stars: '' });
    expect(sheet('GeneComparisons').find((row) => row.Gene === 'Pomc' && row.Comparison === contrasts[2].label))
      .toMatchObject({ logFC: 3, PValue: 0.2, FDR: '' });
    expect(sheet('PathwayComparisons')[1]).toMatchObject({ Comparison: contrasts[1].label, NES: -2.3, FDR: 0.001 });
    expect(sheet('PathwayComparisons')[3]).toMatchObject({ Status: 'Not available', NES: '', FDR: '', PValue: '' });
  });

  it('keeps single-comparison exports in their existing three-sheet format', () => {
    const sheets = pathwayDetailSheets(pathway, active);
    expect(sheets.map((sheet) => sheet.name)).toEqual(['PathwayInfo', 'LeadingEdge', 'RawCPM']);
    expect(sheets[1].rows[0]).not.toHaveProperty('Comparison');
    expect(sheets[2].rows).toHaveLength(4);
  });
});
