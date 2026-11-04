import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { _resetNomenclature } from '../data/nomenclature';
import { _resetBundleCache, _setBundleTransport } from '../data/bundleSource';
import { NomenclatureView } from '../nomenclature/NomenclatureView';

// The Gene nomenclature reference page (#/nomenclature).
//
// Like nomenclature.test.tsx, the table fixture is spelled as the GENERATOR
// emits it (scripts/build_nomenclature.mts) — wire rows, not client objects —
// because the row shape is a contract between two files that never import
// each other.
//
// Table wire row:
//   [symbol, authority, status, currentSymbol, geneName, aliases, prev, id, locusIx, nDatasets]
// Status codes in NOMENCLATURE_STATUS order: 0 current, 1 previous, 2 alias,
// 3 unrecognized. Authority codes: 0 HGNC, 1 MGI, 2 RGD, 3 chicken NCBI Gene.

const workbookMock = vi.hoisted(() => ({ writeWorkbook: vi.fn(() => Promise.resolve()) }));
vi.mock('../utils/workbook', () => workbookMock);

type Wire = [string, number, number, string, string, string, string, string, number, number];

const row = (r: Partial<Record<number, string | number>> & { 0: string }): Wire => {
  const base: Wire = [r[0], 1, 0, '', '', '', '', '', 0, 1];
  for (const [k, v] of Object.entries(r)) (base as unknown as Record<number, string | number>)[Number(k)] = v as string | number;
  return base;
};

/**
 * Five rows exercising every landing-rank tier and every searchable field:
 * a named gene measured everywhere (Agrp, with alias+prev), a retired symbol
 * (Aars -> Aars1), a RIKEN clone id, a predicted-gene id, and an unrecognized
 * counter artifact.
 */
const TABLE_FIXTURE = {
  v: 1,
  columns: [],
  locusTypes: ['', 'protein coding gene'],
  tally: { current: 2, previous: 2, alias: 0, unrecognized: 1 },
  sources: {},
  rows: [
    row({ 0: '__no_feature', 2: 3, 9: 58 }),
    row({ 0: '0610007C21Rik', 2: 1, 3: 'Atraid', 4: 'all-trans retinoic acid induced differentiation factor', 9: 40 }),
    row({ 0: 'Gm12345', 2: 0, 4: 'predicted gene 12345', 9: 12 }),
    row({ 0: 'Aars', 2: 1, 3: 'Aars1', 4: 'alanyl-tRNA synthetase 1', 8: 1, 9: 30 }),
    row({ 0: 'Agrp', 2: 0, 4: 'agouti related neuropeptide', 5: 'Agrt|ASIP2', 6: 'Agrt', 7: '87853', 8: 1, 9: 55 }),
  ],
};

function seedTable(payload: unknown = TABLE_FIXTURE) {
  (globalThis as any).HX_NOMENCLATURE_TABLE = payload;
  (globalThis as any).window.HX_NOMENCLATURE_TABLE = payload;
}

function clearTable() {
  (globalThis as any).HX_NOMENCLATURE_TABLE = undefined;
  (globalThis as any).window.HX_NOMENCLATURE_TABLE = undefined;
}

beforeEach(() => {
  _resetNomenclature();
  _resetBundleCache();
  workbookMock.writeWorkbook.mockClear();
});

afterEach(() => {
  clearTable();
  _setBundleTransport(null);
  _resetNomenclature();
  _resetBundleCache();
});

const mount = async (props: Partial<Parameters<typeof NomenclatureView>[0]> = {}) => {
  const utils = render(<NomenclatureView onHome={() => {}} {...props} />);
  // Flush the memoized loadNomenclatureTable() promise.
  await act(async () => {});
  return utils;
};

const search = async (value: string) => {
  fireEvent.change(screen.getByLabelText('Search nomenclature'), { target: { value } });
  // useDeferredValue: let the deferred re-render catch up.
  await act(async () => {});
};

/** Symbols in the order the table body renders them. */
const shownSymbols = () =>
  Array.from(document.querySelectorAll('tbody tr td:first-child'))
    .map((td) => td.textContent);

describe('NomenclatureView — data states', () => {
  it('says the table is unavailable when the bundle is absent', async () => {
    clearTable();
    // A deploy without the optional bundle: the script 404s, the loader
    // resolves null, and the page must say which deploy state this is.
    _setBundleTransport(() => Promise.resolve({ status: 'load-failed' }));
    await mount();
    expect(screen.getByText(/The nomenclature table is unavailable in this version/)).toBeTruthy();
  });

  it('renders the table with the results count once loaded', async () => {
    seedTable();
    await mount();
    expect(screen.getByText(/5 of 5 symbols/)).toBeTruthy();
    // The wire row decodes through the shared code tables: MGI authority,
    // fully-qualified authority id, locus type by index.
    expect(screen.getByTitle('MGI:87853')).toBeTruthy();
  });

  it('restores the RGD prefix for rat authority IDs', async () => {
    seedTable({
      ...TABLE_FIXTURE,
      tally: { current: 1, previous: 0, alias: 0, unrecognized: 0 },
      rows: [row({ 0: 'A2m', 1: 2, 7: '2004' })],
    });
    await mount();
    expect(screen.getByTitle('RGD:2004')).toBeTruthy();
  });

  it('shows ambiguous RGD candidates without selecting an authority link', async () => {
    seedTable({ ...TABLE_FIXTURE, rows: [row({ 0: '3110082J24Rik', 1: 2, 2: 4,
      3: 'Unchosen', 4: 'Ambiguous active RGD IDs: RGD:15004998; RGD:739527351', 7: '739527351' })] });
    await mount();
    expect(screen.getByRole('button', { name: /Ambiguous · 1/ })).toBeTruthy();
    expect(screen.getByText('Ambiguous active RGD IDs: RGD:15004998; RGD:739527351')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /RGD/ })).toBeNull();
    expect(document.querySelector('a[href*="739527351"]')).toBeNull();
  });

  it('restores GeneID without relabelling a chicken record as HGNC', async () => {
    seedTable({
      ...TABLE_FIXTURE,
      tally: { current: 1, previous: 0, alias: 0, unrecognized: 0 },
      rows: [row({ 0: 'POMC', 1: 3, 7: '396452' })],
    });
    await mount();
    expect(screen.getByTitle('GeneID:396452')).toHaveTextContent('NCBI Gene (Gallus gallus)');
  });

  it('explains native and author-projected namespaces', async () => {
    seedTable();
    await mount();
    expect(screen.getByText(/Native chicken, zebrafish, pig and cattle symbols/)).toBeTruthy();
    expect(screen.getByText(/hamster and dormouse tables/)).toBeTruthy();
  });
});

describe('NomenclatureView — landing order', () => {
  it('demotes placeholder identifiers below named genes', async () => {
    seedTable();
    await mount();
    // Rank 0 (named, by dataset count desc), then rank 1 (Rik/Gm clone ids),
    // then rank 2 (unrecognized) — NOT dataset count alone, which would put
    // the __no_feature artifact (58 datasets) first.
    expect(shownSymbols()).toEqual(['Agrp', 'Aars', '0610007C21Rik', 'Gm12345', '__no_feature']);
  });
});

describe('NomenclatureView — search', () => {
  it('matches aliases, previous symbols, current symbols and gene names', async () => {
    seedTable();
    await mount();

    await search('ASIP2'); // alias of Agrp
    expect(shownSymbols()).toEqual(['Agrp']);

    await search('Aars1'); // the CURRENT symbol of the stored, retired Aars
    expect(shownSymbols()).toEqual(['Aars']);

    await search('retinoic acid'); // gene name of the renamed RIKEN clone
    expect(shownSymbols()).toEqual(['0610007C21Rik']);
  });

  it('says so when nothing matches', async () => {
    seedTable();
    await mount();
    await search('XYZZY');
    expect(screen.getByText(/No symbol, alias, previous symbol or gene name matches/)).toBeTruthy();
  });
});

describe('NomenclatureView — filter chips', () => {
  it('filters by status, shows the blurb, and untoggles back to everything', async () => {
    seedTable();
    await mount();

    fireEvent.click(screen.getByRole('button', { name: /Outdated/ }));
    await act(async () => {});
    expect(shownSymbols()).toEqual(['Aars', '0610007C21Rik']);
    expect(screen.getByText(/The authority has replaced this symbol/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Outdated/ }));
    await act(async () => {});
    expect(screen.getByText(/5 of 5 symbols/)).toBeTruthy();
  });

  it('filters by authority', async () => {
    seedTable();
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'HGNC' }));
    await act(async () => {});
    // Every fixture row is MGI, so an HGNC filter empties the table.
    expect(screen.getByText(/0 of 5 symbols/)).toBeTruthy();
  });
});

describe('NomenclatureView — the 300-row rendering budget', () => {
  it('caps the rendered rows and says how to get the rest', async () => {
    seedTable({
      ...TABLE_FIXTURE,
      tally: { current: 301, previous: 0, alias: 0, unrecognized: 0 },
      rows: Array.from({ length: 301 }, (_, i) => row({ 0: `Gene${i}` })),
    });
    await mount();
    expect(screen.getByText(/showing the first 300/)).toBeTruthy();
    expect(shownSymbols()).toHaveLength(300);
  });
});

describe('NomenclatureView — Excel export', () => {
  it('exports the full FILTERED set, not the 300-row page', async () => {
    seedTable({
      ...TABLE_FIXTURE,
      tally: { current: 301, previous: 0, alias: 0, unrecognized: 0 },
      rows: Array.from({ length: 301 }, (_, i) => row({ 0: `Gene${i}` })),
    });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /Download Excel/ }));
    await act(async () => {});
    expect(workbookMock.writeWorkbook).toHaveBeenCalledTimes(1);
    const [, sheets] = workbookMock.writeWorkbook.mock.calls[0] as unknown as [
      string, Array<{ name: string; rows: Array<Record<string, unknown>> }>,
    ];
    // The row cap is a rendering budget; the download ignores it.
    expect(sheets[0].rows).toHaveLength(301);
  });

  it('is disabled when the filter matches nothing', async () => {
    seedTable();
    await mount();
    await search('XYZZY');
    expect((screen.getByRole('button', { name: /Download Excel/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('NomenclatureView — the gene-report link', () => {
  it('opens the cross-dataset report for a clicked symbol', async () => {
    seedTable();
    const onSearchGene = vi.fn();
    await mount({ onSearchGene });
    fireEvent.click(screen.getByRole('button', { name: 'Agrp' }));
    expect(onSearchGene).toHaveBeenCalledWith('Agrp');
  });

  it('renders symbols as plain text without the callback', async () => {
    seedTable();
    await mount();
    expect(screen.queryByRole('button', { name: 'Agrp' })).toBeNull();
    expect(shownSymbols()).toContain('Agrp');
  });
});
