import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { SummaryTable } from '../gene-explorer/SummaryTable';
import { makePopData } from './fixtures';

// The gene summary's FDR column follows the one p/q display rule (fmtP/fmtFDR):
// a small q keeps its order of magnitude instead of rounding to 0.000, and an
// underflowed q shows the '< 1e-300' sentinel.
describe('SummaryTable FDR column', () => {
  it('formats q-values with the shared p/q display rule', () => {
    render(<SummaryTable selectedGenes={['SMALL', 'ZERO', 'LARGE']} onRemove={vi.fn()} popData={makePopData({
      de: [
        { gene: 'SMALL', logFC: 2, PValue: 0.00001, FDR: 0.00014 },
        { gene: 'ZERO', logFC: 3, PValue: 0, FDR: 0 },
        { gene: 'LARGE', logFC: 0.1, PValue: 0.2, FDR: 0.4 },
      ],
    })} />);
    const fdrCell = (gene: string) => within(screen.getByText(gene).closest('tr')!).getAllByRole('cell')[3].textContent;
    expect(fdrCell('SMALL')).toBe('1.4e-4');
    expect(fdrCell('ZERO')).toBe('< 1e-300');
    expect(fdrCell('LARGE')).toBe('0.400');
  });
});
