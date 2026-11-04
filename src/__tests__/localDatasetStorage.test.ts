// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteLocalDataset, listLocalDatasets, LOCAL_DATASETS_DATABASE,
  LOCAL_DATASETS_SCHEMA_VERSION, LOCAL_DATASETS_STORE, saveLocalDataset, saveLocalDatasets,
} from '../local-datasets/storage';
import type { LocalDataset } from '../local-datasets/types';

const dataset = (id = 'local-a'): LocalDataset => ({
  id, name: id, organism: 'Mus musculus', createdAt: '2026-09-05T00:00:00Z',
  updatedAt: '2026-09-05T00:00:00Z', sources: [], pathways: [],
  genes: [{ gene: 'Pomc', logFC: 2, pvalue: 0.01, padj: 0.02, source: 'results.csv' }],
});

// Drive transaction events independently of request events: put/get success is
// not persistence success, and a later request may still abort the entire batch.
function databaseHarness() {
  const request = { result: null, error: null, onsuccess: null } as unknown as IDBRequest;
  const tx = {
    error: null, oncomplete: null, onabort: null, onerror: null,
    abort: vi.fn(() => queueMicrotask(() => tx.onabort?.({} as Event))),
    objectStore: vi.fn(),
  } as unknown as IDBTransaction;
  const store = { getAll: vi.fn(() => request), put: vi.fn(), delete: vi.fn() };
  vi.mocked(tx.objectStore).mockReturnValue(store as unknown as IDBObjectStore);
  const db = {
    transaction: vi.fn(() => tx), close: vi.fn(), createObjectStore: vi.fn(),
    objectStoreNames: { contains: vi.fn(() => false) }, onversionchange: null,
  };
  const opening = { result: db, onerror: null, onblocked: null, onupgradeneeded: null, onsuccess: null } as unknown as IDBOpenDBRequest;
  const open = vi.fn(() => {
    queueMicrotask(() => {
      opening.onupgradeneeded?.call(opening, {} as IDBVersionChangeEvent);
      opening.onsuccess?.call(opening, {} as Event);
    });
    return opening;
  });
  vi.stubGlobal('indexedDB', { open });
  return { request, tx, store, db, opening, open };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('browser local dataset storage', () => {
  it('does not report a save until the transaction commits', async () => {
    const h = databaseHarness();
    const saved = vi.fn();
    const data = dataset();
    const pending = saveLocalDataset(data).then(saved);
    await vi.waitFor(() => expect(h.store.put).toHaveBeenCalledWith(data));
    expect(saved).not.toHaveBeenCalled();
    expect(h.open).toHaveBeenCalledWith(LOCAL_DATASETS_DATABASE, LOCAL_DATASETS_SCHEMA_VERSION);
    expect(h.db.createObjectStore).toHaveBeenCalledWith(LOCAL_DATASETS_STORE, { keyPath: 'id' });
    h.tx.oncomplete?.call(h.tx, {} as Event);
    await pending;
    expect(saved).toHaveBeenCalledOnce();
    expect(h.db.close).toHaveBeenCalledOnce();
  });

  it('queues all imports in one transaction and rejects an aborted batch', async () => {
    const h = databaseHarness();
    const pending = saveLocalDatasets([dataset('one'), dataset('two')]);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'quota', message: expect.stringContaining('no space') });
    await vi.waitFor(() => expect(h.store.put).toHaveBeenCalledTimes(2));
    expect(h.db.transaction).toHaveBeenCalledTimes(1);
    expect(h.db.transaction).toHaveBeenCalledWith(LOCAL_DATASETS_STORE, 'readwrite');
    Object.defineProperty(h.tx, 'error', { value: new DOMException('Full', 'QuotaExceededError') });
    h.tx.onabort?.call(h.tx, {} as Event);
    await rejected;
    expect(h.db.close).toHaveBeenCalledOnce();
  });

  it('aborts earlier writes if a later put cannot be cloned', async () => {
    const h = databaseHarness();
    h.store.put.mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw new DOMException('Bad row', 'DataCloneError'); });
    await expect(saveLocalDatasets([dataset('one'), dataset('two')])).rejects.toMatchObject({ code: 'failed' });
    expect(h.tx.abort).toHaveBeenCalledOnce();
    expect(h.db.close).toHaveBeenCalledOnce();
  });

  it('returns complete saved rows after the read transaction completes', async () => {
    const h = databaseHarness();
    const first = dataset('older');
    const second = { ...dataset('newer'), updatedAt: '2026-09-06T00:00:00Z' };
    const pending = listLocalDatasets();
    await vi.waitFor(() => expect(h.store.getAll).toHaveBeenCalledOnce());
    Object.defineProperty(h.request, 'result', { value: [first, second] });
    h.request.onsuccess?.call(h.request, {} as Event);
    h.tx.oncomplete?.call(h.tx, {} as Event);
    expect(await pending).toEqual([second, first]);
    expect(h.db.transaction).toHaveBeenCalledWith(LOCAL_DATASETS_STORE, 'readonly');
  });

  it('reports corrupt stored records rather than silently dropping them', async () => {
    const h = databaseHarness();
    const pending = listLocalDatasets();
    const rejected = expect(pending).rejects.toMatchObject({ code: 'corrupt' });
    await vi.waitFor(() => expect(h.store.getAll).toHaveBeenCalledOnce());
    Object.defineProperty(h.request, 'result', { value: [dataset(), { id: 'broken' }] });
    h.request.onsuccess?.call(h.request, {} as Event);
    h.tx.oncomplete?.call(h.tx, {} as Event);
    await rejected;
  });

  it('deletes only the chosen key and waits for commit', async () => {
    const h = databaseHarness();
    const pending = deleteLocalDataset('local-selected');
    await vi.waitFor(() => expect(h.store.delete).toHaveBeenCalledWith('local-selected'));
    h.tx.oncomplete?.call(h.tx, {} as Event);
    await pending;
    expect(h.store.delete).toHaveBeenCalledOnce();
  });

  it('gives an actionable error when browser storage is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(listLocalDatasets()).rejects.toMatchObject({ code: 'unavailable', message: expect.stringContaining('another browser') });
  });

  it('gives an actionable blocked error and closes a late-opened connection', async () => {
    const h = databaseHarness();
    h.open.mockImplementation(() => h.opening);
    const pending = listLocalDatasets();
    h.opening.onblocked?.call(h.opening, {} as IDBVersionChangeEvent);
    await expect(pending).rejects.toMatchObject({ code: 'blocked', message: expect.stringContaining('Close the other tabs') });
    h.opening.onsuccess?.call(h.opening, {} as Event);
    expect(h.db.close).toHaveBeenCalledOnce();
    expect(h.db.transaction).not.toHaveBeenCalled();
  });

  it('never uses a network request or localStorage for a dataset payload', async () => {
    const h = databaseHarness();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const localStorageWrite = vi.spyOn(Storage.prototype, 'setItem');
    const pending = saveLocalDataset(dataset());
    await vi.waitFor(() => expect(h.store.put).toHaveBeenCalledOnce());
    h.tx.oncomplete?.call(h.tx, {} as Event);
    await pending;
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorageWrite).not.toHaveBeenCalled();
  });
});
