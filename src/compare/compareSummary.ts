// The numbers behind the compare views' summary table and their exports: the
// wide on-screen rows (one per gene, a block of columns per compared column,
// and the tally the compare-set view adds in front), and the long-format
// downloads further down.
//
// Shared by the Compare tab and the compare-set view so the on-screen table
// and the downloaded sheet cannot disagree about a cell — the export used to
// be built inline in the tab, beside a table that read the same fields a
// second time.

import { mean, std } from '../utils/math';
import { pToStar } from '../utils/format';
import { displayUnit, getGroupedValues, getRawSampleRows, groupLabels, meanColumnLabel } from '../utils/sampleValues';
import { effectDirection, isFdrSignificant } from '../statistics/policy';
import {
  columnsSubject, exportName, exportProvenance, metadataSheet, trackSubject,
  type ExportProvenance, type ExportSettings,
} from '../utils/exportProvenance';
import type { WorkbookRow, WorkbookSheet } from '../utils/workbook';
import type { CsvCell } from '../utils/csv';
import type { PopData } from '../types';
import type { CompareColumn } from './compareColumns';
import { resolveGeneCI } from './resolveGene';

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

export function tallyGene(
  columns: readonly CompareColumn[],
  popDataMap: Record<string, PopData | null>,
  gene: string,
): GeneTally {
  const tally: GeneTally = { detected: 0, ready: 0, sig: 0, up: 0, down: 0 };
  for (const col of columns) {
    if (col.unavailable) continue;
    const pd = popDataMap[col.key];
    if (!pd) continue;
    tally.ready += 1;
    const de = resolveGeneCI(pd, gene);
    if (!de) continue;
    tally.detected += 1;
    if (!isFdrSignificant(de.FDR)) continue;
    tally.sig += 1;
    const direction = effectDirection(de.logFC);
    if (direction === 'up') tally.up += 1;
    else if (direction === 'down') tally.down += 1;
  }
  return tally;
}

/** An arm's mean to four places, or '' when the arm has no values. */
function groupMean(values: readonly number[] | undefined): number | '' {
  return values?.length ? +mean([...values]).toFixed(4) : '';
}

/**
 * The summary sheet: per gene, each column's logFC / p / stars and its two
 * group means, prefixed by the column key so a sheet with twelve studies
 * stays readable. Group-mean headers come from meanColumnLabel so the unit is
 * never mislabelled across columns that measure in different ones.
 */
export function compareSummaryRows(
  columns: readonly CompareColumn[],
  popDataMap: Record<string, PopData | null>,
  genes: readonly string[],
): WorkbookRow[] {
  return genes.map((gene) => {
    const row: WorkbookRow = { Gene: gene };
    for (const col of columns) {
      const pd = popDataMap[col.key];
      if (!pd) continue;
      const de = resolveGeneCI(pd, gene);
      row[`${col.key}_logFC`] = de?.logFC ?? '';
      row[`${col.key}_PValue`] = de?.PValue ?? '';
      row[`${col.key}_Stars`] = de?.PValue != null ? pToStar(de.PValue) : '';
      const { baselineLabel, caseLabel } = groupLabels(pd.contrast);
      const [base, caseGroup] = getGroupedValues(pd, de?.gene ?? gene, pd.contrast);
      // A study that did not measure the gene has no values for an arm; its
      // mean is blank like the other missing cells, not mean([]) = 0.
      row[`${col.key}_${meanColumnLabel(pd, baselineLabel)}`] = groupMean(base?.values);
      row[`${col.key}_${meanColumnLabel(pd, caseLabel)}`] = groupMean(caseGroup?.values);
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

const round4 = (v: number): number => +v.toFixed(4);

/** The unit the values are written in: always as deposited, never the chart's display scale. */
function unitOf(pd: PopData): string {
  return displayUnit(pd);
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
      const pd = popDataMap[col.key];
      if (!pd || col.unavailable) continue;
      const de = resolveGeneCI(pd, gene);
      const { baselineLabel, caseLabel } = groupLabels(pd.contrast);
      const [base, caseGroup] = de ? getGroupedValues(pd, de.gene, pd.contrast) : [];
      const arm = (values: readonly number[] | undefined) => {
        const n = values?.length ?? 0;
        return {
          n: de ? n : '',
          mean: n ? round4(mean([...values ?? []])) : '',
          sem: n > 1 ? round4(std([...values ?? []]) / Math.sqrt(n)) : '',
        };
      };
      const b = arm(base?.values);
      const c = arm(caseGroup?.values);
      rows.push({
        Gene: gene,
        Population: col.key,
        Label: col.chartLabel ?? col.label,
        Detected: de ? 'yes' : 'no',
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
        Unit: unitOf(pd),
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
      const pd = popDataMap[col.key];
      if (!pd || col.unavailable) continue;
      const de = resolveGeneCI(pd, gene);
      if (!de) continue;
      const unit = unitOf(pd);
      for (const sample of getRawSampleRows(pd, [de.gene])) {
        rows.push({
          Gene: gene,
          Population: col.key,
          Label: col.chartLabel ?? col.label,
          Group: sample.condition,
          Sample: sample.sample,
          Value: sample.value,
          Unit: unit,
        });
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
