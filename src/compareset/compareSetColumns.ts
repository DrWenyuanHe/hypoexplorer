// Loader state → the columns the shared compare views draw, plus the two
// facts the compare-set page states about them: which columns the pathway
// matrix can honestly include, and which columns are populations of one study.

import { columnColorAt, type CompareColumn } from '../compare/compareColumns';
import { contrastLabel } from '../crossdataset/forestReport';
import { trackLabel } from '../data/datasetMeta';
import type { Dataset } from '../types';
import type { CompareSetColumnState } from './useCompareSetColumns';

/** Whether the column's dataset has more than one track — when it does, the
 *  track is part of the column's name. */
export function isMultiTrack(state: CompareSetColumnState): boolean {
  return (state.meta?.populations?.length ?? 0) > 1;
}

export function columnLabel(state: CompareSetColumnState): string {
  const ds = state.dataset;
  if (!ds) return `${state.item.datasetId} · ${state.item.trackId}`;
  return isMultiTrack(state) ? `${ds.name} · ${trackLabel(state.meta, state.item.trackId)}` : ds.name;
}

/** A label for matrix headers and chart gutters: the accession, then the track. */
export function columnShortLabel(state: CompareSetColumnState): string {
  const ds = state.dataset;
  const base = ds ? (ds.geo || ds.id) : state.item.datasetId;
  return isMultiTrack(state) ? `${base}·${state.item.trackId}` : base;
}

const UNAVAILABLE_MESSAGE: Record<Exclude<CompareSetColumnState['status'], 'ready'>, string> = {
  loading: 'Loading…',
  failed: 'Could not load',
  'unknown-track': 'Track not in this dataset',
};

export function columnsForStates(states: readonly CompareSetColumnState[]): CompareColumn[] {
  return states.map((state, index) => {
    const label = columnLabel(state);
    return {
      key: state.key,
      label,
      shortLabel: columnShortLabel(state),
      chartLabel: label,
      color: columnColorAt(index),
      sublabel: state.dataset ? `${state.dataset.organism} · ${contrastLabel(state.contrast)}` : undefined,
      qc: state.popData?.qc ?? null,
      unavailable: state.status === 'ready'
        ? undefined
        : { status: state.status, message: state.error ?? UNAVAILABLE_MESSAGE[state.status] },
    };
  });
}

/**
 * Why a column is missing from the pathway matrix, or null when it belongs.
 *
 * A column whose sibling has not landed carries an EMPTY pathway list, which
 * the matrix would print as "–" — "not detected" — for every pathway. Held
 * back, and named, until it has settled; the same for a study with no
 * enrichment at all.
 */
export function pathwayAbsenceReason(state: CompareSetColumnState): string | null {
  if (state.status === 'loading') return 'loading';
  if (state.status === 'failed') return 'failed to load';
  if (state.status === 'unknown-track') return 'track not in this dataset';
  if (!state.dataset?.supportsPathways) return 'no enrichment results';
  if (!state.pathwaysSettled) return 'loading pathways…';
  if (!state.popData || state.popData.allPathways.length === 0) return 'no enrichment results';
  return null;
}

export function pathwayEligible(state: CompareSetColumnState): boolean {
  return pathwayAbsenceReason(state) === null;
}

/** Datasets contributing more than one column — populations of ONE study. */
export function sameStudyGroups(states: readonly CompareSetColumnState[]): Array<{ dataset: Dataset; count: number }> {
  const counts = new Map<string, { dataset: Dataset; count: number }>();
  for (const state of states) {
    if (!state.dataset) continue;
    const entry = counts.get(state.dataset.id);
    if (entry) entry.count += 1;
    else counts.set(state.dataset.id, { dataset: state.dataset, count: 1 });
  }
  return [...counts.values()].filter((entry) => entry.count > 1);
}
