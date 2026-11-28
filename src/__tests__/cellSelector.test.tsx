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
  it('opens a named modal dialog that Escape closes', () => {
    render(<CellSelectorPopup meta={POP_META_FIXTURE} selectedPops={['e9', 'i23']} onChange={() => {}} />);
    fireEvent.click(screen.getByTitle('Select cells to compare'));

    const dialog = screen.getByRole('dialog') as HTMLDialogElement;
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('aria-label')).toBe('Select cells to compare');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// With every population selected the chips wrapped to a dozen rows and pushed
// the charts off screen. Collapsed, the row shows at most `collapsedChipCount`
// chips (fewer when they do not fit one line; jsdom has no layout, so the cap
// decides here) and a "+N more" that expands the list inline.
describe('CellSelectorPopup — collapsed chip row', () => {
  const ALL = ['e9', 'i23', 'e33', 'i26', 'i40', 'o30', 'e38'];

  it('shows the first chips and "+N more", expands with it and collapses with Show less', () => {
    render(<CellSelectorPopup meta={POP_META_FIXTURE} selectedPops={ALL} onChange={() => {}} collapsedChipCount={3} />);
    expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(3);
    const more = screen.getByRole('button', { name: 'Show all 7 selected populations' });
    expect(more.textContent).toBe('+4 more');
    expect(more.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(more);
    expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(7);
    const less = screen.getByRole('button', { name: 'Show less' });
    expect(less.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(less);
    expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(3);
  });

  it('has no toggle when every chip fits under the cap', () => {
    render(<CellSelectorPopup meta={POP_META_FIXTURE} selectedPops={['e9', 'i23', 'e33']} onChange={() => {}} collapsedChipCount={3} />);
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show less' })).toBeNull();
  });

  it('offers Reset outside the modal only when the selection differs from the default', () => {
    const onChange = vi.fn();
    const { rerender } = render(<CellSelectorPopup meta={POP_META_FIXTURE} selectedPops={['i23', 'e9']}
      onChange={onChange} defaultSelection={['e9', 'i23']} />);
    // Same set in another order is still the default.
    expect(screen.queryByRole('button', { name: 'Reset to the default selection' })).toBeNull();

    rerender(<CellSelectorPopup meta={POP_META_FIXTURE} selectedPops={ALL} onChange={onChange} defaultSelection={['e9', 'i23']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset to the default selection' }));
    expect(onChange).toHaveBeenCalledWith(['e9', 'i23']);
  });
});
