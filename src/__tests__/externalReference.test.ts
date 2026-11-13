// Reads the generated GTEx, HPA and Allen products (pnpm run build:expression-external).
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  externalGeneResult, externalJson, loadExternalExpression, loadExternalManifest, loadExternalSources, loadExternalValidation,
  resetExternalRequests,
} from '../expression-survey/externalReference';
import { externalKey } from '../expression-survey/externalReferenceFormat';
import type { ExternalReferenceManifest } from '../expression-survey/externalReferenceFormat';

function publicJson(path: string): unknown {
  return JSON.parse(readFileSync(`public${path.split('?')[0]}`, 'utf8'));
}
function localFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => publicJson(url) })));
}
afterEach(() => { resetExternalRequests(); vi.unstubAllGlobals(); });

async function source(id: string) {
  const { sources } = await loadExternalSources();
  const found = sources.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

describe('external reference atlases', () => {
  it('describe GTEx donors without inventing reference eligibility', async () => {
    localFetch();
    const manifest = await loadExternalManifest('gtex');
    const [gtex] = manifest.sources;
    expect(gtex).toMatchObject({ collection: 'external', scope: 'tissue', species: 'Homo sapiens', unit: 'TPM', valueKind: 'samples', sampleCount: 257 });
    expect(gtex.conditions.every((condition) => !condition.referenceEligible)).toBe(true);
    expect(gtex.provider?.attribution).toMatch(/Common Fund/);
    expect(new Set(manifest.samples.map((sample) => sample.metadata.subject)).size).toBe(257);
    expect(manifest.samples.filter((sample) => sample.metadata.sex === 'female')).toHaveLength(64);
  });

  it('matches a mouse symbol to the human gene with two small requests and exact values', async () => {
    localFetch();
    const gtex = await source('gtex-v10-brain-hypothalamus');
    vi.mocked(fetch).mockClear();
    const [pomc, missing] = await loadExternalExpression(gtex, ['Pomc', 'NOT_A_GENE_123']);
    expect(pomc).toMatchObject({ status: 'available', gene: 'POMC', geneId: 'ENSG00000115138', unit: 'TPM' });
    const [donors] = pomc.groups;
    expect(donors.samples).toHaveLength(257);
    expect(donors.samples.find((sample) => sample.id === 'GTEX-111FC-0011-R8b-SM-GI4VS')?.value).toBe(26.1534);
    expect(donors.summary).toBeUndefined();
    expect(missing).toMatchObject({ status: 'not-retained', groups: [] });
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => url.includes('/values/'))).toHaveLength(1);
    expect(urls.filter((url) => url.includes('/lookup/'))).toHaveLength(2);
  });

  it('reports pseudo-autosomal copies as ambiguous and resolves them by versioned ID', async () => {
    localFetch();
    const gtex = await source('gtex-v10-brain-hypothalamus');
    const [bySymbol, byId] = await loadExternalExpression(gtex, ['PLCXD1', 'ENSG00000182378.15_PAR_Y']);
    expect(bySymbol.status).toBe('ambiguous');
    expect(bySymbol.candidates).toHaveLength(2);
    expect(byId).toMatchObject({ status: 'available', gene: 'PLCXD1' });
    expect(externalKey('ensg00000115138.11')).toBe('ENSG00000115138');
  });

  it('finds a versioned Ensembl ID in a source that stores IDs unversioned', async () => {
    localFetch();
    const subregions = await source('hpa-human-hypothalamic-subregions');
    const [pomc] = await loadExternalExpression(subregions, ['ENSG00000115138.11']);
    expect(pomc).toMatchObject({ status: 'available', gene: 'POMC', geneId: 'ENSG00000115138' });
  });

  it('keeps HPA subregion and cluster values as published summaries', async () => {
    localFetch();
    const subregions = await source('hpa-human-hypothalamic-subregions');
    const [pomc] = await loadExternalExpression(subregions, ['POMC']);
    expect(pomc.groups).toHaveLength(8);
    expect(pomc.groups.every((group) => group.samples.length === 0 && group.mean === null && group.n === 0)).toBe(true);
    expect(pomc.groups.find((group) => group.label === 'arcuate nucleus')?.summary).toBe(68.4);
    const clusters = await source('hpa-human-hypothalamus-snrna-clusters');
    expect(clusters.scope).toBe('population');
    const [oxt] = await loadExternalExpression(clusters, ['OXT']);
    expect(oxt.groups).toHaveLength(26);
    expect(oxt.groups.find((group) => group.key === 'c-1')?.summary).toBe(126.5);
  });

  it('serves mouse and pig hypothalamus per animal under their own identifiers', async () => {
    localFetch();
    const mouse = await source('hpa-mouse-hypothalamus');
    const [pomc, byId] = await loadExternalExpression(mouse, ['Pomc', 'ENSMUSG00000020660']);
    expect(pomc).toMatchObject({ status: 'available', gene: 'Pomc', geneId: 'ENSMUSG00000020660' });
    expect(pomc.groups[0].samples.map((sample) => sample.id)).toEqual(['F 1', 'F 2', 'M 1', 'M 2']);
    expect(pomc.groups[0].samples[0].value).toBe(36.5544);
    expect(byId.groups[0].mean).toBe(pomc.groups[0].mean);
    const pig = await source('hpa-pig-hypothalamus');
    expect(pig.species).toBe('Sus scrofa');
    expect((await loadExternalExpression(pig, ['ENSSSCG00000021155']))[0].gene).toBe('POMC');
  });

  it('accepts only exact-agreement validation reports', async () => {
    localFetch();
    for (const provider of ['gtex', 'hpa', 'allen'] as const) {
      const report = await loadExternalValidation(provider);
      expect(report.exactMatches).toBe(report.comparedValues);
      expect(report.notes.join(' ')).toMatch(/API/);
    }
    resetExternalRequests();
    const tampered = { ...(publicJson('/expression/gtex/validation.json') as object), exactMatches: 1 };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true, json: async () => (String(url).includes('validation') ? tampered : publicJson(url)) })));
    await expect(loadExternalValidation('gtex')).rejects.toThrow('exact source agreement');
  });

  it('rejects unsafe paths and inconsistent cohorts, and retries failed loads', async () => {
    await expect(externalJson('gtex', '../neuroseq/manifest.json')).rejects.toThrow('asset path');
    const manifest = structuredClone(publicJson('/expression/hpa/manifest.json')) as ExternalReferenceManifest;
    manifest.columns['hpa-mouse-hypothalamus'].pop();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => manifest })));
    await expect(loadExternalManifest('hpa')).rejects.toThrow('cohort metadata');
    resetExternalRequests();
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (url: string) => ({ ok: true, json: async () => publicJson(url) }));
    vi.stubGlobal('fetch', fetcher);
    expect((await loadExternalSources()).errors.gtex).toBe('offline');
    expect((await loadExternalSources()).sources).toHaveLength(6);
  });

  it('returns one Allen row per probe with donors as groups and tissue samples as profiles', async () => {
    localFetch();
    const allen = await source('allen-human-hypothalamus-microarray');
    expect(allen).toMatchObject({ featureLevel: 'probe', unit: 'log2 normalized intensity', sampleCount: 102 });
    expect(allen.conditions.map((condition) => condition.sampleCount)).toEqual([9, 22, 17, 20, 16, 18]);
    expect(allen.conditions.every((condition) => !condition.referenceEligible)).toBe(true);
    const results = await loadExternalExpression(allen, ['Pomc']);
    expect(results.map((result) => result.probe).sort()).toEqual(['A_23_P5875', 'CUST_15470_PI416261804', 'CUST_15474_PI416261804']);
    for (const result of results) {
      expect(result).toMatchObject({ status: 'available', gene: 'POMC', query: 'Pomc' });
      expect(result.groups.map((group) => group.n)).toEqual([9, 22, 17, 20, 16, 18]);
    }
    const manifest = await loadExternalManifest('allen');
    expect(new Set(manifest.samples.map((sample) => sample.metadata.donor)).size).toBe(6);
    expect((await loadExternalValidation('allen')).exactMatches).toBe(58692 * 102);
  });

  it('accepts negative values only on a log scale', async () => {
    localFetch();
    const allen = await source('allen-human-hypothalamus-microarray');
    const gtex = await source('gtex-v10-brain-hypothalamus');
    const allenManifest = await loadExternalManifest('allen');
    const gtexManifest = await loadExternalManifest('gtex');
    const entry = (id: string) => ({ source: id, id: 'X', symbol: 'X', ensemblId: '' });
    const negative = (count: number) => Array.from({ length: count }, () => -0.5);
    expect(externalGeneResult(allenManifest, allen, 'X', entry(allen.id), negative(102)).groups[0].mean).toBe(-0.5);
    expect(() => externalGeneResult(gtexManifest, gtex, 'X', entry(gtex.id), negative(257))).toThrow('do not match');
  });
});
