// Downloads for the Circadian tab, in the two shapes a reader actually needs:
//
//   results  one row per gene — the rhythm statistics, with the settings that
//            produced them recorded IN the file. A p-value is meaningless
//            without the method, period grid, arm and correction that made it,
//            and a downloaded table outlives the screen it came from.
//            The settings ride in the export-provenance module's shared schema
//            (utils/exportProvenance.ts): the workbook's Metadata sheet and
//            the CSVs' appended provenance columns carry the same dataset,
//            track, unit, release and evidence fields as every other export,
//            with the rhythm-test settings as this kind's own `settings`.
//   raw      one tidy row per (gene, library) — gene, sample, arm, time,
//            replicate, value. The numbers the tests were run on, so anyone can
//            re-run them in R and get the same answer. The tab passes the genes
//            of the results table as the user has filtered and sorted it (all
//            scored genes when no filter is set: about 550,000 rows on the
//            largest course); a list that would pass Excel's worksheet row
//            limit is cut at a whole gene, and the cut is recorded in the file.
//
// Three gene counts are recorded apart, because they answer different
// questions: the genes in the bundle, the genes the selected arm's scan scored
// (the family the gene-wise correction ran over), and the genes in the file
// (fewer when the table is filtered; their adjusted values are not recomputed).
//
// Both formats share the row builders, so the CSV and the workbook can never
// disagree about a column the way two hand-written exporters eventually would.
//
// Memory and latency: rows are built as cell arrays, never as row objects, and
// the raw values are never all held at once. A cheap counting pass first fixes
// which genes fit (so the provenance, which rides in the first data rows, is
// complete before any row is written); the rows are then generated a block at
// a time. The raw CSV spells each block into text and drops it, yielding to
// the event loop between blocks (utils/csv.ts `writeCsvBlocks`). The workbook
// posts each block to a module worker (circadianWorkbook.worker.ts), yielding
// between blocks, and the worker fills a SheetJS dense sheet.
//
// XLSX.write serialises the whole workbook in one synchronous pass (SheetJS has
// no incremental xlsx writer): about a second per 100,000 raw rows, holding the
// dense sheet plus the XML it spells. That pass runs in the worker, so the tab
// stays responsive; the bytes come back as a transferred ArrayBuffer. Where no
// Worker exists (tests, very old browsers) or the worker fails, the same
// builder (circadianWorkbook.ts) runs on the main thread instead. DEFLATE
// compression is on because, measured on 100,000 raw rows in Node, it made
// that pass faster (0.9 s against 1.2 s), its peak memory under half and the
// file a third the size.

import { type CsvCell, writeCsv, writeCsvBlocks } from '../utils/csv';
import { downloadFile } from '../utils/exportAction';
import { withXLSX } from '../utils/lazyExport';
import {
  exportName, exportProvenance, metadataSheet, timeSeriesSubject, type ExportKind,
} from '../utils/exportProvenance';
import { CPM_TMM_UNIT } from '../data/expressionUnits';
import type { Dataset, TimeSeriesBundle } from '../types';
import type { WorkbookRow } from '../utils/workbook';
import { ADJUSTMENT_LABELS, adjustedColumnLabel, type AdjustMethod } from './multipleTesting';
import { RHYTHM_METHOD_LABELS, type RhythmMethod } from './rhythmicity';
import type { RhythmRow } from './scan';
import {
  type WorkbookRequest, type WorkbookResponse, type WorkbookStart, startWorkbook,
} from './circadianWorkbook';

export interface ExportContext {
  bundle: TimeSeriesBundle;
  /** The registered dataset: its identity, accession and citation go in the provenance. */
  dataset: Dataset;
  method: RhythmMethod;
  adjust: AdjustMethod;
  armLabel: string;
  periods: number[];
  effectivePeriods?: number[];
  /**
   * Genes the selected arm's scan scored (a finite p-value): the size of the
   * family the gene-wise correction ran over. The exported rows are fewer when
   * the table is filtered. Recorded as unrecorded when absent.
   */
  genesScored?: number;
}

const count = (n: number) => n.toLocaleString('en-US');

/** The gene-wise family, in words: who was scored, and how many. */
function familyPhrase(ctx: ExportContext): string {
  const scored = ctx.genesScored;
  return scored == null
    ? `the genes scored in ${ctx.armLabel} (the count was not recorded)`
    : `the ${count(scored)} genes scored in ${ctx.armLabel}`;
}

/**
 * What the adjusted-value column was computed over, in words, for the files
 * that carry one: the results CSV and the workbook's Rhythmicity sheet.
 */
function resultsCorrectionFamily(kind: ExportKind, ctx: ExportContext, genesExported: number): string {
  const holder = kind === 'circadian' ? 'The Rhythmicity sheet' : 'The file';
  if (ctx.adjust === 'none') {
    const column = kind === 'circadian' ? 'the Rhythmicity sheet\'s PValueRaw column' : 'the PValueRaw column';
    return `No gene-wise correction: ${column} repeats each gene's raw p-value.`;
  }
  const scored = ctx.genesScored;
  const subset = scored != null && genesExported === scored
    ? ` ${holder} holds every gene in that family.`
    : scored != null
      ? ` ${holder} holds ${count(genesExported)} genes after the table filter; their adjusted values are those from the full family and are not recomputed for the subset.`
      : ` ${holder} holds ${count(genesExported)} genes, after any table filter; their adjusted values are those from the full family and are not recomputed for a subset.`;
  return `${ADJUSTMENT_LABELS[ctx.adjust]} was applied across ${familyPhrase(ctx)}, before any table filter.${subset}`;
}

/**
 * The same, for the raw-value CSV, which carries no p-values: which genes it
 * holds, keeping the table filter (a choice of genes) apart from the cut at
 * the worksheet row limit (a size cap applied after it).
 */
function rawCorrectionFamily(ctx: ExportContext, raw: RawCoverage): string {
  const correction = ctx.adjust === 'none'
    ? 'No gene-wise correction was applied. This file holds raw values only; the p-values are in the results export.'
    : `${ADJUSTMENT_LABELS[ctx.adjust]} was applied across ${familyPhrase(ctx)}, before any table filter. This file holds raw values only; the adjusted values are in the results export.`;
  const scored = ctx.genesScored;
  const requested = raw.genesRequested;
  const selection = scored != null && requested === scored
    ? `The ${count(requested)} genes requested are every gene scored in ${ctx.armLabel}`
    : scored != null
      ? `The table filter selected ${count(requested)} of the ${count(scored)} genes scored in ${ctx.armLabel}`
      : `${count(requested)} genes were requested, after any table filter`;
  const held = raw.truncated
    ? `; the file holds the first ${count(raw.genesWritten)} of them in the table's sort order, cut at a whole gene to fit Excel's ${count(raw.rowLimit)}-row worksheet limit (a size cap, not a filter).`
    : '; the file holds all of them.';
  return `${correction} ${selection}${held}`;
}

/**
 * What the effective candidate periods are. For JTK_CYCLE they are the family
 * the complete sampling schedule supports; a gene with missing observations is
 * tested on the family its own observed times support.
 */
function effectivePeriodScope(kind: ExportKind, ctx: ExportContext): string {
  const column = kind === 'circadian' ? 'the CandidatePeriodsHours column of the Rhythmicity sheet'
    : kind === 'rhythmicity' ? 'the CandidatePeriodsHours column'
    : 'the CandidatePeriodsHours column of the results export';
  if (ctx.method === 'jtk') {
    if (!ctx.effectivePeriods) {
      return 'JTK_CYCLE: the family the sampling schedule supports was not recorded; the periods listed are the requested ones. '
        + `Each gene's own tested family is in ${column}.`;
    }
    return 'JTK_CYCLE: the complete-schedule family, the periods the full sampling schedule (every library observed) supports. '
      + 'A gene with missing observations is tested on the family its own observed times support, which can differ; '
      + `each gene's own family is in ${column}.`;
  }
  if (ctx.method === 'cosinor') {
    return 'COSINOR: the requested candidate periods. Each gene is fitted, and its p-value Bonferroni-corrected, over the periods '
      + `estimable from its own observations, listed per gene in ${column}.`;
  }
  return `${RHYTHM_METHOD_LABELS[ctx.method]}: the requested candidate periods.`;
}

/**
 * The rhythm-test settings that ride along with every export, as this kind's
 * `settings` in the shared provenance. Dataset name, track label and expression
 * unit, which the old Settings sheet listed beside them, are now the shared
 * `dataset.name`, `track.label` and `expression.unit` fields.
 */
function circadianProvenance(kind: ExportKind, ctx: ExportContext, genesExported: number, raw?: RawCoverage) {
  const { bundle } = ctx;
  const periods = ctx.periods.length === 1
    ? `${ctx.periods[0]} h (pinned)`
    : `${Math.min(...ctx.periods)}–${Math.max(...ctx.periods)} h scan, ${ctx.periods.length} candidates`;
  return exportProvenance(kind, timeSeriesSubject(ctx.dataset, bundle), {
    rhythmTest: RHYTHM_METHOD_LABELS[ctx.method],
    period: periods,
    effectiveCandidatePeriodsHours: (ctx.effectivePeriods ?? ctx.periods).join(', '),
    effectiveCandidatePeriodsScope: effectivePeriodScope(kind, ctx),
    withinGeneSearchCorrection: ctx.method === 'jtk' ? 'Bonferroni across canonical period × phase templates'
      : ctx.method === 'cosinor' ? 'Bonferroni across unique estimable candidate periods'
      : 'Approximate Lomb–Scargle false-alarm probability',
    armTested: ctx.armLabel,
    multipleTestingCorrection: ADJUSTMENT_LABELS[ctx.adjust],
    samplingTimes: bundle.meta.timepoints.map((t) => `${bundle.meta.timeUnit}${t}`).join(', '),
    libraries: bundle.meta.samples.length,
    genesInBundle: bundle.meta.nGenes,
    genesScoredInArm: ctx.genesScored ?? null,
    genesExported,
    correctionFamily: kind === 'timecourse_values' && raw
      ? rawCorrectionFamily(ctx, raw)
      : resultsCorrectionFamily(kind, ctx, genesExported),
    note: "Acrophase is peak time in hours on the dataset's own time axis. "
      + 'For JTK_CYCLE, amplitude is the canonical Hodges–Lehmann estimator and mesor is the Hodges–Lehmann location of the observations. A zero period denotes zero estimable amplitude.',
    ...(raw ? { rawValues: rawValueSummary(raw) } : {}),
  });
}

/** What the raw-value rows cover, for the provenance: counts, and any cut. */
function rawValueSummary(raw: RawCoverage) {
  return {
    scope: 'One row per gene × library with a non-missing value, for each exported gene in the results table\'s sort order. Missing values are omitted, not zero-filled.',
    genesRequested: raw.genesRequested,
    genesWritten: raw.genesWritten,
    rowsAvailable: raw.rowsAvailable,
    rowsWritten: raw.rowsWritten,
    truncated: raw.truncated
      ? `Yes: cut after ${count(raw.genesWritten)} whole genes so the table fits Excel's ${count(raw.rowLimit)}-row worksheet limit (one header row). The cut is a size cap, not a filter.`
      : 'No',
  };
}

/** A table as a header and cell rows in column order. */
interface CellTable {
  columns: string[];
  cells: CsvCell[][];
}

/** One row per gene, in the table's current order. */
function resultTable(rows: readonly RhythmRow[], ctx: ExportContext): CellTable {
  const qLabel = adjustedColumnLabel(ctx.adjust);
  const statLabel = ctx.method === 'cosinor' ? 'F' : ctx.method === 'jtk' ? 'tau' : 'LSpower';
  const fallback = (ctx.effectivePeriods ?? ctx.periods).join(';');
  return {
    columns: [
      'Gene', 'Method', 'PValue', qLabel === 'q' ? 'qValue' : 'PValueRaw', 'PeriodHours',
      'CandidatePeriodsHours', 'AcrophaseHours', 'Amplitude', 'Mesor', statLabel, 'NObservations', 'NTimepoints',
    ],
    cells: rows.map((r) => [
      r.gene, RHYTHM_METHOD_LABELS[r.method], r.p, r.q, r.period,
      r.periodsTested ? r.periodsTested.join(';') : fallback,
      +r.acrophase.toFixed(3), +r.amplitude.toFixed(4), +r.mesor.toFixed(4), +r.stat.toFixed(5),
      r.n, r.nTimepoints,
    ]),
  };
}

/** Rows in one Excel worksheet, the header included. */
export const EXCEL_MAX_ROWS = 1_048_576;

/** Raw-value rows handed on per block: both writers yield between blocks. */
const RAW_BLOCK_ROWS = 20_000;

/** What a raw-value table covers. */
interface RawCoverage {
  /** Genes passed in that the bundle carries. */
  genesRequested: number;
  genesWritten: number;
  /** Non-missing (gene, library) values across every requested gene. */
  rowsAvailable: number;
  rowsWritten: number;
  truncated: boolean;
  /** The worksheet row limit the table is cut to fit, the header row included. */
  rowLimit: number;
}

/** The raw-value table as cells, with what it covers. */
export interface RawValueTable extends CellTable, RawCoverage {}

function rawColumns(bundle: TimeSeriesBundle): string[] {
  const unit = bundle.meta.expressionUnit === CPM_TMM_UNIT ? CPM_TMM_UNIT
    : bundle.meta.expressionUnit === 'CPM' ? 'NormCPM' : 'NormValue';
  return ['Gene', 'Sample', 'Arm', 'TimeHours', 'TimeLabel', 'Replicate', unit];
}

/**
 * What the raw-value rows for `genes` will cover, counted without building a
 * row: at most `rowLimit - 1` data rows, and only whole genes, so a gene in
 * the file always carries all of its libraries. Once one gene does not fit,
 * no later gene is written, so the file is a prefix of the table's order.
 */
function rawCoverage(bundle: TimeSeriesBundle, genes: readonly string[], rowLimit: number): RawCoverage {
  const coverage: RawCoverage = {
    genesRequested: 0, genesWritten: 0, rowsAvailable: 0, rowsWritten: 0, truncated: false, rowLimit,
  };
  const nSamples = bundle.meta.samples.length;
  for (const gene of genes) {
    const values = bundle.values[gene];
    if (!values) continue;
    coverage.genesRequested++;
    let present = 0;
    for (let i = 0; i < nSamples; i++) if (values[i] != null) present++;
    coverage.rowsAvailable += present;
    if (coverage.truncated || coverage.rowsWritten + present > rowLimit - 1) { coverage.truncated = true; continue; }
    coverage.rowsWritten += present;
    coverage.genesWritten++;
  }
  return coverage;
}

/**
 * The raw-value rows of the first `genesToWrite` requested genes the bundle
 * carries, in blocks of about `RAW_BLOCK_ROWS`, generated lazily so a caller
 * that drops each block never holds them all. Each library's identity is
 * spelled once rather than once per gene.
 */
function* rawValueBlocks(
  bundle: TimeSeriesBundle,
  genes: readonly string[],
  genesToWrite: number,
): Generator<CsvCell[][], void> {
  const armLabel = new Map(bundle.meta.arms.map((a) => [a.key, a.label]));
  const samples = bundle.meta.samples.map((s) => ({
    id: s.id, arm: armLabel.get(s.arm) ?? s.arm, time: s.time,
    label: `${bundle.meta.timeUnit}${s.time}`, replicate: s.replicate,
  }));
  let written = 0;
  let block: CsvCell[][] = [];
  for (const gene of genes) {
    if (written >= genesToWrite) break;
    const values = bundle.values[gene];
    if (!values) continue;
    for (let i = 0; i < samples.length; i++) {
      const v = values[i];
      if (v == null) continue;
      const s = samples[i];
      block.push([gene, s.id, s.arm, s.time, s.label, s.replicate, v]);
    }
    written++;
    if (block.length >= RAW_BLOCK_ROWS) { yield block; block = []; }
  }
  if (block.length) yield block;
}

/**
 * One tidy row per (gene, library), as cells in column order — the values every
 * test above ran on. Built as arrays, not row objects: the whole SCN course is
 * about 550,000 rows. At most `rowLimit - 1` data rows, whole genes only.
 */
export function rawValueTable(
  bundle: TimeSeriesBundle,
  genes: readonly string[],
  rowLimit = EXCEL_MAX_ROWS,
): RawValueTable {
  const coverage = rawCoverage(bundle, genes, rowLimit);
  const cells: CsvCell[][] = [];
  for (const block of rawValueBlocks(bundle, genes, coverage.genesWritten)) {
    for (const row of block) cells.push(row);
  }
  return { columns: rawColumns(bundle), cells, ...coverage };
}

/** One tidy row per (gene, library) as objects, uncapped (for callers that want keyed rows). */
export function rawValueRows(bundle: TimeSeriesBundle, genes: string[]): WorkbookRow[] {
  const { columns, cells } = rawValueTable(bundle, genes, Number.POSITIVE_INFINITY);
  return cells.map((row) => {
    const out: WorkbookRow = {};
    for (let c = 0; c < columns.length; c++) out[columns[c]] = row[c];
    return out;
  });
}

// The scientific columns first, in their row-builder order; the CSV seam then
// appends the shared provenance columns, the same layout as the gene CSVs.
export function exportResultsCSV(rows: RhythmRow[], ctx: ExportContext): void {
  const table = resultTable(rows, ctx);
  writeCsv(exportName(timeSeriesSubject(ctx.dataset, ctx.bundle), ['rhythmicity', ctx.method], 'csv'),
    table.columns, table.cells, { provenance: circadianProvenance('rhythmicity', ctx, rows.length) });
}

/**
 * The raw values behind `genes`, one row per (gene, library). The tab passes
 * the results table's genes, filtered and sorted as shown. The file is cut at a
 * whole gene if it would pass Excel's worksheet row limit, and the provenance
 * records it: `genesExported` counts the genes written, and `correctionFamily`
 * and `rawValues` keep the table filter apart from the cut.
 *
 * The rows are generated and spelled a block at a time, with a yield to the
 * event loop between blocks; the returned promise settles once the file has
 * been handed to the browser. `rowLimit` (the worksheet limit, header row
 * included) is Excel's; it is a parameter only so tests can reach the cut
 * without writing a million rows.
 */
export function exportRawCSV(
  bundle: TimeSeriesBundle,
  genes: string[],
  ctx: ExportContext,
  rowLimit = EXCEL_MAX_ROWS,
): Promise<void> {
  const coverage = rawCoverage(bundle, genes, rowLimit);
  return writeCsvBlocks(
    exportName(timeSeriesSubject(ctx.dataset, ctx.bundle), ['timecourse_values'], 'csv'),
    rawColumns(bundle),
    rawValueBlocks(bundle, genes, coverage.genesWritten),
    { provenance: circadianProvenance('timecourse_values', ctx, coverage.genesWritten, coverage) },
  );
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const nextTask = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

/**
 * The full workbook: results, the raw values behind `rawGenes`, and Metadata.
 *
 * The tab passes the results table's genes, filtered and sorted as shown: about
 * 550,000 raw-value rows on the largest course with no filter, inside Excel's
 * 1,048,576-row sheet. A longer list is cut at a whole gene, and the Metadata
 * sheet records the cut. The rows are generated here a block at a time and
 * posted to the workbook worker, which builds dense sheets and runs the one
 * synchronous XLSX.write pass off the main thread (see the note at the top of
 * this file). Without a usable worker the same builder runs here, yielding
 * between blocks.
 *
 * Like every workbook export, the returned promise never rejects: a failure is
 * reported to the user by `withXLSX`.
 */
export async function exportWorkbook(
  rows: RhythmRow[],
  rawGenes: string[],
  ctx: ExportContext,
): Promise<void> {
  let parts: WorkbookParts;
  try {
    parts = workbookParts(rows, rawGenes, ctx);
  } catch (err) {
    return withXLSX(() => { throw err; });
  }
  const filename = exportName(timeSeriesSubject(ctx.dataset, ctx.bundle), ['circadian'], 'xlsx');
  if (typeof Worker !== 'undefined') {
    try {
      deliverWorkbook(await buildInWorker(parts), filename);
      return;
    } catch (err) {
      // A worker that cannot load or that fails mid-build is not the user's
      // problem yet: build the same workbook here instead.
      console.warn('[export] workbook worker failed; building on the main thread', err);
    }
  }
  return withXLSX(async (XLSX) => {
    const session = startWorkbook(XLSX, parts.start);
    for (const block of parts.blocks()) {
      session.append(block);
      await nextTask();
    }
    deliverWorkbook(session.finish(), filename);
  });
}

/** The workbook's fixed sheets, and a fresh generator of its raw-value blocks. */
interface WorkbookParts {
  start: WorkbookStart;
  blocks: () => Generator<CsvCell[][], void>;
}

function workbookParts(rows: RhythmRow[], rawGenes: string[], ctx: ExportContext): WorkbookParts {
  const results = resultTable(rows, ctx);
  const coverage = rawCoverage(ctx.bundle, rawGenes, EXCEL_MAX_ROWS);
  const meta = metadataSheet(circadianProvenance('circadian', ctx, rows.length, coverage));
  return {
    start: {
      results: [results.columns, ...results.cells],
      rawHeader: rawColumns(ctx.bundle),
      meta: [['Field', 'Value'], ...meta.rows.map((r): CsvCell[] => [r.Field, r.Value as CsvCell])],
      metaName: meta.name,
    },
    blocks: () => rawValueBlocks(ctx.bundle, rawGenes, coverage.genesWritten),
  };
}

function deliverWorkbook(bytes: ArrayBuffer, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_MIME }));
  downloadFile(filename, url);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Build the workbook in a module worker. Rejects if the worker cannot start,
 * reports an error, or dies; the caller then builds it on the main thread.
 */
function buildInWorker(parts: WorkbookParts): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./circadianWorkbook.worker.ts', import.meta.url), { type: 'module' });
    } catch (err) {
      reject(err);
      return;
    }
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      finish();
    };
    worker.onmessage = (event: MessageEvent<WorkbookResponse>) => {
      const response = event.data;
      if (response.type === 'done') settle(() => resolve(response.bytes));
      else settle(() => reject(new Error(response.message)));
    };
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      settle(() => reject(new Error(event.message || 'The workbook worker failed to start.')));
    };
    const post = (request: WorkbookRequest) => worker.postMessage(request);
    (async () => {
      post({ type: 'start', start: parts.start });
      for (const block of parts.blocks()) {
        if (settled) return;
        post({ type: 'append', rows: block });
        await nextTask();
      }
      if (!settled) post({ type: 'finish' });
    })().catch((err: unknown) => settle(() => reject(err)));
  });
}
