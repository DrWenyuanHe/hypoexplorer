// Filtering, faceting and sorting for the dataset library.
//
// Pure functions over DatasetCard[], deliberately free of React — the same split
// as trackerLogic.ts and pathwayTable.ts. The reason is the facet counts: getting
// them right is subtle enough to deserve its own tests, and testing them through
// a mounted view would mean asserting on rendered numbers in a sidebar.

import { DATASET_CATEGORIES } from './../data/datasetCategories';
import { VERIFICATION_CLAIMS, getVerificationClaim, RESULT_AVAILABILITY, EVIDENCE_LEVELS } from '../data/authorVerification';
import type { DatasetCard } from '../data/datasetCatalog';
import { datasetQuality, qualitySearchText } from '../data/datasetQualityR460';

/** Facet keys, each mapping to a required field on the dataset manifest. */
export type FacetKey = 'validation' | 'pipelineQc' | 'experimentalDesign' | 'authorConcordance' | 'availability' | 'category' | 'region' | 'perturbation' | 'preparation';

export interface LibraryFilters {
  q: string;
  validation: string[];
  pipelineQc?: string[];
  experimentalDesign?: string[];
  authorConcordance?: string[];
  availability?: string[];
  category: string[];
  region: string[];
  perturbation: string[];
  preparation: string[];
  /** Minimum replicates in BOTH arms; 0 disables. Cards with unmeasured N are
   *  excluded when this is on — "unknown" is not evidence of adequacy. */
  minN: number;
}

export const EMPTY_FILTERS: LibraryFilters = {
  q: '', validation: [], pipelineQc: [], experimentalDesign: [], authorConcordance: [], availability: [], category: [], region: [], perturbation: [], preparation: [], minN: 0,
};

export function hasActiveFilters(f: LibraryFilters): boolean {
  return Boolean(
    f.q.trim() || f.minN > 0
    || f.validation.length || f.pipelineQc?.length || f.experimentalDesign?.length || f.authorConcordance?.length || f.availability?.length || f.category.length || f.region.length || f.perturbation.length || f.preparation.length,
  );
}

/** The facet value of a card, for a facet key. */
function facetValue(card: DatasetCard, key: FacetKey): string {
  if (key === 'validation') return getVerificationClaim(card.validation.verification);
  if (key === 'pipelineQc' || key === 'experimentalDesign' || key === 'authorConcordance') return datasetQuality(card.validation)[key].status;
  if (key === 'availability') return card.validation.verification.resultAvailability;
  return card.dataset[key];
}

/**
 * Free-text match.
 *
 * Searches identity AND vocabulary — the arm labels especially, because "chow",
 * "HFD", "vehicle" and "fasted" are what a user actually types when they are
 * looking for a design rather than a study name. Accession and citation are in
 * too, so pasting "GSE225038" or an author name lands.
 */
export function matchesLibraryQuery(card: DatasetCard, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const d = card.dataset;
  const haystack = [
    d.name, d.id, d.category, d.region, d.perturbation, d.preparation,
    d.organism, d.modality, d.citation, d.geo ?? '', d.doi ?? '',
    card.validation.status,
    qualitySearchText(card.validation),
    card.validation.summary, card.validation.accession, card.validation.processedDataAccession,
    VERIFICATION_CLAIMS[getVerificationClaim(card.validation.verification)].label,
    RESULT_AVAILABILITY[card.validation.verification.resultAvailability].label,
    EVIDENCE_LEVELS[card.validation.verification.evidenceLevel].label,
    card.validation.verification.reason, card.validation.note,
    card.trackLabel ?? '',
    ...d.groups.map((g) => g.label),
  ].join(' ').toLowerCase();
  return haystack.includes(q);
}

/** Does a card pass every facet EXCEPT the one named? Used for facet counts. */
function passesExcept(card: DatasetCard, f: LibraryFilters, except: FacetKey | 'minN' | null): boolean {
  if (!matchesLibraryQuery(card, f.q)) return false;
  const keys: FacetKey[] = ['validation', 'pipelineQc', 'experimentalDesign', 'authorConcordance', 'availability', 'category', 'region', 'perturbation', 'preparation'];
  for (const key of keys) {
    if (key === except) continue;
    const selected = f[key] ?? [];
    // Accept a stored legacy grouping without offering it as a new evidence claim.
    const legacyPartial = key === 'validation' && selected.includes('partial')
      && card.validation.verification.state === 'partial';
    if (selected.length && !selected.includes(facetValue(card, key)) && !legacyPartial) return false;
  }
  if (except !== 'minN' && f.minN > 0) {
    if (card.nBaseline == null || card.nCase == null) return false;
    if (Math.min(card.nBaseline, card.nCase) < f.minN) return false;
  }
  return true;
}

export function filterCards(cards: DatasetCard[], f: LibraryFilters): DatasetCard[] {
  return cards.filter((c) => passesExcept(c, f, null));
}

/**
 * How many cards carry each value of one facet, under every OTHER active filter.
 *
 * NOT "the number of results you would get by clicking this" — values within a
 * facet are OR-ed, so with Arcuate already selected, clicking Whole hypothalamus
 * yields Arcuate ∪ Whole, which is more than the number shown beside it. These
 * are per-value bucket sizes, which is the standard disjunctive-facet reading.
 *
 * The facet's own selection is excluded from the count deliberately: counting
 * against the full filter set would put 0 beside every unticked value in an
 * active facet, making a rail that still has results look empty.
 */
export function facetCounts(cards: DatasetCard[], f: LibraryFilters, key: FacetKey): Record<string, number> {
  const out: Record<string, number> = {};
  for (const card of cards) {
    if (!passesExcept(card, f, key)) continue;
    const v = facetValue(card, key);
    out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}

/** Cards that would remain if only the N floor changed — for its own count. */
/**
 * Replicate floors the rail offers, smallest first.
 *
 * Three was the field's own floor long before it was ours — it is the smallest
 * design that can estimate a variance at all, and the QC tab already flags an
 * arm below it. Ten is where this corpus thins out sharply, so the top rung
 * answers "show me only the studies that are actually powered" rather than
 * merely "not tiny".
 */
export const MIN_N_CHOICES = [3, 4, 6, 10] as const;

export function minNCount(cards: DatasetCard[], f: LibraryFilters, n: number): number {
  return cards.filter((c) => (
    passesExcept(c, f, 'minN')
    && c.nBaseline != null && c.nCase != null
    && Math.min(c.nBaseline, c.nCase) >= n
  )).length;
}

export type LibrarySort = 'category' | 'discoveries' | 'replicates' | 'name' | 'tracks';

export const SORT_LABELS: Record<LibrarySort, string> = {
  category: 'Category',
  discoveries: 'Genes found (most first)',
  replicates: 'Replicates (most first)',
  tracks: 'Tracks (most first)',
  name: 'Name (A–Z)',
};

/**
 * Significant genes on the default track, or -1 when the index carries no count.
 *
 * -1 rather than 0 for the same reason weakestArm uses it: a study whose count
 * this deploy cannot know must sort BELOW one measured at zero, not tie with it.
 * Zero is a finding; unmeasured is not.
 */
function discoveredGenes(card: DatasetCard): number {
  return card.discoveries ? card.discoveries.genes : -1;
}

/** Smaller arm of a card, or -1 when unmeasured so it sorts last rather than
 *  masquerading as the weakest real design. */
function weakestArm(card: DatasetCard): number {
  if (card.nBaseline == null || card.nCase == null) return -1;
  return Math.min(card.nBaseline, card.nCase);
}

export function sortCards(cards: DatasetCard[], sort: LibrarySort): DatasetCard[] {
  const byName = (a: DatasetCard, b: DatasetCard) => a.dataset.name.localeCompare(b.dataset.name);
  const out = cards.slice();
  switch (sort) {
    case 'discoveries':
      return out.sort((a, b) => discoveredGenes(b) - discoveredGenes(a) || byName(a, b));
    case 'replicates':
      return out.sort((a, b) => weakestArm(b) - weakestArm(a) || byName(a, b));
    case 'tracks':
      return out.sort((a, b) => (b.trackCount ?? -1) - (a.trackCount ?? -1) || byName(a, b));
    case 'name':
      return out.sort(byName);
    default:
      return out.sort(
        (a, b) =>
          DATASET_CATEGORIES.indexOf(a.dataset.category) - DATASET_CATEGORIES.indexOf(b.dataset.category)
          || byName(a, b),
      );
  }
}

/** Cards grouped under their category, in the registry's category order, with
 *  empty categories dropped. Drives the card view's section headers. */
export function groupByCategory(cards: DatasetCard[]): Array<{ category: string; cards: DatasetCard[] }> {
  return DATASET_CATEGORIES
    .map((category) => ({ category, cards: cards.filter((c) => c.dataset.category === category) }))
    .filter((g) => g.cards.length > 0);
}
