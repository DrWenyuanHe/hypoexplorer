// React binding for the search vocabulary.
//
// Kept out of ./searchVocabulary.ts so that module stays React-free, as
// useAliasIndex.ts does for the nomenclature index. This is the only file that
// knows the vocabulary arrives asynchronously.
//
// The load is fired from an effect, and only once `enabled` is true, so the hub
// can wait for the first focus of its search box: a visitor who never searches
// never downloads the names file. Every consumer shares one request
// (loadSearchVocabulary memoizes its promise).

import { useEffect, useState } from 'react';
import { loadSearchVocabulary, peekSearchVocabulary } from './searchVocabulary';
import type { SearchVocabulary } from './searchTypes';

/**
 * The vocabulary once it has arrived, or null until then (and while disabled).
 *
 * A failure does not leave it null: loadSearchVocabulary never rejects and
 * resolves to whatever its sources yield, empty lists at worst. Callers render
 * the box either way; null just means no suggestions yet.
 */
export function useSearchVocabulary(enabled = true): SearchVocabulary | null {
  // An already-loaded vocabulary is read synchronously, so a remount (each new
  // query remounts the results page) renders results on its first frame.
  const [vocabulary, setVocabulary] = useState<SearchVocabulary | null>(() => (enabled ? peekSearchVocabulary() : null));
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    loadSearchVocabulary().then((v) => { if (alive) setVocabulary(v); });
    return () => { alive = false; };
  }, [enabled]);
  return vocabulary;
}
