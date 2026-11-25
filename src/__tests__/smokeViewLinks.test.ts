// The browser smoke (scripts/smoke) opens one link per view and clicks every
// explorer tab. These checks keep its list complete: a new view or tab fails
// here until the smoke opens it.
import { describe, expect, it } from 'vitest';
import { FOUR_TAB_STUDY, TAB_ORDER, VIEW_LINKS } from '../../scripts/smoke/viewLinks';
import { getDataset } from '../data/datasets';
import { EXPLORER_TABS, explorerTabAvailable } from '../explorer/explorerTabs';
import { type AppRoute, parseDatasetHash, parseRoute } from '../utils/appLinks';

// Missing a view, or naming one the app does not have, is a type error.
const links: Record<AppRoute['view'], string> = VIEW_LINKS satisfies Record<
  AppRoute['view'],
  string
>;

describe('browser smoke links', () => {
  it.each(Object.entries(links))('opens the %s view', (view, hash) => {
    expect(parseRoute(hash)?.view).toBe(view);
  });

  it('names only registered studies', () => {
    const route = parseRoute(VIEW_LINKS['compare-set']);
    const items = route?.view === 'compare-set' ? route.items : [];
    expect(items).toHaveLength(2);
    for (const { datasetId } of items) expect(getDataset(datasetId)).toBeTruthy();
  });

  it('clicks every explorer tab on a study that offers all of them', () => {
    expect([...TAB_ORDER].sort()).toEqual(EXPLORER_TABS.map(([id]) => id).sort());
    const position = parseDatasetHash(FOUR_TAB_STUDY);
    const dataset = getDataset(position?.datasetId ?? '');
    if (!dataset || !position?.trackId) throw new Error('The four-tab study is not registered');
    for (const tab of TAB_ORDER)
      expect(explorerTabAvailable(dataset, position.trackId, tab), tab).toBe(true);
  });
});
