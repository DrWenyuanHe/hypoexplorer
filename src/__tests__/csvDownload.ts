// Reads back a CSV that the CSV seam (utils/csv.ts) handed to `downloadFile`.
// Tests that mock `downloadFile` use these helpers instead of each one decoding
// the data URL in its own way.

const CSV_PREFIX = 'data:text/csv;charset=utf-8,';

/** The exact text of the downloaded file, byte-order mark included. */
export function csvDownloadText(href: string): string {
  if (!href.startsWith(CSV_PREFIX)) throw new Error(`not a CSV data URL: ${href.slice(0, 40)}`);
  return decodeURIComponent(href.slice(CSV_PREFIX.length));
}

/** The downloaded file parsed into rows (BOM stripped, cells trimmed). */
export function csvDownloadTable(href: string): string[][] {
  return parseCsv(csvDownloadText(href));
}

/** RFC 4180 rows: quoted cells may hold commas, newlines and doubled quotes. */
function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endCell = () => { row.push(cell.trim()); cell = ''; };
  const endRow = () => { endCell(); rows.push(row); row = []; };
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && !cell.trim()) { cell = ''; quoted = true; }
    else if (char === ',') endCell();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      endRow();
    } else cell += char;
  }
  if (quoted) throw new Error('unclosed quoted cell in downloaded CSV');
  if (cell || row.length) endRow();
  return rows;
}
