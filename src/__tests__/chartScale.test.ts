import { describe, it, expect } from 'vitest';
import {
  CHART_SCALES, classifyUnit, formatAxisTick, resolveChartScale,
} from '../utils/chartScale';
import { listDatasets } from '../data/datasets';

// The unit string is free text written by whoever registered the dataset, so
// classifyUnit READS it rather than looking it up. These are the real spellings
// in the registry — every distinct one, so a new study that copies an existing
// spelling is covered the day it lands.

describe('classifyUnit', () => {
  it('reads a plain linear unit', () => {
    expect(classifyUnit('CPM')).toEqual({ kind: 'linear', label: 'CPM' });
    // Absent unit is CPM by the same default buildPopData applies.
    expect(classifyUnit(undefined).kind).toBe('linear');
    expect(classifyUnit('').label).toBe('CPM');
  });

  it('parses the pseudocount out of an invertible log2 unit', () => {
    expect(classifyUnit('log2(FPKM + 1)')).toEqual({
      kind: 'log2', label: 'log2(FPKM + 1)', base: 'FPKM', offset: 1,
    });
    expect(classifyUnit('log2(CPM + 0.0001)')).toMatchObject({ base: 'CPM', offset: 0.0001 });
    // A multi-word base survives intact — the split is at the LAST plus.
    expect(classifyUnit('log2(DESeq2-normalized count + 1)')).toMatchObject({
      kind: 'log2', base: 'DESeq2-normalized count', offset: 1,
    });
    expect(classifyUnit('log2(gene-summed FPKM + 1)')).toMatchObject({ base: 'gene-summed FPKM' });
  });

  it('marks a log2 unit with no stated offset as opaque, not invertible', () => {
    for (const unit of ['log2-normalized', 'log2 CPM (TMM-normalized)', 'log2 counts per million (log2-CPM)']) {
      expect(classifyUnit(unit).kind).toBe('log2-opaque');
    }
    // The short spelling the charts have always shown survives.
    expect(classifyUnit('log2-normalized').label).toBe('log2');
  });

  it('marks variance-stabilized values as neither', () => {
    expect(classifyUnit('DESeq2 variance-stabilized expression').kind).toBe('other');
    expect(classifyUnit('variance-stabilized expression (VST)').kind).toBe('other');
  });

  // The guard that matters: a unit that mentions a log must never classify as
  // linear, because that is the one mistake with a silent wrong answer — the
  // chart would log an already-logged value and plot log2(log2(x) + 1).
  it('never calls a logged unit linear, across the whole registry', () => {
    const mislabelled = listDatasets()
      .map((d) => d.expressionUnit ?? 'CPM')
      .filter((unit) => /log/i.test(unit) && classifyUnit(unit).kind === 'linear');
    expect(mislabelled).toEqual([]);
  });
});

describe('resolveChartScale — as deposited', () => {
  it('transforms nothing, whatever the unit', () => {
    for (const unit of ['CPM', 'log2(FPKM + 1)', 'log2-normalized', 'variance-stabilized expression (VST)']) {
      const view = resolveChartScale(unit, 'native');
      expect(view.transform(7)).toBe(7);
      expect(view.unavailable).toBeUndefined();
    }
    expect(resolveChartScale('CPM', 'native').unitLabel).toBe('CPM');
  });
});

describe('resolveChartScale — log2', () => {
  it('logs a linear unit with a pseudocount, and says so in the label', () => {
    const view = resolveChartScale('CPM', 'log2');
    expect(view.unitLabel).toBe('log2(CPM + 1)');
    expect(view.transform(0)).toBe(0);      // a zero stays on the axis
    expect(view.transform(1)).toBe(1);      // log2(2)
    expect(view.transform(7)).toBe(3);      // log2(8)
    expect(view.unavailable).toBeUndefined();
  });

  it('leaves an already-logged dataset alone rather than logging it twice', () => {
    for (const unit of ['log2(FPKM + 1)', 'log2-normalized']) {
      const view = resolveChartScale(unit, 'log2');
      expect(view.transform(6.5)).toBe(6.5);
      expect(view.unavailable).toBeUndefined();
    }
    expect(resolveChartScale('log2(FPKM + 1)', 'log2').unitLabel).toBe('log2(FPKM + 1)');
  });

  it('refuses to log variance-stabilized values, and reports why', () => {
    const view = resolveChartScale('variance-stabilized expression (VST)', 'log2');
    expect(view.transform(4)).toBe(4);
    expect(view.unavailable).toMatch(/already on a log-like scale/);
    // The reason is reachable from the chart's own hover text.
    expect(view.provenance).toContain(view.unavailable);
  });
});

describe('resolveChartScale — linear', () => {
  it('inverts a log2 unit exactly, and labels the axis with the base unit', () => {
    const view = resolveChartScale('log2(FPKM + 1)', 'linear');
    expect(view.unitLabel).toBe('FPKM');
    expect(view.transform(0)).toBe(0);      // 2^0 − 1
    expect(view.transform(3)).toBe(7);      // 2^3 − 1
    expect(view.unavailable).toBeUndefined();
  });

  it('honours a non-unit pseudocount', () => {
    const view = resolveChartScale('log2(CPM + 0.0001)', 'linear');
    expect(view.unitLabel).toBe('CPM');
    expect(view.transform(Math.log2(5.0001))).toBeCloseTo(5, 10);
  });

  it('never invents a back-transform for a log2 unit with no stated offset', () => {
    const view = resolveChartScale('log2-normalized', 'linear');
    expect(view.transform(6.5)).toBe(6.5);
    expect(view.unitLabel).toBe('log2');
    expect(view.unavailable).toMatch(/no stated pseudocount/);
  });

  it('leaves a linear dataset as it is', () => {
    const view = resolveChartScale('CPM', 'linear');
    expect(view.unitLabel).toBe('CPM');
    expect(view.transform(120)).toBe(120);
    expect(view.unavailable).toBeUndefined();
  });

  it('says what a transformed axis did to the mean, since the mean moved', () => {
    // mean(log) ≠ log(mean), and the bar is the former — a reader who assumes
    // otherwise is reading a number that is not there.
    expect(resolveChartScale('CPM', 'log2').provenance).toMatch(/mean of the transformed values/);
    expect(resolveChartScale('log2(FPKM + 1)', 'linear').provenance).toMatch(/mean of the transformed values/);
    // …and that the p-value did not move with it.
    expect(resolveChartScale('CPM', 'log2').provenance).toMatch(/unaffected by this display choice/);
  });
});

describe('formatAxisTick', () => {
  it('keeps a log2 axis legible, where integer rounding printed 0 1 2 2 3', () => {
    expect(formatAxisTick(2.5)).toBe('2.5');
    expect(formatAxisTick(0.8333333)).toBe('0.833');
    expect(formatAxisTick(0)).toBe('0');
  });

  it('keeps the thousands shorthand a CPM axis needs', () => {
    expect(formatAxisTick(2400)).toBe('2.4k');
    expect(formatAxisTick(250)).toBe('250');
    expect(formatAxisTick(42)).toBe('42');
  });

  it('renders nothing for a non-finite tick', () => {
    expect(formatAxisTick(Number.NaN)).toBe('');
  });
});

describe('CHART_SCALES', () => {
  it('offers exactly the three the toggle shows, deposited first', () => {
    expect(CHART_SCALES).toEqual(['native', 'linear', 'log2']);
  });
});
