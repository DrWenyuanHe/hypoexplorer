import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadReferenceExpression, loadReferenceManifest, referenceGeneResult, referenceJson, resetReferenceRequests } from '../expression-survey/referenceExpression';
import type { ReferenceManifest } from '../expression-survey/referenceExpression';

function publicJson(path: string): unknown {
  return JSON.parse(readFileSync(`public${path.split('?')[0]}`, 'utf8'));
}
function localFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => publicJson(url) })));
}
afterEach(() => { resetReferenceRequests(); vi.unstubAllGlobals(); });

describe('OXT cell expression reference', () => {
  it('retains cell identity and animal/pool qualifications without registering a contrast', async () => {
    localFetch();
    const manifest = await loadReferenceManifest();
    expect(manifest.sampleCount).toBe(146);
    expect(manifest.sources.map((source) => source.sampleCount).sort((a, b) => a! - b!)).toEqual([21, 125]);
    expect(new Set(manifest.samples.map((sample) => sample.sourceAnimalLabel))).toEqual(new Set(['M3', 'M4', 'M1-5']));
    expect(manifest.sources.every((source) => source.collection === 'reference' && !source.datasetId)).toBe(true);
    expect(manifest.samples.every((sample) => !sample.referenceEligible)).toBe(true);
    expect(manifest.sources.every((source) => source.replicateUnit.includes('not independent animal'))).toBe(true);
  });

  it('maps complete sample vectors to the correct source and source groups', async () => {
    localFetch();
    const manifest = await loadReferenceManifest();
    const values = manifest.samples.map((_, index) => index + .25);
    for (const source of manifest.sources) {
      const result = referenceGeneResult(manifest, source.id, 'test', { id: 'feature', symbol: 'test', ensemblId: 'ENSMUSG00000000001.1', values });
      const samples = result.groups.flatMap((group) => group.samples);
      expect(samples).toHaveLength(source.sampleCount!);
      for (const sample of samples) expect(sample.value).toBe(values[manifest.samples.findIndex((entry) => entry.id === sample.id)]);
      expect(result.groups.reduce((sum, group) => sum + group.n, 0)).toBe(source.sampleCount);
    }
    expect(() => referenceGeneResult(manifest, manifest.sources[0].id, 'test', { id: 'feature', symbol: 'test', ensemblId: '', values: [1] })).toThrow('sample manifest');
  });

  it('loads source genes lazily and distinguishes absent genes from measured zero', async () => {
    localFetch();
    const manifest = await loadReferenceManifest();
    const [oxt, missing] = await loadReferenceExpression(manifest.sources[0].id, ['Oxt', 'NOT_A_GENE_123']);
    expect(oxt.status).toBe('available');
    expect(oxt.unit).toMatch(/mRNA|molecules/);
    expect(oxt.groups.flatMap((group) => group.samples)).toHaveLength(manifest.sources[0].sampleCount!);
    expect(missing).toMatchObject({ status: 'not-retained', groups: [] });
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/shards/'))).toHaveLength(1);
  });

  it('rejects malformed source cohorts, unsafe paths and retries failed loads', async () => {
    const manifest = structuredClone(publicJson('/expression/oxt-reference/manifest.json')) as ReferenceManifest;
    manifest.samples[0].groupId = 'invented';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => manifest })));
    await expect(loadReferenceManifest()).rejects.toThrow('cohort metadata');
    resetReferenceRequests();
    await expect(referenceJson('/expression/oxt-reference/../neuroseq/manifest.json')).rejects.toThrow('asset path');
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (url: string) => ({ ok: true, json: async () => publicJson(url) }));
    vi.stubGlobal('fetch', fetcher);
    await expect(loadReferenceManifest()).rejects.toThrow('offline');
    await expect(loadReferenceManifest()).resolves.toMatchObject({ sampleCount: 146 });
  });
});
