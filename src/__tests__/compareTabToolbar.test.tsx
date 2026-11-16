import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react';
import { CompareTab } from '../compare/CompareTab';
import { getActiveContrast } from '../data/contrasts';
import { _resetTrackCache } from '../data/loadTrack';
import { _resetBundleCache, _setBundleTransport, type BundleOutcome } from '../data/bundleSource';
import { MULTICONTRAST_DATASET_FIXTURE as DS, MULTICONTRAST_TRACK_FIXTURE as FIXTURE } from './fixtures';

// The Compare tab's status rows and download menu. With the whole macaque
// atlas selected the loading row used to list sixty ids on one line, sixty
// failures meant sixty alert rows, and the only download was an 11px "Export
// Excel" in the table footer. Now: a count while loading, one folded alert past
// three failures, and a Download menu whose choices stay disabled (and say
// why) until every selected population has loaded.

let release: Array<() => void>;
let hold: boolean;

beforeEach(() => {
  release = [];
  hold = false;
  _resetBundleCache();
  _resetTrackCache();
  _setBundleTransport(async (url): Promise<BundleOutcome> => {
    const ok = url.endsWith('/track_whole.js') || url.endsWith('/track_other_population.js');
    if (hold) await new Promise<void>((resolve) => release.push(resolve));
    return ok ? { status: 'ok', value: { ...FIXTURE } } : { status: 'load-failed' };
  });
});
afterEach(() => { cleanup(); _setBundleTransport(null); _resetBundleCache(); _resetTrackCache(); });

function renderCompare(pops: string[]) {
  return render(<CompareTab meta={null} dataset={DS} contrast={getActiveContrast(DS)} defaultPops={pops} />);
}

function selectGene(gene: string) {
  const input = screen.getByPlaceholderText(/Search gene/i);
  fireEvent.change(input, { target: { value: gene } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

function openDownloadMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  return screen.getByRole('menu', { name: 'Download comparison' });
}

describe('CompareTab — loading and failure rows', () => {
  it('summarises loading populations as a count, not a list of ids', async () => {
    hold = true;
    renderCompare(['whole', 'other_population']);
    expect(await screen.findByText('Loading 2 of 2 populations…')).toBeTruthy();
    expect(screen.queryByText(/Loading whole/)).toBeNull();

    await act(async () => { for (const r of release) r(); });
    await waitFor(() => expect(screen.queryByText(/Loading \d+ of/)).toBeNull());
  });

  it('folds more than three failures into one alert with Retry all', async () => {
    renderCompare(['whole', 'missing_a', 'missing_b', 'missing_c', 'missing_d']);
    const alert = await screen.findByRole('alert');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(alert.textContent).toMatch(/Could not load 4 of 5 populations/);
    expect(within(alert).getByRole('button', { name: 'Retry all' })).toBeTruthy();
    // The disclosure names each one, each with its own Retry.
    expect(within(alert).getByRole('button', { name: 'Retry loading missing_c' })).toBeTruthy();
  });
});

const DOWNLOAD_ITEMS = [
  /Data workbook \(Excel\)/, /Summary \(CSV\)/, /Per-animal values \(CSV\)/,
  /All charts in one image \(PNG\)/, /Individual charts \(ZIP of PNG\)/, /Individual charts \(ZIP of SVG\)/,
];

describe('CompareTab — download menu', () => {
  it('offers data and figure downloads, disabled until every population has loaded', async () => {
    hold = true;
    renderCompare(['whole', 'other_population']);
    await screen.findByText('Loading 2 of 2 populations…');

    const menu = openDownloadMenu();
    const excel = within(menu).getByRole('menuitem', { name: /Data workbook \(Excel\)/ });
    const items = DOWNLOAD_ITEMS.map((name) => within(menu).getByRole('menuitem', { name }));
    for (const item of items) expect(item).toBeDisabled();
    expect(within(menu).getByRole('note').textContent).toMatch(/once every selected population has loaded \(0 of 2 loaded\)/);
    // Each choice says what the file holds.
    expect(excel.textContent).toMatch(/One row per gene × population/);
    expect(excel.textContent).toMatch(/Values sheet/);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    await act(async () => { for (const r of release) r(); });
    await waitFor(() => expect(screen.queryByText(/Loading \d+ of/)).toBeNull());

    // Loaded but no gene yet: still disabled, for that reason.
    let open = openDownloadMenu();
    expect(within(open).getByRole('note').textContent).toMatch(/Add a gene/);
    expect(within(open).getByRole('menuitem', { name: /Data workbook \(Excel\)/ })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });

    selectGene('IGFBP2');
    open = openDownloadMenu();
    expect(within(open).queryByRole('note')).toBeNull();
    for (const name of DOWNLOAD_ITEMS) {
      expect(within(open).getByRole('menuitem', { name })).not.toBeDisabled();
    }
  });

  it('moves the export out of the summary table and gives each chart row a PNG download', async () => {
    renderCompare(['whole', 'other_population']);
    await waitFor(() => expect(screen.queryByText(/Loading \d+ of/)).toBeNull());
    selectGene('IGFBP2');
    expect(screen.queryByRole('button', { name: 'Export Excel' })).toBeNull();
    expect(screen.getByRole('button', { name: /IGFBP2 charts \(PNG\)/ })).toBeTruthy();
    // The summary table folds away and comes back.
    const toggle = screen.getByRole('button', { name: /Compare summary/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /Compare summary/ }).getAttribute('aria-expanded')).toBe('false');
  });
});


describe('chartSvgMarkup — standalone SVG of one chart tile', () => {
  it('captions the chart, embeds provenance, and leaves no unresolvable CSS variables', async () => {
    const { chartSvgMarkup } = await import('../compare/compareFigureExport');
    const { FONT_MONO } = await import('../styles/constants');
    const tile = document.createElement('div');
    tile.innerHTML = `
      <div data-export-ignore=""><button><svg width="12" height="12"><path d="M0 0"/></svg></button></div>
      <svg class="recharts-surface" width="220" height="200">
        <text font-family="var(--font-sans)" fill="var(--text-primary, #222)">Normal</text>
        <rect width="10" height="40" fill="#4C78A8"/>
      </svg>`;
    document.body.appendChild(tile);
    const markup = chartSvgMarkup(tile, { title: 'IGFBP2', subtitle: 'whole · mean ± SEM' }, { exportKind: 'compare' })!;
    tile.remove();

    expect(markup).toMatch(/^<\?xml/);
    expect(markup).toContain('IGFBP2');
    expect(markup).toContain(`font-family="${FONT_MONO}"`);
    expect(markup).toContain('<metadata>{"exportKind":"compare"}</metadata>');
    expect(markup).not.toContain('var(');
    // The plot svg, not the icon in the ignored button.
    expect(markup).toContain('width="220"');
    expect(markup).not.toContain('width="12"');
  });
});
