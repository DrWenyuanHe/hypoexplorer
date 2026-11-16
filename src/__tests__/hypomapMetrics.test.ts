import { describe, expect, it } from 'vitest';
import { datasetMetrics, poolMetrics } from '../search/hypomap/atlas';

const metadata = {
  cohort: 'fixture cohort',
  contexts: ['Whole hypothalamus', 'ARC'],
  datasets: ['D1', 'D2', 'D3'],
  eligible_cells: { D1: [100, 10], D2: [50, 0], D3: [40, 4] },
  study_cards: [{ HypoMap_label: 'One' }, { HypoMap_label: 'Two' }, { HypoMap_label: 'Three' }],
};
// D3 has no stored feature for this gene: its metrics are unavailable, not zero.
const record: Parameters<typeof datasetMetrics>[1] = [7, [], [[[20, 5], [40, 10]], [[0, 0], [0, 0]], null]];

describe('datasetMetrics', () => {
  it('reads each dataset for one region and keeps an absent feature unavailable', () => {
    expect(datasetMetrics(metadata, record, 'ARC')).toEqual([
      { id: 'D1', label: 'One', eligible: 10, positive: 5, logSum: 10, detection: 50, mean: 2 },
      { id: 'D2', label: 'Two', eligible: 0, positive: 0, logSum: 0, detection: null, mean: null },
      { id: 'D3', label: 'Three', eligible: 4, positive: null, logSum: null, detection: null, mean: null },
    ]);
  });
});

describe('poolMetrics', () => {
  it('pools cells over datasets that measured the gene, leaving out unavailable ones', () => {
    expect(poolMetrics(datasetMetrics(metadata, record, 'Whole hypothalamus'))).toEqual({
      eligible: 150, positive: 20, logSum: 40, detection: 100 * 20 / 150, mean: 2,
    });
  });

  it('reports no detection when nothing was measured', () => {
    expect(poolMetrics(datasetMetrics(metadata, [7, [], [null, null, null]], 'ARC')))
      .toEqual({ eligible: 0, positive: 0, logSum: 0, detection: null, mean: null });
  });
});
