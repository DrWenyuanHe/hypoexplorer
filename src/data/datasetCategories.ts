// Thematic dataset categories — the display order for the dataset selector,
// the landing-hub scope chips, and the cross-dataset reports' sections.
// Dependency-free so the Dataset type (src/types) can require `category`
// without importing the registry.
export const DATASET_CATEGORIES = [
  'Primate atlas',
  'Diet-induced obesity',
  'Feeding & fasting',
  'Leptin, insulin & energy signaling',
  'Incretin & pharmacology',
  // Microbial or microbial-metabolite interventions with a hypothalamic
  // expression readout. Keep this separate from diet effects: in GSE212491
  // both arms are fructose-fed and the estimand is Akkermansia colonization.
  'Microbiome & gut–brain axis',
  'Reproduction & development',
  // Maternal exposure programming the OFFSPRING's hypothalamus — the DOHaD
  // axis. Distinct from 'Reproduction & development', where the manipulation is
  // in the animal being profiled: here the animal profiled is the pup, and the
  // exposure happened to its mother. "Developmental programming" is the field's
  // own term for it, and the studies here use it (or "malprogramming") verbatim.
  //
  // KEEP IT METABOLIC. A category is not only a display grouping — it is the
  // unit the cross-dataset report sections on, so its members have to be asking
  // a comparable question, not merely be thematically adjacent. The current
  // members are maternal obesogenic-diet studies and read together sensibly.
  // Prenatal androgen (mouse_gnrh_androgen_gse162563) fits the broad "exposure
  // applied to the mother" reading and would still be a poor section-mate; it is
  // deliberately left in 'Reproduction & development'. If a non-metabolic
  // maternal exposure ever has to live here, split display from section first.
  'Developmental programming',
  // Direct chronological-age effects only. Interventions performed in aged
  // animals stay in the category describing their actual contrast; otherwise
  // this section would file biologically different contrasts under one heading.
  'Aging',
  'Circadian',
  'Stress, immune & disease',
] as const;

export type DatasetCategory = (typeof DATASET_CATEGORIES)[number];
