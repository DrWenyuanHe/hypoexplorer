// The curated COMMON-NAME dictionary behind the unified search.
//
// The authority tables (public/nomenclature/names.js) already answer most of
// what people type: 'oxytocin', 'leptin', 'somatostatin' and 'growth hormone'
// are gene names, and 'ACTH', 'CRF' or 'VGLUT2' are authority aliases. This list
// covers the rest — the names a hypothalamus or metabolism reader uses that no
// authority spells: the peptide a gene encodes (orexin -> HCRT, nesfatin ->
// NUCB2), lab shorthand (GLP-1, AgRP, GnRH) and the protein rather than the
// gene (alpha-MSH, beta-endorphin -> POMC).
//
// RULES FOR EDITING
// -----------------
//   * Only mappings that are textbook-certain. A wrong entry is worse than a
//     missing one: it is ranked above every gene-name match and opens a report.
//   * Symbols are UPPERCASE, as the cross-dataset query index stores them, so one
//     entry serves human, mouse and rat. List the human symbol first: the order
//     is the ranking within the entry. Add the rodent symbol only when it differs
//     (mouse Tac2 is the neurokinin B gene that human calls TAC3).
//   * Leave out terms whose official name or alias already finds the gene —
//     'oxytocin', 'leptin', 'vasopressin' and 'ghrelin' match by gene name (MGI
//     names Avp plain 'vasopressin'), and the results page says so
//     ("Gene name"). Repeating them here would relabel the match as a common name.
//   * Leave out ambiguous shorthand ('ADH' is alcohol dehydrogenase as often as
//     antidiuretic hormone; 'GR' and 'ER' are a dozen things).
//
// Matching ignores case, spaces, hyphens and other punctuation, and reads Greek
// alpha/beta/gamma as the spelled-out word: 'GLP-1' == 'glp1' == 'GLP 1', and
// 'α-MSH' == 'alpha-MSH' == 'alphaMSH'. See synonymKey.

export interface SearchSynonym {
  /** The common name as a reader would write it; shown in the match label. */
  term: string;
  /** UPPERCASE stored symbols, preferred first. */
  symbols: readonly string[];
  /** Why the mapping holds, when it is not obvious. */
  note?: string;
}

export const SEARCH_SYNONYMS: readonly SearchSynonym[] = [
  // ── Feeding, arousal and energy balance ──────────────────────────────────
  { term: 'orexin', symbols: ['HCRT'], note: 'Orexin A and B are both cleaved from prepro-orexin (hypocretin).' },
  { term: 'orexin A', symbols: ['HCRT'] },
  { term: 'orexin B', symbols: ['HCRT'] },
  { term: 'orexin receptor 1', symbols: ['HCRTR1'] },
  { term: 'orexin receptor 2', symbols: ['HCRTR2'] },
  { term: 'MCH', symbols: ['PMCH'], note: 'Melanin-concentrating hormone is cleaved from pro-MCH.' },
  { term: 'melanin-concentrating hormone', symbols: ['PMCH'] },
  { term: 'CART', symbols: ['CARTPT'] },
  { term: 'cocaine- and amphetamine-regulated transcript', symbols: ['CARTPT'] },
  { term: 'AgRP', symbols: ['AGRP'] },
  { term: 'agouti-related peptide', symbols: ['AGRP'] },
  { term: 'alpha-MSH', symbols: ['POMC'], note: 'α-MSH, ACTH and β-endorphin are all cleaved from POMC.' },
  { term: 'alpha-melanocyte-stimulating hormone', symbols: ['POMC'] },
  { term: 'ACTH', symbols: ['POMC'] },
  { term: 'adrenocorticotropic hormone', symbols: ['POMC'] },
  { term: 'beta-endorphin', symbols: ['POMC'] },
  { term: 'endorphin', symbols: ['POMC'] },
  { term: 'ghrelin receptor', symbols: ['GHSR'] },
  { term: 'nesfatin', symbols: ['NUCB2'], note: 'Nesfatin-1 is cleaved from nucleobindin-2.' },
  { term: 'nesfatin-1', symbols: ['NUCB2'] },
  { term: 'adiponectin', symbols: ['ADIPOQ'] },
  { term: 'amylin', symbols: ['IAPP'] },
  { term: 'galanin', symbols: ['GAL'] },
  { term: 'PrRP', symbols: ['PRLH'], note: 'Prolactin-releasing peptide.' },
  { term: 'prolactin-releasing peptide', symbols: ['PRLH'] },

  // ── Gut and pancreatic hormones ──────────────────────────────────────────
  { term: 'insulin', symbols: ['INS2', 'INS1', 'INS'], note: 'Mouse and rat carry two insulin genes, Ins1 and Ins2. Listed although the gene names find all three, so the order is fixed: Ins2, the one expressed in brain and stored by most rodent studies here, then Ins1, then INS (stored only by the pig and cattle studies; no human or macaque dataset here stores it).' },
  { term: 'GLP-1', symbols: ['GCG'], note: 'Glucagon-like peptide 1 is cleaved from proglucagon.' },
  { term: 'glucagon-like peptide 1', symbols: ['GCG'] },
  { term: 'GLP-2', symbols: ['GCG'] },
  { term: 'proglucagon', symbols: ['GCG'] },
  { term: 'GLP-1 receptor', symbols: ['GLP1R'] },
  { term: 'GLP-1R', symbols: ['GLP1R'] },

  // ── Neuroendocrine releasing hormones and pituitary hormones ─────────────
  { term: 'GnRH', symbols: ['GNRH1'] },
  { term: 'LHRH', symbols: ['GNRH1'] },
  { term: 'kisspeptin', symbols: ['KISS1'] },
  { term: 'kisspeptin receptor', symbols: ['KISS1R'] },
  { term: 'neurokinin B', symbols: ['TAC3', 'TAC2'], note: 'Human TAC3; the mouse ortholog is named Tac2.' },
  { term: 'substance P', symbols: ['TAC1'] },
  { term: 'CRF', symbols: ['CRH'] },
  { term: 'corticotropin-releasing factor', symbols: ['CRH'] },
  { term: 'antidiuretic hormone', symbols: ['AVP'] },
  { term: 'SRIF', symbols: ['SST'], note: 'Somatotropin release-inhibiting factor, i.e. somatostatin.' },
  { term: 'somatotropin', symbols: ['GH1', 'GH'], note: 'Human GH1; the mouse gene is Gh.' },
  { term: 'PACAP', symbols: ['ADCYAP1'] },
  { term: 'TSH', symbols: ['TSHB'], note: 'The hormone-specific beta subunit; the alpha subunit is CGA.' },
  { term: 'LH', symbols: ['LHB'], note: 'The hormone-specific beta subunit; the alpha subunit is CGA.' },
  { term: 'FSH', symbols: ['FSHB'], note: 'The hormone-specific beta subunit; the alpha subunit is CGA.' },

  // ── Opioid precursors ────────────────────────────────────────────────────
  { term: 'enkephalin', symbols: ['PENK'] },
  { term: 'met-enkephalin', symbols: ['PENK'] },
  { term: 'leu-enkephalin', symbols: ['PENK'] },
  { term: 'dynorphin', symbols: ['PDYN'] },

  // ── Neuronal identity markers ────────────────────────────────────────────
  { term: 'VGLUT1', symbols: ['SLC17A7'] },
  { term: 'VGLUT2', symbols: ['SLC17A6'] },
  { term: 'VGAT', symbols: ['SLC32A1'] },
  { term: 'GAD67', symbols: ['GAD1'] },
  { term: 'GAD65', symbols: ['GAD2'] },
  { term: 'SERT', symbols: ['SLC6A4'] },
  { term: 'serotonin transporter', symbols: ['SLC6A4'] },
  { term: 'DAT', symbols: ['SLC6A3'] },
  { term: 'dopamine transporter', symbols: ['SLC6A3'] },
  { term: 'c-Fos', symbols: ['FOS'] },
  { term: 'TrkB', symbols: ['NTRK2'] },

  // ── Signalling and metabolic regulators ──────────────────────────────────
  { term: 'IGF-1', symbols: ['IGF1'] },
  { term: 'AMPK', symbols: ['PRKAA1', 'PRKAA2'], note: 'The two catalytic alpha subunits.' },
  { term: 'PGC-1alpha', symbols: ['PPARGC1A'] },
  { term: 'estrogen receptor alpha', symbols: ['ESR1'] },
  { term: 'glucocorticoid receptor', symbols: ['NR3C1'] },
];

/**
 * The matching key: lowercase letters and digits only, Greek letters spelled out.
 * 'GLP-1' -> 'glp1', 'α-MSH' -> 'alphamsh', 'PGC-1α' -> 'pgc1alpha'.
 */
export function synonymKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/α/g, 'alpha')
    .replace(/β/g, 'beta')
    .replace(/γ/g, 'gamma')
    .replace(/[^a-z0-9]+/g, '');
}

let byKey: Map<string, SearchSynonym[]> | null = null;

/** Every curated entry whose term matches `query`, ignoring case and punctuation. */
export function lookupSynonyms(query: string): readonly SearchSynonym[] {
  if (!byKey) {
    byKey = new Map();
    for (const entry of SEARCH_SYNONYMS) {
      const key = synonymKey(entry.term);
      const at = byKey.get(key);
      if (at) at.push(entry); else byKey.set(key, [entry]);
    }
  }
  const key = synonymKey(query);
  return key ? byKey.get(key) ?? [] : [];
}
