import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { registryCards } from '../data/datasetCatalog';
import { datasetQuality, qualitySearchText } from '../data/datasetQualityR460';
import { AUTHOR_VALIDATION_REPORT } from '../data/authorValidation';
import { EMPTY_FILTERS, filterCards, facetCounts } from '../library/libraryFilters';
import { filterAndSort, type TrackerFilterState } from '../dataset-tracker/trackerLogic';
import type { TrackerRow } from '../types';
import { getInternalQc } from '../data/internalQc';
import { DATASETS } from '../data/datasets';

describe('quality decisions remain consistent across surfaces', () => {
  it('filters library and tracker independently by each badge using the same measured decisions', () => {
    const cards = registryCards();
    const rows = cards.map(c => ({ acc: c.validation.accession, title: c.dataset.name, integrated: true,
      match: { id: c.dataset.id, tier: 'dataset', name: c.dataset.name } } as TrackerRow));
    const filters: TrackerFilterState = { status: 'all', feas: 'all', nok: 'all', mod: 'all', sp: 'all', tag: 'all', integ: 'all', validation: 'all' };
    for (const key of ['pipelineQc', 'experimentalDesign', 'authorConcordance'] as const) {
      const expected = cards.filter(c => datasetQuality(c.validation)[key].status === 'pass').map(c => c.dataset.id).sort();
      expect(filterCards(cards, { ...EMPTY_FILTERS, [key]: ['pass'] }).map(c => c.dataset.id).sort()).toEqual(expected);
      expect(filterAndSort(rows, {}, { ...filters, [key]: 'pass' }, { key: 'acc', dir: 1 }).map(r => r.match!.id).sort()).toEqual(expected);
      expect(facetCounts(cards, EMPTY_FILTERS, key).pass).toBe(expected.length);
    }
    for (const key of ['pipelineQc', 'experimentalDesign', 'authorConcordance'] as const) {
      expect(filterAndSort([{ acc: 'candidate', integrated: false } as TrackerRow], {}, { ...filters, [key]: 'pass' }, { key: 'acc', dir: 1 })).toEqual([]);
    }
  });
  it('makes badge labels searchable without removing detailed author evidence', () => {
    const pass = AUTHOR_VALIDATION_REPORT.records.find(r => datasetQuality(r).authorConcordance.status === 'pass')!;
    expect(qualitySearchText(pass)).toContain('Author concordance passed');
    expect(filterCards(registryCards(), { ...EMPTY_FILTERS, q: 'Author concordance passed' }).map(c => c.dataset.id)).toContain(pass.datasetId);
  });
  it('exports the same dataset and comparison decisions as the badge assessment', () => {
    const report = JSON.parse(readFileSync('data/quality/assessments.generated.json', 'utf8'));
    expect(report.records).toHaveLength(AUTHOR_VALIDATION_REPORT.records.length);
    for (const record of AUTHOR_VALIDATION_REPORT.records) {
      const row = report.records.find((r: { datasetId: string }) => r.datasetId === record.datasetId);
      expect(row).toMatchObject(datasetQuality(record));
      for (const id of Object.keys(row.contrasts)) expect(row.contrasts[id]).toEqual(datasetQuality(record, id));
    }
  });
  it('propagates all complete source reconstruction decisions into each registered contrast', () => {
    const sources = JSON.parse(readFileSync('data/internal-qc/source-authenticity-2026-09-05/round4/reader-evaluations.json', 'utf8'));
    expect(sources.records).toHaveLength(12);
    for (const source of sources.records) {
      const dataset = DATASETS.find(row => row.id === source.datasetId)!;
      for (const contrast of dataset.contrasts) {
        const check = getInternalQc(source.datasetId, contrast.id)!.checks.find(row => row.id === 'source_integrity')!;
        expect(check.status, `${source.accession}/${contrast.id}`).toBe(source.status);
        expect(check.note, `${source.accession}/${contrast.id}`).toContain(source.note);
      }
    }
  });
  it('propagates fifth-round source evidence and unresolved findings into every registered contrast', () => {
    const folders = ['round5', 'round5-keyed'];
    const records = folders.flatMap(folder => JSON.parse(readFileSync(`data/internal-qc/source-authenticity-2026-09-05/${folder}/reader-evaluations.json`, 'utf8')).records);
    expect(records).toHaveLength(13);
    expect(new Set(records.map(source => source.datasetId)).size).toBe(13);
    for (const source of records) {
      const dataset = DATASETS.find(row => row.id === source.datasetId)!;
      for (const contrast of dataset.contrasts) {
        const check = getInternalQc(source.datasetId, contrast.id)!.checks.find(row => row.id === 'source_integrity')!;
        expect(check.status, `${source.accession}/${contrast.id}`).toBe(source.status);
        expect(check.note, `${source.accession}/${contrast.id}`).toContain(source.note);
      }
    }
  });
});
