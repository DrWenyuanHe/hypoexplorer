// A gene looked up in a column that may spell it differently.
//
// Columns of a compare set span species: the macaque atlas stores POMC, a
// mouse study stores Pomc. Casing is the dominant cross-species mismatch (the
// cross-dataset reports already match on it — see queryGeneAcrossDatasets),
// so a selected gene is resolved per column case-insensitively, and the
// column then prints its OWN spelling.
//
// The exact lookup runs first and returns the identical record, so a
// single-species caller (the Compare tab) sees no change at all. The
// uppercase index is built once per PopData and remembered by identity —
// popCache hands out one PopData per (raw, dataset, contrast), and a pathway
// hydration that replaces it simply gets a fresh index.

import { pickStoredMember, renameAuthorityOf, renameGroupOf, type SymbolRenames } from '../data/symbolRenames';
import type { GeneDERecord, PopData } from '../types';

const upperIndex = new WeakMap<PopData, Map<string, string>>();

function indexFor(pd: PopData): Map<string, string> {
  let index = upperIndex.get(pd);
  if (!index) {
    index = new Map();
    // First spelling wins, which keeps a column deterministic should a bundle
    // ever carry two symbols that differ only by case.
    for (const name of pd.geneNames) {
      const upper = name.toUpperCase();
      if (!index.has(upper)) index.set(upper, name);
    }
    upperIndex.set(pd, index);
  }
  return index;
}

/**
 * The column's DE record for `gene`, matched exactly first, then by case, then
 * (given the rename table) under another member of the gene's rename group in
 * the column's own authority: a compare set that holds Fam237b reads a study
 * that stores the retired Gm8773 under Gm8773 (see data/symbolRenames). The
 * record's `gene` is always the column's own spelling, so a view prints the
 * symbol that study stores.
 */
export function resolveGeneCI(
  pd: PopData | null | undefined,
  gene: string,
  renames?: SymbolRenames | null,
): GeneDERecord | undefined {
  if (!pd) return undefined;
  const direct = pd.deByGene[gene];
  if (direct) return direct;
  const index = indexFor(pd);
  const own = index.get(gene.toUpperCase());
  if (own) return pd.deByGene[own];
  const group = renameGroupOf(renames ?? null, gene, renameAuthorityOf(pd.dataset));
  if (!group) return undefined;
  const found: Array<{ symbol: string; value: GeneDERecord }> = [];
  for (const member of group.members) {
    if (member.toUpperCase() === gene.toUpperCase()) continue;
    const stored = index.get(member.toUpperCase());
    const record = stored ? pd.deByGene[stored] : undefined;
    if (record) found.push({ symbol: member, value: record });
  }
  return pickStoredMember(found, group)?.value;
}
