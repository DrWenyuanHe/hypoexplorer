import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AtlasFixture, atlasFiles, fixtureDatasets, gzip, memoryTransport, type StudyCard } from './hypomapFixture';

// The atlas client read through its in-memory transport: the same bytes, checksums and
// gzip handling the browser's fetch adapter feeds it.
const pin = vi.hoisted(() => ({ tag: 'hypomap-atlas-test', archive: '', archiveSha256: '', manifestSha256: '' }));
vi.mock('../../hypomap-release.json', () => ({ default: pin }));

const {
  _resetAtlasCache, _setAtlasTransport, atlasTable, datasetSummary, datasetTable, EXPRESSION_UNIT, findAtlasGene, loadAtlasGene, missMessage,
  NO_REGION, spatialTable, WHOLE,
} = await import('../search/hypomap/atlas');

const ARC = 'Arcuate hypothalamic nucleus';
// D03 has no stored feature for Pomc: its metrics are unavailable, not zero. D04–D18 lack it too.
// D02's study card is partly filled, with a link and cell count the client must not trust; D03's is blank.
const eligible = [[100, 10, 5], [50, 0, 2], [40, 4, 1]];
const cards: Record<number, StudyCard> = {
  1: { Publication: 'Lab data, unpublished', Publication_link: 'javascript:alert(1)', Technology: '10x v2', N_cells_in_HypoMap: 'not stated' },
  2: { Region: '  ' },
};
const fixture: AtlasFixture = {
  contexts: [WHOLE, ARC, NO_REGION],
  datasets: fixtureDatasets(18, i => eligible[i] ?? [10, 1, 0]).map((ds, i) => i in cards ? { ...ds, card: cards[i] } : ds),
  genes: [
    ['ENSMUSG01', 'Pomc', 'pro-opiomelanocortin'],
    ['ENSMUSG02', 'Agrp', 'agouti related neuropeptide'],
    ['ENSMUSG03', 'Npy', 'neuropeptide Y'],
    ['ENSMUSG04', 'Cartpt', 'CART prepropeptide'],
  ],
  aliases: { pomc1: [0], shared: [1, 2], cart: [3] },
  outside: { cart: ['Cart-ps'], npy: ['Npy-ps'], agrp2: ['Agrp2'] },
  records: { 0: [[[20, 5, 1], [40, 10, 2]], [[0, 0, 0], [0, 0, 0]], ...Array(16).fill(null)] },
};

function serve(spec: AtlasFixture = fixture, fail?: Set<string>) {
  const { files, manifestSha256 } = atlasFiles(spec);
  pin.manifestSha256 = manifestSha256;
  const served = memoryTransport(files, fail);
  _setAtlasTransport(served.transport);
  return { ...served, files };
}

async function ready(symbol = 'Pomc') {
  const result = await loadAtlasGene(symbol);
  if (result.state !== 'ready') throw new Error(`${symbol} did not resolve`);
  return result;
}

beforeEach(() => { _resetAtlasCache(); });

describe('loadAtlasGene', () => {
  it('resolves a symbol to a named gene record with its datasets and region vocabulary', async () => {
    serve();
    const atlas = await ready(' POMC ');
    expect({ id: atlas.gene.id, symbol: atlas.gene.symbol, name: atlas.gene.name })
      .toEqual({ id: 'ENSMUSG01', symbol: 'Pomc', name: 'pro-opiomelanocortin' });
    expect(atlas.datasets).toHaveLength(18);
    expect(atlas.datasets.map(ds => ds.id).slice(0, 3)).toEqual(['D01', 'D02', 'D03']);
    expect(atlas.regions).toEqual([WHOLE, ARC, NO_REGION]);
    expect(atlas.namedRegions).toEqual([ARC]);
  });

  it('reads each study card into named fields, a blank or untrusted field as null', async () => {
    serve();
    const [filled, partial, blank] = (await ready()).datasets;
    expect(filled).toEqual({
      id: 'D01', label: 'Study 1', publication: 'Author1 et al. 2021, Cell', publicationUrl: 'https://pubmed.ncbi.nlm.nih.gov/1001/',
      technology: '10x v3', cellsOrNuclei: 'cells', sampledRegion: 'Hypothalamus', sex: 'M & F', ageStage: 'adult (6+ wk)',
      condition: 'normal chow', cellsInHypoMap: 1000,
    });
    expect(partial).toMatchObject({ publication: 'Lab data, unpublished', publicationUrl: null, technology: '10x v2', cellsOrNuclei: null, cellsInHypoMap: null });
    expect(blank).toEqual({
      id: 'D03', label: 'Study 3', publication: null, publicationUrl: null, technology: null, cellsOrNuclei: null,
      sampledRegion: null, sex: null, ageStage: null, condition: null, cellsInHypoMap: null,
    });
  });

  it('reads each dataset for one region and keeps an absent feature unavailable', async () => {
    serve();
    expect((await ready()).byDataset(ARC).slice(0, 4)).toEqual([
      { id: 'D01', label: 'Study 1', eligible: 10, positive: 5, logSum: 10, detection: 50, mean: 2 },
      { id: 'D02', label: 'Study 2', eligible: 0, positive: 0, logSum: 0, detection: null, mean: null },
      { id: 'D03', label: 'Study 3', eligible: 4, positive: null, logSum: null, detection: null, mean: null },
      { id: 'D04', label: 'Study 4', eligible: 1, positive: null, logSum: null, detection: null, mean: null },
    ]);
  });

  it('pools cells over datasets that measured the gene, leaving out unavailable ones', async () => {
    serve();
    const { pooled } = await ready();
    expect(pooled[WHOLE]).toEqual({ eligible: 150, positive: 20, logSum: 40, detection: 100 * 20 / 150, mean: 2 });
    expect(pooled[ARC]).toEqual({ eligible: 10, positive: 5, logSum: 10, detection: 50, mean: 2 });
  });

  it('reports no detection when no dataset measured the gene', async () => {
    serve();
    expect((await ready('Agrp')).pooled[ARC]).toEqual({ eligible: 0, positive: 0, logSum: 0, detection: null, mean: null });
  });

  it('reads stored gzip files and files a host has already decoded alike', async () => {
    serve({ ...fixture, encoding: 'identity' });
    const decoded = await ready();
    _resetAtlasCache();
    serve();
    const stored = await ready();
    expect(decoded.pooled).toEqual(stored.pooled);
  });

  it('refuses a file whose checksum disagrees with the manifest, and a manifest other than the pinned one', async () => {
    const { files } = serve();
    files['metadata.json.gz'] = gzip({ altered: true });
    await expect(loadAtlasGene('Pomc')).rejects.toThrow('Atlas file checksum mismatch');

    _resetAtlasCache();
    serve();
    pin.manifestSha256 = '0'.repeat(64);
    await expect(loadAtlasGene('Pomc')).rejects.toThrow('Atlas file checksum mismatch');
  });

  it('rejects an export without the published 18 datasets', async () => {
    serve({ ...fixture, datasets: fixture.datasets.slice(0, 17) });
    await expect(loadAtlasGene('Pomc')).rejects.toThrow('Expected the published 18-dataset HypoMap export');
  });

  it('rejects a shard whose record belongs to another gene', async () => {
    serve({ ...fixture, edit: { 'genes-0000.json.gz': ([first, second]) => [second, first] } });
    await expect(loadAtlasGene('Pomc')).rejects.toThrow('Atlas gene identity mismatch');
  });

  it('loads a gene once per symbol for every caller and forgets a failed load', async () => {
    const fail = new Set(['genes-0000.json.gz']);
    const { requests } = serve(fixture, fail);
    await expect(loadAtlasGene('Pomc')).rejects.toThrow(/Transport failed/);
    const [first, second] = await Promise.all([loadAtlasGene('Pomc'), loadAtlasGene(' pomc')]);
    expect(first).toBe(second);
    expect(requests.filter(file => file === 'genes-0000.json.gz')).toHaveLength(2);
    expect(requests.filter(file => file === 'metadata.json.gz')).toHaveLength(1);
    expect(requests).not.toContain('genes-0001.json.gz');

    _resetAtlasCache();
    await loadAtlasGene('Pomc');
    expect(requests.filter(file => file === 'metadata.json.gz')).toHaveLength(2);
  });
});

describe('symbol resolution', () => {
  it('resolves aliases, refuses ambiguity and treats a lone outside-export candidate as missing', async () => {
    const { requests } = serve();
    const symbolOf = async (symbol: string) => {
      const result = await findAtlasGene(symbol);
      return result.state === 'ready' ? result.gene.symbol : result;
    };
    expect(await symbolOf('POMC1')).toBe('Pomc');
    expect(await symbolOf('Npy')).toBe('Npy');
    expect(await symbolOf('shared')).toEqual({ state: 'ambiguous', candidates: ['Agrp', 'Npy'] });
    expect(await symbolOf('cart')).toEqual({ state: 'ambiguous', candidates: ['Cartpt', 'Cart-ps'] });
    expect(await symbolOf('Agrp2')).toEqual({ state: 'missing' });
    expect(await symbolOf('constructor')).toEqual({ state: 'missing' });
    expect(await loadAtlasGene('shared')).toEqual({ state: 'ambiguous', candidates: ['Agrp', 'Npy'] });
    // Resolution alone reads the search index, never an expression shard.
    expect(requests.filter(file => file.startsWith('genes-'))).toEqual([]);
  });

  it('spells a miss the same way for every card', () => {
    expect(missMessage({ state: 'missing' }, 'Oxt')).toBe('No HypoMap feature matched Oxt.');
    expect(missMessage({ state: 'ambiguous', candidates: ['Cartpt', 'Cart-ps'] }, 'cart'))
      .toBe('Multiple HypoMap features match cart. Search a canonical symbol: Cartpt, Cart-ps.');
  });
});

describe('dataset summary and tables', () => {
  it('summarizes the datasets with values by their unweighted mean and SEM', async () => {
    serve();
    const rows = (await ready()).byDataset(WHOLE);
    expect(datasetSummary(rows, 'detection')).toEqual({ values: [20, 0], mean: 10, sem: 10 });
    expect(datasetSummary(rows, 'mean')).toEqual({ values: [2], mean: 2, sem: null });
    expect(datasetSummary([], 'mean')).toEqual({ values: [], mean: null, sem: null });
  });

  it('builds the spatial table from every scope, recording the release it was read from', async () => {
    serve();
    const atlas = await ready();
    expect(spatialTable(atlas)).toEqual({
      kind: 'hypomap_spatial',
      csv: {
        title: 'Pomc · Spatial expression',
        headers: ['Region', 'Eligible cells', 'Detected cells', '% detected', EXPRESSION_UNIT],
        rows: [[WHOLE, 150, 20, 100 * 20 / 150, 2], [ARC, 10, 5, 50, 2], [NO_REGION, 7, 1, 100 / 7, 2]],
      },
      subject: {
        shape: 'atlas', release: { tag: 'hypomap-atlas-test', manifestSha256: pin.manifestSha256 }, cohort: 'fixture cohort',
        gene: { id: 'ENSMUSG01', symbol: 'Pomc' }, expressionUnit: EXPRESSION_UNIT,
      },
      settings: {},
    });
  });

  it('builds the by-dataset table for the chosen datasets in export order', async () => {
    serve();
    const atlas = await ready();
    const detection = datasetTable(atlas, ARC, 'detection', ['D03', 'D01']);
    expect(detection.kind).toBe('hypomap_datasets');
    expect(detection.csv).toEqual({
      title: `Pomc · ${ARC} · Detection by dataset`,
      headers: ['Dataset', 'Accession', 'Region', '% detected', 'Publication', 'Technology'],
      rows: [['Study 1', 'D01', ARC, 50, 'Author1 et al. 2021, Cell', '10x v3'], ['Study 3', 'D03', ARC, null, null, null]],
    });
    expect(detection.settings).toEqual({ region: ARC, metric: 'detection', datasets: ['D03', 'D01'] });
    // A table of percentages never records the log-expression unit.
    expect(detection.subject.expressionUnit).toBe('Not applicable: percentages of eligible cells.');
    const mean = datasetTable(atlas, WHOLE, 'mean', ['D01']);
    expect(mean.csv.title).toBe(`Pomc · ${WHOLE} · Mean expression by dataset`);
    expect(mean.csv.headers[3]).toBe(EXPRESSION_UNIT);
    expect(mean.csv.rows).toEqual([['Study 1', 'D01', WHOLE, 2, 'Author1 et al. 2021, Cell', '10x v3']]);
    expect(mean.subject.expressionUnit).toBe(EXPRESSION_UNIT);
  });

  it('wraps a co-detection comparison table as counts and percentages, with no expression unit', async () => {
    serve();
    const atlas = await ready();
    const csv = { title: 'Pomc × Agrp', headers: ['Dataset'], rows: [['Study 1']] };
    const comparison = atlasTable(atlas, csv, { population: null });
    expect(comparison).toMatchObject({ kind: 'hypomap_comparison', csv, settings: { population: null } });
    expect(comparison.subject.expressionUnit).toBe('Not applicable: cell counts and percentages of eligible cells.');
  });
});
