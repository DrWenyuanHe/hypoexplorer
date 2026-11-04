// Browse themes — how the library's Category facet is grouped for scanning.
//
// The DATASET_CATEGORIES are the ANALYSIS unit: each is a section of the
// cross-dataset reports, so which studies share one is a claim about which
// comparisons belong side by side, not a sidebar arrangement. They are also, read as a browse list, lopsided — eleven studies
// under 'Diet-induced obesity' against one under 'Primate atlas' — and cut on
// three axes at once (perturbation, biology, life stage).
//
// A theme is the presentation layer that fixes the browsing problem without
// touching the statistics. It names a group of categories; the rail draws it as
// a heading with its categories nested under it. Nothing downstream knows themes
// exist — filtering is still by category, and so is every URL.
//
// A theme holding ONE category is NAMED AFTER THAT CATEGORY, so the rail can
// draw it as a single row: a heading whose only child repeats it is two rows
// saying one thing. Hierarchy earns its place only where it groups something.
//
// Dependency-free apart from the category list itself, matching ./datasetFacets.

import type { DatasetCategory } from './datasetCategories';

export interface DatasetTheme {
  id: string;
  title: string;
  /** In DATASET_CATEGORIES order, so the rail reads in the registry's order. */
  categories: readonly DatasetCategory[];
}

export const DATASET_THEMES: readonly DatasetTheme[] = [
  {
    id: 'atlas',
    title: 'Primate atlas',
    categories: ['Primate atlas'],
  },
  {
    // The corpus's centre of gravity. Diet, feeding state
    // and the leptin/insulin axis are three ways of perturbing one system, and a
    // user who wants "the energy-balance studies" wants all three.
    id: 'energy',
    title: 'Energy balance',
    categories: ['Diet-induced obesity', 'Feeding & fasting', 'Leptin, insulin & energy signaling'],
  },
  {
    id: 'pharmacology',
    title: 'Incretin & pharmacology',
    categories: ['Incretin & pharmacology'],
  },
  {
    id: 'microbiome',
    title: 'Microbiome & gut–brain axis',
    categories: ['Microbiome & gut–brain axis'],
  },
  {
    // Both are development, differing in WHO was manipulated: the animal being
    // profiled, or its mother. That distinction matters enough to keep two
    // strata (see datasetCategories) and little enough to browse as one group.
    id: 'development',
    title: 'Development & reproduction',
    categories: ['Reproduction & development', 'Developmental programming'],
  },
  {
    id: 'aging',
    title: 'Aging',
    categories: ['Aging'],
  },
  {
    id: 'circadian',
    title: 'Circadian',
    categories: ['Circadian'],
  },
  {
    id: 'disease',
    title: 'Stress, immune & disease',
    categories: ['Stress, immune & disease'],
  },
];
