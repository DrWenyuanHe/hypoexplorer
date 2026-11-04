// Bundle locators — pure functions of a Dataset VALUE that turn a (dataset,
// trackId) into the URL + window-global name of the bundle holding its data.
// The manifest's file/global templates are the only input; nothing here reads
// the DATASETS registry. Kept DOM-free (like ./bundleBase) because the Node
// scripts type-check datasets.ts.

import type { Dataset } from '../types';

// A same-origin projection of a dataset, so the locators below yield the bare
// "/datasets/..." paths rather than off-origin URLs. The write side
// (scripts/lib/bundleWriter.mts) and the offline checker
// (scripts/check_datasets.mts) both need this to map locator output onto
// public/ — one named home instead of each spelling the spread inline.
export function sameOriginDataset(dataset: Dataset): Dataset {
  return { ...dataset, bundleBaseUrl: '' };
}

// Resolve a track's bundle URL: bundleBaseUrl + bundleFileTemplate with the
// {trackId} placeholder replaced by the raw (case-sensitive) track id.
export function resolveTrackUrl(dataset: Dataset, trackId: string): string {
  const tmpl = dataset.bundleFileTemplate.replace('{trackId}', trackId);
  return (dataset.bundleBaseUrl || '') + tmpl;
}

// Resolve a track's namespaced window global key. The {TRACKID} placeholder is
// replaced by the UPPERCASED track id (matching the migration generator).
export function resolveTrackGlobalKey(dataset: Dataset, trackId: string): string {
  return dataset.globalKeyTemplate.replace('{TRACKID}', String(trackId).toUpperCase());
}

// ── Pathway sibling bundle (track_<id>.pathways.js) + gs_name index ──────────
// FGSEA pathways live in a sibling file so the track bundle (de+cpm) stays light
// for the cross-dataset gene query / single-track loads. Derived from the track
// resolvers + the dataset meta locator (no new manifest fields needed).
export function resolvePathwayUrl(dataset: Dataset, trackId: string): string {
  return resolveTrackUrl(dataset, trackId).replace(/\.js$/, '.pathways.js');
}
export function resolvePathwayGlobalKey(dataset: Dataset, trackId: string): string {
  return `${resolveTrackGlobalKey(dataset, trackId)}_PATH`;
}
export function resolvePathwayIndexUrl(dataset: Dataset): string {
  return (dataset.bundleBaseUrl || '') + dataset.metaFile.replace(/meta\.js$/, 'pathways_index.js');
}
export function resolvePathwayIndexGlobalKey(dataset: Dataset): string {
  return dataset.metaGlobalKey.replace(/_META$/, '_PATHIDX');
}

// ── Time-series sibling bundle (timeseries_<id>.js) ─────────────────────────
// The circadian time course lives beside the DE bundle rather than inside it:
// it is 3-4.5 MB per track and only the Circadian tab reads it, so folding it
// into track_<id>.js would put it on the critical path of every gene lookup.
// Derived from the track resolvers, so no new manifest fields are needed.
export function resolveTimeSeriesUrl(dataset: Dataset, trackId: string): string {
  return resolveTrackUrl(dataset, trackId).replace(/\/track_/, '/timeseries_');
}
export function resolveTimeSeriesGlobalKey(dataset: Dataset, trackId: string): string {
  return dataset.globalKeyTemplate.replace('{TRACKID}', `TS_${String(trackId).toUpperCase()}`);
}
