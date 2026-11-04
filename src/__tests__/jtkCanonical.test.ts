import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { jtkSupport, jtkCacheSize, jtkCacheBytes } from '../circadian/jtkCycle';
import { cosinor, fittedCurve, jtkCycle, DEFAULT_PERIODS, SCAN_PERIODS } from '../circadian/rhythmicity';

interface ReferenceCase {
  id: string;
  grid: string;
  times: number[];
  values: Array<number | null>;
  expected: { p: number; period: number; acrophase: number; amplitude: number };
}
const fixture = JSON.parse(readFileSync(new URL('./fixtures/jtkCanonical.json', import.meta.url), 'utf8')) as {
  referenceSha256: string; cases: ReferenceCase[]; cosinorCases: ReferenceCase[];
};

describe('canonical JTK_CYCLE parity with unchanged CRAN MetaCycle 1.2.1', () => {
  it.each(fixture.cases)('$id / $grid', (c) => {
    const result = jtkCycle({ times: c.times, values: c.values.map((v) => v ?? Number.NaN) },
      { periods: c.grid === 'fixed24' ? DEFAULT_PERIODS : SCAN_PERIODS });
    expect(result).not.toBeNull();
    expect(Math.abs((result?.p ?? 2) - c.expected.p)).toBeLessThan(1e-12);
    expect(result?.period).toBe(c.expected.period);
    expect(Math.abs((result?.acrophase ?? -1) - c.expected.acrophase)).toBeLessThan(1e-10);
    expect(Math.abs((result?.amplitude ?? -1) - c.expected.amplitude)).toBeLessThan(1e-9);
  });

  it('declines irregular schedules instead of treating adjacent times as equally spaced', () => {
    const times = [0, 3, 5, 11, 14, 19];
    expect(jtkSupport(times, [24]).reason).toMatch(/regular sampling grid/);
    expect(jtkCycle({ times, values: [1, 2, 4, 3, 1, 0] }, { periods: [24] })).toBeNull();
  });

  it('tests only explicitly requested supported periods without rounding to another period', () => {
    const times = [0, 0, 4, 4, 8, 8, 12, 12, 16, 16, 20, 20];
    expect(jtkSupport(times, [23]).supported).toBe(false);
    expect(jtkSupport(times, SCAN_PERIODS).periods).toEqual([20, 24]);
    const series = { times, values: times.map((t) => 5 + Math.cos(2 * Math.PI * t / 24)) };
    expect(jtkCycle(series, { periods: [23] })).toBeNull();
    expect(jtkCycle(series, { periods: [23, 24, 25] })).toEqual(jtkCycle(series, { periods: [24] }));
    expect(jtkCycle(series, { periods: [24, 24] })).toEqual(jtkCycle(series, { periods: [24] }));
  });

  it('represents zero amplitude without inventing a peak or producing a nonfinite curve', () => {
    const result = jtkCycle({ times: [4, 8, 12, 16, 20, 24], values: [7, 7, 7, 7, 7, 7] }, { periods: [24] });
    expect(result).toMatchObject({ p: 1, period: 0, acrophase: 0, amplitude: 0, mesor: 7 });
    expect(fittedCurve(result!, 0, 24).every((p) => p.y === 7)).toBe(true);
  });

  it('bounds cached plans and explicitly reports resource limits', () => {
    for (let n = 4; n <= 28; n++) {
      const times = Array.from({ length: n }, (_, i) => 4 * Math.floor(i * 6 / n));
      jtkCycle({ times, values: times.map((t, i) => Math.cos(t) + i / 100) }, { periods: [24] });
    }
    expect(jtkCacheSize()).toBeLessThanOrEqual(16);
    expect(jtkCacheBytes()).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(jtkSupport(Array.from({ length: 161 }, (_, i) => i), [24]).reason).toMatch(/at most 160 observations/);
    const large = Array.from({ length: 160 }, (_, i) => i);
    expect(jtkSupport(large, Array.from({ length: 159 }, (_, i) => i + 2)).reason).toMatch(/work or memory limit/);
    expect(jtkCycle({ times: large, values: large }, { periods: Array.from({ length: 159 }, (_, i) => i + 2) })).toBeNull();
  });
});

describe('cosinor search correction against independent QR-based R models', () => {
  it.each(fixture.cosinorCases)('$id / $grid', (c) => {
    const r = cosinor({ times: c.times, values: c.values as number[] },
      { periods: c.grid === 'fixed24' ? DEFAULT_PERIODS : SCAN_PERIODS });
    expect(r?.period).toBe(c.expected.period);
    expect(Math.abs((r?.p ?? 2) - c.expected.p)).toBeLessThan(1e-12);
  });
});
