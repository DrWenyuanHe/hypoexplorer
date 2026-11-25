/// <reference lib="dom" />

import { expect, type Page } from '@playwright/test';

/** Remote bundles come from the data origin; a cold fetch outlasts the 5 s default. */
export const DATA_TIMEOUT = 30_000;

/** The served app and the data origin. */
const OUR_ORIGINS = new Set(['http://127.0.0.1:4179', 'https://data.hypoexplorer.com']);

/**
 * Collect every sign that the page broke: uncaught errors, console errors (a
 * caught view crash is logged by ErrorBoundary), alerts (a failed export
 * reports itself through one) and failed or refused requests to the app or the
 * data origin. Call before the first navigation; expectHealthy asserts it.
 */
export function watchForProblems(page: Page): string[] {
  const problems: string[] = [];
  const ours = (url: string) => OUR_ORIGINS.has(new URL(url).origin);
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  page.on('dialog', (dialog) => {
    problems.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && ours(response.url()))
      problems.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? 'failed';
    // Leaving a view cancels the downloads it no longer needs.
    if (reason !== 'net::ERR_ABORTED' && ours(request.url()))
      problems.push(`${reason}: ${request.url()}`);
  });
  return problems;
}

/** Nothing crashed into an error boundary, and no console or network problem. */
export async function expectHealthy(page: Page, problems: string[]) {
  await expect(page.getByText('Something went wrong in this tab')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Analysis link unavailable' })).toHaveCount(0);
  expect(problems).toEqual([]);
}

/**
 * The page fits its viewport. A phone whose content is too wide widens the
 * layout viewport (it zooms out) instead of scrolling, so both are measured.
 */
export async function expectNoSidewaysOverflow(page: Page) {
  const width = page.viewportSize()?.width ?? 0;
  const measured = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    layout: window.innerWidth,
  }));
  expect(measured.content, 'page content is wider than the viewport').toBeLessThanOrEqual(
    width + 1,
  );
  expect(measured.layout, 'the page zoomed out to fit wide content').toBeLessThanOrEqual(width + 1);
}

export function volcanoPlot(page: Page) {
  return page.getByRole('img', { name: 'Volcano plot of differential expression' });
}

/** The chip of a selected gene, found by its remove button. */
export function selectedGene(page: Page, gene: string) {
  return page.getByRole('button', { name: `Remove ${gene}`, exact: true }).first();
}

/** Pick a gene through the search box of a loaded explorer. */
export async function addGene(page: Page, gene: string) {
  const search = page.getByRole('textbox', { name: 'Search gene', exact: true });
  await expect(search).toBeVisible({ timeout: DATA_TIMEOUT });
  await search.fill(gene);
  await search.press('Enter');
  await expect(selectedGene(page, gene)).toBeVisible();
}
