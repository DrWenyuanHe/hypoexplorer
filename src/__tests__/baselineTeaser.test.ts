// The search/gene page's NeuroSeq teaser against the expression survey, both
// through the real reader over the release-local products in public/.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadNeuroseqExpression, loadNeuroseqManifest, neuroseqSources } from '../expression-survey/neuroseqExpression';
import { isBoundary } from '../expression-survey/expressionSurvey';
import { resetSourceRequests } from '../expression-survey/sourceJson';
import { loadBaselineTeaser, resetSearchSummaries } from '../search/searchSummaries';

function publicJson(url: string): unknown {
  return JSON.parse(readFileSync(`public${url.split('?')[0]}`, 'utf8'));
}
function productFetch(edit?: (url: string, body: any) => unknown) {
  const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => (edit ? edit(url, publicJson(url)) : publicJson(url)) }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

beforeEach(() => { resetSourceRequests(); resetSearchSummaries(); });
afterEach(() => { vi.unstubAllGlobals(); });

/** The survey's default NeuroSeq selection: every population but the SFO boundary records. */
async function surveyResults(query: string) {
  const sources = neuroseqSources(await loadNeuroseqManifest()).filter((source) => !isBoundary(source));
  return Promise.all(sources.map(async (source) => ({ source, result: (await loadNeuroseqExpression(source.id, [query]))[0] })));
}

describe('NeuroSeq baseline teaser', () => {
  it.each(['Agrp', 'Oxt', 'Pomc', 'ENSMUSG00000057722'])('reports exactly the survey group means for %s', async (query) => {
    productFetch();
    const teaser = await loadBaselineTeaser(query);
    if (teaser?.status !== 'available') throw new Error(`expected values for ${query}`);
    const survey = await surveyResults(query);
    const expected = survey.flatMap(({ source, result }) => result.groups.map((group) => ({
      id: group.key, populationId: source.id, meanTpm: group.mean, libraries: group.n,
      group: result.groups.length > 1 ? group.label : null,
    })));
    expect(teaser.groups.map(({ id, populationId, meanTpm, libraries, group }) => ({ id, populationId, meanTpm, libraries, group })))
      .toEqual(expect.arrayContaining(expected));
    expect(teaser.groups).toHaveLength(15);
    expect(teaser.populationCount).toBe(13);
    expect(teaser.gene).toBe(survey[0].result.gene);
    expect(teaser.groups.map((g) => g.meanTpm)).toEqual([...teaser.groups.map((g) => g.meanTpm)].sort((a, b) => b - a));
    expect(teaser.max).toBe(teaser.groups[0].meanTpm);
  });

  it('keeps the AgRP population source groups apart instead of pooling them', async () => {
    productFetch();
    const teaser = await loadBaselineTeaser('Agrp');
    if (teaser?.status !== 'available') throw new Error('expected Agrp values');
    const agrp = teaser.groups.filter((g) => g.populationId === 'HY.ARH_GABA_NPY-hrGFP');
    expect(agrp.map((g) => [g.group, g.libraries])).toEqual([['NPY-hrGFP_ARH', 2], ['NPY-hrGFP.p55.fed_ARH', 5]]);
    const [unreported, fed] = agrp.map((g) => g.meanTpm);
    expect(unreported / fed).toBeGreaterThan(5);
    const pooled = (unreported * 2 + fed * 5) / 7;
    expect(teaser.groups.some((g) => Math.abs(g.meanTpm - pooled) < 1)).toBe(false);
    expect(teaser.groups.filter((g) => g.group === null)).toHaveLength(11);
  });

  it('leaves out the SFO boundary records, as the survey does by default', async () => {
    productFetch();
    const teaser = await loadBaselineTeaser('Pomc');
    if (teaser?.status !== 'available') throw new Error('expected Pomc values');
    const all = neuroseqSources(await loadNeuroseqManifest());
    const boundary = all.filter(isBoundary).map((source) => source.id);
    expect(boundary).toHaveLength(2);
    expect(teaser.groups.some((g) => boundary.includes(g.populationId))).toBe(false);
    expect(teaser.groups.some((g) => /SFO/.test(g.label))).toBe(false);
  });

  it('reads the gene index and its shard once for all thirteen populations', async () => {
    const fetcher = productFetch();
    await loadBaselineTeaser('Pomc');
    const urls = fetcher.mock.calls.map(([url]) => String(url).split('?')[0]);
    expect(urls.filter((url) => url.includes('/shards/'))).toHaveLength(1);
    expect(urls.filter((url) => url.endsWith('/gene-index.json'))).toHaveLength(1);
    expect(urls.filter((url) => url.endsWith('/manifest.json'))).toHaveLength(1);
  });

  it('spells ambiguous candidates and absent genes as the survey does', async () => {
    productFetch();
    const teaser = await loadBaselineTeaser('ankrd23');
    const [{ result }] = await surveyResults('ankrd23');
    expect(result.status).toBe('ambiguous');
    expect(teaser).toEqual({ status: 'ambiguous', candidates: result.candidates });
    expect(result.candidates).toEqual(['ANKRD23 (id1922)', 'Ankrd23 (ENSMUSG00000067653)']);
    expect(await loadBaselineTeaser('NOT_A_GENE_123')).toEqual({ status: 'absent' });
  });

  it('distinguishes symbols that differ only by case, as the survey resolves them', async () => {
    productFetch();
    const exact = await loadBaselineTeaser('Ankrd23');
    if (exact?.status !== 'available') throw new Error('expected an exact match');
    expect(exact.gene).toBe('Ankrd23');
    expect((await loadBaselineTeaser('ANKRD23'))).toMatchObject({ status: 'available', gene: 'ANKRD23' });
  });

  it('rejects values the survey would reject, and retries after the failure', async () => {
    productFetch((url, body) => {
      if (!url.includes('/shards/')) return body;
      for (const row of Object.values(body.genes) as Array<{ symbol: string; values: number[] }>) {
        if (row.symbol === 'Pomc') row.values[0] = -1;
      }
      return body;
    });
    expect(await loadBaselineTeaser('Pomc')).toBeNull();
    await expect(loadNeuroseqExpression('HY.ARH_glu_Pomc-GFP', ['Pomc'])).rejects.toThrow('do not match');
    resetSourceRequests();
    productFetch();
    expect(await loadBaselineTeaser('Pomc')).toMatchObject({ status: 'available', gene: 'Pomc' });
  });
});
