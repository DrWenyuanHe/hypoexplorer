// The Circadian tab's settings strip: the four choices that define the
// analysis (test, period, arm, multiple-testing correction) plus the threshold
// that decides which genes count as rhythmic. Laid out in that order because
// each one narrows the meaning of the one after it. The right-hand side holds
// whatever summary the container passes (scan progress or the rhythmic counts).
//
// What each current choice means is written out under the strip, behind a
// closed "About these settings" disclosure, and every select points at its own
// note with aria-describedby. A hover tooltip was the only place these notes
// used to live, which neither keyboard nor touch users could reach.

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { FONT_MONO, FONT_SANS } from '../styles/constants';
import type { TimeSeriesArm } from '../types';
import {
  ADJUSTMENT_LABELS, ADJUSTMENT_NOTES, ADJUST_METHODS, type AdjustMethod,
} from './multipleTesting';
import { RHYTHM_METHOD_LABELS, type RhythmMethod } from './rhythmicity';

export type PeriodMode = 'fixed24' | 'scan';

export const SIG_LEVELS = [0.001, 0.01, 0.05, 0.1] as const;

const METHOD_NOTES: Record<RhythmMethod, string> = {
  jtk: 'Uses the canonical grouped permutation null, half-interval cosine phases and Bonferroni correction across period × phase templates. Amplitude is the canonical Hodges–Lehmann estimate. Sampling must follow a regular grid; periods must be integer sampling intervals within the sampled duration.',
  cosinor: 'Fits a cosine by least squares and compares it with a flat mean using an F test. It has the most power of these three tests for sinusoidal rhythms. Amplitude and mesor are model estimates. A single outlying replicate can dominate the fit.',
  ls: 'Computes a least-squares periodogram for unevenly sampled series. When the sampled phases support both a sine and a cosine term at every tested period, normalized power is capped at (N−1)/2, even for a perfect sinusoid, which limits how small a p-value Lomb–Scargle can report in a short series. The tab states that floor only when it can verify this for the observed sampling times of every gene scored in the arm.',
};

const PERIOD_NOTES: Record<PeriodMode, string> = {
  fixed24: 'Tests a fixed 24 h period. No correction for searching across periods is needed.',
  scan: 'Requests 20–28 h in 0.5 h steps. COSINOR applies Bonferroni across tested periods; JTK applies Bonferroni across supported period × phase templates. Gene-wise correction is then applied separately.',
};

const ARM_NOTE = 'Choose the experimental arm to test. The plot shows all arms.';
const THRESHOLD_NOTE = 'Genes below this threshold count as rhythmic. The rhythmic count includes every passing gene; the phase map plots those with an estimable peak time.';

/**
 * Appended to the period note for JTK: the family named is the arm's complete
 * sampling schedule, and a gene missing time points can be tested at another.
 */
const JTK_GENE_FAMILY_NOTE = 'A gene with missing values at some time points can be tested at a different family of periods; the periods tested for the selected gene are shown under the trace.';

/** Below this viewport width the strip becomes a two-column grid of full-width selects. */
const NARROW_QUERY = '(max-width: 480px)';

/** "20, 24" from [20, 24]; half-hour periods keep their decimal. */
function listHours(periods: readonly number[]): string {
  return periods.map((p) => String(Number(p.toFixed(1)))).join(', ');
}

/**
 * Text of the scan option in the period select.
 *
 * COSINOR and Lomb–Scargle test the whole 20–28 h request. JTK only tests the
 * requested periods that are whole multiples of the sampling interval and fit
 * the sampled duration, so when that family is known the option names it
 * rather than promising the full range. The family is the one the arm's full
 * sampling schedule supports; a gene with missing time points can be tested
 * at a different one, so the label says which schedule it describes.
 */
export function scanOptionLabel(jtkScanPeriods: readonly number[] | undefined): string {
  if (!jtkScanPeriods) return '20–28 h (scan)';
  if (jtkScanPeriods.length === 0) return 'Scan (no period JTK can test on the full schedule)';
  return `Scan (JTK: ${listHours(jtkScanPeriods)} h on the full schedule)`;
}

export interface CircadianControlsProps {
  method: RhythmMethod;
  setMethod: (method: RhythmMethod) => void;
  periodMode: PeriodMode;
  setPeriodMode: (mode: PeriodMode) => void;
  arm: string;
  setArm: (arm: string) => void;
  /** Arm choices, including the pooled option when the bundle has several arms. */
  arms: TimeSeriesArm[];
  adjust: AdjustMethod;
  setAdjust: (adjust: AdjustMethod) => void;
  threshold: number;
  setThreshold: (threshold: number) => void;
  /** Symbol for the adjusted value under the current correction ('q' or 'p'). */
  qLabel: string;
  /** Rendered at the right of the strip (scan progress or the rhythmic counts). */
  summary: ReactNode;
  /**
   * JTK's effective period family for the current period request; undefined for
   * other tests. While the scan is selected it names what the scan option tests.
   */
  effectivePeriods?: number[];
  /**
   * JTK's effective family for the 20–28 h request specifically. Optional: lets
   * the scan option stay exact while the fixed 24 h period is selected. Without
   * it, the scan option names the JTK family only while the scan is selected.
   */
  jtkScanPeriods?: number[];
}

function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(NARROW_QUERY).matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(NARROW_QUERY);
    if (!query) return undefined;
    const onChange = () => setNarrow(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

export function CircadianControls({
  method, setMethod, periodMode, setPeriodMode, arm, setArm, arms,
  adjust, setAdjust, threshold, setThreshold, qLabel, summary,
  effectivePeriods, jtkScanPeriods,
}: CircadianControlsProps) {
  const narrow = useNarrowViewport();
  const isJtk = method === 'jtk';
  // The scan family is known exactly when the container passes it, or when the
  // scan is the current request and effectivePeriods therefore describes it.
  const scanFamily = !isJtk ? undefined
    : jtkScanPeriods ?? (periodMode === 'scan' ? effectivePeriods : undefined);
  const periodNote = isJtk && effectivePeriods
    ? `${PERIOD_NOTES[periodMode]} On this arm's full sampling schedule JTK tests ${effectivePeriods.length ? `${listHours(effectivePeriods)} h` : 'no requested period'}. ${JTK_GENE_FAMILY_NOTE}`
    : PERIOD_NOTES[periodMode];
  const armLabel = arms.find((a) => a.key === arm)?.label ?? arm;

  const strip: CSSProperties = narrow
    ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--sp-2) var(--sp-3)', alignItems: 'end' }
    : { display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)', alignItems: 'flex-end' };
  const select: CSSProperties = narrow ? { ...selectStyle, width: '100%', maxWidth: 'none' } : selectStyle;
  const fullRow: CSSProperties = narrow ? { gridColumn: '1 / -1' } : { flexBasis: '100%' };

  return (
    <div style={{
      ...strip,
      padding: 'var(--sp-2) var(--sp-3)', background: 'var(--bg-panel)',
      border: '1px solid var(--border)', borderRadius: 4, marginBottom: 'var(--sp-3)',
      fontFamily: FONT_SANS, minWidth: 0,
    }}>
      <Control id="circ-method" label="Rhythm test">
        <select
          id="circ-method" aria-describedby="circ-method-note" value={method}
          onChange={(e) => setMethod(e.target.value as RhythmMethod)} style={select}
        >
          {(['jtk', 'cosinor', 'ls'] as const).map((m) => (
            <option key={m} value={m}>{RHYTHM_METHOD_LABELS[m]}</option>
          ))}
        </select>
      </Control>

      <Control id="circ-period" label="Period">
        <select
          id="circ-period" aria-describedby="circ-period-note" value={periodMode}
          onChange={(e) => setPeriodMode(e.target.value as PeriodMode)} style={select}
        >
          <option value="fixed24">24 h (fixed)</option>
          <option value="scan">{scanOptionLabel(scanFamily)}</option>
        </select>
      </Control>

      <Control id="circ-arm" label="Arm">
        <select
          id="circ-arm" aria-describedby="circ-arm-note" value={arm}
          onChange={(e) => setArm(e.target.value)} style={select}
        >
          {arms.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
      </Control>

      <Control id="circ-adjust" label="Correction">
        <select
          id="circ-adjust" aria-describedby="circ-adjust-note" value={adjust}
          onChange={(e) => setAdjust(e.target.value as AdjustMethod)} style={select}
        >
          {ADJUST_METHODS.map((m) => <option key={m} value={m}>{ADJUSTMENT_LABELS[m]}</option>)}
        </select>
      </Control>

      <Control
        id="circ-threshold"
        label={<>Threshold (<span style={{ textTransform: 'none', fontFamily: FONT_MONO, letterSpacing: 0 }}>{qLabel}</span>)</>}
      >
        <select
          id="circ-threshold" aria-describedby="circ-threshold-note" value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          style={{ ...select, fontFamily: FONT_MONO }}
        >
          {SIG_LEVELS.map((s) => <option key={s} value={s}>{`${qLabel} < ${s}`}</option>)}
        </select>
      </Control>

      {/* The summary keeps the right-hand end of the strip. It wraps onto its own
          line before it squeezes, and takes a full row on a narrow screen. */}
      <div style={narrow
        ? { gridColumn: '1 / -1', minWidth: 0 }
        : { marginLeft: 'auto', flex: '0 1 auto', minWidth: 'min(100%, 180px)', maxWidth: '100%' }}
      >
        {summary}
      </div>

      <details style={{ ...fullRow, minWidth: 0 }}>
        <summary style={{
          fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', width: 'fit-content',
        }}>
          About these settings
        </summary>
        <div style={{
          display: 'grid', gap: 'var(--sp-1)', marginTop: 'var(--sp-1)', maxWidth: '80ch',
          fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)',
        }}>
          <Note id="circ-method-note" term={RHYTHM_METHOD_LABELS[method]}>{METHOD_NOTES[method]}</Note>
          <Note id="circ-period-note" term={periodMode === 'scan' ? 'Period scan' : 'Fixed 24 h period'}>{periodNote}</Note>
          <Note id="circ-arm-note" term={`Arm: ${armLabel}`}>{ARM_NOTE}</Note>
          <Note id="circ-adjust-note" term={ADJUSTMENT_LABELS[adjust]}>{ADJUSTMENT_NOTES[adjust]}</Note>
          <Note id="circ-threshold-note" term={<>Threshold, <span style={{ fontFamily: FONT_MONO }}>{qLabel} &lt; {threshold}</span></>}>
            {THRESHOLD_NOTE}
          </Note>
        </div>
      </details>
    </div>
  );
}

const selectStyle: CSSProperties = {
  padding: '3px 6px', fontSize: 12, fontFamily: FONT_SANS, border: '1px solid var(--border-dark)',
  borderRadius: 4, background: 'var(--bg-panel)', color: 'var(--text-primary)', maxWidth: 210,
};

/** Form-control label: quieter than content, one step above the 10px section eyebrow. */
const labelStyle: CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.06em',
};

/**
 * One labelled control in the settings strip.
 *
 * The label is bound to its input by `htmlFor`/`id` rather than by wrapping it,
 * because the input arrives as `children` — a wrapping label would associate
 * with nothing a screen reader (or a linter) can see. Every caller passes the
 * same id to both halves.
 */
function Control({
  id, label, children,
}: { id: string; label: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

/** One explanatory note, referenced by its select's aria-describedby. */
function Note({ id, term, children }: { id: string; term: ReactNode; children: ReactNode }) {
  return (
    <p id={id} style={{ margin: 0 }}>
      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{term}.</span> {children}
    </p>
  );
}
