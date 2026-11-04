// The explorer's track-level tabs: their ids, their labels, and which of them a
// given dataset/track can actually answer.
//
// One list, two readers. The shell renders it as the tab bar; the router
// validates the `<tab>` segment of a `#/dataset/<id>/<track>/<tab>` link against
// it. Those used to be the same rule written twice — the tab bar's two filters
// and switchDataset's `keepsCurrentTab` — which was survivable while nothing
// outside the shell could name a tab. A shared URL can, so the rule now has one
// home: a link to a tab the study never offers degrades to the Gene Explorer
// instead of opening an empty Pathway Explorer behind a tab that isn't there.

import type { Dataset } from '../types';

export const EXPLORER_TABS = [
  ['gene', 'Gene Explorer'],
  ['pathway', 'Pathway Explorer'],
  ['circadian', 'Circadian'],
  ['qc', 'Quality Control'],
  ['datasources', 'Data Sources'],
] as const;

/** The tab shown when nothing else is asked for — and the one every dataset has. */
export const DEFAULT_EXPLORER_TAB = 'gene';

export type ExplorerTab = (typeof EXPLORER_TABS)[number][0];

export function isExplorerTab(value: string): value is ExplorerTab {
  return EXPLORER_TABS.some(([id]) => id === value);
}

/**
 * What a tab's content follows: the selected TRACK, or the whole DATASET.
 *
 * Quality Control and Data Sources describe every track of the study at once,
 * so picking a track while one of them is showing is a request to look at that
 * track — staying put would make the click appear to do nothing. The track-
 * scoped tabs redraw for the new track and can stay. The explorer position
 * (explorerPosition.ts) is the one reader of this rule.
 */
export type ExplorerTabScope = 'track' | 'dataset';

export function explorerTabScope(tab: ExplorerTab): ExplorerTabScope {
  return tab === 'qc' || tab === 'datasources' ? 'dataset' : 'track';
}

/**
 * Whether `tab` is offered for this dataset at this track.
 *
 * Pathway enrichment is a dataset property; a time course is a TRACK property
 * (only some tracks of a circadian dataset carry a time-series sibling bundle),
 * which is why the track id is a parameter and not just the dataset.
 */
/**
 * A tab's display label — the one the tab bar shows and the breadcrumb echoes.
 *
 * The breadcrumb used to re-derive this as a ternary chain over the same ids,
 * with Quality Control as an unlabelled fallthrough, so a renamed tab changed
 * in one place and not the other.
 */
export function explorerTabLabel(tab: string): string {
  return EXPLORER_TABS.find(([id]) => id === tab)?.[1] ?? '';
}

export function explorerTabAvailable(dataset: Dataset, trackId: string, tab: string): boolean {
  if (!isExplorerTab(tab)) return false;
  if (tab === 'pathway') return dataset.supportsPathways;
  if (tab === 'circadian') return !!dataset.timeSeries?.tracks.includes(trackId);
  return true;
}
