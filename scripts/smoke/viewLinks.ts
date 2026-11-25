// The links the browser smoke opens. Plain data, with no Playwright or app
// imports, so src/__tests__/smokeViewLinks.test.ts can check it against the
// app's own route and tab declarations.

/** The bulk study the result-table smoke also reads. */
export const BULK_STUDY = 'mouse_arc_hfd_gse225038';

/** A bulk study with all four tabs: it has enrichment results and a time course. */
export const FOUR_TAB_STUDY = '#/dataset/mouse_scn_hfd_gse157077/scn';

/** One link per application view. */
export const VIEW_LINKS = {
  hub: '',
  library: '#/library',
  explorer: `#/dataset/${BULK_STUDY}`,
  report: '#/gene/POMC',
  'pathway-report': '#/pathway/HALLMARK_ADIPOGENESIS',
  'compare-set': `#/compare-set/${BULK_STUDY},mouse_arc_hfd_gse284408`,
  tracker: '#/tracker',
  methodology: '#/methodology',
  verification: '#/verification',
  nomenclature: '#/nomenclature',
  expression: '#/expression',
  search: '#/search/POMC',
};

/** The explorer tabs the smoke clicks, in order, starting from the Gene Explorer. */
export const TAB_ORDER = ['pathway', 'circadian', 'qc', 'gene'] as const;
