import type { LocalDataset } from './types';

export const LOCAL_DATASETS_DATABASE = 'hypoexplorer-local-datasets';
export const LOCAL_DATASETS_STORE = 'datasets';
export const LOCAL_DATASETS_SCHEMA_VERSION = 1;

export type LocalStorageErrorCode = 'unavailable' | 'blocked' | 'quota' | 'corrupt' | 'failed';

export class LocalDatasetStorageError extends Error {
  constructor(public readonly code: LocalStorageErrorCode, message: string) {
    super(message);
    this.name = 'LocalDatasetStorageError';
  }
}

function storageError(error: unknown): LocalDatasetStorageError {
  if (error instanceof LocalDatasetStorageError) return error;
  const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
  if (name === 'QuotaExceededError') {
    return new LocalDatasetStorageError('quota', 'This browser has no space left for this dataset. Export a backup, then remove an unused local dataset or free browser storage and try again.');
  }
  if (name === 'SecurityError' || name === 'NotSupportedError' || name === 'InvalidStateError') {
    return new LocalDatasetStorageError('unavailable', 'Local browser storage is unavailable. Allow site storage or try a regular browser window, then import the files again.');
  }
  if (name === 'VersionError') {
    return new LocalDatasetStorageError('blocked', 'These local datasets were saved by a newer version of HypoExplorer. Reload the app to use them.');
  }
  return new LocalDatasetStorageError('failed', 'The browser could not finish saving or loading local datasets. Your previous saved datasets have not been replaced. Try again.');
}

export function localStorageError(error: unknown): string {
  return storageError(error).message;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    try {
      if (!globalThis.indexedDB) {
        throw new LocalDatasetStorageError('unavailable', 'This browser does not provide local dataset storage. Enable site storage or use another browser.');
      }
      const request = globalThis.indexedDB.open(LOCAL_DATASETS_DATABASE, LOCAL_DATASETS_SCHEMA_VERSION);
      const fail = (error: unknown) => {
        settled = true;
        reject(storageError(error));
      };
      request.onblocked = () => fail(new LocalDatasetStorageError('blocked', 'Another HypoExplorer tab is blocking local storage. Close the other tabs and try again.'));
      request.onerror = () => fail(request.error);
      request.onupgradeneeded = () => {
        // A blocked open may continue after its caller has already received an
        // error. Do not keep an unowned upgrade or connection alive in that case.
        if (settled) { request.transaction?.abort(); return; }
        if (!request.result.objectStoreNames.contains(LOCAL_DATASETS_STORE)) {
          request.result.createObjectStore(LOCAL_DATASETS_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        settled = true;
        db.onversionchange = () => db.close();
        resolve(db);
      };
    } catch (error) {
      settled = true;
      reject(storageError(error));
    }
  });
}

async function transaction<T>(mode: IDBTransactionMode, queue: (store: IDBObjectStore, setResult: (value: T) => void) => void): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    let result: T;
    let failure: unknown;
    try {
      tx = db.transaction(LOCAL_DATASETS_STORE, mode);
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = (event) => {
        failure = (event.target as IDBRequest | null)?.error ?? tx.error;
      };
      tx.onabort = () => { db.close(); reject(storageError(failure ?? tx.error)); };
      try {
        queue(tx.objectStore(LOCAL_DATASETS_STORE), (value) => { result = value; });
      } catch (error) {
        failure = error;
        tx.abort();
      }
    } catch (error) {
      db.close();
      reject(storageError(error));
    }
  });
}

function isStoredDataset(value: unknown): value is LocalDataset {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<LocalDataset>;
  return typeof data.id === 'string' && data.id.length > 0
    && typeof data.name === 'string' && typeof data.organism === 'string'
    && typeof data.createdAt === 'string' && typeof data.updatedAt === 'string'
    && Array.isArray(data.genes) && Array.isArray(data.pathways) && Array.isArray(data.sources);
}

/** Data stays in this origin's IndexedDB. There is no transport or server API. */
export async function listLocalDatasets(): Promise<LocalDataset[]> {
  const rows = await transaction<unknown[]>('readonly', (store, setResult) => {
    const request = store.getAll();
    request.onsuccess = () => setResult(request.result);
  });
  if (!rows.every(isStoredDataset)) {
    throw new LocalDatasetStorageError('corrupt', 'A saved local dataset could not be read. Its browser copy has been kept; restore your exported backup in another browser or browser profile.');
  }
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name));
}

/** One transaction: a failed file in a batch never leaves a partial import. */
export async function saveLocalDatasets(datasets: LocalDataset[]): Promise<void> {
  if (datasets.length === 0) return;
  if (!datasets.every(isStoredDataset)) {
    throw new LocalDatasetStorageError('corrupt', 'This dataset is incomplete and cannot be saved. Review the column mapping and import the files again.');
  }
  await transaction<void>('readwrite', (store) => {
    for (const dataset of datasets) store.put(dataset);
  });
}

export function saveLocalDataset(dataset: LocalDataset): Promise<void> {
  return saveLocalDatasets([dataset]);
}

export function deleteLocalDataset(id: string): Promise<void> {
  return transaction<void>('readwrite', (store) => { store.delete(id); });
}
