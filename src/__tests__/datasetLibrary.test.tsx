import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { DatasetLibrary } from '../library/DatasetLibrary';
import { loadDatasetCatalog } from '../data/datasetCatalog';
import { listDatasets } from '../data/datasets';
import { _resetBundleCache, _setBundleTransport } from '../data/bundleSource';
import { seedQueryManifest } from './fixtures';

/**
 * Make every bundle request fail, deterministically.
 *
 * Simply not seeding the manifest does NOT exercise the degraded path: jsdom has
 * no network, so the real transport neither resolves nor rejects and the promise
 * hangs. A hang is not the failure being tested — and it is precisely why the
 * library renders registry cards immediately instead of awaiting the catalog.
 */
function failEveryBundleLoad(): () => void {
  _setBundleTransport(async () => ({ status: 'load-failed' }));
  return () => { _setBundleTransport(null); };
}

// The dataset library — the browse surface that replaced the explorer topbar's
// 42-option <select>. These pin the two things the <select> could not do: show a
// study's replicate counts before you open it, and narrow the corpus by biology.

afterEach(() => {
  // Restore unconditionally: a test that fails mid-way would otherwise leave a
  // stubbed transport installed and take every later test down with it.
  _setBundleTransport(null);
  _resetBundleCache();
});

const countText = (visible: number, total: number) => `${visible} of ${total} studies`;

// Keep role/name assertions inside their actual landmark. A document-wide
// button query computes names for every study card's styled descendants too;
// repeated queries block the jsdom worker long enough to delay Vitest RPCs.
const filterBar = () => within(screen.getByRole('region', { name: 'Filter datasets' }));

/** Close whatever filter menu is open, the way a user would. */
const closeMenus = () => fireEvent.keyDown(document, { key: 'Escape' });

/**
 * Open one facet's option list through the bar's add-filter menu. The menus
 * render inside the bar's landmark, so every query stays scoped to it.
 */
function openFacet(title: string) {
  closeMenus();
  fireEvent.click(filterBar().getByRole('button', { name: /^(Filter|Add filter)$/ }));
  fireEvent.click(filterBar().getByRole('button', { name: title }));
  return filterBar();
}

const showTable = () => fireEvent.click(
  within(screen.getByRole('group', { name: 'Result layout' })).getByRole('button', { name: /^table$/i }),
);

function renderLibrary(over: Partial<Parameters<typeof DatasetLibrary>[0]> = {}) {
  const props = {
    onHome: vi.fn(),
    onOpenInExplorer: vi.fn(),
    onOpenTracker: vi.fn(),
    onCompareSet: vi.fn(),
    ...over,
  };
  render(<DatasetLibrary {...props} />);
  return props;
}

describe('DatasetLibrary', () => {
  it('lists every registered dataset once the catalog resolves', async () => {
    const unseed = seedQueryManifest();
    renderLibrary();
    expect(await screen.findByText(/of \d+ studies/)).toBeTruthy();
    // Registry decides which datasets exist, so the count is the registry's.
    expect(screen.getByText(countText(listDatasets().length, listDatasets().length))).toBeTruthy();
    unseed();
  });

  it('shows replicate counts on the card — the thing an <option> could not carry', async () => {
    const unseed = seedQueryManifest();
    renderLibrary();
    await screen.findByText(/of \d+ studies/);
    // Arm labels come from each dataset's own groups, never from the bundles'
    // nNormal/nObese keys — which on a mouse study mean Chow and HFD.
    //
    // The counts moved to the card's corner when the result bars took the
    // headline, so they read as "3v3" with the arms named in the title. The
    // claim under test is unchanged; only where it is written moved.
    expect((await screen.findAllByTitle('3 Normal vs 3 Obese')).length).toBeGreaterThan(0);
    // A mouse study names its own arms, and never inherits macaque's.
    expect(screen.getAllByTitle(/^3 Chow vs /).length).toBeGreaterThan(0);
    unseed();
  });

  it('flags the macaque atlas as having replicate counts that vary across tracks', async () => {
    const unseed = seedQueryManifest();
    renderLibrary();
    await screen.findByText(/of \d+ studies/);
    // 55 of 60 macaque populations are 3v3 and five drop to an arm of 2, so a
    // flat "3 v 3" on that card would overclaim. The corner readout carries the
    // caveat as the same asterisk the table has always used.
    const varies = await screen.findAllByTitle("Counts vary across this study's populations");
    expect(varies.length).toBe(1);
    expect(varies[0].textContent).toBe('*');
    unseed();
  });

  it('offers the biology facets and no quality ones', async () => {
    const unseed = seedQueryManifest();
    renderLibrary();
    await screen.findByText(/of \d+ studies/);
    fireEvent.click(filterBar().getByRole('button', { name: 'Filter' }));
    const menu = within(filterBar().getByRole('dialog', { name: 'Add filter' }));
    for (const title of ['Category', 'Region', 'Perturbation', 'Preparation', 'Replicates']) {
      expect(menu.getByRole('button', { name: title })).toBeTruthy();
    }
    for (const gone of ['Pipeline QC', 'Experimental design', 'Author concordance', 'Detailed author review', 'Author-result availability']) {
      expect(menu.queryByRole('button', { name: gone })).toBeNull();
    }
    unseed();
  });

  it('closes the menu but keeps saying that it is filtering', async () => {
    // The reason the chip exists. Close the menu and the ticks go with it;
    // without the chip the reader cannot tell why 161 became 22.
    const unseed = seedQueryManifest();
    renderLibrary();
    await screen.findByText(/of \d+ studies/);
    fireEvent.click(openFacet('Region').getByRole('button', { name: /^Arcuate nucleus/ }));
    const narrowed = screen.getByText(/of \d+ studies/).textContent;

    closeMenus();
    expect(filterBar().queryByRole('dialog')).toBeNull();
    expect(filterBar().queryByRole('button', { name: /^Arcuate nucleus/ })).toBeNull();
    // ...but the chip still says what it is doing, and the filter still is.
    const chip = filterBar().getByRole('button', { name: 'Region, 1 selected' });
    expect(chip.textContent).toContain('Arcuate nucleus');
    expect(screen.getByText(/of \d+ studies/).textContent).toBe(narrowed);

    // The chip reopens its own options, and its x removes the filter.
    fireEvent.click(chip);
    expect(filterBar().getByRole('button', { name: /^Arcuate nucleus/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(filterBar().getByRole('button', { name: 'Remove Region filter' }));
    expect(filterBar().queryByRole('button', { name: 'Region, 1 selected' })).toBeNull();
    unseed();
  });

  it('offers several replicate floors, one at a time', async () => {
    const unseed = seedQueryManifest();
    renderLibrary();
    await screen.findByText(/of \d+ studies/);
    openFacet('Replicates');
    const rung = (n: number) => filterBar().getByRole('radio', { name: new RegExp(`^n \u2265 ${n} in both arms`) });
    for (const n of [3, 4, 6, 10]) expect(rung(n)).toBeTruthy();

    fireEvent.click(rung(3));
    expect(rung(3).getAttribute('aria-checked')).toBe('true');
    // A second rung REPLACES the first: two floors can only mean the higher.
    fireEvent.click(rung(6));
    expect(rung(6).getAttribute('aria-checked')).toBe('true');
    expect(rung(3).getAttribute('aria-checked')).toBe('false');
    // Clicking the live rung clears it.
    fireEvent.click(rung(6));
    expect(rung(6).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(countText(listDatasets().length, listDatasets().length))).toBeTruthy();
    unseed();
  });

  it('narrows the corpus by region and perturbation together', async () => {
    const unseed = seedQueryManifest();
    renderLibrary();
    await screen.findByText(/of \d+ studies/);
    const total = listDatasets().length;

    const visibleCount = () =>
      Number(/^(\d+) of/.exec(screen.getByText(/of \d+ studies/).textContent ?? '')?.[1]);

    fireEvent.click(openFacet('Region').getByRole('button', { name: /^Arcuate nucleus/ }));
    const afterRegion = visibleCount();
    expect(afterRegion).toBeLessThan(total);
    expect(afterRegion).toBeGreaterThan(0);

    fireEvent.click(openFacet('Perturbation').getByRole('button', { name: /^Genetic/ }));
    const afterBoth = visibleCount();
    expect(afterBoth).toBeLessThan(afterRegion);
    unseed();
  });

  it('explains the author-validation status in the study record', async () => {
    // Validation left the rail with the other quality facets: it answers a
    // question you ask ABOUT a study you have found, not one you browse by. The
    // record is where it has to keep answering it.
    const unseed = seedQueryManifest();
    renderLibrary();
    await screen.findByText(/of \d+ studies/);

    expect(filterBar().queryByRole('button', { name: /^Author results untested/ })).toBeNull();
    expect(filterBar().queryByRole('button', { name: /^Outside verification scope/ })).toBeNull();

    const label = screen.getAllByText('Macaque hypothalamus (snRNA-seq)')[0];
    fireEvent.click(label.closest('button') as HTMLElement);
    const record = screen.getByRole('article', { name: /Macaque hypothalamus/i });
    // The status is stated in the summary strip, which is never collapsed.
    const summary = within(record).getByRole('region', { name: 'Verification summary' });
    expect(within(summary).getByText('Excluded by validation scope')).toBeTruthy();

    // The dossier and its evidence links live in the Verification tab. The
    // Overview tab does not mount them, so asserting their absence first proves
    // the tab is what shows them.
    expect(within(record).queryByRole('link', { name: 'CNGB record' })).toBeNull();
    fireEvent.click(within(record).getByRole('tab', { name: 'Verification' }));
    expect(within(record).getByRole('tab', { name: 'Verification' })).toHaveAttribute('aria-selected', 'true');
    expect(within(record).getAllByText('Excluded from scope').length).toBeGreaterThan(0);
    expect(within(record).getByRole('link', { name: 'CNGB record' })).toBeTruthy();
    unseed();
  });

  it('resets every filter at once', async () => {
    const unseed = seedQueryManifest();
    renderLibrary();
    await screen.findByText(/of \d+ studies/);
    fireEvent.click(openFacet('Region').getByRole('button', { name: /^Arcuate nucleus/ }));
    closeMenus();
    fireEvent.click(filterBar().getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText(countText(listDatasets().length, listDatasets().length))).toBeTruthy();
    unseed();
  });

  it('opens a study record without entering the explorer', async () => {
    const unseed = seedQueryManifest();
    const props = renderLibrary();
    await screen.findByText(/of \d+ studies/);

    const label = screen.getAllByText('Macaque hypothalamus (snRNA-seq)')[0];
    fireEvent.click(label.closest('button') as HTMLElement);

    // Selecting is preview, never commitment: switchDataset eagerly loads a
    // bundle and resets explorer state, so looking must not trigger it.
    const record = screen.getByRole('article', { name: /Macaque hypothalamus/i });
    expect(within(record).getAllByText('Macaca fascicularis').length).toBeGreaterThan(0);
    expect(props.onOpenInExplorer).not.toHaveBeenCalled();

    fireEvent.click(within(record).getByRole('button', { name: /Open in explorer/i }));
    expect(props.onOpenInExplorer).toHaveBeenCalledWith('macaque_snrna');
    unseed();
  });

  it('opens with a study already showing when given one', async () => {
    const unseed = seedQueryManifest();
    renderLibrary({ initialSelectedId: 'macaque_snrna' });
    const record = await screen.findByRole('article', { name: /Macaque hypothalamus/i });
    expect(within(record).getAllByText(/Macaca fascicularis/).length).toBeGreaterThan(0);
    // A page, not a popup: the list behind it is hidden rather than dimmed, and
    // the breadcrumb names the way back.
    expect(screen.queryByRole('region', { name: 'Filter datasets' })).toBeNull();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('button', { name: 'Dataset library' }));
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.getByRole('region', { name: 'Filter datasets' })).toBeTruthy();
    unseed();
  });

  it('draws the study\'s volcano in the record without entering the explorer', async () => {
    const unseed = seedQueryManifest();
    const props = renderLibrary({ initialSelectedId: 'mouse_hypo_hfd_gse220533' });
    const record = await screen.findByRole('article', { name: /Mouse whole hypothalamus — HFD vs LFD|Mouse whole hypothalamus/i });
    // The section stands in the Overview from the first frame; its bundle loads
    // behind it (or, in jsdom, never), and either way nothing is opened.
    const volcano = within(record).getByRole('region', { name: 'Volcano plot' });
    // Each arm is named with its n, baseline first, once the catalog lands.
    expect(await within(volcano).findByText('Chow (n=7) → HFD (n=8)')).toBeTruthy();
    // Opening a record downloads nothing: the plot waits to be asked for.
    expect(within(volcano).queryByText(/Loading the track/)).toBeNull();
    fireEvent.click(within(volcano).getByRole('button', { name: 'Show volcano plot' }));
    expect(await within(volcano).findByText(/Loading the track/)).toBeTruthy();
    expect(props.onOpenInExplorer).not.toHaveBeenCalled();
    unseed();
  });

  it('steps through the current results from the record', async () => {
    const unseed = seedQueryManifest();
    const props = renderLibrary({ initialSelectedId: 'macaque_snrna', onSelectedIdChange: vi.fn() });
    const record = await screen.findByRole('article', { name: /Macaque hypothalamus/i });
    // The macaque atlas sorts first under Category, so there is no previous.
    expect(within(record).getByRole('button', { name: 'Previous study' })).toBeDisabled();
    fireEvent.click(within(record).getByRole('button', { name: 'Next study' }));
    // The URL follows, the same as a click in the list.
    expect(props.onSelectedIdChange).toHaveBeenLastCalledWith(expect.not.stringMatching(/^macaque_snrna$/));
    expect(screen.queryByRole('article', { name: /Macaque hypothalamus/i })).toBeNull();
    unseed();
  });

  it('opens narrowed to the categories it was given', async () => {
    // 'Leptin, insulin & energy signaling' carries the comma that a naive
    // join/split treats as a separator, which silently drops it and its
    // neighbours from the rail. The hub's "Physiology & signaling" link is
    // exactly this list, so the shipped path is the one that breaks.
    const unseed = seedQueryManifest();
    renderLibrary({ initialCategories: ['Feeding & fasting', 'Leptin, insulin & energy signaling', 'Stress, immune & disease'] });
    await screen.findAllByText((t) => t.includes(' studies'));

    // Matched by prefix rather than by a built pattern: two of these names
    // carry characters a regex would have to escape, which is the same hazard
    // the test exists to catch.
    // The Category chip opens the same option list the add-filter menu does.
    fireEvent.click(filterBar().getByRole('button', { name: 'Category, 3 selected' }));
    const railRow = (label: string) => filterBar().getByRole('button', { name: (n: string) => n.startsWith(label) });

    for (const category of ['Feeding & fasting', 'Leptin, insulin & energy signaling', 'Stress, immune & disease']) {
      expect(railRow(category)).toHaveAttribute('aria-pressed', 'true');
    }
    expect(railRow('Diet-induced obesity')).toHaveAttribute('aria-pressed', 'false');
    unseed();
  });

  it('opens the Aging module on its nine validated studies', async () => {
    const unseed = seedQueryManifest();
    const props = renderLibrary({ initialCategories: ['Aging'] });
    const total = listDatasets().length;

    expect(await screen.findByText(countText(9, total))).toBeTruthy();
    // Arriving on one category names it in a chip, whose menu has it ticked.
    const chip = filterBar().getByRole('button', { name: 'Category, 1 selected' });
    expect(chip.textContent).toContain('Aging');
    fireEvent.click(chip);
    expect(filterBar().getByRole('button', { name: (name: string) => name.startsWith('Aging') }))
      .toHaveAttribute('aria-pressed', 'true');
    closeMenus();
    expect(screen.queryByText('Macaque hypothalamus (snRNA-seq)')).toBeNull();

    const title = 'Mouse hypothalamus — 22 months vs 12 weeks (bulk RNA-seq)';
    fireEvent.click(screen.getAllByText(title)[0].closest('button') as HTMLElement);
    const record = screen.getByRole('article', { name: /22 months vs 12 weeks/i });
    fireEvent.click(within(record).getByRole('button', { name: /Open in explorer/i }));
    expect(props.onOpenInExplorer).toHaveBeenCalledWith('mouse_hypo_aging_gse240365');
    unseed();
  });

  it('dismisses the record on Escape', async () => {
    // The record claims to be modal, so Escape has to be a way out of it —
    // otherwise a keyboard user who opens a study by accident is stuck behind a
    // focus trap with only the × to find.
    const unseed = seedQueryManifest();
    renderLibrary({ initialSelectedId: 'macaque_snrna' });
    const record = await screen.findByRole('article', { name: /Macaque hypothalamus/i });

    fireEvent.keyDown(record, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('article')).toBeNull());
    unseed();
  });

  it('still lists every study, and says so, when the catalog does not load', async () => {
    // Every dataset must stay reachable — a missing card reads as "we don't have
    // that study", which would be false.
    const restore = failEveryBundleLoad();
    renderLibrary();
    expect(await screen.findByText(/Replicate and feature counts are unavailable/i)).toBeTruthy();
    expect(screen.getByText(countText(listDatasets().length, listDatasets().length))).toBeTruthy();
    restore();
  });

  it('keeps the table\'s arm order and its N order aligned', async () => {
    // Regression. The Contrast column read "HFD vs Chow" while the N column read
    // "7 v 8" (baseline-first), so the row claimed HFD=7 when HFD is 8. Every
    // other seeded dataset is 3v3, which is exactly why this survived: with
    // symmetric arms a reversal is invisible.
    const unseed = seedQueryManifest();
    renderLibrary();
    await screen.findAllByTitle('3 Normal vs 3 Obese');
    showTable();

    // Anchored: the row also carries an "Add … to compare set" toggle whose
    // name contains the study's.
    const row = screen.getByRole('button', { name: /^Mouse whole hypothalamus \(bulk RNA-seq\)$/ })
      .closest('tr') as HTMLElement;
    const cells = [...row.querySelectorAll('td')].map((c) => c.textContent?.trim());
    // Baseline first in BOTH columns: Chow → HFD, and 7 (Chow) v 8 (HFD).
    expect(cells).toContain('Chow → HFD');
    expect(cells.some((c) => c === '7 v 8')).toBe(true);
    // The same two counts the card leads with. Before these columns existed the
    // Cards/Table toggle swapped the subject, not just the layout.
    expect(cells.some((c) => c === '491')).toBe(true);
    expect(cells.some((c) => c === '121')).toBe(true);
    unseed();
  });

  it('writes a measured zero in the table, and an unmeasured count as a dash', async () => {
    // The macaque's default population finds nothing; the table has to say so
    // rather than leave the cell looking like the index failed to load.
    const unseed = seedQueryManifest();
    renderLibrary();
    await screen.findAllByTitle('3 Normal vs 3 Obese');
    showTable();
    const row = screen.getByRole('button', { name: /^Macaque hypothalamus \(snRNA-seq\)$/ })
      .closest('tr') as HTMLElement;
    const genes = within(row).getByTitle('0 of 12,627 tested genes with FDR < 0.05');
    expect(genes.textContent).toBe('0');
    expect(within(row).getByTitle('57 of 4,584 tested pathway terms with adjusted P < 0.05').textContent).toBe('57');
    // The headers say these are significant counts, and the footer says at what
    // cutoff where hover tooltips are unavailable.
    const table = row.closest('table') as HTMLElement;
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers).toEqual(expect.arrayContaining(['Sig. genes', 'Sig. pathways']));
    expect(table.querySelector('tfoot')!.textContent).toContain('FDR < 0.05');
    unseed();
  });

  it('exposes every table record to the keyboard', async () => {
    // The row's onClick alone left the table view unusable without a pointer.
    const unseed = seedQueryManifest();
    const props = renderLibrary();
    await screen.findAllByTitle('3 Normal vs 3 Obese');
    showTable();

    const rowButton = screen.getByRole('button', { name: /^Macaque hypothalamus \(snRNA-seq\)$/ });
    fireEvent.click(rowButton);
    const record = screen.getByRole('article', { name: /Macaque hypothalamus/i });
    expect(within(record).getAllByText('Macaca fascicularis').length).toBeGreaterThan(0);
    expect(props.onOpenInExplorer).not.toHaveBeenCalled();
    unseed();
  });

  it('ignores a summary whose default track disagrees with the registry', async () => {
    // Same id, different corpus: the manifest and the bundles deploy off-origin
    // on their own schedule, so a summary can describe a track the registry no
    // longer defaults to. Its N belongs to that other track, and showing it
    // beside this card's arm labels would be a silent mismatch.
    const unseed = seedQueryManifest();
    const manifest = (window as unknown as Record<string, { datasets: Array<{ ds: string; defaultTrack: string }> }>).HX_QUERY_TRACKS;
    const entry = manifest.datasets.find((d) => d.ds === 'macaque_snrna');
    if (entry) entry.defaultTrack = 'some_other_track';

    const catalog = await loadDatasetCatalog();
    expect(catalog.state).toBe('registry-only');
    const macaque = catalog.cards.find((c) => c.dataset.id === 'macaque_snrna');
    expect(macaque?.nBaseline).toBeNull();
    expect(macaque?.trackCount).toBeNull();
    unseed();
  });

  it('ignores a summary whose contrast disagrees with the registry', async () => {
    const unseed = seedQueryManifest();
    const manifest = (window as unknown as Record<string, {
      datasets: Array<{ ds: string; contrastId: string | null }>;
    }>).HX_QUERY_TRACKS;
    const entry = manifest.datasets.find((d) => d.ds === 'macaque_snrna');
    if (entry) entry.contrastId = 'wrong_contrast';

    const catalog = await loadDatasetCatalog();
    expect(catalog.state).toBe('registry-only');
    const macaque = catalog.cards.find((card) => card.dataset.id === 'macaque_snrna');
    expect(macaque?.nBaseline).toBeNull();
    expect(macaque?.trackCount).toBeNull();
    unseed();
  });

  it('withholds measured counts when the catalog omits a study from this build', async () => {
    // The realistic skew: bundles and the query index deploy off-origin on their
    // own schedule, so a registry that ships a dataset before its index rebuild
    // reaches the CDN leaves exactly one card with dashes. Calling that
    // "complete" would let the dashes read as a fact about the study.
    const unseed = seedQueryManifest();
    const manifest = (window as unknown as Record<string, { datasets: Array<{ ds: string }> }>).HX_QUERY_TRACKS;
    manifest.datasets = manifest.datasets.filter((d) => d.ds !== 'macaque_snrna');

    renderLibrary();
    expect(await screen.findByText(/Replicate and feature counts are unavailable/i)).toBeTruthy();
    // Every study stays listed and openable when the remote catalog is stale.
    expect(screen.getAllByText('Macaque hypothalamus (snRNA-seq)').length).toBeGreaterThan(0);
    unseed();
  });

  it('is usable before the catalog resolves rather than showing a spinner', () => {
    // Registry cards render on the first frame. Blocking the view on a network
    // fetch for NUMBERS would leave a stalled request showing a spinner forever.
    renderLibrary();
    expect(screen.getByText(countText(listDatasets().length, listDatasets().length))).toBeTruthy();
    expect(screen.getAllByText('Macaque hypothalamus (snRNA-seq)').length).toBeGreaterThan(0);
    // No premature claim about the numbers while they are still in flight.
    expect(screen.queryByText(/Replicate and feature counts are unavailable/i)).toBeNull();
  });
});

describe('loadDatasetCatalog', () => {
  it.each(['previous-corpus', '', undefined])('withholds old sample counts when the corpus identity is %s', async (buildId) => {
    const unseed = seedQueryManifest();
    const manifest = (window as unknown as Record<string, { buildId?: string }>).HX_QUERY_TRACKS;
    manifest.buildId = buildId;
    const catalog = await loadDatasetCatalog();
    expect(catalog.state).toBe('registry-only');
    expect(catalog.cards.length).toBe(listDatasets().length);
    expect(catalog.cards.every((card) => card.nBaseline === null && card.nCase === null && card.nGenes === null)).toBe(true);
    // Quality badges still come from this app's current evidence ledger.
    expect(catalog.cards.every((card) => card.validation.datasetId === card.dataset.id)).toBe(true);
    unseed();
  });

  it('returns a card per registered dataset and reports which state it is in', async () => {
    const unseed = seedQueryManifest();
    const complete = await loadDatasetCatalog();
    expect(complete.state).toBe('complete');
    expect(complete.cards.length).toBe(listDatasets().length);
    // Real per-dataset numbers, not one seeded constant: the HFD study is 7 v 8.
    const hfd = complete.cards.find((c) => c.dataset.id === 'mouse_hypo_hfd_gse220533');
    expect([hfd?.nBaseline, hfd?.nCase]).toEqual([7, 8]);
    expect(complete.cards.filter((c) => c.nBaseline === 3).length).toBeGreaterThan(0);
    unseed();
    _resetBundleCache();

    const restore = failEveryBundleLoad();
    const bare = await loadDatasetCatalog();
    restore();
    expect(bare.state).toBe('registry-only');
    expect(bare.cards.length).toBe(listDatasets().length);
    // Unmeasured is null, never a plausible-looking default.
    expect(bare.cards.every((c) => c.nBaseline === null && c.trackCount === null)).toBe(true);
    // The registry half survives either way.
    expect(bare.cards.every((c) => c.baselineGroup && c.caseGroup)).toBe(true);
  });
});
