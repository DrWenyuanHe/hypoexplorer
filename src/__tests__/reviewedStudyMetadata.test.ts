import { describe, expect, it } from 'vitest';
import { DATASETS } from '../data/datasets';
import { nomenclatureAuthorityForOrganism } from '../data/nomenclatureWire';
import { reviewedStudyMetadata } from '../data/reviewedStudyMetadata';
import intake from '../data/september5Studies.generated.json';

describe('primary-source organism correction', () => {
  it('separates the biological organism from the historical annotation choice', () => {
    const original = intake.find(study => study.id === 'gse314184')!;
    const corrected = DATASETS.find(study => study.id === original.id)!;
    expect(original.organism).toBe('Mus musculus');
    expect(corrected.organism).toBe('Rhabdomys pumilio');
    expect(corrected.pmid).toBe('41708861');
    expect(corrected.citation).toContain('mapping requires review');
    expect(corrected.citation).toContain('pairing is absent');
    expect(nomenclatureAuthorityForOrganism(corrected.organism)).toBeNull();
    expect(corrected.groups).toEqual(original.groups);
    expect(corrected.contrasts).toEqual(original.contrasts);
  });
  it('leaves other study metadata unchanged', () => {
    for (const study of intake.filter(study => study.id !== 'gse314184')) {
      expect(reviewedStudyMetadata(study)).toBe(study);
    }
  });
});
