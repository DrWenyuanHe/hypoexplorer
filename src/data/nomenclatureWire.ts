// Dependency-free nomenclature wire contract shared by the browser client and
// scripts/build_nomenclature.mts. Numeric wire codes are array positions; one
// source prevents a generator-only reorder from silently relabelling payloads.

export const NOMENCLATURE_STATUS = ['current', 'previous', 'alias', 'unrecognized', 'ambiguous'] as const;
export type NomenclatureStatus = (typeof NOMENCLATURE_STATUS)[number];

export const NOMENCLATURE_AUTHORITIES = [
  'HGNC',
  'MGI',
  'RGD',
  'NCBI Gene (Gallus gallus)',
  'NCBI Gene (Danio rerio)',
  'NCBI Gene (Sus scrofa)',
  'NCBI Gene (Bos taurus)',
] as const;
export type NomenclatureAuthority = (typeof NOMENCLATURE_AUTHORITIES)[number];

/**
 * The namespace each registry organism actually uses.
 *
 * The hamster and dormouse entries are MGI on purpose: their accepted source
 * matrices carry explicit author-provided projections onto mouse features. The
 * macaque entries analogously carry human-ortholog symbols and therefore use
 * HGNC. Native chicken, zebrafish, pig and cattle symbols stay in separate
 * species-specific NCBI Gene namespaces so identical uppercase spellings can
 * never be merged or relabelled as human genes.
 */
export const NOMENCLATURE_AUTHORITY_BY_ORGANISM: Readonly<Record<string, NomenclatureAuthority>> = {
  'Mus musculus': 'MGI',
  'Rattus norvegicus': 'RGD',
  'Macaca fascicularis': 'HGNC',
  'Macaca mulatta': 'HGNC',
  'Homo sapiens': 'HGNC',
  'Phodopus sungorus': 'MGI',
  'Eliomys quercinus': 'MGI',
  'Gallus gallus': 'NCBI Gene (Gallus gallus)',
  'Danio rerio': 'NCBI Gene (Danio rerio)',
  'Sus scrofa': 'NCBI Gene (Sus scrofa)',
  'Bos taurus': 'NCBI Gene (Bos taurus)',
};

/** Prefix restored onto the authority id that the wire stores without it. */
export const NOMENCLATURE_AUTHORITY_ID_PREFIX: Readonly<Record<NomenclatureAuthority, string>> = {
  HGNC: 'HGNC',
  MGI: 'MGI',
  RGD: 'RGD',
  'NCBI Gene (Gallus gallus)': 'GeneID',
  'NCBI Gene (Danio rerio)': 'GeneID',
  'NCBI Gene (Sus scrofa)': 'GeneID',
  'NCBI Gene (Bos taurus)': 'GeneID',
};

export function nomenclatureAuthorityForOrganism(organism: string): NomenclatureAuthority | null {
  return NOMENCLATURE_AUTHORITY_BY_ORGANISM[organism] ?? null;
}

/**
 * Historical stored-symbol namespaces, scoped to an individual dataset.
 * These classify spellings retained in a bundle; they do not establish the
 * organism's native nomenclature authority or validate an ortholog mapping.
 */
export const NOMENCLATURE_STORED_DATASET_OVERRIDES: Readonly<Record<string, {
  organism: string;
  authority: NomenclatureAuthority;
  note: string;
  evidence: string;
}>> = {
  gse314184: {
    organism: 'Rhabdomys pumilio',
    authority: 'MGI',
    note: 'The retained GSE314184 analysis used mouse annotation and pathway references. MGI classifies only those stored symbol spellings; it is not a native Rhabdomys authority or a validated mouse projection. The cross-species mapping remains under review.',
    // reviewedStudyMetadata.ts corrects the animal species using the same
    // primary-source review while preserving the historical processed inputs.
    evidence: 'data/internal-qc/intake-replication-2026-09-11/review_decisions.json#GSE314184; DOI 10.1038/s41586-026-10123-4',
  },
};

/** Corpus-generation lookup for existing symbols, not biological gene links. */
export function nomenclatureAuthorityForStoredDatasetSymbols(
  dataset: { id: string; organism: string },
): NomenclatureAuthority | null {
  const override = NOMENCLATURE_STORED_DATASET_OVERRIDES[dataset.id];
  if (override?.organism === dataset.organism) return override.authority;
  return nomenclatureAuthorityForOrganism(dataset.organism);
}
