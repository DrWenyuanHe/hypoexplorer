import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { GeneExplorerTab } from '../gene-explorer/GeneExplorerTab';
import { preloadBarSEMChart } from '../gene-explorer/BarSEMChart';
import { buildPopData } from '../data/buildPopData';
import { POP_E9_FIXTURE, MACAQUE_DATASET, MACAQUE_CONTRAST } from './fixtures';
import { stubGeneSelection, stubVolcanoView } from './fixtures';

// The leading-edge pathway modal has subtle backdrop logic: it closes only when
// BOTH mousedown and mouseup land on the backdrop, so a text-selection drag that
// starts inside the panel and releases on the backdrop does NOT close it. Plus
// Escape closes. POMC is a leading-edge gene in several fixture pathways, so the
// drill-down button renders.
const popData = buildPopData(POP_E9_FIXTURE, MACAQUE_DATASET, MACAQUE_CONTRAST)!;
const writeWorkbook = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../utils/workbook', () => ({ writeWorkbook }));

function renderTab() {
  render(
    <GeneExplorerTab
      geneSelection={stubGeneSelection(['POMC'])}
      volcano={stubVolcanoView()}
      popData={popData}
      contrastSlices={[]}
    />,
  );
}

// The drill-down button lives inside BarSEMChart, which is React.lazy'd (recharts
// is 319 KB and is kept off the landing page's critical path), so it does not
// exist on the first paint of the charts pop-up — findByRole waits for the chunk.
//
// The wait rides the suite-wide asyncUtilTimeout set in setup.ts, not findBy's
// 1 s default: the beforeAll preload below resolves the chunk, but resolving it
// is not the same as React having committed the lazy boundary, and on a loaded
// machine that gap has exceeded a second — this file passed alone in 3.2 s and
// failed on this exact assertion in a 95 s full-suite run of identical code.
async function openModal() {
  fireEvent.click(screen.getByRole('button', { name: /Bar charts/i }));
  fireEvent.click(await screen.findByRole('button', { name: /as leading gene/i }));
  return screen.getByRole('dialog', { name: /Pathways where POMC is a leading gene/i });
}

// Resolve the lazy chart chunk once, up front. These tests are about the modal's
// backdrop logic, not about chunk loading, and the first evaluation of recharts
// in a worker can take longer than findBy's 1 s default when the whole suite is
// running — which showed up as this file passing alone and failing in the full
// run. Preloading mirrors what the app does when the explorer opens
// (preloadBarSEMChart in App.tsx) and makes the timing deterministic.
beforeAll(async () => { await preloadBarSEMChart(); });

describe('GeneExplorerTab — leading-edge modal', () => {
  it('retains the active contrast in pathway exports when App passes an empty contrast slice list', async () => {
    writeWorkbook.mockClear();
    renderTab();
    const modal = await openModal();
    fireEvent.click(within(modal).getByRole('button', { name: /Export pathway list/i }));
    await waitFor(() => expect(writeWorkbook).toHaveBeenCalledTimes(1));
    const [, sheets] = writeWorkbook.mock.calls[0] as unknown as [string, { name: string; rows: { Field: string; Value: unknown }[] }[]];
    const metadata = sheets.find((sheet) => sheet.name === 'Metadata')!;
    const fields = Object.fromEntries(metadata.rows.map((row) => [row.Field, row.Value]));
    expect(fields['contrasts.0.id']).toBe(MACAQUE_CONTRAST!.id);
    expect(fields['contrasts.0.direction']).toContain('Obese minus Normal');
  });

  it('opens from the bar-chart drill-down button', async () => {
    renderTab();
    expect(await openModal()).toBeTruthy();
  });

  it('closes on Escape', async () => {
    renderTab();
    await openModal();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /Pathways where POMC is a leading gene/i })).toBeNull();
  });

  it('closes on a backdrop mousedown+mouseup', async () => {
    renderTab();
    const backdrop = await openModal();
    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);
    expect(screen.queryByRole('dialog', { name: /Pathways where POMC is a leading gene/i })).toBeNull();
  });

  it('does NOT close when a drag starts inside the panel and releases on the backdrop', async () => {
    renderTab();
    const backdrop = await openModal();
    const panel = backdrop.querySelector('.modal-panel')!;
    fireEvent.mouseDown(panel); // bubbles to backdrop with target !== currentTarget
    fireEvent.mouseUp(backdrop);
    // Still open — the guard ignored the panel-originated drag.
    expect(screen.getByRole('dialog', { name: /Pathways where POMC is a leading gene/i })).toBeTruthy();
  });
});
