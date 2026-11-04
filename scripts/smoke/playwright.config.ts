import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

/** Runs against an already-built production app, never the development server. */
export default defineConfig({
  testDir: '.',
  testMatch: '*.smoke.spec.ts',
  outputDir: '../../.tmp/browser-smoke/results',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 30_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: resolve(process.cwd(), '.tmp/browser-smoke/report'), open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4179',
    browserName: 'chromium',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      // A 1280x900 desktop at 200% browser zoom exposes a 640x450 CSS viewport.
      // This checks that reflow geometry and pixel density, not browser chrome.
      name: 'desktop-200-percent-reflow',
      testMatch: 'results.smoke.spec.ts',
      use: { viewport: { width: 640, height: 450 }, deviceScaleFactor: 2 },
    },
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
    {
      name: 'phone',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: 'node --import tsx scripts/smoke/preview.mts',
    cwd: process.cwd(),
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
