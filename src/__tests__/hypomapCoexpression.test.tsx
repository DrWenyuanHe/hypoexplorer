import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import wire from '../../services/hypomap/codetection_wire.json';
import type { Gene } from '../search/hypomap/atlas';

const pin = vi.hoisted(() => ({ tag: 'hypomap-atlas-test', archive: '', archiveSha256: '', manifestSha256: '' }));
vi.mock('../../hypomap-release.json', () => ({ default: pin }));
pin.manifestSha256 = wire.index.source_export_manifest_sha256;

const genes = wire.index.genes as Gene[];
const metadata = {
  cohort: wire.index.cohort,
  contexts: ['Whole hypothalamus'],
  datasets: wire.index.datasets.map(ds => ds.id),
  eligible_cells: {},
  study_cards: wire.index.datasets.map(ds => ({ HypoMap_label: ds.label })),
};
vi.mock('../search/hypomap/atlas', () => ({
  loadAtlasGene: async (symbol: string) => {
    const i = genes.findIndex(gene => gene[1].toLowerCase() === symbol.toLowerCase());
    return i < 0 ? { state: 'missing' } : { state: 'ready', gene: genes[i], record: [i, [], []], metadata, geneAt: (p: number) => genes[p] };
  },
}));

const { Coexpression } = await import('../search/hypomap/Coexpression');

type Reply = { status?: number; body: unknown };
/** Answers golden URLs with their golden responses unless `override` names the endpoint. */
function serve(override: Record<string, () => Reply> = {}) {
  const fetch = vi.fn(async (url: string) => {
    const endpoint = url.split('?')[0].split('/').pop() as string;
    const custom = override[endpoint]?.();
    if (custom) return new Response(JSON.stringify(custom.body), { status: custom.status ?? 200 });
    const request = wire.requests.find(entry =>
      url === `/hypomap-preview-api/${entry.endpoint}?${new URLSearchParams(Object.entries(entry.params) as [string, string][])}`);
    return request ? new Response(JSON.stringify(request.response)) : new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/** Leaves only the given datasets checked, then picks Npy from the ranking. */
async function compare(keep: string[]) {
  render(<Coexpression symbol="Agrp" />);
  fireEvent.click(await screen.findByRole('button', { name: /^Npy/ }));
  const pair = screen.getByRole('region', { name: 'Agrp × Npy' });
  for (const ds of wire.index.datasets) {
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
    expect(screen.getByText(/across all 3 HypoMap datasets/)).toBeTruthy();
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
});
