/// <reference lib="dom" />

import { expect, test } from '@playwright/test';
import {
  addGene,
  DATA_TIMEOUT,
  expectHealthy,
  selectedGene,
  volcanoPlot,
  watchForProblems,
} from './support';
import { BULK_STUDY } from './viewLinks';

test('a gene search leads from the hub to a study', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const search = page.getByRole('combobox', {
    name: 'Search genes and pathways across all studies',
  });
  await search.fill('POMC');
  await search.press('Enter');

  await expect(page).toHaveURL(/#\/search\/POMC$/);
  await page
    .getByRole('button', { name: /^POMC .*in [1-9]\d* of [1-9]\d* datasets/ })
    .click({ timeout: DATA_TIMEOUT });

  await expect(page).toHaveURL(/#\/gene\/POMC/);
  const open = page
    .getByRole('region', { name: 'Differential expression across studies' })
    .getByRole('link', { name: 'Open →' })
    .first();
  await expect(open).toBeVisible({ timeout: DATA_TIMEOUT });
  const datasetId = /#\/dataset\/([^/?]+)/.exec((await open.getAttribute('href')) ?? '')?.[1];
  expect(datasetId, 'the result row links a study').toBeTruthy();
  await open.click();

  await expect(page).toHaveURL(new RegExp(`#/dataset/${datasetId}(?:[/?]|$)`));
  await expect(volcanoPlot(page)).toBeVisible({ timeout: DATA_TIMEOUT });
  await expectHealthy(page, problems);
});

test('a shared analysis link reopens the same analysis for someone else', async ({
  page,
  browser,
  baseURL,
}) => {
  test.slow();
  const problems = watchForProblems(page);
  const statistic = { name: 'Significance statistic' };
  const thresholds = { name: /^Thresholds: / };
  await page.goto(`/#/dataset/${BULK_STUDY}`, { waitUntil: 'domcontentloaded' });
  await addGene(page, 'Pomc');
  await page
    .getByRole('group', statistic)
    .getByRole('button', { name: 'FDR', exact: true })
    .click();
  const summary = await page.getByRole('button', thresholds).textContent();
  expect(summary).toMatch(/^FDR < /);

  await page.getByRole('button', { name: 'Share analysis', exact: true }).click();
  const link = page.getByRole('textbox', { name: 'Analysis link', exact: true });
  await expect(link).toHaveValue(/analysis=/);
  const { hash } = new URL(await link.inputValue());
  await expectHealthy(page, problems);

  // A fresh context has none of the first reader's storage or cache.
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const other = await context.newPage();
    const otherProblems = watchForProblems(other);
    await other.goto(`${baseURL}/${hash}`, { waitUntil: 'domcontentloaded' });
    await expect(selectedGene(other, 'Pomc')).toBeVisible({ timeout: DATA_TIMEOUT });
    await expect(
      other.getByRole('group', statistic).getByRole('button', { name: 'FDR', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(other.getByRole('button', thresholds)).toHaveText(summary ?? '');
    await expectHealthy(other, otherProblems);
  } finally {
    await context.close();
  }
});

test('an unreadable analysis link says so and leads home', async ({ page }) => {
  await page.goto(`/#/dataset/${BULK_STUDY}?analysis=%7B%22version%22%3A999%7D`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByRole('heading', { name: 'Analysis link unavailable' })).toBeVisible();
  await page.getByRole('button', { name: 'Return home' }).click();
  await expect(page.getByRole('search', { name: 'Search genes and pathways' })).toBeVisible();
});

test('Back and Forward retrace views and explorer tabs', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  const hub = page.getByRole('search', { name: 'Search genes and pathways' });
  const librarySearch = page.getByRole('searchbox', { name: 'Search datasets' });
  const pathways = page.getByRole('region', { name: 'Pathway table' });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(hub).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Library', exact: true })
    .click();
  // The library's chunk brings both evidence ledgers; cold, it outlasts 5 s.
  await expect(librarySearch).toBeVisible({ timeout: DATA_TIMEOUT });
  await page.evaluate((id) => {
    window.location.hash = `#/dataset/${id}`;
  }, BULK_STUDY);
  await expect(volcanoPlot(page)).toBeVisible({ timeout: DATA_TIMEOUT });
  await page.getByRole('button', { name: 'Pathway Explorer', exact: true }).click();
  await expect(pathways).toBeVisible({ timeout: DATA_TIMEOUT });

  await page.goBack();
  await expect(volcanoPlot(page)).toBeVisible({ timeout: DATA_TIMEOUT });
  await page.goBack();
  await expect(librarySearch).toBeVisible({ timeout: DATA_TIMEOUT });
  await page.goBack();
  await expect(hub).toBeVisible();
  await page.goForward();
  await expect(librarySearch).toBeVisible({ timeout: DATA_TIMEOUT });
  await page.goForward();
  await expect(volcanoPlot(page)).toBeVisible({ timeout: DATA_TIMEOUT });
  await page.goForward();
  await expect(pathways).toBeVisible({ timeout: DATA_TIMEOUT });
  await expectHealthy(page, problems);
});
