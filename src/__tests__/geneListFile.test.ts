// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GENE_LIST_MAX_BYTES, describeGeneListSource, geneListFileText, parseGeneListFile,
  parseGeneListText, pickGeneColumn, resolveGeneList, saveGeneList,
} from '../utils/geneListFile';
import { loadAliasIndex, _resetNomenclature } from '../data/nomenclature';
import { _resetBundleCache } from '../data/bundleSource';

// The gene-list seam: what "automatic detection" actually commits to.
//
// Every case here is a file shape someone has handed a gene-list box in the
// wild — a one-per-line list saved from a text editor (with Windows line
// endings and Excel's BOM), a differential-expression table with the symbols
// in one column and numbers in the rest, a comma list pasted on one line, a
// GMT, a workbook — and the assertion is the list that should come out of it.

// Observe the two download transports instead of letting them run: the
// text formats go through downloadFile, the workbook through writeWorkbook.
const downloadFile = vi.fn((..._args: unknown[]) => {});
const writeWorkbook = vi.fn((..._args: unknown[]) => Promise.resolve());
vi.mock('../utils/exportAction', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/exportAction')>()),
  downloadFile: (...args: unknown[]) => downloadFile(...args),
}));
vi.mock('../utils/workbook', () => ({
  writeWorkbook: (...args: unknown[]) => writeWorkbook(...args),
}));

describe('parseGeneListText — plain lists', () => {
  it('reads one symbol per line, through CRLF, a BOM, blanks and # comments', () => {
    const text = '﻿# my list\r\nPOMC\r\n\r\nAGRP\r\nNPY\r\n';
    expect(parseGeneListText(text)).toEqual({ genes: ['POMC', 'AGRP', 'NPY'], format: 'text', column: null });
  });

  it('drops an exact duplicate but keeps a case variant (resolution decides those)', () => {
    expect(parseGeneListText('POMC\nPOMC\nPomc\n').genes).toEqual(['POMC', 'Pomc']);
  });

  it('skips a lone header over a single column', () => {
    expect(parseGeneListText('Gene\nPOMC\nAGRP\n')).toEqual({ genes: ['POMC', 'AGRP'], format: 'text', column: 'Gene' });
    expect(parseGeneListText('symbol\nPOMC\n').column).toBe('symbol');
  });

  it('takes every token of a one-line paste, whatever separates them', () => {
    expect(parseGeneListText('POMC, AGRP, NPY').genes).toEqual(['POMC', 'AGRP', 'NPY']);
    expect(parseGeneListText('POMC AGRP\tNPY').genes).toEqual(['POMC', 'AGRP', 'NPY']);
    expect(parseGeneListText('POMC;AGRP;NPY').genes).toEqual(['POMC', 'AGRP', 'NPY']);
  });

  it('takes every token of a whitespace list that wraps over several lines', () => {
    expect(parseGeneListText('POMC AGRP NPY\nLEPR MC4R\nCARTPT').genes)
      .toEqual(['POMC', 'AGRP', 'NPY', 'LEPR', 'MC4R', 'CARTPT']);
  });

  it('keeps the symbols real data carries and rejects what is never one', () => {
    const { genes } = parseGeneListText('mt-Rnr2\nHLA-DRB1\n5S_rRNA\n1700001C02Rik\nLOC102123\nNA\nnan\n1.5\n-0.3\n3e-05\n');
    expect(genes).toEqual(['mt-Rnr2', 'HLA-DRB1', '5S_rRNA', '1700001C02Rik', 'LOC102123']);
  });
});

describe('parseGeneListText — tables', () => {
  it('reads the column headed Gene out of the app’s own CSV export', () => {
    const csv = 'Gene,logFC,PValue,FDR,Stars,MeanNormalCPM\nPOMC,1.2,0.001,0.02,***,11\nTBX3,-0.8,0.05,0.15,*,47.7\n';
    expect(parseGeneListText(csv)).toEqual({ genes: ['POMC', 'TBX3'], format: 'csv', column: 'Gene' });
  });

  it('finds the gene column wherever it is, under any of the usual headers', () => {
    expect(parseGeneListText('logFC\tsymbol\n1.2\tPOMC\n-0.8\tTBX3\n')).toMatchObject({ genes: ['POMC', 'TBX3'], column: 'symbol', format: 'tsv' });
    expect(parseGeneListText('baseMean,gene_name,padj\n10,Pomc,0.01\n').genes).toEqual(['Pomc']);
    expect(parseGeneListText('GeneID,Score\nAGRP,3\n').column).toBe('GeneID');
    expect(parseGeneListText('external_gene_name;fc\nNpy;2\n').column).toBe('external_gene_name');
    expect(parseGeneListText('Gene Symbol,x\nLEPR,1\n').column).toBe('Gene Symbol');
  });

  it('without a header, takes the column whose cells look like symbols', () => {
    // A DE table saved without its header: numbers everywhere but column 0.
    expect(parseGeneListText('POMC,1.2,0.001\nTBX3,-0.8,0.05\n')).toEqual({ genes: ['POMC', 'TBX3'], format: 'csv', column: null });
    // …and when the symbols are NOT in the first column.
    expect(parseGeneListText('1.2\t0.001\tPOMC\n-0.8\t0.05\tTBX3\n').genes).toEqual(['POMC', 'TBX3']);
  });

  it('keeps a delimited table as a table — "POMC,up" is a gene and a label', () => {
    expect(parseGeneListText('POMC,up\nAGRP,down\n').genes).toEqual(['POMC', 'AGRP']);
  });

  it('unquotes CSV cells, including a quoted delimiter and a doubled quote', () => {
    expect(parseGeneListText('"Gene","Name"\n"POMC","pro-opiomelanocortin, alpha"\n"AGRP","agouti ""related"""\n'))
      .toMatchObject({ genes: ['POMC', 'AGRP'], column: 'Gene' });
  });

  it('is not turned into a table by one stray comma in a long list', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `GENE${i}`);
    lines[3] = 'GENE3,';
    const { genes, format } = parseGeneListText(lines.join('\n'));
    expect(format).toBe('text');
    // …and the stray separator is not part of the symbol.
    expect(genes).toHaveLength(20);
    expect(genes).toContain('GENE3');
  });
});

describe('parseGeneListText — GMT and JSON', () => {
  it('merges every set in a GMT, by extension', () => {
    const gmt = 'HALLMARK_A\thttp://x\tPOMC\tAGRP\nHALLMARK_B\tna\tAGRP\tNPY\n';
    expect(parseGeneListText(gmt, 'sets.gmt')).toEqual({ genes: ['POMC', 'AGRP', 'NPY'], format: 'gmt', column: null, sets: 2 });
  });

  it('reads a JSON array, a {genes: […]} object, and an array of records', () => {
    expect(parseGeneListText('["POMC", "AGRP"]')).toEqual({ genes: ['POMC', 'AGRP'], format: 'json', column: null });
    expect(parseGeneListText('{"genes": ["NPY"]}', 'x.json').genes).toEqual(['NPY']);
    expect(parseGeneListText('[{"symbol": "LEPR", "score": 1}, {"symbol": "MC4R"}]'))
      .toEqual({ genes: ['LEPR', 'MC4R'], format: 'json', column: 'symbol' });
  });

  it('falls through to the text reader when the JSON is not a gene list', () => {
    // A JSON-looking first line that is really just a symbol list with braces.
    expect(parseGeneListText('{"a": 1}\nPOMC\n').genes).toContain('POMC');
  });
});

describe('pickGeneColumn', () => {
  it('breaks a tie toward the leftmost column', () => {
    expect(pickGeneColumn([['A1', 'B1'], ['A2', 'B2']]).genes).toEqual(['A1', 'A2']);
  });

  it('returns nothing for an empty table', () => {
    expect(pickGeneColumn([])).toEqual({ genes: [], column: null });
    expect(pickGeneColumn([['', '']])).toEqual({ genes: [], column: null });
  });
});

describe('parseGeneListFile', () => {
  it('reads a text file through FileReader', async () => {
    const file = new File(['POMC\nAGRP\n'], 'list.txt', { type: 'text/plain' });
    await expect(parseGeneListFile(file)).resolves.toMatchObject({ genes: ['POMC', 'AGRP'], format: 'text' });
  });

  it('steers GMT by the filename', async () => {
    const file = new File(['S1\tdesc\tPOMC\tNPY\n'], 'sets.gmt');
    await expect(parseGeneListFile(file)).resolves.toMatchObject({ genes: ['POMC', 'NPY'], format: 'gmt', sets: 1 });
  });

  it('refuses a file no gene list could be', async () => {
    const file = new File([new ArrayBuffer(GENE_LIST_MAX_BYTES + 1)], 'huge.txt');
    await expect(parseGeneListFile(file)).rejects.toThrow(/huge\.txt is 25 MB/);
  });

  it('reads the first non-empty sheet of a real workbook and its Gene column', async () => {
    // The real xlsx, loaded the way the app loads it (dynamically — a static
    // import here would trip the chunk-boundary guard, and rightly so).
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'Empty');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Gene', 'logFC', 'PValue'],
      ['POMC', 1.2, 0.001],
      ['TBX3', -0.8, 0.05],
      ['NA', '', ''],
    ]), 'Summary');
    const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const file = new File([bytes], 'e9_genes_export.xlsx');
    const parsed = await parseGeneListFile(file);
    expect(parsed).toEqual({ genes: ['POMC', 'TBX3'], format: 'excel', column: 'Gene', sheet: 'Summary' });
    expect(describeGeneListSource(parsed)).toBe('Excel workbook · sheet “Summary” · column “Gene”');
  });

  it('reads a headerless workbook by what its cells look like', async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[1.5, 'Pomc'], [0.2, 'Agrp']]), 'Sheet1');
    const file = new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer], 'de.xls');
    await expect(parseGeneListFile(file)).resolves.toMatchObject({ genes: ['Pomc', 'Agrp'], column: null, sheet: 'Sheet1' });
  });
});

describe('describeGeneListSource', () => {
  it('says how the list was read, in the words the dialog shows', () => {
    expect(describeGeneListSource({ genes: [], format: 'text', column: null })).toBe('plain text');
    expect(describeGeneListSource({ genes: [], format: 'csv', column: 'Gene' })).toBe('comma-separated table · column “Gene”');
    expect(describeGeneListSource({ genes: [], format: 'tsv', column: null }))
      .toBe('tab-separated table · no header recognised, column chosen by its contents');
    expect(describeGeneListSource({ genes: [], format: 'gmt', column: null, sets: 1 })).toBe('GMT gene sets · 1 set merged');
  });
});

// ── Resolution ──────────────────────────────────────────────────────────────

const ALIAS_FIXTURE = {
  v: 1,
  rows: [
    // Macaque stores the retired AARS; HGNC's current symbol is AARS1.
    ['AARS', 0, 1, 'AARS1', '', ''],
    ['AGRP', 0, 0, 0, 'Agrt|ART|ASIP2', ''],
    // One alias that two stored genes share — must fail closed.
    ['GENEA', 0, 0, 0, 'SHARED', ''],
    ['GENEB', 0, 0, 0, 'SHARED', ''],
  ],
};

describe('resolveGeneList', () => {
  beforeEach(() => {
    _resetNomenclature();
    _resetBundleCache();
    (globalThis as any).HX_NOMENCLATURE_ALIASES = ALIAS_FIXTURE;
    (globalThis as any).window.HX_NOMENCLATURE_ALIASES = ALIAS_FIXTURE;
  });
  afterEach(() => {
    (globalThis as any).HX_NOMENCLATURE_ALIASES = undefined;
    (globalThis as any).window.HX_NOMENCLATURE_ALIASES = undefined;
    _resetNomenclature();
    _resetBundleCache();
  });

  const stored = ['POMC', 'AGRP', 'AARS', 'GENEA', 'GENEB'];

  it('matches the dataset’s own spelling case-insensitively and reports the rest as missing', () => {
    const r = resolveGeneList(['Pomc', 'agrp', 'NOPE'], stored, null);
    expect(r.found).toEqual(['POMC', 'AGRP']);
    expect(r.missing).toEqual(['NOPE']);
    expect(r.redirected).toEqual([]);
    expect(r.duplicates).toBe(0);
  });

  it('counts a second spelling of a found gene as a duplicate, not a second gene', () => {
    const r = resolveGeneList(['POMC', 'Pomc', 'POMC'], stored, null);
    expect(r.found).toEqual(['POMC']);
    expect(r.duplicates).toBe(2);
  });

  it('redirects through the alias index — the current symbol, an alias — to the stored spelling', async () => {
    const index = await loadAliasIndex();
    expect(index).toBeTruthy();
    const r = resolveGeneList(['AARS1', 'ASIP2'], stored, index, 'HGNC');
    expect(r.found).toEqual(['AARS', 'AGRP']);
    expect(r.redirected).toEqual([{ from: 'AARS1', to: 'AARS' }, { from: 'ASIP2', to: 'AGRP' }]);
    expect(r.missing).toEqual([]);
  });

  it('does not double-select a gene named both directly and by alias', async () => {
    const r = resolveGeneList(['AGRP', 'ASIP2'], stored, await loadAliasIndex(), 'HGNC');
    expect(r.found).toEqual(['AGRP']);
    expect(r.redirected).toEqual([]);
    expect(r.duplicates).toBe(1);
  });

  it('fails closed on an alias shared by several stored genes', async () => {
    const r = resolveGeneList(['SHARED'], stored, await loadAliasIndex(), 'HGNC');
    expect(r.found).toEqual([]);
    expect(r.ambiguous).toEqual([{ from: 'SHARED', to: ['GENEA', 'GENEB'] }]);
    expect(r.missing).toEqual([]);
  });

  it('works without the index: a redirect becomes a miss, nothing else changes', () => {
    const r = resolveGeneList(['AARS1', 'POMC'], stored, null, 'HGNC');
    expect(r.found).toEqual(['POMC']);
    expect(r.missing).toEqual(['AARS1']);
  });

  it('ignores blank names', () => {
    expect(resolveGeneList(['', '  ', 'POMC'], stored, null).found).toEqual(['POMC']);
  });
});

// ── Saving ──────────────────────────────────────────────────────────────────

describe('geneListFileText', () => {
  const rows = [
    { Gene: 'POMC', Direction: 'up', log2FC: 1.2 },
    { Gene: 'AGRP', Direction: 'down, sort of', log2FC: -0.5 },
  ];

  it('writes txt as one symbol per line with a trailing newline, and nothing else', () => {
    expect(geneListFileText(rows, 'txt')).toBe('POMC\nAGRP\n');
    expect(geneListFileText([], 'txt')).toBe('');
  });

  it('writes csv with the row’s columns in order, quoting what needs it', () => {
    expect(geneListFileText(rows, 'csv')).toBe('Gene,Direction,log2FC\nPOMC,up,1.2\nAGRP,"down, sort of",-0.5\n');
    expect(geneListFileText([{ Gene: 'A"B' }], 'csv')).toBe('Gene\n"A""B"\n');
    expect(geneListFileText([], 'csv')).toBe('Gene\n');
  });
});

describe('saveGeneList', () => {
  beforeEach(() => { downloadFile.mockClear(); writeWorkbook.mockClear(); });

  it('sends the text formats through downloadFile as a data URL under the sanitised name', async () => {
    await saveGeneList(['e9', 'gene_list'], [{ Gene: 'POMC' }, { Gene: 'AGRP' }], 'txt');
    expect(downloadFile).toHaveBeenCalledTimes(1);
    const [name, href] = downloadFile.mock.calls[0] as [string, string];
    expect(name).toBe('e9_gene_list.txt');
    expect(href.startsWith('data:text/plain;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(href.split(',')[1])).toBe('POMC\nAGRP\n');

    await saveGeneList(['a/b', 'x'], [{ Gene: 'POMC' }], 'csv');
    expect(downloadFile.mock.calls[1][0]).toBe('a_b_x.csv');
    expect(String(downloadFile.mock.calls[1][1]).startsWith('data:text/csv')).toBe(true);
  });

  it('sends the workbook format through the workbook seam as one GeneList sheet', async () => {
    const rows = [{ Gene: 'POMC', Direction: 'up' }];
    await saveGeneList(['e9', 'threshold_genes'], rows, 'xlsx');
    expect(downloadFile).not.toHaveBeenCalled();
    expect(writeWorkbook).toHaveBeenCalledWith('e9_threshold_genes.xlsx', [{ name: 'GeneList', rows }]);
  });
});
