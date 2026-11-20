// Every view App renders outside the landing hub, each in its own chunk.
//
// The hub stays in the entry bundle: it is the default route and must paint
// without waiting on a second request. Everything here downloads when it is
// first rendered, or earlier when App warms the likely next view (see
// preloadWhenIdle in ./common/lazyView). The two evidence ledgers and recharts
// are reachable only through these views, so they no longer load on the hub.

import { lazyView } from './common/lazyView';

// ── Full-page views ──
export const SearchPage = lazyView(() => import('./search/SearchPage').then((m) => m.SearchPage));
export const GeneReport = lazyView(() => import('./crossdataset/GeneReport').then((m) => m.GeneReport));
export const PathwayReport = lazyView(() => import('./crossdataset/PathwayReport').then((m) => m.PathwayReport));
export const DatasetLibrary = lazyView(() => import('./library/DatasetLibrary').then((m) => m.DatasetLibrary));
export const DatasetTrackerView = lazyView(() => import('./dataset-tracker/DatasetTrackerView').then((m) => m.DatasetTrackerView));
export const MethodologyView = lazyView(() => import('./methodology/MethodologyView').then((m) => m.MethodologyView));
export const VerificationView = lazyView(() => import('./verification/VerificationView').then((m) => m.VerificationView));
export const NomenclatureView = lazyView(() => import('./nomenclature/NomenclatureView').then((m) => m.NomenclatureView));
export const CompareSetView = lazyView(() => import('./compareset/CompareSetView').then((m) => m.CompareSetView));

// ── Explorer tabs and panels ──
export const GeneExplorerTab = lazyView(() => import('./gene-explorer/GeneExplorerTab').then((m) => m.GeneExplorerTab));
export const PathwayExplorerTab = lazyView(() => import('./pathway-explorer/PathwayExplorerTab').then((m) => m.PathwayExplorerTab));
export const CompareTab = lazyView(() => import('./compare/CompareTab').then((m) => m.CompareTab));
export const CircadianTab = lazyView(() => import('./circadian/CircadianTab').then((m) => m.CircadianTab));
export const QCTab = lazyView(() => import('./qc/QCTab').then((m) => m.QCTab));
export const ChangelogTab = lazyView(() => import('./changelog/ChangelogTab').then((m) => m.ChangelogTab));
// A modal and a disclosure body: nothing to hold their place while they load.
export const DatasetInfoPanel = lazyView(() => import('./common/DatasetInfoPanel').then((m) => m.DatasetInfoPanel), null);
export const DatasetVerificationContext = lazyView(
  () => import('./common/DatasetVerificationContext').then((m) => m.DatasetVerificationContext), null,
);

const ALL_VIEWS = [
  SearchPage, GeneReport, PathwayReport, DatasetLibrary, DatasetTrackerView, MethodologyView, VerificationView,
  NomenclatureView, CompareSetView, GeneExplorerTab, PathwayExplorerTab, CompareTab, CircadianTab, QCTab,
  ChangelogTab, DatasetInfoPanel, DatasetVerificationContext,
];

/** Load every view chunk, so a test can render App and query it synchronously. */
export function preloadAppViews(): Promise<unknown> {
  return Promise.all(ALL_VIEWS.map((view) => view.preload()));
}
