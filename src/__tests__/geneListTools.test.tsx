import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, act, waitFor } from '@testing-library/react';
import { GeneExplorerTab } from '../gene-explorer/GeneExplorerTab';
import { CompareTab } from '../compare/CompareTab';
import { buildPopData } from '../data/buildPopData';
import { getActiveContrast } from '../data/contrasts';
import { _resetTrackCache } from '../data/loadTrack';
import { _resetNomenclature } from '../data/nomenclature';
import { _resetBundleCache, _setBundleTransport } from '../data/bundleSource';
import { useGeneSelection } from '../explorer/explorerSession';
import {
  POP_E9_FIXTURE, MACAQUE_DATASET, MACAQUE_CONTRAST, MULTICONTRAST_DATASET_FIXTURE,
  MULTICONTRAST_TRACK_FIXTURE, stubGeneSelection, stubVolcanoView,
} from './fixtures';
import type { RawTrack } from '../types';

// The gene-list buttons on the explorer's toolbar: a list goes in through the
// dialog (a file or a paste), is reported against the dataset BEFORE anything
// is selected, then lands in the selection; and the selection goes out as a
// file under the track's name.
//
// The Gene Explorer is rendered over the REAL useGeneSelection so the chips
// that appear are the production state, not a stub's echo.

const downloadFile = vi.fn((..._args: unknown[]) => {});
vi.mock('../utils/exportAction', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/exportAction')>()),
  downloadFile: (...args: unknown[]) => downloadFile(...args),
}));

// e9 stores POMC, IP6K1 and TBX3; AARS is added so an HGNC redirect (AARS1 →
// AARS) has something to land on.
const E9_WITH_AARS: RawTrack = {
  ...POP_E9_FIXTURE,
  de: [...(POP_E9_FIXTURE.de ?? []), { gene: 'AARS', logFC: 0.1, PValue: 0.6, FDR: 0.9 }],
  cpm: { ...POP_E9_FIXTURE.cpm, AARS: [3, 3, 3, 3, 3, 3] },
};
const popData = buildPopData(E9_WITH_AARS, MACAQUE_DATASET, MACAQUE_CONTRAST)!;

function Harness() {
  const geneSelection = useGeneSelection();
  return (
    <GeneExplorerTab
      geneSelection={geneSelection}
      volcano={stubVolcanoView()}
      popData={popData}
      nomenclatureAuthority="HGNC"
    />
  );
}

/** Mount, then let the (seeded) alias index land so its arrival is inside act. */
async function mount(ui = <Harness />) {
  render(ui);
  await act(async () => { await Promise.resolve(); });
}

const ALIAS_FIXTURE = { v: 1, rows: [['AARS', 0, 1, 'AARS1', '', '']] };

beforeEach(() => {
  downloadFile.mockClear();
  _resetNomenclature();
  _resetBundleCache();
  (globalThis as any).HX_NOMENCLATURE_ALIASES = ALIAS_FIXTURE;
  (globalThis as any).window.HX_NOMENCLATURE_ALIASES = ALIAS_FIXTURE;
});

afterEach(() => {
  cleanup();
  _setBundleTransport(null);
  (globalThis as any).HX_NOMENCLATURE_ALIASES = undefined;
  (globalThis as any).window.HX_NOMENCLATURE_ALIASES = undefined;
  _resetNomenclature();
  _resetBundleCache();
  _resetTrackCache();
});

const openDialog = () => {
  fireEvent.click(screen.getByRole('button', { name: /Load list/ }));
  return screen.getByRole('dialog', { name: 'Load a gene list' });
};

function pasteList(dialog: HTMLElement, text: string) {
  fireEvent.change(within(dialog).getByLabelText(/paste symbols/i), { target: { value: text } });
  fireEvent.click(within(dialog).getByRole('button', { name: /Read pasted list/ }));
}

const selectedCount = () => screen.getByText(/gene(s)? selected|no genes selected/).textContent;

describe('GeneExplorerTab — loading a gene list', () => {
  it('reports what a pasted list resolves to, then adds it to the selection', async () => {
    await mount();
    expect(selectedCount()).toBe('no genes selected');

    const dialog = openDialog();
    pasteList(dialog, 'POMC\ntbx3\nNOPE\n');

    // The report, before anything is selected.
    expect(within(dialog).getByText(/3 names/)).toBeTruthy();
    expect(within(dialog).getByText('2 genes')).toBeTruthy();
    expect(within(dialog).getByText(/1 name not in this dataset/)).toBeTruthy();
    expect(within(dialog).getByText('NOPE')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: /Add 2 genes to the selection/ }));
    expect(screen.queryByRole('dialog', { name: 'Load a gene list' })).toBeNull();
    // In the dataset's own spelling: tbx3 → TBX3.
    expect(selectedCount()).toBe('2 genes selected');
    expect(screen.getByRole('button', { name: 'Remove TBX3' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove POMC' })).toBeTruthy();
  });

  it('reads a CSV file handed to the file input and names the column it used', async () => {
    await mount();
    const dialog = openDialog();
    const file = new File(['Gene,logFC,PValue\nIP6K1,0.3,0.1\nPOMC,1.2,0.001\n'], 'e9_genes_summary.csv', { type: 'text/csv' });
    fireEvent.change(within(dialog).getByLabelText('Gene list file'), { target: { files: [file] } });

    expect(await within(dialog).findByText(/2 names/)).toBeTruthy();
    expect(within(dialog).getByText('e9_genes_summary.csv')).toBeTruthy();
    expect(within(dialog).getByText(/comma-separated table · column “Gene”/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /Add 2 genes/ }));
    expect(selectedCount()).toBe('2 genes selected');
  });

  it('resolves a current symbol to the retired one the dataset stores, and says so', async () => {
    await mount();
    const dialog = openDialog();
    // The alias index is loaded on mount; the report re-derives when it lands.
    pasteList(dialog, 'AARS1');
    expect(await within(dialog).findByText(/matched under another name/)).toBeTruthy();
    expect(within(dialog).getByText('AARS1 → AARS')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /Add 1 gene to the selection/ }));
    expect(screen.getByRole('button', { name: 'Remove AARS' })).toBeTruthy();
  });

  it('offers to replace an existing selection, and does', async () => {
    await mount();
    pasteList(openDialog(), 'POMC');
    fireEvent.click(screen.getByRole('button', { name: /Add 1 gene to the selection/ }));
    expect(selectedCount()).toBe('1 gene selected');

    const dialog = openDialog();
    pasteList(dialog, 'TBX3\nIP6K1');
    fireEvent.click(within(dialog).getByRole('button', { name: /Replace the selection/ }));
    expect(selectedCount()).toBe('2 genes selected');
    expect(screen.queryByRole('button', { name: 'Remove POMC' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove TBX3' })).toBeTruthy();
  });

  it('counts what is already selected rather than adding it twice', async () => {
    await mount();
    pasteList(openDialog(), 'POMC');
    fireEvent.click(screen.getByRole('button', { name: /Add 1 gene to the selection/ }));

    const dialog = openDialog();
    pasteList(dialog, 'POMC, TBX3');
    expect(within(dialog).getByText(/1 already selected/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /Add 1 new gene to the selection/ }));
    expect(selectedCount()).toBe('2 genes selected');
  });

  it('says when nothing in the input looked like a symbol', async () => {
    await mount();
    const dialog = openDialog();
    pasteList(dialog, '1.5\n2.0\n');
    expect(within(dialog).getByText(/No gene symbols were detected/)).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /to the selection/ })).toBeNull();
  });
});

describe('GeneExplorerTab — saving the selection', () => {
  it('is disabled with nothing selected', async () => {
    await mount();
    expect(screen.getByRole('button', { name: /Save list/ })).toBeDisabled();
  });

  it('writes the selection as a text file under the track code', async () => {
    await mount();
    pasteList(openDialog(), 'TBX3 POMC');
    fireEvent.click(screen.getByRole('button', { name: /Add 2 genes to the selection/ }));

    const save = screen.getByRole('button', { name: /Save list/ });
    expect(save).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(save);
    const menu = screen.getByRole('menu', { name: 'Save list as' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Text \(\.txt\)/ }));

    expect(screen.queryByRole('menu')).toBeNull();
    expect(downloadFile).toHaveBeenCalledTimes(1);
    const [name, href] = downloadFile.mock.calls[0] as [string, string];
    expect(name).toBe('e9_gene_list.txt');
    expect(decodeURIComponent(href.split(',')[1])).toBe('TBX3\nPOMC\n');
  });

  it('closes the format menu on Escape and on a click elsewhere', async () => {
    await mount();
    pasteList(openDialog(), 'POMC');
    fireEvent.click(screen.getByRole('button', { name: /Add 1 gene to the selection/ }));
    const save = screen.getByRole('button', { name: /Save list/ });

    fireEvent.click(save);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(save);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(downloadFile).not.toHaveBeenCalled();
  });
});

describe('VolcanoPlot — saving the threshold-passing genes', () => {
  it('writes the pass list with direction and statistics as CSV', async () => {
    await mount();
    // At the default p < 0.01 cutoff only POMC (p = 0.001) passes.
    const save = screen.getByRole('button', { name: /^Save ▾$/ });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    fireEvent.click(screen.getByRole('menuitem', { name: /CSV/ }));

    const [name, href] = downloadFile.mock.calls[0] as [string, string];
    expect(name).toBe('e9_threshold_genes.csv');
    expect(decodeURIComponent(href.split(',')[1])).toBe('Gene,Direction,log2FC,PValue,FDR\nPOMC,up,1.2,0.001,0.02\n');
  });

  it('is disabled when nothing passes', async () => {
    await mount(
      <GeneExplorerTab
        geneSelection={stubGeneSelection()}
        volcano={stubVolcanoView({ sigThresh: 10 })}
        popData={popData}
      />,
    );
    expect(screen.getByRole('button', { name: /^Save ▾$/ })).toBeDisabled();
  });
});

describe('CompareTab — loading a gene list', () => {
  it('resolves against the loaded populations and fills the compare grid', async () => {
    const DS = MULTICONTRAST_DATASET_FIXTURE;
    // CompareTab loads its populations itself (track columns), so the bundle
    // comes through a map-backed transport rather than a getTrack prop.
    _setBundleTransport(async (url) => (url.endsWith('/track_whole.js')
      ? { status: 'ok', value: MULTICONTRAST_TRACK_FIXTURE }
      : { status: 'load-failed' }));
    await mount(
      <CompareTab
        meta={null}
        dataset={DS}
        contrast={getActiveContrast(DS)}
        defaultPops={['whole']}
      />,
    );
    await waitFor(() => expect(screen.queryByText(/Loading whole/)).toBeNull());
    const dialog = openDialog();
    pasteList(dialog, 'IGFBP2\nNOPE');
    expect(within(dialog).getByText(/1 name not in the selected populations/)).toBeTruthy();
    act(() => { fireEvent.click(within(dialog).getByRole('button', { name: /Add 1 gene to the selection/ })); });
    expect(screen.getByRole('button', { name: 'Remove IGFBP2' })).toBeTruthy();
    // The summary row is the proof the selection reached the grid.
    expect(screen.getByRole('button', { name: 'Remove IGFBP2 row' })).toBeTruthy();
  });
});
