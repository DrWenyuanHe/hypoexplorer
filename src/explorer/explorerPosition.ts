// The explorer position: which dataset, which track (or Compare), which
// contrast and which tab the explorer shell is on — and every way to move.
//
// Contract:
//   nextPosition(position, intent) -> { position, reset, load }
//   useExplorerPosition()          -> { position, apply }
//
// Before this module the four values were separate useState hooks in App, set
// from ten places across App, the router and the QC tab, under three different
// rules for whether the current tab survived a move (a hand-written whitelist
// on a track switch, explorerTabAvailable on a dataset switch, and a forced
// Gene Explorer on every router "open"). A tab named while Compare was showing
// set a tab nobody could see, and Compare itself was the track id 'compare', a
// sentinel a dozen sites tested.
//
// Now every caller sends a NAVIGATION INTENT and `nextPosition` decides, as a
// pure function of the registry, what the next position is and what the move
// costs: which session reset scope applies (explorerSession's RESET_MATRIX) and
// which track bundle to load. The shell carries those effects out; it never
// sets a position field directly.
//
// The rules, stated once:
//   * Selecting a track keeps a TRACK-scoped tab the new track offers; a
//     DATASET-scoped tab (QC, Data Sources) goes to the Gene Explorer, because
//     the click is a request to see that track (explorerTabs' explorerTabScope).
//   * Opening a dataset from outside the explorer (tracker, report row, library,
//     deep link) lands on the Gene Explorer unless a tab is named.
//   * Compare carries no tab. It remembers the track and tab it was entered
//     from, and leaving it — by the sidebar button, a track click or a named
//     tab — returns there.
//   * Track ids are trusted. Checking a URL's track against the dataset's
//     populations needs the meta to load, so that untrusted-input check stays
//     in the router's route landing.

import { useCallback, useRef, useState } from 'react';
import { getDataset } from '../data/datasets';
import { getActiveContrast, listContrasts } from '../data/contrasts';
import type { NavigationScope } from './explorerSession';
import {
  DEFAULT_EXPLORER_TAB, explorerTabAvailable, explorerTabScope, isExplorerTab, type ExplorerTab,
} from './explorerTabs';
import type { ExplorerAnalysisState } from '../utils/analysisState';
import type { Dataset } from '../types';

/**
 * Compare's spelling at the edges that still speak in track ids: the sidebar,
 * the explorer store, the URL. Inside the position it is a `focus` kind.
 */
export const COMPARE_TRACK = 'compare';

/** Where the shell returns to when Compare is left. */
export interface TrackAndTab {
  trackId: string;
  tab: ExplorerTab;
}

export type ExplorerFocus =
  | { kind: 'track'; trackId: string; tab: ExplorerTab }
  | { kind: 'compare'; returnTo: TrackAndTab };

export interface ExplorerPosition {
  datasetId: string;
  /** The selected contrast; null only for a dataset authored with none. */
  contrastId: string | null;
  focus: ExplorerFocus;
}

/** What a caller asks for. The position decides what it gets. */
export type NavigationIntent =
  /**
   * Enter a dataset from outside the explorer. A missing track keeps the
   * current one when the dataset is already open, else the dataset's default;
   * a missing tab is the Gene Explorer. `compare` opens Compare instead of a
   * track; `analysis` carries a saved analysis whose contrast the position
   * adopts (the shell restores the rest).
   */
  | { type: 'open'; datasetId: string; trackId?: string; tab?: string; compare?: boolean; analysis?: ExplorerAnalysisState }
  /** Select a track in the active dataset (the sidebar, a QC table row). */
  | { type: 'track'; trackId: string }
  | { type: 'compare' }
  | { type: 'leaveCompare' }
  /** Show a tab. Named while in Compare, it leaves Compare. */
  | { type: 'tab'; tab: string }
  | { type: 'contrast'; contrastId: string };

export interface PositionTransition {
  position: ExplorerPosition;
  /** The session reset this move requires, or null when nothing is cleared. */
  reset: NavigationScope | null;
  /** The track bundle this move needs, bound to the dataset it belongs to. */
  load: { dataset: Dataset; trackId: string } | null;
}

/** The position a fresh shell starts at: the dataset's default track and contrast. */
export function initialPosition(dataset: Dataset): ExplorerPosition {
  return {
    datasetId: dataset.id,
    contrastId: getActiveContrast(dataset)?.id ?? null,
    focus: { kind: 'track', trackId: dataset.defaultTrack, tab: DEFAULT_EXPLORER_TAB },
  };
}

/** The selected track id, with Compare spelled `COMPARE_TRACK`. */
export function activeTrackOf(position: ExplorerPosition): string {
  return position.focus.kind === 'compare' ? COMPARE_TRACK : position.focus.trackId;
}

/** The showing tab; null in Compare, which has none. */
export function activeTabOf(position: ExplorerPosition): ExplorerTab | null {
  return position.focus.kind === 'track' ? position.focus.tab : null;
}

/** The track and tab the shell is on, or would return to from Compare. */
function homeOf(focus: ExplorerFocus): TrackAndTab {
  return focus.kind === 'compare' ? focus.returnTo : { trackId: focus.trackId, tab: focus.tab };
}

/** `tab` where `trackId` offers it, otherwise the Gene Explorer. */
function offered(dataset: Dataset, trackId: string, tab: string | undefined): ExplorerTab {
  return tab && isExplorerTab(tab) && explorerTabAvailable(dataset, trackId, tab) ? tab : DEFAULT_EXPLORER_TAB;
}

/** A move that clears nothing and loads nothing (including no move at all). */
const effectFree = (position: ExplorerPosition): PositionTransition => ({ position, reset: null, load: null });

/** The widest of several resets: dataset clears what track clears, which clears what contrast clears. */
function widest(...scopes: Array<NavigationScope | null>): NavigationScope | null {
  for (const scope of ['dataset', 'track', 'contrast'] as const) if (scopes.includes(scope)) return scope;
  return null;
}

/** Resolves a dataset id; the registry in the app, a fixture in tests. */
export type DatasetLookup = (id: string) => Dataset | null | undefined;

export function nextPosition(position: ExplorerPosition, intent: NavigationIntent, datasets: DatasetLookup = getDataset): PositionTransition {
  const dataset = datasets(position.datasetId);
  if (intent.type === 'open') return open(position, intent, datasets);
  if (!dataset) return effectFree(position);
  const { focus } = position;

  switch (intent.type) {
    case 'track': {
      if (intent.trackId === COMPARE_TRACK) return nextPosition(position, { type: 'compare' }, datasets);
      const from = homeOf(focus);
      const tab = explorerTabScope(from.tab) === 'track' ? offered(dataset, intent.trackId, from.tab) : DEFAULT_EXPLORER_TAB;
      const sameTrack = focus.kind === 'track' && focus.trackId === intent.trackId;
      if (sameTrack && tab === focus.tab) return effectFree(position);
      return {
        position: { ...position, focus: { kind: 'track', trackId: intent.trackId, tab } },
        // Only the tab changed: the per-track session state still describes this track.
        reset: sameTrack ? null : 'track',
        load: sameTrack ? null : { dataset, trackId: intent.trackId },
      };
    }
    case 'compare':
      if (focus.kind === 'compare') return effectFree(position);
      return { position: { ...position, focus: { kind: 'compare', returnTo: homeOf(focus) } }, reset: 'track', load: null };
    case 'leaveCompare': {
      if (focus.kind !== 'compare') return effectFree(position);
      const { trackId, tab } = focus.returnTo;
      return {
        position: { ...position, focus: { kind: 'track', trackId, tab: offered(dataset, trackId, tab) } },
        reset: 'track',
        load: { dataset, trackId },
      };
    }
    case 'tab': {
      if (!isExplorerTab(intent.tab)) return effectFree(position);
      if (focus.kind === 'compare') {
        const { trackId } = focus.returnTo;
        return {
          position: { ...position, focus: { kind: 'track', trackId, tab: offered(dataset, trackId, intent.tab) } },
          reset: 'track',
          load: { dataset, trackId },
        };
      }
      if (intent.tab === focus.tab || !explorerTabAvailable(dataset, focus.trackId, intent.tab)) return effectFree(position);
      return effectFree({ ...position, focus: { ...focus, tab: intent.tab } });
    }
    case 'contrast':
      if (intent.contrastId === position.contrastId) return effectFree(position);
      if (!listContrasts(dataset).some((contrast) => contrast.id === intent.contrastId)) return effectFree(position);
      return { position: { ...position, contrastId: intent.contrastId }, reset: 'contrast', load: null };
  }
}

function open(position: ExplorerPosition, intent: Extract<NavigationIntent, { type: 'open' }>, datasets: DatasetLookup): PositionTransition {
  const dataset = datasets(intent.datasetId);
  if (!dataset) return effectFree(position);
  const sameDataset = dataset.id === position.datasetId;
  const home: TrackAndTab = sameDataset ? homeOf(position.focus) : { trackId: dataset.defaultTrack, tab: DEFAULT_EXPLORER_TAB };

  // A saved analysis names its contrast; otherwise an open keeps the current
  // contrast within the dataset and takes the default in a new one.
  const savedContrast = intent.analysis?.contrastId;
  const contrastId = savedContrast && listContrasts(dataset).some((contrast) => contrast.id === savedContrast)
    ? savedContrast
    : sameDataset ? position.contrastId : getActiveContrast(dataset)?.id ?? null;

  const wantsCompare = intent.compare || intent.trackId === COMPARE_TRACK;
  let focus: ExplorerFocus;
  if (wantsCompare) {
    focus = position.focus.kind === 'compare' && sameDataset ? position.focus : { kind: 'compare', returnTo: home };
  } else {
    const trackId = intent.trackId ?? home.trackId;
    focus = { kind: 'track', trackId, tab: offered(dataset, trackId, intent.tab) };
  }

  const next: ExplorerPosition = { datasetId: dataset.id, contrastId, focus };
  const before = position.focus;
  const trackChanged = before.kind !== focus.kind
    || (before.kind === 'track' && focus.kind === 'track' && before.trackId !== focus.trackId);
  const reset = widest(
    sameDataset ? null : 'dataset',
    trackChanged ? 'track' : null,
    contrastId !== position.contrastId ? 'contrast' : null,
  );
  const load = focus.kind === 'track' && (!sameDataset || trackChanged) ? { dataset, trackId: focus.trackId } : null;
  return { position: next, reset, load };
}

/**
 * The position as React state, plus `apply`, which commits an intent's next
 * position and returns the transition so the shell can carry out its reset and
 * load. Read through a ref, so two intents applied in one tick compose instead
 * of the second overwriting the first from a stale render.
 */
export function useExplorerPosition(initial: () => ExplorerPosition) {
  const [position, setPosition] = useState(initial);
  const current = useRef(position);
  const apply = useCallback((intent: NavigationIntent): PositionTransition => {
    const transition = nextPosition(current.current, intent);
    if (transition.position !== current.current) {
      current.current = transition.position;
      setPosition(transition.position);
    }
    return transition;
  }, []);
  return { position, apply };
}
