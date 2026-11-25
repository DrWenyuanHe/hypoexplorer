// One cell of a side-by-side comparison: a Compare column and a gene.
//
// Every compare surface asks the same question of a (column, gene) pair: the
// chart tiles, both summary tables, the compare-set tally, the long and wide
// export sheets, the per-sample Values sheet, the chart ZIP and the pathway
// view's leading-edge table. They used to ask it a dozen times over, and the
// copies disagreed: some skipped an unavailable column and some did not, and
// one read group values for a gene the column never measured, which is how an
// unmeasured study came to export a group mean of 0. The answer now has one
// spelling, and it is exactly one of three things:
//
//   unavailable   — the column has no data to read (still loading, failed,
//                   naming a track the dataset lacks, or simply absent from the
//                   popData map). Nothing about the gene is known, so a view
//                   says why and never says "not detected".
//   not-detected  — the column's data was read and its DE table has no row for
//                   the gene under any casing. No statistics and no group
//                   values, even where the cpm matrix happens to carry the
//                   symbol: "detected" means the column tested the gene.
//   measured      — the column's own spelling of the gene (resolved
//                   case-insensitively, so a mouse column answers Pomc for
//                   POMC), its DE record, and each contrast arm's present
//                   samples with n, mean and SEM.
//
// Group membership and the dropped-sample rule come from the sample-value seam
// (getGroupColumns + valueAt), so an arm's n is the number of samples that
// carry a value, never the size of the arm on paper.

import { mean, std } from '../utils/math';
import { getGroupColumns, valueAt } from '../utils/sampleValues';
import type { GeneDERecord, PopData } from '../types';
import type { CompareColumn } from './compareColumns';
import { resolveGeneCI } from './resolveGene';
import type { SymbolRenames } from '../data/symbolRenames';

export type UnavailableStatus = NonNullable<CompareColumn['unavailable']>['status'];

/** One contrast arm of a measured cell: its present samples and their summary. */
export interface CompareArm {
  key: string;
  label: string;
  color: string;
  /** Samples that carry a value, in the arm's sample order. */
  samples: Array<{ id: string; value: number }>;
  values: number[];
  n: number;
  /** null when the arm has no values. */
  mean: number | null;
  /** Standard error of the mean; null below two values. */
  sem: number | null;
}

export type CompareCell =
  | { kind: 'unavailable'; column: CompareColumn; status: UnavailableStatus; message: string }
  | { kind: 'not-detected'; column: CompareColumn; pd: PopData }
  | {
    kind: 'measured';
    column: CompareColumn;
    pd: PopData;
    /** The column's own spelling of the gene. */
    gene: string;
    de: GeneDERecord;
    /** [baseline, case] for the column's contrast; empty when it has none. Read lazily, once. */
    readonly arms: CompareArm[];
  };

// A column the caller did not flag but has no popData for is still a column
// nobody has read: unavailable, not "not detected".
const NO_DATA = { status: 'failed' as const, message: 'No data loaded for this column' };

function armsOf(pd: PopData, gene: string): CompareArm[] {
  return getGroupColumns(pd, pd.contrast).map((group) => {
    const samples: CompareArm['samples'] = [];
    for (const s of group.samples) {
      const value = valueAt(pd, gene, s.index);
      if (value != null) samples.push({ id: s.id, value });
    }
    const values = samples.map((s) => s.value);
    const n = values.length;
    return {
      key: group.key,
      label: group.label,
      color: group.color,
      samples,
      values,
      n,
      mean: n ? mean(values) : null,
      sem: n > 1 ? std(values) / Math.sqrt(n) : null,
    };
  });
}

/**
 * What `column` can say about `gene`: unavailable, not detected, or measured.
 * With the rename table, a column that stores the gene under another member
 * of its rename group is measured under that symbol (see resolveGeneCI).
 */
export function compareCell(
  column: CompareColumn,
  popDataMap: Record<string, PopData | null | undefined>,
  gene: string,
  renames?: SymbolRenames | null,
): CompareCell {
  const pd = popDataMap[column.key];
  if (column.unavailable || !pd) {
    const { status, message } = column.unavailable ?? NO_DATA;
    return { kind: 'unavailable', column, status, message };
  }
  const de = resolveGeneCI(pd, gene, renames);
  if (!de) return { kind: 'not-detected', column, pd };
  // The arms are read on first use and kept: most readers (the summary tables,
  // the tally, the pathway view) need only the DE record, and resolving an arm
  // walks the whole sample axis, which on a 391-sample track across a long gene
  // list would stall every render for numbers nobody shows.
  let arms: CompareArm[] | undefined;
  return {
    kind: 'measured', column, pd, gene: de.gene, de,
    get arms() {
      arms ??= armsOf(pd, de.gene);
      return arms;
    },
  };
}

/** The DE record of a measured cell, or undefined for the other two kinds. */
export function cellDE(cell: CompareCell): GeneDERecord | undefined {
  return cell.kind === 'measured' ? cell.de : undefined;
}
