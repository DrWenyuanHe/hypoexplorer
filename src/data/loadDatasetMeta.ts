// Lazy per-dataset loaders for the dataset-level metadata (POP_META shape) and
// the dataset-level QC blob (QC_GLOBAL shape). Both are bundles that set a
// dataset-namespaced window global; the loading mechanics (eager-global seed,
// cache, in-flight dedup, ?v= cache-bust) live in the bundle-source seam.
//
// Contract:
//   loadDatasetMeta(dataset) → Promise<metaObj>   // POP_META shape
//   loadDatasetQC(dataset)   → Promise<qcObj>      // QC_GLOBAL shape
//
// Both are REQUIRED bundles: a dataset with no meta has no track list, and the
// QC tab has nothing to render without its blob. So the seam rejects rather than
// resolving null, and does not cache the failure — a transient network error
// stays retryable, which is the behaviour these loaders have always had.
//
// This file used to carry its own injector whose cache and in-flight maps were
// passed in as PARAMETERS, making caching a caller's responsibility. It is now
// the loader's least interesting property: which URL, which global key, and how
// to phrase a failure.

import { loadRequiredBundle, peekBundle, _resetBundleCache } from './bundleSource';
import type { Dataset, DatasetMeta, QcGlobal } from '../types';
import { reviewedMetadata } from './reviewedTrackLabels';

const displayedLoads = new WeakMap<Promise<DatasetMeta>, Promise<DatasetMeta>>();

// `failLabel` keeps the dataset-specific wording the error banner surfaces —
// a bare path would not tell the user which dataset failed.
export function loadDatasetMeta(dataset: Dataset): Promise<DatasetMeta> {
  const file = dataset.metaFile;
  const loaded = loadRequiredBundle<DatasetMeta>(
    (dataset.bundleBaseUrl || '') + file,
    dataset.metaGlobalKey,
    `dataset metadata for ${dataset.id} (${file})`,
  );
  if (dataset.id !== 'mouse_pvn_crh_ela_gse174085') return loaded;
  let displayed = displayedLoads.get(loaded);
  if (!displayed) {
    displayed = loaded.then((meta) => reviewedMetadata(dataset.id, meta));
    displayedLoads.set(loaded, displayed);
  }
  return displayed;
}

/**
 * The meta IF this session has already loaded it; undefined otherwise. Never
 * requests anything — the caller (manifestCovers's freshness check) is
 * explicitly opportunistic, because fetching meta.js per dataset is exactly the
 * fan-out the query index exists to avoid.
 */
export function peekDatasetMeta(dataset: Dataset): DatasetMeta | undefined {
  const meta = peekBundle<DatasetMeta>((dataset.bundleBaseUrl || '') + dataset.metaFile);
  return meta ? reviewedMetadata(dataset.id, meta) : undefined;
}

export function loadDatasetQC(dataset: Dataset): Promise<QcGlobal> {
  const file = dataset.qcFile;
  return loadRequiredBundle<QcGlobal>(
    (dataset.bundleBaseUrl || '') + file,
    dataset.qcGlobalKey,
    `dataset QC for ${dataset.id} (${file})`,
  );
}

// Test-only helper. Kept under its own name because several test files call it
// directly, but there is a single bundle cache behind it now.
export function _resetDatasetMetaCache(): void {
  _resetBundleCache();
}
