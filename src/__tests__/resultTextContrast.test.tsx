import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { SummaryTable } from '../gene-explorer/SummaryTable';
import { UP_TEXT_COLOR, DOWN_TEXT_COLOR, NEUTRAL_TEXT_COLOR, UP_COLOR, DOWN_COLOR } from '../styles/constants';
import { makePopData } from './fixtures';

function luminance(hex: string): number {
  const rgb = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

describe('normal-sized result text contrast', () => {
  it('meets WCAG AA on result surfaces while preserving chart fills', () => {
    for (const foreground of [UP_TEXT_COLOR, DOWN_TEXT_COLOR, NEUTRAL_TEXT_COLOR]) {
      // Panel, warm page, row hover, row selected and chip cream (index.html tokens).
      for (const background of ['#ffffff', '#faf8f5', '#f4f1ed', '#ede8e2', '#fff8f0']) {
        expect(contrast(foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(UP_COLOR).toBe('#E45756');
    expect(DOWN_COLOR).toBe('#4C78A8');
  });

  it('uses readable colors for positive and negative effects and nonsignificant labels', () => {
    render(<SummaryTable selectedGenes={['UP', 'DOWN', 'FLAT']} onRemove={vi.fn()} popData={makePopData({
      de: [
        { gene: 'UP', logFC: 1, PValue: 0.2, FDR: 0.4 },
        { gene: 'DOWN', logFC: -1, PValue: 0.01, FDR: 0.02 },
        { gene: 'FLAT', logFC: 0, PValue: 1, FDR: 1 },
      ],
    })} />);
    const rows = ['UP', 'DOWN', 'FLAT'].map((gene) => screen.getByText(gene).closest('tr')!);
    const cellColor = (row: HTMLElement) => within(row).getAllByRole('cell')[1].style.color;
    expect(cellColor(rows[0])).toBe('rgb(173, 52, 51)');
    expect(cellColor(rows[1])).toBe('rgb(49, 95, 141)');
    expect(cellColor(rows[2])).toBe('rgb(90, 86, 80)');
    expect(within(rows[0]).getByText('ns').style.color).toBe('rgb(90, 86, 80)');
    expect(within(rows[0]).getByRole('button', { name: 'Remove UP' }).style.color).toBe('rgb(90, 86, 80)');
  });
});
