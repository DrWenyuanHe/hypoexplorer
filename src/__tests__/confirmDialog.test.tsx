import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ConfirmDialog } from '../pwa/ConfirmDialog';

// The PWA alert shell owns two Escape policies its two callers deliberately
// disagree on, and is a native modal <dialog> (setup.ts shims showModal and the
// Escape close request). UpdateModal's 'swallow' branch is pinned through its
// caller in pwaUpdate.test.tsx; these pin the shell contract itself — the
// callback branch, the capture-phase swallow, and that only the caller closes it.

const renderDialog = (onEscape: (() => void) | 'swallow') =>
  render(
    <ConfirmDialog labelledBy="t" describedBy="d" onEscape={onEscape}>
      <h2 id="t">Title</h2>
      <p id="d">Body</p>
    </ConfirmDialog>,
  );

describe('ConfirmDialog — Escape policy', () => {
  it('calls the callback on Escape, and only on Escape', () => {
    const onEscape = vi.fn();
    renderDialog(onEscape);
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'a' });
    expect(onEscape).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("'swallow' stops Escape in the capture phase, so page-level listeners never see it", () => {
    const pageListener = vi.fn();
    window.addEventListener('keydown', pageListener);
    try {
      renderDialog('swallow');
      fireEvent.keyDown(window, { key: 'Escape' });
      // The capture-phase handler ran first and stopped propagation.
      expect(pageListener).not.toHaveBeenCalled();
      // A non-Escape key is untouched and still reaches the page.
      fireEvent.keyDown(window, { key: 'x' });
      expect(pageListener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', pageListener);
    }
  });

  it('stops listening once unmounted', () => {
    const onEscape = vi.fn();
    const { unmount } = renderDialog(onEscape);
    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onEscape).not.toHaveBeenCalled();
  });
});

describe('ConfirmDialog — a native modal alertdialog', () => {
  it('opens modally as an alertdialog wired to its caller-supplied heading and description', () => {
    renderDialog('swallow');
    const dialog = screen.getByRole('alertdialog') as HTMLDialogElement;
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog.open).toBe(true);
    expect(dialog.hasAttribute('aria-modal')).toBe(false);
    expect(dialog.getAttribute('aria-labelledby')).toBe('t');
    expect(dialog.getAttribute('aria-describedby')).toBe('d');
    expect(screen.getByText('Title')).toBeTruthy();
  });

  it('never closes on a backdrop press, and asks for close requests only when it has a callback', () => {
    const swallowing = renderDialog('swallow');
    expect(screen.getByRole('alertdialog').getAttribute('closedby')).toBe('none');
    swallowing.unmount();
    renderDialog(() => {});
    expect(screen.getByRole('alertdialog').getAttribute('closedby')).toBe('closerequest');
  });

  it('stays open on Escape until the caller unmounts it', () => {
    const onEscape = vi.fn();
    renderDialog(onEscape);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('alertdialog') as HTMLDialogElement).open).toBe(true);
  });

  it('shows itself again if the browser closes it anyway', () => {
    renderDialog('swallow');
    const dialog = screen.getByRole('alertdialog') as HTMLDialogElement;
    dialog.close();
    expect(dialog.open).toBe(true);
  });

  it('leaves the body overflow alone', () => {
    document.body.style.overflow = 'scroll';
    const { unmount } = renderDialog('swallow');
    expect(document.body.style.overflow).toBe('scroll');
    unmount();
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });
});
