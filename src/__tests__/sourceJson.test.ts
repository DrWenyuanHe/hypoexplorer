import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetSourceRequests, sourceJson } from '../expression-survey/sourceJson';
import type { SourceFamily } from '../expression-survey/sourceJson';

function okFetch() {
  const fetcher = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => ({ url }) }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

afterEach(() => { resetSourceRequests(); vi.unstubAllGlobals(); });

describe('release-local expression source transport', () => {
  it("accepts only each family's own generated files", async () => {
    const fetcher = okFetch();
    const accepted: Array<[SourceFamily, string]> = [
      ['neuroseq', '/expression/neuroseq/manifest.json'],
      ['neuroseq', '/expression/neuroseq/shards/a5.json'],
      ['oxt-reference', '/expression/oxt-reference/gene-index.json'],
      ['gtex', '/expression/gtex/lookup/l0042.json'],
      ['hpa', '/expression/hpa/values/v0001.json'],
      ['allen', '/expression/allen-human/validation.json'],
      ['visium', '/expression/visium/values/v1023.json'],
    ];
    for (const [family, path] of accepted) await expect(sourceJson(family, path)).resolves.toBeTruthy();
    const rejected: Array<[SourceFamily, string]> = [
      ['neuroseq', '/expression/oxt-reference/manifest.json'],
      ['gtex', '/expression/hpa/manifest.json'],
      ['neuroseq', '/expression/neuroseq/../gtex/manifest.json'],
      ['neuroseq', '/expression/neuroseq/shards/../../gtex/manifest.json'],
      ['neuroseq', '/expression/neuroseq/notes.json'],
      ['neuroseq', 'https://example.org/expression/neuroseq/manifest.json'],
      ['oxt-reference', '/expression/oxt-reference/lookup/l0001.json'],
      ['allen', '/expression/allen/manifest.json'],
      ['visium', '/expression/visium/counts.tsv.gz'],
      ['visium', '/expression/allen-human/manifest.json'],
      ['toString' as SourceFamily, '/expression/neuroseq/manifest.json'],
    ];
    for (const [family, path] of rejected) await expect(sourceJson(family, path)).rejects.toThrow('asset path');
    expect(fetcher).toHaveBeenCalledTimes(accepted.length);
  });

  it('versions each request by the app release and shares it between callers', async () => {
    const fetcher = okFetch();
    const [a, b] = await Promise.all([
      sourceJson('neuroseq', '/expression/neuroseq/manifest.json'),
      sourceJson('neuroseq', '/expression/neuroseq/manifest.json'),
    ]);
    expect(a).toBe(b);
    expect(await sourceJson('neuroseq', '/expression/neuroseq/manifest.json')).toBe(a);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(`/expression/neuroseq/manifest.json?v=${encodeURIComponent(__APP_VERSION__)}`, { cache: 'no-cache' });
  });

  it('forgets a failed request, whether rejected or answered with an error status', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: 1 }) });
    vi.stubGlobal('fetch', fetcher);
    const path = '/expression/oxt-reference/manifest.json';
    await expect(sourceJson('oxt-reference', path)).rejects.toThrow('offline');
    await expect(sourceJson('oxt-reference', path)).rejects.toThrow('Reference expression unavailable (503). Please retry.');
    await expect(sourceJson('oxt-reference', path)).resolves.toEqual({ ok: 1 });
    await sourceJson('oxt-reference', path);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('starts over after the test reset, across every family', async () => {
    const fetcher = okFetch();
    await sourceJson('neuroseq', '/expression/neuroseq/manifest.json');
    await sourceJson('gtex', '/expression/gtex/manifest.json');
    resetSourceRequests();
    await sourceJson('neuroseq', '/expression/neuroseq/manifest.json');
    await sourceJson('gtex', '/expression/gtex/manifest.json');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
