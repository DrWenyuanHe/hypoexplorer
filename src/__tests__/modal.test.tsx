import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from '../common/Modal';

// Focus management for the shared Modal: focus moves in on open, Tab is trapped
// within the panel (both directions, including from the panel itself), Escape
// closes, and focus is restored to the trigger on close — but never to a node
// that was unmounted while the modal was open.
//
// The trap no longer decides visibility here: that moved to isFocusable in
// src/utils/focusTrap.ts, which asks checkVisibility and falls back to a
// hidden/display:none walk. This file used to mock HTMLElement.offsetParent for
// the filter that used to live in Modal; the filter is gone, so the mock is too.
// The visibility rules themselves are pinned in focusTrap.test.tsx.

const panelOf = () => document.querySelector('.modal-panel') as HTMLElement;

describe('Modal — focus management', () => {
  it('moves focus into the panel on mount', () => {
    render(<Modal onClose={() => {}} title="T"><button type="button">Inside</button></Modal>);
    expect(document.activeElement).toBe(panelOf());
  });

  it('Tab from the panel moves focus to the first focusable (the close button)', () => {
    render(<Modal onClose={() => {}} title="T"><button type="button">Body</button></Modal>);
    const panel = panelOf();
    panel.focus();
    fireEvent.keyDown(panel, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByLabelText('Close'));
  });

  it('Tab from the last focusable wraps to the first', () => {
    render(<Modal onClose={() => {}} title="T"><button type="button">Body</button></Modal>);
    const body = screen.getByText('Body');
    body.focus();
    fireEvent.keyDown(body, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByLabelText('Close'));
  });

  it('Shift+Tab from the first focusable wraps to the last', () => {
    render(<Modal onClose={() => {}} title="T"><button type="button">Body</button></Modal>);
    const close = screen.getByLabelText('Close');
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('Body'));
  });

  it('keeps focus trapped when the close button is the only focusable', () => {
    render(<Modal onClose={() => {}} title="T"><p>Just text</p></Modal>);
    const close = screen.getByLabelText('Close');
    fireEvent.keyDown(panelOf(), { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(document.activeElement).toBe(close); // first === last → stays
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} title="T"><button type="button">X</button></Modal>);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the trigger element on close', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = render(<Modal onClose={() => {}} title="T"><button type="button">X</button></Modal>);
    expect(document.activeElement).not.toBe(trigger); // modal took focus
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('does not restore focus to a trigger that was unmounted while open', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = render(<Modal onClose={() => {}} title="T"><button type="button">X</button></Modal>);
    trigger.remove(); // opener navigated away while the modal was up
    expect(() => unmount()).not.toThrow();
    expect(document.activeElement).not.toBe(trigger);
  });
});

// The page behind a modal must not scroll under it. The lock lives in Modal so
// every dialog gets it; the previous value is restored (not cleared) so a modal
// opened over another modal can't hand the scrollbar back too early.
describe('Modal — body scroll lock', () => {
  it('locks body scroll while open and restores the previous value on close', () => {
    document.body.style.overflow = 'scroll';
    const { unmount } = render(<Modal onClose={() => {}} title="T"><button type="button">X</button></Modal>);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });

  it('nested modals keep the lock until the outer one closes', () => {
    const outer = render(<Modal onClose={() => {}} title="Outer"><button type="button">X</button></Modal>);
    const inner = render(<Modal onClose={() => {}} title="Inner"><button type="button">Y</button></Modal>);
    inner.unmount();
    expect(document.body.style.overflow).toBe('hidden');
    outer.unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
