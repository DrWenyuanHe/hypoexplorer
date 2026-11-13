import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../pwa/forceRefresh', () => ({
  forceRefresh: vi.fn().mockResolvedValue(undefined),
}));

import { forceRefresh } from '../pwa/forceRefresh';
import {
  subscribe,
  getSnapshot,
  markUpdateAvailable,
  applyUpdate,
  _resetUpdateStore,
} from '../pwa/updateStore';
import { UpdateModal } from '../pwa/UpdateModal';

beforeEach(() => {
  _resetUpdateStore();
});

// ─── External store ────────────────────────────────────────────────────────────
describe('updateStore', () => {
  it('starts at signal 0 and bumps monotonically on each update', () => {
    expect(getSnapshot()).toBe(0);
    markUpdateAvailable((() => {}) as any);
    expect(getSnapshot()).toBe(1);
    markUpdateAvailable((() => {}) as any);
    expect(getSnapshot()).toBe(2);
  });

  it('notifies subscribers and supports unsubscribe', () => {
    const listener = vi.fn();
    const unsub = subscribe(listener);
    markUpdateAvailable((() => {}) as any);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    markUpdateAvailable((() => {}) as any);
    expect(listener).toHaveBeenCalledTimes(1); // not called after unsubscribe
  });

  it('applyUpdate calls the stored reload fn with true; no-ops before any update', () => {
    expect(() => applyUpdate()).not.toThrow(); // no fn yet → safe no-op
    const reloadFn = vi.fn();
    markUpdateAvailable(reloadFn);
    applyUpdate();
    expect(reloadFn).toHaveBeenCalledTimes(1);
    expect(reloadFn).toHaveBeenCalledWith(true);
  });
});

// ─── Modal ───────────────────────────────────────────────────────────────────
// The update is MANDATORY: the prompt has no dismissal of any kind and reloads
// on its own once the countdown runs out. These pin both halves — that nothing
// closes it, and that doing nothing still ends in the update being applied.
describe('UpdateModal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // The full countdown, plus a second of slack.
  const runOutCountdown = () => act(() => { vi.advanceTimersByTime(11_000); });

  it('renders nothing until an update is signalled', () => {
    const { container } = render(<UpdateModal />);
    expect(container.firstChild).toBeNull();
    act(() => markUpdateAvailable((() => {}) as any));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText(/Updating to the newest version/i)).toBeTruthy();
  });

  it('offers no way out: no Later, no dismiss button, no Escape, no backdrop click', () => {
    render(<UpdateModal />);
    act(() => markUpdateAvailable((() => {}) as any));
    expect(screen.getByRole('alertdialog')).toBeTruthy();

    // The two affordances that used to make the update optional are gone.
    expect(screen.queryByRole('button', { name: /later/i })).toBeNull();
    expect(screen.queryByLabelText(/dismiss/i)).toBeNull();

    // Escape is swallowed.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeTruthy();

    // Backdrop (role=presentation) click is swallowed.
    const backdrop = document.querySelector('[role="presentation"]')!;
    fireEvent.click(backdrop, { target: backdrop });
    expect(screen.queryByRole('alertdialog')).toBeTruthy();

    // Reload is the only button offered.
    expect(screen.getByRole('button', { name: /^Reload now$/ })).toBeTruthy();
  });

  it('counts down and applies the update on its own when the user does nothing', () => {
    const reloadFn = vi.fn();
    render(<UpdateModal />);
    act(() => markUpdateAvailable(reloadFn));

    expect(screen.getByText(/Reloading automatically in 10 seconds/i)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(4_000); });
    expect(screen.getByText(/Reloading automatically in 6 seconds/i)).toBeTruthy();
    expect(reloadFn).not.toHaveBeenCalled();

    runOutCountdown();
    expect(reloadFn).toHaveBeenCalledTimes(1);
    expect(reloadFn).toHaveBeenCalledWith(true);
  });

  it('"Reload now" applies immediately, and the countdown cannot apply it twice', () => {
    const reloadFn = vi.fn();
    render(<UpdateModal />);
    act(() => markUpdateAvailable(reloadFn));

    fireEvent.click(screen.getByRole('button', { name: /^Reload now$/ }));
    expect(reloadFn).toHaveBeenCalledWith(true);
    expect(screen.getAllByText(/Reloading…/i).length).toBeGreaterThan(0);

    runOutCountdown();
    expect(reloadFn).toHaveBeenCalledTimes(1);
  });

  // The update is mandatory, so this dialog has no dismissal of any kind. That
  // makes a reload that never arrives a trap: the app is unreachable behind a
  // spinner with no control to press. Recovery paths exist a layer down
  // (registerUpdates.ts's watchdog, forceRefresh's own timeout); this is the
  // backstop for a reload prevented outright.
  it('hands the user a control back when the reload never arrives', () => {
    vi.mocked(forceRefresh).mockClear();
    render(<UpdateModal />);
    act(() => markUpdateAvailable(vi.fn()));

    fireEvent.click(screen.getByRole('button', { name: /^Reload now$/ }));
    expect((screen.getByRole('button', { name: /Reloading/ }) as HTMLButtonElement).disabled).toBe(true);

    act(() => { vi.advanceTimersByTime(21_000); });

    const recover = screen.getByRole('button', { name: /^Force refresh$/ }) as HTMLButtonElement;
    expect(recover.disabled).toBe(false);
    expect(screen.getByText(/has not gone through/i)).toBeTruthy();

    fireEvent.click(recover);
    expect(forceRefresh).toHaveBeenCalledTimes(1);
  });

  // A retry leaves `pending` true, so a watchdog keyed only on `pending` would
  // not re-arm and the second failure would be final.
  it('offers the recovery again when the retry also fails', () => {
    vi.mocked(forceRefresh).mockClear();
    render(<UpdateModal />);
    act(() => markUpdateAvailable(vi.fn()));
    fireEvent.click(screen.getByRole('button', { name: /^Reload now$/ }));

    act(() => { vi.advanceTimersByTime(21_000); });
    fireEvent.click(screen.getByRole('button', { name: /^Force refresh$/ }));
    expect(screen.queryByRole('button', { name: /^Force refresh$/ })).toBeNull(); // back to pending

    act(() => { vi.advanceTimersByTime(21_000); });
    expect(screen.getByRole('button', { name: /^Force refresh$/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Force refresh$/ }));
    expect(forceRefresh).toHaveBeenCalledTimes(2);
  });

  // The layer below owns automatic recovery: an 8s handover watchdog plus a 4s
  // cleanup budget. This backstop must not fire on top of that.
  it('does not offer the recovery while automatic recovery is still working', () => {
    render(<UpdateModal />);
    act(() => markUpdateAvailable(vi.fn()));
    fireEvent.click(screen.getByRole('button', { name: /^Reload now$/ }));

    act(() => { vi.advanceTimersByTime(14_000); });
    expect(screen.queryByRole('button', { name: /^Force refresh$/ })).toBeNull();
  });

  it('restarts for a newer update signalled while the tab is still open', () => {
    const first = vi.fn();
    const second = vi.fn();
    render(<UpdateModal />);
    act(() => markUpdateAvailable(first));
    runOutCountdown();
    expect(first).toHaveBeenCalledTimes(1);

    // A second deploy lands before the reload completes: the prompt re-arms and
    // applies the newer one too, rather than staying spent.
    act(() => markUpdateAvailable(second));
    expect(screen.getByText(/Reloading automatically in 10 seconds/i)).toBeTruthy();
    runOutCountdown();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
