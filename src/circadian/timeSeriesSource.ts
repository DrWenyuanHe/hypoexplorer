// The time-series seam: loading a track's circadian bundle, and turning it into
// the two shapes the module actually consumes —
//
//   seriesFor(bundle, gene, armKey)   → the (times, values) a rhythm test takes
//   summarizeGene(bundle, gene)       → per-arm, per-timepoint mean/SEM/points
//                                       for the figure
//
// Everything downstream reads through these, so the rule for what counts as an
// observation ("a sample whose value is non-null, at its own sampling time")
// is stated once. Views never index the parallel arrays themselves.

import { loadOptionalBundle } from '../data/bundleSource';
import { resolveTimeSeriesGlobalKey, resolveTimeSeriesUrl } from '../data/bundleLocators';
import type { Dataset, TimeSeriesArm, TimeSeriesBundle } from '../types';
import type { RhythmSeries } from './rhythmicity';

/**
 * Load one track's time-series bundle, or null when the dataset has none.
 *
 * Optional, not required: a dataset without a time course is a legitimate
 * answer, not an error — the tab is simply not offered for it.
 *
 * The registry's expression unit wins over the one stamped in the bundle, as it
 * does for track bundles (buildPopData): a relabelled unit reaches the axis and
 * exports without rebuilding hash-pinned bundle bytes.
 */
export function loadTimeSeries(dataset: Dataset, trackId: string): Promise<TimeSeriesBundle | null> {
  if (!dataset.timeSeries?.tracks.includes(trackId)) return Promise.resolve(null);
  return loadOptionalBundle<TimeSeriesBundle>(
    resolveTimeSeriesUrl(dataset, trackId),
    resolveTimeSeriesGlobalKey(dataset, trackId),
  ).then((bundle) => (bundle && dataset.expressionUnit && bundle.meta.expressionUnit !== dataset.expressionUnit
    ? { ...bundle, meta: { ...bundle.meta, expressionUnit: dataset.expressionUnit } }
    : bundle));
}

/** The pseudo-arm key meaning "pool every arm into one series". */
export const ALL_ARMS = '__all__';

/**
 * One gene's observations for one arm, ready for a rhythm test.
 *
 * Null cells are dropped rather than zero-filled: a missing value is a library
 * that produced no measurement, and zero is a real CPM that would drag a
 * least-squares fit toward a trough that never happened.
 */
export function seriesFor(
  bundle: TimeSeriesBundle,
  gene: string,
  armKey: string = ALL_ARMS,
): RhythmSeries {
  const row = bundle.values[gene];
  const times: number[] = [];
  const values: number[] = [];
  if (!row) return { times, values };
  bundle.meta.samples.forEach((sample, i) => {
    if (armKey !== ALL_ARMS && sample.arm !== armKey) return;
    const v = row[i];
    if (v == null || !Number.isFinite(v)) return;
    times.push(sample.time);
    values.push(v);
  });
  return { times, values };
}

/** One timepoint of one arm, aggregated for the figure. */
export interface TimepointSummary {
  time: number;
  mean: number;
  /** Standard error of the mean; 0 when a timepoint has a single replicate. */
  sem: number;
  n: number;
  /** Every replicate value, for the raw-data dot overlay. */
  points: number[];
}

export interface ArmSummary {
  arm: TimeSeriesArm;
  timepoints: TimepointSummary[];
}

/** Per-arm, per-timepoint aggregation of one gene — the figure's whole input. */
export function summarizeGene(bundle: TimeSeriesBundle, gene: string): ArmSummary[] {
  const row = bundle.values[gene];
  return bundle.meta.arms.map((arm) => {
    const byTime = new Map<number, number[]>();
    bundle.meta.samples.forEach((sample, i) => {
      if (sample.arm !== arm.key) return;
      const v = row?.[i];
      if (v == null || !Number.isFinite(v)) return;
      const slot = byTime.get(sample.time);
      if (slot) slot.push(v);
      else byTime.set(sample.time, [v]);
    });
    const timepoints = [...byTime.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([time, points]) => {
        const n = points.length;
        const mean = points.reduce((a, b) => a + b, 0) / n;
        let ss = 0;
        for (const v of points) ss += (v - mean) ** 2;
        const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
        return { time, mean, sem: n > 1 ? sd / Math.sqrt(n) : 0, n, points };
      });
    return { arm, timepoints };
  });
}

/** Arms a series offers, plus the pooled pseudo-arm when there is more than one. */
export function armChoices(bundle: TimeSeriesBundle): TimeSeriesArm[] {
  const arms = bundle.meta.arms;
  if (arms.length < 2) return arms;
  return [...arms, { key: ALL_ARMS, label: 'All arms pooled', color: '#6B7280' }];
}

/**
 * Genes a scan should consider, in bundle order.
 *
 * Object key order is the DE table's rank order (the generator writes it that
 * way), which makes an aborted or truncated scan degrade to "the most
 * differentially expressed genes first" rather than to an alphabetical slice.
 */
export function geneList(bundle: TimeSeriesBundle): string[] {
  return Object.keys(bundle.values);
}
