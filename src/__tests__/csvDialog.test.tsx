import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CsvDialog } from '../search/hypomap/CsvDialog';
import { csvDownloadTable } from './csvDownload';

// The HypoMap preview dialog downloads exactly the table it shows, named by the
// export-action seam's filename rule and written by the CSV seam.

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

describe('CsvDialog', () => {
  it('downloads the previewed table through the CSV seam under a sanitised title', () => {
    const csv = {
      title: 'Pomc × Npy · ARC/VMH',
      headers: ['Dataset', 'Accession', '% detected'],
      rows: [['Aggregate', null, 12.5], ['Lee, 2024', 'GSE1', -0.25]],
    };
    render(<CsvDialog csv={csv} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV', hidden: true }));
    expect(downloadFile).toHaveBeenCalledTimes(1);
    const [name, href] = downloadFile.mock.calls[0] as [string, string];
    expect(name).toBe('Pomc × Npy · ARC_VMH.csv');
    expect(csvDownloadTable(href)).toEqual([
      ['Dataset', 'Accession', '% detected'],
      ['Aggregate', '', '12.5'],
      ['Lee, 2024', 'GSE1', '-0.25'],
    ]);
  });
});
