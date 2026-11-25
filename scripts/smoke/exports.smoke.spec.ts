import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page, test } from '@playwright/test';
import * as XLSX from 'xlsx';
import { addGene, DATA_TIMEOUT, expectHealthy, watchForProblems } from './support';
import { BULK_STUDY } from './viewLinks';

type Row = Record<string, string | number>;

function rows(workbook: XLSX.WorkBook, sheet: string): Row[] {
  expect(workbook.SheetNames).toContain(sheet);
  return XLSX.utils.sheet_to_json<Row>(workbook.Sheets[sheet], { raw: true, defval: '' });
}

/** Click an export and read the file the browser actually saved. */
async function download(page: Page, button: Locator, problems: string[]) {
  try {
    // The first export of a session also fetches the QC ledger and xlsx chunks.
    const [file] = await Promise.all([
      page.waitForEvent('download', { timeout: DATA_TIMEOUT }),
      button.click(),
    ]);
    return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
  } catch (error) {
    // The app says why in an alert; without it this reads as a bare timeout.
    throw new Error(['No file was saved.', ...problems].join('\n'), { cause: error });
  }
}

/** Open Pomc's summary table and read the figures it shows. */
async function openSummary(page: Page) {
  await page.goto(`/#/dataset/${BULK_STUDY}`, { waitUntil: 'domcontentloaded' });
  await addGene(page, 'Pomc');
  await page.getByRole('button', { name: 'Summary table', exact: true }).click();
  const summary = page.getByRole('dialog', { name: /^Summary table/ });
  const cells = summary
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'Pomc', exact: true }) })
    .getByRole('cell');
  await expect(cells.first()).toBeVisible();
  // Columns: gene, logFC, P value, FDR.
  const [, logFC, , fdr] = await cells.allTextContents();
  return { summary, shown: { logFC, fdr } };
}

test('the CSV export holds the figures on screen and its provenance', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  const { summary, shown } = await openSummary(page);
  const { name, bytes } = await download(
    page,
    summary.getByRole('button', { name: 'Export CSV', exact: true }),
    problems,
  );

  expect(name).toMatch(/\.csv$/);
  expect([...bytes.subarray(0, 3)], 'UTF-8 byte-order mark').toEqual([0xef, 0xbb, 0xbf]);
  const book = XLSX.read(bytes, { type: 'buffer', raw: true });
  const table = rows(book, book.SheetNames[0]);
  const pomc = table.find((row) => row.Gene === 'Pomc');
  expect(Number(pomc?.logFC).toFixed(3)).toBe(shown.logFC);
  expect(Number(pomc?.FDR).toFixed(3)).toBe(shown.fdr);
  expect(pomc?.DatasetID).toBe(BULK_STUDY);
  expect(pomc?.SourceAccession).toBe('GSE225038');
  // A long snapshot is split down its column; joined, it must parse.
  const metadata = JSON.parse(table.map((row) => row.ExportMetadataJSON).join(''));
  expect(metadata.exportKind).toBe('genes_summary');
  expect(metadata.evidence, 'the retained QC evidence is recorded').toBeTruthy();
  await expectHealthy(page, problems);
});

test('the Excel export opens with its data and metadata sheets', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  const { summary, shown } = await openSummary(page);
  const { name, bytes } = await download(
    page,
    summary.getByRole('button', { name: 'Export Excel', exact: true }),
    problems,
  );

  expect(name).toMatch(/\.xlsx$/);
  const book = XLSX.read(bytes, { type: 'buffer' });
  const pomc = rows(book, 'Summary').find((row) => row.Gene === 'Pomc');
  expect(Number(pomc?.logFC).toFixed(3)).toBe(shown.logFC);
  // Seven libraries (3 Chow, 4 HFD) back this gene.
  expect(rows(book, 'RawValues')).toHaveLength(7);
  const metadataSheet = book.SheetNames.find((sheet) => !['Summary', 'RawValues'].includes(sheet));
  expect(JSON.stringify(rows(book, metadataSheet ?? 'Metadata'))).toContain(BULK_STUDY);
  await expectHealthy(page, problems);
});
