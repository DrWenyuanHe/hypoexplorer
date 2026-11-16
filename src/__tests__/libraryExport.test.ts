import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportLibraryCsv } from '../library/libraryExport';
import { loadDatasetCatalog, registryCards } from '../data/datasetCatalog';
import { _resetBundleCache } from '../data/bundleSource';
import { seedQueryManifest } from './fixtures';
import { csvDownloadTable } from './csvDownload';

// The library's column contract. Escaping, BOM and line endings belong to the
// CSV seam and are pinned in csv.test.ts.

const downloadFile = vi.hoisted(() => vi.fn());
vi.mock('../utils/exportAction', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  downloadFile,
}));

/** Filename and parsed table of the last library export. */
function exported(): { name: string; table: string[][] } {
  const [name, href] = downloadFile.mock.calls.at(-1) as [string, string];
  return { name, table: csvDownloadTable(href) };
}

beforeEach(() => downloadFile.mockClear());

describe('exportLibraryCsv', () => {
  it('names the file by the UTC date of the export', () => {
    exportLibraryCsv(registryCards(), new Date('2026-11-15T23:30:00Z'));
    expect(exported().name).toBe('hypoexplorer-studies-2026-11-15.csv');
  });

  it('writes one row per study, in the order given, under a fixed header', () => {
    const cards = registryCards();
    exportLibraryCsv(cards);
    const { table: [header, ...rows] } = exported();
    expect(rows.length).toBe(cards.length);
    expect(header.slice(0, 3)).toEqual(['dataset_id', 'study', 'category']);
    expect(rows[0][0]).toBe(cards[0].dataset.id);
    expect(rows.every((row) => row.length === header.length)).toBe(true);
  });

  it('leaves an unmeasured count empty rather than writing a zero', () => {
    // Registry cards carry no counts; a 0 here would read as a finding.
    exportLibraryCsv(registryCards());
    const { table: [header, row] } = exported();
    expect(row[header.indexOf('n_baseline')]).toBe('');
    expect(row[header.indexOf('significant_genes')]).toBe('');
  });

  it('keeps measured counts, and a field that carries a comma stays one field', async () => {
    const unseed = seedQueryManifest();
    const { cards } = await loadDatasetCatalog();
    exportLibraryCsv(cards);
    const { table: [header, ...rows] } = exported();
    const hfd = rows.find((r) => r[0] === 'mouse_hypo_hfd_gse220533');
    expect([hfd?.[header.indexOf('n_baseline')], hfd?.[header.indexOf('n_case')]]).toEqual(['7', '8']);
    const leptin = rows.filter((r) => r[header.indexOf('category')] === 'Leptin, insulin & energy signaling');
    for (const row of leptin) expect(row.length).toBe(header.length);
    unseed();
    _resetBundleCache();
  });
});
