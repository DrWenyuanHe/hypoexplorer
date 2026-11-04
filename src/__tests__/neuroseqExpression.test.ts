import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadNeuroseqExpression, neuroseqSources, resetExpressionRequests, resolveNeuroseqGenes } from '../expression-survey/neuroseqExpression';
import type { NeuroseqManifest } from '../expression-survey/neuroseqExpression';

function publicJson(path: string): unknown {
  return JSON.parse(readFileSync(`public${path.split('?')[0]}`, 'utf8'));
}

afterEach(() => { resetExpressionRequests(); vi.unstubAllGlobals(); });

describe('NeuroSeq expression import and sample mapping', () => {
  it('reproduces the independent browser values through the production loader', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => publicJson(url) })));
    const [lepr] = await loadNeuroseqExpression('HY.ARH_glu_Pomc-GFP', ['ENSMUSG00000057722']);
    const [agrp] = await loadNeuroseqExpression('HY.ARH_GABA_NPY-hrGFP', ['Agrp']);
    expect(lepr.groups.flatMap((g) => g.samples).find((s) => s.id.endsWith('_383'))?.value).toBe(27.94);
    const [pomcBySymbol] = await loadNeuroseqExpression('HY.ARH_glu_Pomc-GFP', ['Pomc']);
    expect(pomcBySymbol.groups.flatMap((g) => g.samples).find((s) => s.id.endsWith('_383'))?.value).toBe(22795.34);
    expect(agrp.groups.flatMap((g) => g.samples).find((s) => s.id.endsWith('_100'))?.value).toBe(3034.68);
    expect(agrp.groups.map((g) => g.samples.length).sort()).toEqual([2, 5]);
    expect(agrp.groups.filter((g) => g.referenceEligible).flatMap((g) => g.samples)).toHaveLength(5);
  });

  it('retains 15 display populations and 17 source groups, with SFO opt-in', () => {
    const manifest = publicJson('/expression/neuroseq/manifest.json') as NeuroseqManifest;
    const sources = neuroseqSources(manifest);
    expect(sources).toHaveLength(15);
    expect(sources.flatMap((s) => s.conditions)).toHaveLength(17);
    expect(sources.reduce((n, s) => n + (s.sampleCount ?? 0), 0)).toBe(54);
    expect(sources.filter((s) => !s.boundary)).toHaveLength(13);
    expect(sources.filter((s) => !s.boundary).reduce((n, s) => n + (s.sampleCount ?? 0), 0)).toBe(51);
    expect(sources.flatMap((s) => s.conditions).filter((g) => g.referenceEligible).reduce((n, g) => n + (g.sampleCount ?? 0), 0)).toBe(13);
  });

  it('does not silently collapse duplicate symbols; IDs disambiguate', () => {
    const entries = [
      { id: 'id1', symbol: 'Gene', ensemblId: 'ENSMUSG1', shard: '/expression/neuroseq/shards/01.json' },
      { id: 'id2', symbol: 'Gene', ensemblId: 'ENSMUSG2', shard: '/expression/neuroseq/shards/02.json' },
    ];
    expect(resolveNeuroseqGenes(entries, 'gene')).toHaveLength(2);
    expect(resolveNeuroseqGenes(entries, 'ENSMUSG2')).toEqual([entries[1]]);
    expect(resolveNeuroseqGenes(entries, 'missing')).toEqual([]);
    const variants = [entries[0], { ...entries[1], symbol: 'GENE', ensemblId: '---' }];
    expect(resolveNeuroseqGenes(variants, 'Gene')).toEqual([entries[0]]);
    expect(resolveNeuroseqGenes(variants, 'gene')).toHaveLength(2);
    expect(resolveNeuroseqGenes(variants, '---')).toEqual([]);
  });

  it('reports absent genes without values and retries failed requests', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (url: string) => ({ ok: true, json: async () => publicJson(url) }));
    vi.stubGlobal('fetch', fetcher);
    await expect(loadNeuroseqExpression('HY.ARH_glu_Pomc-GFP', ['Lepr'])).rejects.toThrow('offline');
    const [missing] = await loadNeuroseqExpression('HY.ARH_glu_Pomc-GFP', ['NOT_A_GENE_123']);
    expect(missing.status).toBe('not-retained');
    expect(missing.groups).toEqual([]);
  });
});
