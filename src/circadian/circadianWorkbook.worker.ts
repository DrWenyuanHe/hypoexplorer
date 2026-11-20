// Module worker that assembles and serialises the circadian workbook off the
// main thread. All logic lives in circadianWorkbook.ts; this file only wires
// it to messages. xlsx is reached through utils/lazyExport.ts's dynamic import,
// the one import specifier the chunk-splitting contract allows (see
// src/__tests__/lazyChunkBoundaries.test.ts); that dynamic import inside a
// worker is why vite.config.ts builds workers as ES modules.

/// <reference lib="webworker" />

import { loadXLSX } from '../utils/lazyExport';
import { type WorkbookRequest, type WorkbookResponse, workbookMessageHandler } from './circadianWorkbook';

const scope = self as unknown as DedicatedWorkerGlobalScope;

const handle = workbookMessageHandler(
  loadXLSX,
  (response: WorkbookResponse, transfer?: Transferable[]) => scope.postMessage(response, transfer ?? []),
);

scope.onmessage = (event: MessageEvent<WorkbookRequest>) => {
  void handle(event.data);
};
