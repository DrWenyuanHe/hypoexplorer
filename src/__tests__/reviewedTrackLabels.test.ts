import { describe, expect, it } from 'vitest';
import { reviewedMetadata, reviewedTrackLabel } from '../data/reviewedTrackLabels';
import type { DatasetMeta } from '../types';

const id = 'mouse_pvn_crh_ela_gse174085';
const legacy = 'PVN CRH neurons (animal pseudobulk)';

describe('reviewed litter display label', () => {
  it('corrects the reviewed track without changing source metadata or sample counts', () => {
    const source = Object.freeze({ labels: Object.freeze({ crh_pvn: legacy }),
      qcFlags: Object.freeze({ crh_pvn: Object.freeze({ nNormal: 14, nObese: 10 }) }) }) as unknown as DatasetMeta;
    const result = reviewedMetadata(id, source);
    expect(result.labels.crh_pvn).toBe('PVN CRH neurons (litter pseudobulk)');
    expect(source.labels.crh_pvn).toBe(legacy);
    expect(result.qcFlags).toBe(source.qcFlags);
    expect(reviewedMetadata(id, source)).toBe(result);
  });

  it('does not relabel another dataset, track or a newer source description', () => {
    expect(reviewedTrackLabel('another-study', 'crh_pvn', legacy)).toBe(legacy);
    expect(reviewedTrackLabel(id, 'another-track', legacy)).toBe(legacy);
    expect(reviewedTrackLabel(id, 'crh_pvn', 'New source description')).toBe('New source description');
  });
});
