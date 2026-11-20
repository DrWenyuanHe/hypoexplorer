import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import {
  EXCEL_MAX_ROWS, type ExportContext, exportRawCSV, exportResultsCSV, exportWorkbook, rawValueRows, rawValueTable,
} from '../circadian/circadianExport';
import { DATASETS } from '../data/datasets';
import type { RhythmRow } from '../circadian/scan';
import type { TimeSeriesBundle } from '../types';
import { csvDownloadTable } from './csvDownload';

// The raw-value exports write every gene they are given, in the order given
// (the table passes its genes as filtered and sorted), not only the rows the
// table happens to render. A list that would pass Excel's worksheet limit is
// cut at a whole gene and the cut is recorded in the provenance.
//
// These tests run the real writers: the CSV seam's text and Blob, and SheetJS's
// own serialisation, read back with SheetJS. Only the browser hand-off
// (downloadFile, URL.createObjectURL) is replaced, to capture the file.

const downloadFile = vi.hoisted(() => vi.fn());
vi.mock('../utils/exportAction', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  downloadFile,
}));

const SCN = DATASETS.find((d) => d.id === 'mouse_scn_hfd_gse157077');
if (!SCN) throw new Error('fixture dataset is not registered');

/** `nGenes` genes × 2 arms × 6 times × 3 replicates = 36 libraries, like the SCN course. */
function bigBundle(nGenes: number): TimeSeriesBundle {
  const times = [0, 4, 8, 12, 16, 20];
  const samples = ['chow', 'hfd'].flatMap((arm) => times.flatMap((time) => [1, 2, 3].map((replicate) => ({
    id: `${arm}_ZT${time}_${replicate}`, arm, time, replicate,
  }))));
  const values: Record<string, Array<number | null>> = {};
  for (let g = 0; g < nGenes; g++) {
    // Every 50th gene misses one library: missing values are omitted, never zero-filled.
    values[`G${g}`] = samples.map((_, i) => (g % 50 === 0 && i === 7 ? null : g + i / 100));
  }
  return {
    meta: {
      trackId: 'scn', label: 'SCN', cycleHours: 24, timeUnit: 'ZT', expressionUnit: 'CPM',
      arms: [{ key: 'chow', label: 'Chow', color: '#4C78A8' }, { key: 'hfd', label: 'High-fat diet', color: '#E45756' }],
      samples, timepoints: times, nGenes,
    },
    values,
  };
}

const ctx = (bundle: TimeSeriesBundle, extra: Partial<ExportContext> = {}): ExportContext => ({
  bundle, dataset: SCN, method: 'cosinor', adjust: 'bh', armLabel: 'Chow', periods: [24], ...extra,
});

const rhythmRow = (gene: string, p = 0.01): RhythmRow => ({
  gene, method: 'cosinor', p, q: p * 2, period: 24, acrophase: 6, amplitude: 2, mesor: 3, stat: 9, n: 36, nTimepoints: 6,
} as RhythmRow);

let blobs: Blob[] = [];
beforeEach(() => {
  downloadFile.mockClear();
  blobs = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return `blob:test/${blobs.length}`;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** The single file the last export handed to the browser, as a Blob. */
function downloadedBlob(): { name: string; blob: Blob } {
  expect(downloadFile).toHaveBeenCalledTimes(1);
  const [name, href] = downloadFile.mock.calls[0] as [string, string];
  expect(href).toBe(`blob:test/${blobs.length}`);
  return { name, blob: blobs[blobs.length - 1] };
}

/** A few CSV lines parsed with the same reader the other CSV tests use. */
const parseLines = (lines: string[]) =>
  csvDownloadTable(`data:text/csv;charset=utf-8,${encodeURIComponent(`${lines.join('\r\n')}\r\n`)}`);

describe('rawValueTable', () => {
  it('writes every gene of a 15,000-gene course in the order given, quickly', () => {
    const bundle = bigBundle(15_000);
    const genes = Object.keys(bundle.values).reverse();
    const started = performance.now();
    const table = rawValueTable(bundle, genes);
    const elapsed = performance.now() - started;
    expect(table.columns).toEqual(['Gene', 'Sample', 'Arm', 'TimeHours', 'TimeLabel', 'Replicate', 'NormCPM']);
    expect(table.genesRequested).toBe(15_000);
    expect(table.genesWritten).toBe(15_000);
    expect(table.rowsAvailable).toBe(15_000 * 36 - 300);
    expect(table.rowsWritten).toBe(table.rowsAvailable);
    expect(table.cells).toHaveLength(table.rowsWritten);
    expect(table.truncated).toBe(false);
    expect(table.cells[0]).toEqual(['G14999', 'chow_ZT0_1', 'Chow', 0, 'ZT0', 1, 14999]);
    expect(table.cells.at(-1)?.[0]).toBe('G0');
    // The missing library is absent, not zero.
    expect(table.cells.some((c) => c[0] === 'G0' && c[1] === 'chow_ZT8_2')).toBe(false);
    // Generous bound for a shared CI host; the build itself is a few hundred ms.
    expect(elapsed).toBeLessThan(5_000);
  });

  // The Excel row cap, checked on the table builder alone: serialising a
  // million-row workbook would make this suite slow without testing more.
  it('cuts at a whole gene when the list would pass Excel\'s worksheet row limit', () => {
    const bundle = bigBundle(30_000); // 1,079,400 rows available
    const table = rawValueTable(bundle, Object.keys(bundle.values));
    expect(table.truncated).toBe(true);
    expect(table.rowsAvailable).toBe(30_000 * 36 - 600);
    expect(table.rowsWritten).toBe(table.cells.length);
    expect(table.rowsWritten).toBeLessThanOrEqual(EXCEL_MAX_ROWS - 1);
    expect(table.rowsWritten + 36).toBeGreaterThan(EXCEL_MAX_ROWS - 1);
    // Whole genes only: the last written gene carries all of its libraries.
    const last = table.cells.at(-1)?.[0];
    expect(table.cells.filter((c) => c[0] === last)).toHaveLength(Number(String(last).slice(1)) % 50 === 0 ? 35 : 36);
    expect(table.genesWritten).toBe(new Set(table.cells.map((c) => c[0])).size);
  });

  it('still backs the uncapped object rows', () => {
    const bundle = bigBundle(3);
    expect(rawValueRows(bundle, ['G1'])).toHaveLength(36);
    expect(rawValueRows(bundle, ['G1'])[0]).toEqual({
      Gene: 'G1', Sample: 'chow_ZT0_1', Arm: 'Chow', TimeHours: 0, TimeLabel: 'ZT0', Replicate: 1, NormCPM: 1,
    });
    expect(rawValueRows(bundle, ['missing'])).toEqual([]);
  });
});

// 1,400 genes × 36 libraries − 28 missing = 50,372 raw rows: large enough that
// the CSV takes the Blob path, small enough to serialise in a few seconds.
const N_GENES = 1_400;
const N_ROWS = N_GENES * 36 - N_GENES / 50;

describe('raw-value exports, serialised for real', () => {
  it('Raw values CSV writes every gene passed, in pieces, and records the coverage', async () => {
    const bundle = bigBundle(N_GENES);
    const genes = Object.keys(bundle.values).reverse();
    await exportRawCSV(bundle, genes, ctx(bundle, { genesScored: N_GENES }));
    const { name, blob } = downloadedBlob();
    expect(name).toBe(`${SCN.id}_scn_timecourse_values.csv`);
    expect(blob.type).toBe('text/csv;charset=utf-8');
    // blob.text() would drop the byte-order mark; the file's bytes keep it.
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await blob.arrayBuffer());
    expect(text.startsWith(`${String.fromCharCode(0xfeff)}Gene,Sample,Arm,TimeHours,TimeLabel,Replicate,NormCPM,DatasetID,`)).toBe(true);
    expect(text.endsWith('\r\n')).toBe(true);
    const lines = text.slice(0, -2).split('\r\n');
    expect(lines).toHaveLength(N_ROWS + 1);
    const [header, first, second] = parseLines(lines.slice(0, 3));
    expect(first.slice(0, 7)).toEqual(['G1399', 'chow_ZT0_1', 'Chow', '0', 'ZT0', '1', '1399']);
    expect(second[header.indexOf('ExportMetadataJSON')]).toBe('');
    const [, last] = parseLines([lines[0], lines.at(-1) as string]);
    expect(last.slice(0, 7)).toEqual(['G0', 'hfd_ZT20_3', 'High-fat diet', '20', 'ZT20', '3', '0.35']);
    expect(last[header.indexOf('DatasetID')]).toBe(SCN.id);
    const meta = JSON.parse(first[header.indexOf('ExportMetadataJSON')]);
    expect(meta.exportKind).toBe('timecourse_values');
    expect(meta.settings).toMatchObject({
      genesInBundle: N_GENES, genesScoredInArm: N_GENES, genesExported: N_GENES,
    });
    expect(meta.settings.rawValues).toMatchObject({
      genesRequested: N_GENES, genesWritten: N_GENES, rowsWritten: N_ROWS, truncated: 'No',
    });
  }, 20_000);

  it('the workbook writes dense sheets that read back exactly', async () => {
    const bundle = bigBundle(N_GENES);
    const genes = Object.keys(bundle.values);
    const error = vi.spyOn(console, 'error');
    await exportWorkbook([rhythmRow('G1'), rhythmRow('G0', 0.2)], genes, ctx(bundle, { genesScored: N_GENES }));
    expect(error).not.toHaveBeenCalled();
    const { name, blob } = downloadedBlob();
    expect(name).toBe(`${SCN.id}_scn_circadian.xlsx`);
    const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { dense: true });
    expect(wb.SheetNames).toEqual(['Rhythmicity', 'RawValues', 'Metadata']);
    const sheet = (n: string) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1 });

    const results = sheet('Rhythmicity');
    expect(results[0]).toEqual([
      'Gene', 'Method', 'PValue', 'qValue', 'PeriodHours', 'CandidatePeriodsHours', 'AcrophaseHours',
      'Amplitude', 'Mesor', 'F', 'NObservations', 'NTimepoints',
    ]);
    expect(results[1]).toEqual(['G1', 'COSINOR', 0.01, 0.02, 24, '24', 6, 2, 3, 9, 36, 6]);
    expect(results).toHaveLength(3);

    const raw = sheet('RawValues');
    expect(raw).toHaveLength(N_ROWS + 1);
    expect(raw[0]).toEqual(['Gene', 'Sample', 'Arm', 'TimeHours', 'TimeLabel', 'Replicate', 'NormCPM']);
    expect(raw[1]).toEqual(['G0', 'chow_ZT0_1', 'Chow', 0, 'ZT0', 1, 0]);
    expect(raw.at(-1)).toEqual([`G${N_GENES - 1}`, 'hfd_ZT20_3', 'High-fat diet', 20, 'ZT20', 3, N_GENES - 1 + 0.35]);
    // G0 misses chow_ZT8_2: omitted, not written as zero.
    expect(raw.slice(1, 37).some((r) => r[1] === 'chow_ZT8_2')).toBe(false);

    const meta = Object.fromEntries(sheet('Metadata').slice(1).map((r) => [r[0], r[1]]));
    expect(meta.exportKind).toBe('circadian');
    expect(meta['settings.genesInBundle']).toBe(String(N_GENES));
    expect(meta['settings.genesScoredInArm']).toBe(String(N_GENES));
    // The workbook's results sheet holds the two rows passed.
    expect(meta['settings.genesExported']).toBe('2');
    expect(meta['settings.rawValues.rowsWritten']).toBe(String(N_ROWS));
    expect(meta['settings.rawValues.truncated']).toBe('No');
  }, 30_000);
});

describe('correction-family counts in the provenance', () => {
  // Bundle of 1,400 genes, of which the selected arm scored 1,200; the user
  // filtered the table to three. The q-values came from the 1,200-gene family.
  const bundle = bigBundle(N_GENES);
  const filtered = [rhythmRow('G1'), rhythmRow('G2'), rhythmRow('G3')];

  function resultsMetadata(extra: Partial<ExportContext>) {
    exportResultsCSV(filtered, ctx(bundle, extra));
    const [, href] = downloadFile.mock.calls.at(-1) as [string, string];
    const [header, first] = csvDownloadTable(href);
    return JSON.parse(first[header.indexOf('ExportMetadataJSON')]).settings;
  }

  it('records the bundle, the scored family and the exported genes as three counts', () => {
    const settings = resultsMetadata({ genesScored: 1_200 });
    expect(settings.genesInBundle).toBe(N_GENES);
    expect(settings.genesScoredInArm).toBe(1_200);
    expect(settings.genesExported).toBe(3);
    expect(settings).not.toHaveProperty('genesTested');
    expect(settings.correctionFamily).toBe(
      'Benjamini-Hochberg (FDR) was applied across the 1,200 genes scored in Chow, before any table filter. '
      + 'The file holds 3 genes after the table filter; their adjusted values are those from the full family and are not recomputed for the subset.',
    );
  });

  it('says so when the export holds the whole family', () => {
    const settings = resultsMetadata({ genesScored: 3 });
    expect(settings.correctionFamily).toMatch(/across the 3 genes scored in Chow, before any table filter\. The file holds every gene in that family\.$/);
  });

  it('leaves the family size unrecorded rather than guessing it from the bundle', () => {
    const settings = resultsMetadata({});
    expect(settings.genesScoredInArm).toBeNull();
    expect(settings.correctionFamily).toContain('the count was not recorded');
    expect(settings.correctionFamily).not.toContain(String(N_GENES));
  });

  it('names no family when no gene-wise correction was applied', () => {
    const settings = resultsMetadata({ genesScored: 1_200, adjust: 'none' });
    expect(settings.correctionFamily).toMatch(/^No gene-wise correction/);
  });

  it('describes the raw values by the exported genes, not as every scored gene', async () => {
    await exportRawCSV(bundle, ['G1', 'G2'], ctx(bundle, { genesScored: 1_200 }));
    const [, href] = downloadFile.mock.calls.at(-1) as [string, string];
    const [header, first] = csvDownloadTable(href);
    const settings = JSON.parse(first[header.indexOf('ExportMetadataJSON')]).settings;
    expect(settings.genesExported).toBe(2);
    expect(settings.rawValues.scope).not.toMatch(/every scored gene/);
    expect(settings.rawValues.scope).toMatch(/each exported gene/);
  });
});

/** The settings of the CSV the last export handed over as a data: URL. */
function lastDataUrlSettings() {
  const [, href] = downloadFile.mock.calls.at(-1) as [string, string];
  const [header, first] = csvDownloadTable(href);
  return JSON.parse(first[header.indexOf('ExportMetadataJSON')]).settings;
}

/** The workbook the last export handed over, as Metadata field → value. */
async function lastWorkbookMetadata(): Promise<Record<string, unknown>> {
  const blob = blobs[blobs.length - 1];
  const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { dense: true });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Metadata, { header: 1 });
  return Object.fromEntries(rows.slice(1).map((r) => [r[0], r[1]]));
}

const decodeBytes = async (b: Blob) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(await b.arrayBuffer());

describe('raw CSV at the worksheet row cap (review round 2, A)', () => {
  // The reviewer's case: 30,000 genes × 36 libraries, every gene requested.
  // The file held 29,127 whole genes while the metadata said 30,000 were
  // exported and that the file held every gene in the family. Only the head
  // and tail of the ~90 MB file are decoded, to keep the test quick. (This
  // fixture omits one library from every 50th gene, so 29,143 genes fit where
  // the reviewer's complete matrix fitted 29,127.)
  it('records the genes written, and names the cut as a size cap rather than a filter', async () => {
    const bundle = bigBundle(30_000);
    await exportRawCSV(bundle, Object.keys(bundle.values), ctx(bundle, { genesScored: 30_000 }));
    const { blob } = downloadedBlob();
    const head = (await decodeBytes(blob.slice(0, 400_000))).split('\r\n');
    const [header, first] = parseLines(head.slice(0, 2));
    const settings = JSON.parse(first[header.indexOf('ExportMetadataJSON')]).settings;
    const { rawValues } = settings;
    expect(rawValues.genesRequested).toBe(30_000);
    expect(rawValues.genesWritten).toBe(29_143);
    expect(rawValues.rowsWritten).toBeLessThanOrEqual(EXCEL_MAX_ROWS - 1);
    expect(settings.genesExported).toBe(29_143);
    expect(rawValues.truncated).toBe(
      "Yes: cut after 29,143 whole genes so the table fits Excel's 1,048,576-row worksheet limit (one header row). The cut is a size cap, not a filter.",
    );
    expect(settings.correctionFamily).not.toContain('every gene in that family');
    expect(settings.correctionFamily).toContain(
      "The 30,000 genes requested are every gene scored in Chow; the file holds the first 29,143 of them in the table's sort order, cut at a whole gene to fit Excel's 1,048,576-row worksheet limit (a size cap, not a filter).",
    );
    // The file really ends with the last gene the metadata counts, whole.
    const tail = (await decodeBytes(blob.slice(blob.size - 20_000))).split('\r\n').filter(Boolean);
    expect(tail.at(-1)?.startsWith('G29142,hfd_ZT20_3,')).toBe(true);
  }, 30_000);

  // The same cut with a small test-only row limit, read back whole: a table
  // filter and the cut together are reported as two different things.
  it('keeps a table filter and the cut apart when both apply', async () => {
    const bundle = bigBundle(N_GENES);
    const genes = Object.keys(bundle.values).slice(0, 100); // the table filter kept 100 of 1,400
    await exportRawCSV(bundle, genes, ctx(bundle, { genesScored: N_GENES }), 1_001);
    const [, href] = downloadFile.mock.calls.at(-1) as [string, string];
    const [header, ...rows] = csvDownloadTable(href);
    const settings = JSON.parse(rows[0][header.indexOf('ExportMetadataJSON')]).settings;
    // G0 has 35 libraries, G1..G26 have 36: 35 + 26 × 36 = 971 rows; G27 would pass 1,000.
    expect(rows).toHaveLength(971);
    expect(new Set(rows.map((r) => r[0])).size).toBe(27);
    expect(settings.genesExported).toBe(27);
    expect(settings.rawValues).toMatchObject({ genesRequested: 100, genesWritten: 27, rowsWritten: 971 });
    expect(settings.correctionFamily).toBe(
      'Benjamini-Hochberg (FDR) was applied across the 1,400 genes scored in Chow, before any table filter. '
      + 'This file holds raw values only; the adjusted values are in the results export. '
      + 'The table filter selected 100 of the 1,400 genes scored in Chow; the file holds the first 27 of them in the '
      + "table's sort order, cut at a whole gene to fit Excel's 1,001-row worksheet limit (a size cap, not a filter).",
    );
  });

  it('says the file holds every requested gene when nothing was cut', async () => {
    const bundle = bigBundle(N_GENES);
    await exportRawCSV(bundle, ['G1', 'G2', 'nope'], ctx(bundle, { genesScored: N_GENES }));
    const settings = lastDataUrlSettings();
    expect(settings.genesExported).toBe(2);
    expect(settings.correctionFamily).toMatch(/The table filter selected 2 of the 1,400 genes scored in Chow; the file holds all of them\.$/);
    expect(settings.rawValues.truncated).toBe('No');
  });
});

describe('the PValueRaw sentence names a file that has the column (review round 2, B)', () => {
  const bundle = bigBundle(10);
  const none = { adjust: 'none' as const, genesScored: 10 };

  it('the raw CSV, which has no p-value column, does not mention one', async () => {
    await exportRawCSV(bundle, ['G1'], ctx(bundle, none));
    const settings = lastDataUrlSettings();
    expect(settings.correctionFamily).not.toContain('PValueRaw');
    expect(settings.correctionFamily).toMatch(
      /^No gene-wise correction was applied\. This file holds raw values only; the p-values are in the results export\./,
    );
  });

  it('the results CSV and the workbook\'s Rhythmicity sheet name their own column', async () => {
    exportResultsCSV([rhythmRow('G1')], ctx(bundle, none));
    expect(lastDataUrlSettings().correctionFamily)
      .toBe('No gene-wise correction: the PValueRaw column repeats each gene\'s raw p-value.');
    await exportWorkbook([rhythmRow('G1')], ['G1'], ctx(bundle, none));
    expect((await lastWorkbookMetadata())['settings.correctionFamily'])
      .toBe('No gene-wise correction: the Rhythmicity sheet\'s PValueRaw column repeats each gene\'s raw p-value.');
  });
});

describe('JTK effective periods are the complete-schedule family (review round 2, C)', () => {
  const bundle = bigBundle(10);
  const jtk = { method: 'jtk' as const, periods: [20, 24, 28], effectivePeriods: [24], genesScored: 10 };

  it('labels the family and points to each gene\'s own in the results CSV', () => {
    exportResultsCSV([rhythmRow('G1')], ctx(bundle, jtk));
    const settings = lastDataUrlSettings();
    expect(settings.effectiveCandidatePeriodsHours).toBe('24');
    expect(settings.effectiveCandidatePeriodsScope).toBe(
      'JTK_CYCLE: the complete-schedule family, the periods the full sampling schedule (every library observed) supports. '
      + 'A gene with missing observations is tested on the family its own observed times support, which can differ; '
      + 'each gene\'s own family is in the CandidatePeriodsHours column.',
    );
  });

  it('points the raw CSV and the workbook at the column where it actually is', async () => {
    await exportRawCSV(bundle, ['G1'], ctx(bundle, jtk));
    expect(lastDataUrlSettings().effectiveCandidatePeriodsScope)
      .toMatch(/each gene's own family is in the CandidatePeriodsHours column of the results export\.$/);
    await exportWorkbook([rhythmRow('G1')], ['G1'], ctx(bundle, jtk));
    expect((await lastWorkbookMetadata())['settings.effectiveCandidatePeriodsScope'])
      .toMatch(/^JTK_CYCLE: the complete-schedule family.*CandidatePeriodsHours column of the Rhythmicity sheet\.$/);
  });

  it('does not call the requested periods the schedule\'s family when the design was not recorded', () => {
    exportResultsCSV([rhythmRow('G1')], ctx(bundle, { ...jtk, effectivePeriods: undefined }));
    const settings = lastDataUrlSettings();
    expect(settings.effectiveCandidatePeriodsHours).toBe('20, 24, 28');
    expect(settings.effectiveCandidatePeriodsScope).toMatch(
      /^JTK_CYCLE: the family the sampling schedule supports was not recorded; the periods listed are the requested ones\./,
    );
    expect(settings.effectiveCandidatePeriodsScope).not.toContain('complete-schedule family');
  });
});

describe('raw CSV memory (review round 2, D)', () => {
  it('spells the raw rows a block at a time, yielding to the event loop between blocks', async () => {
    const bundle = bigBundle(N_GENES); // 50,372 rows: three blocks of about 20,000
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const pending = exportRawCSV(bundle, Object.keys(bundle.values), ctx(bundle, { genesScored: N_GENES }));
    // Nothing is handed over synchronously: the writer yields after the first block.
    expect(downloadFile).not.toHaveBeenCalled();
    await pending;
    expect(downloadFile).toHaveBeenCalledTimes(1);
    expect(timeout.mock.calls.filter(([, ms]) => ms === 0).length).toBeGreaterThanOrEqual(3);
  }, 20_000);
});
