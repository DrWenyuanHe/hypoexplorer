import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cellChunks, writeCsv, type CsvCell } from '../utils/csv';
import { exportProvenance, trackSubject } from '../utils/exportProvenance';
import { csvDownloadTable, csvDownloadText } from './csvDownload';
import { makePopData, MACAQUE_DATASET } from './fixtures';

// The CSV seam is the one place a table becomes a downloaded .csv: these tests
// pin its byte policy (BOM, CRLF, minimal quoting), the spreadsheet formula
// guard, the provenance columns and the hand-off to the export-action seam.

const downloadFile = vi.hoisted(() => vi.fn());
vi.mock('../utils/exportAction', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  downloadFile,
}));

/** The file text for one row holding `value` under header `x`. */
function fileFor(value: CsvCell): string {
  writeCsv('t.csv', ['x'], [[value]]);
  const [, href] = downloadFile.mock.calls.at(-1) as [string, string];
  return csvDownloadText(href);
}

/** How one cell is spelled in the file. */
const spelled = (value: CsvCell) => fileFor(value).slice('\uFEFFx\r\n'.length, -'\r\n'.length);

beforeEach(() => downloadFile.mockClear());

describe('writeCsv — file bytes', () => {
  it('hands the named file to downloadFile as a UTF-8 CSV data URL', () => {
    writeCsv('e9_genes_summary.csv', ['Gene'], [['POMC']]);
    expect(downloadFile).toHaveBeenCalledTimes(1);
    const [name, href] = downloadFile.mock.calls[0] as [string, string];
    expect(name).toBe('e9_genes_summary.csv');
    expect(href.startsWith('data:text/csv;charset=utf-8,')).toBe(true);
  });

  it('starts with a byte-order mark and ends every record, the last included, with CRLF', () => {
    writeCsv('t.csv', ['Gene', 'logFC'], [['POMC', 1.2], ['AGRP', -0.5]]);
    expect(csvDownloadText(downloadFile.mock.calls[0][1])).toBe('\uFEFFGene,logFC\r\nPOMC,1.2\r\nAGRP,-0.5\r\n');
  });

  it('writes the header alone when there are no rows', () => {
    writeCsv('t.csv', ['Gene'], []);
    expect(csvDownloadText(downloadFile.mock.calls[0][1])).toBe('\uFEFFGene\r\n');
  });

  it('keeps non-ASCII text, which is what the BOM is for', () => {
    expect(spelled('Lei et al. – β-cell, 2024')).toBe('"Lei et al. – β-cell, 2024"');
  });
});

describe('writeCsv — cell escaping', () => {
  it.each<[CsvCell, string]>([
    ['POMC', 'POMC'],
    ['', ''],
    [null, ''],
    [undefined, ''],
    [0, '0'],
    [1.2e-7, '1.2e-7'],
    [true, 'true'],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['line\nbreak', '"line\nbreak"'],
    ['line\r\nbreak', '"line\r\nbreak"'],
    ['Signaling by NOTCH1 t(7;9)', 'Signaling by NOTCH1 t(7;9)'],
  ])('spells %j as %j', (value, expected) => {
    expect(spelled(value)).toBe(expected);
  });

  it('round-trips awkward cells through a CSV parser', () => {
    const row: CsvCell[] = ['a,b', 'say "hi"', 'x\r\ny', null, -1.25];
    writeCsv('t.csv', ['A', 'B', 'C', 'D', 'E'], [row]);
    expect(csvDownloadTable(downloadFile.mock.calls[0][1])).toEqual([
      ['A', 'B', 'C', 'D', 'E'],
      ['a,b', 'say "hi"', 'x\r\ny', '', '-1.25'],
    ]);
  });
});

describe('writeCsv — spreadsheet formula guard', () => {
  it.each<[string, string]>([
    ['=SUM(A1:A2)', "'=SUM(A1:A2)"],
    ['+cmd', "'+cmd"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['  =1+1', "'  =1+1"],
    ['\tvalue', "'\tvalue"],
    ['-', "'-"],
    // Quoted after the prefix when the text also needs quoting.
    ['=HYPERLINK("http://x","y")', `"'=HYPERLINK(""http://x"",""y"")"`],
  ])('prefixes the string %j with an apostrophe', (value, expected) => {
    expect(spelled(value)).toBe(expected);
  });

  it.each<[number, string]>([
    [-1.25, '-1.25'],
    [-0, '0'],
    [-3e-8, '-3e-8'],
    [-Infinity, '-Infinity'],
  ])('never prefixes the number %j', (value, expected) => {
    expect(spelled(value)).toBe(expected);
  });

  it.each(['-1.25', '+3', '-.5', '+3e-4', '-2E+10'])(
    'leaves the string %j alone: a spreadsheet reads it as a number, not a formula',
    (value) => { expect(spelled(value)).toBe(value); },
  );

  it('leaves symbols, pathway names and labels that merely contain a trigger alone', () => {
    for (const value of ['HLA-DRB1*04', 'NKX2-1', 'Chow P0 vs HFD P0', 'a=b', 'user@host', '5-8S-rRNA'])
      expect(spelled(value)).toBe(value);
  });

  it('guards header cells too', () => {
    writeCsv('t.csv', ['=cmd'], []);
    expect(csvDownloadText(downloadFile.mock.calls[0][1])).toBe("\uFEFF'=cmd\r\n");
  });
});

describe('writeCsv — provenance columns', () => {
  const provenance = exportProvenance(
    'genes_summary', trackSubject(makePopData({ dataset: MACAQUE_DATASET, meta: { code: 'e9' } })), {},
  );

  it('appends the shared columns after the caller’s own, with the JSON once in the first data row', () => {
    writeCsv('t.csv', ['Gene', 'logFC'], [['POMC', 1.2], ['AGRP', -0.5]], { provenance });
    const [header, first, second] = csvDownloadTable(downloadFile.mock.calls[0][1]);
    expect(header).toEqual([
      'Gene', 'logFC', 'DatasetID', 'SourceAccession', 'TrackID', 'ContrastID', 'ContrastDirection',
      'ExpressionUnit', 'ExportMetadataJSON',
    ]);
    expect(first.slice(0, 2)).toEqual(['POMC', '1.2']);
    expect(first[header.indexOf('DatasetID')]).toBe(MACAQUE_DATASET.id);
    expect(second[header.indexOf('DatasetID')]).toBe(MACAQUE_DATASET.id);
    expect(second[header.indexOf('TrackID')]).toBe('e9');
    expect(JSON.parse(first[header.indexOf('ExportMetadataJSON')]).exportKind).toBe('genes_summary');
    expect(second[header.indexOf('ExportMetadataJSON')]).toBe('');
  });

  it('lets each row of a long table name its own track, keeping the file JSON once', () => {
    const track = (code: string) => exportProvenance(
      'compare', trackSubject(makePopData({ dataset: MACAQUE_DATASET, meta: { code } })), {},
    );
    const own = [track('e9'), track('i23')];
    writeCsv('t.csv', ['Population'], [['e9'], ['i23']], { provenance, rowProvenance: (i) => own[i] });
    const [header, first, second] = csvDownloadTable(downloadFile.mock.calls[0][1]);
    expect(first[header.indexOf('TrackID')]).toBe('e9');
    expect(second[header.indexOf('TrackID')]).toBe('i23');
    // The file-level snapshot is the export's, not the first row's track.
    expect(JSON.parse(first[header.indexOf('ExportMetadataJSON')]).exportKind).toBe('genes_summary');
    expect(second[header.indexOf('ExportMetadataJSON')]).toBe('');
  });

  it('splits a metadata JSON longer than a spreadsheet cell down its column', () => {
    const many = exportProvenance(
      'genes_summary', trackSubject(makePopData({ dataset: MACAQUE_DATASET, meta: { code: 'e9' } })),
      { note: 'x'.repeat(70_000) },
    );
    writeCsv('t.csv', ['Gene'], [['POMC'], ['AGRP']], { provenance: many });
    const table = csvDownloadTable(downloadFile.mock.calls[0][1]);
    const col = table[0].indexOf('ExportMetadataJSON');
    const pieces = table.slice(1).map((row) => row[col]);
    // Two data rows, then a third row that only continues the JSON.
    expect(table).toHaveLength(4);
    expect(table[3][0]).toBe('');
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(32_767);
    expect(JSON.parse(pieces.join('')).settings.note).toHaveLength(70_000);
  });

  it('never starts a piece where the formula guard would alter it', () => {
    const text = `${'a'.repeat(9)}-1=2+3@x 😀${'b'.repeat(20)}`;
    const pieces = cellChunks(text, 10);
    expect(pieces.join('')).toBe(text);
    for (const piece of pieces.slice(1)) expect(piece).not.toMatch(/^[\s=+\-@]/);
    for (const piece of pieces) expect(piece).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it('writes the provenance header even when there are no rows', () => {
    writeCsv('t.csv', ['Gene'], [], { provenance });
    const table = csvDownloadTable(downloadFile.mock.calls[0][1]);
    expect(table).toHaveLength(1);
    expect(table[0].at(-1)).toBe('ExportMetadataJSON');
  });
});
