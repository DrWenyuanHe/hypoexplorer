import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { DatasetLibrary } from '../library/DatasetLibrary';
import { seedQueryManifest } from './fixtures';

// The library record's one route from the summary strip into the dossier.
//
// The reproduction report lives in the record's Verification tab, and the
// summary strip on the Overview tab links to it. That link is only honest if it
// works — and it is not an ordinary link: it switches tabs and moves focus onto
// the tab it selected, so a screen reader announces the state that just changed.

describe('DatasetLibrary study record — the verification tab', () => {
  it('opens the report from the summary strip and puts focus on its tab', async () => {
    const unseed = seedQueryManifest();
    render(
      <DatasetLibrary
        onHome={vi.fn()} onOpenInExplorer={vi.fn()} onOpenTracker={vi.fn()} onCompareSet={vi.fn()}
        initialSelectedId="macaque_snrna"
      />,
    );
    const record = await screen.findByRole('article', { name: /Macaque hypothalamus/i });
    const verification = within(record).getByRole('tab', { name: 'Verification' });
    expect(verification).toHaveAttribute('aria-selected', 'false');

    // Scoped to the record: an unscoped query would price in the accessible
    // name of every row in the hidden list behind it.
    fireEvent.click(within(record).getByText(/Full verification report ↓/));

    expect(verification).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(document.activeElement).toBe(verification));

    // The Overview's summary strip went with its tab, so the report introduces
    // itself (the badges/claim header `summaryShownAbove` would otherwise drop)
    // and the strip is not left standing beside it: stated once, not twice.
    expect(within(record).queryByRole('region', { name: 'Verification summary' })).toBeNull();
    expect(within(record).getByText(/Hover, focus or tap/i)).toBeTruthy();
    unseed();
  });
});
