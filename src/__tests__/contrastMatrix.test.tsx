import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContrastMatrix } from '../gene-explorer/ContrastMatrix';
import { makePopData } from './fixtures';
import { parseDelimitedRows } from '../local-datasets/importData';
import type { GeneDERecord, ResolvedContrast } from '../types';

// The across-comparisons matrix must read each gene from EACH slice's own DE
// table — the whole point is that the same gene carries a different effect per
// contrast (the 2x2's angles), so a cell served from the wrong table is the
// exact bug this view exists to prevent.

const C_ADJ: ResolvedContrast = {
  id: 'hfd_vs_chow_p0',
  baseline: { key: 'chow_p0', label: 'Chow · P0', color: '#37b' },
  caseGroup: { key: 'hfd_p0', label: 'HFD · P0', color: '#b43' },
  supportsPathways: true,
  label: 'Maternal HFD vs chow at P0',
  group: 'Maternal-diet effect',
};
const C_P21: ResolvedContrast = {
  id: 'hfd_vs_chow_p21',
  baseline: { key: 'chow_p21', label: 'Chow P21', color: '#255' },
  caseGroup: { key: 'hfd_p21', label: 'HFD P21', color: '#8a2' },
  supportsPathways: true,
  label: 'Maternal HFD vs chow at P21',
  group: 'Maternal-diet effect',
};

const DE_ADJ: GeneDERecord[] = [
  { gene: 'Timp1', logFC: 0.12, PValue: 0.5, FDR: 0.9 },
  { gene: 'Sirt2', logFC: -0.1, PValue: 0.6, FDR: 0.95 },
];
const DE_P21: GeneDERecord[] = [
  { gene: 'Timp1', logFC: 1.41, PValue: 0.0002, FDR: 0.01 },
  { gene: 'Sirt2', logFC: -0.83, PValue: 0.0008, FDR: 0.02 },
];

const slices = [
  { contrast: C_ADJ, popData: makePopData({ de: DE_ADJ, contrast: C_ADJ }) },
  { contrast: C_P21, popData: makePopData({ de: DE_P21, contrast: C_P21 }) },
];

describe('ContrastMatrix', () => {
  it('renders one column per contrast, each cell from that contrast\'s OWN DE table', () => {
    render(
      <ContrastMatrix
        selectedGenes={['Timp1', 'Sirt2']}
        slices={slices}
        activeContrastId="hfd_vs_chow_p0"
        onRemove={() => {}}
      />,
    );
    // Column headers.
    expect(screen.getByText('Maternal HFD vs chow at P0')).toBeTruthy();
    expect(screen.getByText('Maternal HFD vs chow at P21')).toBeTruthy();
    // The same gene shows the adjusted table's flat effect AND the P21 table's
    // real one, side by side (fmtSigned: '+' prefix, plain '-' from toFixed).
    expect(screen.getByText('+0.12')).toBeTruthy();
    expect(screen.getByText('+1.41')).toBeTruthy();
    expect(screen.getByText('-0.10')).toBeTruthy();
    expect(screen.getByText('-0.83')).toBeTruthy();
    // The shared optgroup renders as ONE spanning band cell.
    expect(screen.getAllByText('Maternal-diet effect')).toHaveLength(1);
  });

  it('removes a gene through its row button', () => {
    const onRemove = vi.fn();
    render(
      <ContrastMatrix selectedGenes={['Timp1']} slices={slices} onRemove={onRemove} />,
    );
    fireEvent.click(screen.getByLabelText('Remove Timp1'));
    expect(onRemove).toHaveBeenCalledWith('Timp1');
  });

  it('renders a dash for a gene a contrast\'s table does not carry', () => {
    const missing = [
      { contrast: C_ADJ, popData: makePopData({ de: DE_ADJ, contrast: C_ADJ }) },
      { contrast: C_P21, popData: makePopData({ de: [DE_P21[0]], contrast: C_P21 }) },
    ];
    render(
      <ContrastMatrix selectedGenes={['Sirt2']} slices={missing} onRemove={() => {}} />,
    );
    expect(screen.getByText('-0.10')).toBeTruthy();  // adjusted table has it
    expect(screen.getByText('–')).toBeTruthy(); // P21 table does not
  });
});

// ── Sorting and export ──────────────────────────────────────────────────────
// The between-comparison question ("which of my genes is most age-specific?")
// is answered by sorting on ONE comparison's column while the others stay
// visible, and by taking the whole matrix away as CSV. Both are the reason the
// view exists rather than reading five tables in turn.
describe('ContrastMatrix — sorting', () => {
  /** Gene names in rendered row order (the first cell of every body row). */
  function rowOrder(container: HTMLElement): string[] {
    return [...container.querySelectorAll('tbody tr td:first-child')]
      .map((td) => (td.textContent || '').trim());
  }

  it('sorts by a comparison\'s logFC when its header is clicked, and flips on a second click', () => {
    const { container } = render(
      <ContrastMatrix selectedGenes={['Timp1', 'Sirt2']} slices={slices} onRemove={() => {}} />,
    );
    // Default: by gene name, ascending.
    expect(rowOrder(container)).toEqual(['Sirt2', 'Timp1']);

    // The header control is captured once: its text gains a sort arrow after
    // the first click, so re-querying by the bare label would miss it. It is
    // the <button> inside the cell, not the cell — see SortableTh.
    const p21Header = screen.getByText('Maternal HFD vs chow at P21');
    const p21Cell = p21Header.closest('th')!;
    expect(p21Cell.getAttribute('aria-sort')).toBe('none');

    fireEvent.click(p21Header);
    // Descending by that column: Timp1 (+1.41) above Sirt2 (-0.83).
    expect(rowOrder(container)).toEqual(['Timp1', 'Sirt2']);
    expect(p21Header.textContent).toContain('↓');
    expect(p21Cell.getAttribute('aria-sort')).toBe('descending');

    fireEvent.click(p21Header);
    expect(rowOrder(container)).toEqual(['Sirt2', 'Timp1']);
    expect(p21Header.textContent).toContain('↑');
    expect(p21Cell.getAttribute('aria-sort')).toBe('ascending');
  });

  it('sorts each comparison independently — the adjusted column gives a different order', () => {
    const { container } = render(
      <ContrastMatrix selectedGenes={['Timp1', 'Sirt2']} slices={slices} onRemove={() => {}} />,
    );
    // Adjusted table: Timp1 +0.12, Sirt2 -0.10 — descending puts Timp1 first,
    // and the P21 table would order them the same way, so assert the ARROW
    // moved columns rather than only the row order.
    const adjHeader = screen.getByText('Maternal HFD vs chow at P0');
    fireEvent.click(adjHeader);
    expect(rowOrder(container)).toEqual(['Timp1', 'Sirt2']);
    expect(adjHeader.textContent).toContain('↓');
    expect(screen.getByText('Maternal HFD vs chow at P21').textContent).not.toContain('↓');
    // aria-sort moves columns with the arrow — the state assistive tech reads.
    expect(adjHeader.closest('th')!.getAttribute('aria-sort')).toBe('descending');
    expect(screen.getByText('Maternal HFD vs chow at P21').closest('th')!.getAttribute('aria-sort'))
      .toBe('none');
  });
});

describe('ContrastMatrix — CSV export', () => {
  it('writes logFC/PValue/FDR columns per comparison, one row per gene', () => {
    render(
      <ContrastMatrix selectedGenes={['Timp1', 'Sirt2']} slices={slices} onRemove={() => {}} />,
    );

    // downloadFile builds an <a data-href> and clicks it (see exportAction);
    // capture it the same way exportAction.test.tsx does.
    const orig = document.createElement.bind(document);
    const anchors: HTMLAnchorElement[] = [];
    vi.spyOn(document, 'createElement').mockImplementation((tag: any) => {
      const el = orig(tag);
      if (tag === 'a') anchors.push(el as HTMLAnchorElement);
      return el;
    });
    try {
      fireEvent.click(screen.getByText('Export CSV'));
    } finally {
      vi.restoreAllMocks();
    }

    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toContain('contrast_matrix');
    const prefix = 'data:text/csv;charset=utf-8,';
    const csv = decodeURIComponent(anchors[0].getAttribute('href')!.slice(prefix.length));
    const [header, ...rows] = parseDelimitedRows(csv, ',');

    // One triple of columns per comparison, labelled by that comparison.
    expect(header.slice(0, 7)).toEqual([
      'Gene', 'logFC (Maternal HFD vs chow at P0)', 'PValue (Maternal HFD vs chow at P0)',
      'FDR (Maternal HFD vs chow at P0)', 'logFC (Maternal HFD vs chow at P21)',
      'PValue (Maternal HFD vs chow at P21)', 'FDR (Maternal HFD vs chow at P21)',
    ]);
    // Rows follow the rendered sort order (gene name ascending by default), and
    // each cell comes from that comparison's OWN table.
    expect(rows.map((row) => row.slice(0, 7))).toEqual([
      ['Sirt2', '-0.1', '0.6', '0.95', '-0.83', '0.0008', '0.02'],
      ['Timp1', '0.12', '0.5', '0.9', '1.41', '0.0002', '0.01'],
    ]);
    const metadata = JSON.parse(rows[0][header.indexOf('ExportMetadataJSON')]);
    expect(metadata.contrasts.map((contrast: { id: string }) => contrast.id)).toEqual([C_ADJ.id, C_P21.id]);
    expect(metadata.reuse.originalDerivedContributionsLicense).toBe('CC BY 4.0');
    expect(metadata.csvMetadataPlacement).toContain('first data row');
    expect(rows[1][header.indexOf('ExportMetadataJSON')]).toBe('');
    for (const column of ['DatasetID', 'SourceAccession', 'TrackID', 'ContrastID', 'ContrastDirection', 'ExpressionUnit']) {
      expect(rows[1][header.indexOf(column)]).toBe(rows[0][header.indexOf(column)]);
    }
    expect(rows[1][header.indexOf('ContrastID')]).toBe(`${C_ADJ.id} | ${C_P21.id}`);
    expect(rows[1][header.indexOf('ExpressionUnit')]).toBe('CPM');
  });

  it('leaves the cells empty for a gene a comparison does not carry', () => {
    const missing = [
      { contrast: C_ADJ, popData: makePopData({ de: DE_ADJ, contrast: C_ADJ }) },
      { contrast: C_P21, popData: makePopData({ de: [DE_P21[0]], contrast: C_P21 }) },
    ];
    render(<ContrastMatrix selectedGenes={['Sirt2']} slices={missing} onRemove={() => {}} />);

    const orig = document.createElement.bind(document);
    const anchors: HTMLAnchorElement[] = [];
    vi.spyOn(document, 'createElement').mockImplementation((tag: any) => {
      const el = orig(tag);
      if (tag === 'a') anchors.push(el as HTMLAnchorElement);
      return el;
    });
    try {
      fireEvent.click(screen.getByText('Export CSV'));
    } finally {
      vi.restoreAllMocks();
    }

    const prefix = 'data:text/csv;charset=utf-8,';
    const csv = decodeURIComponent(anchors[0].getAttribute('href')!.slice(prefix.length));
    // Three empty fields for the missing comparison — never a 0, which would
    // read as "measured, no effect".
    expect(parseDelimitedRows(csv, ',')[1].slice(0, 7)).toEqual(['Sirt2', '-0.1', '0.6', '0.95', '', '', '']);
  });
});
