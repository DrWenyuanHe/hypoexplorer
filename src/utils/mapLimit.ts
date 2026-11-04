// Concurrency-limited async map. Runs `fn` over `items` with at most `limit`
// promises in flight at once, preserving result order (results[i] = fn(items[i])).
//
// The cross-dataset fan-outs inject one <script> per track; firing all of them
// at once (e.g. 60 macaque populations + 40 mouse tracks simultaneously) floods
// the network and the main thread. Capping in-flight work keeps the browser
// responsive while still overlapping requests. A rejected `fn` rejects the whole
// run, matching Promise.all semantics — callers that want per-item tolerance
// should resolve to a sentinel inside `fn` (as the queries do, returning null).
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const cap = Math.max(1, Math.min(limit, items.length));

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: cap }, () => worker()));
  return results;
}
