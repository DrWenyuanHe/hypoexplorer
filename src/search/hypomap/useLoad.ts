import { useCallback, useEffect, useRef, useState } from 'react';

export type Load<T> =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'failed'; retry: () => void }
  | { state: 'loaded'; value: T };

type Settled<T> = { key: string; attempt: number; ok: true; value: T } | { key: string; attempt: number; ok: false };

/**
 * The HypoMap views' one load-and-retry lifecycle. `key` names everything the load reads
 * (null = nothing to load yet); a new key or a Retry shows `loading` at once, never the
 * previous key's value, and a settled load whose key or attempt has moved on is dropped.
 * The signal aborts when the key changes or the view unmounts.
 */
export function useLoad<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>): Load<T> {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const latest = useRef(load);
  latest.current = load;

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    latest.current(controller.signal).then(
      value => { if (!controller.signal.aborted) setSettled({ key, attempt, ok: true, value }); },
      () => { if (!controller.signal.aborted) setSettled({ key, attempt, ok: false }); },
    );
    return () => controller.abort();
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt(n => n + 1), []);
  if (key === null) return { state: 'idle' };
  if (!settled || settled.key !== key || settled.attempt !== attempt) return { state: 'loading' };
  return settled.ok ? { state: 'loaded', value: settled.value } : { state: 'failed', retry };
}
