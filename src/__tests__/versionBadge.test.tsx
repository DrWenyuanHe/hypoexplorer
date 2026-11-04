import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Isolate the badge's UI flow from the real SW/cache teardown (covered in
// forceRefresh.test.js): mock the helper and assert the badge invokes it only
// after the user confirms.
const forceRefreshMock = vi.fn();
vi.mock('../pwa/forceRefresh', () => ({ forceRefresh: () => forceRefreshMock() }));

import { VersionBadge } from '../pwa/VersionBadge';

const badge = () => screen.getByRole('button', { name: /Refresh to the latest version/i });

describe('VersionBadge', () => {
  beforeEach(() => forceRefreshMock.mockClear());

  it('shows the build version and no popup initially', () => {
    render(<VersionBadge />);
    expect(badge()).toBeTruthy();
    expect(screen.getByText(/^v/)).toBeTruthy(); // "v0.5.0.0" (or "vdev")
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('opens a confirmation popup on click; Cancel dismisses without refreshing', () => {
    render(<VersionBadge />);
    fireEvent.click(badge());
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(forceRefreshMock).not.toHaveBeenCalled();
  });

  it('"Refresh now" runs the cache-clearing reload exactly once', () => {
    render(<VersionBadge />);
    fireEvent.click(badge());
    fireEvent.click(screen.getByRole('button', { name: /Refresh now/i }));
    expect(forceRefreshMock).toHaveBeenCalledTimes(1);
  });

  // Unlike UpdateModal, which swallows Escape outright, this badge's prompt is
  // an ordinary cancellable confirmation - EXCEPT once the refresh is in
  // flight, where dismissing would leave the user staring at a page that is
  // about to navigate away.
  it('Escape cancels the prompt without refreshing', () => {
    render(<VersionBadge />);
    fireEvent.click(badge());
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(forceRefreshMock).not.toHaveBeenCalled();
  });

  it('Escape is ignored once the refresh is already in flight', () => {
    render(<VersionBadge />);
    fireEvent.click(badge());
    fireEvent.click(screen.getByRole('button', { name: /Refresh now/i }));
    // Pending state: both buttons disabled, label switched.
    expect(screen.getByRole('button', { name: /Refreshing/i })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(forceRefreshMock).toHaveBeenCalledTimes(1);
  });
});
