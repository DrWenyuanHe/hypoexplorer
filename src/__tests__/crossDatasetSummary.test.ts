import { describe, it, expect } from 'vitest';
import { summarizeGroup } from '../data/crossDataset';
import { listDatasets } from '../data/datasets';
import { getActiveContrast } from '../data/contrasts';
import type { DatasetGroup, TrackRow } from '../types';

const all = listDatasets();

describe('summarizeGroup', () => {
  function t(trackId: string, logFC: number, direction: 'up' | 'down' | 'flat', significant: boolean): TrackRow {
    return { trackId, label: trackId, type: '', logFC, fdr: significant ? 0.01 : 0.5, pval: 0.01, se: 0.2, direction, significant, lowPower: false };
  }
  it('counts only significant tracks and picks the strongest significant by |logFC|', () => {
    const g: DatasetGroup = {
      dataset: all[0], contrast: getActiveContrast(all[0]),
      tracks: [
        t('a', 2.5, 'up', false), // largest |logFC| but NOT significant → ignored for strongest
        t('b', 1.0, 'up', true),
        t('c', -1.8, 'down', true),
        t('d', 0, 'flat', true), // significant but flat → in nSig, not up/down
      ],
    };
    const s = summarizeGroup(g);
    expect(s.nTracks).toBe(4);
    expect(s.nSig).toBe(3);
    expect(s.up).toBe(1);
    expect(s.down).toBe(1);
    expect(s.strongest?.trackId).toBe('c'); // |−1.8| largest among significant
  });

  // The report summarises each dataset on its own and never combines them: the
  // studies span eleven species, several platforms and a dozen perturbations, so
  // there is no pooled effect, no cross-dataset q and no I² to compute.
  it('is the only cross-dataset aggregate the data layer exposes', async () => {
    const mod = await import('../data/crossDataset');
    expect(Object.keys(mod).filter((k) => /meta|pool/i.test(k))).toEqual([]);
  });
});
