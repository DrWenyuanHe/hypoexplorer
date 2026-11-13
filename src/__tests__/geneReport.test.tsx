import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { getDataset } from '../data/datasets';
import { getActiveContrast } from '../data/contrasts';
import { _resetCompareSetStore, getSnapshot } from '../compareset/compareSetStore';
import { CompareSetButton } from '../compareset/CompareSetButton';
import { _resetBundleCache, _setBundleTransport } from '../data/bundleSource';
import { _resetTrackCache } from '../data/loadTrack';
import type { BaselineTeaser } from '../search/searchSummaries';
import type { CrossDatasetGeneReport, Dataset, TrackRow } from '../types';

// The cross-dataset gene report renders against a MOCKED data layer (the real one
// injects <script> bundles per track). The differential-expression table, its
// verdict and its ordering are computed by the component from the fixture.
const REPORT_REF: { current: CrossDatasetGeneReport } = { current: null as never };

vi.mock('../data/crossDataset', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/crossDataset')>();
  return { ...actual, queryGeneAcrossDatasets: vi.fn(async () => REPORT_REF.current) };
});

// The gene page also draws the search portal's cards. Their loaders read the
// NeuroSeq files and the query index, so they are replaced here; the rest of the
// module stays real.
const summaries = vi.hoisted(() => ({
  loadBaselineTeaser: vi.fn(),
  loadConditionPathways: vi.fn(),
  loadReferenceAtlases: vi.fn(),
}));

vi.mock('../search/searchSummaries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../search/searchSummaries')>();
  return { ...actual, ...summaries };
});

const BASELINE: BaselineTeaser = {
  status: 'available',
  gene: 'Pomc',
  description: 'pro-opiomelanocortin-alpha',
  populations: [
    { id: 'arc_pomc', label: 'ARC POMC', region: 'ARC', meanTpm: 812.5, libraries: 4 },
    { id: 'arc_agrp', label: 'ARC AgRP', region: 'ARC', meanTpm: 3.2, libraries: 4 },
  ],
  populationCount: 2,
  max: 812.5,
};

const { GeneReport } = await import('../crossdataset/GeneReport');
const { queryGeneAcrossDatasets } = await import('../data/crossDataset');

const MACAQUE = getDataset('macaque_snrna') as Dataset;
const MOUSE = getDataset('mouse_hypo_hfd_gse220533') as Dataset;

function track(trackId: string, over: Partial<TrackRow> = {}): TrackRow {
  return {
    trackId,
    label: `${trackId} population`,
    type: 'Glutamatergic',
    logFC: 0.3,
    fdr: 0.6,
    pval: 0.4,
    se: 0.25,
    direction: 'up',
    significant: false,
    lowPower: false,
    ...over,
  };
}

// Two research areas: the macaque atlas ('Primate atlas', five tracks, e9
// significant) and the mouse HFD study ('Diet-induced obesity', one track,
// significant). Within an area rows sort by q, and the q = 0.6 ties fall back
// to |log2FC| (e2, then i23, then e3).
function report(): CrossDatasetGeneReport {
  return {
    gene: 'POMC',
    total: 6,
    loaded: 6,
    groups: [
      {
        dataset: MACAQUE,
        contrast: getActiveContrast(MACAQUE),
        tracks: [
          track('e9', { logFC: -1.2, fdr: 0.03, pval: 0.0001, direction: 'down', significant: true }),
          track('i23'),
          track('e1', { fdr: 0.3, pval: 0.1, lowPower: true }),
          track('e2', { logFC: -0.9, direction: 'down' }),
          track('e3', { logFC: 0.1 }),
        ],
      },
      {
        dataset: MOUSE,
        contrast: getActiveContrast(MOUSE),
        tracks: [track('hypothalamus', { logFC: 0.8, fdr: 0.02, pval: 0.001, significant: true })],
      },
    ],
  };
}

/** The fixture with nothing reaching the FDR cutoff. */
function nothingSignificant(): CrossDatasetGeneReport {
  const base = report();
  return {
    ...base,
    groups: base.groups.map((group) => ({
      ...group,
      tracks: group.tracks.map((t) => ({ ...t, fdr: Math.max(t.fdr ?? 1, 0.2), significant: false })),
    })),
  };
}

/** The fixture with the macaque atlas measured but not significant: a quiet area. */
function quietPrimate(): CrossDatasetGeneReport {
  const base = report();
  const [macaque, mouse] = base.groups;
  return {
    ...base,
    groups: [
      { ...macaque, tracks: macaque.tracks.map((t) => ({ ...t, fdr: Math.max(t.fdr ?? 1, 0.2), significant: false })) },
      mouse,
    ],
  };
}

const MACAQUE_CONTRAST = getActiveContrast(MACAQUE);
const MOUSE_CONTRAST = getActiveContrast(MOUSE);
if (!MACAQUE_CONTRAST || !MOUSE_CONTRAST) throw new Error('fixture datasets need an active contrast');

/** The fold phrase the Change cell shows for a log2FC in a comparison's first group. */
function expectedPhrase(logFC: number, caseLabel: string): string {
  const fold = 2 ** Math.abs(logFC);
  return `${fold >= 10 ? fold.toFixed(0) : fold.toFixed(1)}× ${logFC > 0 ? 'higher' : 'lower'} in ${caseLabel}`;
}

type ReportProps = Partial<Parameters<typeof GeneReport>[0]>;

function renderReport(onOpenDataset?: (datasetId: string, trackId?: string) => void, onCompare = vi.fn(), props: ReportProps = {}) {
  return render(
    <GeneReport gene="POMC" scope={null} onHome={() => {}} onSearchGene={() => {}} onOpenDataset={onOpenDataset}
      headerRight={<CompareSetButton onCompare={onCompare} />} {...props} />,
  );
}

/** True when `a` comes before `b` in document order. */
function precedes(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function deSection(): HTMLElement | null {
  return document.querySelector('section.portal-card[data-section="differential-expression"]');
}

/**
 * The differential-expression card, once the report has loaded. The section
 * and its heading render for any gene, through loading and empty states, so
 * this waits for the verdict (or the not-measured note) inside it.
 */
async function findDeCard(): Promise<HTMLElement> {
  return waitFor(() => {
    const section = deSection();
    expect(section?.querySelector('.portal-verdict, .portal-note')).toBeTruthy();
    return section as HTMLElement;
  });
}

/** One table per research area, in page order. */
function deTables(card: HTMLElement): HTMLTableElement[] {
  return [...card.querySelectorAll<HTMLTableElement>('.report-de-areas table.report-de-table')];
}

function areaTable(card: HTMLElement, area: string): HTMLTableElement {
  const table = card.querySelector<HTMLTableElement>(`table.report-de-table[data-area="${area}"]`);
  if (!table) throw new Error(`No table for ${area}`);
  return table;
}

/** The body rows of one table, or of every area table on the page, in order. */
function bodyRows(scope: HTMLElement): HTMLTableRowElement[] {
  // The selector matches against the whole document, so a table scope finds its own rows.
  return [...scope.querySelectorAll<HTMLTableRowElement>('table.report-de-table tbody tr')];
}

/** A row's track label: the population line of its study cell, without its pills. */
function trackLabel(tr: HTMLTableRowElement): string {
  return tr.cells[1].querySelector('.report-de-population')?.textContent ?? '';
}

/** The track label of each row, in order. */
function trackLabels(scope: HTMLElement): string[] {
  return bodyRows(scope).map(trackLabel);
}

/** The row for one track label. */
function rowFor(card: HTMLElement, label: string): HTMLTableRowElement {
  const row = bodyRows(card).find((tr) => trackLabel(tr) === label);
  if (!row) throw new Error(`No row for ${label}`);
  return row;
}

/** An area table's caption parts. */
function captionOf(table: HTMLTableElement) {
  const caption = table.caption as HTMLTableCaptionElement;
  return {
    name: caption.querySelector('.report-de-area-name')?.textContent,
    count: caption.querySelector('.report-de-area-count')?.textContent,
    dirs: caption.querySelector('.report-de-area-dirs')?.textContent ?? null,
  };
}

function moreButton(card: HTMLElement): HTMLButtonElement | null {
  return card.querySelector('button.search-more');
}

beforeEach(() => {
  _resetCompareSetStore();
  REPORT_REF.current = report();
  summaries.loadBaselineTeaser.mockReset().mockResolvedValue(BASELINE);
  // null keeps the reserved condition-pathways slot.
  summaries.loadConditionPathways.mockReset().mockResolvedValue(null);
  // null: the reference atlas cards say they could not be loaded.
  summaries.loadReferenceAtlases.mockReset().mockResolvedValue(null);
});

describe('GeneReport — differential expression table', () => {
  it('states how many datasets reach significance and the direction of the significant tracks', async () => {
    renderReport();
    const card = await findDeCard();
    expect(within(card).getByRole('heading', { level: 2 })).toHaveTextContent('Differential expression across studies');
    const verdict = card.querySelector('.portal-verdict');
    expect(verdict).toHaveTextContent(
      'Significant in 2 of 2 datasets, across 2 research areas · 1 track up · 1 down (FDR < 0.05)',
    );
    expect(verdict?.querySelectorAll('b')).toHaveLength(5);
  });

  it('reads every change as the first group of the comparison against the second', async () => {
    renderReport();
    const card = await findDeCard();
    const legend = card.querySelector('.report-de-legend') as HTMLElement;
    expect(legend).toHaveTextContent('Each change is POMC in the first group of the comparison, relative to the second.');
    expect(legend.querySelector('b')).toHaveTextContent('first group');
    const dirs = legend.querySelector('.report-de-legend-dirs') as HTMLElement;
    expect(dirs).toHaveTextContent('◀ lower in the first group');
    expect(dirs).toHaveTextContent('higher in the first group ▶');
    // The legend sits above the area tables, and the axis note below them.
    expect(precedes(legend, deTables(card)[0])).toBe(true);
    const notes = [...card.querySelectorAll('.portal-note')];
    const axis = notes.find((n) => n.textContent?.includes('log2FC axis')) as Element;
    expect(axis).toHaveTextContent('Bars share one ±2 log2FC axis.');
    expect(precedes(deTables(card).at(-1) as Element, axis)).toBe(true);
  });

  it('draws one table per research area with its own tally, ordered by significant count', async () => {
    renderReport();
    const card = await findDeCard();
    // Both areas have one significant track and one listed row: registry order breaks the tie.
    expect(deTables(card).map((t) => t.dataset.area)).toEqual(['Primate atlas', 'Diet-induced obesity']);
    expect(captionOf(areaTable(card, 'Primate atlas'))).toEqual({ name: 'Primate atlas', count: '1 significant', dirs: '0 up · 1 down' });
    expect(captionOf(areaTable(card, 'Diet-induced obesity'))).toEqual({ name: 'Diet-induced obesity', count: '1 significant', dirs: '1 up · 0 down' });
    expect(trackLabels(areaTable(card, 'Primate atlas'))).toEqual(['e9 population']);
    expect(trackLabels(areaTable(card, 'Diet-induced obesity'))).toEqual(['hypothalamus population']);
    // The column headers are there for assistive technology only.
    for (const table of deTables(card)) {
      expect(table.querySelector('thead')).toHaveClass('portal-sr');
      expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(
        ['Comparison', 'Population and source', 'Effect bar', 'Change', 'q (FDR)', 'Study actions'],
      );
    }
  });

  it('names the comparison with its first group in bold and the change as a fold phrase', async () => {
    renderReport();
    const card = await findDeCard();
    const mouse = rowFor(card, 'hypothalamus population');
    expect(mouse).toHaveAttribute('data-significant', 'true');
    const comparison = mouse.cells[0];
    expect(comparison).toHaveClass('report-de-comparison');
    expect(comparison.querySelector('b.report-de-first')).toHaveTextContent(MOUSE_CONTRAST.caseGroup.label);
    expect(comparison).toHaveTextContent(`${MOUSE_CONTRAST.caseGroup.label} vs ${MOUSE_CONTRAST.baseline.label}`);
    // The population leads; species, preparation and accession follow. The study's
    // full name is the cell's title rather than repeated in the row.
    expect(mouse.cells[1].querySelector('.report-de-population')).toHaveTextContent('hypothalamus population');
    expect(mouse.cells[1].querySelector('.report-de-source')?.textContent)
      .toBe(`${MOUSE.organism} · ${MOUSE.preparation} · GSE220533`);
    expect(mouse.cells[1].querySelector('.report-de-source i')).toHaveTextContent(MOUSE.organism);
    expect(mouse.cells[1]).toHaveAttribute('title', MOUSE.name);
    expect(mouse.cells[1]).not.toHaveTextContent(MOUSE.name);
    expect(mouse.cells[2]).toHaveAttribute('aria-hidden', 'true');
    expect(mouse.cells[3].querySelector('.report-de-phrase')).toHaveTextContent(expectedPhrase(0.8, MOUSE_CONTRAST.caseGroup.label));
    expect(mouse.cells[3].querySelector('.report-de-phrase')).toHaveTextContent(/^1\.7× higher in /);
    expect(mouse.cells[3].querySelector('.report-de-fc')?.textContent).toBe('log2FC +0.80');
    expect(mouse.cells[4]).toHaveTextContent('0.02');

    const e9 = rowFor(card, 'e9 population');
    expect(e9.cells[0].querySelector('b.report-de-first')).toHaveTextContent(MACAQUE_CONTRAST.caseGroup.label);
    expect(e9.cells[0]).toHaveTextContent(`${MACAQUE_CONTRAST.caseGroup.label} vs ${MACAQUE_CONTRAST.baseline.label}`);
    expect(e9.cells[3].querySelector('.report-de-phrase')).toHaveTextContent(expectedPhrase(-1.2, MACAQUE_CONTRAST.caseGroup.label));
    expect(e9.cells[3].querySelector('.report-de-phrase')).toHaveTextContent(/^2\.3× lower in /);
    expect(e9.cells[3].querySelector('.report-de-fc')?.textContent).toBe('log2FC -1.20');
  });

  it('rounds large folds to whole numbers and reads a zero change as no change', async () => {
    const base = report();
    REPORT_REF.current = {
      ...base,
      groups: [base.groups[0], {
        ...base.groups[1],
        tracks: [
          track('hypothalamus', { logFC: 4, fdr: 0.001, direction: 'up', significant: true }),
          track('flat', { logFC: 0, fdr: 0.9, direction: 'up' }),
        ],
      }],
    };
    renderReport();
    const card = await findDeCard();
    expect(rowFor(card, 'hypothalamus population').querySelector('.report-de-phrase'))
      .toHaveTextContent(`16× higher in ${MOUSE_CONTRAST.caseGroup.label}`);
    fireEvent.click(moreButton(card) as HTMLButtonElement);
    expect(rowFor(card, 'flat population').querySelector('.report-de-phrase')).toHaveTextContent('No change');
  });

  it('shows a dash for a comparison it cannot resolve', async () => {
    const base = report();
    REPORT_REF.current = { ...base, groups: [base.groups[0], { ...base.groups[1], contrast: null }] };
    renderReport();
    const card = await findDeCard();
    const mouse = rowFor(card, 'hypothalamus population');
    expect(mouse.cells[0].textContent).toBe('–');
    expect(mouse.cells[0].querySelector('b')).toBeNull();
    expect(mouse.cells[3].querySelector('.report-de-phrase')).toHaveTextContent('1.7× higher in the case group');
  });

  it('toggles between the significant tracks and every measured track, sorted by q within each area', async () => {
    renderReport();
    const card = await findDeCard();
    expect(bodyRows(card).every((tr) => tr.dataset.significant === 'true')).toBe(true);
    // Every measured area has a significant track, so the toggle stands alone.
    expect(card.querySelector('.report-de-quiet-label')).toBeNull();
    const more = moreButton(card) as HTMLButtonElement;
    expect(card.querySelector('.report-de-quiet')?.contains(more)).toBe(true);
    expect(more).toHaveTextContent('Show all 6 measured tracks');
    expect(more).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(more);
    // The full list REPLACES the significant-only lead: no row renders twice.
    expect(deTables(card).map((t) => t.dataset.area)).toEqual(['Primate atlas', 'Diet-induced obesity']);
    expect(trackLabels(areaTable(card, 'Primate atlas'))).toEqual([
      'e9 population', 'e1 population', 'e2 population', 'i23 population', 'e3 population',
    ]);
    expect(trackLabels(areaTable(card, 'Diet-induced obesity'))).toEqual(['hypothalamus population']);
    expect(bodyRows(card)).toHaveLength(6);
    // The tally still counts the significant tracks only.
    expect(captionOf(areaTable(card, 'Primate atlas'))).toEqual({ name: 'Primate atlas', count: '1 significant', dirs: '0 up · 1 down' });
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(more).toHaveTextContent('Show only the 2 significant tracks');

    // Non-significant rows are unmarked and say so beside their log2FC.
    const e1 = rowFor(card, 'e1 population');
    expect(e1).not.toHaveAttribute('data-significant');
    expect(e1.querySelector('.report-de-fc')?.textContent).toBe('log2FC +0.30 · n.s.');
    expect(rowFor(card, 'e2 population').querySelector('.report-de-phrase'))
      .toHaveTextContent(expectedPhrase(-0.9, MACAQUE_CONTRAST.caseGroup.label));
    expect(rowFor(card, 'e9 population').querySelector('.report-de-fc')?.textContent).toBe('log2FC -1.20');

    fireEvent.click(more);
    expect(trackLabels(card)).toEqual(['e9 population', 'hypothalamus population']);
    expect(more).toHaveAttribute('aria-expanded', 'false');
  });

  it('names measured areas without a significant track instead of drawing them empty', async () => {
    REPORT_REF.current = quietPrimate();
    renderReport();
    const card = await findDeCard();
    const verdict = card.querySelector('.portal-verdict');
    // Substrings, so the area noun's number agreement is not pinned here.
    expect(verdict).toHaveTextContent('Significant in 1 of 2 datasets, across 1 research area');
    expect(verdict).toHaveTextContent('· 1 track up · 0 down (FDR < 0.05)');
    expect(deTables(card).map((t) => t.dataset.area)).toEqual(['Diet-induced obesity']);
    const quiet = card.querySelector('.report-de-quiet') as HTMLElement;
    expect(quiet.querySelector('.report-de-quiet-label')).toHaveTextContent('No significant track');
    // The label, then the quiet areas joined with " · " (one here).
    expect(quiet.querySelector('.report-de-quiet-label')?.nextElementSibling?.textContent).toBe('Primate atlas');
    const more = moreButton(card) as HTMLButtonElement;
    expect(quiet.contains(more)).toBe(true);
    expect(more).toHaveTextContent('Show all 6 measured tracks');

    fireEvent.click(more);
    // The area with a significant track leads the one with more rows.
    expect(deTables(card).map((t) => t.dataset.area)).toEqual(['Diet-induced obesity', 'Primate atlas']);
    expect(captionOf(areaTable(card, 'Primate atlas'))).toEqual({ name: 'Primate atlas', count: '5 measured, none significant', dirs: null });
    expect(trackLabels(areaTable(card, 'Primate atlas'))).toEqual([
      'e9 population', 'e1 population', 'e2 population', 'i23 population', 'e3 population',
    ]);
    expect(bodyRows(areaTable(card, 'Primate atlas')).some((tr) => tr.hasAttribute('data-significant'))).toBe(false);
    expect(card.querySelector('.report-de-quiet-label')).toBeNull();
    expect(more).toHaveTextContent('Show only the 1 significant track');
    expect(more).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(more);
    expect(deTables(card).map((t) => t.dataset.area)).toEqual(['Diet-induced obesity']);
    expect(card.querySelector('.report-de-quiet-label')?.nextElementSibling?.textContent).toBe('Primate atlas');
  });

  it('marks low-power tracks with a pill', async () => {
    renderReport();
    const card = await findDeCard();
    expect(card.querySelector('.portal-lowpower')).toBeNull();
    fireEvent.click(moreButton(card) as HTMLButtonElement);
    const pills = card.querySelectorAll('.portal-lowpower');
    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveTextContent('low power');
    expect(pills[0].closest('tr')).toBe(rowFor(card, 'e1 population'));
  });

  it('lists every measured track with a note when nothing is significant', async () => {
    REPORT_REF.current = nothingSignificant();
    renderReport();
    const card = await findDeCard();
    expect(card.querySelector('.portal-verdict')).toHaveTextContent('Significant in 0 of 2 datasets (FDR < 0.05)');
    expect(card.querySelector('.portal-verdict')?.textContent).not.toMatch(/up|down/);
    expect(within(card).getByText('No track reaches FDR < 0.05. Every measured track is listed, lowest q first.')).toBeTruthy();
    // Still grouped by area, the area with more measured tracks first, lowest q first within it.
    expect(deTables(card).map((t) => t.dataset.area)).toEqual(['Primate atlas', 'Diet-induced obesity']);
    expect(trackLabels(areaTable(card, 'Primate atlas'))).toEqual([
      'e9 population', 'e1 population', 'e2 population', 'i23 population', 'e3 population',
    ]);
    expect(captionOf(areaTable(card, 'Primate atlas'))).toEqual({ name: 'Primate atlas', count: '5 measured, none significant', dirs: null });
    expect(captionOf(areaTable(card, 'Diet-induced obesity'))).toEqual({ name: 'Diet-induced obesity', count: '1 measured, none significant', dirs: null });
    expect(bodyRows(card).some((tr) => tr.hasAttribute('data-significant'))).toBe(false);
    expect(bodyRows(card).every((tr) => tr.querySelector('.report-de-fc')?.textContent?.endsWith(' · n.s.'))).toBe(true);
    expect(moreButton(card)).toBeNull();
    expect(card.querySelector('.report-de-quiet')).toBeNull();
  });

  it('counts only datasets that measure the gene, and says so when none does', async () => {
    REPORT_REF.current = { ...report(), groups: [{ ...report().groups[1], tracks: [] }] };
    renderReport();
    const card = await findDeCard();
    expect(within(card).getByText('POMC is not measured in any selected study.')).toBeTruthy();
    expect(card.querySelector('table')).toBeNull();
  });

  it('names a study that failed to load instead of calling the gene unmeasured there', async () => {
    const [loaded, broken] = report().groups;
    REPORT_REF.current = { ...report(), groups: [loaded, { ...broken, tracks: [], error: true }] };
    renderReport();
    const card = await findDeCard();
    expect(within(card).getByText(
      `1 selected study could not be loaded (${broken.dataset.name}), so POMC may be measured there.`,
    )).toBeTruthy();
    expect(card.querySelector('table')).not.toBeNull();
  });

  it('does not call the gene unmeasured when no selected study loaded', async () => {
    const broken = report().groups[1];
    REPORT_REF.current = { ...report(), groups: [{ ...broken, tracks: [], error: true }] };
    renderReport();
    const card = await findDeCard();
    expect(within(card).queryByText(/not measured/)).toBeNull();
    expect(within(card).getByText(/^1 selected study could not be loaded/)).toBeTruthy();
  });

  it('narrows the table to the active categories', async () => {
    renderReport(undefined, vi.fn(), { scope: ['Primate atlas'] });
    const card = await findDeCard();
    expect(card.querySelector('.portal-verdict')).toHaveTextContent('Significant in 1 of 1 datasets, across 1 research area');
    expect(deTables(card).map((t) => t.dataset.area)).toEqual(['Primate atlas']);
    expect(trackLabels(card)).toEqual(['e9 population']);
  });

  // The empty states render inside the section, below its study filters, so the
  // control that fixes the selection sits right above the message.
  it('shows the empty state inside the section when no dataset is selected', async () => {
    renderReport(undefined, vi.fn(), { datasetScope: [] });
    const empty = await screen.findByText('No datasets selected.');
    const section = deSection() as HTMLElement;
    expect(section.contains(empty)).toBe(true);
    expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent('Differential expression across studies');
    const filters = section.querySelector('details.report-filters') as HTMLElement;
    expect(filters).toBeTruthy();
    expect(precedes(filters, empty)).toBe(true);
    expect(section.querySelector('table, .portal-verdict')).toBeNull();
  });

  it('keeps the section and its filters on screen while the report loads', async () => {
    vi.mocked(queryGeneAcrossDatasets).mockImplementationOnce(() => new Promise(() => {}));
    renderReport();
    const loading = await screen.findByText(/^Loading POMC across /);
    const section = deSection() as HTMLElement;
    expect(section.contains(loading)).toBe(true);
    expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent('Differential expression across studies');
    expect(precedes(section.querySelector('details.report-filters') as Element, loading)).toBe(true);
    expect(section.querySelector('table, .portal-verdict')).toBeNull();
  });

  it('reports a failed query inside the section', async () => {
    vi.mocked(queryGeneAcrossDatasets).mockImplementationOnce(async () => { throw new Error('offline'); });
    renderReport();
    const [message] = await screen.findAllByText('Could not load cross-dataset data.');
    const section = deSection() as HTMLElement;
    expect(section.contains(message)).toBe(true);
    expect(section.querySelector('table, .portal-verdict')).toBeNull();
  });

  it('shows the empty state when the selection leaves no result groups', async () => {
    renderReport(undefined, vi.fn(), { scope: ['Aging'] });
    const empty = await screen.findByText('No results for this selection.');
    const section = deSection() as HTMLElement;
    expect(section.contains(empty)).toBe(true);
    expect(section.querySelector('table, .portal-verdict')).toBeNull();
  });

  // The datasets are not interchangeable — eleven species, several platforms, a
  // dozen perturbations — so the report never combines them. Every number on the
  // page belongs to the one dataset it came from.
  it('never renders a pooled row, diamond or cross-dataset q', async () => {
    const { container } = renderReport();
    const card = await findDeCard();
    fireEvent.click(moreButton(card) as HTMLButtonElement);
    expect(within(card).queryByText(/^Pooled/)).toBeNull();
    expect(within(card).queryByText(/meta-analysis/i)).toBeNull();
    expect(within(card).queryByText(/^I² =/)).toBeNull();
    expect(container.textContent).not.toContain('q = ');
    expect(bodyRows(card)).toHaveLength(6);
  });
});

describe('GeneReport — folding research areas', () => {
  /** An area's header toggle and the body it controls. */
  function fold(table: HTMLTableElement) {
    const toggle = (table.caption as HTMLTableCaptionElement).querySelector('button.report-de-caption') as HTMLButtonElement;
    const body = table.tBodies[0];
    return { toggle, body, lead: () => toggle.querySelector('.report-de-area-lead')?.textContent ?? null };
  }

  it('opens every area with a significant track and folds it from its header', async () => {
    renderReport();
    const card = await findDeCard();
    for (const table of deTables(card)) {
      const { toggle, body, lead } = fold(table);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(toggle).toHaveAttribute('aria-controls', body.id);
      expect(body).not.toHaveAttribute('hidden');
      expect(lead()).toBeNull();
    }

    const dio = areaTable(card, 'Diet-induced obesity');
    const { toggle, body, lead } = fold(dio);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(body).toHaveAttribute('hidden');
    expect(dio.tHead).toHaveAttribute('hidden');
    // Folded, the header still names the area, its tally and what leads it.
    expect(captionOf(dio)).toEqual({ name: 'Diet-induced obesity', count: '1 significant', dirs: '1 up · 0 down' });
    expect(lead()).toBe(`Top: ${expectedPhrase(0.8, MOUSE_CONTRAST.caseGroup.label)}`);
    // The other area is untouched.
    expect(fold(areaTable(card, 'Primate atlas')).toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(body).not.toHaveAttribute('hidden');
    expect(lead()).toBeNull();
  });

  it('starts an area with no significant track folded once Show all lists it', async () => {
    REPORT_REF.current = quietPrimate();
    renderReport();
    const card = await findDeCard();
    fireEvent.click(moreButton(card) as HTMLButtonElement);
    const primate = fold(areaTable(card, 'Primate atlas'));
    expect(primate.toggle).toHaveAttribute('aria-expanded', 'false');
    expect(primate.body).toHaveAttribute('hidden');
    // Its lead is the lowest-q track, e9.
    expect(primate.lead()).toBe(`Top: ${expectedPhrase(-1.2, MACAQUE_CONTRAST.caseGroup.label)}`);
    expect(fold(areaTable(card, 'Diet-induced obesity')).toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(primate.toggle);
    expect(primate.body).not.toHaveAttribute('hidden');
    expect(trackLabels(areaTable(card, 'Primate atlas'))).toHaveLength(5);
  });

  it('keeps every area open when nothing is significant', async () => {
    REPORT_REF.current = nothingSignificant();
    renderReport();
    const card = await findDeCard();
    expect(deTables(card).map((t) => fold(t).toggle.getAttribute('aria-expanded'))).toEqual(['true', 'true']);
  });
});

describe('GeneReport — table row actions', () => {
  it('reaches the library record through Info without inline QC or source links', async () => {
    renderReport();
    const card = await findDeCard();
    const actions = rowFor(card, 'hypothalamus population').querySelector('.report-de-actions') as HTMLElement;
    const info = within(actions).getByRole('link', { name: `More information about ${MOUSE.name}` });
    expect(info).toHaveTextContent('Info');
    expect(info).toHaveAttribute('href', '#/library/mouse_hypo_hfd_gse220533');
    const areas = card.querySelector('.report-de-areas') as HTMLElement;
    expect(within(areas).queryByRole('link', { name: /Verification evidence|GSE220533|PMID/ })).toBeNull();
    // The study filters (inside this section) name the quality checks; the tables do not.
    expect(areas.textContent).not.toMatch(/Pipeline QC|Experimental design|Author concordance/);
  });

  it('opens each row at its own track on a plain click', async () => {
    const onOpenDataset = vi.fn();
    renderReport(onOpenDataset);
    const card = await findDeCard();
    const mouse = within(rowFor(card, 'hypothalamus population')).getByTitle(`Open ${MOUSE.name}, hypothalamus population, in the explorer`);
    expect(mouse).toHaveTextContent('Open →');
    expect(mouse).toHaveAttribute('href', '#/dataset/mouse_hypo_hfd_gse220533/hypothalamus');
    fireEvent.click(mouse);
    expect(onOpenDataset).toHaveBeenLastCalledWith('mouse_hypo_hfd_gse220533', 'hypothalamus');

    fireEvent.click(moreButton(card) as HTMLButtonElement);
    const i23 = within(rowFor(card, 'i23 population')).getByTitle(`Open ${MACAQUE.name}, i23 population, in the explorer`);
    expect(i23).toHaveAttribute('href', '#/dataset/macaque_snrna/i23');
    fireEvent.click(i23);
    expect(onOpenDataset).toHaveBeenLastCalledWith('macaque_snrna', 'i23');
  });

  it('leaves a modified click to the browser', async () => {
    const onOpenDataset = vi.fn();
    renderReport(onOpenDataset);
    const card = await findDeCard();
    fireEvent.click(within(rowFor(card, 'e9 population')).getByTitle(/^Open .* in the explorer$/), { ctrlKey: true });
    expect(onOpenDataset).not.toHaveBeenCalled();
  });

  it('omits Open when no navigation handler is wired, keeping Info', async () => {
    renderReport(undefined);
    const card = await findDeCard();
    expect(within(card).queryByTitle(/^Open .* in the explorer$/)).toBeNull();
    expect(within(card).queryByText('Open →')).toBeNull();
    expect(card.querySelectorAll('.report-de-actions a')).toHaveLength(2);
  });

  it('adds the row\'s own track to the shared compare set and opens their comparison from the header', async () => {
    const onCompare = vi.fn();
    renderReport(undefined, onCompare);
    const card = await findDeCard();
    const mouseRow = rowFor(card, 'hypothalamus population');
    fireEvent.click(within(mouseRow).getByRole('button', { name: `Add ${MOUSE.name}, hypothalamus population to compare set` }));
    // The row's track, not the dataset's default track.
    expect(getSnapshot()).toEqual([{ datasetId: MOUSE.id, trackId: 'hypothalamus' }]);
    expect(within(mouseRow).getByRole('button', { name: `Remove ${MOUSE.name}, hypothalamus population from compare set` }))
      .toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(moreButton(card) as HTMLButtonElement);
    fireEvent.click(within(rowFor(card, 'i23 population')).getByRole('button', { name: `Add ${MACAQUE.name}, i23 population to compare set` }));
    expect(getSnapshot()).toEqual([
      { datasetId: MOUSE.id, trackId: 'hypothalamus' },
      { datasetId: MACAQUE.id, trackId: 'i23' },
    ]);
    // Another track of the same dataset is its own column.
    expect(within(rowFor(card, 'e9 population')).getByRole('button', { name: /^Add .* to compare set$/ }))
      .toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Compare set, 2 studies' }));
    fireEvent.click(screen.getByRole('button', { name: /Compare 2/ }));
    expect(onCompare).toHaveBeenCalledWith(getSnapshot());

    fireEvent.click(within(rowFor(card, 'hypothalamus population')).getByRole('button', { name: /^Remove .* from compare set$/ }));
    expect(getSnapshot()).toEqual([{ datasetId: MACAQUE.id, trackId: 'i23' }]);
  });
});

describe('GeneReport — expression and context cards', () => {
  it('shows baseline expression before the table and opens the expression survey from it', async () => {
    const onOpenExpression = vi.fn();
    const { container } = renderReport(undefined, vi.fn(), { onOpenExpression });
    const table = await findDeCard();
    const cards = container.querySelector('.report-gene-cards:not(.report-gene-cards--after)') as HTMLElement;
    const baseline = await waitFor(() => {
      const section = cards.querySelector('[data-section="baseline-expression"]') as HTMLElement;
      expect(within(section).getByText('ARC POMC')).toBeTruthy();
      return section;
    });
    expect(within(baseline).getByText('813')).toBeTruthy();
    expect(summaries.loadBaselineTeaser).toHaveBeenCalledWith('POMC');
    expect(cards.querySelector('[data-slot="single-cell-mouse"]')).toBeTruthy();
    // The atlases resolve to nothing here, so the human column says so once
    // instead of drawing an empty block per atlas.
    const human = cards.querySelector('[data-section="reference-atlases"]') as HTMLElement;
    expect(await within(human).findByText('The reference atlases could not be loaded.')).toBeTruthy();
    expect(human.querySelector('[data-section="single-cell-human"]')).toBeNull();
    expect(summaries.loadReferenceAtlases).toHaveBeenCalledWith('POMC');
    // Expression cards, then the DE section with its study filters inside it.
    const filters = container.querySelector('details.report-filters') as HTMLElement;
    expect(table.contains(filters)).toBe(true);
    expect(precedes(baseline, filters)).toBe(true);
    expect(precedes(baseline, table)).toBe(true);
    expect(precedes(filters, deTables(table)[0])).toBe(true);

    fireEvent.click(within(cards).getByRole('button', { name: 'Open expression survey' }));
    expect(onOpenExpression).toHaveBeenCalledTimes(1);
  });

  it('leaves out the context cards unless both pathway handlers are wired', async () => {
    const { container, unmount } = renderReport(undefined, vi.fn(), { onShowPathway: vi.fn() });
    await findDeCard();
    expect(container.querySelector('[data-cards="context"]')).toBeNull();
    expect(container.querySelector('.report-gene-cards--after')).toBeNull();
    expect(summaries.loadConditionPathways).not.toHaveBeenCalled();
    unmount();

    const bare = renderReport();
    await findDeCard();
    expect(bare.container.querySelector('[data-cards="context"]')).toBeNull();
  });

  it('follows the selected studies in the context cards after the table', async () => {
    const { container } = renderReport(undefined, vi.fn(), { onShowPathway: vi.fn(), onOpenPathway: vi.fn() });
    const table = await findDeCard();
    await waitFor(() => expect(container.querySelector('[data-slot="condition-pathways"]')).toBeTruthy());
    const context = container.querySelector('[data-cards="context"]') as HTMLElement;
    expect(context.closest('.report-gene-cards--after')).toBeTruthy();
    expect(context.querySelector('[data-slot="coexpression"]')).toBeTruthy();
    expect(precedes(table, context)).toBe(true);

    expect(summaries.loadConditionPathways).toHaveBeenCalled();
    const [symbol, studies] = summaries.loadConditionPathways.mock.lastCall as [string, Dataset[]];
    expect(symbol).toBe('POMC');
    expect(studies.map((d) => d.id)).toEqual(expect.arrayContaining([MACAQUE.id, MOUSE.id]));
  });
});

describe('GeneReport — table expression preview', () => {
  beforeEach(() => {
    // No bundle is reachable: the preview opens and reports that, without the network.
    _resetBundleCache();
    _resetTrackCache();
    _setBundleTransport(async () => ({ status: 'load-failed' }));
    return () => { _setBundleTransport(null); _resetBundleCache(); _resetTrackCache(); };
  });

  function previewTrigger(row: HTMLElement): HTMLButtonElement {
    return within(row).getByRole('button', { name: /^Preview POMC expression in / }) as HTMLButtonElement;
  }

  it('wraps each row\'s change in the preview trigger and opens it on focus', async () => {
    renderReport();
    const card = await findDeCard();
    const row = rowFor(card, 'hypothalamus population');
    const trigger = previewTrigger(row);
    expect(trigger).toHaveClass('report-effect-trigger');
    expect(trigger).toHaveAccessibleName(`Preview POMC expression in ${MOUSE.name}, hypothalamus population; log2 fold change +0.80`);
    // The Change cell: the fold phrase and the log2FC both sit inside the trigger.
    expect(trigger.closest('td')).toBe(row.cells[3]);
    expect(trigger.querySelector('.report-de-phrase')).toHaveTextContent(expectedPhrase(0.8, MOUSE_CONTRAST.caseGroup.label));
    expect(trigger.querySelector('.report-de-fc')).toHaveTextContent('log2FC +0.80');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.focus(trigger);
    const preview = await screen.findByRole('region', { name: 'POMC expression preview' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(within(preview).getByText(MOUSE.name)).toBeTruthy();
    expect(within(preview).getByText('hypothalamus population')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'POMC expression preview' })).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on hover from a row of the full list and closes on Escape', async () => {
    renderReport();
    const card = await findDeCard();
    fireEvent.click(moreButton(card) as HTMLButtonElement);
    const trigger = previewTrigger(rowFor(card, 'i23 population'));
    fireEvent.mouseEnter(trigger);
    const preview = await screen.findByRole('region', { name: 'POMC expression preview' });
    expect(within(preview).getByText(MACAQUE.name)).toBeTruthy();
    expect(within(preview).getByText('i23 population')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'POMC expression preview' })).toBeNull();
  });
});
