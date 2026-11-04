import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { cloneElement } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { BarSEMChart, preloadBarSEMChart } from '../gene-explorer/BarSEMChart';
import { setChartScale, _resetChartScaleStore } from '../common/chartScaleStore';
import type { ChartScale } from '../utils/chartScale';
import { buildPopData } from '../data/buildPopData';
import { getActiveContrast } from '../data/contrasts';
import {
  HX_MACAQUE_SNRNA_E9_FIXTURE, MACAQUE_DATASET, MACAQUE_CONTRAST,
  BULK_DATASET_FIXTURE, BULK_TRACK_FIXTURE,
} from './fixtures';

// Same shim barSEMChart.test.tsx uses: jsdom reports offsetWidth 0, so
// ResponsiveContainer would render an empty chart and there would be no ticks to
// read. See that file for the full reasoning.
vi.mock('recharts', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, any>;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: any }) =>
      cloneElement(children, { width: 400, height: 200 }),
  };
});

beforeAll(async () => { await preloadBarSEMChart(); });
beforeEach(() => { _resetChartScaleStore(); });

async function renderChart(ui: ReactElement) {
  const result = render(ui);
  await waitFor(() => expect(result.queryByText('loading chart…')).toBeNull());
  return result;
}

/**
 * The macaque atlas: TMM-normalized CPM, POMC at 10–30. Labelled "CPM (TMM-normalized)" since the
 * R 4.6.0 regeneration (rule C2, data/quality/regeneration-r460-2026-09-25/README.md).
 */
const macaque = () => buildPopData(HX_MACAQUE_SNRNA_E9_FIXTURE, MACAQUE_DATASET, MACAQUE_CONTRAST)!;

/** A bulk study deposited on some log2 scale — `unit` picks which spelling. */
function bulk(unit: string) {
  const dataset = { ...BULK_DATASET_FIXTURE, expressionUnit: unit };
  return buildPopData(BULK_TRACK_FIXTURE, dataset, getActiveContrast(dataset))!;
}

const BASELINED_UNIT = 'log2 RMA (GeneSpring median-baselined)';
function baselined(values: number[]) {
  const dataset = { ...BULK_DATASET_FIXTURE, expressionUnit: BASELINED_UNIT };
  const track = { ...BULK_TRACK_FIXTURE, cpm: { ...BULK_TRACK_FIXTURE.cpm, POMC: values } };
  return buildPopData(track, dataset, getActiveContrast(dataset))!;
}

/** Every numeric y-axis tick that was actually drawn. */
function yTicks(container: HTMLElement): number[] {
  return [...container.querySelectorAll('text')]
    .map((t) => t.textContent ?? '')
    .filter((t) => /^-?\d+(\.\d+)?k?$/.test(t))
    .map((t) => (t.endsWith('k') ? Number.parseFloat(t) * 1000 : Number(t)));
}

const caption = (container: HTMLElement) =>
  container.querySelector('span[title]')?.textContent ?? '';

/** Check actual SVG geometry against the drawn axis, including the custom dots. */
function expectSignedGeometry(container: HTMLElement, values: number[]) {
  const axis = container.querySelector('.recharts-yAxis .recharts-cartesian-axis-line')!;
  const top = Math.min(Number(axis.getAttribute('y1')), Number(axis.getAttribute('y2')));
  const bottom = Math.max(Number(axis.getAttribute('y1')), Number(axis.getAttribute('y2')));
  const ticks = [...container.querySelectorAll('.recharts-yAxis-tick-labels text')]
    .map((text) => ({ value: Number(text.textContent), y: Number(text.getAttribute('y')) }))
    .sort((a, b) => a.value - b.value);
  const first = ticks[0], last = ticks[ticks.length - 1];
  expect(first.value).toBeLessThanOrEqual(Math.min(...values));
  expect(last.value).toBeGreaterThanOrEqual(Math.max(0, ...values));
  const toY = (value: number) => first.y + (value - first.value) * (last.y - first.y) / (last.value - first.value);
  const dots = [...container.querySelectorAll('circle[r="3.5"]')].map((dot) => Number(dot.getAttribute('cy')));
  expect(dots).toHaveLength(values.length);
  dots.forEach((y, index) => {
    expect(Number.isFinite(y)).toBe(true);
    expect(y).toBeGreaterThanOrEqual(top);
    expect(y).toBeLessThanOrEqual(bottom);
    expect(y).toBeCloseTo(toY(values[index]), 4);
  });
  const errorBars = [...container.querySelectorAll('.recharts-errorBars line')];
  expect(errorBars).toHaveLength(6);
  for (const line of errorBars) {
    for (const key of ['y1', 'y2']) {
      const y = Number(line.getAttribute(key));
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeGreaterThanOrEqual(top);
      expect(y).toBeLessThanOrEqual(bottom);
    }
  }
  return dots;
}

async function chartAt(scale: ChartScale, popData: ReturnType<typeof macaque>, gene = 'POMC') {
  // Unmount the previous chart before moving the store: a mounted chart is a
  // live subscriber, and re-scaling one outside act() is a warning, not a test.
  cleanup();
  setChartScale(scale);
  const { container } = await renderChart(
    <BarSEMChart gene={gene} popData={popData} contrast={popData.contrast} />,
  );
  return container;
}

// The pick is global and the unit is per-dataset, so the SAME pick has to read
// four ways across one grid. These are those four ways, at the chart.

describe('BarSEMChart — the scale pick reaches the axis', () => {
  it('leaves every dataset as deposited by default', async () => {
    expect(caption(await chartAt('native', macaque()))).toBe('CPM (TMM-normalized)');
    expect(caption(await chartAt('native', bulk('log2(FPKM + 1)')))).toBe('log2(FPKM + 1)');
  });

  it('logs a CPM dataset, and rescales the axis with it', async () => {
    // POMC's fixture runs 10–30 CPM, so a linear axis tops out around 40 and a
    // log2(x + 1) axis around 6.7. Reading the ticks proves the transform
    // reached the plotted geometry, not just the caption.
    const deposited = await chartAt('native', macaque());
    const linear = yTicks(deposited);
    expect(Math.min(...linear)).toBe(0);
    expect(Math.max(...linear)).toBe(40.5);
    expectSignedGeometry(deposited, [10, 12, 11, 25, 28, 30]);
    const logged = yTicks(await chartAt('log2', macaque()));
    expect(Math.max(...linear)).toBeGreaterThan(30);
    expect(Math.max(...logged)).toBeLessThan(8);
    expect(caption(await chartAt('log2', macaque()))).toBe('log2(CPM (TMM-normalized) + 1)');
  });

  it('does not log an already-logged dataset a second time', async () => {
    const asDeposited = yTicks(await chartAt('native', bulk('log2(FPKM + 1)')));
    const asked = yTicks(await chartAt('log2', bulk('log2(FPKM + 1)')));
    expect(asked).toEqual(asDeposited);
    expect(caption(await chartAt('log2', bulk('log2(FPKM + 1)')))).toBe('log2(FPKM + 1)');
  });

  it('puts an invertible log2 dataset back on its own linear unit', async () => {
    const container = await chartAt('linear', bulk('log2(FPKM + 1)'));
    // LEP's fixture values 4–15 are read as log2, so linear is 2^x − 1: 15 in
    // the file is 32,767 FPKM, and the axis has to grow to hold it.
    expect(caption(container)).toBe('FPKM');
    expect(Math.max(...yTicks(await chartAt('linear', bulk('log2(FPKM + 1)'), 'LEP'))))
      .toBeGreaterThan(1000);
  });

  it('marks a pick it could not honour rather than pretending it did', async () => {
    // 'log2-normalized' names no pseudocount, so there is no way back to a
    // linear axis. The chart stays as deposited and carries a dagger into a
    // tooltip that says why — the alternative is a silently unchanged chart.
    const container = await chartAt('linear', bulk('log2-normalized'));
    expect(caption(container)).toBe('log2†');
    expect(container.querySelector('span[title]')?.getAttribute('title'))
      .toMatch(/no stated pseudocount/);
  });

  it.each(['native', 'log2'] as const)('shows negative baselined samples and lower SEM on the %s scale', async (scale) => {
    const values = [-3, -2, -1, 0, 1, 0.4, 0.8, 1.2, 1.6, 2];
    const popData = baselined(values);
    const container = await chartAt(scale, popData);
    expect(caption(container)).toBe(BASELINED_UNIT);
    expectSignedGeometry(container, values);
    expect(popData.cpm.POMC).toEqual(values);
  });

  it.each(['native', 'log2'] as const)('keeps an all-negative baselined series visible on the %s scale', async (scale) => {
    const values = [-4, -3, -2, -1, -2, -8, -7, -6, -5, -6];
    const container = await chartAt(scale, baselined(values));
    expect(caption(container)).toBe(BASELINED_UNIT);
    expectSignedGeometry(container, values);
    expect(Math.max(...yTicks(container))).toBe(0);
    const axis = container.querySelector('.recharts-yAxis .recharts-cartesian-axis-line')!;
    const zeroY = Math.min(Number(axis.getAttribute('y1')), Number(axis.getAttribute('y2')));
    const bracket = [...container.querySelectorAll('text')].find((text) => text.textContent === '*')!;
    expect(Number(bracket.getAttribute('y'))).toBeGreaterThan(0);
    expect(Number(bracket.getAttribute('y'))).toBeLessThan(zeroY);
  });

  it('retains signed geometry when a baselined log unit cannot be made linear', async () => {
    const values = [-3, -2, -1, 0, 1, 0.4, 0.8, 1.2, 1.6, 2];
    const deposited = expectSignedGeometry(await chartAt('native', baselined(values)), values);
    const fallback = await chartAt('linear', baselined(values));
    expect(caption(fallback)).toBe(`${BASELINED_UNIT}†`);
    expect(fallback.querySelector('span[title]')?.getAttribute('title')).toMatch(/Showing them as deposited/);
    expect(expectSignedGeometry(fallback, values)).toEqual(deposited);
  });
});
