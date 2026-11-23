// The study record's interface: which verified paper describes a dataset, the
// repository link, the default comparison and per-track arm counts. The static
// study pages, the citation guide and the agent export all render from it, so
// the identity rule is pinned here once rather than in each renderer's tests.
import { describe, expect, it } from 'vitest';
import sourceMetadata from '../../data/seo/studySources.json';
import { studyRecord, type StudySource, type StudySources } from '../../scripts/lib/studyRecord.mjs';
import { getDataset, listDatasets } from '../data/datasets';
import type { Dataset, DatasetMeta } from '../types';

const base = listDatasets()[0];
const study = (overrides: Partial<Dataset>): Dataset => ({ ...base, geo: 'GSE1', pmid: '', doi: '', citation: 'Registry citation.', ...overrides });
const recordOf = (dataset: Dataset, source: StudySource) => studyRecord(dataset, { [dataset.id]: source });
const TITLE = 'The verified publication';

describe('publication identity', () => {
  it('verifies a PMID the registry names only in its citation', () => {
    const record = recordOf(study({ citation: 'Author et al. (PMID 12345678; GSE1)' }), { paperTitle: TITLE, paperPmid: '12345678' });
    expect(record.publication).toMatchObject({ status: 'verified', title: TITLE, pmid: '12345678' });
    expect(record.pmid).toBe('12345678');
  });

  it('verifies the source record\'s only linked PMID when the registry names none', () => {
    const source = { paperTitle: TITLE, paperPmid: '12345678', sourcePubmedIds: ['12345678'] };
    const record = recordOf(study({}), source);
    expect(record.publication).toMatchObject({ status: 'verified', pmid: '12345678' });
    expect(record.pmid).toBe('12345678');
    // Two linked ids are ambiguous, and a registry PMID always outranks the snapshot.
    expect(recordOf(study({}), { ...source, sourcePubmedIds: ['12345678', '87654321'] }).publication.status).toBe('none');
    expect(recordOf(study({ pmid: '11111111' }), source).publication.status).toBe('none');
    // A malformed registry PMID is present and mismatched, never "no PMID".
    expect(recordOf(study({ pmid: 'unmatched' }), source).publication.status).toBe('none');
  });

  it.each([undefined, '', ' '])('does not treat two DOIs of %j as a match', (doi) => {
    const record = recordOf(study({ doi }), { paperTitle: TITLE, paperDoi: doi });
    expect(record.publication).toEqual({ status: 'none' });
  });

  it('verifies a DOI-only match, case-insensitively and without a doi.org prefix', () => {
    const record = recordOf(study({ doi: '10.1101/2024.01.29.577705' }), {
      paperTitle: TITLE, paperDoi: 'https://doi.org/10.1101/2024.01.29.577705', paperUrl: 'https://example.org/paper',
    });
    // The linked DOI is bare, so a renderer's https://doi.org/ link is not doubled.
    expect(record.publication).toMatchObject({ status: 'verified', pmid: undefined, doi: '10.1101/2024.01.29.577705', url: 'https://example.org/paper' });
    expect(record).toMatchObject({ pmid: undefined, doi: '10.1101/2024.01.29.577705' });
    expect(recordOf(study({ doi: '10.1000/ABC' }), { paperTitle: TITLE, paperDoi: '10.1000/abc' }).publication.status).toBe('verified');
  });

  it('drops a snapshot naming another paper, or one without a title, and keeps the registry identifiers', () => {
    const dataset = study({ pmid: '11111111', doi: '10.5555/registry-paper' });
    const other = recordOf(dataset, { paperTitle: 'Another paper', paperPmid: '99999999', paperDoi: '10.5555/other' });
    expect(other.publication).toEqual({ status: 'none' });
    expect(other).toMatchObject({ pmid: '11111111', doi: '10.5555/registry-paper' });
    expect(recordOf(dataset, { paperPmid: '11111111' }).publication.status).toBe('none');
  });

  it('links the verified paper\'s DOI over an older registry DOI', () => {
    const record = recordOf(study({ pmid: '12345678', doi: '10.1000/old-link' }), {
      paperTitle: TITLE, paperPmid: '12345678', paperDoi: '10.1000/correct-link',
    });
    expect(record.doi).toBe('10.1000/correct-link');
  });

  it('agrees with the committed snapshot for the studies the export used to miss', () => {
    const sources: StudySources = sourceMetadata;
    for (const id of ['mouse_hypo_diabetes_gse235792', 'mouse_hypo_akkermansia_gse212491', 'rat_poa_lbn_gse174753', 'rat_vmh_hfd_gse330152']) {
      expect(studyRecord(getDataset(id)!, sources).publication.status, id).toBe('verified');
    }
  });
});

describe('source record links', () => {
  it('finds the snapshot by dataset id, then by accession', () => {
    const dataset = study({ geo: 'GSE42' });
    expect(studyRecord(dataset, { GSE42: { sourceTitle: 'By accession' } }).source.sourceTitle).toBe('By accession');
    expect(studyRecord(dataset, { GSE42: { sourceTitle: 'By accession' }, [dataset.id]: { sourceTitle: 'By id' } }).source.sourceTitle).toBe('By id');
    expect(studyRecord(dataset, {}).source).toEqual({});
  });

  it('keeps only https repository and paper links', () => {
    const dataset = study({ pmid: '12345678' });
    expect(recordOf(dataset, { sourceUrl: 'https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE1' }).repositoryUrl)
      .toBe('https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE1');
    for (const unsafe of ['javascript:alert(1)', 'http://example.org/', 'not a url', '']) {
      const record = recordOf(dataset, { sourceUrl: unsafe, paperTitle: TITLE, paperPmid: '12345678', paperUrl: unsafe });
      expect(record.repositoryUrl, unsafe).toBeUndefined();
      expect(record.publication).toMatchObject({ status: 'verified', url: undefined });
    }
  });
});

describe('default comparison and per-track arm counts', () => {
  const groups = [
    { key: 'control', label: 'Chow', color: '#000' }, { key: 'case', label: 'HFD', color: '#111' },
    { key: 'p0', label: 'P0', color: '#222' }, { key: 'p21', label: 'P21', color: '#333' },
  ];
  const factorial = study({ defaultTrack: 'a', groups, contrasts: [{ id: 'age', baseline: 'p0', case: 'p21', isDefault: true }] });
  const pooled = study({ defaultTrack: 'a', groups, contrasts: [{ id: 'diet', baseline: 'control', case: 'case', isDefault: true }] });
  const meta = (extra: Partial<DatasetMeta>): DatasetMeta => ({
    populations: ['a', 'b', 'c'], labels: { a: 'Track A' }, types: {}, colors: {}, nGenes: { a: 1234 },
    qcFlags: { a: { nNormal: 8, nObese: 9 }, b: { nNormal: 6, nObese: 7 } }, ...extra,
  });

  it('resolves the default comparison and its arm labels, with neutral fallbacks', () => {
    expect(studyRecord(factorial, {})).toMatchObject({ defaultContrast: { id: 'age' }, armLabels: { baselineLabel: 'P0', caseLabel: 'P21' } });
    expect(studyRecord(study({ contrasts: [] }), {})).toMatchObject({ defaultContrast: null, armLabels: { baselineLabel: 'Baseline', caseLabel: 'Case' } });
  });

  it('counts the default track from groupN and never repeats that study-wide n on other tracks', () => {
    const record = studyRecord(factorial, {}, meta({ groupN: { control: 8, case: 9, p0: 4, p21: 5 } }));
    expect(record.tracks).toEqual([
      { id: 'a', label: 'Track A', features: 1234, nBaseline: 4, nCase: 5 },
      // The QC pair counts the pooled arms, which the default track shows are not P0/P21.
      { id: 'b', label: 'b', features: null, nBaseline: null, nCase: null },
      { id: 'c', label: 'c', features: null, nBaseline: null, nCase: null },
    ]);
  });

  it('counts other tracks from their own QC pair unless the default track shows it names other arms', () => {
    const withGroupN = studyRecord(pooled, {}, meta({ groupN: { control: 8, case: 9, p0: 4, p21: 5 } }));
    expect(withGroupN.tracks.map((track) => [track.nBaseline, track.nCase])).toEqual([[8, 9], [6, 7], [null, null]]);
    const withoutGroupN = studyRecord(factorial, {}, meta({}));
    expect(withoutGroupN.tracks.map((track) => [track.nBaseline, track.nCase])).toEqual([[8, 9], [6, 7], [null, null]]);
  });

  it('has no track rows without meta', () => {
    expect(studyRecord(pooled, {}).tracks).toEqual([]);
    expect(studyRecord(pooled, {}, meta({ populations: [] })).tracks).toEqual([]);
  });
});
