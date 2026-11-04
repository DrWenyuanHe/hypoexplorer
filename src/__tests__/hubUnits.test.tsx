import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import { LandingHub } from '../hub/LandingHub';
import { listDatasets } from '../data/datasets';

// The box itself is covered by unifiedSearchBox.test.tsx; here the hub's own
// wiring: one box, no mode switch, submitting to onSearch, and no vocabulary
// fetched before the visitor starts a search.
const { useSearchVocabulary, searchAll } = vi.hoisted(() => ({
  useSearchVocabulary: vi.fn(), searchAll: vi.fn(),
}));
vi.mock('../search/useSearchVocabulary', () => ({ useSearchVocabulary }));
vi.mock('../search/searchVocabulary', () => ({
  searchAll,
  geneMatchLabel: () => '',
  describePathway: () => ({ db: 'OTHER', dbLabel: '', title: '' }),
  loadSearchVocabulary: () => Promise.resolve({ genes: [], pathways: [] }),
}));

beforeEach(() => {
  useSearchVocabulary.mockReset().mockImplementation((enabled = true) => (enabled ? { genes: [], pathways: [] } : null));
  searchAll.mockReset().mockImplementation((_v: unknown, query: string) => ({
    query,
    genes: query.toLowerCase().startsWith('pom')
      ? [{ entry: { symbol: 'POMC', name: 'pro-opiomelanocortin-alpha', otherNames: [], aliases: [], datasets: 40 }, match: 'symbol-prefix', matchedText: 'POMC', score: 1 }]
      : [],
    pathways: [],
    best: null,
  }));
});

const handlers = () => ({
  onEnterTool: vi.fn(),
  onOpenSearch: vi.fn(),
  onSearch: vi.fn(),
  onOpenExpression: vi.fn(),
  onOpenTracker: vi.fn(),
  onOpenLocalDatasets: vi.fn(),
  onOpenLibrary: vi.fn(),
  onOpenStatistics: vi.fn(),
  onOpenMethodology: vi.fn(),
  onOpenNomenclature: vi.fn(),
  onChangelog: vi.fn(),
  onCompareSet: vi.fn(),
});

function renderHub(over: Partial<ReturnType<typeof handlers>> = {}) {
  const h = { ...handlers(), ...over };
  const view = render(<LandingHub datasets={listDatasets()} {...h} />);
  const form = screen.getByRole('search', { name: 'Search genes and pathways' });
  return { h, form, view };
}

const searchBox = (form: HTMLElement) => within(form).getByRole('combobox', { name: 'Search genes and pathways across all studies' });

// ─── The search box ──────────────────────────────────────────────────────────
describe('hub search box', () => {
  it('submits a typed term, as typed, to the unified results page', () => {
    const { h, form } = renderHub();
    fireEvent.change(searchBox(form), { target: { value: '  oxytocin ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Search' }));
    expect(h.onSearch).toHaveBeenCalledWith('oxytocin');
    expect(h.onOpenSearch).not.toHaveBeenCalled();
  });

  it('does nothing with an empty term', () => {
    const { h, form } = renderHub();
    fireEvent.change(searchBox(form), { target: { value: '   ' } });
    fireEvent.submit(form);
    expect(h.onSearch).not.toHaveBeenCalled();
    expect(h.onOpenSearch).not.toHaveBeenCalled();
  });

  it('has one box for genes and pathways: no mode switch and no filter button', () => {
    const { form } = renderHub();
    expect(within(form).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Search']);
    expect(within(form).getByTitle('Press / to search')).toBeTruthy();
  });

  it('fetches no vocabulary until the box is focused', () => {
    const { form } = renderHub();
    expect(useSearchVocabulary.mock.calls.every(([enabled]) => enabled === false)).toBe(true);
    fireEvent.focus(searchBox(form));
    expect(useSearchVocabulary).toHaveBeenLastCalledWith(true);
  });

  it('submits a picked suggestion by its symbol', () => {
    const { h, form } = renderHub();
    const box = searchBox(form);
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'pom' } });
    const genes = within(form).getByRole('group', { name: 'Genes' });
    fireEvent.click(within(genes).getByRole('option'));
    expect(h.onSearch).toHaveBeenCalledWith('POMC');
  });
});

// ─── Cards, nav and footer ───────────────────────────────────────────────────
describe('hub routes', () => {
  it('opens the whole library and the expression survey from the two cards', () => {
    const { h } = renderHub();
    fireEvent.click(screen.getByRole('button', { name: /^Browse the dataset library/ }));
    expect(h.onOpenLibrary).toHaveBeenCalledTimes(1);
    // No argument: the card browses the whole corpus. A category array here
    // would silently open a filtered library.
    expect(h.onOpenLibrary.mock.calls[0][0]).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: /^Survey baseline expression/ }));
    expect(h.onOpenExpression).toHaveBeenCalledTimes(1);
  });

  it('opens each side of the search dialog from the section nav', () => {
    const { h } = renderHub();
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Genes' }));
    expect(h.onOpenSearch).toHaveBeenLastCalledWith('gene');
    fireEvent.click(within(nav).getByRole('button', { name: 'Pathways' }));
    expect(h.onOpenSearch).toHaveBeenLastCalledWith('pathway');
    fireEvent.click(within(nav).getByRole('button', { name: 'Methods' }));
    expect(h.onOpenMethodology).toHaveBeenCalledTimes(1);
    expect(h.onEnterTool).not.toHaveBeenCalled();
  });

  it('carries the compare-set indicator, counted in words', () => {
    renderHub();
    expect(screen.getByRole('button', { name: 'Compare set, 0 studies' })).toBeTruthy();
  });

  it('counts studies and species off the registry rather than hard-coded figures', () => {
    renderHub();
    const datasets = listDatasets();
    const species = new Set(datasets.map((d) => d.organism)).size;
    expect(document.querySelector('.hub-foot-corpus')?.textContent).toBe(`${datasets.length} studies · ${species} species`);
  });

  it('keeps a footer route to every supporting tool and reference page', () => {
    const { h } = renderHub();
    const nav = screen.getByRole('navigation', { name: 'Reference' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Local datasets' }));
    expect(h.onOpenLocalDatasets).toHaveBeenCalledTimes(1);
    fireEvent.click(within(nav).getByRole('button', { name: 'Dataset tracker' }));
    expect(h.onOpenTracker).toHaveBeenCalledTimes(1);
    for (const href of ['/studies/', '/topics/', '/methods/', '/how-to-cite/', '/about/']) {
      expect(nav.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Changelog' }));
    expect(h.onChangelog).toHaveBeenCalledTimes(1);
  });
});
