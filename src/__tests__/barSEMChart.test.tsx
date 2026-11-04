import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { ReactElement } from 'react';
import { cloneElement } from 'react';
import { render, waitFor } from '@testing-library/react';
import { BarSEMChart, preloadBarSEMChart } from '../gene-explorer/BarSEMChart';
import { buildPopData } from '../data/buildPopData';
import { getActiveContrast } from '../data/contrasts';
import {
  HX_MACAQUE_SNRNA_E9_FIXTURE,
  MACAQUE_DATASET,
  MACAQUE_CONTRAST,
  BULK_DATASET_FIXTURE,
  BULK_TRACK_FIXTURE,
  makePopData,
} from './fixtures';

// recharts' ResponsiveContainer measures the parent via offsetWidth/offsetHeight,
// which jsdom reports as 0 — so the real chart renders nothing. Replace it with
// a pass-through that injects fixed width/height into its single chart child, so
// the SVG ticks + bars actually paint and we can assert on labels/colors. All
// other recharts exports are kept intact.
vi.mock('recharts', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, any>;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: any }) =>
      cloneElement(children, { width: 400, height: 200 }),
  };
});

// BarSEMChart is a React.lazy wrapper (see BarSEMChart.tsx — recharts is 319 KB
// and is kept off the landing page's critical path), so the first paint is a
// skeleton and the real SVG arrives once the chunk resolves.
async function renderChart(ui: ReactElement) {
  const result = render(ui);
  await waitFor(() => expect(result.queryByText('loading chart…')).toBeNull());
  return result;
}

describe('BarSEMChart — lazy boundary', () => {
  it('renders a placeholder on first paint rather than blocking', () => {
    // NOTE what this does and does NOT prove. React.lazy always suspends on its
    // first render — it calls the import() factory at that moment, and a promise
    // resolves no earlier than the next microtask — so this passes whether or not
    // recharts is still in the eager bundle. It pins the user-visible contract
    // (a skeleton holds the chart's footprint, nothing blocks or throws), not the
    // code-splitting itself.
    //
    // The actual split is enforced by lazyChunkBoundaries.test.ts, which fails if
    // anything static-imports BarSEMChartImpl. Ground truth is the eager asset
    // list in dist/index.html.
    const popData = buildPopData(HX_MACAQUE_SNRNA_E9_FIXTURE, MACAQUE_DATASET, MACAQUE_CONTRAST)!;
    const { queryByText } = render(<BarSEMChart gene="POMC" popData={popData} />);
    expect(queryByText('loading chart…')).toBeTruthy();
  });
});

// BarSEMChart must take its two bars' labels + colors from the resolved contrast
// groups (NOT hardcoded Normal/Obese constants), and surface each group's n.

const RECHARTS_PRELOAD_TIMEOUT_MS = 60000;

describe('BarSEMChart — labels + colors from contrast', () => {
  // Evaluate the recharts module once, up front.
  //
  // This does NOT make the renders below synchronous — React.lazy keeps its own
  // payload cache and still suspends for a microtask on first render. What it
  // does is move the expensive part (evaluating recharts, the largest dependency
  // in the app) out of the timed window, so the lazy import resolves well inside
  // waitFor's 1 s default. Without it this file passed alone and failed
  // intermittently in the full run, where worker contention pushed that first
  // evaluation past a second.
  // The preload itself now needs a ceiling above the 15 s global hookTimeout:
  // evaluating recharts is the single most expensive import in the suite, and
  // with four workers competing it has exceeded 15 s in the full run while
  // finishing in ~1.5 s for this file alone. Same reasoning as
  // LIBRARY_SWITCH_TIMEOUT_MS in app.contrast.test.tsx — a hang backstop, not
  // a licence to be slow.
  beforeAll(async () => { await preloadBarSEMChart(); }, RECHARTS_PRELOAD_TIMEOUT_MS);

  it('renders macaque Normal/Obese group labels with per-group n', async () => {
    const popData = buildPopData(HX_MACAQUE_SNRNA_E9_FIXTURE, MACAQUE_DATASET, MACAQUE_CONTRAST)!;
    const { container } = await renderChart(
      <BarSEMChart gene="POMC" popData={popData} contrast={popData.contrast} />
    );
    // The XAxis tickFormatter renders "<label> (n=<n>)". POMC fixture is 3v3.
    const texts = [...container.querySelectorAll('text')].map(t => t.textContent);
    expect(texts.some(t => /Normal \(n=3\)/.test(t))).toBe(true);
    expect(texts.some(t => /Obese \(n=3\)/.test(t))).toBe(true);
    // No leftover hardcoded label without n.
    expect(texts).not.toContain('Normal');
  });

  it('bar fills come from the contrast group colors', async () => {
    const popData = buildPopData(HX_MACAQUE_SNRNA_E9_FIXTURE, MACAQUE_DATASET, MACAQUE_CONTRAST)!;
    const { container } = await renderChart(
      <BarSEMChart gene="POMC" popData={popData} contrast={popData.contrast} />
    );
    const baselineColor = popData.contrast!.baseline.color;   // #3775BA
    const caseColor = popData.contrast!.caseGroup.color;      // #B64342
    const fills = [...container.querySelectorAll('path, rect')].map(el => el.getAttribute('fill'));
    expect(fills).toContain(baselineColor);
    expect(fills).toContain(caseColor);
  });

  it('uses the dataset-specific group labels for a non-macaque (bulk) dataset', async () => {
    const contrast = getActiveContrast(BULK_DATASET_FIXTURE);
    const popData = buildPopData(BULK_TRACK_FIXTURE, BULK_DATASET_FIXTURE, contrast)!;
    const { container } = await renderChart(
      <BarSEMChart gene="LEP" popData={popData} contrast={popData.contrast} />
    );
    const texts = [...container.querySelectorAll('text')].map(t => t.textContent);
    // Bulk groups are Chow (n=5) / HFD (n=5) — proves nothing is hardcoded to Normal/Obese.
    expect(texts.some(t => /Chow \(n=5\)/.test(t))).toBe(true);
    expect(texts.some(t => /HFD \(n=5\)/.test(t))).toBe(true);
    expect(texts.some(t => /Normal/.test(t))).toBe(false);
  });

  it('falls back to popData.contrast when no contrast prop is passed', async () => {
    const popData = buildPopData(HX_MACAQUE_SNRNA_E9_FIXTURE, MACAQUE_DATASET, MACAQUE_CONTRAST)!;
    const { container } = await renderChart(<BarSEMChart gene="POMC" popData={popData} />);
    const texts = [...container.querySelectorAll('text')].map(t => t.textContent);
    expect(texts.some(t => /Normal \(n=3\)/.test(t))).toBe(true);
    expect(texts.some(t => /Obese \(n=3\)/.test(t))).toBe(true);
  });
});

// ── Multi-condition mode ─────────────────────────────────────────────────────
// A factorial dataset's four design cells on one axis, each declared comparison
// bracketed with its OWN p-value. The default two-arm chart above is unchanged
// by any of this; these pin what the extra props buy.

const CELLS = [
  { key: 'chow_p0', label: 'Chow P0', color: '#6FA1DC' },
  { key: 'hfd_p0', label: 'HFD P0', color: '#D98886' },
  { key: 'chow_p21', label: 'Chow P21', color: '#25537F' },
  { key: 'hfd_p21', label: 'HFD P21', color: '#8A2F2E' },
];

const factorialPop = () => makePopData({
  de: [{ gene: 'Timp1', logFC: 0.1, PValue: 0.9, FDR: 0.99 }],
  cpm: { Timp1: [1, 2, 8, 9, 4, 20, 22] },
  sampleOrder: ['C0a', 'C0b', 'H0a', 'H0b', 'C21a', 'H21a', 'H21b'],
  groupSamples: {
    chow_p0: ['C0a', 'C0b'],
    hfd_p0: ['H0a', 'H0b'],
    chow_p21: ['C21a'],
    hfd_p21: ['H21a', 'H21b'],
  },
});

// One per contrast of the 2x2: diet at each age, then maturation in each arm.
const COMPARISONS = [
  { from: 'chow_p0', to: 'hfd_p0', star: 'ns', title: 'Maternal HFD vs chow · at P0: logFC +0.10' },
  { from: 'chow_p21', to: 'hfd_p21', star: '**', title: 'Maternal HFD vs chow · at P21: logFC +1.41' },
  { from: 'chow_p0', to: 'chow_p21', star: '*', title: 'P21 vs P0 · chow arm: logFC +0.80' },
  { from: 'hfd_p0', to: 'hfd_p21', star: '***', title: 'P21 vs P0 · HFD arm: logFC +1.90' },
];

describe('BarSEMChart — all conditions', () => {
  // The preload itself now needs a ceiling above the 15 s global hookTimeout:
  // evaluating recharts is the single most expensive import in the suite, and
  // with four workers competing it has exceeded 15 s in the full run while
  // finishing in ~1.5 s for this file alone. Same reasoning as
  // LIBRARY_SWITCH_TIMEOUT_MS in app.contrast.test.tsx — a hang backstop, not
  // a licence to be slow.
  beforeAll(async () => { await preloadBarSEMChart(); }, RECHARTS_PRELOAD_TIMEOUT_MS);

  it('draws one bar per design cell, labelled and sized from that cell alone', async () => {
    const { container } = await renderChart(
      <BarSEMChart gene="Timp1" popData={factorialPop()} groups={CELLS} />,
    );
    const texts = [...container.querySelectorAll('text, tspan')].map((t) => t.textContent);
    for (const cell of CELLS) expect(texts).toContain(cell.label);
    // n is on its own line per cell — 2/2/1/2, not the contrast's pooled pair.
    expect(texts.filter((t) => t === 'n=2')).toHaveLength(3);
    expect(texts.filter((t) => t === 'n=1')).toHaveLength(1);
    const fills = [...container.querySelectorAll('path, rect')].map((el) => el.getAttribute('fill'));
    for (const cell of CELLS) expect(fills).toContain(cell.color);
  });

  it('brackets each comparison with its OWN star, not the active contrast\'s p', async () => {
    const { container } = await renderChart(
      <BarSEMChart gene="Timp1" popData={factorialPop()} groups={CELLS} comparisons={COMPARISONS} />,
    );
    const texts = [...container.querySelectorAll('text')].map((t) => t.textContent);
    // popData's own DE row is P=0.9 ('ns'); three of the four brackets are not.
    for (const star of ['ns', '**', '*', '***']) expect(texts).toContain(star);
    // Each bracket carries its contrast's stats on hover. (recharts puts an
    // empty <title> on the chart surface itself; only the bracket ones have text.)
    const titles = [...container.querySelectorAll('title')].map((t) => t.textContent).filter(Boolean);
    expect(titles).toEqual(COMPARISONS.map((c) => c.title));
  });

  it('drops a comparison naming a group that is not drawn', async () => {
    const { container } = await renderChart(
      <BarSEMChart gene="Timp1" popData={factorialPop()} groups={CELLS}
        comparisons={[{ from: 'chow_p0', to: 'not_drawn', star: '****' }]} />,
    );
    const texts = [...container.querySelectorAll('text')].map((t) => t.textContent);
    expect(texts).not.toContain('****');
  });

  it('keeps the two-arm chart when no groups are passed', async () => {
    const popData = buildPopData(HX_MACAQUE_SNRNA_E9_FIXTURE, MACAQUE_DATASET, MACAQUE_CONTRAST)!;
    const { container } = await renderChart(<BarSEMChart gene="POMC" popData={popData} />);
    const texts = [...container.querySelectorAll('text')].map((t) => t.textContent);
    expect(texts.some((t) => /Normal \(n=3\)/.test(t ?? ''))).toBe(true);
  });
});

// ── Long group labels ────────────────────────────────────────────────────────
// Some studies name their arms in full ("Four-week corticosterone"). On one line
// the two labels ran into each other; each now wraps to its own bar's slot, and
// the axis reserves room for the extra lines.

const LONG_CONTRAST = {
  id: 'cort_vs_vehicle',
  baseline: { key: 'normal', label: 'Four-week vehicle', color: '#3775BA' },
  caseGroup: { key: 'obese', label: 'Four-week corticosterone', color: '#B64342' },
  supportsPathways: false,
  label: 'Corticosterone vs vehicle',
};
const longPop = () => makePopData({
  contrast: LONG_CONTRAST, groups: [LONG_CONTRAST.baseline, LONG_CONTRAST.caseGroup],
});
const tickLines = (container: Element) => [...container.querySelectorAll('.recharts-xAxis-tick-labels text')]
  .map((t) => [...t.querySelectorAll('tspan')].map((s) => s.textContent));
const axisLineY = (container: Element) =>
  Number(container.querySelector('.recharts-xAxis .recharts-cartesian-axis-line')?.getAttribute('y1'));

describe('BarSEMChart — long group labels', () => {
  beforeAll(async () => { await preloadBarSEMChart(); }, RECHARTS_PRELOAD_TIMEOUT_MS);

  it('wraps each label onto several lines and keeps its n', async () => {
    const { container } = await renderChart(<BarSEMChart gene="POMC" popData={longPop()} contrast={LONG_CONTRAST} />);
    const lines = tickLines(container);
    expect(lines).toHaveLength(2);
    for (const tick of lines) expect(tick.length).toBeGreaterThan(1);
    expect(lines[0].join(' ')).toBe('Four-week vehicle (n=2)');
    expect(lines[1].join(' ')).toBe('Four-week corticosterone (n=2)');
  });

  it('keeps a short label on its single line', async () => {
    const { container } = await renderChart(<BarSEMChart gene="POMC" popData={makePopData()} />);
    expect(tickLines(container)).toEqual([['Normal (n=2)'], ['Obese (n=2)']]);
  });

  it('reserves axis height for the wrapped lines', async () => {
    // The mocked container pins the svg at 200 px, so a taller x-axis shows up
    // as its axis line sitting higher than the short-label chart's.
    const short = await renderChart(<BarSEMChart gene="POMC" popData={makePopData()} />);
    const shortY = axisLineY(short.container);
    short.unmount();
    const long = await renderChart(<BarSEMChart gene="POMC" popData={longPop()} contrast={LONG_CONTRAST} />);
    expect(axisLineY(long.container)).toBeLessThan(shortY);
  });
});
