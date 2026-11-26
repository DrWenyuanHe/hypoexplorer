// What the explorer's Compare view shows, and how that is written in a link.
//
// Compare shows a set of populations of one dataset, the genes picked for
// them and a sub-tab (Genes or Pathways). Its link carries only what differs
// from the defaults (`#/dataset/<id>/compare` is an untouched Compare). The
// rules behind that used to be spread over four places: App chose the default
// pair, CompareTab left defaults out of the link (and kept a macaque fallback
// pair of its own), routeLanding dropped populations a link named that the
// dataset lacks, and App compared links by JSON string. They are stated once
// here.
//
// Pure and type-only in its imports: routeLanding.ts reads it, and the router
// sits in the entry bundle.

import type { Dataset } from '../types';
import type { CompareViewState } from '../utils/analysisState';

export type CompareMode = 'genes' | 'pathways';

/** What Compare shows, with every default filled in. */
export interface CompareView {
  pops: string[];
  genes: string[];
  mode: CompareMode;
}

/**
 * The populations Compare opens on for a dataset: its curated pair when the
 * registry names one whose populations exist, else its first two populations.
 * A curated id the dataset's data lacks is dropped, so Compare never opens on
 * a column that cannot load.
 */
export function comparePair(dataset: Pick<Dataset, 'defaultCompareTracks'>, populations: readonly string[]): string[] {
  const curated = (dataset.defaultCompareTracks ?? []).filter((id) => populations.includes(id));
  return curated.length >= 2 ? curated : populations.slice(0, 2);
}

/**
 * A link's view checked against the dataset's real populations: an id the
 * dataset no longer has is dropped, and fewer than two left means the default
 * pair (a comparison of one is not a comparison), so `pops` is left out.
 * Genes and the sub-tab need no check; a gene a population lacks shows as such.
 */
export function landCompareLink(link: CompareViewState | undefined, populations: readonly string[]): CompareViewState {
  if (!link) return {};
  const { pops, ...rest } = link;
  const known = pops?.filter((id) => populations.includes(id));
  return known && known.length >= 2 ? { ...rest, pops: known } : rest;
}

/** The view a link opens, with the defaults it left out filled back in. */
export function openCompareView(link: CompareViewState | undefined, pair: readonly string[]): CompareView {
  return {
    pops: link?.pops ? [...link.pops] : [...pair],
    genes: link?.genes ? [...link.genes] : [],
    mode: link?.mode ?? 'genes',
  };
}

/** A view as its link carries it: the default pair, no genes and the Genes sub-tab are left out. */
export function compareLink(view: CompareView, pair: readonly string[]): CompareViewState {
  return {
    ...(sameList(view.pops, pair) ? {} : { pops: [...view.pops] }),
    ...(view.genes.length ? { genes: [...view.genes] } : {}),
    ...(view.mode === 'pathways' ? { mode: view.mode } : {}),
  };
}

/** Two links that name the same view. Order matters: it is the column order. */
export function sameCompareLink(a: CompareViewState, b: CompareViewState): boolean {
  return sameList(a.pops, b.pops) && sameList(a.genes, b.genes) && (a.mode ?? 'genes') === (b.mode ?? 'genes');
}

function sameList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((id, i) => id === right[i]);
}
