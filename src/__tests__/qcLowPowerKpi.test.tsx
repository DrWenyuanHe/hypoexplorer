import { describe, it, expect, vi } from 'vitest';
import { cloneElement } from 'react';
import { render } from '@testing-library/react';
import { QCTab } from '../qc/QCTab';
import type { DatasetMeta } from '../types';

// Regression: ISSUE-001 — QC "2v3 design" KPI miscounted a balanced 7-vs-8
//   bulk track as a dropped-sample 2v3 because it used `is3v3 === false`
//   instead of the app-wide low-power rule `min(nNormal, nObese) < 3`.
// Found by /qa on 2026-06-13
// Report: .gstack/qa-reports/qa-report-localhost-2026-06-13.md

// QCTab's composition section may mount a recharts ResponsiveContainer, which
// measures via offsetWidth/offsetHeight (0 in jsdom). Pass it through with fixed
// dims so the tab renders without warnings — same shim the BarSEMChart test uses.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: any }) => cloneElement(children, { width: 400, height: 200 }),
  };
});

// Read the number rendered inside the KPICard whose <dt> label matches `label`.
function kpiNumber(container: HTMLElement, label: string) {
  const dt = [...container.querySelectorAll('dt')].find(d => new RegExp(label, 'i').test(d.textContent!));
  return dt?.parentElement?.querySelector('dd')?.textContent?.trim() ?? null;
}

const emptyQc = { runStatus: [], deSummary: [], fgseaSummary: [], composition: {} };
const noop = () => {};

describe('QCTab — low-power KPI uses min(n) < 3, not is3v3 === false', () => {
  it('counts a genuine 2v3 track but NOT a balanced non-3v3 (7v8) track', () => {
    const meta = {
      populations: ['dropped', 'balanced'],
      labels: { dropped: 'Dropped-sample pop', balanced: 'Balanced bulk track' },
      qcFlags: {
        // Genuine 2v3: one arm has < 3 replicates -> low power.
        dropped: { is3v3: false, nNormal: 2, nObese: 3, minCells: 12, status: 'ok' },
        // Healthy bulk design: 7 vs 8. is3v3 is false (it's not exactly 3v3) but
        // BOTH arms have >= 3 replicates, so it is NOT low power.
        balanced: { is3v3: false, nNormal: 7, nObese: 8, minCells: 0, status: 'ok' },
      },
      qaReportFilenames: {},
    } as unknown as DatasetMeta;
    const { container } = render(
      <QCTab onSelectTrack={noop} qcData={emptyQc} meta={meta} />
    );
    // Only the dropped-sample track is low power. The old is3v3===false rule
    // would have returned '2'.
    expect(kpiNumber(container, 'Low power')).toBe('1');
  });

  it('counts every 3v3 macaque-style track as full power (KPI = 0)', () => {
    const meta = {
      populations: ['a', 'b'],
      labels: { a: 'Pop A', b: 'Pop B' },
      qcFlags: {
        a: { is3v3: true, nNormal: 3, nObese: 3, minCells: 40, status: 'ok' },
        b: { is3v3: true, nNormal: 3, nObese: 3, minCells: 55, status: 'ok' },
      },
      qaReportFilenames: {},
    } as unknown as DatasetMeta;
    const { container } = render(
      <QCTab onSelectTrack={noop} qcData={emptyQc} meta={meta} />
    );
    expect(kpiNumber(container, 'Low power')).toBe('0');
  });
});
