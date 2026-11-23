import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import wire from '../../services/hypomap/codetection_wire.json';
import { atlasFiles, fixtureDatasets, memoryTransport } from './hypomapFixture';

// The golden's genes and three datasets, inside an 18-dataset fixture export the atlas client
// reads through its in-memory transport. The service golden names the export it was built
// from; `serve` restates that identity as the fixture's manifest, which the release pin names.
const pin = vi.hoisted(() => ({ tag: 'hypomap-atlas-test', archive: '', archiveSha256: '', manifestSha256: '' }));
vi.mock('../../hypomap-release.json', () => ({ default: pin }));

const { _resetAtlasCache, _setAtlasTransport } = await import('../search/hypomap/atlas');
const { Coexpression } = await import('../search/hypomap/Coexpression');
const { HypoMapPreview } = await import('../search/hypomap/HypoMapPreview');

const datasets = [...wire.index.datasets.map(ds => ({ ...ds, eligible: [10] })), ...fixtureDatasets(18, () => [10]).slice(wire.index.datasets.length)];
const { files, manifestSha256 } = atlasFiles({
  cohort: wire.index.cohort,
  contexts: ['Whole hypothalamus'],
  datasets,
  genes: wire.index.genes as [string, string, string][],
});
let requests: string[] = [];

beforeEach(() => {
  pin.manifestSha256 = manifestSha256;
  _resetAtlasCache();
  const served = memoryTransport(files);
  requests = served.requests;
  _setAtlasTransport(served.transport);
});

type Reply = { status?: number; body: unknown };
/** Answers golden URLs with their golden responses unless `override` names the endpoint. */
function serve(override: Record<string, () => Reply> = {}) {
  const fetch = vi.fn(async (url: string) => {
    const endpoint = url.split('?')[0].split('/').pop() as string;
    const custom = override[endpoint]?.();
    if (custom) return new Response(JSON.stringify(custom.body), { status: custom.status ?? 200 });
    const request = wire.requests.find(entry =>
      url === `/hypomap-preview-api/${entry.endpoint}?${new URLSearchParams(Object.entries(entry.params) as [string, string][])}`);
    return request ? new Response(JSON.stringify({ ...request.response, source_export_manifest_sha256: pin.manifestSha256 }))
      : new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/** Leaves only the given datasets checked, then picks Npy from the ranking. */
async function compare(keep: string[]) {
  render(<Coexpression symbol="Agrp" />);
  fireEvent.click(await screen.findByRole('button', { name: /^Npy/ }));
  const pair = screen.getByRole('region', { name: 'Agrp × Npy' });
  for (const ds of datasets) {
    if (!keep.includes(ds.id)) fireEvent.click(within(pair).getByRole('checkbox', { name: ds.label }));
  }
  return pair;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('Coexpression', () => {
  it('ranks partners resolved from the export and names how many datasets the ranking spans', async () => {
    serve();
    render(<Coexpression symbol="Agrp" />);
    expect(await screen.findByRole('button', { name: /^Npy\s*42\.86%/ })).toBeTruthy();
    expect(screen.getByText(/across 3 of 18 HypoMap datasets/)).toBeTruthy();
    expect(screen.getByText('Agrp ranks #1 for Pomc')).toBeTruthy();
  });

  it('lists datasets left out of a partial pool', async () => {
    serve();
    const pair = await compare(['D1', 'D3']);
    const note = await within(pair).findByText(/1 of 2 selected datasets do not measure both genes/);
    expect(note.closest('[role="status"]')?.textContent).toContain('Fixture study three · Npy: not in this dataset');
    expect(within(pair).getByText(/6 eligible cells in all hypothalamic cells/)).toBeTruthy();
  });

  it('says no dataset measures both genes instead of showing zero eligible cells', async () => {
    serve();
    const pair = await compare(['D3']);
    expect(await within(pair).findByText('No selected dataset measures both Agrp and Npy, so there is no co-detection to show.')).toBeTruthy();
    expect(within(pair).queryByText(/eligible cells/)).toBeNull();
    expect(within(pair).queryByRole('button', { name: 'Preview comparison CSV' })).toBeNull();
  });

  it('refuses results from a service built on another export', async () => {
    const mismatch = (endpoint: string) => () => ({
      body: { ...wire.requests.find(entry => entry.endpoint === endpoint)?.response, source_export_manifest_sha256: '0'.repeat(64) },
    });
    serve({ recommendations: mismatch('recommendations') });
    render(<Coexpression symbol="Agrp" />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/different HypoMap export/);
    expect(screen.queryByRole('button', { name: /^Npy/ })).toBeNull();
  });

  it('offers Retry after a transport failure and recovers', async () => {
    let failures = 1;
    const fetch = serve({ recommendations: () => (failures-- > 0 ? { status: 502, body: { error: 'down' } } : undefined) as Reply });
    render(<Coexpression symbol="Agrp" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: /^Npy/ })).toBeTruthy();
    expect(fetch.mock.calls.filter(([url]) => url.includes('recommendations'))).toHaveLength(2);
  });

  it('resolves the gene once for both HypoMap cards and spells a miss the same way in each', async () => {
    serve();
    render(<><HypoMapPreview symbol="Agrp" /><Coexpression symbol="agrp" /></>);
    expect(await screen.findByRole('button', { name: /^Npy/ })).toBeTruthy();
    expect(await screen.findByRole('tablist', { name: 'HypoMap view' })).toBeTruthy();
    expect(requests.filter(file => file === 'genes-0000.json.gz')).toHaveLength(1);

    render(<><HypoMapPreview symbol="Nope" /><Coexpression symbol="Nope" /></>);
    expect(await screen.findAllByText('No HypoMap feature matched Nope.')).toHaveLength(2);
  });

  it('looks up a typed partner and reports a symbol the export cannot resolve', async () => {
    serve();
    render(<Coexpression symbol="Agrp" />);
    await screen.findByRole('button', { name: /^Npy/ });
    const before = requests.length;
    fireEvent.change(screen.getByRole('textbox', { name: 'Compare with a mouse gene' }), { target: { value: 'Nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compare genes' }));
    expect(await screen.findByText('No HypoMap feature matched Nope.')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Compare with a mouse gene' }), { target: { value: 'pomc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compare genes' }));
    expect(await screen.findByRole('region', { name: 'Agrp × Pomc' })).toBeTruthy();
    // Resolution reads only the cached search index; no expression shard is fetched for the partner.
    expect(requests.slice(before)).toEqual([]);
  });
});
