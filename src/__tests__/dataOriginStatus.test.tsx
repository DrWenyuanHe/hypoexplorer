import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import type { OriginDiagnosis } from '../data/originHealth';

// The light reads two modules that are BUILD-time facts in production: the
// configured data origin (bundleBase) and the probe verdict (originHealth). The
// test env pins BUNDLE_BASE to '' — same-origin — so both are swapped per case
// through a fresh module graph. explainOrigin/shouldLinkStatusPage stay REAL:
// the copy and the status-page rule are part of what is under test.
const DATA_ORIGIN = 'https://data.example.org';

async function renderLight(diagnosis: OriginDiagnosis, base: string = DATA_ORIGIN) {
  vi.resetModules();
  vi.doMock('../data/bundleBase', () => ({
    BUNDLE_BASE: base,
    BUNDLE_BASE_IS_CORS_ENABLED: false,
  }));
  vi.doMock('../data/originHealth', async () => {
    const actual = await vi.importActual<typeof import('../data/originHealth')>('../data/originHealth');
    return { ...actual, diagnoseDataOrigin: vi.fn().mockResolvedValue(diagnosis) };
  });
  const { DataOriginStatus } = await import('../hub/DataOriginStatus');
  return render(<DataOriginStatus />);
}

afterEach(() => {
  cleanup();
  vi.doUnmock('../data/bundleBase');
  vi.doUnmock('../data/originHealth');
  vi.resetModules();
});

describe('DataOriginStatus', () => {
  it('renders nothing on a same-origin deploy, where it could only ever be green', async () => {
    const { container } = await renderLight({ status: 'same-origin', origin: '' }, '');
    expect(container.firstChild).toBeNull();
  });

  it('goes green when the data origin answers, and names it in the tooltip', async () => {
    await renderLight({ status: 'origin-reachable', origin: DATA_ORIGIN });
    const light = await screen.findByText('Data online');
    expect(light.closest('.hub-origin')?.className).toContain('ok');
    expect(light.closest('.hub-origin')?.getAttribute('title')).toContain(DATA_ORIGIN);
  });

  it('goes red when nothing answers, and offers the CDN status page', async () => {
    await renderLight({ status: 'origin-unreachable', origin: DATA_ORIGIN });
    const link = await screen.findByRole('link', { name: 'Data unreachable' });
    expect(link.getAttribute('href')).toBe('https://www.cloudflarestatus.com/');
    expect(link.closest('.hub-origin')?.className).toContain('down');

    // It must not assert an outage it cannot prove from one browser: the probe
    // fails identically when the visitor's own network blocks the subdomain.
    const title = link.closest('.hub-origin')?.getAttribute('title') ?? '';
    expect(title).toMatch(/cannot reach/i);
    expect(title).toMatch(/network may be blocking the address/i);
  });

  it('blames the connection, not the origin, when the browser is offline', async () => {
    await renderLight({ status: 'offline', origin: DATA_ORIGIN });
    const light = await screen.findByText('You are offline');
    expect(light.closest('.hub-origin')?.className).toContain('warn');
    // No status-page link: the CDN is not implicated by an offline device.
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows nothing rather than a guess when the probe cannot answer', async () => {
    const { container } = await renderLight({ status: 'unknown', origin: DATA_ORIGIN });
    // The 'idle' placeholder is on screen only until the verdict lands.
    await waitFor(() => expect(container.querySelector('.hub-origin')).toBeNull());
  });

  it('carries the state in words, not in color alone', async () => {
    await renderLight({ status: 'origin-reachable', origin: DATA_ORIGIN });
    const status = await screen.findByRole('status');
    expect(status.textContent?.trim()).toBe('Data online');
  });
});
