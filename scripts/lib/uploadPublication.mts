/** A mutable pointer can name a release only after all its objects are available. */
export async function uploadWithPublicationBarrier<T>(
  objects: readonly T[],
  pointers: readonly T[],
  options: {
    concurrency: number;
    upload: (object: T) => Promise<void>;
    onSettled?: (object: T, error?: unknown) => void;
  },
): Promise<{
  failures: Array<{ object: T; error: unknown }>;
  skippedPointers: readonly T[];
}> {
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error('Upload concurrency must be a positive integer.');
  }
  const failures: Array<{ object: T; error: unknown }> = [];
  let cursor = 0;
  async function upload(object: T): Promise<void> {
    try {
      await options.upload(object);
    } catch (error) {
      failures.push({ object, error });
      options.onSettled?.(object, error);
      return;
    }
    options.onSettled?.(object);
  }
  async function worker(): Promise<void> {
    while (cursor < objects.length) await upload(objects[cursor++]);
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, objects.length) }, worker));
  if (failures.length) return { failures, skippedPointers: pointers };

  // This is a completion barrier, not merely a last place in the work queue.
  for (let index = 0; index < pointers.length; index++) {
    await upload(pointers[index]);
    if (failures.length) return { failures, skippedPointers: pointers.slice(index + 1) };
  }
  return { failures, skippedPointers: [] };
}
