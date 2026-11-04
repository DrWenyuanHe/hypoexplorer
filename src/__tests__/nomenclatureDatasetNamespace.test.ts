import { describe, expect, it } from 'vitest';
import {
  nomenclatureAuthorityForOrganism,
  nomenclatureAuthorityForStoredDatasetSymbols,
  NOMENCLATURE_STORED_DATASET_OVERRIDES,
} from '../data/nomenclatureWire';
import { reviewedStudyMetadata } from '../data/reviewedStudyMetadata';

describe('historical dataset symbol namespace', () => {
  it('classifies retained mouse-reference spellings without undoing the organism correction', () => {
    const study = reviewedStudyMetadata({
      id: 'gse314184', name: 'Historical mouse label', organism: 'Mus musculus', citation: '',
    });
    expect(study.organism).toBe('Rhabdomys pumilio');
    expect(study.citation).toContain('mapping requires review');
    expect(nomenclatureAuthorityForStoredDatasetSymbols(study)).toBe('MGI');
    expect(nomenclatureAuthorityForOrganism(study.organism)).toBeNull();
    expect(NOMENCLATURE_STORED_DATASET_OVERRIDES[study.id].note).toContain('not a native Rhabdomys authority');
  });

  it('does not assign other striped-mouse studies to MGI', () => {
    expect(nomenclatureAuthorityForStoredDatasetSymbols({
      id: 'another_rhabdomys_dataset', organism: 'Rhabdomys pumilio',
    })).toBeNull();
  });

  it('requires the reviewed organism and leaves ordinary species namespaces intact', () => {
    expect(nomenclatureAuthorityForStoredDatasetSymbols({
      id: 'gse314184', organism: 'Unreviewed species',
    })).toBeNull();
    expect(nomenclatureAuthorityForStoredDatasetSymbols({
      id: 'rat_hypo_maternal_hfd_gse107324', organism: 'Rattus norvegicus',
    })).toBe('RGD');
    expect(nomenclatureAuthorityForStoredDatasetSymbols({
      id: 'mouse_cvh_hfd_gse104709', organism: 'Mus musculus',
    })).toBe('MGI');
  });
});
