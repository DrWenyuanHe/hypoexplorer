import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CellSelectorPopup } from '../common/CellSelectorPopup';
import { POP_META_FIXTURE } from './fixtures';

// CellSelectorPopup owns the Compare selection. Its minimum-selection guard
// (default 2) lives in togglePop/removeChip: the selection can never drop below
// `minSelection`. This is the "togglePop min-2 guard" the TODO tracked — it
// moved here from CompareTab when the cell picker was extracted. The dataset
// meta (populations e9,i23,e33,…) is a prop, passed explicitly.

describe('CellSelectorPopup — minimum-selection guard', () => {
  it('disables chip removal and blocks toggling-off at the floor (2)', () => {
    const onChange = vi.fn();
    render(<CellSelectorPopup meta={POP_META_FIXTURE} selectedPops={['e9', 'i23']} onChange={onChange} minSelection={2} />);

    // Chip × is disabled at the floor; clicking it is a no-op.
    const removeE9 = screen.getByLabelText('Remove e9');
    expect(removeE9).toBeDisabled();
    fireEvent.click(removeE9);
    expect(onChange).not.toHaveBeenCalled();

    // In the picker, the selected pops' checkboxes are disabled (can't uncheck
    // below the floor), so toggling one off does nothing.
    fireEvent.click(screen.getByTitle('Select cells to compare'));
    const toggleE9 = screen.getByLabelText('Toggle e9');
    expect(toggleE9).toBeDisabled();
    fireEvent.click(toggleE9);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('allows removal once above the floor', () => {
    const onChange = vi.fn();
    render(<CellSelectorPopup meta={POP_META_FIXTURE} selectedPops={['e9', 'i23', 'e33']} onChange={onChange} minSelection={2} />);
    const removeE9 = screen.getByLabelText('Remove e9');
    expect(removeE9).not.toBeDisabled();
    fireEvent.click(removeE9);
    expect(onChange).toHaveBeenCalledWith(['i23', 'e33']);
  });

  it('adds a non-selected pop via the picker checkbox', () => {
    const onChange = vi.fn();
    render(<CellSelectorPopup meta={POP_META_FIXTURE} selectedPops={['e9', 'i23']} onChange={onChange} minSelection={2} />);
    fireEvent.click(screen.getByTitle('Select cells to compare'));
    fireEvent.click(screen.getByLabelText('Toggle e33'));
    expect(onChange).toHaveBeenCalledWith(['e9', 'i23', 'e33']);
  });
});

// The picker's dialog chrome is the shared <Modal>: the backdrop itself carries
// role=dialog + aria-modal, the name comes from Modal's `ariaLabel`, and Escape
// / the body-scroll lock are Modal's — the picker no longer hand-rolls any of it.
describe('CellSelectorPopup — dialog chrome', () => {
  it('opens a named modal dialog that Escape closes, and locks body scroll', () => {
    render(<CellSelectorPopup meta={POP_META_FIXTURE} selectedPops={['e9', 'i23']} onChange={() => {}} />);
    fireEvent.click(screen.getByTitle('Select cells to compare'));

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Select cells to compare');
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });
});
