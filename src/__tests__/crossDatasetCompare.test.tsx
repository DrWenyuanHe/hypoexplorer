import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CrossDatasetCompare } from '../crossdataset/CrossDatasetCompare';
import { _resetTrackCache } from '../data/loadTrack';
import { getDataset } from '../data/datasets';
import { resolveTrackGlobalKey } from '../data/bundleLocators';
import { BULK_TRACK_FIXTURE } from './fixtures';
import * as trackData from '../data/trackData';

/** Seed a SECOND dataset's track global, from a different category than the
 *  macaque atlas the setup file seeds. Two loaded categories is what makes the
 *  category chips render at all, and therefore what makes scope testable.
 *  Returns the cleanup. */
function seedBulkDataset(): () => void {
  const ds = getDataset('mouse_hypo_hfd_gse220533');
  if (!ds) throw new Error('registry no longer has mouse_hypo_hfd_gse220533');
  const key = resolveTrackGlobalKey(ds, ds.defaultTrack);
  (window as any)[key] = BULK_TRACK_FIXTURE;
  return () => {
    delete (window as any)[key];
  };
}

/** Make every injected bundle <script> fail, the way an unreachable bundle
 *  origin does. Without this jsdom simply never settles the injection, so the
 *  view sits on its spinner and no load-failure state is reachable. */
function failAllBundleLoads() {
  const orig = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: any) => {
    const el = orig(tag);
    if (tag === 'script') setTimeout(() => el.onerror?.(new Event('error')), 0);
    return el;
  });
}

// The fallback intentionally visits every registered dataset. Keep this above
// the old small-corpus timeout so the test remains stable as the registry grows
// and when Vitest runs the full suite under CPU contention.
const FALLBACK_SETTLE_TIMEOUT_MS = 30_000;

// The happy data path (one chart per dataset from the expression index) is verified
// live in the browser preview — in jsdom only the setup file's macaque global
// resolves, so a full grid is not reachable here. What jsdom IS good for is the
// path that view got wrong: a load where most or all bundles fail. Those tests
// stub the <script> injections to error, which is exactly what an unreachable
// bundle origin does, and pin what the view is allowed to CLAIM about data it
// never read. See crossDatasetCompareIndex.test.ts for the loader itself.
afterEach(() => {
  vi.restoreAllMocks();
  _resetTrackCache();
});

describe('CrossDatasetCompare', () => {
  it('limits full-track fallback requests to the individually selected cohort', async () => {
    const cleanup = seedBulkDataset();
    try {
      failAllBundleLoads();
      const load = vi.spyOn(trackData, 'loadTrackData');
      const id = 'mouse_hypo_hfd_gse220533';
      render(<CrossDatasetCompare gene="POMC" datasetScope={[id]} onHome={() => {}} />);
      await waitFor(() => expect(load).toHaveBeenCalled());
      expect(load.mock.calls.map(([dataset]) => dataset.id)).toEqual([id]);
      expect(screen.getByRole('status')).toHaveTextContent('1 datasets selected');
    } finally { cleanup(); }
  });

  it('renders the view chrome for the requested gene', () => {
    render(<CrossDatasetCompare gene="POMC" scope={null} onHome={() => {}} />);
    expect(screen.getByText('Compare across datasets')).toBeTruthy();
    // The gene appears in the breadcrumb and the big header readout.
    expect(screen.getAllByText('POMC').length).toBeGreaterThan(0);
    // The honest cross-dataset caveat ships.
    expect(screen.getByText(/absolute expression levels are not comparable/i)).toBeTruthy();
  });

  it('fires onHome from the nav', () => {
    const onHome = vi.fn();
    render(<CrossDatasetCompare gene="POMC" scope={null} onHome={onHome} />);
    fireEvent.click(screen.getByRole('button', { name: /^Home$/ }));
    expect(onHome).toHaveBeenCalled();
  });

  // Only the macaque bundle is seeded in jsdom, so this render is the partial
  // -failure case: one dataset loads and the rest fail. Those failures used to
  // return null and simply vanish, leaving a complete-looking comparison with
  // leave studies quietly missing - and when NOTHING loads, the same path reached
  // "POMC is not detected in any selected dataset", a claim of ABSENCE about
  // data that was never read. Observed live against an unreachable bundle
  // origin; this is the regression guard.
  it('names the datasets it could not load, and never calls them "not detected"', async () => {
    failAllBundleLoads();
    render(<CrossDatasetCompare gene="POMC" scope={null} onHome={() => {}} />);
    await waitFor(() => expect(document.body.textContent).toMatch(/Could not load \d+ datasets?/), {
      timeout: FALLBACK_SETTLE_TIMEOUT_MS,
    });
    // The wording that makes the distinction explicit for a reader.
    expect(document.body.textContent).toMatch(/cannot show whether/i);
    // And the claim that must never be made about an unread dataset.
    expect(document.body.textContent).not.toMatch(/is not detected in any selected dataset/i);
    // Macaque loaded and detects POMC, so there are charts and the failure line
    // is the footnote beside them - not the empty state's extra sentence, which
    // belongs to the case where nothing detects the gene.
    expect(document.body.textContent).not.toMatch(/Of the datasets that did load/i);
  }, FALLBACK_SETTLE_TIMEOUT_MS);

  // The empty state's second sentence is conditional on something having
  // loaded. Both halves of that condition need pinning, because the failure is
  // a sentence that quietly says the opposite of the truth: claiming datasets
  // were read when none were, or omitting a real negative result when some
  // were.
  it('mentions the loaded datasets only when some loaded', async () => {
    failAllBundleLoads();
    // A gene no fixture carries: macaque loads, detects nothing, and the other
    // remaining datasets fail. Something loaded, so the extra sentence belongs.
    const { unmount } = render(<CrossDatasetCompare gene="NOSUCHGENE" scope={null} onHome={() => {}} />);
    await waitFor(
      () => expect(document.body.textContent).toMatch(/Could not load \d+ datasets?/),
      { timeout: FALLBACK_SETTLE_TIMEOUT_MS },
    );
    expect(document.body.textContent).toMatch(/Of the datasets that did load, none detects NOSUCHGENE/i);
    unmount();

    // Now narrow to a category whose only dataset FAILED: nothing in scope
    // loaded, so the sentence must be absent rather than assert about an empty
    // set.
    render(<CrossDatasetCompare gene="NOSUCHGENE" scope={['Circadian']} onHome={() => {}} />);
    await waitFor(
      () => expect(document.body.textContent).toMatch(/Could not load \d+ datasets?/),
      { timeout: FALLBACK_SETTLE_TIMEOUT_MS },
    );
    expect(document.body.textContent).not.toMatch(/Of the datasets that did load/i);
  }, FALLBACK_SETTLE_TIMEOUT_MS * 2);

  // The failure notice is scoped by the SAME category chips that scope the
  // charts. Narrow to the one category whose dataset actually loaded and the
  // other failures are no longer this view's news to report - counting them
  // there would also mean measuring them against `visible`, a set they are
  // disjoint from.
  it('drops out-of-scope failures when a category chip narrows the view', async () => {
    const cleanup = seedBulkDataset();
    try {
      failAllBundleLoads();
      render(<CrossDatasetCompare gene="POMC" scope={null} onHome={() => {}} />);
      await waitFor(
        () => expect(document.body.textContent).toMatch(/Could not load \d+ datasets?/),
        { timeout: FALLBACK_SETTLE_TIMEOUT_MS },
      );
      // "Primate atlas" holds exactly one dataset and it is the one that
      // resolves in jsdom, so narrowing to it leaves no in-scope failure.
      fireEvent.click(screen.getByRole('button', { name: /Primate atlas/ }));
      await waitFor(() =>
        expect(document.body.textContent).not.toMatch(/Could not load \d+ datasets?/),
      );
    } finally {
      cleanup();
    }
  }, FALLBACK_SETTLE_TIMEOUT_MS);
});
