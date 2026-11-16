import { afterEach, describe, expect, it, vi } from 'vitest';
import wire from '../../services/hypomap/codetection_wire.json';
import type { Gene, ReadyAtlas } from '../search/hypomap/atlas';

// The golden is what services/hypomap/test_comparison_service.py proves the service serves.
const pin = vi.hoisted(() => ({ tag: 'hypomap-atlas-test', archive: '', archiveSha256: '', manifestSha256: '' }));
vi.mock('../../hypomap-release.json', () => ({ default: pin }));
pin.manifestSha256 = wire.index.source_export_manifest_sha256;

const { comparisonCsv, loadComparison, loadRanking } = await import('../search/hypomap/codetection');

const genes = wire.index.genes as Gene[];
const [agrp, npy, pomc, cartpt] = genes;
const ids = wire.index.datasets.map(ds => ds.id);

function atlas(overrides: Partial<ReadyAtlas['metadata']> = {}): ReadyAtlas {
  return {
    state: 'ready',
    gene: agrp,
    record: [0, [], []],
    geneAt: (position: number) => genes[position],
    metadata: {
      cohort: wire.index.cohort,
      contexts: ['Whole hypothalamus'],
      datasets: ids,
      eligible_cells: {},
      study_cards: wire.index.datasets.map(ds => ({ HypoMap_label: ds.label })),
      ...overrides,
    },
  } as ReadyAtlas;
}

const golden = (name: string) => {
  const request = wire.requests.find(entry => entry.name.startsWith(name));
  if (!request) throw new Error(`No golden request ${name}`);
  return request;
};

/** Serves `body` for exactly the golden request's URL. */
function serve(name: string, edit: (body: any) => unknown = body => body) {
  const request = golden(name);
  const expected = `/hypomap-preview-api/${request.endpoint}?${new URLSearchParams(Object.entries(request.params) as [string, string][])}`;
  const fetch = vi.fn(async (url: string) => url === expected
    ? new Response(JSON.stringify(edit(structuredClone(request.response))))
    : new Response('{"error":"Unknown endpoint"}', { status: 404 }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('loadRanking', () => {
  it('resolves service gene positions against the static export', async () => {
    serve('recommendations');
    expect(await loadRanking(atlas())).toEqual({
      state: 'ready', datasetCount: 3, queryPositive: 7, partners: [
        { gene: npy, both: 3, conditionalPercent: 300 / 7, reverseRank: 1 },
        { gene: pomc, both: 1, conditionalPercent: 100 / 7, reverseRank: 1 },
        { gene: cartpt, both: 1, conditionalPercent: 100 / 7, reverseRank: 1 },
      ],
    });
  });

  it('fails closed when the service was built from another export or cohort', async () => {
    serve('recommendations', body => ({ ...body, source_export_manifest_sha256: '0'.repeat(64) }));
    expect(await loadRanking(atlas())).toMatchObject({ state: 'rejected', reason: 'export-mismatch' });
    serve('recommendations', body => ({ ...body, source_export_manifest_sha256: undefined }));
    expect(await loadRanking(atlas())).toMatchObject({ state: 'rejected', reason: 'export-mismatch' });
    serve('recommendations');
    expect(await loadRanking(atlas({ cohort: 'another cohort' }))).toMatchObject({ state: 'rejected', reason: 'export-mismatch' });
  });

  it('rejects positions outside the export, repeats and another query gene', async () => {
    const cases: [(body: any) => void, RegExp][] = [
      [body => { body.record[3][0][0] = 99; }, /position 99 is not a distinct gene/],
      [body => { body.record[3][1][0] = 1; }, /position 1 is not a distinct gene/],
      [body => { body.record[3][0][0] = 0; }, /position 0 is not a distinct gene/],
      [body => { body.record[0] = 2; }, /another gene than Agrp/],
      [body => { body.record[1] = [0, 0]; }, /unknown or repeated datasets/],
      [body => { body.record[1] = [0, 1, 2, 18]; }, /unknown or repeated datasets/],
      [body => { body.record[3][2][1] = 9; }, /out of order or exceeds/],
      [body => { body.record.push(1); }, /extra fields/],
    ];
    for (const [edit, message] of cases) {
      serve('recommendations', body => { edit(body); return body; });
      const result = await loadRanking(atlas());
      expect(result).toMatchObject({ state: 'rejected', reason: 'invalid-response' });
      expect(result.state === 'rejected' && result.message).toMatch(message);
    }
  });

  it('rejects so a caller can retry when the transport fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad gateway', { status: 502 })));
    await expect(loadRanking(atlas())).rejects.toThrow(/HTTP 502/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>')));
    expect(await loadRanking(atlas())).toMatchObject({ state: 'rejected', reason: 'invalid-response', message: expect.stringMatching(/not JSON/) });
  });
});

describe('loadComparison', () => {
  it('returns ready when every selected dataset measures both genes', async () => {
    serve('ready');
    const result = await loadComparison(atlas(), npy, ['D1', 'D2']);
    expect(result.state).toBe('ready');
    if (result.state !== 'ready') return;
    expect(result.whole).toMatchObject({ eligible: 10, counts: { both: 3, queryOnly: 2, partnerOnly: 2, neither: 3 }, conditionalPercent: 60 });
    expect(result.datasets.map(row => [row.dataset, row.state, row.label])).toEqual([
      ['D1', 'measured', 'Fixture study one'], ['D2', 'measured', 'Fixture study two']]);
    expect(result.c7.map(row => [row.label, row.eligible])).toEqual([['GABA', 6], ['GLU', 4]]);
  });

  it('keeps an unsupported dataset as a named outcome, out of the pool', async () => {
    serve('partial');
    const result = await loadComparison(atlas(), npy, ['D1', 'D3']);
    expect(result.state).toBe('partial');
    if (result.state !== 'partial') return;
    expect(result.whole.eligible).toBe(6);
    expect(result.datasets.map(row => [row.dataset, row.state])).toEqual([['D1', 'measured'], ['D3', 'unsupported']]);
    expect(result.datasets[1]).toEqual({ state: 'unsupported', dataset: 'D3', label: 'Fixture study three', query: 'supported', partner: 'gene_not_found' });
  });

  it('reports unsupported, not zero eligible cells, when no selected dataset measures both genes', async () => {
    serve('unsupported');
    expect(await loadComparison(atlas(), npy, ['D3'])).toEqual({
      state: 'unsupported',
      datasets: [{ state: 'unsupported', dataset: 'D3', label: 'Fixture study three', query: 'supported', partner: 'gene_not_found' }],
    });
  });

  it('fails closed on an export mismatch', async () => {
    serve('ready', body => ({ ...body, source_export_manifest_sha256: 'f'.repeat(64) }));
    const result = await loadComparison(atlas(), npy, ['D1', 'D2']);
    expect(result).toMatchObject({ state: 'rejected', reason: 'export-mismatch' });
    expect(result.state === 'rejected' && result.message).toMatch(/different HypoMap export/);
  });

  it('rejects responses whose pooling, coverage or identity break the contract', async () => {
    /** Moves one cell from `neither` to `both`, keeping the summary internally consistent. */
    const shift = (row: any) => {
      row.counts.both += 1;
      row.counts.neither -= 1;
      const query = row.counts.both + row.counts.queryOnly;
      for (const key of Object.keys(row.counts)) row.percentages[key] = 100 * row.counts[key] / row.eligible;
      row.conditionalPercent = 100 * row.counts.both / query;
    };
    const cases: [(body: any) => void, RegExp][] = [
      [body => { body.whole.counts.both += 1; }, /pooled total categories do not sum/],
      [body => { body.whole.percentages.both = 31; }, /pooled total percentages disagree/],
      [body => { shift(body.whole); }, /pooled total is not the sum/],
      [body => { shift(body.c7[1]); }, /pooled C7 populations are not the sum/],
      [body => { body.c7.pop(); }, /pooled C7 populations are not the sum/],
      [body => { body.datasets[0].c7.pop(); }, /D1 C7 populations do not reconcile/],
      [body => { body.datasets[0].c7.push(body.datasets[0].c7[0]); }, /D1 C7 repeats a population/],
      [body => { body.datasets.pop(); }, /every selected dataset exactly once/],
      [body => { body.datasets[1].dataset = 'D1'; }, /every selected dataset exactly once/],
      [body => { body.unsupported.push({ dataset: 'D3', query: 'supported', partner: 'gene_not_found' }); }, /D3 was not selected/],
      [body => { body.unsupported.push({ dataset: 'D2', query: 'supported', partner: 'supported' }); }, /both genes are measured/],
      [body => { body.partner = 'G2'; }, /not Agrp × Npy/],
      [body => { body.region = 'ARC'; }, /not Agrp × Npy across the whole hypothalamus/],
      [body => { body.state = 'unsupported'; }, /state unsupported disagrees with 2 measured/],
      [body => { body.state = 'partial'; }, /unknown comparison state partial/],
    ];
    for (const [edit, message] of cases) {
      serve('ready', body => { edit(body); return body; });
      const result = await loadComparison(atlas(), npy, ['D1', 'D2']);
      expect(result).toMatchObject({ state: 'rejected', reason: 'invalid-response' });
      expect(result.state === 'rejected' && result.message).toMatch(message);
    }
  });
});

describe('comparisonCsv', () => {
  it('lists unsupported datasets with a status and empty values instead of zeros', async () => {
    serve('partial');
    const result = await loadComparison(atlas(), npy, ['D1', 'D3']);
    if (result.state !== 'partial') throw new Error(result.state);
    const csv = comparisonCsv(result, agrp, npy, null);
    expect(csv.title).toBe('Agrp × Npy · All hypothalamic cells');
    expect(csv.headers.slice(0, 5)).toEqual(['Dataset', 'Accession', 'Status', 'Eligible cells', 'Both genes (cells)']);
    expect(csv.rows.map(row => row.slice(0, 5))).toEqual([
      ['Aggregate', null, 'Pooled over 1 of 2 selected datasets', 6, 2],
      ['Fixture study one', 'D1', 'Measured', 6, 2],
      ['Fixture study three', 'D3', 'Not measured (Npy: not in this dataset)', null, null],
    ]);
    expect(csv.rows[2].slice(3).every(cell => cell === null)).toBe(true);
    expect(csv.rows.every(row => row.length === csv.headers.length)).toBe(true);
  });

  it('scopes every row to one C7 population', async () => {
    serve('ready');
    const result = await loadComparison(atlas(), npy, ['D1', 'D2']);
    if (result.state !== 'ready') throw new Error(result.state);
    const csv = comparisonCsv(result, agrp, npy, 'GLU');
    expect(csv.title).toBe('Agrp × Npy · GLU');
    expect(csv.rows.map(row => [row[0], row[3], row.at(-1)])).toEqual([
      ['Aggregate', 4, null], ['Fixture study one', 3, null], ['Fixture study two', 1, null]]);
  });
});
