// The numbers behind the compare views' summary table and its export: one row
// per selected gene, a block of columns per compared column, and the tally
// the compare-set view adds in front.
//
// Shared by the Compare tab and the compare-set view so the on-screen table
// and the downloaded sheet cannot disagree about a cell — the export used to
// be built inline in the tab, beside a table that read the same fields a
// second time.

import { mean } from '../utils/math';
import { pToStar } from '../utils/format';
import { getGroupedValues, groupLabels, meanColumnLabel } from '../utils/sampleValues';
import { effectDirection, isFdrSignificant } from '../statistics/policy';
import { columnsSubject, exportName, exportProvenance, metadataSheet } from '../utils/exportProvenance';
import type { WorkbookRow, WorkbookSheet } from '../utils/workbook';
import type { PopData } from '../types';
import type { CompareColumn } from './compareColumns';
import { resolveGeneCI } from './resolveGene';

/**
 * A COUNT of per-column verdicts for one gene, not a test.
 *
 * Each column's FDR was computed inside its own study and knows nothing of the
 * others, so `sig` says how many studies called the gene on their own terms
 * and `up`/`down` how those calls split — the Statistics page's "significant
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
      row[`${col.key}_${meanColumnLabel(pd, baselineLabel)}`] = +mean(base?.values ?? []).toFixed(4);
      row[`${col.key}_${meanColumnLabel(pd, caseLabel)}`] = +mean(caseGroup?.values ?? []).toFixed(4);
    }
    return row;
  });
}

/**
 * The Compare tab's gene export: the summary sheet, then the Metadata sheet
 * recording every compared column's dataset, track, contrast, unit and
 * evidence. Named by the export-provenance module, so a different population
 * selection or contrast never reuses the old fixed `hypoexplorer_compare.xlsx`.
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
      { name: 'Compare', rows: compareSummaryRows(columns, popDataMap, genes) },
      metadataSheet(exportProvenance('compare', subject, {
        geneCount: genes.length,
        geneSelection: 'Explicit genes in the exported row order.',
      })),
    ],
  };
}
