// The gene page's summary of a regional source (HYPOMAP Visium): groups are the
// authors' regional clusters and samples are donors, so one donor recurs across
// regions. The donor spread used for GTEx and Allen would count regions as people.
import { describe, expect, it } from 'vitest';
import { regionalSummary } from '../search/searchSummaries';
import type { ExpressionCondition, ExpressionGroupResult, ExpressionSource } from '../types';

const condition = (key: string, donors: number, unassigned = false): ExpressionCondition => ({
  key, label: `${key} label`, referenceEligible: false, feedingState: 'not applicable', notes: '', sampleCount: donors,
  coverage: { donors, sections: donors, spots: 100 * donors }, ...(unassigned ? { unassigned: true } : {}),
});

const source = {
  id: 'visium-test', groupKind: 'region',
  conditions: [condition('ARC', 2), condition('PVN', 3), condition('Unassigned', 1, true)],
} as ExpressionSource;

const group = (key: string, samples: Array<[string, number | null]>, pooled?: number | null): ExpressionGroupResult => {
  const values = samples.flatMap(([, value]) => (value == null ? [] : [value]));
  return {
    key, label: `${key} label`, referenceEligible: false,
    samples: samples.map(([id, value]) => ({ id, value })),
    mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    ...(pooled !== undefined ? { pooled } : {}),
    n: values.length, totalSamples: samples.length,
  };
};

describe('regionalSummary', () => {
  it('keeps a donor sampled in two regions in both, counts that donor once and ranks by the pooled value', () => {
    const { regions, donors } = regionalSummary([
      // ARC's pooled value (all spots summed) is below its donor mean: a large low library outweighs a small high one.
      group('ARC', [['Donor 1', 10], ['Donor 2', 30]], 12),
      group('PVN', [['Donor 1', 4], ['Donor 3', 2], ['Donor 4', null]], 15),
      group('Unassigned', [['Donor 2', 50]], 50),
    ], source);
    // Three donors with a value across the regions: not five donor-region samples, and not three regions.
    expect(donors).toBe(3);
    expect(regions.map((region) => region.key)).toEqual(['Unassigned', 'PVN', 'ARC']);
    const arc = regions.find((region) => region.key === 'ARC')!;
    const pvn = regions.find((region) => region.key === 'PVN')!;
    expect(arc).toMatchObject({ value: 12, spots: 200, unassigned: false });
    expect(arc.donors).toEqual([{ donor: 'Donor 1', value: 10 }, { donor: 'Donor 2', value: 30 }]);
    // A missing value is left out, never read as zero; Donor 1 is in PVN as well as ARC.
    expect(pvn.donors).toEqual([{ donor: 'Donor 1', value: 4 }, { donor: 'Donor 3', value: 2 }]);
    expect(pvn.value).toBe(15);
    // Unassigned spots are listed with their flag, for the tile to leave unranked.
    expect(regions.find((region) => region.key === 'Unassigned')?.unassigned).toBe(true);
  });

  it('falls back to the donor mean without a pooled value, and drops a region with no value', () => {
    const { regions, donors } = regionalSummary([group('ARC', [['Donor 1', null]]), group('PVN', [['Donor 2', 0], ['Donor 3', 4]])], source);
    expect(regions.map((region) => [region.key, region.value])).toEqual([['PVN', 2]]);
    expect(donors).toBe(2);
  });
});
