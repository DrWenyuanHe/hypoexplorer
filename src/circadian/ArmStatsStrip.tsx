// The selected gene's rhythm statistics in every arm, one row per arm, under
// the trace.
//
// The trace overlays every arm, so the numbers beside it must too: a p-value
// for one arm under a figure of two reads as a statement about both. Each row
// is that arm's own single-gene test under the current settings. Its adjusted
// value comes from that arm's own gene-wise correction, across the genes that
// arm's scan scored, so it is shown only once that scan has finished. The
// verdict is spelled out in words, so it never rests on colour alone.
//
// The candidate periods are gene-specific. A missing value can leave a gene
// fewer sampling times in one arm than the design has, and then fewer periods
// can be tested for it there (on a 4 h grid, dropping the last time point takes
// a JTK_CYCLE family from 20 and 24 h down to 20 h). The period cell therefore
// lists the periods actually tested for this gene in that arm whenever there
// was a choice, and names any period of the arm's family it could not test.
//
// Each statistic follows its own rule, shared with the results table (see
// CircadianResultsTable): the peak time needs an estimable peak (peak.ts); the
// amplitude is shown whenever it is finite, so canonical JTK_CYCLE's
// Hodges–Lehmann estimate of 0 reads 0; the period is shown whenever it is
// positive, so a failed Lomb–Scargle cosine fit still reports the period its
// periodogram picked by maximum power. Canonical JTK_CYCLE's period 0 (zero
// amplitude) has no estimable period. The periods a gene was tested at are
// still listed then, since without a winning period the dash alone would hide
// the family the p-value covers.

import { fmtP } from '../utils/format';
import { FONT_MONO, FONT_SANS } from '../styles/constants';
import {
  AmplitudeValue, FALLBACK_AMPLITUDE_NOTE, NoPeakMark, hasReportedPeriod, isFallbackAmplitude,
} from './CircadianResultsTable';
import type { AdjustMethod } from './multipleTesting';
import { hasEstimablePeak } from './peak';
import { armVerdict } from './rhythmCall';
import type { RhythmResult } from './rhythmicity';

/** One arm's row: the single-gene fit and, once its scan is done, its adjusted value. */
export interface ArmStat {
  key: string;
  label: string;
  color: string;
  /** This gene's test in this arm under the current settings; null when the series cannot be tested. */
  fit: RhythmResult | null;
  /**
   * The gene-wise adjusted value from this arm's scan. `undefined` while that
   * scan is still running; null when the scan did not score this gene.
   */
  q: number | null | undefined;
  /** The arm chosen in the settings: the one the table, counts and phase map describe. */
  selected: boolean;
  /**
   * Why this gene has no test in this arm, in words (for example a design
   * JTK_CYCLE cannot test, or too few non-missing values). Shown in place of
   * the verdict.
   */
  unavailable?: string | null;
  /**
   * The candidate periods this method tests in this arm under the current
   * settings (for JTK_CYCLE, the arm's effective family). Optional: without it,
   * a gene's periods are compared with the widest set any arm tested for it.
   */
  periodFamily?: readonly number[] | null;
}

export interface ArmStatsStripProps {
  gene: string;
  arms: ArmStat[];
  adjust: AdjustMethod;
  /** Column label for the adjusted value: 'q', or 'p' when uncorrected. */
  qLabel: string;
  threshold: number;
  /** Time-axis prefix for peak times ('' for elapsed hours). */
  unit: string;
}

/** "24", "23.5": hours to at most two decimals, no trailing zeros. */
function fmtHours(t: number): string {
  return String(Number(t.toFixed(2)));
}

const PERIOD_EPS = 1e-9;
const hasPeriod = (set: readonly number[], p: number) => set.some((q) => Math.abs(q - p) < PERIOD_EPS);
function sortedUnique(periods: Iterable<number>): number[] {
  const out: number[] = [];
  for (const p of periods) if (Number.isFinite(p) && !hasPeriod(out, p)) out.push(p);
  return out.sort((a, b) => a - b);
}

/** The periods tested for one gene in one arm, against the family that arm offered. */
export interface PeriodSupport {
  /** Candidate periods tested for this gene, ascending. */
  tested: number[];
  /** Periods of the arm's family this gene could not be tested at, ascending. */
  untested: number[];
}

/**
 * What the period cell must disclose beyond the winning period, or null when
 * the gene was tested at a single period that is the arm's whole family (a
 * fixed period, or a family of one) and the winning period already names it.
 *
 * `noWinner` marks a fit with no estimable period: nothing else in the cell
 * names what was tested, so the tested periods are disclosed even when they
 * are a single period equal to the arm's family.
 */
export function periodSupport(
  tested: readonly number[] | undefined, family: readonly number[], noWinner = false,
): PeriodSupport | null {
  if (!tested?.length) return null;
  const t = sortedUnique(tested);
  const untested = sortedUnique(family).filter((p) => !hasPeriod(t, p));
  if (!noWinner && t.length === 1 && untested.length === 0) return null;
  return { tested: t, untested };
}

/**
 * The tested-period list inside the bracket: "of 20, 24" beside a winning
 * period, "tested 20" when there is none; empty when a winning period is the
 * only one tested.
 */
function testedText(sup: PeriodSupport, hasWinner: boolean): string {
  const list = sup.tested.map(fmtHours).join(', ');
  if (!hasWinner) return `tested ${list}`;
  return sup.tested.length > 1 ? `of ${list}` : '';
}

function untestedText(sup: PeriodSupport): string {
  return sup.untested.length ? `${sup.untested.map(fmtHours).join(', ')} not testable` : '';
}

const cell = {
  padding: '3px 8px', fontFamily: FONT_MONO, fontSize: 12, textAlign: 'right' as const,
  whiteSpace: 'nowrap' as const, color: 'var(--text-primary)',
};
const head = {
  padding: '3px 8px', fontFamily: FONT_SANS, fontSize: 11, fontWeight: 600, textAlign: 'right' as const,
  whiteSpace: 'nowrap' as const, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)',
};

export function ArmStatsStrip({ gene, arms, adjust, qLabel, threshold, unit }: ArmStatsStripProps) {
  const showQ = adjust !== 'none';
  const pending = arms.filter((a) => a.fit && a.q === undefined && showQ);
  // Without an arm-level family, the widest set any arm tested for this gene.
  const widest = sortedUnique(arms.flatMap((a) => a.fit?.periodsTested ?? []));
  // The tested family is disclosed whether or not a winning period is estimable.
  const support = new Map(arms.map((a) => [
    a.key,
    a.fit ? periodSupport(a.fit.periodsTested, a.periodFamily ?? widest, !hasReportedPeriod(a.fit)) : null,
  ]));
  const anySupport = [...support.values()].some((s) => s !== null);
  const narrowed = arms.filter((a) => (support.get(a.key)?.untested.length ?? 0) > 0);
  const peakless = arms.filter((a) => a.fit && !hasEstimablePeak(a.fit));
  const periodless = arms.filter((a) => a.fit && !hasReportedPeriod(a.fit));
  const fallback = arms.filter((a) => a.fit && isFallbackAmplitude(a.fit));
  // Lomb–Scargle's period is the candidate with the most periodogram power.
  const maxPower = arms.some((a) => a.fit?.method === 'ls');
  const names = (list: ArmStat[]) => list.map((a) => a.label).join(' and ');
  return (
    <div style={{ marginTop: 'var(--sp-2)', fontFamily: FONT_SANS }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
          <caption style={{
            textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', padding: '0 8px 4px', captionSide: 'top',
          }}>
            <span style={{ fontFamily: FONT_MONO, color: 'var(--text-primary)' }}>{gene}</span> in each arm
          </caption>
          <thead>
            <tr>
              <th scope="col" style={{ ...head, textAlign: 'left' }}>Arm</th>
              <th scope="col" style={head}>p</th>
              {showQ && <th scope="col" style={head}>{qLabel}</th>}
              <th scope="col" style={head}>{maxPower ? 'period (h, max power)' : 'period (h)'}</th>
              <th scope="col" style={head}>peak ({unit || 'h'})</th>
              <th scope="col" style={head}>amplitude</th>
              <th scope="col" style={{ ...head, textAlign: 'left' }}>at {qLabel} &lt; {threshold}</th>
            </tr>
          </thead>
          <tbody>
            {arms.map((a) => {
              const verdict = armVerdict(a.fit, a.q, { adjust, threshold });
              const rhythmic = verdict === 'rhythmic';
              const fit = a.fit;
              const estimable = hasEstimablePeak(fit);
              const hasPeriodValue = !!fit && hasReportedPeriod(fit);
              const sup = support.get(a.key) ?? null;
              const reason = verdict === 'not tested'
                ? (a.unavailable || (fit ? 'not scored by this arm\'s scan' : 'not tested'))
                : null;
              return (
                <tr key={a.key} data-arm={a.key} aria-current={a.selected ? 'true' : undefined}>
                  <th scope="row" style={{
                    ...cell, fontFamily: FONT_SANS, textAlign: 'left', fontWeight: a.selected ? 600 : 400,
                  }}>
                    <span aria-hidden="true" style={{
                      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                      background: a.color, marginRight: 6, verticalAlign: 'middle',
                    }} />
                    {a.label}
                    {a.selected && (
                      <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>
                        selected arm
                      </span>
                    )}
                  </th>
                  <td style={cell}>{fit ? fmtP(fit.p) : '—'}</td>
                  {showQ && (
                    <td style={cell} title={a.q === undefined && fit ? 'Shown when this arm\'s scan finishes' : undefined}>
                      {fit && a.q != null ? fmtP(a.q) : '—'}
                    </td>
                  )}
                  <td style={cell}>
                    {hasPeriodValue ? fmtHours(fit.period) : fit ? <NoPeakMark label="no estimable period" /> : '—'}
                    {sup && (
                      <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
                        ({[testedText(sup, hasPeriodValue), untestedText(sup)].filter(Boolean).join('; ')})
                      </span>
                    )}
                  </td>
                  <td style={cell}>
                    {fit && estimable && rhythmic ? fit.acrophase.toFixed(1) : fit && !estimable ? <NoPeakMark /> : '—'}
                    {estimable && verdict === 'not rhythmic' && (
                      <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>n.s.</span>
                    )}
                  </td>
                  <td style={cell} title={fit && isFallbackAmplitude(fit) ? `Amplitude ${FALLBACK_AMPLITUDE_NOTE}` : undefined}>
                    {fit ? <AmplitudeValue fit={fit} /> : '—'}
                  </td>
                  <td style={{
                    ...cell, fontFamily: FONT_SANS, textAlign: 'left',
                    fontWeight: rhythmic ? 600 : 400,
                    color: rhythmic ? 'var(--text-primary)' : 'var(--text-muted)',
                    // A reason is a sentence; let it wrap rather than widen the strip.
                    ...(reason ? { whiteSpace: 'normal' as const, minWidth: 160, maxWidth: 320 } : null),
                  }}>
                    {verdict === 'pending' ? 'awaiting scan' : reason ?? verdict}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, padding: '4px 8px 0' }}>
        p includes the within-gene correction for the periods (and, for JTK_CYCLE, phases) searched.
        {showQ
          ? ` ${qLabel} is each arm's own gene-wise adjustment across the genes that arm's scan scored.`
          : ' No gene-wise correction is applied, so the verdict uses raw p.'}
        {anySupport && ' Brackets beside the period list the candidate periods tested for this gene in that arm.'}
        {maxPower && ' For Lomb–Scargle, the period is the candidate period with the most periodogram power.'}
        {peakless.length > 0 && ` In ${names(peakless)}, the fit has no estimable peak (zero rhythm amplitude, or a failed cosine fit), so no peak time is reported; p still stands.`}
        {periodless.length > 0 && ` In ${names(periodless)}, no period is estimable (canonical JTK_CYCLE reports period 0 when its Hodges–Lehmann amplitude is zero).`}
        {fallback.length > 0 && ` In ${names(fallback)}, the cosine fit at that maximum-power period failed, so the amplitude is recorded as 0, not fitted.`}
        {narrowed.length > 0 && ` In ${narrowed.map((a) => a.label).join(' and ')}, this gene's non-missing time points do not support every period of the arm's family; the periods marked not testable were not tested, and p is corrected only for those that were.`}
        {' '}Peak is shown only for a rhythmic arm.
        {pending.length > 0 && ` ${qLabel} for ${pending.map((a) => a.label).join(' and ')} appears when that arm's scan finishes.`}
      </div>
    </div>
  );
}
