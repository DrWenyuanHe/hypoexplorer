import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { getDataset } from '../data/datasets';
import { loadIndexedExpression } from '../expression-survey/expressionIndex';
import { EXISTING_EXPRESSION_SOURCES, getExistingExpressionSource } from '../expression-survey/existingCatalog';
import { expressionForGenes, loadExistingExpression } from '../expression-survey/existingExpression';
import type { ExpressionSource } from '../expression-survey/expressionTypes';
import type { RawTrack } from '../types';

vi.mock('../expression-survey/expressionIndex', () => ({ loadIndexedExpression: vi.fn() }));

const agrp = EXISTING_EXPRESSION_SOURCES[0];
const dataset = getDataset(agrp.datasetId!)!;
const rawCache = new Map<string, RawTrack>();

function retainedTrack(source: ExpressionSource): RawTrack {
  const key = `${source.datasetId}/${source.trackId}`;
  let raw = rawCache.get(key);
  if (!raw) {
    const text = fs.readFileSync(path.resolve('public/datasets', source.datasetId!, `track_${source.trackId}.js`), 'utf8');
    raw = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as RawTrack;
    rawCache.set(key, raw);
  }
  return raw;
}

describe('existing expression sample resolution', () => {
  it('uses sample membership, preserves missing cells, excludes dropped profiles and keeps measured zero', () => {
    const raw: RawTrack = {
      meta: {
        sampleOrder: ['fast', 'fed', 'missing', 'excluded'],
        groupSamples: { control: ['fed', 'missing', 'absent'], case: ['fast', 'excluded'] },
        samplesKept: ['fast', 'fed', 'missing'],
      },
      cpm: { Lepr: [9, 0, null, 99] },
    };
    const [result] = expressionForGenes(agrp, raw, dataset, ['lepr']);
    // The first existing source is a count study, labelled TMM-normalized CPM since the R 4.6.0
    // regeneration (data/quality/regeneration-r460-2026-09-25/README.md).
    expect(result).toMatchObject({ status: 'available', gene: 'Lepr', unit: 'CPM (TMM-normalized)' });
    expect(result.groups).toEqual([
      { key: 'control', label: agrp.conditions[0].label, referenceEligible: true, samples: [{ id: 'fed', value: 0 }, { id: 'missing', value: null }, { id: 'absent', value: null }], mean: 0, n: 1, totalSamples: 3 },
      { key: 'case', label: agrp.conditions[1].label, referenceEligible: false, samples: [{ id: 'fast', value: 9 }, { id: 'excluded', value: null }], mean: 9, n: 1, totalSamples: 2 },
    ]);
  });

  it('distinguishes absent, ambiguous, all-missing and zero-valued features without using DE summary fields', () => {
    const raw: RawTrack = {
      meta: { sampleOrder: ['a'], groupSamples: { control: ['a'], case: [] } },
      de: [{ gene: 'OnlyDE', logFC: 1, logCPM: 8, PValue: 0.1, FDR: 0.2 }],
      cpm: { Lepr: [1], LEPR: [2], Empty: [null], Zero: [0], 'ENSMUSG00000057722.1': [7], Bad: [Number.NaN] },
    };
    const results = expressionForGenes(agrp, raw, dataset, ['OnlyDE', 'Lepr', 'Empty', 'Zero', 'ensmusg00000057722', 'Bad']);
    expect(results[0]).toMatchObject({ status: 'not-retained', groups: [] });
    expect(results[1]).toMatchObject({ status: 'ambiguous', candidates: ['Lepr', 'LEPR'], groups: [] });
    expect(results[2].groups[0]).toMatchObject({ mean: null, n: 0, totalSamples: 1 });
    expect(results[3].groups[0]).toMatchObject({ mean: 0, n: 1 });
    expect(results[4]).toMatchObject({ status: 'available', gene: 'ENSMUSG00000057722.1', geneId: 'ENSMUSG00000057722.1' });
    expect(results[5].groups[0]).toMatchObject({ mean: null, n: 0 });
  });

  it('refuses multiple retained Ensembl versions and never folds symbol suffixes into the same feature', () => {
    const raw: RawTrack = { cpm: { 'ENSMUSG00000057722.1': [1], 'ENSMUSG00000057722.2': [2], Gene: [3], 'Gene.1': [4] } };
    const results = expressionForGenes(agrp, raw, dataset, ['ENSMUSG00000057722', 'Gene', 'Gene.1']);
    expect(results[0].status).toBe('ambiguous');
    expect(results[1].gene).toBe('Gene');
    expect(results[2].gene).toBe('Gene.1');
  });

  it('loads the selected source from the gene index and rejects unknown sources', async () => {
    const expected = expressionForGenes(agrp, { cpm: { Lepr: [1] } }, dataset, ['Lepr']);
    vi.mocked(loadIndexedExpression).mockResolvedValueOnce(expected);
    expect(await loadExistingExpression(agrp.id, ['Lepr'])).toBe(expected);
    expect(loadIndexedExpression).toHaveBeenCalledWith(agrp, ['Lepr']);
    await expect(loadExistingExpression('missing-source', ['Lepr'])).rejects.toThrow('Unknown expression source');
  });

  it('refuses unit drift instead of showing a stored value under the wrong scale', () => {
    expect(() => expressionForGenes({ ...agrp, unit: 'TPM' }, { cpm: { Lepr: [1] } }, dataset, ['Lepr'])).toThrow('Expression unit changed');
  });
});

describe('reviewed existing expression catalog and retained scientific bundles', () => {
  it('keeps SON pools and signed deposited log-expression separate from isolated OXT cell references', () => {
    const source = getExistingExpressionSource('rat_son_salt_gse65663:son')!;
    expect(source).toMatchObject({ scope: 'tissue', populationId: 'son-tissue', sampleCount: 10,
      unit: 'log2 RMA (GeneSpring median-baselined)' });
    expect(source.replicateUnit).toContain('pool of five');
    expect(source.conditions.map(({ key, sampleCount, referenceEligible }) => ({ key, sampleCount, referenceEligible }))).toEqual([
      { key: 'control', sampleCount: 5, referenceEligible: true }, { key: 'salt', sampleCount: 5, referenceEligible: false },
    ]);
    const raw = retainedTrack(source);
    const signed = Object.entries(raw.cpm).find(([, values]) => values.some(value => value !== null && value < 0));
    expect(signed).toBeDefined();
    const [result] = expressionForGenes(source, raw, getDataset(source.datasetId!)!, [signed![0]]);
    const bySample = new Map(raw.meta!.sampleOrder!.map((id, index) => [id, signed![1][index]]));
    for (const group of result.groups) {
      const expected = raw.meta!.groupSamples![group.key].map(id => bySample.get(id)!);
      expect(group.samples.map(sample => sample.value)).toEqual(expected);
      expect(group.mean).toBeCloseTo(expected.reduce<number>((sum, value) => sum + value!, 0) / 5, 12);
    }
  });

  it('references real disjoint groups with the reviewed sample counts and units across every source', () => {
    expect(new Set(EXISTING_EXPRESSION_SOURCES.map((entry) => entry.id)).size).toBe(EXISTING_EXPRESSION_SOURCES.length);
    for (const source of EXISTING_EXPRESSION_SOURCES) {
      const registered = getDataset(source.datasetId!);
      expect(registered, source.id).not.toBeNull();
      const raw = retainedTrack(source);
      const sampleOrder = new Set(raw.meta?.sampleOrder ?? raw.meta?.sampleNames ?? []);
      const seen = new Set<string>();
      for (const condition of source.conditions) {
        const samples = raw.meta?.groupSamples?.[condition.key];
        expect(samples, `${source.id}/${condition.key}`).toHaveLength(condition.sampleCount!);
        for (const sample of samples!) {
          expect(sampleOrder.has(sample), `${source.id}: missing ${sample}`).toBe(true);
          expect(seen.has(sample), `${source.id}: overlapping ${sample}`).toBe(false);
          seen.add(sample);
        }
      }
      expect(seen.size, source.id).toBe(source.sampleCount);
      expect(Object.keys(raw.cpm).length, source.id).toBeGreaterThan(5000);
      // Exercise the actual adapter and manifest unit precedence, not a parallel unit reader.
      expect(() => expressionForGenes(source, raw, registered!, ['Lepr']), source.id).not.toThrow();
    }
  });

  it('keeps paired tissue input outside PNOC and gives broad POMC and its Drd2 subset distinct identities', () => {
    const pnoc = EXISTING_EXPRESSION_SOURCES.filter((entry) => entry.datasetId === 'mouse_mpoa_pnoc_bactrap_gse306829');
    expect(pnoc.map((entry) => [entry.scope, entry.conditions.map((condition) => condition.key)])).toEqual([
      ['population', ['case']], ['tissue', ['control']],
    ]);
    const pomc = EXISTING_EXPRESSION_SOURCES.filter((entry) => entry.datasetId === 'mouse_arc_pomc_drd2_gse210311');
    expect(pomc.map((entry) => [entry.populationId, entry.conditions.map((condition) => condition.key)])).toEqual([
      ['pomc', ['control']], ['pomc-drd2', ['case']],
    ]);
    const cueStudy = EXISTING_EXPRESSION_SOURCES.find((entry) => entry.datasetId === 'gse224274')!;
    expect(cueStudy.conditions.every((condition) => !condition.referenceEligible)).toBe(true);
  });

  // Count studies now store TMM-normalized CPM from each study's own edgeR fit (rule C2 of the
  // R 4.6.0 regeneration, data/quality/regeneration-r460-2026-09-25/README.md). The CPM means
  // below are recomputed from the rebuilt bundles, which match <stem>_CPM_TMM.tsv.gz to 4 decimals;
  // the other units are unchanged.
  it.each([
    ['mouse_agrp_fedfast_gse68177:agrp', 'CPM (TMM-normalized)', 50.26964, 264.25375],
    ['mouse_pomc_fedfast_gse68177:pomc', 'CPM (TMM-normalized)', 39.8434, 24.73712],
    ['mouse_arc_agrp_trap_gse240484:agrp', 'CPM (TMM-normalized)', 79.449, 180.609],
    ['mouse_agrp_fedfast_gse124693:agrp', 'log2(DESeq2-normalized count + 1)', 8.467725, 7.84964],
    ['mouse_arc_fasting_gse96627:arcuate', 'log2(RPKM + 1)', 2.05832, 3.28312],
    ['mouse_hypo_fedfast_gse254155:hypothalamus', 'CPM (TMM-normalized)', 3.2669, 4.09107],
  ])('recapitulates retained Lepr sample means for %s without mixing scales', (id, unit, referenceMean, otherMean) => {
    const source = getExistingExpressionSource(id)!;
    const [result] = expressionForGenes(source, retainedTrack(source), getDataset(source.datasetId!)!, ['Lepr']);
    expect(result.unit).toBe(unit);
    expect(result.groups[0].mean).toBeCloseTo(referenceMean, 9);
    expect(result.groups[1].mean).toBeCloseTo(otherMean, 9);
    expect(result.groups[0].samples[0].id).toBe(retainedTrack(source).meta!.groupSamples!.control[0]);
  });
});
