// The bar charts' value scale — what the y-axis plots, and why.
//
// Stored values sit on whatever scale a study deposited them in. The macaque
// atlas is plain CPM; most bulk studies arrive already logged with a stated
// pseudocount ('log2(FPKM + 1)'); a few are logged with no stated offset
// ('log2-normalized', 'log2 CPM (TMM-normalized)'); two are variance-stabilized,
// which is neither. A grid comparing them therefore stood a linear axis beside a
// log2 one and captioned both "expression", with no way to ask for either.
//
// Two questions follow, and this is the only place that answers them:
//   classifyUnit(unit)                 — what scale are the stored values on?
//   resolveChartScale(unit, requested) — given the user's pick, what do we plot?
//
// resolveChartScale never refuses to draw. A scale a dataset cannot honour —
// you cannot put 'log2-normalized' back on a linear axis without the offset it
// was never given — falls back to the deposited scale and reports `unavailable`,
// the sentence the chart shows on hover behind a '†'. That fallback is what
// makes ONE global control safe above a grid of mixed units: every chart names
// the scale it is actually on, and none of them invents a number.
//
// The transform is a DISPLAY choice and nothing else reads it. Exports carry the
// deposited values under their deposited header (see valueColumnName), and the
// p-value beside each chart comes from the differential-expression model, which
// ran on counts long before any of this.

import { parseLog2WithOffset } from '../data/expressionUnits';
import { displayUnit, unitProvenance } from './sampleValues';

/** The user's pick. 'native' is the default: every dataset as deposited. */
export type ChartScale = 'native' | 'linear' | 'log2';

/** The three choices, in the order the toggle offers them. */
export const CHART_SCALES: readonly ChartScale[] = ['native', 'linear', 'log2'];

export type UnitKind =
  /** Untransformed counts-per-something: CPM, TPM, FPKM. */
  | 'linear'
  /** Logged with a stated pseudocount, so the transform is exactly invertible. */
  | 'log2'
  /** Logged, but the unit names no offset — invertible only by guessing. */
  | 'log2-opaque'
  /** Neither: variance-stabilized values are log-like without being a log. */
  | 'other';

export interface UnitScale {
  kind: UnitKind;
  /** The deposited unit in the chart's own short spelling. */
  label: string;
  /** kind 'log2' only: the unit inside the log, e.g. 'FPKM'. */
  base?: string;
  /** kind 'log2' only: the pseudocount added before logging. */
  offset?: number;
}

// 'log2(<base> + <offset>)' (parseLog2WithOffset) is the invertible case, and
// the shape most of the corpus's unit strings that mention a log are written in.
// Any other mention of a log: 'log2-normalized', 'log2 CPM (TMM-normalized)'.
const LOGGED = /log\s*-?\s*2|log₂/i;
// DESeq2's VST and its spellings. Log-like, but not a log of anything stated.
const STABILIZED = /variance[\s-]*stabiliz|\bvst\b/i;

/**
 * What scale a deposited unit string is on.
 *
 * The unit is free text written by whoever registered the dataset, so this
 * reads it rather than looking it up: a new study spelling its unit
 * 'log2(RSEM-normalized expression + 1)' classifies correctly the day it lands,
 * with no table to update. An unrecognised unit falls to 'linear', which is the
 * safe default — it offers the log2 transform and never claims to invert one.
 */
export function classifyUnit(unit?: string | null): UnitScale {
  const source = (unit ?? '').trim() || 'CPM';
  const label = displayUnit({ expressionUnit: source });
  const logged = parseLog2WithOffset(source);
  if (logged) return { kind: 'log2', label, ...logged };
  if (LOGGED.test(source)) return { kind: 'log2-opaque', label };
  if (STABILIZED.test(source)) return { kind: 'other', label };
  return { kind: 'linear', label };
}

export interface ScaleView {
  /** Unit label for the values AS PLOTTED, e.g. 'log2(CPM + 1)'. */
  unitLabel: string;
  /** Stored value → plotted value. Identity when nothing is transformed. */
  transform: (value: number) => number;
  /** Hover text behind the unit label: where the unit came from, and what this
   *  view did to it. Already includes `unavailable` when that is set. */
  provenance: string;
  /** Set when the requested scale could not be honoured: the axis fell back to
   *  the deposited scale, and this says why. */
  unavailable?: string;
}

const identity = (value: number): number => value;

// Computing the mean AFTER the transform is the point — a log axis whose bar is
// the log of the arithmetic mean is a linear chart with relabelled ticks — but
// it does change what the bar is, so the tooltip says so rather than leaving a
// reader to assume the bar survived the transform unchanged.
const AGGREGATION_NOTE =
  'Mean ± SEM is computed on the transformed sample values, so the bar is the mean of the '
  + 'transformed values, not the transform of the mean. The P-value beside it comes from the '
  + 'differential-expression model and is unaffected by this display choice.';

/**
 * The axis for one dataset under the user's current pick.
 *
 * `requested` is global and `unit` is per-dataset, so this is called once per
 * chart and the same pick can resolve four ways across one grid.
 */
export function resolveChartScale(unit: string | null | undefined, requested: ChartScale): ScaleView {
  const parsed = classifyUnit(unit);
  const deposited = unitProvenance({ expressionUnit: unit ?? undefined });
  const asDeposited: ScaleView = {
    unitLabel: parsed.label,
    transform: identity,
    provenance: deposited,
  };
  const fallback = (why: string): ScaleView => ({
    ...asDeposited,
    provenance: `${deposited} ${why}`,
    unavailable: why,
  });

  if (requested === 'native') return asDeposited;

  if (requested === 'log2') {
    if (parsed.kind === 'linear') {
      return {
        unitLabel: `log2(${parsed.label} + 1)`,
        // Clamped at zero: a linear unit has no negative values, and a stray one
        // would otherwise reach log2 of a non-positive number and plot NaN.
        transform: (value) => Math.log2(Math.max(0, value) + 1),
        provenance: `${deposited} Plotted as log2(x + 1); the pseudocount keeps a zero at zero, `
          + `so the bars still start on the axis. ${AGGREGATION_NOTE}`,
      };
    }
    // Already logged, by either spelling: the deposited values ARE the log2 axis.
    if (parsed.kind === 'log2' || parsed.kind === 'log2-opaque') return asDeposited;
    return fallback(
      `These values were deposited as “${parsed.label}”, which is already on a log-like scale `
      + 'without being a log of anything stated — logging them again would not mean anything. '
      + 'Showing them as deposited.',
    );
  }

  // requested === 'linear'
  if (parsed.kind === 'linear') return asDeposited;
  if (parsed.kind === 'log2') {
    const { base = parsed.label, offset = 0 } = parsed;
    return {
      unitLabel: base,
      // The exact inverse of the transform the unit names. Clamped at zero
      // because floating point can leave 2^0 − 1 a hair below it.
      transform: (value) => Math.max(0, 2 ** value - offset),
      provenance: `${deposited} Plotted back on the linear scale as 2^x − ${offset}, the exact `
        + `inverse of the transform this unit names. ${AGGREGATION_NOTE}`,
    };
  }
  if (parsed.kind === 'log2-opaque') {
    return fallback(
      `These values were deposited as “${parsed.label}” with no stated pseudocount, so there is `
      + 'no exact way back to a linear scale. Showing them as deposited.',
    );
  }
  return fallback(
    `These values were deposited as “${parsed.label}”, which is not a log of a linear unit, so `
    + 'there is nothing to undo. Showing them as deposited.',
  );
}

/**
 * Y-axis tick text.
 *
 * Magnitude-aware because one axis now has to read on both scales: CPM runs to
 * thousands, log2(CPM + 1) to about fifteen, and back-transformed FPKM can be a
 * fraction. The integer rounding this replaces printed a log2 axis as
 * "0 1 2 2 3" and a low-expression CPM axis as four zeros.
 */
export function formatAxisTick(value: number): string {
  if (!Number.isFinite(value)) return '';
  const magnitude = Math.abs(value);
  if (magnitude >= 1000) return `${(value / 1000).toFixed(1)}k`;
  if (magnitude >= 100) return `${Math.round(value)}`;
  // toPrecision then back through Number: 42 stays '42', 12.5 stays '12.5',
  // 0.8333… becomes '0.833' — no trailing zeros on a tick that does not need them.
  return `${+value.toPrecision(3)}`;
}
