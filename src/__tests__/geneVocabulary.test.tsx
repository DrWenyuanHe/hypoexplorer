import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { geneChips, geneVocabulary, useBoundGeneSelection, type GeneVocabulary } from '../explorer/geneVocabulary';
import { useExplorerSession, useGeneSelection } from '../explorer/explorerSession';
import { loadAliasIndex, _resetNomenclature, type AliasIndex } from '../data/nomenclature';
import { _resetBundleCache } from '../data/bundleSource';

// The vocabulary-bound selection, through its interface: the case policy, the
// unions, replace, and the chips' nomenclature notes. The three pickers that
// used to answer these questions separately (Gene Explorer, Compare tab,
// compare set) now ask this module, so these are the rules all three obey.

// Wire rows as the generator writes them: [symbol, authority, status,
// currentSymbol, aliases, prev]. Authority 0 HGNC, 1 MGI; status 0 current,
// 1 previous.
const ALIAS_FIXTURE = {
  v: 1,
  rows: [
    // The same retired gene in both species, spelled as each stores it.
    ['AARS', 0, 1, 'AARS1', '', ''],
    ['Aars', 1, 1, 'Aars1', '', ''],
    // Retired in HGNC only. A mouse column storing Lep must never borrow it.
    ['LEP', 0, 1, 'LEPNEW', '', ''],
    ['Lep', 1, 0, 0, '', ''],
    // A retired symbol split across two current genes.
    ['SPLIT', 0, 1, 'SPLITA|SPLITB', '', ''],
    ['POMC', 0, 0, 0, '', ''],
    ['Pomc', 1, 0, 0, '', ''],
  ],
};

let index: AliasIndex;

beforeEach(async () => {
  _resetNomenclature();
  _resetBundleCache();
  (globalThis as any).HX_NOMENCLATURE_ALIASES = ALIAS_FIXTURE;
  (globalThis as any).window.HX_NOMENCLATURE_ALIASES = ALIAS_FIXTURE;
  index = await loadAliasIndex() as AliasIndex;
});

afterEach(() => {
  (globalThis as any).HX_NOMENCLATURE_ALIASES = undefined;
  (globalThis as any).window.HX_NOMENCLATURE_ALIASES = undefined;
  _resetNomenclature();
  _resetBundleCache();
});

const MACAQUE = { geneNames: ['POMC', 'AARS', 'SPLIT', 'TBX3'], authority: 'HGNC' as const };
const MOUSE = { geneNames: ['Pomc', 'Aars', 'Lep'], authority: 'MGI' as const };

describe('geneVocabulary — the case policy', () => {
  it('resolves a typed or loaded name to the stored spelling, case-insensitively', () => {
    const macaque = geneVocabulary([MACAQUE]);
    expect(macaque.keyOf('pomc')).toBe('POMC');
    expect(macaque.keyOf('POMC')).toBe('POMC');
    const mouse = geneVocabulary([MOUSE]);
    expect(mouse.keyOf('POMC')).toBe('Pomc');
    // A name the vocabulary lacks is kept verbatim, never dropped: a gene
    // restored from a link may name something this track does not store.
    expect(mouse.keyOf('Nope')).toBe('Nope');
  });

  it('passes one track\'s names through untouched, with its authority', () => {
    const v = geneVocabulary([MACAQUE]);
    expect(v.names).toBe(MACAQUE.geneNames);
    expect(v.authority).toBe('HGNC');
    expect(v.caseFolded).toBe(false);
  });
});

describe('geneVocabulary — unions', () => {
  it('unions the populations of one dataset, keeping the stored spelling and the shared authority', () => {
    const e9 = { geneNames: ['POMC', 'TBX3'], authority: 'HGNC' as const };
    const i23 = { geneNames: ['AGRP', 'POMC'], authority: 'HGNC' as const };
    const v = geneVocabulary([e9, i23]);
    expect(v.names).toEqual(['AGRP', 'POMC', 'TBX3']);
    expect(v.authority).toBe('HGNC');
    // A gene only the second population carries still resolves.
    expect(v.keyOf('agrp')).toBe('AGRP');
  });

  it('keys a union across species by the folded symbol, offered in the first column\'s spelling', () => {
    const v = geneVocabulary([MACAQUE, MOUSE], { caseFolded: true });
    // Picking "pomc" selects POMC; each column resolves its own POMC or Pomc.
    expect(v.keyOf('pomc')).toBe('POMC');
    expect(v.keyOf('Lep')).toBe('LEP');
    expect(v.names).toEqual(['AARS', 'Lep', 'POMC', 'SPLIT', 'TBX3']);
    expect(v.offeredSpelling('LEP')).toBe('Lep');
    expect(v.offeredSpelling('POMC')).toBe('POMC');
    // Two namespaces: no single authority can scope redirects for both.
    expect(v.authority).toBeNull();
  });

  it('keeps the authority for a set whose studies share one namespace', () => {
    const other = { geneNames: ['Pomc', 'Npy'], authority: 'MGI' as const };
    expect(geneVocabulary([MOUSE, other], { caseFolded: true }).authority).toBe('MGI');
  });
});

describe('geneChips — per-chip nomenclature facts', () => {
  it('says what a retired stored symbol is now called, in the dataset\'s namespace', () => {
    const [aars, pomc, split] = geneChips(geneVocabulary([MACAQUE]), index, ['AARS', 'POMC', 'SPLIT']);
    expect(aars).toEqual({ gene: 'AARS', retiredTo: ['AARS1'], authorities: ['HGNC'] });
    expect(pomc.retiredTo).toEqual([]);
    expect(split.retiredTo).toEqual(['SPLITA', 'SPLITB']);
  });

  it('is silent for a gene no source stores, and without the index', () => {
    const v = geneVocabulary([MOUSE]);
    expect(geneChips(v, index, ['AARS1'])[0].retiredTo).toEqual([]);
    expect(geneChips(v, null, ['Aars'])[0]).toEqual({ gene: 'Aars', retiredTo: [], authorities: [] });
  });

  it('asks nothing of a source with no authority, so it never borrows a namespace', () => {
    const bare = { geneNames: ['AARS', 'Aars'], authority: null };
    expect(geneChips(geneVocabulary([bare]), index, ['AARS', 'Aars']).map((c) => c.retiredTo)).toEqual([[], []]);
  });

  it('reads each study in its own namespace across species, and never borrows another\'s note', () => {
    const v = geneVocabulary([MACAQUE, MOUSE], { caseFolded: true });
    const [aars, lep] = geneChips(v, index, ['AARS', 'LEP']);
    // Both columns store a retired spelling; the notes agree up to case.
    expect(aars).toEqual({ gene: 'AARS', retiredTo: ['AARS1'], authorities: ['HGNC', 'MGI'] });
    // Only the mouse column stores Lep, which MGI calls current. HGNC's retired
    // LEP is a different record and must not label it.
    expect(lep.retiredTo).toEqual([]);
  });
});

describe('useBoundGeneSelection', () => {
  // The alias index lands from an effect; flushing it inside act keeps its
  // arrival out of the assertions' way.
  async function bound(vocabulary: GeneVocabulary) {
    const hook = renderHook(({ v }) => useBoundGeneSelection(useGeneSelection(), v), { initialProps: { v: vocabulary } });
    await act(async () => { await loadAliasIndex(); });
    return hook;
  }

  it('applies the case policy to add, addMany and replace', async () => {
    const { result } = await bound(geneVocabulary([MOUSE]));
    act(() => { result.current.add('POMC'); });
    act(() => { result.current.addMany(['aars', 'Pomc']); });
    expect(result.current.genes).toEqual(['Pomc', 'Aars']);
    act(() => { result.current.replace(['LEP', 'lep', 'pomc']); });
    expect(result.current.genes).toEqual(['Lep', 'Pomc']);
  });

  it('marks the selection in the vocabulary\'s spelling, and carries the chips\' facts', async () => {
    const { result } = await bound(geneVocabulary([MOUSE, MACAQUE], { caseFolded: true }));
    act(() => { result.current.addMany(['pomc', 'Aars']); });
    expect(result.current.genes).toEqual(['POMC', 'AARS']);
    // The mouse column is first, so the search box offers (and marks) Pomc.
    expect(result.current.offered).toEqual(['Pomc', 'Aars']);
    expect(result.current.chips[1].retiredTo).toEqual(['Aars1']);
  });

  it('leaves the session\'s reset rules in charge of a bound selection', async () => {
    const vocabulary = geneVocabulary([MACAQUE]);
    const { result } = renderHook(() => {
      const session = useExplorerSession<{ id: string }>();
      return { session, bound: useBoundGeneSelection(session.genes, vocabulary) };
    });
    await act(async () => { await loadAliasIndex(); });
    act(() => { result.current.bound.replace(['pomc', 'tbx3']); });
    expect(result.current.session.genes.genes).toEqual(['POMC', 'TBX3']);
    act(() => { result.current.session.resetFor('contrast'); });
    expect(result.current.bound.genes).toEqual(['POMC', 'TBX3']);
    act(() => { result.current.session.resetFor('track'); });
    expect(result.current.bound.genes).toEqual([]);
  });
});
