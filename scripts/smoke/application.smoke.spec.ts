import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

test('production app boots with matching release metadata and a populated study catalog', async ({
  page,
  request,
  isMobile,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const releaseResponse = await request.get('/release.json');
  expect(releaseResponse.ok()).toBe(true);
  const release = await releaseResponse.json();
  expect(release.appVersion).toBe(pkg.version);
  expect(release.releaseId).toMatch(/^[0-9a-f]{64}$/);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const hubSearch = page.getByRole('search', { name: 'Search genes and pathways' });
  await expect(hubSearch).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'HypoExplorer' })).toBeVisible();
  const version = page.getByRole('button', {
    name: `Version ${pkg.version}. Refresh to the latest version.`,
  });
  await expect(version).toBeVisible();
  await expect(version).toHaveAttribute('title', new RegExp(release.releaseId.slice(0, 12)));
  await page
    .getByRole('navigation', { name: 'Reference' })
    .getByRole('button', { name: 'Dataset library', exact: true })
    .click();
  await expect(page).toHaveURL(/#\/library/);
  await page.getByRole('searchbox', { name: 'Search datasets' }).fill('GSE225038');
  await expect(page.getByText('GSE225038', { exact: true }).first()).toBeVisible();
  // Registry entries render before the catalog arrives. A measured arm count
  // proves that the browser accepted the catalog identity for this app build.
  await expect(page.getByTitle(/^[1-9]\d* Chow vs [1-9]\d* HFD$/)).toBeVisible();
  await expect(
    page.getByText(
      /Replicate and feature counts are unavailable|studies have no counts because the published catalog is older/,
    ),
  ).toHaveCount(0);

  if (isMobile) {
    // The filter bar's add-filter menu opens over the results on a phone and
    // Escape hands focus back to the button that opened it.
    const filterBar = page.getByRole('region', { name: 'Filter datasets' });
    const filterButton = filterBar.getByRole('button', { name: /^(Filter|Add filter)$/ });
    await filterButton.click();
    const menu = filterBar.getByRole('dialog', { name: 'Add filter' });
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(filterButton).toBeFocused();
  }

  const screenshotDirectory = resolve(process.cwd(), '.tmp/browser-smoke');
  mkdirSync(screenshotDirectory, { recursive: true });
  const screenshot = await page.screenshot({
    path: resolve(screenshotDirectory, `${testInfo.project.name}-library.png`),
    fullPage: true,
  });
  await testInfo.attach('library layout', { body: screenshot, contentType: 'image/png' });

  await page.getByRole('link', { name: 'HypoExplorer home' }).click();
  await expect(hubSearch).toBeVisible();
  await expect(hubSearch.getByRole('combobox', { name: 'Search genes and pathways across all studies' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('citation guidance is served as a standalone production page', async ({ page, request }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: 'How to cite', exact: true }).click();
  await expect(page).toHaveURL(/\/how-to-cite\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/cit(e|ing|ation)/i);
  const citation = await request.get('/CITATION.cff');
  expect(citation.ok()).toBe(true);
  expect(await citation.text()).toContain(`version: ${pkg.version}`);
});
