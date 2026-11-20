import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cellChunks, csvBlockPieces, csvChunks, LARGE_CSV_CHARS, writeCsv, writeCsvBlocks, type CsvCell,
} from '../utils/csv';
import { exportProvenance, trackSubject } from '../utils/exportProvenance';
import { csvDownloadTable, csvDownloadText } from './csvDownload';
import { makePopData, MACAQUE_DATASET } from './fixtures';
import { loadExportEvidence } from '../utils/lazyExport';

// Export snapshots record the internal QC ledger, which the app loads on the
// first export (utils/lazyExport.ts). Snapshots below are built at module scope.
await loadExportEvidence();

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

const EOL_TEXT = '\r\n';
const BOM_TEXT = String.fromCharCode(0xfeff);

describe('writeCsv — large files in pieces', () => {
  const provenance = exportProvenance(
    'genes_summary', trackSubject(makePopData({ dataset: MACAQUE_DATASET, meta: { code: 'e9' } })),
    { note: 'x'.repeat(70_000) },
  );
  const rows: CsvCell[][] = [
    ['=cmd', 'a,b', null], ['say "hi"', -1.25, 0], ['line\nbreak', '-1.25', true], ['', undefined, 'z'],
  ];

  it('spells the same bytes in pieces as in one string, whatever the piece size', () => {
    writeCsv('t.csv', ['A', 'B', 'C'], rows, { provenance });
    const whole = csvDownloadText(downloadFile.mock.calls[0][1]);
    for (const size of [1, 2, 3, 10_000]) {
      const pieces = csvChunks(['A', 'B', 'C'], rows, { provenance }, size);
      expect(pieces.join('')).toBe(whole);
      if (size === 1) expect(pieces.length).toBe(rows.length);
    }
    // The per-row provenance path joins to the same layout.
    const own = (i: number) => exportProvenance(
      'compare', trackSubject(makePopData({ dataset: MACAQUE_DATASET, meta: { code: `p${i}` } })), {},
    );
    writeCsv('t.csv', ['A', 'B', 'C'], rows, { provenance, rowProvenance: own });
    expect(csvChunks(['A', 'B', 'C'], rows, { provenance, rowProvenance: own }, 1).join(''))
      .toBe(csvDownloadText(downloadFile.mock.calls[1][1]));
    // A row with no cells of its own still gets its provenance cells, unprefixed by a comma.
    expect(csvChunks([], [[]], { provenance }).join('').split(EOL_TEXT)[1].startsWith(MACAQUE_DATASET.id)).toBe(true);
  });

  describe('past the data: URL limit', () => {
    let parts: BlobPart[][] = [];
    let blobs: Blob[] = [];
    beforeEach(() => {
      parts = [];
      blobs = [];
      const RealBlob = Blob;
      vi.stubGlobal('Blob', class extends RealBlob {
        constructor(blobParts?: BlobPart[], options?: BlobPropertyBag) {
          super(blobParts, options);
          parts.push(blobParts ?? []);
        }
      });
      vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
        blobs.push(blob as Blob);
        return 'blob:test/1';
      });
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    it('hands the browser a Blob built from pieces, never one whole-file string', async () => {
      const n = 60_000; // ~2.9 million characters
      const big: CsvCell[][] = Array.from({ length: n }, (_, i) => [`GENE${i}`, i / 7, i % 3 ? 'x' : '=f']);
      writeCsv('big.csv', ['Gene', 'Value', 'Note'], big, { provenance });
      const [name, href] = downloadFile.mock.calls[0] as [string, string];
      expect(name).toBe('big.csv');
      expect(href).toBe('blob:test/1');
      expect(blobs[0].type).toBe('text/csv;charset=utf-8');
      const pieces = parts[0] as string[];
      expect(pieces.length).toBe(Math.ceil(n / 10_000));
      const longest = Math.max(...pieces.map((p) => p.length));
      const total = pieces.reduce((sum, p) => sum + p.length, 0);
      expect(total).toBeGreaterThan(LARGE_CSV_CHARS);
      expect(longest).toBeLessThan(total / 3);
      // The bytes are the joined pieces, BOM and guards included.
      const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await blobs[0].arrayBuffer());
      expect(text).toBe(csvChunks(['Gene', 'Value', 'Note'], big, { provenance }).join(''));
      expect(text.startsWith(`${BOM_TEXT}Gene,Value,Note,DatasetID,`)).toBe(true);
      const lines = text.split(EOL_TEXT);
      expect(lines).toHaveLength(n + 2);
      expect(lines[1].startsWith("GENE0,0,'=f,")).toBe(true);
      expect(lines[n].startsWith(`GENE${n - 1},${(n - 1) / 7},x,`)).toBe(true);
      expect(lines[n + 1]).toBe('');
    });

    it('keeps a small file a data: URL', () => {
      writeCsv('t.csv', ['Gene'], [['POMC']]);
      expect(String(downloadFile.mock.calls[0][1]).startsWith('data:text/csv;charset=utf-8,')).toBe(true);
      expect(blobs).toHaveLength(0);
    });

    it('writeCsvBlocks moves each piece into a Blob once past the limit, and the bytes match writeCsv', async () => {
      const n = 60_000;
      const big: CsvCell[][] = Array.from({ length: n }, (_, i) => [`GENE${i}`, i / 7, i % 3 ? 'x' : '=f']);
      const blocks = Array.from({ length: 6 }, (_, b) => big.slice(b * 10_000, (b + 1) * 10_000));
      await writeCsvBlocks('big.csv', ['Gene', 'Value', 'Note'], blocks, { provenance });
      const [name, href] = downloadFile.mock.calls[0] as [string, string];
      expect(name).toBe('big.csv');
      expect(href).toBe('blob:test/1');
      expect(blobs).toHaveLength(1);
      expect(blobs[0].type).toBe('text/csv;charset=utf-8');
      // Pieces past the limit went into Blobs as they were made, not held as text to the end.
      expect((parts.at(-1) as BlobPart[]).some((part) => part instanceof Blob)).toBe(true);
      const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await blobs[0].arrayBuffer());
      expect(text).toBe(csvChunks(['Gene', 'Value', 'Note'], big, { provenance }).join(''));
    });
  });
});

describe('writeCsvBlocks — rows a block at a time', () => {
  const provenance = exportProvenance(
    'genes_summary', trackSubject(makePopData({ dataset: MACAQUE_DATASET, meta: { code: 'e9' } })),
    { note: 'x'.repeat(70_000) },
  );
  const rows: CsvCell[][] = [
    ['=cmd', 'a,b', null], ['say "hi"', -1.25, 0], ['line\nbreak', '-1.25', true], ['', undefined, 'z'],
  ];
  const own = (i: number) => exportProvenance(
    'compare', trackSubject(makePopData({ dataset: MACAQUE_DATASET, meta: { code: `p${i}` } })), {},
  );

  it('spells exactly the bytes csvChunks spells, however the rows are blocked', () => {
    const cases: Array<[CsvCell[][][], Parameters<typeof csvChunks>[2]]> = [
      [[rows], { provenance }],
      [[rows.slice(0, 1), [], rows.slice(1, 3), rows.slice(3)], { provenance }],
      [[rows.slice(0, 2), rows.slice(2)], { provenance, rowProvenance: own }],
      // One row: the long metadata JSON continues on rows of its own.
      [[rows.slice(0, 1)], { provenance }],
      [[], { provenance }],
      [[rows], {}],
    ];
    for (const [blocks, options] of cases) {
      expect([...csvBlockPieces(['A', 'B', 'C'], blocks, options)].join(''))
        .toBe(csvChunks(['A', 'B', 'C'], blocks.flat(), options).join(''));
    }
  });

  it('writes a small file as the same data: URL writeCsv writes', async () => {
    writeCsv('t.csv', ['A', 'B', 'C'], rows, { provenance, rowProvenance: own });
    await writeCsvBlocks('t.csv', ['A', 'B', 'C'], [rows.slice(0, 3), rows.slice(3)], { provenance, rowProvenance: own });
    expect(downloadFile.mock.calls[1]).toEqual(downloadFile.mock.calls[0]);
  });

  it('pulls one block at a time and yields to the event loop between blocks', async () => {
    const pulled: number[] = [];
    function* blocks() {
      for (let b = 0; b < 3; b++) { pulled.push(b); yield [[`row${b}`]]; }
    }
    const pending = writeCsvBlocks('t.csv', ['x'], blocks());
    // Synchronously, only the first block has been spelled; the rest wait for later tasks.
    expect(pulled).toEqual([0]);
    expect(downloadFile).not.toHaveBeenCalled();
    await pending;
    expect(pulled).toEqual([0, 1, 2]);
    expect(csvDownloadText(downloadFile.mock.calls[0][1])).toBe(`${BOM_TEXT}x\r\nrow0\r\nrow1\r\nrow2\r\n`);
  });
});
