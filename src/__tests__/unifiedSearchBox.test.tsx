import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import { UnifiedSearchBox } from '../search/UnifiedSearchBox';
import type { GeneHit, PathwayHit, SearchResults, SearchVocabulary } from '../search/searchTypes';

// The box is tested against the vocabulary module's contract, not its ranking:
// searchAll is a fixture keyed by query, and the hook reports whether the box
// has asked for the vocabulary yet.
const VOCAB: SearchVocabulary = { genes: [], pathways: [] };

const gene = (symbol: string, name: string, match: GeneHit['match'], matchedText = ''): GeneHit => ({
  entry: { symbol, name, otherNames: [], aliases: [], datasets: 3 },
  match, matchedText, score: 1,
});
const pathway = (id: string, title: string, db: PathwayHit['db'], dbLabel: string): PathwayHit => ({ id, db, dbLabel, title, score: 1 });

const INSULIN: SearchResults = {
  query: 'insulin',
  genes: [gene('INS', 'insulin', 'name', 'insulin'), gene('INSR', 'insulin receptor', 'name-prefix', 'insulin receptor')],
  pathways: [
    pathway('GOBP_INSULIN_SECRETION', 'Insulin secretion', 'GO_BP', 'GO BP'),
    pathway('REACTOME_INSULIN_RECEPTOR_SIGNALLING_CASCADE', 'Insulin receptor signalling cascade', 'REACTOME', 'Reactome'),
  ],
  best: null,
};

const { searchAll, useSearchVocabulary } = vi.hoisted(() => ({
  searchAll: vi.fn(),
  useSearchVocabulary: vi.fn(),
}));
vi.mock('../search/searchVocabulary', () => ({
  searchAll,
  geneMatchLabel: (hit: GeneHit) => (hit.match === 'name' ? 'Gene name' : hit.match === 'alias' ? `Alias “${hit.matchedText}”` : 'Name starts with'),
  describePathway: () => ({ db: 'OTHER', dbLabel: '', title: '' }),
  loadSearchVocabulary: () => Promise.resolve(VOCAB),
}));
vi.mock('../search/useSearchVocabulary', () => ({ useSearchVocabulary }));

beforeEach(() => {
  useSearchVocabulary.mockReset().mockImplementation((enabled = true) => (enabled ? VOCAB : null));
  searchAll.mockReset().mockImplementation((_vocab: SearchVocabulary, query: string): SearchResults => (
    query.trim().toLowerCase().startsWith('ins') ? { ...INSULIN, query } : { query, genes: [], pathways: [], best: null }
  ));
});

function renderBox(props: Partial<Parameters<typeof UnifiedSearchBox>[0]> = {}) {
  const onSearch = vi.fn();
  render(<UnifiedSearchBox variant="hub" onSearch={onSearch} {...props} />);
  const form = screen.getByRole('search', { name: 'Search genes and pathways' });
  const box = within(form).getByRole('combobox', { name: 'Search genes and pathways across all studies' });
  return { onSearch, form, box };
}

function typeInto(box: HTMLElement, value: string) {
  fireEvent.focus(box);
  fireEvent.change(box, { target: { value } });
}

describe('UnifiedSearchBox', () => {
  it('suggests genes and pathways together, in two labelled groups', () => {
    const { form, box } = renderBox();
    typeInto(box, 'insulin');
    const list = within(form).getByRole('listbox', { name: 'Search suggestions' });
    const genes = within(list).getByRole('group', { name: 'Genes' });
    const pathways = within(list).getByRole('group', { name: 'Pathways' });
    expect(within(genes).getAllByRole('option')).toHaveLength(2);
    expect(within(pathways).getAllByRole('option').map((o) => o.querySelector('.ptitle')?.textContent))
      .toEqual(['Insulin secretion', 'Insulin receptor signalling cascade']);
    expect(within(pathways).getByText('Reactome')).toBeTruthy();
    expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(searchAll).toHaveBeenLastCalledWith(VOCAB, 'insulin', { geneLimit: 6, pathwayLimit: 6 });
  });

  it('says how a gene matched unless it matched by symbol', () => {
    searchAll.mockImplementation((_v: SearchVocabulary, query: string) => ({
      query, genes: [gene('OXT', 'oxytocin', 'name', 'oxytocin'), gene('OXTR', 'oxytocin receptor', 'symbol-prefix')], pathways: [], best: null,
    }));
    const { form, box } = renderBox();
    typeInto(box, 'oxt');
    const [oxt, oxtr] = within(form).getAllByRole('option');
    expect(oxt.textContent).toContain('Gene name');
    expect(oxtr.querySelector('.why')).toBeNull();
  });

  it('cycles the arrow keys across both groups and back to the typed text', () => {
    const { form, box } = renderBox();
    typeInto(box, 'insulin');
    const options = within(form).getAllByRole('option');
    for (let i = 0; i < 3; i++) fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(options[2]).toHaveAttribute('aria-selected', 'true');
    expect(box).toHaveAttribute('aria-activedescendant', options[2].id);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    // Past the last pathway: back to the typed text.
    expect(box).not.toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(box).toHaveAttribute('aria-activedescendant', options[3].id);
  });

  it('opens a picked gene by its symbol', () => {
    const { onSearch, form, box } = renderBox();
    typeInto(box, 'insulin');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.submit(form);
    expect(onSearch).toHaveBeenCalledWith('INS');
    expect(box).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens a picked pathway by its id', () => {
    const { onSearch, form, box } = renderBox();
    typeInto(box, 'insulin');
    const list = within(form).getByRole('listbox');
    fireEvent.click(within(within(list).getByRole('group', { name: 'Pathways' })).getAllByRole('option')[0]);
    expect(onSearch).toHaveBeenCalledWith('GOBP_INSULIN_SECRETION');
  });

  it('submits typed text trimmed, in the case it was typed', () => {
    const { onSearch, form, box } = renderBox();
    typeInto(box, '  Insulin Secretion ');
    fireEvent.click(within(form).getByRole('button', { name: 'Search' }));
    expect(onSearch).toHaveBeenCalledWith('Insulin Secretion');
  });

  it('focuses the field instead of searching for nothing', () => {
    const { onSearch, form, box } = renderBox();
    fireEvent.change(box, { target: { value: '   ' } });
    box.blur();
    fireEvent.submit(form);
    expect(onSearch).not.toHaveBeenCalled();
    expect(box).toHaveFocus();
  });

  it('closes the list on Escape and reopens it on typing', () => {
    const { form, box } = renderBox();
    typeInto(box, 'insulin');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box).toHaveAttribute('aria-expanded', 'false');
    fireEvent.change(box, { target: { value: 'insuli' } });
    expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(within(form).getAllByRole('option')).toHaveLength(4);
  });

  it('keeps the list open when the surface around the field is pressed', () => {
    const { form, box } = renderBox();
    box.focus();
    typeInto(box, 'insulin');
    const label = within(form).getByRole('listbox').querySelector('.hub-search-group-label') as HTMLElement;
    // A cancelled mousedown keeps focus in the field, so blur never closes the list.
    expect(fireEvent.mouseDown(label)).toBe(false);
    expect(fireEvent.mouseDown(within(form).getByRole('button', { name: 'Search' }))).toBe(false);
    expect(box).toHaveFocus();
    expect(fireEvent.mouseDown(box)).toBe(true);
  });

  it('reopens the list when the focused field is clicked after Escape', () => {
    const { box } = renderBox();
    typeInto(box, 'insulin');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box).toHaveAttribute('aria-expanded', 'false');
    fireEvent.mouseDown(box);
    expect(box).toHaveAttribute('aria-expanded', 'true');
  });

  it('clears the field and keeps focus there', () => {
    const { form, box } = renderBox();
    expect(within(form).queryByRole('button', { name: 'Clear search' })).toBeNull();
    typeInto(box, 'insulin');
    fireEvent.click(within(form).getByRole('button', { name: 'Clear search' }));
    expect(box).toHaveValue('');
    expect(box).toHaveFocus();
    expect(box).toHaveAttribute('aria-expanded', 'false');
  });

  it('sets the typed part of a symbol apart from its completion', () => {
    searchAll.mockImplementation((_v: SearchVocabulary, query: string) => ({
      query, genes: [gene('POMC', 'proopiomelanocortin', 'symbol'), gene('POMCA', 'proopiomelanocortin a', 'symbol-prefix')], pathways: [], best: null,
    }));
    const { form, box } = renderBox();
    typeInto(box, 'pomc');
    const [pomc, pomca] = within(form).getAllByRole('option').map((o) => o.querySelector('.sym') as HTMLElement);
    expect(pomca.querySelector('.typed')?.textContent).toBe('POMC');
    expect(pomca.textContent).toBe('POMCA');
    expect(pomc.querySelector('.typed')?.textContent).toBe('POMC');
  });

  it('asks for the vocabulary on the hub only once the field is focused', () => {
    const { box } = renderBox();
    expect(useSearchVocabulary).toHaveBeenCalled();
    expect(useSearchVocabulary.mock.calls.every(([enabled]) => enabled === false)).toBe(true);
    fireEvent.focus(box);
    expect(useSearchVocabulary).toHaveBeenLastCalledWith(true);
  });

  it('loads the vocabulary at once on the results page, prefilled with the query', () => {
    const { box } = renderBox({ variant: 'page', initialQuery: 'oxytocin' });
    expect(useSearchVocabulary.mock.calls[0][0]).toBe(true);
    expect(box).toHaveValue('oxytocin');
    expect(screen.queryByText(/to search/)).toBeNull();
  });

  it('jumps to the hub box on "/" unless the visitor is typing elsewhere', () => {
    const { box } = renderBox();
    fireEvent.keyDown(document.body, { key: '/' });
    expect(box).toHaveFocus();
    box.blur();
    const other = document.createElement('input');
    document.body.appendChild(other);
    other.focus();
    fireEvent.keyDown(other, { key: '/' });
    expect(other).toHaveFocus();
    other.remove();
  });
});
