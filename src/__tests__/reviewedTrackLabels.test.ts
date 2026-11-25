import { describe, expect, it } from 'vitest';
import { reviewedMetadata, reviewedTrackLabel } from '../data/reviewedTrackLabels';
import { buildPopData } from '../data/buildPopData';
import { getDataset } from '../data/datasets';
import { getActiveContrast } from '../data/contrasts';
import { trackSubject } from '../utils/exportProvenance';
import type { DatasetMeta, RawTrack } from '../types';

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

  it.each([
    ['mouse_arc_kcnb1_gse246918', 'arcuate', 'Arcuate nucleus (ARC)', 'Whole hypothalamus'],
    ['mouse_gnrh_androgen_gse162563', 'poa', 'GnRH / preoptic area (TRAP)', 'Preoptic area (GnRH-depleted TRAP supernatant)'],
  ])('corrects the sampled tissue or fraction of %s', (dataset, track, source, corrected) => {
    const meta = { labels: { [track]: source } } as unknown as DatasetMeta;
    expect(reviewedMetadata(dataset, meta).labels[track]).toBe(corrected);
    expect(reviewedMetadata(dataset, meta)).toBe(reviewedMetadata(dataset, meta));
    expect(meta.labels[track]).toBe(source);
    expect(reviewedTrackLabel('mouse_arc_pyy_glp1_gse160802', track, source)).toBe(source);
  });
});

describe('reviewed labels beyond the dataset metadata', () => {
  it.each([
    ['mouse_arc_kcnb1_gse246918', 'arcuate', 'Arcuate nucleus (ARC)', 'Whole hypothalamus'],
    ['mouse_gnrh_androgen_gse162563', 'poa', 'GnRH / preoptic area (TRAP)', 'Preoptic area (GnRH-depleted TRAP supernatant)'],
    ['mouse_arc_pyy_glp1_gse160802', 'arcuate', 'Arcuate nucleus (ARC)', 'Arcuate nucleus (ARC)'],
  ])('gives the loaded track and export records of %s the reviewed label', (id, code, source, shown) => {
    const dataset = getDataset(id)!;
    const raw = { meta: { code, label: source }, de: [], cpm: {} } as unknown as RawTrack;
    const popData = buildPopData(raw, dataset, getActiveContrast(dataset))!;
    expect(popData.meta?.label).toBe(shown);
    expect(trackSubject(popData).trackLabel).toBe(shown);
    expect(raw.meta?.label).toBe(source);
  });
});
