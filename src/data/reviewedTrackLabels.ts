import type { DatasetMeta } from '../types';

/** Display corrections from primary-source review; bundle files stay intact. */
const REVIEWED: Record<string, { trackId: string; from: string; to: string }> = {
  // GSE174085 Supplementary Table S1.
  mouse_pvn_crh_ela_gse174085: { trackId: 'crh_pvn', from: 'PVN CRH neurons (animal pseudobulk)', to: 'PVN CRH neurons (litter pseudobulk)' },
  // All six GEO samples and the paper (PMID 39436109, section 2.4.1) describe hypothalami.
  mouse_arc_kcnb1_gse246918: { trackId: 'arcuate', from: 'Arcuate nucleus (ARC)', to: 'Whole hypothalamus' },
  // GEO 'rna fraction: GnRH Depleted Supernatant' for all 11 libraries (PMID 33095238).
  mouse_gnrh_androgen_gse162563: { trackId: 'poa', from: 'GnRH / preoptic area (TRAP)', to: 'Preoptic area (GnRH-depleted TRAP supernatant)' },
};

/** Whether a dataset has a reviewed track label, so its metadata needs the display transform. */
export const hasReviewedTrackLabel = (datasetId: string): boolean => datasetId in REVIEWED;

export function reviewedTrackLabel(datasetId: string, trackId: string, label: string): string {
  const reviewed = REVIEWED[datasetId];
  return reviewed?.trackId === trackId && reviewed.from === label ? reviewed.to : label;
}

const displayed = new WeakMap<DatasetMeta, DatasetMeta>();
export function reviewedMetadata(datasetId: string, meta: DatasetMeta): DatasetMeta {
  const trackId = REVIEWED[datasetId]?.trackId;
  const current = trackId && meta.labels?.[trackId];
  if (!trackId || !current) return meta;
  const label = reviewedTrackLabel(datasetId, trackId, current);
  if (label === current) return meta;
  let result = displayed.get(meta);
  if (!result) {
    result = { ...meta, labels: { ...meta.labels, [trackId]: label } };
    displayed.set(meta, result);
  }
  return result;
}
