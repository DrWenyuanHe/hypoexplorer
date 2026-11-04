import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { Modal } from '../common/Modal';

// The trap as the Modal actually wires it, rather than as a pure sequence.
//
// focusTrap.test.tsx pins what focusableSequence RETURNS. What it cannot pin is
// that the keystroke reaches the trap at all — and that is precisely what was
// broken: the handler was a native listener on the panel, so a Tab pressed
// inside a popover the dialog portals into document.body never arrived, and
// focus walked out of the dialog onto the page behind it. The fix is that the
// handler is now a REACT onKeyDown, which propagates through the component tree
// and so covers the portal. Nothing but an event dispatched from inside a real
// portal tests that.

function Popover({ id }: { id: string }) {
  return createPortal(
    <section id={id} aria-label="Checklist">
      <button type="button">Checklist close</button>
    </section>,
    document.body,
  );
}

const panelOf = () => document.querySelector('.modal-panel') as HTMLElement;

describe('Modal — Tab inside a portaled popover', () => {
  it.each([
    ['Quality', false, 'Checklist close'],
    ['Checklist close', false, 'Open dataset'],
    ['Open dataset', true, 'Checklist close'],
    ['Checklist close', true, 'Quality'],
  ] as const)('moves from %s across the portal boundary (reverse: %s)', (from, shiftKey, to) => {
    render(
      <Modal onClose={() => {}} title="Record">
        <button type="button" aria-controls="checks" aria-expanded>Quality</button>
        <Popover id="checks" />
        <button type="button">Open dataset</button>
      </Modal>,
    );
    // The library footer follows its badge in the dialog, while the checklist
    // is appended to document.body. Native Tab order cannot follow that seam.
    const start = screen.getByRole('button', { name: from });
    start.focus();
    expect(fireEvent.keyDown(start, { key: 'Tab', shiftKey })).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: to }));
  });

  it('wraps back into the dialog instead of escaping to the page behind it', () => {
    render(
      <Modal onClose={() => {}} title="Record">
        <button type="button" aria-controls="checks" aria-expanded>Quality</button>
        <Popover id="checks" />
      </Modal>,
    );
    // The popover lives in document.body, outside the panel's subtree…
    const popoverClose = screen.getByRole('button', { name: 'Checklist close' });
    expect(panelOf().contains(popoverClose)).toBe(false);

    // …but it is the LAST stop in the dialog's keyboard order, so Tab from it
    // must be cancelled and focus sent back to the first stop.
    popoverClose.focus();
    const notCancelled = fireEvent.keyDown(popoverClose, { key: 'Tab' });
    expect(notCancelled).toBe(false);
    expect(document.activeElement).toBe(screen.getByLabelText('Close'));
  });

  it('treats the panel as an edge in the reverse direction too', () => {
    // The panel holds focus on mount and after any in-dialog navigation. The
    // forward case is covered in modal.test.tsx; this is the claim that
    // Shift+Tab from the panel enters the trapped set at its END rather than
    // stepping out of the dialog.
    render(
      <Modal onClose={() => {}} title="Record">
        <button type="button" aria-controls="checks" aria-expanded>Quality</button>
        <Popover id="checks" />
      </Modal>,
    );
    const panel = panelOf();
    panel.focus();
    const notCancelled = fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true });
    expect(notCancelled).toBe(false);
    // Last stop is the portaled popover's button, not the panel's own last child.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Checklist close' }));
  });
});
