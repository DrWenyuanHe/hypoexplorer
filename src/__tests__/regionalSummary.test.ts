// The gene page's summary of a regional source (HYPOMAP Visium): groups are
// regions and samples are donors, so one donor recurs across regions. The donor
// spread used for GTEx and Allen would count regions as people.
import { describe, expect, it } from 'vitest';
import { regionalSummary } from '../search/searchSummaries';
import type { ExpressionCondition, ExpressionGroupResult, ExpressionSource } from '../types';

const condition = (key: string, donors: number, compartment = 'hypothalamic'): ExpressionCondition => ({
  key, label: `${key} label`, referenceEligible: false, feedingState: 'not applicable', notes: '', sampleCount: donors,
  compartment, coverage: { donors, sections: donors, spots: 100 * donors, sparse: donors < 3 },
});

const source = {
  id: 'visium-test', groupKind: 'region',
  conditions: [condition('ARC', 2), condition('PVN', 3), condition('Fx/LH', 1, 'fibre tract')],
} as ExpressionSource;

const group = (key: string, samples: Array<[string, number | null]>): ExpressionGroupResult => {
  const values = samples.flatMap(([, value]) => (value == null ? [] : [value]));
  return {
    key, label: `${key} label`, referenceEligible: false,
    samples: samples.map(([id, value]) => ({ id, value })),
    mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    n: values.length, totalSamples: samples.length,
  };
};

describe('regionalSummary', () => {
  it('keeps a donor sampled in two regions in both, and counts that donor once', () => {
    const { regions, donors } = regionalSummary([
      group('ARC', [['Donor 1', 10], ['Donor 2', 30]]),
      group('PVN', [['Donor 1', 4], ['Donor 3', 2], ['Donor 4', null]]),
      group('Fx/LH', [['Donor 2', 50]]),
    ], source);
    // Three donors with a value across the regions: not five donor-region samples, and not three regions.
    expect(donors).toBe(3);
    expect(regions.map((region) => region.key)).toEqual(['Fx/LH', 'ARC', 'PVN']);
    const arc = regions.find((region) => region.key === 'ARC')!;
    const pvn = regions.find((region) => region.key === 'PVN')!;
    expect(arc).toMatchObject({ mean: 20, sparse: true, spots: 200, compartment: 'hypothalamic' });
    expect(arc.donors).toEqual([{ donor: 'Donor 1', value: 10 }, { donor: 'Donor 2', value: 30 }]);
    // A missing value is left out, never read as zero; Donor 1 is in PVN as well as ARC.
    expect(pvn.donors).toEqual([{ donor: 'Donor 1', value: 4 }, { donor: 'Donor 3', value: 2 }]);
    expect(pvn).toMatchObject({ mean: 3, sparse: false });
    expect(regions.find((region) => region.key === 'Fx/LH')?.compartment).toBe('fibre tract');
  });

  it('drops a region with no value', () => {
    const { regions, donors } = regionalSummary([group('ARC', [['Donor 1', null]]), group('PVN', [['Donor 2', 0]])], source);
    expect(regions.map((region) => [region.key, region.mean])).toEqual([['PVN', 0]]);
    expect(donors).toBe(1);
  });
});
