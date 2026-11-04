/// <reference lib="dom" />

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';

/** Reach a control through the real tab order, without assigning focus in JS. */
async function tabTo(page: Page, control: Locator) {
  await expect(control).toBeVisible();
  for (let steps = 0; steps < 80; steps += 1) {
    if (await control.evaluate((element) => element === element.ownerDocument.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(control, 'Control must be reachable through the keyboard tab order').toBeFocused();
}

function luminance(rgb: number[]) {
  const linear = rgb.slice(0, 3).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

test('result tables and analysis sharing remain readable and keyboard accessible', async ({
  page,
}, testInfo) => {
  await page.goto('/#/dataset/mouse_arc_hfd_gse225038', { waitUntil: 'domcontentloaded' });
  const search = page.getByRole('textbox', { name: 'Search gene', exact: true });
  await tabTo(page, search);
  await page.keyboard.type('Pomc');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^Remove Pomc$/i })).toBeVisible();

  const summaryButton = page.getByRole('button', { name: 'Summary table', exact: true });
  await tabTo(page, summaryButton);
  await page.keyboard.press('Enter');
  const summary = page.getByRole('dialog', { name: /^Summary table/ });
  await expect(summary).toBeVisible();
  const result = summary
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: /^Pomc$/i }) });
  await expect(result).toBeVisible();

  // Check rendered CSS as well as the palette constants on a real result row.
  const colors = await result.getByRole('cell').evaluateAll((cells) =>
    cells.slice(0, 7).map((cell) => {
      const view = cell.ownerDocument.defaultView;
      const parse = (value: string) => value.match(/[\d.]+/g)?.map(Number) ?? [];
      let background = [255, 255, 255];
      for (let ancestor: Element | null = cell; ancestor; ancestor = ancestor.parentElement) {
        const color = parse(view.getComputedStyle(ancestor).backgroundColor);
        if (color.length === 3 || color[3] === 1) {
          background = color;
          break;
        }
        if (color[3] > 0) throw new Error('Unexpected translucent result background');
      }
      return {
        text: cell.textContent,
        foreground: parse(view.getComputedStyle(cell).color),
        background,
      };
    }),
  );
  for (const { text, foreground, background } of colors) {
    const light = Math.max(luminance(foreground), luminance(background));
    const dark = Math.min(luminance(foreground), luminance(background));
    expect(
      (light + 0.05) / (dark + 0.05),
      `Result text contrast for ${text}`,
    ).toBeGreaterThanOrEqual(4.5);
  }

  const sort = summary.getByRole('button', { name: 'logFC', exact: true });
  await tabTo(page, sort);
  await page.keyboard.press('Enter');
  await expect(summary.getByRole('columnheader', { name: 'logFC', exact: true })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await expect(sort).toBeFocused();
  await expect(result.getByRole('cell', { name: /^Pomc$/i })).toBeInViewport();
  await expect(summary.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();

  const screenshots = resolve(process.cwd(), '.tmp/browser-smoke');
  mkdirSync(screenshots, { recursive: true });
  const resultsImage = await page.screenshot({
    path: resolve(screenshots, `${testInfo.project.name}-results.png`),
    fullPage: false,
  });
  await testInfo.attach('keyboard result table', { body: resultsImage, contentType: 'image/png' });
  await page.keyboard.press('Escape');
  await expect(summary).toBeHidden();
  await expect(summaryButton).toBeFocused();

  const share = page.getByRole('button', { name: 'Share analysis', exact: true });
  await tabTo(page, share);
  await expect(share).toBeInViewport();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Share analysis', exact: true });
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  const link = dialog.getByRole('textbox', { name: 'Analysis link', exact: true });
  const copy = dialog.getByRole('button', { name: 'Copy link', exact: true });
  await expect(link).toHaveValue(/analysis=/);
  const analysis = new URLSearchParams(new URL(await link.inputValue()).hash.split('?')[1]);
  expect(JSON.parse(analysis.get('analysis') ?? '{}').genes).toContain('Pomc');
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(copy).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  await expect(link).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  const shareImage = await page.screenshot({
    path: resolve(screenshots, `${testInfo.project.name}-share.png`),
    fullPage: false,
  });
  await testInfo.attach('keyboard analysis sharing', {
    body: shareImage,
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(share).toBeFocused();
});
