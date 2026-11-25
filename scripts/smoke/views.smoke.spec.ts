import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  DATA_TIMEOUT,
  expectHealthy,
  expectNoSidewaysOverflow,
  volcanoPlot,
  watchForProblems,
} from './support';
import { FOUR_TAB_STUDY, TAB_ORDER, VIEW_LINKS } from './viewLinks';

/** Something that appears only once the view has its own data, not just its frame. */
type Ready = (page: Page) => Locator;

// Keyed by the linked views; smokeViewLinks.test.ts keeps those complete.
const READY: Record<keyof typeof VIEW_LINKS, Ready> = {
  hub: (page) => page.getByRole('search', { name: 'Search genes and pathways' }),
  library: (page) => page.getByText('GSE225038', { exact: true }).first(),
  explorer: volcanoPlot,
  report: (page) =>
    page
      .getByRole('region', { name: 'Differential expression across studies' })
      .getByRole('link', { name: 'Open →' })
      .first(),
  'pathway-report': (page) => page.getByText(/in \d+ of [1-9]\d* tracks/),
  'compare-set': volcanoPlot,
  tracker: (page) => page.getByText(/[1-9]\d* of [1-9]\d* shown/),
  methodology: (page) => page.getByRole('heading', { level: 1, name: 'Methods & statistics' }),
  verification: (page) =>
    page
      .getByRole('table', { name: 'Current quality-control coverage' })
      .getByRole('row', { name: /^Passed [1-9]/ }),
  nomenclature: (page) => page.getByText(/of [1-9][\d,]* symbols/),
  expression: (page) => page.getByText(/[1-9]\d* source records selected/),
  search: (page) => page.getByRole('button', { name: /^POMC .*in [1-9]\d* of [1-9]\d* datasets/ }),
};

for (const view of Object.keys(READY) as Array<keyof typeof READY>) {
  test(`the ${view} view opens from its link`, async ({ page }) => {
    // The nomenclature page parses a 17 MB table.
    const heavy = view === 'nomenclature';
    if (heavy) test.slow();
    const problems = watchForProblems(page);
    await page.goto(`/${VIEW_LINKS[view]}`, { waitUntil: 'domcontentloaded' });
    await expect(READY[view](page)).toBeVisible({ timeout: heavy ? 75_000 : 25_000 });
    await expectNoSidewaysOverflow(page);
    await expectHealthy(page, problems);
  });
}

const TABS: Record<(typeof TAB_ORDER)[number], { label: string; ready: Ready }> = {
  gene: { label: 'Gene Explorer', ready: volcanoPlot },
  pathway: {
    label: 'Pathway Explorer',
    ready: (page) =>
      page
        .getByRole('region', { name: 'Pathway table' })
        .getByRole('row', { name: /^(GO_BP|HALLMARK|KEGG|REACTOME) / })
        .first(),
  },
  circadian: {
    label: 'Circadian',
    ready: (page) => page.getByRole('combobox', { name: 'Rhythm test' }),
  },
  qc: {
    label: 'Quality Control',
    ready: (page) => page.getByRole('row', { name: /^scn .* ok$/ }),
  },
};

test('every explorer tab opens, and a tab link survives a reload', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  await page.goto(`/${FOUR_TAB_STUDY}`, { waitUntil: 'domcontentloaded' });
  await expect(volcanoPlot(page)).toBeVisible({ timeout: DATA_TIMEOUT });
  // The default tab comes last, so every tab is reached by a click from another.
  for (const tab of TAB_ORDER) {
    const { label, ready } = TABS[tab];
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(ready(page), label).toBeVisible({ timeout: DATA_TIMEOUT });
    await expectNoSidewaysOverflow(page);
    if (tab !== 'gene') await expect(page).toHaveURL(new RegExp(`/scn/${tab}(?:\\?|$)`));
  }
  await page.goto(`/${FOUR_TAB_STUDY}/qc`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(TABS.qc.ready(page)).toBeVisible({ timeout: DATA_TIMEOUT });
  await expectHealthy(page, problems);
});

test('Compare opens its populations and gene from a link', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  await page.goto('/#/dataset/macaque_snrna/compare?pops=e9,i23&genes=POMC', {
    waitUntil: 'domcontentloaded',
  });
  // Each population's chart, not its chip: a phone folds the chips to "+1 more".
  for (const population of ['e9', 'i23'])
    await expect(
      page.getByRole('button', { name: new RegExp(`^Download POMC chart for ${population} `) }),
    ).toBeVisible({ timeout: DATA_TIMEOUT });
  // A population that failed to load reports itself in an alert with a Retry.
  await expect(page.getByRole('button', { name: /^Retry loading/ })).toHaveCount(0);
  await expectNoSidewaysOverflow(page);
  await expectHealthy(page, problems);
});

test('the rhythm scan finishes and fills the results table', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The scan is the same computation at every width.');
  test.setTimeout(150_000);
  const problems = watchForProblems(page);
  await page.goto(`/${FOUR_TAB_STUDY}/circadian`, { waitUntil: 'domcontentloaded' });
  const results = page.getByRole('table', { name: 'Rhythm results' });
  await expect(results.getByRole('row').nth(1)).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Results CSV' })).toBeEnabled();
  await expectHealthy(page, problems);
});
