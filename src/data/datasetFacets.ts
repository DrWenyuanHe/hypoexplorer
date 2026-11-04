// Browse facets — the axes the dataset library filters on.
//
// These are AUTHORED per dataset, not derived. The temptation is to recover them
// at index-build time from each dataset's meta.js, because the default track's
// label usually names the region ("Arcuate nucleus (ARC)"). That works until it
// doesn't: "Arcuate PNOC neurons (bacTRAP)" is a track label describing a
// preparation, not a region facet, and no label anywhere states what was
// perturbed. A facet a user filters on has to be a fact someone asserted.
//
// Dependency-free (like ./datasetCategories) so the Dataset type in src/types
// can require these without importing the registry.
//
// Adding a value here is deliberate: it widens the filter rail. Prefer placing a
// new dataset in an existing bucket over minting a bucket of one.

/**
 * Where the profiled CELLS live — not, in every case, the boundary of the
 * dissection.
 *
 * For a bulk-tissue study the two are the same thing. For an affinity-purified
 * population they can differ, and the cells are the honest answer: GSE135639
 * homogenised mediobasal hypothalamus but immunoprecipitated POMC ribosomes, so
 * what was measured is arcuate POMC neurons, and a user filtering for the
 * arcuate wants it back. Filing it under the dissection would hide it behind a
 * boundary that no longer describes the sample.
 *
 * The reverse case keeps the broader label: a TRAP pull-down of hypothalamic
 * astrocytes is still whole hypothalamus, because astrocytes are not localised
 * to one nucleus. The rule is "where are these cells", not "how was it cut".
 */
export const DATASET_REGIONS = [
  'Whole hypothalamus',
  'Ventral hypothalamus',
  'Arcuate nucleus',
  'Lateral hypothalamus',
  'Paraventricular nucleus',
  'Preoptic area',
  'Suprachiasmatic nucleus',
  // A bucket of one today (GSE181204, VMHvl). Minted anyway because the
  // alternative is worse than a thin filter: a microdissected VMHvl punch is
  // not 'Whole hypothalamus', and filing it there would assert a dissection
  // boundary the study did not use. The VMH is also the last of the five
  // canonical nuclei the rail already names, not an arbitrary new axis.
  'Ventromedial hypothalamus',
  'Supraoptic nucleus',
] as const;

export type DatasetRegion = (typeof DATASET_REGIONS)[number];

/** What the contrast actually manipulates — the answer to "case differs from
 *  baseline by WHAT?". Note this describes the CONTRAST, not the background:
 *  ob/ob mice given vehicle vs FGF1 is a drug study whose animals happen to be
 *  genetically obese, so it is filed under 'Drug & hormone'. */
export const DATASET_PERTURBATIONS = [
  'Diet & obesity',
  'Fasting & feeding',
  'Genetic',
  'Drug & hormone',
  'Microbiome',
  'Sex',
  'Environment & stress',
  'Cell-type contrast',
  'Age & aging',
] as const;

export type DatasetPerturbation = (typeof DATASET_PERTURBATIONS)[number];

/** How the library was prepared — the axis that predicts what a null result
 *  means. A bulk-tissue miss and a sorted-neuron miss are not the same claim. */
export const DATASET_PREPARATIONS = [
  'Bulk tissue',
  'Translatome',
  'Sorted cells',
  'Single-nucleus',
  'Single-cell',
  'Spatial spots',
  'Cell culture',
] as const;

export type DatasetPreparation = (typeof DATASET_PREPARATIONS)[number];
