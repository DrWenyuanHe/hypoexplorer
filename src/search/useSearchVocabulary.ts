// React binding for the search vocabulary.
//
// Kept out of ./searchVocabulary.ts so that module stays React-free, as
// useAliasIndex.ts does for the nomenclature index. This is the only file that
// knows the vocabulary arrives asynchronously.
//
// The load is fired from an effect, and only once `enabled` is true, so the hub
// can wait for the visitor to reach for its search box: a visitor who never
// searches never downloads the names file. Every consumer shares one request
// (loadSearchVocabulary memoizes its promise).

import { useEffect, useState } from 'react';
import { loadSearchVocabulary, peekSearchVocabulary, subscribeSearchVocabulary } from './searchVocabulary';
import type { SearchVocabulary } from './searchTypes';

export interface SearchVocabularyOptions {
  /**
   * Follow the vocabulary as each source lands instead of waiting for all of
   * them. For suggestions, which can show the named genes as soon as the
   * same-origin names file arrives; not for a page whose counts must not shift.
   */
  partial?: boolean;
}

/**
 * The vocabulary once it has arrived, or null until then (and while disabled).
 * With `partial`, the richest stage that has arrived so far.
 *
 * A failure does not leave it null: loadSearchVocabulary never rejects and
 * resolves to whatever its sources yield, empty lists at worst. Callers render
 * the box either way; null just means no suggestions yet.
 */
export function useSearchVocabulary(enabled = true, { partial = false }: SearchVocabularyOptions = {}): SearchVocabulary | null {
  // An already-loaded vocabulary is read synchronously, so a remount (each new
  // query remounts the results page) renders results on its first frame.
  const [vocabulary, setVocabulary] = useState<SearchVocabulary | null>(() => (enabled ? peekSearchVocabulary(partial) : null));
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const unsubscribe = partial ? subscribeSearchVocabulary((v) => { if (alive) setVocabulary(v); }) : undefined;
    // A stage may have landed between the first render and this effect.
    const seen = peekSearchVocabulary(partial);
    if (seen) setVocabulary(seen);
    loadSearchVocabulary().then((v) => { if (alive) setVocabulary(v); });
    return () => { alive = false; unsubscribe?.(); };
  }, [enabled, partial]);
  return vocabulary;
}
