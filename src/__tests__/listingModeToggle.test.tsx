import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ListingModeToggle, QTerm, Q_EXPLANATION } from '../statistics/ListingModeToggle';
import {
  LISTING_MODE_STORAGE_KEY, _resetListingModeStore, setListingMode, useListingMode,
} from '../statistics/listingModeStore';

function Probe() {
  return <output data-testid="mode">{useListingMode()}</output>;
}

describe('ListingModeToggle', () => {
  it('starts on the p < 0.05 listing and switches every subscriber to FDR-only', () => {
    render(<><ListingModeToggle /><ListingModeToggle /><Probe /></>);
    const fdr = screen.getAllByRole('button', { name: 'FDR (q < 0.05)' });
    const nominal = screen.getAllByRole('button', { name: 'p < 0.05' });
    expect(screen.getByTestId('mode').textContent).toBe('nominal');
    expect(nominal[0]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('group', { name: 'Tracks to list' })).toHaveLength(2);

    fireEvent.click(fdr[0]);
    expect(screen.getByTestId('mode').textContent).toBe('fdr');
    // Both copies show the pick: one store, not one state per control.
    for (const button of fdr) expect(button).toHaveAttribute('aria-pressed', 'true');
    for (const button of nominal) expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem(LISTING_MODE_STORAGE_KEY)).toBe('fdr');
  });

  it('explains both listings behind a (?) that opens on hover or focus and pins on click', () => {
    render(<ListingModeToggle kind="gene" />);
    const help = screen.getByRole('button', { name: 'About FDR and p < 0.05' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseEnter(help);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent(Q_EXPLANATION);
    expect(tip).toHaveTextContent(/not corrected for the genes each study tested/);
    expect(tip).toHaveTextContent(/Counts of significant tracks always use FDR/);
    expect(help).toHaveAttribute('aria-describedby', tip.id);
    fireEvent.click(help);
    fireEvent.mouseLeave(help);
    fireEvent.blur(help);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(help);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('explains each option on hover', () => {
    render(<ListingModeToggle />);
    expect(screen.getByRole('button', { name: 'FDR (q < 0.05)' }).title).toMatch(/only the tracks that pass FDR/);
    expect(screen.getByRole('button', { name: 'p < 0.05' }).title).toMatch(/not corrected for multiple testing/);
  });
});

describe('listingModeStore', () => {
  it('restores a stored pick and ignores a value this build does not know', () => {
    // The store reads storage lazily, on first use, so seeding it after a reset is a fresh load.
    localStorage.setItem(LISTING_MODE_STORAGE_KEY, 'fdr');
    render(<Probe />);
    expect(screen.getByTestId('mode').textContent).toBe('fdr');

    _resetListingModeStore();
    localStorage.setItem(LISTING_MODE_STORAGE_KEY, 'bonferroni');
    render(<Probe />);
    expect(screen.getAllByTestId('mode').at(-1)?.textContent).toBe('nominal');
  });

  it('keeps working when storage throws', () => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('quota'); };
    try {
      render(<Probe />);
      expect(() => setListingMode('fdr')).not.toThrow();
    } finally {
      Storage.prototype.setItem = setItem;
    }
  });
});

describe('QTerm', () => {
  it('carries the q explanation, focusable unless it sits inside a control', () => {
    render(<><QTerm /><QTerm focusable={false}>FDR</QTerm></>);
    const [q, fdr] = [screen.getByText('q'), screen.getByText('FDR')];
    expect(q.tagName).toBe('ABBR');
    expect(q.title).toBe(Q_EXPLANATION);
    expect(Q_EXPLANATION).toMatch(/FDR-adjusted p-value/);
    expect(Q_EXPLANATION).toMatch(/Benjamini–Hochberg/);
    expect(q).toHaveAttribute('tabindex', '0');
    expect(fdr.title).toBe(Q_EXPLANATION);
    expect(fdr).not.toHaveAttribute('tabindex');
  });
});
