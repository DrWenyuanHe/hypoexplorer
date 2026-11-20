import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { type ExportContext, exportWorkbook } from '../circadian/circadianExport';
import {
  type WorkbookRequest, type WorkbookResponse, startWorkbook, workbookMessageHandler,
} from '../circadian/circadianWorkbook';
import { DATASETS } from '../data/datasets';
import type { RhythmRow } from '../circadian/scan';
import type { TimeSeriesBundle } from '../types';

// The circadian workbook is assembled and serialised in a module worker so a
// whole-transcriptome export never freezes the tab. These tests drive the
// worker's real message handler (the one circadianWorkbook.worker.ts wires to
// `onmessage`) through a stand-in Worker, and check the in-thread fallback the
// page uses when no worker is available or the worker fails.

const downloadFile = vi.hoisted(() => vi.fn());
vi.mock('../utils/exportAction', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  downloadFile,
}));

const SCN = DATASETS.find((d) => d.id === 'mouse_scn_hfd_gse157077');
if (!SCN) throw new Error('fixture dataset is not registered');

function bundleOf(nGenes: number): TimeSeriesBundle {
  const times = [0, 6, 12, 18];
  const samples = times.flatMap((time) => [1, 2].map((replicate) => ({
    id: `chow_ZT${time}_${replicate}`, arm: 'chow', time, replicate,
  })));
  const values: Record<string, Array<number | null>> = {};
  for (let g = 0; g < nGenes; g++) values[`G${g}`] = samples.map((_, i) => g + i / 10);
  return {
    meta: {
      trackId: 'scn', label: 'SCN', cycleHours: 24, timeUnit: 'ZT', expressionUnit: 'CPM',
      arms: [{ key: 'chow', label: 'Chow', color: '#4C78A8' }], samples, timepoints: times, nGenes,
    },
    values,
  };
}

const ctx = (bundle: TimeSeriesBundle): ExportContext => ({
  bundle, dataset: SCN, method: 'cosinor', adjust: 'bh', armLabel: 'Chow', periods: [24],
  genesScored: bundle.meta.nGenes,
});

const row = (gene: string): RhythmRow => ({
  gene, method: 'cosinor', p: 0.01, q: 0.02, period: 24, acrophase: 6, amplitude: 2, mesor: 3, stat: 9, n: 8, nTimepoints: 4,
} as RhythmRow);

/** A Worker stand-in that runs the real worker handler, asynchronously, like a thread would. */
class HandlerWorker {
  static created = 0;
  static requests: WorkbookRequest['type'][] = [];
  onmessage: ((event: MessageEvent<WorkbookResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  private handle = workbookMessageHandler(
    async () => XLSX,
    (response) => { queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<WorkbookResponse>)); },
  );
  constructor(public url: URL, public options: WorkerOptions) { HandlerWorker.created++; }
  postMessage(request: WorkbookRequest) {
    HandlerWorker.requests.push(request.type);
    // structuredClone, as a real postMessage would: the page must not rely on sharing objects.
    void this.handle(structuredClone(request));
  }
  terminate() { this.terminated = true; }
}

/** A Worker stand-in whose script fails to load. */
class BrokenWorker {
  onmessage: unknown = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  constructor() {
    setTimeout(() => this.onerror?.({ message: 'failed to fetch worker script', preventDefault() {} } as ErrorEvent), 0);
  }
  postMessage() {}
  terminate() {}
}

let blobs: Blob[] = [];
beforeEach(() => {
  downloadFile.mockClear();
  blobs = [];
  HandlerWorker.created = 0;
  HandlerWorker.requests = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { blobs.push(blob as Blob); return `blob:test/${blobs.length}`; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function readDownloaded() {
  expect(downloadFile).toHaveBeenCalledTimes(1);
  const [name] = downloadFile.mock.calls[0] as [string, string];
  const wb = XLSX.read(new Uint8Array(await blobs[blobs.length - 1].arrayBuffer()), { dense: true });
  const sheet = (n: string) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1 });
  return { name, wb, sheet };
}

describe('workbook worker protocol', () => {
  it('builds the same three sheets from start, appended blocks and finish', async () => {
    const posted: WorkbookResponse[] = [];
    const handle = workbookMessageHandler(async () => XLSX, (r) => { posted.push(r); });
    const start = {
      results: [['Gene', 'PValue'], ['A', 0.01]],
      rawHeader: ['Gene', 'Sample', 'Value'],
      meta: [['Field', 'Value'], ['exportKind', 'circadian']],
      metaName: 'Metadata',
    };
    // Sent back to back, as the page does: blocks may arrive while xlsx is still loading.
    void handle({ type: 'start', start });
    void handle({ type: 'append', rows: [['A', 's1', 1], ['A', 's2', 2]] });
    void handle({ type: 'append', rows: [['B', 's1', 3]] });
    await handle({ type: 'finish' });
    expect(posted).toHaveLength(1);
    const done = posted[0];
    if (done.type !== 'done') throw new Error(done.message);
    const wb = XLSX.read(new Uint8Array(done.bytes));
    expect(wb.SheetNames).toEqual(['Rhythmicity', 'RawValues', 'Metadata']);
    expect(XLSX.utils.sheet_to_json(wb.Sheets.RawValues, { header: 1 })).toEqual([
      ['Gene', 'Sample', 'Value'], ['A', 's1', 1], ['A', 's2', 2], ['B', 's1', 3],
    ]);
  });

  it('reports one error, not a crash, when xlsx cannot load or a block comes first', async () => {
    const posted: WorkbookResponse[] = [];
    const failing = workbookMessageHandler(async () => { throw new Error('chunk gone'); }, (r) => { posted.push(r); });
    void failing({ type: 'start', start: { results: [], rawHeader: [], meta: [], metaName: 'Metadata' } });
    void failing({ type: 'append', rows: [['x']] });
    await failing({ type: 'finish' });
    expect(posted).toEqual([{ type: 'error', message: 'chunk gone' }]);

    const early: WorkbookResponse[] = [];
    const outOfOrder = workbookMessageHandler(async () => XLSX, (r) => { early.push(r); });
    await outOfOrder({ type: 'append', rows: [['x']] });
    expect(early).toEqual([{ type: 'error', message: 'workbook append before start' }]);
  });

  it('the in-thread session writes the same file', () => {
    const session = startWorkbook(XLSX, {
      results: [['Gene'], ['A']], rawHeader: ['Gene', 'Value'], meta: [['Field', 'Value']], metaName: 'Metadata',
    });
    session.append([['A', 1]]);
    const wb = XLSX.read(new Uint8Array(session.finish()));
    expect(XLSX.utils.sheet_to_json(wb.Sheets.RawValues, { header: 1 })).toEqual([['Gene', 'Value'], ['A', 1]]);
  });
});

describe('exportWorkbook', () => {
  it('builds the workbook in a module worker and downloads the bytes it returns', async () => {
    vi.stubGlobal('Worker', HandlerWorker);
    const bundle = bundleOf(3000); // 24,000 raw rows: more than one 20,000-row block
    await exportWorkbook([row('G0'), row('G1')], Object.keys(bundle.values), ctx(bundle));
    expect(HandlerWorker.created).toBe(1);
    expect(HandlerWorker.requests[0]).toBe('start');
    expect(HandlerWorker.requests.at(-1)).toBe('finish');
    expect(HandlerWorker.requests.filter((t) => t === 'append').length).toBeGreaterThan(1);
    const { name, wb, sheet } = await readDownloaded();
    expect(name).toBe(`${SCN.id}_scn_circadian.xlsx`);
    expect(wb.SheetNames).toEqual(['Rhythmicity', 'RawValues', 'Metadata']);
    const raw = sheet('RawValues');
    expect(raw).toHaveLength(1 + 3000 * 8);
    expect(raw[1][0]).toBe('G0');
    expect(raw.at(-1)?.[0]).toBe('G2999');
    const meta = Object.fromEntries(sheet('Metadata').slice(1).map((r) => [r[0], r[1]]));
    expect(meta.exportKind).toBe('circadian');
  });

  it('falls back to building on the main thread when the worker fails to start', async () => {
    vi.stubGlobal('Worker', BrokenWorker);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bundle = bundleOf(5);
    await exportWorkbook([row('G0')], Object.keys(bundle.values), ctx(bundle));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('workbook worker failed'), expect.any(Error));
    const { sheet } = await readDownloaded();
    expect(sheet('RawValues')).toHaveLength(1 + 5 * 8);
  });

  it('builds on the main thread where no Worker exists', async () => {
    vi.stubGlobal('Worker', undefined);
    const bundle = bundleOf(5);
    await exportWorkbook([row('G0')], Object.keys(bundle.values), ctx(bundle));
    const { sheet } = await readDownloaded();
    expect(sheet('Rhythmicity')[1][0]).toBe('G0');
    expect(sheet('RawValues')).toHaveLength(1 + 5 * 8);
  });
});
