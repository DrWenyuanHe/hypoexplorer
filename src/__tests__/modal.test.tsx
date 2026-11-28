import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from '../common/Modal';
import { HelpTip } from '../common/HelpTip';

// The shared Modal is a native <dialog> opened with showModal(). The browser
// owns the focus trap, the inert page and the top layer, which jsdom does not
// model (setup.ts shims showModal/close and the Escape close request), so these
// pin the wiring: it opens modally, takes focus, closes through onClose on each
// path, hands focus back, and leaves the page's scrolling alone.

const dialogOf = () => document.querySelector('dialog.modal-panel') as HTMLDialogElement;

describe('Modal — a native modal dialog', () => {
  it('opens with showModal, named, with no hand-made role or aria-modal', () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    render(<Modal onClose={() => {}} title="Dataset"><p>Body</p></Modal>);
    const dialog = screen.getByRole('dialog', { name: 'Dataset' }) as HTMLDialogElement;
    expect(dialog).toBe(dialogOf());
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(dialog.open).toBe(true);
    expect(dialog.hasAttribute('role')).toBe(false);
    expect(dialog.hasAttribute('aria-modal')).toBe(false);
    expect(dialog.getAttribute('closedby')).toBe('any');
    showModal.mockRestore();
  });

  it('moves focus to the dialog, or to the initial-focus control', () => {
    const { unmount } = render(<Modal onClose={() => {}} title="T"><button type="button">Inside</button></Modal>);
    expect(document.activeElement).toBe(dialogOf());
    unmount();
    render(
      <Modal onClose={() => {}} title="T" initialFocusSelector="input">
        <button type="button">First</button><input aria-label="Field" />
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText('Field'));
  });

  it('skips the header when there is neither a title nor headerRight', () => {
    render(<Modal onClose={() => {}} ariaLabel="Own header"><p>Body</p></Modal>);
    expect(screen.queryByLabelText('Close')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Own header' })).toBeTruthy();
  });
});

describe('Modal — closing', () => {
  it('closes from the × button', () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} title="T"><p>Body</p></Modal>);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('turns an Escape close request into onClose and stays open until the caller unmounts', () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} title="T"><button type="button">X</button></Modal>);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    // The cancel was cancelled: React, not the browser, decides it closes.
    expect(dialogOf().open).toBe(true);
  });

  it('calls onClose when the browser closes it anyway (an uncancellable request)', () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} title="T"><p>Body</p></Modal>);
    dialogOf().close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape to a popup inside that cancels it', () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose} title="T">
        <HelpTip label="What is q?"><p>Explanation</p></HelpTip>
      </Modal>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'What is q?' }));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    // The next Escape is the dialog's.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // jsdom lays nothing out, so the dialog's box is 0×0 at the origin and any
  // point with a positive coordinate is on the backdrop. Without `closedby`
  // (jsdom, like Safari) Modal's own fallback decides.
  it('closes on a press that starts and ends on the backdrop', () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} title="T"><p>Body</p></Modal>);
    fireEvent.mouseDown(dialogOf(), { clientX: 5, clientY: 5 });
    fireEvent.mouseUp(dialogOf(), { clientX: 5, clientY: 5 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on a drag that starts inside the panel and ends on the backdrop', () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} title="T"><p>Body</p></Modal>);
    fireEvent.mouseDown(screen.getByText('Body'), { clientX: 5, clientY: 5 });
    fireEvent.mouseUp(dialogOf(), { clientX: 5, clientY: 5 });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close the outer dialog on a press on an inner dialog\'s backdrop', () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    render(
      <Modal onClose={outerClose} title="Outer">
        <Modal onClose={innerClose} title="Inner"><p>Inner body</p></Modal>
      </Modal>,
    );
    const inner = screen.getByRole('dialog', { name: 'Inner' });
    fireEvent.mouseDown(inner, { clientX: 5, clientY: 5 });
    fireEvent.mouseUp(inner, { clientX: 5, clientY: 5 });
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });
});

describe('Modal — after it closes', () => {
  it('hands focus back to the opener on unmount', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = render(<Modal onClose={() => {}} title="T"><button type="button">X</button></Modal>);
    expect(document.activeElement).not.toBe(trigger);
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('does not refocus an opener that was removed while it was open', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = render(<Modal onClose={() => {}} title="T"><button type="button">X</button></Modal>);
    trigger.remove();
    expect(() => unmount()).not.toThrow();
    expect(document.activeElement).not.toBe(trigger);
  });

  it('never touches the body\'s overflow, which would shift the layout', () => {
    document.body.style.overflow = 'scroll';
    const { unmount } = render(<Modal onClose={() => {}} title="T"><p>Body</p></Modal>);
    expect(document.body.style.overflow).toBe('scroll');
    unmount();
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });
});
