// One column of a side-by-side comparison, whichever axis the columns are on.
//
// The Compare tab lines up POPULATIONS of one dataset; the compare-set view
// lines up STUDIES — and single populations — from across the corpus. Both
// draw the same bar grids, summary tables and pathway matrices, so those views
// read a column's identity (key, label, colour, QC) from this shape and never
// from a DatasetMeta or a bare population id. What a column IS stays with the
// caller: `columnsForPops` builds them for the Compare tab, and the compare-set
// view builds its own from what it has loaded.

import { trackColor, trackLabel } from '../data/datasetMeta';
import type { DatasetMeta, PopData, TrackQC } from '../types';

export interface CompareColumn {
  /** Unique per column, and the prefix its export columns carry. */
  key: string;
  /** Header and table text. */
  label: string;
  /** For tight spots — chart gutters, matrix headers. Defaults to `label`. */
  shortLabel?: string;
  /** The bar chart's caption and the "no expression" tile. Defaults to `label`. */
  chartLabel?: string;
  color: string;
  /** A second line beneath the label: organism · contrast. */
  sublabel?: string;
  qc: TrackQC | null;
  /**
   * Set when the column has NO popData for a reason that is not "no data".
   * The genes view renders the reason; it must never render "not detected",
   * which is a claim about data nobody has read.
   */
  unavailable?: { status: 'loading' | 'failed' | 'unknown-track'; message: string };
}

/** How a view names its columns in prose and headers. */
export interface ColumnNoun {
  singular: string;
  plural: string;
  /** Column-count header ("Pops", "Studies"). */
  short: string;
  /** The per-column key header in tidy exports ("Pop", "Study"). */
  exportHeader: string;
}

export const POPULATION_NOUN: ColumnNoun = { singular: 'population', plural: 'populations', short: 'Pops', exportHeader: 'Pop' };
export const STUDY_NOUN: ColumnNoun = { singular: 'study', plural: 'studies', short: 'Studies', exportHeader: 'Study' };

/**
 * The Compare tab's columns: one per selected population of the active
 * dataset, keyed and labelled by the population id (what its headers have
 * always printed) and captioned with the meta's full label (what its charts
 * have always printed).
 */
export function columnsForPops(
  meta: DatasetMeta | null,
  pops: readonly string[],
  popDataMap: Record<string, PopData | null>,
): CompareColumn[] {
  return pops.map((id) => ({
    key: id,
    label: id,
    shortLabel: id,
    chartLabel: trackLabel(meta, id),
    color: trackColor(meta, id),
    qc: popDataMap[id]?.qc ?? null,
  }));
}

/**
 * Column colours for the compare-set view, by column position.
 *
 * Colour here encodes column IDENTITY — the same job a population's palette
 * colour does in the Compare tab. Deliberately absent: the up/down reds and
 * blues (UP_COLOR / DOWN_COLOR), which the same tables use for direction, and
 * Signal Orange, which marks the one active control (DESIGN.md). A macaque
 * population keeps its position colour too, rather than its navigator hue:
 * two of those hues ARE the direction colours, and a swatch that reads as
 * "up" beside a column of logFC values is worse than a swatch that reads as
 * nothing.
 */
export const COMPARE_COLUMN_PALETTE: readonly string[] = [
  '#59A14F', '#B07AA1', '#9C755F', '#76B7B2', '#EDC948', '#FF9DA7',
  '#1B9E77', '#7570B3', '#A6761D', '#D4A6C8', '#8C8C8C', '#4E5D6C',
];

export function columnColorAt(index: number): string {
  return COMPARE_COLUMN_PALETTE[index % COMPARE_COLUMN_PALETTE.length];
}
