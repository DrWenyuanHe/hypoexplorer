import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { parseRoute, routeHref } from '../utils/appLinks';
import { useAppRouter } from '../appRouter';

afterEach(() => { window.history.replaceState(null, '', '/'); });

describe('expression survey navigation', () => {
  it('round trips the public module route', () => {
    expect(routeHref({ view: 'expression' })).toBe('#/expression');
    expect(parseRoute('#/expression/')).toEqual({ view: 'expression' });
  });

  it('opens directly and returns through browser history without selecting a DE track', () => {
    window.history.replaceState(null, '', '#/expression');
    const explorer = { navigate: vi.fn() };
    const { result } = renderHook(() => useAppRouter('hub', explorer));
    expect(result.current.view).toBe('expression');
    act(() => { result.current.goHome(); });
    expect(result.current.view).toBe('hub');
    act(() => { result.current.openExpression(); });
    expect(window.location.hash).toBe('#/expression');
    expect(explorer.navigate).not.toHaveBeenCalled();
  });
});
