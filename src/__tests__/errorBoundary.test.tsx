import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

// A child that throws based on a mutable flag, so a test can flip it between the
// boundary's resets and observe remount behaviour.
function Boom({ flag }: { flag: { throw: boolean } }) {
  if (flag.throw) throw new Error('kaboom');
  return <div>child ok</div>;
}

describe('ErrorBoundary', () => {
  let errSpy: { mockRestore: () => void };
  // React logs caught render errors via console.error; silence to keep output clean.
  beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { errSpy.mockRestore(); });

  it('catches a child crash and shows the fallback with the error message + reload button', () => {
    render(<ErrorBoundary><Boom flag={{ throw: true }} /></ErrorBoundary>);
    expect(screen.getByText(/Something went wrong in this tab/i)).toBeTruthy();
    expect(screen.getByText('kaboom')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reload this tab/i })).toBeTruthy();
  });

  it('reset() truly remounts the subtree — a child that stops throwing recovers', () => {
    const flag = { throw: true };
    render(<ErrorBoundary><Boom flag={flag} /></ErrorBoundary>);
    flag.throw = false; // the remounted child will render cleanly
    fireEvent.click(screen.getByRole('button', { name: /Reload this tab/i }));
    expect(screen.getByText('child ok')).toBeTruthy();
    expect(screen.queryByText(/Something went wrong/i)).toBeNull();
  });

  it('stops offering reload after MAX_RESETS failed attempts (no infinite loop)', () => {
    render(<ErrorBoundary><Boom flag={{ throw: true }} /></ErrorBoundary>); // never recovers
    // Three resets, each re-throwing on remount, exhausts the retry budget.
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Reload this tab/i }));
    }
    expect(screen.queryByRole('button', { name: /Reload this tab/i })).toBeNull();
    expect(screen.getByText(/keeps failing after 3 attempts/i)).toBeTruthy();
  });
});
