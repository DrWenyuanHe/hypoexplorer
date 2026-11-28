import { describe, it, expect } from 'vitest';
import { isImeComposing } from '../utils/imeComposing';

type KeyEvent = Parameters<typeof isImeComposing>[0];
// The two fields the check reads; the node test environment has no KeyboardEvent.
const key = (isComposing: boolean, keyCode: number) => ({ key: 'Enter', isComposing, keyCode }) as unknown as KeyEvent;

// An Enter that confirms IME text must not reach a field's own Enter handler.
describe('isImeComposing', () => {
  it('is false for a plain Enter', () => {
    expect(isImeComposing(key(false, 13))).toBe(false);
  });

  it('is true while the IME reports a composition', () => {
    expect(isImeComposing(key(true, 13))).toBe(true);
  });

  it('is true for the 229 keydown Safari sends after composition has ended', () => {
    expect(isImeComposing(key(false, 229))).toBe(true);
  });

  it('reads the native event under a React keyboard event', () => {
    expect(isImeComposing({ nativeEvent: key(true, 229) } as unknown as KeyEvent)).toBe(true);
    expect(isImeComposing({ nativeEvent: key(false, 13) } as unknown as KeyEvent)).toBe(false);
  });
});
