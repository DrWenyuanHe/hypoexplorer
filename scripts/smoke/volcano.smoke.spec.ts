/// <reference lib="dom" />

import { expect, type Page, test } from '@playwright/test';
import { VOLCANO_SELECTED_COLOR } from '../../src/gene-explorer/volcanoColors';
import { DATA_TIMEOUT, expectHealthy, volcanoPlot, watchForProblems } from './support';
import { BULK_STUDY } from './viewLinks';

/**
 * Read the painted canvas: how many pixels were drawn, how many carry the
 * selected-gene color, and the topmost threshold-passing point in CSS pixels.
 */
function readCanvas(page: Page) {
  return page.locator('.volcano-canvas canvas').evaluate((element, selectedColor) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The volcano canvas has no 2d context');
    const { width, height } = canvas;
    const scale = width / canvas.getBoundingClientRect().width;
    const { data } = context.getImageData(0, 0, width, height);
    const hex = Number.parseInt(selectedColor.slice(1), 16);
    const purple = [hex >> 16, (hex >> 8) & 255, hex & 255];
    let painted = 0;
    let selected = 0;
    let point: { x: number; y: number } | null = null;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      painted += 1;
      const rgb = [data[i], data[i + 1], data[i + 2]];
      if (rgb.every((channel, k) => Math.abs(channel - purple[k]) <= 2)) selected += 1;
      // Background points are grey; a threshold-passing point is a solid color.
      const solid = data[i + 3] > 190 && Math.max(...rgb) - Math.min(...rgb) > 60;
      if (solid && !point) {
        const pixel = i / 4;
        point = { x: (pixel % width) / scale, y: Math.floor(pixel / width) / scale + 1 };
      }
    }
    return { painted, selected, point };
  }, VOLCANO_SELECTED_COLOR);
}

test('the volcano paints its points and a click selects the gene under it', async ({
  page,
  isMobile,
}) => {
  test.slow();
  const problems = watchForProblems(page);
  await page.goto(`/#/dataset/${BULK_STUDY}`, { waitUntil: 'domcontentloaded' });
  const plot = volcanoPlot(page);
  await expect(plot).toBeVisible({ timeout: DATA_TIMEOUT });
  await expect
    .poll(async () => (await readCanvas(page)).painted, { message: 'the point cloud is painted' })
    .toBeGreaterThan(1000);

  const before = await readCanvas(page);
  expect(before.selected).toBe(0);
  if (!before.point) throw new Error('No threshold-passing point is painted');
  if (isMobile) await plot.tap({ position: before.point });
  else await plot.click({ position: before.point });

  // The plot's tooltip names the gene it hit; that gene alone is now selected.
  const tooltip = plot.locator('g').filter({ hasText: '◆ Selected' }).last();
  await expect(tooltip).toBeVisible();
  const gene = await tooltip.locator('text').first().textContent();
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(1);
  await expect(page.getByRole('button', { name: `Remove ${gene}`, exact: true })).toBeVisible();
  // It is redrawn as a diamond in the selection color.
  await expect
    .poll(async () => (await readCanvas(page)).selected, { message: 'the selected gene is marked' })
    .toBeGreaterThan(10);
  await expectHealthy(page, problems);
});
