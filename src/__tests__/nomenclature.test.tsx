import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import {
  loadAliasIndex, factsFor, resolveByOtherName, _resetNomenclature,
  nomenclatureAuthorityForOrganism, NOMENCLATURE_AUTHORITIES, NOMENCLATURE_STATUS,
  type AliasIndex,
} from '../data/nomenclature';
import { _resetBundleCache, _setBundleTransport } from '../data/bundleSource';
import { stubGeneSelection, stubVolcanoView } from './fixtures';

// The nomenclature table: the alias/previous-symbol index behind gene search,
// and the "this symbol is outdated" markers it drives.
//
// The wire fixture below is deliberately spelled as the GENERATOR emits it
// (scripts/build_nomenclature.mts) rather than through a builder helper — the
// row shape is a contract between two files that never import each other, so a
// test that constructs it the client's way could not catch the two of them
// drifting apart.
//
// Status codes, in NOMENCLATURE_STATUS order: 0 current, 1 previous, 2 alias,
// 3 unrecognized. Authority codes: 0 HGNC, 1 MGI, 2 RGD, then one NCBI Gene
// namespace per native species (chicken, zebrafish, pig, cattle).
const ALIAS_FIXTURE = {
  v: 1,
  rows: [
    // The case that matters most: the SAME retired symbol in both species,
    // spelled differently. Macaque stores 'AARS'; mouse stores 'Aars'.
    ['AARS', 0, 1, 'AARS1', '', ''],
    ['Aars', 1, 1, 'Aars1', '', ''],
    // A current symbol with aliases (the toggle's payload) and, in mouse, a
    // previous symbol of its own.
    ['AGRP', 0, 0, 0, 'Agrt|ART|ASIP2', ''],
    ['Agrp', 1, 0, 0, 'Agrt|agouti related protein', 'Agrt'],
    // A gene whose own symbol also appears in its synonym list — MGI does this
    // often, and it must not become a self-redirect.
    ['Pomc', 1, 0, 0, 'Pomc|Pomc1', ''],
    // Identical uppercase spelling in two native namespaces. These must stay
    // distinct even though both are exact case matches.
    ['POMC', 0, 0, 0, 'HUMANPOMCALIAS', ''],
    ['POMC', 3, 0, 0, 'CHICKENPOMCALIAS', ''],
  ],
};

function seedAliases(payload: unknown = ALIAS_FIXTURE) {
  (globalThis as any).HX_NOMENCLATURE_ALIASES = payload;
  (globalThis as any).window.HX_NOMENCLATURE_ALIASES = payload;
}

function clearAliases() {
  (globalThis as any).HX_NOMENCLATURE_ALIASES = undefined;
  (globalThis as any).window.HX_NOMENCLATURE_ALIASES = undefined;
}

beforeEach(() => {
  _resetNomenclature();
  _resetBundleCache();
  seedAliases();
});

afterEach(() => {
  clearAliases();
  _setBundleTransport(null);
  _resetNomenclature();
  _resetBundleCache();
});

/** The dataset's gene list, in the shape the search box passes down. */
const known = (...names: string[]) => new Map(names.map((n) => [n.toUpperCase(), n] as const));

describe('nomenclature — the alias index', () => {
  it('indexes a stored symbol under every other name it answers to', async () => {
    const index = await loadAliasIndex() as AliasIndex;
    expect(index).toBeTruthy();
    // Its current symbol (someone typing the new name)…
    expect(index.byOtherName.get('AARS1')).toContain('AARS');
    // …its aliases…
    expect(index.byOtherName.get('ASIP2')).toContain('AGRP');
    // …and its previous symbols.
    expect(index.byOtherName.get('AGRT')).toContain('Agrp');
  });

  it('does not index a symbol as its own alias', async () => {
    const index = await loadAliasIndex() as AliasIndex;
    // MGI lists 'Pomc' among Pomc's own synonyms. Left alone, every such gene
    // would show up in its own suggestion list a second time, labelled as a
    // redirect to itself.
    expect(index?.byOtherName.get('POMC')).toBeUndefined();
    expect(index?.byOtherName.get('POMC1')).toContain('Pomc');
  });

  it('keeps both species\' spellings of a case-colliding symbol', async () => {
    const index = await loadAliasIndex() as AliasIndex;
    const both = index?.bySymbol.get('AARS');
    expect(both?.map((f) => f.symbol).sort()).toEqual(['AARS', 'Aars']);
    expect(both?.map((f) => f.authority).sort()).toEqual(['HGNC', 'MGI']);
  });

  it('resolves to the DATASET\'s spelling, never the other species\'', async () => {
    const index = await loadAliasIndex();
    // The regression this guards. 'AARS1' redirects to a symbol in both species,
    // and both uppercase to 'AARS'. Filtering a case-insensitive SET passed both
    // for either dataset, so the macaque atlas offered the mouse-spelled 'Aars'
    // — a gene it does not contain, which selects into an empty chart.
    expect(resolveByOtherName(index, 'AARS1', known('AARS', 'POMC'))).toEqual(['AARS']);
    expect(resolveByOtherName(index, 'AARS1', known('Aars', 'Pomc'))).toEqual(['Aars']);
  });

  it('offers no redirect for a symbol the dataset already has', async () => {
    const index = await loadAliasIndex();
    // AGRP is present, so it needs no redirect — returning one would put a
    // duplicate at the top of every successful search.
    expect(resolveByOtherName(index, 'AGRP', known('AGRP'))).toEqual([]);
  });

  it('picks the record matching the exact spelling asked about', async () => {
    const index = await loadAliasIndex();
    expect(factsFor(index, 'AARS')?.authority).toBe('HGNC');
    expect(factsFor(index, 'Aars')?.authority).toBe('MGI');
    expect(factsFor(index, 'AARS')?.currentSymbol).toBe('AARS1');
    expect(factsFor(index, 'Aars')?.currentSymbol).toBe('Aars1');
  });

  it('requires an authority when exact spellings collide across species', async () => {
    const index = await loadAliasIndex();
    expect(factsFor(index, 'POMC')).toBeNull();
    expect(factsFor(index, 'POMC', 'HGNC')?.authority).toBe('HGNC');
    expect(factsFor(index, 'POMC', 'NCBI Gene (Gallus gallus)')?.authority)
      .toBe('NCBI Gene (Gallus gallus)');
    expect(resolveByOtherName(
      index, 'CHICKENPOMCALIAS', known('POMC'), 'NCBI Gene (Gallus gallus)',
    )).toEqual(['POMC']);
    expect(resolveByOtherName(index, 'CHICKENPOMCALIAS', known('POMC'), 'HGNC')).toEqual([]);
    // A cross-species union has no honest way to attribute the shared POMC
    // spelling, so the same alias fails closed when no authority is supplied.
    expect(resolveByOtherName(index, 'CHICKENPOMCALIAS', known('POMC'))).toEqual([]);
  });

  it('degrades to no alias knowledge rather than failing', async () => {
    // An older deploy, or a failed request. Driven through the transport seam
    // rather than by unsetting the global: with no transport installed the
    // loader falls back to injecting a <script>, and jsdom loads no
    // subresources, so neither onload nor onerror ever fires and the promise
    // simply never settles.
    clearAliases();
    _resetNomenclature();
    _resetBundleCache();
    _setBundleTransport(() => Promise.resolve({ status: 'missing-global' as const }));

    // Every entry point has to keep working — the explorer searched symbols
    // directly before this table existed and must go on doing so without it.
    expect(await loadAliasIndex()).toBeNull();
    expect(factsFor(null, 'AARS')).toBeNull();
    expect(resolveByOtherName(null, 'AARS1', known('AARS'))).toEqual([]);
  });

  it('states its status codes in the order the generator writes them', () => {
    // The wire format is a pair of numbers; this is the only place the two
    // sides' agreement on what 1 means is written down on the client.
    expect(NOMENCLATURE_STATUS).toEqual(['current', 'previous', 'alias', 'unrecognized', 'ambiguous']);
    expect(NOMENCLATURE_AUTHORITIES).toEqual([
      'HGNC', 'MGI', 'RGD',
      'NCBI Gene (Gallus gallus)',
      'NCBI Gene (Danio rerio)',
      'NCBI Gene (Sus scrofa)',
      'NCBI Gene (Bos taurus)',
    ]);
  });

  it('maps registry organisms to their actual stored-feature namespaces', () => {
    expect(nomenclatureAuthorityForOrganism('Homo sapiens')).toBe('HGNC');
    expect(nomenclatureAuthorityForOrganism('Gallus gallus')).toBe('NCBI Gene (Gallus gallus)');
    expect(nomenclatureAuthorityForOrganism('Danio rerio')).toBe('NCBI Gene (Danio rerio)');
    expect(nomenclatureAuthorityForOrganism('Sus scrofa')).toBe('NCBI Gene (Sus scrofa)');
    expect(nomenclatureAuthorityForOrganism('Bos taurus')).toBe('NCBI Gene (Bos taurus)');
    expect(nomenclatureAuthorityForOrganism('Phodopus sungorus')).toBe('MGI');
    expect(nomenclatureAuthorityForOrganism('Eliomys quercinus')).toBe('MGI');
  });

  it('decodes RGD authority rows without treating them as MGI', async () => {
    seedAliases({ v: 1, rows: [['Narp', 2, 1, 'Nptx2', '', '']] });
    _resetNomenclature();
    _resetBundleCache();
    const index = await loadAliasIndex();
    expect(factsFor(index, 'Narp')).toMatchObject({ authority: 'RGD', currentSymbol: 'Nptx2' });
  });

  it('never redirects an ambiguous rat name through either side of the alias index', async () => {
    seedAliases({ v: 1, rows: [
      ['Collision', 2, 4, 'ChosenByMistake', 'OutgoingAlias', 'OldCollision'],
      ['OtherGene', 2, 0, 0, 'Collision', ''],
    ] });
    const index = await loadAliasIndex();
    expect(factsFor(index, 'Collision', 'RGD')).toMatchObject({ status: 'ambiguous', currentSymbol: '', aliases: [], prevSymbols: [] });
    expect(resolveByOtherName(index, 'Collision', known('OtherGene'), 'RGD')).toEqual([]);
    expect(resolveByOtherName(index, 'OutgoingAlias', known('Collision'), 'RGD')).toEqual([]);
  });
});

describe('GeneSearchBox — searching by another name', () => {
  const GENE_NAMES = ['AARS', 'AGRP', 'AGRN', 'POMC'];

  async function box(onAdd = vi.fn()) {
    const { GeneSearchBox } = await import('../gene-explorer/GeneSearchBox');
    // The index loads from an effect, so let it land before the test types.
    await act(async () => {
      render(<GeneSearchBox onAdd={onAdd} selectedGenes={[]} geneNames={GENE_NAMES} />);
      await loadAliasIndex();
    });
    return { onAdd, input: screen.getByLabelText('Search gene') };
  }

  async function type(input: HTMLElement, value: string) {
    await act(async () => {
      fireEvent.change(input, { target: { value } });
      // The search is debounced at 80 ms.
      await new Promise((r) => setTimeout(r, 140));
    });
  }

  it('finds a stored retired symbol from the current one', async () => {
    const { input } = await box();
    await type(input, 'AARS1');
    // AARS1 is not in the dataset; AARS is, under the name the authority retired.
    const hit = screen.getByRole('button', { name: /AARS/ });
    expect(hit.textContent).toContain('AARS');
    expect(hit.textContent).toContain('now AARS1');
  });

  it('finds a gene by an alias', async () => {
    const { input, onAdd } = await box();
    await type(input, 'ASIP2');
    const hit = screen.getByRole('button', { name: /AGRP/ });
    expect(hit.textContent).toContain('matched ASIP2');
    // Committing selects the DATASET's symbol, not the alias that was typed.
    fireEvent.mouseDown(hit);
    expect(onAdd).toHaveBeenCalledWith('AGRP');
  });

  it('ranks an exact match above a prefix match', async () => {
    const { input } = await box();
    await type(input, 'AGRP');
    // AGRN also starts with 'AGR'; AGRP is what was typed. The old
    // starts-with-then-contains concatenation left this to source ordering.
    const options = screen.getAllByRole('button').filter((b) => /^(AGRP|AGRN)/.test(b.textContent ?? ''));
    expect(options[0].textContent).toContain('AGRP');
  });

  it('shows alias and previous symbols only when the toggle is on', async () => {
    const { input } = await box();
    await type(input, 'AGRP');
    expect(screen.getByRole('button', { name: /AGRP/ }).textContent).not.toContain('ASIP2');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Aliases/i })); });
    await type(input, 'AGRP');
    expect(screen.getByRole('button', { name: /AGRP/ }).textContent).toContain('ASIP2');
  });

  it('commits the top suggestion on Enter, redirect included', async () => {
    const { input, onAdd } = await box();
    await type(input, 'AARS1');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAdd).toHaveBeenCalledWith('AARS');
  });
});

describe('GeneExplorerTab — the view buttons are always reachable', () => {
  async function explorer() {
    const { GeneExplorerTab } = await import('../gene-explorer/GeneExplorerTab');
    const { buildPopData } = await import('../data/buildPopData');
    const { HX_MACAQUE_SNRNA_E9_FIXTURE, MACAQUE_DATASET, MACAQUE_CONTRAST } = await import('./fixtures');
    const popData = buildPopData(HX_MACAQUE_SNRNA_E9_FIXTURE, MACAQUE_DATASET, MACAQUE_CONTRAST)!;
    await act(async () => {
      render(
        <GeneExplorerTab
          geneSelection={stubGeneSelection()}
          volcano={stubVolcanoView()}
          popData={popData}
        />,
      );
      await loadAliasIndex();
    });
  }

  it('offers Bar charts and Summary table with nothing selected', async () => {
    await explorer();
    // They used to appear only once a gene was picked, which hid both views
    // behind a step nothing on screen mentioned.
    expect(screen.getByRole('button', { name: /Bar charts/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Summary table/i })).toBeTruthy();
  });

  it('opens on a prompt that can fill the selection it is missing', async () => {
    await explorer();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Bar charts/i })); });
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/Select a gene/i)).toBeTruthy();
    // The prompt carries a real search box, so the pop-up is a way IN rather
    // than a dead end you have to close to get past.
    expect(dialog.getByLabelText('Search gene')).toBeTruthy();
  });

  it('titles an empty pop-up without a "0 genes" count', async () => {
    await explorer();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Summary table/i })); });
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-label') ?? '').not.toMatch(/0 genes/);
  });
});
