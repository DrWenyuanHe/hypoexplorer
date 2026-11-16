// The CSV seam: the one place a table becomes a downloaded .csv file.
//
// It sits beside the workbook seam (utils/workbook.ts, which turns sheets into
// an .xlsx file) and goes out through the export-action seam's transport
// (`downloadFile`). The export-provenance module still owns what the provenance
// columns SAY (`provenanceColumns`). This module owns how they are laid out and
// how every cell is spelled.
//
// Before this module, five escapers had five policies. Some always quoted,
// some quoted only when needed. Some ended lines with CRLF and some with LF.
// Two added a byte-order mark. One guarded against spreadsheet formulas and
// four did not. Each provenance-carrying export also put its header and
// provenance columns together by hand.
//
// The one policy, for every CSV the app writes:
//   - UTF-8 with a byte-order mark, so Excel decodes en dashes, Greek letters
//     and the provenance JSON as UTF-8 rather than the system code page.
//   - CRLF after every record, the last one included (RFC 4180).
//   - A cell is quoted only when it holds a comma, a double quote, CR or LF.
//     An embedded quote is doubled.
//   - null and undefined write an empty cell. Zero writes "0", because zero is
//     a finding and an empty cell is not.
//   - Formula guard: a STRING cell that a spreadsheet would read as a formula
//     gets a leading apostrophe. That means one starting with = + - or @
//     (after optional whitespace), or starting with a tab or CR. Numbers are
//     never prefixed, and neither is a string that is just a decimal number
//     ("-1.25", "+3e-4"), because a spreadsheet reads that as a number, not a
//     formula.
import { downloadFile } from './exportAction';
import { type ExportProvenance, provenanceColumns } from './exportProvenance';

/** One CSV cell value. Rows are arrays in column order. */
export type CsvCell = string | number | boolean | null | undefined;

interface CsvOptions {
  /**
   * Appends the shared provenance columns after the caller's own columns. The
   * identifiers and unit repeat on every row. `ExportMetadataJSON`, the
   * file-level snapshot, is written once in the first data row.
   */
  provenance?: ExportProvenance;
}

const BOM = '\uFEFF';
const EOL = '\r\n';
const NEEDS_QUOTES = /[",\r\n]/;
const FORMULA_START = /^[\t\r]|^[\t\r\n ]*[=+\-@]/;
const DECIMAL_LITERAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const METADATA_JSON = 'ExportMetadataJSON';

function cell(value: CsvCell): string {
  if (value == null) return '';
  let text = String(value);
  if (typeof value === 'string' && FORMULA_START.test(text) && !DECIMAL_LITERAL.test(text)) text = `'${text}`;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function record(cells: readonly CsvCell[]): string {
  return `${cells.map(cell).join(',')}${EOL}`;
}

function csvText(columns: readonly string[], rows: readonly (readonly CsvCell[])[], options: CsvOptions): string {
  const extra = options.provenance ? Object.entries(provenanceColumns(options.provenance)) : [];
  const extraValues = (rowIndex: number) =>
    extra.map(([key, value]) => (key === METADATA_JSON && rowIndex > 0 ? '' : value));
  let text = BOM + record([...columns, ...extra.map(([key]) => key)]);
  rows.forEach((row, index) => { text += record([...row, ...extraValues(index)]); });
  return text;
}

/**
 * Download a table as a CSV file. `rows` are arrays in `columns` order. The
 * caller names the file (`exportFilename` or `exportName`); this module owns
 * the bytes and the hand-off to the browser.
 */
export function writeCsv(
  filename: string,
  columns: readonly string[],
  rows: readonly (readonly CsvCell[])[],
  options: CsvOptions = {},
): void {
  downloadFile(filename, `data:text/csv;charset=utf-8,${encodeURIComponent(csvText(columns, rows, options))}`);
}
