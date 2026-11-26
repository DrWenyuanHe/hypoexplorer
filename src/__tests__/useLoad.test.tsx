import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLoad } from '../common/useLoad';

// The one keyed load-and-retry lifecycle the search cards, gene-page cards and
// HypoMap views share: idle without a key, loading for a new key or a Retry
// (never the previous key's value), failed with a Retry when a load rejects,
// and a stale answer for a key that has moved on dropped.

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('useLoad', () => {
  it('is idle without a key and loads nothing', () => {
    let calls = 0;
    const { result } = renderHook(() => useLoad<string>(null, async () => { calls += 1; return 'x'; }));
    expect(result.current).toEqual({ state: 'idle' });
    expect(calls).toBe(0);
  });

  it('shows loading, then the value for its key', async () => {
    const d = deferred<string>();
    const { result } = renderHook(() => useLoad('POMC', () => d.promise));
    expect(result.current.state).toBe('loading');
    await act(async () => { d.resolve('value'); });
    expect(result.current).toEqual({ state: 'loaded', value: 'value' });
  });

  it('shows loading for a new key at once and drops the older key\'s late answer', async () => {
    const answers: Record<string, ReturnType<typeof deferred<string>>> = { a: deferred(), b: deferred() };
    const { result, rerender } = renderHook(({ key }) => useLoad(key, () => answers[key].promise), {
      initialProps: { key: 'a' },
    });
    await act(async () => { answers.a.resolve('A'); });
    expect(result.current).toEqual({ state: 'loaded', value: 'A' });

    rerender({ key: 'b' });
    expect(result.current.state).toBe('loading');
    await act(async () => { answers.b.resolve('B'); });
    expect(result.current).toEqual({ state: 'loaded', value: 'B' });
  });

  it('never shows a superseded key\'s answer that settles late', async () => {
    const answers: Record<string, ReturnType<typeof deferred<string>>> = { a: deferred(), b: deferred() };
    const { result, rerender } = renderHook(({ key }) => useLoad(key, () => answers[key].promise), {
      initialProps: { key: 'a' },
    });
    rerender({ key: 'b' });
    await act(async () => { answers.a.resolve('A'); });
    expect(result.current.state).toBe('loading');
    await act(async () => { answers.b.resolve('B'); });
    expect(result.current).toEqual({ state: 'loaded', value: 'B' });
  });

  it('fails with a Retry instead of staying loading, and Retry loads again', async () => {
    let attempt = 0;
    const { result } = renderHook(() => useLoad('POMC', async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('offline');
      return 'second';
    }));
    await act(async () => {});
    expect(result.current.state).toBe('failed');

    const { retry } = result.current as { state: 'failed'; retry: () => void };
    act(() => { retry(); });
    expect(result.current.state).toBe('loading');
    await act(async () => {});
    expect(result.current).toEqual({ state: 'loaded', value: 'second' });
  });

  it('aborts the load when the key changes or the view unmounts', () => {
    const signals: AbortSignal[] = [];
    const { rerender, unmount } = renderHook(({ key }) => useLoad(key, (signal) => {
      signals.push(signal);
      return new Promise<string>(() => {});
    }), { initialProps: { key: 'a' as string | null } });
    rerender({ key: 'b' });
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    unmount();
    expect(signals[1].aborted).toBe(true);
  });

  it('goes idle when its key is withdrawn', async () => {
    const { result, rerender } = renderHook(({ key }) => useLoad(key, async () => 'x'), {
      initialProps: { key: 'a' as string | null },
    });
    await act(async () => {});
    expect(result.current.state).toBe('loaded');
    rerender({ key: null });
    expect(result.current).toEqual({ state: 'idle' });
  });
});
