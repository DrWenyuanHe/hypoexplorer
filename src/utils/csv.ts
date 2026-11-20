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
import type { ExportProvenance } from './exportProvenance';
import { provenanceColumns } from './exportProvenanceFormat';

/** One CSV cell value. Rows are arrays in column order. */
export type CsvCell = string | number | boolean | null | undefined;

interface CsvOptions {
  /**
   * Appends the shared provenance columns after the caller's own columns. The
   * identifiers and unit repeat on every row. `ExportMetadataJSON`, the
   * file-level snapshot, is written once from the first data row: in one
   * cell, or split down the column when it is longer than a spreadsheet cell
   * holds (see `cellChunks`).
   */
  provenance?: ExportProvenance;
  /**
   * For a long table whose rows are different tracks (one row per population):
   * each row's identifier columns describe that row's own track, instead of
   * every row repeating all of the file's tracks joined by `|`.
   * `ExportMetadataJSON` still comes from `provenance`, once, for the file.
   */
  rowProvenance?: (rowIndex: number) => ExportProvenance;
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

// Excel holds at most 32,767 characters in a cell, and on opening a CSV it
// spills a longer cell into the rows BELOW it, shifting the table. A file
// covering many tracks (sixty populations) carries a metadata JSON far past
// that, so the JSON is split down its column in chunks under the limit:
// concatenating ExportMetadataJSON top to bottom restores it exactly.
const CELL_CHUNK = 32_000;

/** Split text into cell-sized pieces that survive the writer unchanged. */
export function cellChunks(text: string, size = CELL_CHUNK): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    // Never split a surrogate pair, and never start a piece with a character
    // the formula guard would prefix with an apostrophe (that would corrupt
    // the joined JSON).
    while (end < text.length && end > start + 1
      && (/[\s=+\-@]/.test(text[end]) || /[\uD800-\uDBFF]/.test(text[end - 1]))) end -= 1;
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

function csvText(columns: readonly string[], rows: readonly (readonly CsvCell[])[], options: CsvOptions): string {
  const extra = options.provenance ? Object.entries(provenanceColumns(options.provenance)) : [];
  const json = extra.find(([key]) => key === METADATA_JSON)?.[1];
  const jsonChunks = typeof json === 'string' ? cellChunks(json) : [];
  const { rowProvenance } = options;
  const extraValues = (rowIndex: number, own: boolean) => {
    const cols = own && rowProvenance ? provenanceColumns(rowProvenance(rowIndex)) : null;
    return extra.map(([key, value]) => {
      if (key === METADATA_JSON) return jsonChunks[rowIndex] ?? '';
      return cols ? cols[key] : value;
    });
  };
  let text = BOM + record([...columns, ...extra.map(([key]) => key)]);
  rows.forEach((row, index) => { text += record([...row, ...extraValues(index, true)]); });
  // A JSON longer than the table has rows continues on rows that carry
  // nothing else, so no piece of it is lost. (An empty table stays a header,
  // as it always was.)
  for (let index = rows.length; rows.length > 0 && index < jsonChunks.length; index++) {
    text += record([...columns.map(() => ''), ...extraValues(index, false).map((v, i) =>
      (extra[i][0] === METADATA_JSON ? v : ''))]);
  }
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
