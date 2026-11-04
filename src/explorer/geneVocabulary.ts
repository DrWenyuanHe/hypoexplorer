// A gene selection BOUND TO A VOCABULARY.
//
// `useGeneSelection` (explorerSession.ts) holds a list of strings and nothing
// else. Every view that let the reader pick genes then had to answer the same
// questions on its own, and three of them answered differently:
//   - WHICH SPELLING is selected when the reader types `pomc`? The Gene
//     Explorer took the dataset's (`POMC`); the compare set upper-cased
//     everything and mapped it back per column; the Compare tab took whatever
//     the union of its populations offered.
//   - WHICH NAMESPACE do redirects and "outdated symbol" notes come from? The
//     Gene Explorer and the Compare tab passed the dataset's authority; the
//     compare set passed none, and so showed no "now X" note at all.
//   - WHAT IS THE VOCABULARY when several tracks are on screen? Each place
//     built its own union.
// A vocabulary answers all three once, and the binding below applies it to
// every way a name can enter the selection — typed, loaded from a file,
// clicked on a volcano — so the three views cannot drift apart again.
//
// The selection STATE stays in explorerSession.ts, because its lifetime is
// App's (the Gene Explorer's list survives a tab switch and is cleared by
// `resetFor`). This module adds the policy that depends on what is loaded,
// which App neither knows nor needs: the binding is made inside each view,
// over whichever selection instance that view holds.
//
// Pure apart from the one hook at the bottom, so the policy is testable
// without mounting a view.

import { useCallback, useMemo } from 'react';
import { factsFor, type AliasIndex, type NomenclatureAuthority } from '../data/nomenclature';
import { useAliasIndex } from '../data/useAliasIndex';
import type { GeneSelection } from './explorerSession';

// ── The vocabulary ──────────────────────────────────────────────────────────

/** One track's symbols, in the namespace its dataset uses. */
export interface GeneVocabularySource {
  /** The symbols the track stores, spelled as it stores them. */
  geneNames: readonly string[];
  /** The authority behind those spellings; null when the organism has none. */
  authority: NomenclatureAuthority | null;
}

export interface GeneVocabulary {
  readonly sources: readonly GeneVocabularySource[];
  /** What the search box offers and a loaded list resolves against. */
  readonly names: readonly string[];
  /**
   * The ONE authority every source shares, else null. Null is the honest value
   * for a union that spans species: scoping redirects to one species' namespace
   * would redirect names the other columns never use, and leaving it unscoped
   * makes `resolveByOtherName` fail closed on any alias it cannot attribute.
   */
  readonly authority: NomenclatureAuthority | null;
  /**
   * Whether a selected gene is keyed by its upper-cased symbol rather than a
   * stored spelling. True for a union across studies, which may span species
   * that spell one gene POMC and Pomc: the key is what every column resolves
   * case-insensitively (see resolveGeneCI), and it never changes as columns of
   * another species land.
   */
  readonly caseFolded: boolean;
  /** The selection key for a name from anywhere: typed, loaded or clicked. */
  keyOf: (name: string) => string;
  /** A key as `names` spells it, so the search box can mark it selected. */
  offeredSpelling: (key: string) => string;
}

// One case index per symbol array, remembered by identity: popCache hands out
// one PopData (and so one geneNames array) per track and contrast, and a
// chip list re-renders far more often than a track loads. First spelling wins,
// as in resolveGeneCI, so a bundle carrying two case variants stays
// deterministic.
const upperIndexes = new WeakMap<readonly string[], Map<string, string>>();

function upperIndex(names: readonly string[]): Map<string, string> {
  let index = upperIndexes.get(names);
  if (!index) {
    index = new Map();
    for (const name of names) {
      const upper = name.toUpperCase();
      if (!index.has(upper)) index.set(upper, name);
    }
    upperIndexes.set(names, index);
  }
  return index;
}

/**
 * The vocabulary of one track, or the union of several.
 *
 * One source is the Gene Explorer: its names pass through untouched. Several
 * sources under one dataset are the Compare tab's populations: their symbols
 * are unioned and a gene keeps its stored spelling. `caseFolded` is the
 * compare set's union across studies, deduplicated by case so POMC and Pomc
 * are one entry, offered in the spelling of the first column that has it.
 */
export function geneVocabulary(
  sources: readonly GeneVocabularySource[],
  { caseFolded = false }: { caseFolded?: boolean } = {},
): GeneVocabulary {
  const exact = new Set<string>();
  const byUpper = new Map<string, string>();
  for (const source of sources) {
    for (const name of source.geneNames) exact.add(name);
    for (const [upper, name] of upperIndex(source.geneNames)) {
      if (!byUpper.has(upper)) byUpper.set(upper, name);
    }
  }

  let names: readonly string[];
  if (caseFolded) names = [...byUpper.values()].sort();
  else if (sources.length === 1) names = sources[0].geneNames;
  else names = [...exact].sort();

  const authorities = new Set(sources.map((s) => s.authority));
  const authority = authorities.size === 1 ? sources[0].authority : null;

  // The case policy, stated once. A stored-spelling vocabulary takes an exact
  // match first, then the spelling it stores case-insensitively — what
  // resolveGeneList and GeneSearchBox already do for the names they resolve
  // — and keeps a name it does not know verbatim rather than dropping it (a
  // gene restored from a link can name something this track lacks; the views
  // say "not detected" for it).
  const keyOf = caseFolded
    ? (name: string) => name.toUpperCase()
    : (name: string) => (exact.has(name) ? name : byUpper.get(name.toUpperCase()) ?? name);
  const offeredSpelling = caseFolded
    ? (key: string) => byUpper.get(key.toUpperCase()) ?? key
    : (key: string) => key;

  return { sources, names, authority, caseFolded, keyOf, offeredSpelling };
}

// ── Per-chip nomenclature facts ─────────────────────────────────────────────

/** What a chip says about its gene beyond the symbol. */
export interface GeneChip {
  /** The selection key: what the chip prints and what removing it removes. */
  gene: string;
  /**
   * The authority's current symbol(s) when a source stores this gene under a
   * retired one; empty otherwise. A retired symbol split across several genes
   * contributes each; spellings that differ only by case are listed once.
   */
  retiredTo: string[];
  /** The authorities that retired it, in source order. */
  authorities: NomenclatureAuthority[];
}

/**
 * Each selected gene's nomenclature facts, read PER SOURCE.
 *
 * Every source is asked in its own namespace about its own spelling: the
 * macaque column's AARS under HGNC, the mouse column's Aars under MGI. That is
 * what lets a compare set across species carry the note at all — one
 * authority for the whole set would either be wrong for half its columns or
 * have to be dropped, which is what the set used to do. A gene no source
 * stores carries no note: "the dataset stores the older spelling" would be
 * false for it. Without the alias index every chip is plain.
 */
export function geneChips(
  vocabulary: GeneVocabulary,
  index: AliasIndex | null,
  genes: readonly string[],
): GeneChip[] {
  return genes.map((gene) => {
    const retiredTo: string[] = [];
    const authorities: NomenclatureAuthority[] = [];
    if (!index) return { gene, retiredTo, authorities };
    const seen = new Set<string>();
    const upper = gene.toUpperCase();
    for (const source of vocabulary.sources) {
      // A source with no authority is asked nothing: an unscoped lookup would
      // borrow whichever namespace happens to match, and a "now X" note in a
      // namespace the study never used is a claim, not a fact.
      if (!source.authority) continue;
      const own = upperIndex(source.geneNames).get(upper);
      if (!own) continue;
      const facts = factsFor(index, own, source.authority);
      if (facts?.status !== 'previous' || !facts.currentSymbol) continue;
      if (!authorities.includes(facts.authority)) authorities.push(facts.authority);
      for (const symbol of facts.currentSymbol.split('|')) {
        const u = symbol.toUpperCase();
        if (!seen.has(u)) { seen.add(u); retiredTo.push(symbol); }
      }
    }
    return { gene, retiredTo, authorities };
  });
}

// ── The binding ─────────────────────────────────────────────────────────────

export interface BoundGeneSelection extends GeneSelection {
  readonly vocabulary: GeneVocabulary;
  /** The selection as the vocabulary offers it: the search box's and the Load dialog's "already selected". */
  readonly offered: readonly string[];
  readonly chips: readonly GeneChip[];
}

/**
 * A selection whose every entry point goes through the vocabulary's case
 * policy, plus what its chips should say.
 *
 * Still a GeneSelection — `add` / `addMany` / `replace` now take a name in any
 * case and select the vocabulary's key for it — so a volcano or a list that
 * hands over names in its own spelling needs no adapter of its own.
 * `vocabulary` must be memoized by the caller: its `keyOf` is a dependency of
 * the callbacks here.
 */
export function useBoundGeneSelection(selection: GeneSelection, vocabulary: GeneVocabulary): BoundGeneSelection {
  const aliasIndex = useAliasIndex();
  const { genes, add: addKey, addMany: addKeys, replace: replaceKeys, remove, clear } = selection;
  const { keyOf, offeredSpelling, caseFolded } = vocabulary;

  const add = useCallback((name: string) => addKey(keyOf(name)), [addKey, keyOf]);
  const addMany = useCallback((names: string[]) => addKeys(names.map(keyOf)), [addKeys, keyOf]);
  const replace = useCallback((names: string[]) => replaceKeys(names.map(keyOf)), [replaceKeys, keyOf]);

  const offered = useMemo(
    () => (caseFolded ? genes.map(offeredSpelling) : genes),
    [genes, caseFolded, offeredSpelling],
  );
  const chips = useMemo(() => geneChips(vocabulary, aliasIndex, genes), [vocabulary, aliasIndex, genes]);

  return useMemo(
    () => ({ genes, add, addMany, replace, remove, clear, vocabulary, offered, chips }),
    [genes, add, addMany, replace, remove, clear, vocabulary, offered, chips],
  );
}
