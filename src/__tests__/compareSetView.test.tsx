import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { CompareSetView } from '../compareset/CompareSetView';
import {
  _resetBundleCache, _setBundleTransport, type BundleOutcome, type BundleTransport,
} from '../data/bundleSource';
import { _resetTrackCache } from '../data/loadTrack';
import { getDataset } from '../data/datasets';
import { getActiveContrast } from '../data/contrasts';
import { resolveTrackUrl } from '../data/bundleLocators';
import { _resetNomenclature } from '../data/nomenclature';
import type { Dataset, DatasetMeta, RawTrack } from '../types';
import { HX_MACAQUE_SNRNA_E9_FIXTURE, POP_META_FIXTURE } from './fixtures';

// The compare-set view: one column per (dataset, track), each loaded on its
// own, read across species, and never combined. The two datasets here are
// real registry entries so the loader's registry checks pass; their bundles
// come from a map transport keyed by the same locators the loader uses.

const MACAQUE = getDataset('macaque_snrna') as Dataset;
const MOUSE = getDataset('mouse_hypo_hfd_gse220533') as Dataset;
const ARC = getDataset('mouse_arc_hfd_gse225038') as Dataset;
const MOUSE_CONTRAST = getActiveContrast(MOUSE)?.label as string;
const [MOUSE_BASE, MOUSE_CASE] = [getActiveContrast(MOUSE)?.baseline, getActiveContrast(MOUSE)?.caseGroup];

const E9 = { datasetId: MACAQUE.id, trackId: 'e9' };
const I23 = { datasetId: MACAQUE.id, trackId: 'i23' };
const WHOLE = { datasetId: MOUSE.id, trackId: 'whole' };

const metaUrl = (ds: Dataset) => (ds.bundleBaseUrl || '') + ds.metaFile;

// A mouse study that spells the shared gene its own way and scores the shared
// GO term the other way.
const MOUSE_SAMPLES = ['C1', 'C2', 'C3', 'H1', 'H2', 'H3'];
const MOUSE_META: DatasetMeta = {
  populations: ['whole'],
  labels: { whole: 'Whole hypothalamus' },
  types: { whole: 'Whole tissue' },
  nGenes: { whole: 2 },
  colors: {},
  qcFlags: { whole: { nNormal: 3, nObese: 3, is3v3: true } },
};
const MOUSE_TRACK: RawTrack = {
  meta: {
    code: 'whole', label: 'Whole hypothalamus', sampleOrder: MOUSE_SAMPLES, samplesKept: MOUSE_SAMPLES,
    groupSamples: {
      [MOUSE_BASE?.key ?? 'chow']: MOUSE_SAMPLES.slice(0, 3),
      [MOUSE_CASE?.key ?? 'hfd']: MOUSE_SAMPLES.slice(3),
    },
    nGenes: 2,
  },
  qc: { cluster: 'whole', nNormal: 3, nObese: 3, is3v3: true, samplesKept: MOUSE_SAMPLES },
  de: [
    { gene: 'Pomc', logFC: -0.9, PValue: 0.02, FDR: 0.08 },
    { gene: 'Lep', logFC: 1.5, PValue: 0.001, FDR: 0.01 },
  ],
  cpm: {
    Pomc: [30, 28, 32, 18, 20, 17],
    Lep: [4, 5, 4, 12, 14, 13],
  },
  pathways: {
    GO_BP: [{ pathway: 'GOBP_NEURON_DIFFERENTIATION', pval: 0.2, padj: 0.3, NES: -1.2, size: 20, leadingEdge: ['Pomc'] }],
    HALLMARK: [], KEGG: [], REACTOME: [],
  },
};

const FILES: Record<string, unknown> = {
  [metaUrl(MACAQUE)]: POP_META_FIXTURE,
  [resolveTrackUrl(MACAQUE, 'e9')]: HX_MACAQUE_SNRNA_E9_FIXTURE,
  // A second macaque population, served the same fixture: enough to prove the
  // two columns are read as one study.
  [resolveTrackUrl(MACAQUE, 'i23')]: HX_MACAQUE_SNRNA_E9_FIXTURE,
  [metaUrl(MOUSE)]: MOUSE_META,
  [resolveTrackUrl(MOUSE, 'whole')]: MOUSE_TRACK,
};

/** Serves the map; anything else fails to load. */
function mapTransport(files: Record<string, unknown>) {
  const transport: BundleTransport = (url) => Promise.resolve<BundleOutcome>(
    url in files ? { status: 'ok', value: files[url] } : { status: 'load-failed' },
  );
  return transport;
}

/** Like mapTransport, but URLs matching `hold` wait until released by hand. */
function gatedTransport(files: Record<string, unknown>, hold: (url: string) => boolean) {
  const pending = new Map<string, (o: BundleOutcome) => void>();
  const outcome = (url: string): BundleOutcome =>
    url in files ? { status: 'ok', value: files[url] } : { status: 'load-failed' };
  const transport: BundleTransport = (url) => {
    if (!hold(url)) return Promise.resolve(outcome(url));
    return new Promise<BundleOutcome>((resolve) => { pending.set(url, resolve); });
  };
  const release = (url: string) => {
    const resolve = pending.get(url);
    if (!resolve) throw new Error(`nothing pending for ${url}`);
    pending.delete(url);
    resolve(outcome(url));
  };
  return { transport, release, pending };
}

function renderView(items: Array<{ datasetId: string; trackId: string }>, over: Partial<Parameters<typeof CompareSetView>[0]> = {}) {
  const props = {
    items,
    onItemsChange: vi.fn(),
    onHome: vi.fn(),
    onOpenDataset: vi.fn(),
    onOpenLibrary: vi.fn(),
    ...over,
  };
  const view = render(<CompareSetView {...props} />);
  return {
    ...props,
    /** App re-renders with the shortened list once a column is removed. */
    rerender: (next: Array<{ datasetId: string; trackId: string }>) => view.rerender(<CompareSetView {...props} items={next} />),
  };
}

// Type an exact gene symbol and press Enter — GeneSearchBox's Enter path matches
// against the full gene list directly, so it needs no debounce flush.
function selectGene(gene: string) {
  const input = screen.getByPlaceholderText(/Search gene/i);
  fireEvent.change(input, { target: { value: gene } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

const chip = (name: string) => screen.getByRole('group', { name });
const summaryRow = (gene: string) => {
  const cell = screen.getAllByText(gene).map((el) => el.closest('td')).find(Boolean) as HTMLElement;
  return cell.closest('tr') as HTMLElement;
};

afterEach(() => {
  _setBundleTransport(null);
  _resetBundleCache();
  _resetTrackCache();
});

describe('CompareSetView — columns', () => {
  it('names each column by its own contrast and arms, as each one lands', async () => {
    const gate = gatedTransport(FILES, (url) => url.includes(MOUSE.id));
    _setBundleTransport(gate.transport);
    renderView([E9, WHOLE]);

    // The macaque column is up; the mouse column is still on its way.
    const macaque = await screen.findByRole('group', { name: /^Macaque hypothalamus/ });
    await waitFor(() => expect(macaque).toHaveTextContent(/Obese vs Normal/));
    expect(macaque).toHaveTextContent(/3 Normal v 3 Obese/);
    expect(chip(MOUSE.name)).toHaveTextContent(/loading/);

    await act(async () => { gate.release(metaUrl(MOUSE)); });
    await waitFor(() => expect(gate.pending.has(resolveTrackUrl(MOUSE, 'whole'))).toBe(true));
    await act(async () => { gate.release(resolveTrackUrl(MOUSE, 'whole')); });

    const mouse = chip(MOUSE.name);
    await waitFor(() => expect(mouse).toHaveTextContent(/ready/));
    expect(mouse).toHaveTextContent(MOUSE_CONTRAST);
    expect(mouse).toHaveTextContent(new RegExp(`3 ${MOUSE_BASE?.label} v 3 ${MOUSE_CASE?.label}`));
  });

  it('reports a column it could not read as failed, never as "not detected"', async () => {
    _setBundleTransport(mapTransport(FILES));
    renderView([E9, WHOLE, { datasetId: ARC.id, trackId: ARC.defaultTrack }]);

    const arc = chip(ARC.name);
    await waitFor(() => expect(arc).toHaveTextContent(/failed/));
    await waitFor(() => expect(chip(MOUSE.name)).toHaveTextContent(/ready/));

    selectGene('POMC');
    const row = summaryRow('POMC');
    expect(row).toHaveTextContent(/failed/);
    expect(screen.queryByText(/not detected/i)).toBeNull();

    // The pathway matrix leaves it out and says so, rather than printing a
    // column of dashes.
    fireEvent.click(screen.getByRole('button', { name: 'Pathways' }));
    const absent = await screen.findByText(/Not in this matrix/);
    expect(absent.textContent).toContain(`${ARC.name} (failed to load)`);
  });

  it('marks a track the dataset does not have', async () => {
    _setBundleTransport(mapTransport(FILES));
    renderView([E9, { datasetId: MACAQUE.id, trackId: 'zz9' }]);
    await waitFor(() => expect(screen.getByText(/track not in this dataset/)).toBeTruthy());
  });

  it('says when several columns are populations of one study', async () => {
    _setBundleTransport(mapTransport(FILES));
    renderView([E9, I23]);
    expect(await screen.findByText(/share the same animals/)).toHaveTextContent(/2 columns/);
  });

  it('removes a column through its chip', async () => {
    _setBundleTransport(mapTransport(FILES));
    const props = renderView([E9, WHOLE]);
    await waitFor(() => expect(chip(MOUSE.name)).toHaveTextContent(/ready/));
    fireEvent.click(within(chip(MOUSE.name)).getByRole('button', { name: `Remove ${MOUSE.name} from compare set` }));
    expect(props.onItemsChange).toHaveBeenCalledWith([E9]);
  });

  it('keeps evidence and explorer navigation in a collapsed study disclosure', async () => {
    _setBundleTransport(mapTransport(FILES));
    const props = renderView([E9, WHOLE]);
    const mouse = chip(MOUSE.name);
    await waitFor(() => expect(mouse).toHaveTextContent(/ready/));
    const details = within(mouse).getByText('Details').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(within(mouse).getByRole('link', { name: /Verification evidence/ })).not.toBeVisible();
    fireEvent.click(within(mouse).getByText('Details'));
    expect(details).toHaveAttribute('open');
    expect(within(mouse).getByRole('link', { name: /Verification evidence/ })).toBeVisible();
    fireEvent.click(within(mouse).getByRole('button', { name: 'Open in explorer' }));
    expect(props.onOpenDataset).toHaveBeenCalledWith(MOUSE.id, 'whole');
  });
});

describe('CompareSetView — genes', () => {
  it('matches a gene across species and tallies per-study calls as a count', async () => {
    _setBundleTransport(mapTransport(FILES));
    renderView([E9, WHOLE]);
    await waitFor(() => expect(chip(MOUSE.name)).toHaveTextContent(/ready/));
    expect(screen.getByText(/absolute expression levels are not comparable/i)).toBeTruthy();

    selectGene('POMC');
    const row = summaryRow('POMC');
    // The macaque row and the mouse row (Pomc) both resolve.
    expect(row).toHaveTextContent('1.200');
    expect(row).toHaveTextContent('-0.900');
    // One of the two studies clears FDR < 0.05, and it is the up-regulated one.
    expect(row).toHaveTextContent('sig 1/2');
    expect(row).toHaveTextContent('▲1');
    expect(row).toHaveTextContent('▼0');
  });

  it('shows an honest empty tile for a column that lacks the gene', async () => {
    _setBundleTransport(mapTransport(FILES));
    renderView([E9, WHOLE]);
    await waitFor(() => expect(chip(MOUSE.name)).toHaveTextContent(/ready/));

    selectGene('TBX3');
    expect(screen.getAllByText('No detected expression')).toHaveLength(1);
    expect(summaryRow('TBX3')).toHaveTextContent('sig 0/1');
  });
});

describe('CompareSetView — the study selector and the volcano', () => {
  const rail = () => screen.getByRole('complementary', { name: 'Studies in this compare set' });
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const railRow = (name: string) => within(rail()).getByRole('button', { name: `Show volcano for ${name}` });
  const volcano = (study: RegExp) => screen.getByRole('region', { name: study });

  it('lists every column and shows the first study\'s volcano until another is picked — no going back', async () => {
    _setBundleTransport(mapTransport(FILES));
    renderView([E9, WHOLE]);
    await waitFor(() => expect(chip(MOUSE.name)).toHaveTextContent(/ready/));

    const rows = within(rail()).getAllByRole('button', { name: /^Show volcano for / });
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Macaque hypothalamus'),
      expect.stringContaining(MOUSE.name),
    ]);

    // The first column's volcano is up, above the (still present) gene search.
    const macaque = volcano(/^Volcano · Macaque hypothalamus/);
    expect(within(macaque).getByTitle(/Add all 1 threshold-passing/)).toBeTruthy();
    expect(screen.getByPlaceholderText(/Search gene/i)).toBeTruthy();

    // Picking the mouse study swaps the volcano in place; the tables never leave.
    fireEvent.click(railRow(MOUSE.name));
    expect(screen.queryByRole('region', { name: /^Volcano · Macaque/ })).toBeNull();
    const mouse = volcano(new RegExp(`^Volcano · ${esc(MOUSE.name)}`));
    expect(within(mouse).getByTitle(/Add all 1 threshold-passing/)).toBeTruthy();
    expect(railRow(MOUSE.name)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByPlaceholderText(/Search gene/i)).toBeTruthy();
  });

  it('adds a study\'s threshold-passing genes to every column\'s table, uppercase', async () => {
    _setBundleTransport(mapTransport(FILES));
    renderView([E9, WHOLE]);
    await waitFor(() => expect(chip(MOUSE.name)).toHaveTextContent(/ready/));

    fireEvent.click(railRow(MOUSE.name));
    // Only Lep clears the default cutoff (p < 0.01) in the mouse fixture.
    fireEvent.click(within(volcano(new RegExp(`^Volcano · ${esc(MOUSE.name)}`))).getByTitle(/Add all 1 threshold-passing/));

    const row = summaryRow('LEP');
    expect(row).toHaveTextContent('1.500');
    // The macaque atlas has no LEP: an honest empty tile, not a number.
    expect(screen.getAllByText('No detected expression')).toHaveLength(1);
  });

  it('keeps a volcano on screen when the shown study is removed', async () => {
    _setBundleTransport(mapTransport(FILES));
    const view = renderView([E9, WHOLE]);
    await waitFor(() => expect(chip(MOUSE.name)).toHaveTextContent(/ready/));
    fireEvent.click(railRow(MOUSE.name));
    expect(volcano(new RegExp(`^Volcano · ${esc(MOUSE.name)}`))).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: `Remove ${MOUSE.name} from compare set` }));
    expect(view.onItemsChange).toHaveBeenCalledWith([E9]);
    view.rerender([E9]);
    expect(volcano(/^Volcano · Macaque hypothalamus/)).toBeTruthy();
  });
});

describe('CompareSetView — pathways', () => {
  it('lines up a shared pathway with one NES per study', async () => {
    _setBundleTransport(mapTransport(FILES));
    renderView([E9, WHOLE]);
    await waitFor(() => expect(chip(MOUSE.name)).toHaveTextContent(/ready/));

    fireEvent.click(screen.getByRole('button', { name: 'Pathways' }));
    const cell = await screen.findByText('GOBP_NEURON_DIFFERENTIATION');
    const row = cell.closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('+1.800');
    expect(row).toHaveTextContent('-1.200');
    expect(screen.queryByText(/Not in this matrix/)).toBeNull();
  });
});

describe('CompareSetView — the shared picker across species', () => {
  // AARS is retired in both namespaces; each study stores its own spelling.
  const ALIASES = { v: 1, rows: [['AARS', 0, 1, 'AARS1', '', ''], ['Aars', 1, 1, 'Aars1', '', '']] };
  const withGene = (track: RawTrack, gene: string, logFC: number): RawTrack => ({
    ...track,
    de: [...(track.de ?? []), { gene, logFC, PValue: 0.5, FDR: 0.9 }],
    cpm: { ...track.cpm, [gene]: [3, 3, 3, 3, 3, 3] },
  });
  // Served through the same transport as the bundles, which replaces the
  // eager-global path for every URL it is handed.
  const files = {
    ...FILES,
    '/nomenclature/aliases.js': ALIASES,
    [resolveTrackUrl(MACAQUE, 'e9')]: withGene(HX_MACAQUE_SNRNA_E9_FIXTURE, 'AARS', 0.25),
    [resolveTrackUrl(MOUSE, 'whole')]: withGene(MOUSE_TRACK, 'Aars', -0.35),
  };

  beforeEach(() => { _resetNomenclature(); });
  afterEach(() => { _resetNomenclature(); });

  it('selects "aars" as one gene, resolves each study\'s own spelling, and notes it under both authorities', async () => {
    _setBundleTransport(mapTransport(files));
    renderView([E9, WHOLE]);
    await waitFor(() => expect(chip(MOUSE.name)).toHaveTextContent(/ready/));

    selectGene('aars');
    expect(screen.getByRole('button', { name: 'Remove AARS' })).toBeTruthy();
    // The macaque AARS and the mouse Aars both land in the one row.
    const row = summaryRow('AARS');
    expect(row).toHaveTextContent('0.250');
    expect(row).toHaveTextContent('-0.350');
    // Each study read in its own namespace: HGNC for the macaque column, MGI
    // for the mouse one. Their current symbols agree up to case, so one note.
    const note = await screen.findByText('now AARS1');
    expect(note.getAttribute('title')).toMatch(/HGNC and MGI now call this gene AARS1/);
  });
});
