// Loading the columns of a compare set: one track bundle (with its pathway
// sibling) per item, each landing on its own, none blocking the others.
//
// The load lifecycle itself — loading / ready / failed / unknown-track, the
// re-read after the pathway sibling hydrates, the settled signal, retry — is
// the track-column module's (../data/trackColumns), shared with the
// single-cell Compare tab and the report previews. This file is the compare
// set's ADAPTER onto it: it resolves an item's dataset id against the registry
// (an id this build no longer ships is a failed column, not a crash), states
// the compare set's policy, and adds what only the compare set shows — the
// dataset's default contrast, and the bundle URL and expected bytes for the
// progress readout.
//
// Policy: pathways included (the pathway matrix), and the track list VERIFIED
// against meta.js — a compare set comes from a URL or a saved set, which can
// name a track a later build dropped, and the chip names the track and its
// arms from the meta before the bundle lands.
//
// The rules the view relies on are the module's: a column that could not be
// READ is reported as such, never rendered as "not detected", and retained
// columns never reload.

import { useMemo } from 'react';
import { getDataset } from '../data/datasets';
import { getActiveContrast } from '../data/contrasts';
import { useTrackColumns, type TrackColumn, type TrackColumnPolicy, type TrackColumnRequest, type TrackColumnStatus } from '../data/trackColumns';
import { resolvePathwayUrl, resolveTrackUrl } from '../data/bundleLocators';
import { expectedBundleBytes } from '../data/bundleSource';
import { compareSetKey, type CompareSetItem } from './compareSetStore';
import type { Dataset, DatasetMeta, PopData, RawTrack, ResolvedContrast } from '../types';

export type CompareSetColumnStatus = TrackColumnStatus;

export interface CompareSetColumnState {
  item: CompareSetItem;
  key: string;
  /** Null when the id is not in this build's registry. */
  dataset: Dataset | null;
  /** Known before the bundle lands, so the chip can name the track and arms early. */
  meta: DatasetMeta | null;
  contrast: ResolvedContrast | null;
  status: CompareSetColumnStatus;
  error: string | null;
  raw: RawTrack | null;
  popData: PopData | null;
  /** The pathway sibling has settled, either way; the pathway matrix waits for it. */
  pathwaysSettled: boolean;
  /** The bundle URL, for a progress readout while loading. */
  trackUrl: string | null;
  /** Track bundle + sibling, from the build-time size map; null when unknown. */
  expectedBytes: number | null;
}

const COMPARE_SET_POLICY: TrackColumnPolicy = { pathways: 'include', trackList: 'verify' };

/** Bytes the column will download, when the build-time size map knows them. */
function expectedBytesFor(ds: Dataset, trackId: string): number | null {
  const track = expectedBundleBytes(resolveTrackUrl(ds, trackId));
  if (track === null) return null;
  const sibling = ds.supportsPathways ? expectedBundleBytes(resolvePathwayUrl(ds, trackId)) : 0;
  return track + (sibling ?? 0);
}

/** An item whose dataset id this build's registry does not know. */
function unavailableState(item: CompareSetItem): CompareSetColumnState {
  return {
    item, key: compareSetKey(item), dataset: null, meta: null, contrast: null,
    status: 'failed', error: 'Dataset unavailable in this version',
    raw: null, popData: null, pathwaysSettled: true, trackUrl: null, expectedBytes: null,
  };
}

function columnState(item: CompareSetItem, column: TrackColumn): CompareSetColumnState {
  const ds = column.dataset;
  return {
    item,
    key: compareSetKey(item),
    dataset: ds,
    meta: column.meta,
    contrast: column.contrast,
    status: column.status,
    error: column.error,
    raw: column.raw,
    popData: column.popData,
    pathwaysSettled: column.pathwaysSettled,
    trackUrl: resolveTrackUrl(ds, item.trackId),
    expectedBytes: expectedBytesFor(ds, item.trackId),
  };
}

export interface CompareSetColumns {
  /** One per item, in the items' order. */
  states: CompareSetColumnState[];
  loadingCount: number;
  /** No column is still loading. Pathway siblings may still be settling. */
  settled: boolean;
}

export function useCompareSetColumns(items: readonly CompareSetItem[]): CompareSetColumns {
  // Registry lookups once per item list; unknown ids are left out of the
  // requests and reported below as failed columns.
  const requests = useMemo(() => items.flatMap((item): TrackColumnRequest[] => {
    const dataset = getDataset(item.datasetId);
    return dataset ? [{ dataset, trackId: item.trackId, contrast: getActiveContrast(dataset) }] : [];
  }), [items]);
  const columns = useTrackColumns(requests, COMPARE_SET_POLICY);

  return useMemo(() => {
    // `columns` follows `requests`' order, which is `items`' order minus the
    // unknown ids — so one cursor pairs them back up.
    let next = 0;
    const states = items.map((item) => (getDataset(item.datasetId) ? columnState(item, columns[next++]) : unavailableState(item)));
    const loadingCount = states.filter((s) => s.status === 'loading').length;
    return { states, loadingCount, settled: loadingCount === 0 };
  }, [items, columns]);
}
