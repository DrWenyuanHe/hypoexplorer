// React binding for the nomenclature alias index.
//
// Kept out of ./nomenclature.ts so that module stays React-free — it is plain
// data plumbing, and the Node scripts type-check against src/data. This is the
// only file that knows the index arrives asynchronously.
//
// The load is fired from an effect rather than at import time so a session that
// never opens a gene search never requests the 2.4 MB file. Every consumer
// shares one request (loadAliasIndex memoizes its promise), so mounting the hook
// in the search box AND in the chip list costs one download between them.

import { useEffect, useState } from 'react';
import { loadAliasIndex, type AliasIndex } from './nomenclature';

/**
 * The alias index once it has arrived, or null until then / if it never does.
 *
 * ONE nullable value for both states on purpose. Callers must render correctly
 * without it either way — search still matches symbols directly, chips still
 * render, the alias toggle simply has nothing to add — so distinguishing
 * "loading" from "unavailable" would only invite a spinner on a feature that is
 * meant to be invisible when absent.
 */
export function useAliasIndex(): AliasIndex | null {
  const [index, setIndex] = useState<AliasIndex | null>(null);
  useEffect(() => {
    let alive = true;
    loadAliasIndex().then((i) => { if (alive) setIndex(i); });
    return () => { alive = false; };
  }, []);
  return index;
}
