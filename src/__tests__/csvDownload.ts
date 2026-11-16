// Reads back a CSV that the CSV seam (utils/csv.ts) handed to `downloadFile`.
// Tests that mock `downloadFile` use these helpers instead of each one decoding
// the data URL in its own way.
import { parseDelimitedRows } from '../local-datasets/importData';

const CSV_PREFIX = 'data:text/csv;charset=utf-8,';

/** The exact text of the downloaded file, byte-order mark included. */
export function csvDownloadText(href: string): string {
  if (!href.startsWith(CSV_PREFIX)) throw new Error(`not a CSV data URL: ${href.slice(0, 40)}`);
  return decodeURIComponent(href.slice(CSV_PREFIX.length));
}

/** The downloaded file parsed into rows (BOM stripped, cells trimmed). */
export function csvDownloadTable(href: string): string[][] {
  return parseDelimitedRows(csvDownloadText(href), ',');
}
