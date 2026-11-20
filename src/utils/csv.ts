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

/** Data rows spelled into one piece of the file before a new piece starts. */
const CHUNK_ROWS = 10_000;

/**
 * Spells the records of one file: the header, each data row by its index in
 * the file, and the rows that carry only the rest of a long metadata JSON.
 * Shared by the whole-table and the block writers, so the two spell the same
 * bytes.
 *
 * Each record is spelled straight into its text: no per-row array is built to
 * join the caller's cells with the provenance cells, and provenance cells that
 * repeat on every row are spelled once.
 */
function csvEncoder(columns: readonly string[], options: CsvOptions) {
  const extra = options.provenance ? Object.entries(provenanceColumns(options.provenance)) : [];
  const jsonAt = extra.findIndex(([key]) => key === METADATA_JSON);
  const json = jsonAt >= 0 ? extra[jsonAt][1] : undefined;
  const jsonChunks = typeof json === 'string' ? cellChunks(json) : [];
  const { rowProvenance } = options;
  const fixed = extra.map(([, value]) => cell(value));
  // The provenance cells of one data row, already spelled and joined.
  const tail = (rowIndex: number): string => {
    const own = rowProvenance ? provenanceColumns(rowProvenance(rowIndex)) : null;
    let out = '';
    for (let i = 0; i < extra.length; i++) {
      if (i) out += ',';
      out += i === jsonAt ? cell(jsonChunks[rowIndex] ?? '') : own ? cell(own[extra[i][0]]) : fixed[i];
    }
    return out;
  };
  return {
    header: BOM + record([...columns, ...extra.map(([key]) => key)]),
    line(row: readonly CsvCell[], index: number): string {
      let line = '';
      for (let c = 0; c < row.length; c++) line += c ? `,${cell(row[c])}` : cell(row[c]);
      if (extra.length) line += row.length ? `,${tail(index)}` : tail(index);
      return line + EOL;
    },
    // A JSON longer than the table has rows continues on rows that carry
    // nothing else, so no piece of it is lost. (An empty table stays a header,
    // as it always was.)
    overflow(rowCount: number): string {
      let out = '';
      for (let index = rowCount; rowCount > 0 && index < jsonChunks.length; index++) {
        out += record([...columns.map(() => ''), ...extra.map((_, i) => (i === jsonAt ? jsonChunks[index] : ''))]);
      }
      return out;
    },
  };
}

/**
 * The file as pieces of text, each about `CHUNK_ROWS` records long. Joined,
 * they are the whole file, byte for byte; a large file goes to a Blob piece by
 * piece and is never held as one string.
 */
export function csvChunks(
  columns: readonly string[],
  rows: readonly (readonly CsvCell[])[],
  options: CsvOptions = {},
  chunkRows = CHUNK_ROWS,
): string[] {
  const encoder = csvEncoder(columns, options);
  const chunks: string[] = [];
  let piece = encoder.header;
  for (let index = 0; index < rows.length; index++) {
    piece += encoder.line(rows[index], index);
    if ((index + 1) % chunkRows === 0) { chunks.push(piece); piece = ''; }
  }
  piece += encoder.overflow(rows.length);
  if (piece) chunks.push(piece);
  return chunks;
}

/** Data rows handed over a block at a time, in file order. */
export type CsvRowBlocks = Iterable<readonly (readonly CsvCell[])[]>;

/**
 * The file as one piece of text per block of rows (the header rides on the
 * first, any metadata-JSON overflow on a last piece of its own). Joined, the
 * pieces are exactly what `csvChunks` spells for the same rows laid end to end.
 * Rows are pulled one block at a time, so a caller that generates its blocks
 * lazily never holds more than one block of rows.
 */
export function* csvBlockPieces(
  columns: readonly string[],
  blocks: CsvRowBlocks,
  options: CsvOptions = {},
): Generator<string, void> {
  const encoder = csvEncoder(columns, options);
  let head = encoder.header;
  let index = 0;
  for (const block of blocks) {
    let piece = head;
    head = '';
    for (const row of block) piece += encoder.line(row, index++);
    if (piece) yield piece;
  }
  const rest = head + encoder.overflow(index);
  if (rest) yield rest;
}

const canMakeBlobUrl = () => typeof Blob !== 'undefined' && typeof URL !== 'undefined'
  && typeof URL.createObjectURL === 'function';

const CSV_MIME = 'text/csv;charset=utf-8';

/** Hand finished pieces (text, or text already moved into Blobs) to the browser. */
function deliver(filename: string, parts: BlobPart[], length: number, text: string[]): void {
  // Small files stay data: URLs (synchronous, nothing to revoke). Past a few
  // megabytes a data: URL is percent-encoded to ~3x the text and browsers may
  // refuse the navigation, so large tables (a whole-transcriptome raw-value
  // export runs to ~90 MB) go through a Blob URL instead, built from the
  // pieces so the file never exists as one string.
  if (length > LARGE_CSV_CHARS && canMakeBlobUrl()) {
    const url = URL.createObjectURL(new Blob([...parts, ...text], { type: CSV_MIME }));
    downloadFile(filename, url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  downloadFile(filename, `data:${CSV_MIME},${encodeURIComponent(text.join(''))}`);
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
  const chunks = csvChunks(columns, rows, options);
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  deliver(filename, [], length, chunks);
}

const nextTask = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

/**
 * `writeCsv` for a table too large to hold as rows: the rows arrive a block at
 * a time (typically from a generator), each block is spelled into one piece of
 * text and dropped, and the event loop gets a turn between blocks. The bytes
 * are those `writeCsv` would write for the same rows, with every guarantee
 * above (escaping, formula guard, BOM, CRLF, provenance columns, per-row
 * provenance, the metadata JSON split down its column).
 *
 * The provenance must be complete before the first block, because the
 * metadata JSON is spelled into the first data rows.
 *
 * Once the text passes the data: URL limit and a Blob URL will be used, each
 * piece is moved into a Blob as it is made, so the browser can keep the file
 * outside the script heap; the encoded file itself is the remaining cost.
 */
export async function writeCsvBlocks(
  filename: string,
  columns: readonly string[],
  blocks: CsvRowBlocks,
  options: CsvOptions = {},
): Promise<void> {
  const blobs = canMakeBlobUrl();
  const parts: BlobPart[] = [];
  let text: string[] = [];
  let length = 0;
  for (const piece of csvBlockPieces(columns, blocks, options)) {
    text.push(piece);
    length += piece.length;
    if (blobs && length > LARGE_CSV_CHARS) {
      parts.push(new Blob(text));
      text = [];
    }
    await nextTask();
  }
  deliver(filename, parts, length, text);
}

/** CSV text length above which `writeCsv` and `writeCsvBlocks` hand the browser a Blob URL. */
export const LARGE_CSV_CHARS = 2_000_000;
