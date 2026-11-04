import type { Dataset } from '../types';

/** Corrections supported by primary-source review; retained processing records stay historical. */
export function reviewedStudyMetadata<T extends Pick<Dataset, 'id' | 'name' | 'organism' | 'citation'>>(study: T): T {
  if (study.id !== 'gse314184') return study;
  // Nature 2026, DOI 10.1038/s41586-026-10123-4, PMID 41708861;
  // retained primary text: data/internal-qc/intake-replication-2026-09-11/sources/GSE314184/PMC13019464.xml.
  return {
    ...study,
    name: 'African striped mouse medial preoptic parental behavior',
    organism: 'Rhabdomys pumilio',
    pmid: '41708861',
    doi: '10.1038/s41586-026-10123-4',
    citation: 'African striped mouse medial preoptic snRNA-seq: three naive control, three alloparental and three infanticidal males, four sires and four dams. One animal per source object. The source study aligned reads to the Rhabdomys pumilio genome; the retained processing used mouse annotation and pathway references, whose cross-species mapping requires review. Dam-versus-sire differences combine sex and parental-role differences, and the dams and sires are mating pairs whose pairing is absent from the current model (Nature 2026, PMID 41708861; GSE314184).',
  };
}
