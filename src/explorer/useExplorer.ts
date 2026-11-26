// The explorer: where it is, what the user configured inside it, what it has
// loaded, and how one navigation moves all three together.
//
// App calls this once, above its view switch, because the router delivers
// intents while the explorer is off screen (a report row opening a dataset, a
// shared link landing) and the position and session must survive a trip to a
// report and back. What it gives out is deliberately small:
//
//   - `nav` and `at`, the router's two halves of the explorer seam: the router
//     states an intent and reads back where the explorer is, never a field;
//   - `showActiveTrack`, which App's explorer-on-screen effect calls;
//   - `screen`, everything ExplorerShell draws from, which App passes through
//     without reading.
//
// What it hides is the order a move is carried out in (`navigate`): the
// position commits the intent; the session clears what that move's scope names
// BEFORE a saved analysis is restored over it; a Compare link lands on its
// view; and the track a move needs is loaded naming its dataset, because the
// store's `ensureTrack` is still bound to the outgoing dataset until this render
// commits.

import { useCallback, useMemo } from 'react';
import { getActiveContrast, listContrasts } from '../data/contrasts';
import { getDataset } from '../data/datasets';
import { useExplorerStore, type ExplorerStore } from '../data/explorerStore';
import { setChartScale, useChartScale } from '../common/chartScaleStore';
import { useCompareView, type CompareViewHold } from '../compare/useCompareView';
import type { CompareViewState, ExplorerAnalysisState } from '../utils/analysisState';
import type { Dataset, PathwayRecordWithDb, ResolvedContrast } from '../types';
import { DEFAULT_EXPLORER_TAB } from './explorerTabs';
import {
  COMPARE_TRACK, activeTabOf, activeTrackOf, initialPosition, useExplorerPosition, type NavigationIntent,
} from './explorerPosition';
import { useExplorerSession, type ExplorerSession } from './explorerSession';

/**
 * What the router needs the explorer to do when a route lands in it.
 *
 * The router never touches the explorer's state directly — it states an intent
 * and the explorer applies its own rules (which per-track state resets, which
 * tab is still valid for the target dataset, and so on).
 */
export interface ExplorerNavigation {
  /**
   * Apply one whole navigation intent atomically. The explorer position
   * (explorerPosition.ts) decides the landing tab, Compare entry and exit, and
   * what the move resets; a saved analysis rides on an open.
   */
  navigate: (intent: NavigationIntent) => void;
}

/**
 * Where the explorer currently IS — the read side of the same seam, as the URL
 * spells it (Compare is the track id COMPARE_TRACK).
 *
 * The router owns which VIEW is on screen, but the explorer's position within
 * itself is the explorer's state, and the URL has to name it. Rather than
 * lifting dataset/track/tab into the router, the explorer reports its position
 * and the router serializes it. Optional for the router: tests that only
 * exercise the navigation verbs pass no position, and the router then writes no
 * explorer URL.
 */
export interface ExplorerAt {
  datasetId: string;
  trackId: string;
  tab: string;
  analysis?: ExplorerAnalysisState;
  /** In Compare: what it shows, defaults already left out (see CompareViewState). */
  compare?: CompareViewState;
}

/** Everything the explorer screen draws from. App passes it through unread. */
export interface ExplorerScreen {
  dataset: Dataset;
  /** The active contrast; null only for a dataset authored with none. */
  contrast: ResolvedContrast | null;
  /** Every declared contrast, for the selector. */
  contrasts: ResolvedContrast[];
  /** The active track as the sidebar and URL name it (COMPARE_TRACK in Compare). */
  trackId: string;
  /** The track-level tab showing; Compare has none and reads the default. */
  tab: string;
  isCompare: boolean;
  /** What the store has loaded for the active dataset, without `ensureTrack`: loading is the explorer's call. */
  store: Omit<ExplorerStore, 'ensureTrack'>;
  /** What the user selected and configured inside the dataset. */
  session: Pick<ExplorerSession<PathwayRecordWithDb>, 'genes' | 'volcano' | 'pathway' | 'cellSearch' | 'setCellSearch'>;
  /** Compare's view: the held link, the epoch that remounts CompareTab, and where it reports changes. */
  compare: Pick<CompareViewHold, 'epoch' | 'link' | 'report'>;
}

export interface Explorer {
  nav: ExplorerNavigation;
  at: ExplorerAt;
  /** Load the active track if it is not loaded yet (nothing in Compare, which loads its own columns). */
  showActiveTrack: () => void;
  screen: ExplorerScreen;
}

export function useExplorer(initialDataset: Dataset): Explorer {
  const { position, apply: applyIntent } = useExplorerPosition(() => initialPosition(initialDataset));
  const datasetId = position.datasetId;
  const dataset = useMemo(() => getDataset(datasetId) || initialDataset, [datasetId, initialDataset]);
  const contrast = useMemo(() => getActiveContrast(dataset, position.contrastId), [dataset, position.contrastId]);
  const contrasts = useMemo(() => listContrasts(dataset), [dataset]);
  // The edges that still speak in track ids (the store, the sidebar, the URL)
  // see Compare as COMPARE_TRACK.
  const trackId = activeTrackOf(position);
  const isCompare = position.focus.kind === 'compare';
  const tab = activeTabOf(position) ?? DEFAULT_EXPLORER_TAB;

  const session = useExplorerSession<PathwayRecordWithDb>();
  const { resetFor, restoreAnalysis, snapshot } = session;
  const chartScale = useChartScale();
  const compareView = useCompareView(datasetId);
  const landCompareView = compareView.land;

  // QC is lazy: only the QC tab wants it.
  const { ensureTrack, ...store } = useExplorerStore({ dataset, activeTrackId: trackId, wantQC: activeTabOf(position) === 'qc' });

  const navigate = useCallback((intent: NavigationIntent) => {
    const { reset, load } = applyIntent(intent);
    if (reset) resetFor(reset);
    if (intent.type === 'open' && intent.analysis) {
      setChartScale(intent.analysis.chartScale ?? 'native');
      restoreAnalysis(intent.analysis);
    }
    // A Compare link (or Back/Forward onto one) restarts Compare on its view.
    if (intent.type === 'open' && intent.compareView) landCompareView(intent.datasetId, intent.compareView);
    if (load) ensureTrack(load.trackId, load.dataset);
  }, [applyIntent, resetFor, restoreAnalysis, ensureTrack, landCompareView]);
  const nav = useMemo(() => ({ navigate }), [navigate]);

  // What counts as non-default, and how it is written down, is the session's
  // call (`snapshot`, the inverse of `restoreAnalysis`); the explorer supplies
  // the two pieces the session does not hold.
  const analysis = useMemo(() => snapshot({
    contrastId: contrast?.id ?? null,
    defaultContrastId: getActiveContrast(dataset)?.id ?? null,
    chartScale,
  }), [snapshot, contrast, dataset, chartScale]);
  const compareLink = compareView.link;
  const at = useMemo(
    () => ({
      datasetId, trackId, tab, analysis,
      ...(isCompare && compareLink && Object.keys(compareLink).length ? { compare: compareLink } : {}),
    }),
    [datasetId, trackId, tab, analysis, isCompare, compareLink],
  );

  // Safe on every call: ensureTrack short-circuits on its cache and on the
  // in-flight map, so a redundant call costs one Map lookup.
  const showActiveTrack = useCallback(() => {
    if (trackId === COMPARE_TRACK) return;
    ensureTrack(trackId);
  }, [trackId, ensureTrack]);

  const { genes, volcano, pathway, cellSearch, setCellSearch } = session;
  return {
    nav,
    at,
    showActiveTrack,
    screen: {
      dataset, contrast, contrasts, trackId, tab, isCompare, store,
      session: { genes, volcano, pathway, cellSearch, setCellSearch },
      compare: { epoch: compareView.epoch, link: compareLink, report: compareView.report },
    },
  };
}
