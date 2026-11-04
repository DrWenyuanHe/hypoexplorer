import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportGenesCSV, exportGenesExcel } from '../gene-explorer/geneExport';
import { makePopData, MACAQUE_DATASET } from './fixtures';
import { parseDelimitedRows } from '../local-datasets/importData';
import { parseRoute } from '../utils/appLinks';
import { RELEASE_IDENTITY } from '../data/releaseIdentity';
import type { Group, PopData, ResolvedContrast } from '../types';

// The gene CSV is the download that sits beside the bar charts, and its one
// hard requirement is that it describes the SAME picture: the default two-arm
// chart exports two arms, and the multi-condition chart exports every cell it
// drew plus every comparison it bracketed. A file that silently narrows to the
// active contrast under the four-condition view would drop half the samples and
// three quarters of the statistics without saying so.

const downloadFile = vi.hoisted(() => vi.fn());
const writeWorkbook = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../utils/workbook', () => ({ writeWorkbook }));
vi.mock('../utils/exportAction', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  downloadFile,
}));

/** The CSV rows the exporter handed to downloadFile. */
function capturedCSV(): string[] {
  const [, dataUrl] = downloadFile.mock.calls.at(-1) as [string, string];
  return decodeURIComponent(dataUrl.replace(/^data:text\/csv;charset=utf-8,/, '')).split('\n');
}

function capturedTable(): string[][] {
  const [, dataUrl] = downloadFile.mock.calls.at(-1) as [string, string];
  return parseDelimitedRows(decodeURIComponent(dataUrl.replace(/^data:text\/csv;charset=utf-8,/, '')), ',');
}

const CELLS: Group[] = [
  { key: 'chow_p0', label: 'Chow P0', color: '#6FA1DC' },
  { key: 'hfd_p0', label: 'HFD P0', color: '#D98886' },
  { key: 'chow_p21', label: 'Chow P21', color: '#25537F' },
  { key: 'hfd_p21', label: 'HFD P21', color: '#8A2F2E' },
];

const contrastOf = (id: string, base: Group, cs: Group, label: string): ResolvedContrast => ({
  id, baseline: base, caseGroup: cs, supportsPathways: false, label,
});

const factorialPop = (overrides: Partial<PopData> = {}) => makePopData({
  de: [{ gene: 'Timp1', logFC: 2.29, PValue: 0.0000037, FDR: 0.011 }],
  cpm: { Timp1: [1, 2, 8, 4, 20, 22] },
  sampleOrder: ['C0a', 'C0b', 'H0a', 'C21a', 'H21a', 'H21b'],
  groupSamples: {
    chow_p0: ['C0a', 'C0b'], hfd_p0: ['H0a'], chow_p21: ['C21a'], hfd_p21: ['H21a', 'H21b'],
  },
  contrast: contrastOf('hfd_vs_chow_p21', CELLS[2], CELLS[3], 'HFD vs chow at P21'),
  expressionUnit: 'log2-normalized',
  ...overrides,
});

describe('exportGenesCSV — default (two-arm) scope', () => {
  beforeEach(() => downloadFile.mockClear());

  it('keeps scientific column order and precision, then appends self-contained provenance', () => {
    exportGenesCSV(['POMC'], makePopData());
    const [header, row] = capturedCSV();
    expect(header.startsWith(
      'Gene,logFC,PValue,FDR,Stars,MeanNormalCPM,MeanObeseCPM,S1 (Normal),S2 (Normal),S3 (Obese),S4 (Obese),',
    )).toBe(true);
    // POMC's fixture CPM is [10,20,30,40] over normal S1,S2 / obese S3,S4.
    expect(row.startsWith('POMC,1.5,0.001,0.01,**,15,35,10,20,30,40,')).toBe(true);
    expect(header.endsWith('DatasetID,SourceAccession,TrackID,ContrastID,ContrastDirection,ExpressionUnit,ExportMetadataJSON')).toBe(true);
  });
});

describe('gene export provenance', () => {
  beforeEach(() => { downloadFile.mockClear(); writeWorkbook.mockClear(); });

  it('stores file-level JSON once while keeping every scientific row and its stable identifiers', () => {
    const pop = makePopData({ dataset: MACAQUE_DATASET, meta: { code: 'e9' } });
    exportGenesCSV(['POMC', 'AGRP', 'missing'], pop);
    const [header, ...rows] = capturedTable();
    const at = (name: string) => header.indexOf(name);
    expect(rows.map((row) => row[0])).toEqual(['POMC', 'AGRP', 'missing']);
    expect(rows.map((row) => row.slice(0, 11))).toEqual([
      ['POMC', '1.5', '0.001', '0.01', '**', '15', '35', '10', '20', '30', '40'],
      ['AGRP', '-0.8', '0.04', '0.2', '*', '5', '20', '5', '', '15', '25'],
      ['missing', '', '', '', '', '', '', '', '', '', ''],
    ]);
    expect(rows.filter((row) => row[at('ExportMetadataJSON')])).toHaveLength(1);
    expect(rows.slice(1).map((row) => row[at('ExportMetadataJSON')])).toEqual(['', '']);
    const metadata = JSON.parse(rows[0][at('ExportMetadataJSON')]);
    expect(metadata.settings.geneCount).toBe(3);
    expect(metadata.csvMetadataPlacement).toContain('first data row');
    for (const row of rows) {
      expect(row[at('DatasetID')]).toBe('macaque_snrna');
      expect(row[at('SourceAccession')]).toBe('CNP0003785');
      expect(row[at('TrackID')]).toBe('e9');
      expect(row[at('ContrastID')]).toBe('obese_vs_normal');
      expect(row[at('ContrastDirection')]).toBe('obese_vs_normal: Obese minus Normal; positive logFC means higher in Obese');
      expect(row[at('ExpressionUnit')]).toBe('CPM');
    }
  });

  it('records source, release, contrast direction, sample membership and display settings in one CSV download', () => {
    const pop = makePopData({ dataset: MACAQUE_DATASET, meta: { code: 'e9', label: 'POMC/TBX3' } });
    exportGenesCSV(['POMC'], pop, { settings: { volcano: { metric: 'fdr', logFCThresh: 0.75, sigThresh: 2 }, chartScale: 'log2' } });
    expect(downloadFile).toHaveBeenCalledTimes(1);
    expect(downloadFile.mock.calls[0][0]).toBe('macaque_snrna_e9_obese_vs_normal_genes_summary.csv');
    const [header, row] = capturedTable();
    expect(row[header.indexOf('SourceAccession')]).toBe('CNP0003785');
    const metadata = JSON.parse(row[header.indexOf('ExportMetadataJSON')]);
    expect(metadata.dataset.id).toBe('macaque_snrna');
    expect(metadata.release).toEqual(RELEASE_IDENTITY);
    expect(metadata.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(metadata.contrasts[0]).toMatchObject({ id: 'obese_vs_normal', direction: 'Obese minus Normal; positive logFC means higher in Obese' });
    expect(metadata.groups[0].samples).toEqual(['S1', 'S2']);
    expect(metadata.biologicalReplicateUnit).toContain('animal-level pseudobulk');
    expect(metadata.settings.volcano).toEqual({ metric: 'fdr', logFCThresh: 0.75, sigThresh: 2 });
    expect(metadata.expression.exportScale).toContain('display transforms are not applied');
    expect(metadata.evidence[0].replication.length).toBeGreaterThan(0);
    const route = parseRoute(new URL(metadata.sourceUrl).hash);
    expect(route).toMatchObject({ view: 'explorer', datasetId: 'macaque_snrna', trackId: 'e9', analysis: { contrastId: 'obese_vs_normal', chartScale: 'log2' } });
  });

  it('keeps unknown FDR and absent statistics blank, and round-trips quoted identifiers without rounding', () => {
    const gene = 'Gene, "quoted"';
    const pop = makePopData({ de: [{ gene, logFC: 0.1234567890123456, PValue: 1.23456789012345e-14, FDR: null }], cpm: { [gene]: [1, 2, 3, 4] } });
    exportGenesCSV([gene, 'ABSENT'], pop);
    const [header, row, absent] = capturedTable();
    expect(row[0]).toBe(gene);
    expect(row[header.indexOf('logFC')]).toBe('0.1234567890123456');
    expect(row[header.indexOf('PValue')]).toBe('1.23456789012345e-14');
    expect(row[header.indexOf('FDR')]).toBe('');
    expect(absent.slice(1, 5)).toEqual(['', '', '', '']);
    expect(absent.slice(5, 11)).toEqual(['', '', '', '', '', '']);
    expect(absent[header.indexOf('ExportMetadataJSON')]).toBe('');
    expect(JSON.parse(row[header.indexOf('ExportMetadataJSON')]).dataset.id).toBeNull();
  });

  it('gives same-track exports from different datasets distinct names', () => {
    const first = makePopData({ dataset: MACAQUE_DATASET });
    exportGenesCSV(['POMC'], first);
    exportGenesCSV(['POMC'], { ...first, dataset: { ...MACAQUE_DATASET, id: 'another-study' } });
    expect(downloadFile.mock.calls[0][0]).not.toBe(downloadFile.mock.calls[1][0]);
  });

  it('adds Excel Metadata after the unchanged summary and tidy sample sheets', async () => {
    await exportGenesExcel(['POMC'], makePopData({ dataset: MACAQUE_DATASET, meta: { code: 'e9' } }));
    const [filename, sheets] = writeWorkbook.mock.calls[0] as unknown as [string, Array<{ name: string; rows: Array<Record<string, unknown>> }>];
    expect(filename).toBe('macaque_snrna_e9_obese_vs_normal_genes_export.xlsx');
    expect(sheets.map((sheet) => sheet.name)).toEqual(['Summary', 'RawValues', 'Metadata']);
    expect(Object.keys(sheets[0].rows[0])).toEqual(['Gene', 'logFC', 'PValue', 'FDR', 'Stars', 'MeanNormalCPM', 'MeanObeseCPM', 'S1 (Normal)', 'S2 (Normal)', 'S3 (Obese)', 'S4 (Obese)']);
    expect(sheets[0].rows[0].logFC).toBe(1.5);
    const metadata = Object.fromEntries(sheets[2].rows.map((row) => [row.Field, row.Value]));
    expect(metadata['dataset.id']).toBe('macaque_snrna');
    expect(metadata['release.appVersion']).toBe(RELEASE_IDENTITY.appVersion);
    expect(metadata['release.dataBuildId']).toBe(RELEASE_IDENTITY.dataBuildId ?? 'Unrecorded');
    expect(metadata['contrasts.0.id']).toBe('obese_vs_normal');
    expect(metadata['reuse.originalDerivedContributionsLicense']).toBe('CC BY 4.0');
  });
});

describe('exportGenesCSV — multi-condition scope', () => {
  beforeEach(() => downloadFile.mockClear());

  const slices = [
    { contrast: contrastOf('hfd_vs_chow_p0', CELLS[0], CELLS[1], 'HFD vs chow at P0'),
      popData: factorialPop({ de: [{ gene: 'Timp1', logFC: 0.07, PValue: 0.82, FDR: 0.96 }] }) },
    { contrast: contrastOf('hfd_vs_chow_p21', CELLS[2], CELLS[3], 'HFD vs chow at P21'),
      popData: factorialPop() },
  ];

  it('widens the means and sample columns to every drawn cell', () => {
    exportGenesCSV(['Timp1'], factorialPop(), { groups: CELLS });
    const [header] = capturedCSV();
    // One mean per cell, unit-aware (log2-normalized, so not "CPM")...
    expect(header).toContain('MeanChow P0Log2,MeanHFD P0Log2,MeanChow P21Log2,MeanHFD P21Log2');
    // ...and all six samples, each tagged with the cell it belongs to.
    expect(header).toContain('C0a (Chow P0),C0b (Chow P0),H0a (HFD P0),C21a (Chow P21),H21a (HFD P21),H21b (HFD P21)');
  });

  it('carries one stat block per comparison, each from its OWN table', () => {
    exportGenesCSV(['Timp1'], factorialPop(), { groups: CELLS, slices });
    const [header, row] = capturedCSV();
    expect(header.startsWith(
      'Gene,logFC (HFD vs chow at P0),PValue (HFD vs chow at P0),FDR (HFD vs chow at P0),'
      + 'Stars (HFD vs chow at P0),logFC (HFD vs chow at P21),',
    )).toBe(true);
    // The P0 block is the flat effect; the P21 block is the real one. A single
    // block would have reported one of them under both comparisons' names.
    expect(row).toContain('0.07,0.82,0.96,ns,');
    expect(row).toContain('2.29,0.0000037,0.011,****,');
    // Then the four means: 1.5, 8, 4, 21.
    expect(row).toContain(',1.5,8,4,21,');
  });
});
