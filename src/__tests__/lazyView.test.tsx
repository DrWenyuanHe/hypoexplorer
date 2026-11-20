import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { lazyView } from '../common/lazyView';
import { ErrorBoundary } from '../ErrorBoundary';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function Greeting({ name }: { name: string }) {
  return <p>Hello {name}</p>;
}

describe('lazyView', () => {
  it('shows the fallback until the chunk arrives, then the view', async () => {
    const chunk = deferred<typeof Greeting>();
    const View = lazyView(() => chunk.promise, <p>Loading view</p>);
    render(<View name="hub" />);
    expect(screen.getByText('Loading view')).toBeInTheDocument();
    await act(async () => { chunk.resolve(Greeting); });
    // React reveals content that replaces a shown fallback on a short throttle.
    expect(await screen.findByText('Hello hub')).toBeInTheDocument();
  });

  it('renders synchronously once preloaded, and downloads once', async () => {
    const load = vi.fn(() => Promise.resolve(Greeting));
    const View = lazyView(load);
    await Promise.all([View.preload(), View.preload()]);
    render(<View name="explorer" />);
    expect(screen.getByText('Hello explorer')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps the view mounted (and its state) when the parent re-renders after loading', async () => {
    function Counter({ label }: { label: string }) {
      const [n, setN] = useState(0);
      return <button type="button" onClick={() => setN((v) => v + 1)}>{label} {n}</button>;
    }
    const chunk = deferred<typeof Counter>();
    const View = lazyView(() => chunk.promise, null);
    const { rerender } = render(<View label="count" />);
    await act(async () => { chunk.resolve(Counter); });
    fireEvent.click(await screen.findByRole('button', { name: 'count 0' }));
    rerender(<View label="tally" />);
    expect(screen.getByRole('button', { name: 'tally 1' })).toBeInTheDocument();
  });

  it('reports a failed download once, then downloads again when the error boundary resets', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const load = vi.fn<() => Promise<typeof Greeting>>()
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce(Greeting);
    const View = lazyView(load, null);
    render(<ErrorBoundary><View name="again" /></ErrorBoundary>);
    expect(await screen.findByText('Failed to fetch dynamically imported module')).toBeInTheDocument();
    // React re-renders after an error; that must rethrow, not start a new download.
    expect(load).toHaveBeenCalledTimes(1);
    const later = Date.now() + 5000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    fireEvent.click(screen.getByRole('button', { name: 'Reload this tab' }));
    expect(await screen.findByText('Hello again')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
});
