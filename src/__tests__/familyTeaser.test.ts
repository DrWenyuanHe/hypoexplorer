// The gene page's study-library and tissue tiles: each source's highest cohort
// mean, ranked only among sources that share the family's most common unit.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXISTING_EXPRESSION_SOURCES } from '../expression-survey/existingCatalog';
import type { ExpressionGeneResult, ExpressionSource } from '../types';

const mocks = vi.hoisted(() => ({ loadExpressionGenes: vi.fn(), loadExternalSources: vi.fn() }));
vi.mock('../expression-survey/expressionData', async (original) => ({
  ...await original<typeof import('../expression-survey/expressionData')>(),
  loadExpressionGenes: mocks.loadExpressionGenes,
}));
vi.mock('../expression-survey/externalReference', async (original) => ({
  ...await original<typeof import('../expression-survey/externalReference')>(),
  loadExternalSources: mocks.loadExternalSources,
}));

const { loadFamilyTeaser, resetSearchSummaries } = await import('../search/searchSummaries');

const populations = EXISTING_EXPRESSION_SOURCES.filter((source) => source.scope === 'population');
const tissue = EXISTING_EXPRESSION_SOURCES.filter((source) => source.scope !== 'population');
const atlas = (id: string, species: string, scope: ExpressionSource['scope']): ExpressionSource => ({
  ...tissue[0], id, collection: 'external', species, scope, unit: 'nTPM', label: `Hypothalamus · ${id}`, populationLabel: 'Hypothalamus',
});
const HUMAN = atlas('gtex', 'Homo sapiens', 'tissue');
const PIG = atlas('hpa-pig', 'Sus scrofa', 'tissue');
const CLUSTERS = atlas('hpa-clusters', 'Mus musculus', 'population');

function result(source: ExpressionSource, means: Array<number | null>, unit = 'CPM'): ExpressionGeneResult[] {
  return [{
    sourceId: source.id, query: 'Pomc', gene: 'Pomc', unit, status: 'available',
    groups: means.map((mean, i) => ({
      key: `g${i}`, label: `Cohort ${i}`, referenceEligible: i === 0, samples: [], mean, n: 3 + i, totalSamples: 3 + i,
    })),
  }];
}

beforeEach(() => {
  resetSearchSummaries();
  mocks.loadExpressionGenes.mockReset();
  mocks.loadExternalSources.mockResolvedValue({ sources: [HUMAN, PIG, CLUSTERS], errors: {} });
});

describe('study-library and tissue tiles', () => {
  it('ranks each study by its highest cohort, only among studies in the most common unit', async () => {
    const [a, b, c, d] = populations;
    mocks.loadExpressionGenes.mockImplementation(async (source: ExpressionSource) => {
      if (source.id === a.id) return result(a, [12, 40]);
      if (source.id === b.id) return result(b, [900, null]);
      if (source.id === c.id) return result(c, [3.8], 'log2(CPM + 1)');
      if (source.id === d.id) throw new Error('offline');
      return [{ sourceId: source.id, query: 'Pomc', unit: 'CPM', status: 'not-retained', groups: [] }];
    });
    const teaser = await loadFamilyTeaser('Pomc', 'studies');
    expect(mocks.loadExpressionGenes).toHaveBeenCalledTimes(populations.length);
    expect(teaser).toMatchObject({ measured: 3, total: populations.length, unit: 'CPM', inUnit: 2 });
    expect(teaser?.levels.map((level) => [level.sourceId, level.cohort, level.mean, level.n])).toEqual([
      [b.id, 'Cohort 0', 900, 3],
      [a.id, 'Cohort 1', 40, 4],
    ]);
    expect(teaser?.levels[0].label).toBe(b.populationLabel);
    expect(teaser?.levels[0].study).toBe(b.label.split(' · ').slice(1).join(' · '));
  });

  it('reads animal tissue, never a human atlas or a population source, and names its species', async () => {
    mocks.loadExpressionGenes.mockImplementation(async (source: ExpressionSource) => result(source, [5], source.unit));
    const teaser = await loadFamilyTeaser('Pomc', 'tissue');
    const read = mocks.loadExpressionGenes.mock.calls.map(([source]) => (source as ExpressionSource).id);
    expect(read).toEqual([...tissue.map((source) => source.id), PIG.id]);
    expect(teaser?.total).toBe(tissue.length + 1);
    expect(teaser?.species[0]).toBe('Mus musculus');
    expect(teaser?.species).toContain('Sus scrofa');
    expect(teaser?.species).not.toContain('Homo sapiens');
  });

  it('names the species its tissue sources come from, the most sources first', async () => {
    mocks.loadExpressionGenes.mockImplementation(async (source: ExpressionSource) => result(source, [5], source.unit));
    const teaser = await loadFamilyTeaser('Pomc', 'tissue');
    expect(teaser?.species[0]).toBe('Mus musculus');
    expect(teaser?.species).toEqual(expect.arrayContaining(['Rattus norvegicus', 'Sus scrofa']));
    expect(teaser?.species).not.toContain('Homo sapiens');
  });

  it('counts a source that failed to load as unread, never as one that lacks the gene, and reads it again next time', async () => {
    const [failing] = populations;
    mocks.loadExpressionGenes.mockImplementation(async (source: ExpressionSource) => {
      if (source.id === failing.id) throw new Error('offline');
      return [{ sourceId: source.id, query: 'Pomc', unit: 'CPM', status: 'not-retained', groups: [] }];
    });
    expect(await loadFamilyTeaser('Pomc', 'studies')).toMatchObject({ measured: 0, unread: 1, total: populations.length });
    await loadFamilyTeaser('Pomc', 'studies');
    expect(mocks.loadExpressionGenes).toHaveBeenCalledTimes(populations.length * 2);
  });

  it('is unavailable, and retried, when no source could be read', async () => {
    mocks.loadExpressionGenes.mockRejectedValue(new Error('index unavailable'));
    expect(await loadFamilyTeaser('Pomc', 'studies')).toBeNull();
    mocks.loadExpressionGenes.mockResolvedValue([]);
    expect(await loadFamilyTeaser('Pomc', 'studies')).toMatchObject({ measured: 0, unread: 0 });
  });

  it('says nothing measured when no source retained the gene', async () => {
    mocks.loadExpressionGenes.mockResolvedValue([]);
    expect(await loadFamilyTeaser('NOT_A_GENE', 'studies')).toMatchObject({ measured: 0, levels: [] });
  });
});
