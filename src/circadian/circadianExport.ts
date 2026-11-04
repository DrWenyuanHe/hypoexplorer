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
//            re-run them in R and get the same answer.
//
// Both formats share the row builders, so the CSV and the workbook can never
// disagree about a column the way two hand-written exporters eventually would.

import { downloadFile } from '../utils/exportAction';
import { writeWorkbook, type WorkbookRow } from '../utils/workbook';
import {
  exportCsvCell, exportName, exportProvenance, metadataSheet, provenanceColumns, provenanceColumnValues,
  timeSeriesSubject, type ExportKind,
} from '../utils/exportProvenance';
import { CPM_TMM_UNIT } from '../data/expressionUnits';
import type { Dataset, TimeSeriesBundle } from '../types';
import { ADJUSTMENT_LABELS, adjustedColumnLabel, type AdjustMethod } from './multipleTesting';
import { RHYTHM_METHOD_LABELS, type RhythmMethod } from './rhythmicity';
import type { RhythmRow } from './scan';

export interface ExportContext {
  bundle: TimeSeriesBundle;
  /** The registered dataset: its identity, accession and citation go in the provenance. */
  dataset: Dataset;
  method: RhythmMethod;
  adjust: AdjustMethod;
  armLabel: string;
  periods: number[];
  effectivePeriods?: number[];
}

/**
 * The rhythm-test settings that ride along with every export, as this kind's
 * `settings` in the shared provenance. Dataset name, track label and expression
 * unit, which the old Settings sheet listed beside them, are now the shared
 * `dataset.name`, `track.label` and `expression.unit` fields.
 */
function circadianProvenance(kind: ExportKind, ctx: ExportContext) {
  const { bundle } = ctx;
  const periods = ctx.periods.length === 1
    ? `${ctx.periods[0]} h (pinned)`
    : `${Math.min(...ctx.periods)}–${Math.max(...ctx.periods)} h scan, ${ctx.periods.length} candidates`;
  return exportProvenance(kind, timeSeriesSubject(ctx.dataset, bundle), {
    rhythmTest: RHYTHM_METHOD_LABELS[ctx.method],
    period: periods,
    effectiveCandidatePeriodsHours: (ctx.effectivePeriods ?? ctx.periods).join(', '),
    withinGeneSearchCorrection: ctx.method === 'jtk' ? 'Bonferroni across canonical period × phase templates'
      : ctx.method === 'cosinor' ? 'Bonferroni across unique estimable candidate periods'
      : 'Approximate Lomb–Scargle false-alarm probability',
    armTested: ctx.armLabel,
    multipleTestingCorrection: ADJUSTMENT_LABELS[ctx.adjust],
    samplingTimes: bundle.meta.timepoints.map((t) => `${bundle.meta.timeUnit}${t}`).join(', '),
    libraries: bundle.meta.samples.length,
    genesTested: bundle.meta.nGenes,
    note: "Acrophase is peak time in hours on the dataset's own time axis. "
      + 'For JTK_CYCLE, amplitude is the canonical Hodges–Lehmann estimator and mesor is the Hodges–Lehmann location of the observations. A zero period denotes zero estimable amplitude.',
  });
}

/** One row per gene, in the table's current order. */
function resultRows(rows: RhythmRow[], ctx: ExportContext): WorkbookRow[] {
  const qLabel = adjustedColumnLabel(ctx.adjust);
  const statLabel = ctx.method === 'cosinor' ? 'F' : ctx.method === 'jtk' ? 'tau' : 'LSpower';
  return rows.map((r) => ({
    Gene: r.gene,
    Method: RHYTHM_METHOD_LABELS[r.method],
    PValue: r.p,
    [qLabel === 'q' ? 'qValue' : 'PValueRaw']: r.q,
    PeriodHours: r.period,
    CandidatePeriodsHours: (r.periodsTested ?? ctx.effectivePeriods ?? ctx.periods).join(';'),
    AcrophaseHours: +r.acrophase.toFixed(3),
    Amplitude: +r.amplitude.toFixed(4),
    Mesor: +r.mesor.toFixed(4),
    [statLabel]: +r.stat.toFixed(5),
    NObservations: r.n,
    NTimepoints: r.nTimepoints,
  }));
}

/** One tidy row per (gene, library) — the values every test above ran on. */
export function rawValueRows(bundle: TimeSeriesBundle, genes: string[]): WorkbookRow[] {
  const out: WorkbookRow[] = [];
  const armLabel = new Map(bundle.meta.arms.map((a) => [a.key, a.label]));
  const unit = bundle.meta.expressionUnit === CPM_TMM_UNIT ? CPM_TMM_UNIT
    : bundle.meta.expressionUnit === 'CPM' ? 'NormCPM' : 'NormValue';
  for (const gene of genes) {
    const values = bundle.values[gene];
    if (!values) continue;
    bundle.meta.samples.forEach((s, i) => {
      const v = values[i];
      if (v == null) return;
      out.push({
        Gene: gene,
        Sample: s.id,
        Arm: armLabel.get(s.arm) ?? s.arm,
        TimeHours: s.time,
        TimeLabel: `${bundle.meta.timeUnit}${s.time}`,
        Replicate: s.replicate,
        [unit]: v,
      });
    });
  }
  return out;
}

// The scientific columns first, in their row-builder order, then the shared
// provenance columns: the same layout as the gene CSVs. Cells go through the
// module's one CSV escaping rule.
function toCsv(rows: WorkbookRow[], provenance: WorkbookRow): string {
  if (!rows.length) return '';
  const columns = Object.keys(rows[0]);
  return [[...columns, ...Object.keys(provenance)].map(exportCsvCell).join(','), ...rows.map((r, index) => [
    ...columns.map((h) => r[h]),
    ...provenanceColumnValues(provenance, index),
  ].map(exportCsvCell).join(','))].join('\n');
}

function csvDownload(kind: ExportKind, parts: string[], rows: WorkbookRow[], ctx: ExportContext): void {
  const provenance = provenanceColumns(circadianProvenance(kind, ctx));
  downloadFile(exportName(timeSeriesSubject(ctx.dataset, ctx.bundle), parts, 'csv'),
    `data:text/csv;charset=utf-8,${encodeURIComponent(toCsv(rows, provenance))}`);
}

export function exportResultsCSV(rows: RhythmRow[], ctx: ExportContext): void {
  csvDownload('rhythmicity', ['rhythmicity', ctx.method], resultRows(rows, ctx), ctx);
}

export function exportRawCSV(bundle: TimeSeriesBundle, genes: string[], ctx: ExportContext): void {
  csvDownload('timecourse_values', ['timecourse_values'], rawValueRows(bundle, genes), ctx);
}

/**
 * The full workbook: settings, results, and the raw values behind `rawGenes`.
 *
 * `rawGenes` is deliberately a subset — every gene's raw values would be
 * ~550,000 rows on the SCN series, past what Excel opens comfortably and far
 * past what anyone reads. The tab passes the genes currently in view.
 */
export function exportWorkbook(
  rows: RhythmRow[],
  rawGenes: string[],
  ctx: ExportContext,
): Promise<void> {
  return writeWorkbook(exportName(timeSeriesSubject(ctx.dataset, ctx.bundle), ['circadian'], 'xlsx'), [
    { name: 'Rhythmicity', rows: resultRows(rows, ctx) },
    { name: 'RawValues', rows: rawValueRows(ctx.bundle, rawGenes) },
    metadataSheet(circadianProvenance('circadian', ctx)),
  ]);
}
