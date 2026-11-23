import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tabKeyTarget } from '../utils/tabKeys';
import { atlasFiles, fixtureDatasets, memoryTransport } from './hypomapFixture';

// The HypoMap export is not checked in; a three-context, 18-dataset fixture export is served
// to the atlas client through its in-memory transport.
const pin = vi.hoisted(() => ({ tag: 'hypomap-atlas-test', archive: '', archiveSha256: '', manifestSha256: '' }));
vi.mock('../../hypomap-release.json', () => ({ default: pin }));

const { _resetAtlasCache, _setAtlasTransport } = await import('../search/hypomap/atlas');
const { HypoMapPreview } = await import('../search/hypomap/HypoMapPreview');

const { files, manifestSha256 } = atlasFiles({
  contexts: ['Whole hypothalamus', 'Arcuate hypothalamic nucleus', 'Supraoptic nucleus'],
  datasets: fixtureDatasets(18, i => (i < 2 ? [[100, 40, 10], [50, 20, 5]][i] : [10, 4, 1])),
  genes: [['ENSMUSG1', 'Pomc', 'pro-opiomelanocortin'], ['ENSMUSG2', 'Cartpt', 'CART prepropeptide']],
  aliases: { cart: [1] },
  outside: { cart: ['Cart-ps'] },
  records: { 0: [[[20, 10, 2], [40, 20, 4]], [[5, 4, 1], [10, 8, 2]], ...Array(16).fill(null)] },
});

beforeEach(() => {
  pin.manifestSha256 = manifestSha256;
  _resetAtlasCache();
  _setAtlasTransport(memoryTransport(files).transport);
});

async function renderReady() {
  render(<HypoMapPreview symbol="Pomc" />);
  return screen.findByRole('tablist', { name: 'HypoMap view' });
}

describe('tabKeyTarget', () => {
  it('wraps the arrow keys, jumps with Home and End and ignores other keys', () => {
    expect(tabKeyTarget('ArrowRight', 2, 3)).toBe(0);
    expect(tabKeyTarget('ArrowLeft', 0, 3)).toBe(2);
    expect(tabKeyTarget('Home', 2, 3)).toBe(0);
    expect(tabKeyTarget('End', 0, 3)).toBe(2);
    expect(tabKeyTarget('Enter', 1, 3)).toBeNull();
  });
});

describe('HypoMapPreview views', () => {
  it('switches views from a click, focusing the clicked tab and showing the spatial export only on Spatial', async () => {
    const tablist = await renderReady();
    const [spatial, datasets] = within(tablist).getAllByRole('tab');
    expect(spatial.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(spatial.id);
    expect(screen.getByRole('button', { name: /Preview spatial CSV/ })).toBeTruthy();

    fireEvent.click(datasets);
    expect(datasets.getAttribute('aria-selected')).toBe('true');
    expect(datasets.tabIndex).toBe(0);
    expect(spatial.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(datasets);
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(datasets.id);
    expect(screen.queryByRole('button', { name: /Preview spatial CSV/ })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Region' })).toBeTruthy();
  });

  it('moves selection and focus with the arrow, Home and End keys', async () => {
    const tablist = await renderReady();
    const [spatial, datasets] = within(tablist).getAllByRole('tab');
    fireEvent.keyDown(spatial, { key: 'ArrowRight' });
    expect(datasets.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(datasets);
    fireEvent.keyDown(datasets, { key: 'ArrowRight' });
    expect(spatial.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(spatial);
    fireEvent.keyDown(spatial, { key: 'End' });
    expect(document.activeElement).toBe(datasets);
    fireEvent.keyDown(datasets, { key: 'Home' });
    expect(spatial.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(spatial, { key: 'Enter' });
    expect(spatial.getAttribute('aria-selected')).toBe('true');
  });

  it('scopes the summary to an off-plane region and resets it to the whole hypothalamus', async () => {
    await renderReady();
    expect(screen.queryByRole('button', { name: 'Reset to whole hypothalamus' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Supraoptic nucleus/ }));
    expect(screen.getByRole('heading', { name: 'Supraoptic nucleus' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to whole hypothalamus' }));
    expect(screen.getByRole('heading', { name: 'Whole hypothalamus' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reset to whole hypothalamus' })).toBeNull();
  });
});

describe('HypoMapPreview states', () => {
  it('names an ambiguous symbol and its canonical candidates', async () => {
    render(<HypoMapPreview symbol="cart" />);
    expect(await screen.findByText('Multiple HypoMap features match cart. Search a canonical symbol: Cartpt, Cart-ps.')).toBeTruthy();
  });

  it('states the cohort and lists the off-plane region with its detection', async () => {
    await renderReady();
    expect(screen.getByText('Among cells included in HypoMap · 384,925 cells from 18 contributing datasets.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Supraoptic nucleus · 20.00%' })).toBeTruthy();
  });
});
