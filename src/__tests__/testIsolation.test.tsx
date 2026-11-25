// The URL reset between tests (setup.ts) must come after the page is unmounted.
// Unmounting runs the effects React still had pending, and the router's URL
// write is one: reset first, and the write lands after it, so the next test
// boots from the previous test's route.
import { act, render } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';

/** Shows a state on the next tick, then writes a URL for it, as the router does. */
function LateUrlWriter() {
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLanded(true));
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (landed) window.history.replaceState(null, '', '#/dataset/left-behind');
  }, [landed]);
  return <p>{landed ? 'landed' : 'landing'}</p>;
}

describe('the URL reset between tests', () => {
  it('ends while an effect that writes the URL is still pending', async () => {
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const { container } = render(<LateUrlWriter />);
    // Outside act, as in the app: React paints first and runs the effect later.
    env.IS_REACT_ACT_ENVIRONMENT = false;
    await new Promise<void>((resolve) => {
      new MutationObserver((_, observer) => {
        observer.disconnect();
        resolve();
      }).observe(container, { characterData: true, childList: true, subtree: true });
    });
    env.IS_REACT_ACT_ENVIRONMENT = true;
    expect(container.textContent).toBe('landed');
    expect(window.location.hash, 'the effect has not run yet').toBe('');
  });

  it('leaves the next test at the root', async () => {
    await act(async () => {});
    expect(window.location.hash).toBe('');
  });
});
