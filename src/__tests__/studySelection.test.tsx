// Study selection at its interface (crossdataset/studySelection.ts and studySelectionLink.ts): the value,
// its derivation for each report kind, and its URL form. The App-level scope
// tests keep one smoke per report; the rules live here.
import { useState } from 'react';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registryCards, type DatasetCatalog } from '../data/datasetCatalog';
import * as catalogModule from '../data/datasetCatalog';
import { DATASET_CATEGORIES } from '../data/datasetCategories';
import { datasetQuality } from '../data/datasetQualityR460';
import { useReportQuery } from '../crossdataset/forestReport';
import { useStudySelection, type StudyQuery, type StudySelectionState } from '../crossdataset/studySelection';
import {
  DEFAULT_STUDY_FILTERS, DEFAULT_STUDY_SELECTION, selectionFromLink, selectionLink,
  type StudySelection, type StudySelectionKind,
} from '../crossdataset/studySelectionLink';
import { STUDY_CATEGORY_CARDS, StudySelectionPanel } from '../crossdataset/StudySelectionPanel';
import { parseRoute, routeHref, type AppRoute } from '../utils/appLinks';
import type { ChartScale } from '../utils/chartScale';

const { loadCatalog } = vi.hoisted(() => ({ loadCatalog: vi.fn() }));
vi.mock('../data/datasetCatalog', async (original) => ({
  ...await original<typeof import('../data/datasetCatalog')>(), loadDatasetCatalog: loadCatalog,
}));
vi.mock('../data/datasetQualityR460', async (original) => ({
  ...await original<typeof import('../data/datasetQualityR460')>(), datasetQuality: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const KINDS = ['gene', 'pathway'] as const;
const cards = registryCards();
const kindCards = (kind: StudySelectionKind) => cards.filter((card) => kind !== 'pathway' || card.dataset.supportsPathways);
// A study every kind can query, and its category.
const chosen = cards.find((card) => card.dataset.supportsPathways)!.dataset;
const idsOf = (datasets: readonly { id: string }[]) => datasets.map((dataset) => dataset.id);
const assessment = (status: 'pass' | 'fail' | 'review' | 'not_assessed' | 'not_applicable') =>
  ({ status, policyVersion: '', scope: '', checks: [] });
const passing = () => ({
  internalQc: assessment('pass'), pipelineQc: assessment('pass'),
  experimentalDesign: assessment('pass'), authorConcordance: assessment('pass'),
});

/** The hook over state held OUTSIDE it, as the router holds it. */
function renderSelection(kind: StudySelectionKind, { term = 'Pomc', initial = DEFAULT_STUDY_SELECTION } = {}) {
  return renderHook((props: { term: string; initial: StudySelection }) => {
    const [value, onChange] = useState(props.initial);
    return useStudySelection({ kind, term: props.term, value, onChange });
  }, { initialProps: { term, initial } });
}

beforeEach(() => {
  loadCatalog.mockReset().mockReturnValue(new Promise<DatasetCatalog>(() => {}));
  vi.mocked(datasetQuality).mockReset().mockReturnValue(passing());
});

afterEach(() => { vi.restoreAllMocks(); });

describe.each(KINDS)('study selection for the %s report', (kind) => {
  it('starts from registry cards and queries registry datasets without waiting when counts are not needed', () => {
    const { result } = renderSelection(kind);
    const expected = kindCards(kind).map((card) => card.dataset);
    expect(result.current.selectedDatasets).toEqual(expected);
    expect(result.current.awaitingCounts).toBe(false);
    expect(result.current.query).toEqual({ term: 'Pomc', datasets: expected });
  });

  it('gates on delayed counts, then requires the minimum in both arms', async () => {
    const catalog = deferred<DatasetCatalog>();
    loadCatalog.mockReturnValue(catalog.promise);
    const first = cards.findIndex((card) => card.dataset.id === chosen.id);
    const measured = cards.map((card, index) => ({ ...card,
      nBaseline: index === first ? 5 : index === first + 1 ? 20 : index === first + 2 ? 4 : null,
      nCase: index === first ? 8 : index === first + 1 ? 4 : 20,
    }));
    const { result } = renderSelection(kind, { initial: { ...DEFAULT_STUDY_SELECTION, filters: { minSamples: 5, requiredChecks: [] } } });
    expect(result.current.awaitingCounts).toBe(true);
    expect(result.current.query).toBeNull();
    await act(async () => { catalog.resolve({ cards: measured, state: 'complete' }); });
    expect(result.current.awaitingCounts).toBe(false);
    expect(idsOf(result.current.selectedDatasets)).toEqual([chosen.id]);
    expect(idsOf(result.current.query!.datasets)).toEqual([chosen.id]);
  });

  it('settles a registry-only catalog without treating unknown counts as sufficient', async () => {
    const catalog = deferred<DatasetCatalog>();
    loadCatalog.mockReturnValue(catalog.promise);
    const { result } = renderSelection(kind, { initial: { ...DEFAULT_STUDY_SELECTION, filters: { minSamples: 5, requiredChecks: [] } } });
    await act(async () => { catalog.resolve({ cards, state: 'registry-only' }); });
    expect(result.current.awaitingCounts).toBe(false);
    expect(result.current.selectedDatasets).toEqual([]);
    expect(result.current.query).toEqual({ term: 'Pomc', datasets: [] });
  });

  it('combines categories with individual studies, and is idle without a term', () => {
    const { result, rerender } = renderSelection(kind);
    act(() => result.current.toggleCategory(chosen.category));
    expect(result.current.value.categories).toEqual([chosen.category]);
    expect(result.current.availableDatasets.every((dataset) => dataset.category === chosen.category)).toBe(true);
    act(() => result.current.setDatasetIds([chosen.id]));
    expect(idsOf(result.current.selectedDatasets)).toEqual([chosen.id]);
    rerender({ term: '', initial: DEFAULT_STUDY_SELECTION });
    expect(result.current.query).toBeNull();
  });

  it('never widens an explicitly empty individual selection', () => {
    const { result } = renderSelection(kind);
    act(() => result.current.setDatasetIds([]));
    expect(result.current.value.datasetIds).toEqual([]);
    expect(result.current.selectedDatasets).toEqual([]);
    expect(result.current.query).toEqual({ term: 'Pomc', datasets: [] });
    // Nor does a link whose studies have all left the registry.
    expect(selectionFromLink({ analysis: { version: 1, datasetIds: ['removed-study'], categories: null, filters: DEFAULT_STUDY_FILTERS } }).datasetIds)
      .toEqual([]);
  });

  it('widens back to all categories when the last one is unticked', () => {
    const { result } = renderSelection(kind);
    const [a, b] = DATASET_CATEGORIES;
    act(() => result.current.toggleCategory(a));
    act(() => result.current.toggleCategory(b));
    expect(result.current.value.categories).toEqual([a, b]);
    expect([...result.current.activeCategories!]).toEqual([a, b]);
    act(() => result.current.toggleCategory(a));
    act(() => result.current.toggleCategory(b));
    expect(result.current.value.categories).toBeNull();
    expect(result.current.activeCategories).toBeNull();
  });

  it('composes individual-study updates made in one batch', () => {
    const { result } = renderSelection(kind);
    const [x, y] = idsOf(result.current.availableDatasets);
    act(() => {
      result.current.setDatasetIds([]);
      result.current.setDatasetIds((prev) => [...(prev ?? []), x]);
      result.current.setDatasetIds((prev) => [...(prev ?? []), y]);
    });
    expect(result.current.value.datasetIds).toEqual([x, y]);
  });

  it('requires an explicit pass in every selected evidence domain', () => {
    const { result } = renderSelection(kind, { initial: { ...DEFAULT_STUDY_SELECTION, datasetIds: [chosen.id] } });
    const domains = ['pipelineQc', 'experimentalDesign', 'authorConcordance'] as const;
    for (const domain of domains) {
      for (const status of ['fail', 'review', 'not_assessed', 'not_applicable'] as const) {
        vi.mocked(datasetQuality).mockReturnValue({ ...passing(), [domain]: assessment(status) });
        act(() => result.current.setFilters({ minSamples: 0, requiredChecks: [domain] }));
        expect(result.current.selectedDatasets).toEqual([]);
        act(() => result.current.setFilters({ minSamples: 0, requiredChecks: domains.filter((key) => key !== domain) }));
        expect(idsOf(result.current.selectedDatasets)).toEqual([chosen.id]);
        act(() => result.current.setFilters({ minSamples: 0, requiredChecks: [...domains] }));
        expect(result.current.selectedDatasets).toEqual([]);
      }
    }
    vi.mocked(datasetQuality).mockReturnValue(passing());
    act(() => result.current.setFilters({ minSamples: 0, requiredChecks: [...domains] }));
    expect(idsOf(result.current.selectedDatasets)).toEqual([chosen.id]);
  });

  it('resets categories, filters and individual selection together', () => {
    const { result } = renderSelection(kind, { initial: {
      categories: [chosen.category], datasetIds: [], filters: { minSamples: 5, requiredChecks: ['pipelineQc'] },
    } });
    expect(result.current.awaitingCounts).toBe(true);
    act(() => result.current.reset());
    expect(result.current.value).toEqual(DEFAULT_STUDY_SELECTION);
    expect(result.current.awaitingCounts).toBe(false);
    expect(result.current.selectedDatasets).toEqual(kindCards(kind).map((card) => card.dataset));
  });

  it('keeps the selection across a term remount, because it holds no copy of its own', () => {
    const first = renderSelection(kind);
    act(() => first.result.current.toggleCategory(chosen.category));
    act(() => first.result.current.setFilters({ minSamples: 0, requiredChecks: ['pipelineQc'] }));
    act(() => first.result.current.setDatasetIds([chosen.id]));
    const kept = first.result.current.value;
    first.unmount();
    // The report remounts per term; the router hands the same value back.
    const next = renderSelection(kind, { term: 'Agrp', initial: kept });
    expect(next.result.current.value).toBe(kept);
    expect(next.result.current.query).toEqual({ term: 'Agrp', datasets: first.result.current.query!.datasets });
  });

  it('keeps one query identity while the term and selected studies are unchanged', async () => {
    const catalog = deferred<DatasetCatalog>();
    loadCatalog.mockReturnValue(catalog.promise);
    const { result } = renderSelection(kind);
    const before = result.current.query;
    // The catalog settles to the same studies as different card objects.
    await act(async () => { catalog.resolve({ cards: cards.map((card) => ({ ...card })), state: 'complete' }); });
    expect(result.current.query).toBe(before);
  });

  it('shows only result groups in the selection, in their own order', () => {
    const { result } = renderSelection(kind);
    const groups = [...kindCards(kind)].reverse().map((card) => ({ dataset: card.dataset }));
    expect(result.current.visibleGroups(groups)).toEqual(groups);
    act(() => result.current.toggleCategory(chosen.category));
    expect(result.current.visibleGroups(groups).every((group) => group.dataset.category === chosen.category)).toBe(true);
    act(() => result.current.setDatasetIds([chosen.id]));
    expect(result.current.visibleGroups(groups)).toEqual([{ dataset: chosen }]);
    expect(result.current.visibleGroups([{ dataset: { id: 'not-registered' } }])).toEqual([]);
  });

  it('does not let an old catalog load replace a newly mounted selection', async () => {
    const oldCatalog = deferred<DatasetCatalog>();
    const currentCatalog = deferred<DatasetCatalog>();
    loadCatalog.mockReturnValueOnce(oldCatalog.promise).mockReturnValueOnce(currentCatalog.promise);
    const initial = { ...DEFAULT_STUDY_SELECTION, filters: { minSamples: 5, requiredChecks: [] } };
    renderSelection(kind, { initial }).unmount();
    const { result } = renderSelection(kind, { initial });
    await act(async () => { oldCatalog.resolve({ cards: [], state: 'registry-only' }); });
    expect(result.current.awaitingCounts).toBe(true);
    const card = cards.find((item) => item.dataset.id === chosen.id)!;
    await act(async () => { currentCatalog.resolve({ cards: [{ ...card, nBaseline: 5, nCase: 5 }], state: 'complete' }); });
    expect(idsOf(result.current.selectedDatasets)).toEqual([chosen.id]);
  });

  it('lets the report-query seam discard results and progress for a superseded selection', async () => {
    const pending: Array<{ done: ReturnType<typeof deferred<string>>; progress: (loaded: number, total: number) => void }> = [];
    const load = vi.fn((_request: StudyQuery, { onProgress }: { onProgress: (loaded: number, total: number) => void }) => {
      const done = deferred<string>();
      pending.push({ done, progress: onProgress });
      return done.promise;
    });
    const { result, rerender } = renderHook((props: { term: string }) => {
      const [value, onChange] = useState(DEFAULT_STUDY_SELECTION);
      const selection = useStudySelection({ kind, term: props.term, value, onChange });
      return { selection, report: useReportQuery(selection.query, load, 'Failed') };
    }, { initialProps: { term: 'Pomc' } });
    expect(load).toHaveBeenCalledTimes(1);
    act(() => result.current.selection.setDatasetIds([chosen.id]));
    expect(load).toHaveBeenCalledTimes(2);
    expect(idsOf(load.mock.lastCall![0].datasets)).toEqual([chosen.id]);
    act(() => { pending[1].progress(1, 2); pending[0].progress(100, 100); });
    expect(result.current.report.progress).toEqual({ loaded: 1, total: 2 });
    await act(async () => { pending[1].done.resolve('selected study'); });
    await act(async () => { pending[0].done.resolve('old whole corpus'); });
    expect(result.current.report.result).toBe('selected study');
    expect(result.current.report.loading).toBe(false);
    rerender({ term: '' });
    await waitFor(() => expect(result.current.report.result).toBeNull());
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('study selection for the pathway report only', () => {
  it('excludes studies without pathways before and after catalog settlement', async () => {
    const catalog = deferred<DatasetCatalog>();
    loadCatalog.mockReturnValue(catalog.promise);
    const mixed = cards.map((card) => card.dataset.id === chosen.id
      ? { ...card, dataset: { ...card.dataset, supportsPathways: false } } : card);
    vi.spyOn(catalogModule, 'registryCards').mockReturnValue(mixed);
    const supported = mixed.filter((card) => card.dataset.supportsPathways);
    const { result } = renderSelection('pathway');
    expect(result.current.cards).toEqual(supported);
    await act(async () => { catalog.resolve({ cards: mixed, state: 'complete' }); });
    expect(result.current.cards).toEqual(supported);
    expect(idsOf(result.current.selectedDatasets)).toEqual(supported.map((card) => card.dataset.id));
    expect(idsOf(result.current.query!.datasets)).not.toContain(chosen.id);
  });
});

// ── URL form ─────────────────────────────────────────────────────────────────

function reportHref(kind: StudySelectionKind, selection: StudySelection, chartScale: ChartScale = 'native'): string {
  return kind === 'gene'
    ? routeHref({ view: 'report', gene: 'POMC', scope: null, ...selectionLink('gene', selection, chartScale) })
    : routeHref({ view: 'pathway-report', pathway: 'HALLMARK_HYPOXIA', ...selectionLink('pathway', selection, chartScale) });
}

function reportRoute(href: string): Extract<AppRoute, { view: 'report' | 'pathway-report' }> {
  const route = parseRoute(href);
  if (route?.view !== 'report' && route?.view !== 'pathway-report') throw new Error(`not a report link: ${href}`);
  return route;
}

describe('study selection URL form', () => {
  const restricted: StudySelection = {
    categories: [chosen.category], datasetIds: [chosen.id], filters: { minSamples: 5, requiredChecks: ['pipelineQc'] },
  };

  it('writes the version-1 snapshot bytes the gene and pathway links have always had', () => {
    const snapshot = encodeURIComponent(JSON.stringify({
      version: 1, datasetIds: [chosen.id], categories: [chosen.category],
      filters: { minSamples: 5, requiredChecks: ['pipelineQc'] }, chartScale: 'native',
    }));
    expect(reportHref('gene', restricted)).toBe(`#/gene/POMC/${encodeURIComponent(chosen.category)}?analysis=${snapshot}`);
    expect(reportHref('pathway', restricted)).toBe(`#/pathway/HALLMARK_HYPOXIA?analysis=${snapshot}`);
  });

  it('keeps unrestricted links short; gene categories live in the path alone', () => {
    expect(reportHref('gene', DEFAULT_STUDY_SELECTION)).toBe('#/gene/POMC');
    expect(reportHref('pathway', DEFAULT_STUDY_SELECTION)).toBe('#/pathway/HALLMARK_HYPOXIA');
    const categories = { ...DEFAULT_STUDY_SELECTION, categories: ['Aging', 'Circadian'] as StudySelection['categories'] };
    expect(reportHref('gene', categories)).toBe('#/gene/POMC/Aging,Circadian');
    expect(reportHref('pathway', categories)).toMatch(/^#\/pathway\/HALLMARK_HYPOXIA\?analysis=/);
    // A chart scale other than native always needs the snapshot.
    expect(reportHref('gene', DEFAULT_STUDY_SELECTION, 'log2')).toMatch(/^#\/gene\/POMC\?analysis=.*%22chartScale%22%3A%22log2%22/);
  });

  it.each(KINDS)('restores a %s selection from its own link, byte for byte', (kind) => {
    const selections: StudySelection[] = [
      DEFAULT_STUDY_SELECTION,
      restricted,
      { ...DEFAULT_STUDY_SELECTION, datasetIds: [] },
      { ...DEFAULT_STUDY_SELECTION, categories: ['Aging'] },
      { ...DEFAULT_STUDY_SELECTION, filters: { minSamples: 5, requiredChecks: ['experimentalDesign', 'authorConcordance'] } },
    ];
    for (const selection of selections) {
      for (const scale of ['native', 'log2'] as const) {
        const href = reportHref(kind, selection, scale);
        const restored = selectionFromLink(reportRoute(href));
        expect(restored).toEqual(selection);
        expect(reportHref(kind, restored, scale)).toBe(href);
      }
    }
  });

  it('reads a snapshot whatever its key order', () => {
    // The previous landing rewrote links with chartScale second.
    const json = `{"version":1,"chartScale":"native","datasetIds":["${chosen.id}"],"categories":null,"filters":{"minSamples":0,"requiredChecks":[]}}`;
    const route = reportRoute(`#/gene/POMC?analysis=${encodeURIComponent(json)}`);
    expect(selectionFromLink(route)).toEqual({ ...DEFAULT_STUDY_SELECTION, datasetIds: [chosen.id] });
  });

  it('lets a gene link\'s path scope fill in only when the snapshot leaves categories open', () => {
    const analysis = { version: 1 as const, datasetIds: null, categories: null, filters: DEFAULT_STUDY_FILTERS, chartScale: 'log2' as const };
    expect(selectionFromLink({ scope: ['Aging'], analysis }).categories).toEqual(['Aging']);
    expect(selectionFromLink({ scope: ['Aging'], analysis: { ...analysis, categories: ['Circadian'] } }).categories).toEqual(['Circadian']);
    expect(selectionFromLink({ scope: ['Aging'] })).toEqual({ ...DEFAULT_STUDY_SELECTION, categories: ['Aging'] });
    expect(selectionFromLink({})).toEqual(DEFAULT_STUDY_SELECTION);
  });
});

// ── The panel both reports render ────────────────────────────────────────────

function Panel({ kind }: { kind: StudySelectionKind }) {
  const [value, onChange] = useState(DEFAULT_STUDY_SELECTION);
  const selection: StudySelectionState = useStudySelection({ kind, term: 'Pomc', value, onChange });
  return <StudySelectionPanel selection={selection} />;
}

describe('StudySelectionPanel', () => {
  it('offers every category once', () => {
    expect(STUDY_CATEGORY_CARDS.map((item) => item.category)).toEqual(DATASET_CATEGORIES);
  });

  it.each([
    ['gene', `${cards.length} of ${cards.length} datasets selected`],
    ['pathway', `${kindCards('pathway').length} of ${kindCards('pathway').length} pathway-capable datasets selected`],
  ] as const)('counts the %s report\'s studies in its own words', (kind, status) => {
    const { container } = render(<Panel kind={kind} />);
    const details = container.querySelector('details.report-filters') as HTMLElement;
    expect(within(details).getByRole('status')).toHaveTextContent(status);
    act(() => { within(details).getByRole('button', { name: /^Larger groups / }).click(); });
    expect(screen.getByText(/Unknown counts are excluded/)).toBeInTheDocument();
    expect(within(details).getByRole('status')).toHaveTextContent('Loading sample counts…');
  });
});
