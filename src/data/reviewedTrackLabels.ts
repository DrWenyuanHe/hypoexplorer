import type { DatasetMeta } from '../types';

/** Display correction from GSE174085 Supplementary Table S1; source files stay intact. */
export function reviewedTrackLabel(datasetId: string, trackId: string, label: string): string {
  return datasetId === 'mouse_pvn_crh_ela_gse174085' && trackId === 'crh_pvn'
    && label === 'PVN CRH neurons (animal pseudobulk)'
    ? 'PVN CRH neurons (litter pseudobulk)' : label;
}

const displayed = new WeakMap<DatasetMeta, DatasetMeta>();
export function reviewedMetadata(datasetId: string, meta: DatasetMeta): DatasetMeta {
  if (datasetId !== 'mouse_pvn_crh_ela_gse174085' || !meta.labels?.crh_pvn) return meta;
  const label = reviewedTrackLabel(datasetId, 'crh_pvn', meta.labels.crh_pvn);
  if (label === meta.labels.crh_pvn) return meta;
  let result = displayed.get(meta);
  if (!result) {
    result = { ...meta, labels: { ...meta.labels, crh_pvn: label } };
    displayed.set(meta, result);
  }
  return result;
}
