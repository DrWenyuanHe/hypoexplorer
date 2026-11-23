import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CsvDialog } from '../search/hypomap/CsvDialog';
import type { AtlasTable } from '../search/hypomap/atlas';
import { csvDownloadTable } from './csvDownload';

// The HypoMap preview dialog shows the table alone and downloads it through the CSV seam,
// named and stamped with the atlas release by the export-provenance seam.

const downloadFile = vi.hoisted(() => vi.fn());
vi.mock('../utils/exportAction', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  downloadFile,
}));

beforeAll(() => {
  // jsdom implements <dialog> but not its modal methods.
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.open = false; };
});

const table: AtlasTable = {
  kind: 'hypomap_comparison',
  csv: {
    title: 'Pomc × Npy · ARC/VMH',
    headers: ['Dataset', 'Accession', '% detected'],
    rows: [['Aggregate', null, 12.5], ['Lee, 2024', 'GSE1', -0.25]],
  },
  subject: {
    shape: 'atlas',
    release: { tag: 'hypomap-atlas-2026-11-05', manifestSha256: 'ab'.repeat(32) },
    cohort: 'fixture cohort',
    gene: { id: 'ENSMUSG1', symbol: 'Pomc' },
    expressionUnit: 'Not applicable: cell counts and percentages of eligible cells.',
  },
  settings: { population: 'ARC/VMH' },
};

describe('CsvDialog', () => {
  it('previews the table without provenance columns', () => {
    render(<CsvDialog table={table} onClose={() => {}} />);
    expect(screen.getAllByRole('columnheader', { hidden: true }).map(header => header.textContent)).toEqual(['Dataset', 'Accession', '% detected']);
  });

  it('downloads the previewed table under the atlas release with its provenance columns', () => {
    render(<CsvDialog table={table} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV', hidden: true }));
    expect(downloadFile).toHaveBeenCalledTimes(1);
    const [name, href] = downloadFile.mock.calls[0] as [string, string];
    expect(name).toBe('hypomap-atlas-2026-11-05_Pomc × Npy · ARC_VMH.csv');
    const [header, first, second] = csvDownloadTable(href);
    const unit = 'Not applicable: cell counts and percentages of eligible cells.';
    expect(header).toEqual(['Dataset', 'Accession', '% detected', 'AtlasRelease', 'AtlasManifestSHA256', 'ExpressionUnit', 'ExportMetadataJSON']);
    expect(first.slice(0, 6)).toEqual(['Aggregate', '', '12.5', 'hypomap-atlas-2026-11-05', 'ab'.repeat(32), unit]);
    expect(second).toEqual(['Lee, 2024', 'GSE1', '-0.25', 'hypomap-atlas-2026-11-05', 'ab'.repeat(32), unit, '']);
    const metadata = JSON.parse(first[6]);
    expect(metadata).toMatchObject({
      exportKind: 'hypomap_comparison',
      atlas: { name: 'HypoMap', releaseTag: 'hypomap-atlas-2026-11-05', manifestSha256: 'ab'.repeat(32), cohort: 'fixture cohort' },
      gene: { id: 'ENSMUSG1', symbol: 'Pomc' },
      settings: { population: 'ARC/VMH' },
      sourceUrl: null,
    });
    // Fields a registered dataset would fill are explicit absences, not omissions.
    expect(metadata.dataset).toMatch(/^Not applicable: HypoMap is an external single-cell atlas/);
    expect(metadata.contrasts).toMatch(/^Not applicable/);
    expect(metadata.evidence).toMatch(/^Not recorded/);
  });
});
