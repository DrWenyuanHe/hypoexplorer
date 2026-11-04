import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ConfirmDialog } from '../pwa/ConfirmDialog';

// The PWA alert shell owns two policies its two callers deliberately disagree
// on, plus a body-scroll lock. UpdateModal's 'swallow' branch is pinned through
// its caller in pwaUpdate.test.tsx; these pin the shell contract itself — the
// callback branch, the capture-phase swallow, and lock save/restore.

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

describe('ConfirmDialog — body scroll lock', () => {
  it('locks the body while open and RESTORES the previous value, not the empty string', () => {
    document.body.style.overflow = 'scroll';
    const { unmount } = renderDialog('swallow');
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });

  it('renders an alertdialog wired to its caller-supplied heading and description', () => {
    renderDialog('swallow');
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('t');
    expect(dialog.getAttribute('aria-describedby')).toBe('d');
    expect(screen.getByText('Title')).toBeTruthy();
  });
});
