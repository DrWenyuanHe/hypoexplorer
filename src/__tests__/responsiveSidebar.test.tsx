import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResponsiveSidebar } from '../common/ResponsiveSidebar';

function viewport(compact: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: compact,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => query));
  return (next: boolean) => act(() => { query.matches = next; listeners.forEach((listener) => { listener(); }); });
}

function Navigator() {
  const [selected, setSelected] = useState('e9');
  return <ResponsiveSidebar label="Cells" summary={selected}>
    {(close) => <button type="button" onClick={() => { setSelected('e10'); close(); }}>Choose e10</button>}
  </ResponsiveSidebar>;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('responsive navigation', () => {
  it('opens a named mobile dialog, selects a cell and returns focus to its trigger', () => {
    viewport(true);
    render(<Navigator />);
    const trigger = screen.getByRole('button', { name: 'Cells e9' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Cells' })).getByRole('button', { name: 'Choose e10' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cells e10' })).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('dismisses with Escape, restores scrolling, and can reopen', () => {
    viewport(true);
    render(<Navigator />);
    fireEvent.click(screen.getByRole('button', { name: 'Cells e9' }));
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Cells e9' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show results' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the selected cell across breakpoint changes and releases an open modal', () => {
    const resize = viewport(false);
    render(<Navigator />);
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Cells' })).getByRole('button'));
    resize(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cells e10' }));
    resize(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(screen.getAllByRole('button', { name: 'Choose e10' })).toHaveLength(1);
    resize(true);
    expect(screen.getByRole('button', { name: 'Cells e10' })).toHaveAttribute('aria-expanded', 'false');
  });
});
