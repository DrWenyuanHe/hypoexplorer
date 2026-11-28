import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * True while an input method (a Chinese, Japanese or Korean IME) is composing
 * text, so the key belongs to the IME and not to the field's own handler.
 *
 * A text field that acts on Enter, Escape or the arrow keys in its own keydown
 * handler checks this first. With an IME on, Enter confirms the typed letters
 * and the arrows move through the candidate list; acting on those keys too
 * would search on half-typed text or move the suggestion highlight.
 *
 * `keyCode === 229` is kept beside `isComposing` because Safari has delivered
 * `compositionend` before the confirming Enter's keydown, which clears
 * `isComposing` by the time the handler runs; the keydown still reports 229.
 * Native implicit form submission needs no check: browsers already skip it
 * for an Enter the IME consumed.
 */
export function isImeComposing(event: ReactKeyboardEvent | KeyboardEvent): boolean {
  const native = 'nativeEvent' in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229;
}
