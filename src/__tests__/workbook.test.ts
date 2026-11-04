// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The workbook module — the one place sheet rows become a downloaded .xlsx.
// Mock the xlsx package itself so the real writeWorkbook → withXLSX →
// import('xlsx') path is exercised, and assert the exact call protocol every
// export handler now relies on: one book, one json_to_sheet per sheet (rows
// passed through unchanged), sheets appended in input order under their given
// names, one writeFile with the given filename.

const bookNew = vi.fn(() => ({ SheetNames: [] }));
const jsonToSheet = vi.fn((rows: unknown) => ({ __rows: rows }));
const bookAppendSheet = vi.fn();
const writeFile = vi.fn();

vi.mock('xlsx', () => ({
  utils: {
    book_new: bookNew,
    json_to_sheet: jsonToSheet,
    book_append_sheet: bookAppendSheet,
  },
  writeFile,
}));

import { writeWorkbook } from '../utils/workbook';

describe('writeWorkbook', () => {
  beforeEach(() => {
    bookNew.mockClear();
    jsonToSheet.mockClear();
    bookAppendSheet.mockClear();
    writeFile.mockClear();
  });

  it('appends each sheet in order under its name and writes the file once', async () => {
    const summary = [{ Gene: 'POMC', logFC: 1.5 }];
    const raw = [{ Gene: 'POMC', Sample: 'S1', NormCPM: 10 }];
    await writeWorkbook('e9_genes_export.xlsx', [
      { name: 'Summary', rows: summary },
      { name: 'RawValues', rows: raw },
    ]);

    expect(bookNew).toHaveBeenCalledTimes(1);
    expect(jsonToSheet).toHaveBeenCalledTimes(2);
    expect(jsonToSheet).toHaveBeenNthCalledWith(1, summary);
    expect(jsonToSheet).toHaveBeenNthCalledWith(2, raw);
    expect(bookAppendSheet.mock.calls.map((c) => c[2])).toEqual(['Summary', 'RawValues']);
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile.mock.calls[0][1]).toBe('e9_genes_export.xlsx');
  });

  it('still appends a sheet when its rows are empty', async () => {
    await writeWorkbook('empty.xlsx', [{ name: 'Nothing', rows: [] }]);
    expect(jsonToSheet).toHaveBeenCalledWith([]);
    expect(bookAppendSheet.mock.calls.map((c) => c[2])).toEqual(['Nothing']);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it('never rejects — a throwing export body is contained by the lazyExport policy', async () => {
    writeFile.mockImplementationOnce(() => { throw new Error('disk full'); });
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(writeWorkbook('boom.xlsx', [{ name: 'S', rows: [] }])).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    alert.mockRestore();
    consoleError.mockRestore();
  });
});
