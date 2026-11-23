// The numbers behind the compare views' summary table and their exports: the
// wide on-screen rows (one per gene, a block of columns per compared column,
// and the tally the compare-set view adds in front), and the long-format
// downloads further down.
//
// Shared by the Compare tab and the compare-set view so the on-screen table
// and the downloaded sheet cannot disagree about a cell — the export used to
// be built inline in the tab, beside a table that read the same fields a
// second time. Every builder reads its (column, gene) answers from the
// compare-cell module, so the unavailable-skip and not-detected rules are the
// cell's, not each builder's.

import { pToStar } from '../utils/format';
import { displayUnit, groupLabels, meanColumnLabel } from '../utils/sampleValues';
import { effectDirection, isFdrSignificant } from '../statistics/policy';
import {
  columnsSubject, exportName, exportProvenance, metadataSheet, trackSubject,
  type ExportProvenance, type ExportSettings,
} from '../utils/exportProvenance';
import type { WorkbookRow, WorkbookSheet } from '../utils/workbook';
import type { CsvCell } from '../utils/csv';
import type { PopData } from '../types';
import type { CompareColumn } from './compareColumns';
import { compareCell, type CompareArm, type CompareCell } from './compareCell';

/**
 * A COUNT of per-column verdicts for one gene, not a test.
 *
 * Each column's FDR was computed inside its own study and knows nothing of the
 * others, so `sig` says how many studies called the gene on their own terms
 * and `up`/`down` how those calls split — the Methods & statistics page's "significant
 * in N of M" rule. Nothing here is pooled, and the header that renders this
 * says so.
 */
export interface GeneTally {
  /** Columns with data that carry the gene. */
  detected: number;
  /** Columns with data at all (the denominator for "detected"). */
  ready: number;
  /** Of `detected`, those with FDR < 0.05. */
  sig: number;
  /** Of `sig`, the up- and down-regulated. */
  up: number;
  down: number;
}

/** Tally one gene's cells, one per column. An unavailable cell is not counted at all. */
export function tallyGene(cells: readonly CompareCell[]): GeneTally {
  const tally: GeneTally = { detected: 0, ready: 0, sig: 0, up: 0, down: 0 };
  for (const cell of cells) {
    if (cell.kind === 'unavailable') continue;
    tally.ready += 1;
    if (cell.kind !== 'measured') continue;
    tally.detected += 1;
    if (!isFdrSignificant(cell.de.FDR)) continue;
    tally.sig += 1;
    const direction = effectDirection(cell.de.logFC);
    if (direction === 'up') tally.up += 1;
    else if (direction === 'down') tally.down += 1;
  }
  return tally;
}

const round4 = (v: number): number => +v.toFixed(4);

/** A statistic to four places, or '' when the cell or arm has none. */
const fixed4 = (v: number | null | undefined): number | '' => (v == null ? '' : round4(v));

/**
 * The compare-set summary sheet: per gene, each column's logFC / p / stars and
 * its two group means, prefixed by the column key so a sheet with twelve
 * studies stays readable. Group-mean headers come from meanColumnLabel so the
 * unit is never mislabelled across columns that measure in different ones.
 * An unavailable column contributes no cells; a column that did not detect the
 * gene contributes blank ones, its group means included. With `tally`, each
 * row leads with the gene's Detected / SigFDR05 / Up / Down counts.
 */
export function compareSummaryRows(
  columns: readonly CompareColumn[],
  popDataMap: Record<string, PopData | null>,
  genes: readonly string[],
  { tally = false }: { tally?: boolean } = {},
): WorkbookRow[] {
  return genes.map((gene) => {
    const cells = columns.map((col) => compareCell(col, popDataMap, gene));
    const row: WorkbookRow = { Gene: gene };
    if (tally) {
      const t = tallyGene(cells);
      Object.assign(row, { Detected: t.detected, SigFDR05: t.sig, Up: t.up, Down: t.down });
    }
    for (const cell of cells) {
      if (cell.kind === 'unavailable') continue;
      const { key } = cell.column;
      const measured = cell.kind === 'measured' ? cell : null;
      row[`${key}_logFC`] = measured?.de.logFC ?? '';
      row[`${key}_PValue`] = measured?.de.PValue ?? '';
      row[`${key}_Stars`] = measured?.de.PValue != null ? pToStar(measured.de.PValue) : '';
      const { baselineLabel, caseLabel } = groupLabels(cell.pd.contrast);
      row[`${key}_${meanColumnLabel(cell.pd, baselineLabel)}`] = fixed4(measured?.arms[0]?.mean);
      row[`${key}_${meanColumnLabel(cell.pd, caseLabel)}`] = fixed4(measured?.arms[1]?.mean);
    }
    return row;
  });
}

// ── Long-format downloads (the Compare tab) ─────────────────────────────────
//
// The on-screen table is wide — four cells per population across — because
// that is how a reader scans one gene. A download is read by software, and a
// wide sheet with sixty populations is 240 columns nobody can filter or plot.
// So the downloads are TIDY: one row per gene × population in the summary, and
// one row per gene × population × animal in the values, each row carrying its
// own group names and unit so it means the same thing out of context.

/** The unit the values are written in: always as deposited, never the chart's display scale. */
function unitOf(pd: PopData): string {
  return displayUnit(pd);
}

/** An arm's n / mean / SEM cells; n is blank, not 0, when the gene was not detected. */
function armCells(detected: boolean, arm: CompareArm | undefined) {
  return {
    n: detected ? arm?.n ?? 0 : '',
    mean: fixed4(arm?.mean),
    sem: fixed4(arm?.sem),
  };
}

/**
 * One row per gene × population: the DE statistics, then each arm's name, n,
 * mean and SEM of the per-animal values the bars are drawn from. A gene a
 * population did not detect still gets its row, marked `Detected: no`, so the
 * table is complete rather than silently shorter for that population.
 */
export function compareSummaryLongRows(
  columns: readonly CompareColumn[],
  popDataMap: Record<string, PopData | null>,
  genes: readonly string[],
): WorkbookRow[] {
  const rows: WorkbookRow[] = [];
  for (const gene of genes) {
    for (const col of columns) {
      const cell = compareCell(col, popDataMap, gene);
      if (cell.kind === 'unavailable') continue;
      const measured = cell.kind === 'measured' ? cell : null;
      const de = measured?.de;
      const { baselineLabel, caseLabel } = groupLabels(cell.pd.contrast);
      const b = armCells(!!measured, measured?.arms[0]);
      const c = armCells(!!measured, measured?.arms[1]);
      rows.push({
        Gene: gene,
        Population: col.key,
        Label: col.chartLabel ?? col.label,
        Detected: measured ? 'yes' : 'no',
        logFC: de?.logFC ?? '',
        PValue: de?.PValue ?? '',
        FDR: de?.FDR ?? '',
        Stars: de?.PValue != null ? pToStar(de.PValue) : '',
        Baseline: baselineLabel,
        'Baseline n': b.n,
        'Baseline mean': b.mean,
        'Baseline SEM': b.sem,
        Case: caseLabel,
        'Case n': c.n,
        'Case mean': c.mean,
        'Case SEM': c.sem,
        Unit: unitOf(cell.pd),
      });
    }
  }
  return rows;
}

/**
 * One row per animal (sample) behind every bar: the values the chart's dots
 * are drawn from, as deposited, with the group each belongs to — enough to
 * redraw any chart, or recompute its mean and SEM, without this site.
 */
export function compareValueRows(
  columns: readonly CompareColumn[],
  popDataMap: Record<string, PopData | null>,
  genes: readonly string[],
): WorkbookRow[] {
  const rows: WorkbookRow[] = [];
  for (const gene of genes) {
    for (const col of columns) {
      const cell = compareCell(col, popDataMap, gene);
      if (cell.kind !== 'measured') continue;
      const unit = unitOf(cell.pd);
      for (const arm of cell.arms) {
        for (const sample of arm.samples) {
          rows.push({
            Gene: gene,
            Population: col.key,
            Label: col.chartLabel ?? col.label,
            Group: arm.label,
            Sample: sample.id,
            Value: sample.value,
            Unit: unit,
          });
        }
      }
    }
  }
  return rows;
}

const compareSettings = (genes: readonly string[]): ExportSettings => ({
  geneCount: genes.length,
  geneSelection: 'Explicit genes in the exported row order.',
  layout: 'One row per gene × population (Compare); one row per gene × population × sample (Values).',
  values: 'Per-sample values as deposited; the chart scale toggle does not change them.',
});

/**
 * The Compare tab's gene export: the long summary sheet, the per-sample
 * values sheet, then the Metadata sheet recording every compared column's
 * dataset, track, contrast, unit and evidence. Named by the export-provenance
 * module, so a different population selection or contrast never reuses the
 * old fixed `hypoexplorer_compare.xlsx`.
 */
export function compareGenesWorkbook(
  columns: readonly CompareColumn[],
  popDataMap: Record<string, PopData | null>,
  genes: readonly string[],
): { filename: string; sheets: WorkbookSheet[] } {
  const subject = columnsSubject(columns, popDataMap);
  return {
    filename: exportName(subject, ['compare'], 'xlsx'),
    sheets: [
      { name: 'Compare', rows: compareSummaryLongRows(columns, popDataMap, genes) },
      { name: 'Values', rows: compareValueRows(columns, popDataMap, genes) },
      metadataSheet(exportProvenance('compare', subject, compareSettings(genes))),
    ],
  };
}

interface CompareCsv {
  filename: string;
  columns: string[];
  rows: CsvCell[][];
  provenance: ExportProvenance;
  /** Each row's own track, for the CSV's identifier columns (see writeCsv). */
  rowProvenance: (rowIndex: number) => ExportProvenance;
}

function toCsv(
  rows: WorkbookRow[],
  filename: string,
  provenance: ExportProvenance,
  popDataMap: Record<string, PopData | null>,
  settings: ExportSettings,
): CompareCsv {
  const header: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) if (!seen.has(key)) { seen.add(key); header.push(key); }
  // A row is one population, so its DatasetID / TrackID / unit columns name
  // that population, not every population in the file. One record per
  // population, built once rather than once per row.
  const byPopulation = new Map<string, ExportProvenance>();
  const rowProvenance = (rowIndex: number): ExportProvenance => {
    const key = String(rows[rowIndex]?.Population ?? '');
    const pd = popDataMap[key];
    if (!pd) return provenance;
    let record = byPopulation.get(key);
    if (!record) { record = exportProvenance('compare', trackSubject(pd), settings); byPopulation.set(key, record); }
    return record;
  };
  return { filename, columns: header, rows: rows.map((row) => header.map((key) => row[key])), provenance, rowProvenance };
}

/**
 * The summary as a CSV: identical rows to the workbook's Compare sheet,
 * written by the CSV seam with the shared provenance columns in place of the
 * Metadata sheet.
 */
export function compareGenesCsv(
  columns: readonly CompareColumn[],
  popDataMap: Record<string, PopData | null>,
  genes: readonly string[],
): CompareCsv {
  const subject = columnsSubject(columns, popDataMap);
  const settings = compareSettings(genes);
  return toCsv(
    compareSummaryLongRows(columns, popDataMap, genes),
    exportName(subject, ['compare'], 'csv'),
    exportProvenance('compare', subject, settings),
    popDataMap, settings,
  );
}

/** The workbook's Values sheet as its own CSV: one row per sample. */
export function compareValuesCsv(
  columns: readonly CompareColumn[],
  popDataMap: Record<string, PopData | null>,
  genes: readonly string[],
): CompareCsv {
  const subject = columnsSubject(columns, popDataMap);
  const settings = compareSettings(genes);
  return toCsv(
    compareValueRows(columns, popDataMap, genes),
    exportName(subject, ['compare', 'values'], 'csv'),
    exportProvenance('compare', subject, settings),
    popDataMap, settings,
  );
}
