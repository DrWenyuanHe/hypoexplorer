// The one place a set of sheet rows becomes a downloaded .xlsx file.
//
// Every Excel export in the app describes its workbook as data — a filename and
// an ordered list of named sheets — and hands it here. This module owns the
// xlsx mechanics (book_new → json_to_sheet → book_append_sheet → writeFile) and
// the lazy-loading/failure policy it inherits from withXLSX: the returned
// promise NEVER rejects (a failed chunk load or export body is reported to the
// user by lazyExport), so callers may fire-and-forget or `.finally()` their
// busy-state cleanup.
//
// Sheet order follows the input array; column order follows each row object's
// key insertion order (XLSX.json_to_sheet derives columns from it) — so the row
// builders in excelExport.ts stay the single authority on column layout.
import { withXLSX } from './lazyExport';

// Wider than excelExport's SheetRow: a cell may be null/undefined (a dropped
// sample's value) — json_to_sheet simply leaves those cells blank.
export type WorkbookRow = Record<string, string | number | boolean | null | undefined>;

export interface WorkbookSheet {
  name: string;
  rows: readonly WorkbookRow[];
}

export function writeWorkbook(filename: string, sheets: readonly WorkbookSheet[]): Promise<void> {
  return withXLSX((XLSX) => {
    const wb = XLSX.utils.book_new();
    for (const sheet of sheets) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([...sheet.rows]), sheet.name);
    }
    XLSX.writeFile(wb, filename);
  });
}
