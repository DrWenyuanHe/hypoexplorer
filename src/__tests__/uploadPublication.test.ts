import { describe, expect, it } from 'vitest';
import { uploadWithPublicationBarrier } from '../../scripts/lib/uploadPublication.mjs';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('R2 upload publication barrier', () => {
  it('waits for every active object before publishing the pointer', async () => {
    const slow = deferred();
    const fastFinished = deferred();
    const completed: string[] = [];
    const pending = uploadWithPublicationBarrier(['slow-shard', 'fast-shard'], ['tracks.js'], {
      concurrency: 2,
      upload: async (object) => {
        if (object === 'slow-shard') await slow.promise;
        completed.push(object);
        if (object === 'fast-shard') fastFinished.resolve();
      },
    });
    await fastFinished.promise;
    expect(completed).toEqual(['fast-shard']);
    slow.resolve();
    expect(await pending).toEqual({ failures: [], skippedPointers: [] });
    expect(completed).toEqual(['fast-shard', 'slow-shard', 'tracks.js']);
  });

  it('suppresses publication after an object fails while draining active uploads', async () => {
    const slow = deferred();
    const failed = deferred();
    const completed: string[] = [];
    const error = new Error('Shard upload failed after retry');
    const pending = uploadWithPublicationBarrier(['bad-shard', 'slow-shard', 'last-shard'], ['tracks.js'], {
      concurrency: 2,
      upload: async (object) => {
        if (object === 'bad-shard') { failed.resolve(); throw error; }
        if (object === 'slow-shard') await slow.promise;
        completed.push(object);
      },
    });
    await failed.promise;
    slow.resolve();
    expect(await pending).toEqual({
      failures: [{ object: 'bad-shard', error }],
      skippedPointers: ['tracks.js'],
    });
    expect(completed.sort()).toEqual(['last-shard', 'slow-shard']);
  });

  it('reports a pointer failure and supports dataset-only uploads', async () => {
    const error = new Error('Pointer write failed');
    expect(await uploadWithPublicationBarrier([], ['tracks.js'], {
      concurrency: 2,
      upload: async () => { throw error; },
    })).toEqual({ failures: [{ object: 'tracks.js', error }], skippedPointers: [] });
    const completed: string[] = [];
    expect(await uploadWithPublicationBarrier(['track.js'], [], {
      concurrency: 2,
      upload: async (object) => { completed.push(object); },
    })).toEqual({ failures: [], skippedPointers: [] });
    expect(completed).toEqual(['track.js']);
  });

  it('rejects invalid concurrency before any publication can happen', async () => {
    for (const concurrency of [0, -1, Number.NaN, 1.5]) {
      await expect(uploadWithPublicationBarrier([], ['tracks.js'], {
        concurrency,
        upload: async () => { throw new Error('Must not upload'); },
      })).rejects.toThrow('positive integer');
    }
  });
});
