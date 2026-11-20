// The circadian workbook's assembly, shared by the Web Worker that normally
// builds it and the in-thread fallback that builds it where no Worker exists
// (tests, and the rare browser without module workers).
//
// Why a worker: SheetJS has no incremental xlsx writer. XLSX.write spells the
// whole workbook in one synchronous pass: about a second and several hundred
// MiB per 100,000 raw-value rows, measured in Node. On the main thread that is
// a frozen tab during a whole-transcriptome export. In a worker it is a
// background task: the main thread only generates the raw rows a block at a
// time, posts each block, and receives the finished bytes as a transferred
// ArrayBuffer (no copy).
//
// The session below is the whole protocol: `start` with the results, raw
// header and metadata tables; `append` raw-value blocks in order; `finish` for
// the bytes. The worker file only wires it to messages, so the code path the
// tests exercise is the one the worker runs.

import type { CsvCell } from '../utils/csv';

type XLSXModule = typeof import('xlsx');

/** Everything but the raw-value rows, sent once before the first block. */
export interface WorkbookStart {
  /** The results sheet, header row first. */
  results: CsvCell[][];
  /** The raw-value sheet's header row; its data rows arrive as blocks. */
  rawHeader: string[];
  /** The Metadata sheet (Field, Value), header row first. */
  meta: CsvCell[][];
  metaName: string;
}

/** Messages from the page to the workbook worker. */
export type WorkbookRequest =
  | { type: 'start'; start: WorkbookStart }
  | { type: 'append'; rows: CsvCell[][] }
  | { type: 'finish' };

/** Messages from the workbook worker to the page. */
export type WorkbookResponse =
  | { type: 'done'; bytes: ArrayBuffer }
  | { type: 'error'; message: string };

export interface WorkbookSession {
  append(rows: CsvCell[][]): void;
  /** The finished .xlsx file. The session is spent afterwards. */
  finish(): ArrayBuffer;
}

/** Begin a workbook: results and metadata now, raw-value rows as they arrive. */
export function startWorkbook(XLSX: XLSXModule, start: WorkbookStart): WorkbookSession {
  const dense = { dense: true } as const;
  const resultSheet = XLSX.utils.aoa_to_sheet(start.results, dense);
  const rawSheet = XLSX.utils.aoa_to_sheet([start.rawHeader], dense);
  const metaSheet = XLSX.utils.aoa_to_sheet(start.meta, dense);
  return {
    append(rows) {
      if (rows.length) XLSX.utils.sheet_add_aoa(rawSheet, rows, { origin: -1 });
    },
    finish() {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, resultSheet, 'Rhythmicity');
      XLSX.utils.book_append_sheet(wb, rawSheet, 'RawValues');
      XLSX.utils.book_append_sheet(wb, metaSheet, start.metaName);
      // DEFLATE on: measured on 100,000 raw rows it made this pass faster, its
      // peak memory under half and the file a third the size.
      //
      // type 'buffer', not 'array': outside Node, SheetJS turns 'array' into a
      // binary STRING (one JS string per byte via a2s) and back (s2ab), two
      // extra whole-file copies. On a whole-transcriptome workbook that path
      // has thrown "RangeError: Invalid array length" in the browser. 'buffer'
      // hands back the zip bytes as they are: a Uint8Array in a browser or
      // worker, a Buffer in Node (measured in Chromium on 527,184 raw rows:
      // 5.5 s against 7.2 s).
      const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer', compression: true }) as Uint8Array;
      // A view onto part of a larger (pooled) buffer must be copied out so the
      // returned ArrayBuffer holds exactly the file and can be transferred.
      return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer as ArrayBuffer
        : bytes.slice().buffer as ArrayBuffer;
    },
  };
}

/**
 * The worker's message handler, factored out so tests can drive it without a
 * real Worker. Requests must arrive in order: start, append…, finish.
 */
export function workbookMessageHandler(
  loadXLSX: () => Promise<XLSXModule>,
  post: (response: WorkbookResponse, transfer?: Transferable[]) => void,
): (request: WorkbookRequest) => Promise<void> {
  let session: Promise<WorkbookSession> | null = null;
  let failed = false;
  // Messages are handled strictly in arrival order: each waits for the one
  // before it, so blocks queued while xlsx is still loading land in order.
  let queue: Promise<void> = Promise.resolve();
  const fail = (err: unknown) => {
    if (failed) return;
    failed = true;
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  };
  return (request) => {
    queue = queue.then(async () => {
      if (failed) return;
      try {
        if (request.type === 'start') {
          session = loadXLSX().then((XLSX) => startWorkbook(XLSX, request.start));
          await session;
        } else if (!session) {
          throw new Error(`workbook ${request.type} before start`);
        } else if (request.type === 'append') {
          (await session).append(request.rows);
        } else {
          const bytes = (await session).finish();
          session = null;
          post({ type: 'done', bytes }, [bytes]);
        }
      } catch (err) {
        fail(err);
      }
    });
    return queue;
  };
}
