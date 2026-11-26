import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCompareView } from '../compare/useCompareView';

// The shell's hold on Compare's view. A link that lands remounts Compare (a
// new epoch); a change Compare reports never does, so the tab the user is in
// is not remounted under them.

describe('useCompareView', () => {
  it('lands a link with a new epoch, and keeps it for that dataset only', () => {
    const { result, rerender } = renderHook(({ id }) => useCompareView(id), { initialProps: { id: 'a' } });
    expect(result.current.link).toBeUndefined();
    const before = result.current.epoch;

    act(() => { result.current.land('a', { genes: ['POMC'] }); });
    expect(result.current.link).toEqual({ genes: ['POMC'] });
    expect(result.current.epoch).toBe(before + 1);

    // Another dataset's view is not resumed.
    rerender({ id: 'b' });
    expect(result.current.link).toBeUndefined();
  });

  it('records what Compare reports without changing the epoch', () => {
    const { result } = renderHook(() => useCompareView('a'));
    const epoch = result.current.epoch;
    act(() => { result.current.report({ pops: ['e9', 'e33'] }); });
    expect(result.current.link).toEqual({ pops: ['e9', 'e33'] });
    expect(result.current.epoch).toBe(epoch);
  });

  it('ignores a report equal to the view it holds', () => {
    const { result } = renderHook(() => useCompareView('a'));
    act(() => { result.current.report({ genes: ['POMC'] }); });
    const held = result.current.link;
    act(() => { result.current.report({ genes: ['POMC'], mode: 'genes' }); });
    expect(result.current.link).toBe(held);
  });

  it('keeps land stable, and report stable for one dataset', () => {
    const { result, rerender } = renderHook(({ id }) => useCompareView(id), { initialProps: { id: 'a' } });
    const { land, report } = result.current;
    rerender({ id: 'a' });
    expect(result.current.land).toBe(land);
    expect(result.current.report).toBe(report);
  });
});
