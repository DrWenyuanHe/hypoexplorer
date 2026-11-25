// Explanatory text around the Circadian tab's results: the design caveats
// (what the sampling design can and cannot support), the phase map's zero
// state and the method footnote under the table.
//
// Two registers, kept apart on purpose:
//   Note    informational context (which periods JTK tests, what an uncorrected
//           threshold lets through by chance). Quiet muted text, no fill.
//   Caveat  a genuine limit on what the results can show (a threshold the
//           design cannot reach, an unsupported design). A small amber
//           triangle and normal ink; amber never fills a box.
//
// The components take more context than they always render so that the call
// sites in CircadianTab need not change when the copy grows.

import type { ReactNode } from 'react';
import { COLOR_WARNING_FG, FONT_MONO, FONT_SANS } from '../styles/constants';
import { type PeriodMode, SIG_LEVELS } from './CircadianControls';
import type { JtkSupport } from './jtkCycle';
import type { LombScargleBound } from './lombScargleFloor';
import {
  ADJUSTMENT_SHORT_LABELS, type AdjustMethod, adjustedColumnLabel, thresholdReachability,
} from './multipleTesting';
import { RHYTHM_METHOD_LABELS, type RhythmMethod } from './rhythmicity';

/** Per-arm scan tally, for notes that compare arms. */
export interface ArmCount {
  arm: string;
  label: string;
  color?: string;
  rhythmic: number | null;
  tested: number | null;
  /** True until this arm's scan has finished: queued behind another arm, or executing. */
  running: boolean;
}

/**
 * id of the uncorrected-threshold note. The rhythmic count it describes can
 * point at it with aria-describedby; the note's text reads as a description of
 * that count.
 */
export const CHANCE_EXPECTATION_ID = 'circadian-chance-expectation';

/** A number, gene id or statistic inside running prose. */
function Num({ children }: { children: ReactNode }) {
  return <span style={{ fontFamily: FONT_MONO }}>{children}</span>;
}

const visuallyHidden = {
  position: 'absolute', width: 1, height: 1, overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
} as const;

const textButton = {
  fontFamily: FONT_SANS, fontSize: 11, padding: '2px 8px', cursor: 'pointer',
  border: '1px solid var(--border-dark)', borderRadius: 4,
  background: 'var(--bg-panel)', color: 'var(--text-primary)',
} as const;

/** Informational context: quiet muted text, no fill. */
export function Note({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <div id={id} role="note" style={{
      fontFamily: FONT_SANS, fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)',
      marginBottom: 'var(--sp-2)', maxWidth: 900,
    }}>
      {children}
    </div>
  );
}

function WarningTriangle() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"
      style={{ flex: '0 0 auto', marginTop: 3 }}>
      <path d="M6 1 L11.2 10.5 H0.8 Z" fill={COLOR_WARNING_FG} />
      <rect x="5.4" y="4.2" width="1.2" height="3.4" fill="#fff" />
      <rect x="5.4" y="8.3" width="1.2" height="1.2" fill="#fff" />
    </svg>
  );
}

/** A genuine limit on the results: small amber triangle, normal ink, no fill. */
export function Caveat({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div role="note" style={{
      display: 'flex', gap: 6, alignItems: 'flex-start',
      fontFamily: FONT_SANS, fontSize: 12, lineHeight: 1.5, color: 'var(--text-primary)',
      marginBottom: 'var(--sp-2)', maxWidth: 900,
    }}>
      <WarningTriangle />
      <div>
        <span style={visuallyHidden}>Caveat: </span>
        {children}
        {action && <> {action}</>}
      </div>
    </div>
  );
}

/** "≈ 732" for large expectations, "≈ 0.7" for small ones. */
export function formatExpected(x: number): string {
  if (x >= 10) return Math.round(x).toLocaleString();
  return x.toFixed(1);
}

/** Smallest and largest number of libraries at any one sampled time. */
export function librariesPerTimepoint(times: number[]): { min: number; max: number } | null {
  const counts = new Map<number, number>();
  for (const t of times) if (Number.isFinite(t)) counts.set(t, (counts.get(t) ?? 0) + 1);
  if (!counts.size) return null;
  const values = [...counts.values()];
  return { min: Math.min(...values), max: Math.max(...values) };
}

export interface DesignCaveatsProps {
  method: RhythmMethod;
  adjust: AdjustMethod;
  threshold: number;
  /**
   * The Lomb–Scargle floor the arm may state (armLombScargleFloor): the
   * smallest p any scored gene can reach and the series length that sets it.
   * Null when no floor may be stated (scan running, degenerate design): no
   * floor, impossibility or "0 expected" text is shown then.
   */
  lsFloor: LombScargleBound | null;
  jtkDesign: JtkSupport | null;
  tested: number;
  rhythmicCount: number;
  running: boolean;
  /**
   * Fixed 24 h or a period scan. Decides how the uncorrected benchmark is
   * qualified (one F test vs a within-gene Bonferroni across periods, one
   * Lomb–Scargle frequency vs the Horne–Baliunas count). When omitted the copy
   * covers both modes.
   */
  periodMode?: PeriodMode;
  armCounts?: ArmCount[];
  onSwitchMethod?: (method: RhythmMethod) => void;
}

/** A Lomb–Scargle floor the copy may state: present, finite and positive; else null. */
function statedFloor(lsFloor: LombScargleBound | null): LombScargleBound | null {
  return lsFloor && Number.isFinite(lsFloor.floor) && lsFloor.floor > 0 ? lsFloor : null;
}

/** What the design supports, and what an uncorrected threshold lets through. */
export function DesignCaveats({
  method, adjust, threshold, lsFloor, jtkDesign, tested, running, periodMode, onSwitchMethod,
}: DesignCaveatsProps) {
  const floor = statedFloor(lsFloor);
  return (
    <>
      {method === 'ls' && (
        <LombScargleFloor
          adjust={adjust} threshold={threshold} lsFloor={floor}
          tested={running ? 0 : tested} onSwitchMethod={onSwitchMethod}
        />
      )}
      {/* An unsupported JTK design is explained once, by the figure area's
          dedicated state (with its "Use COSINOR instead" action), not here too. */}
      {method === 'jtk' && jtkDesign?.supported && (
        <Note>
          On the full sampling schedule, JTK_CYCLE tests <Num>{jtkDesign.periods.join(', ')}</Num> h,
          the requested periods that the <Num>{jtkDesign.interval}</Num> h sampling interval and course
          length support, with phases in <Num>{(jtkDesign.interval ?? 0) / 2}</Num> h (half-interval)
          steps. Both are full-schedule values: for a gene with missing time points, the periods tested
          and the phase step can change. The selected gene’s tested periods are shown under the trace,
          and every gene’s are in the CandidatePeriodsHours export column.
        </Note>
      )}
      {adjust === 'none' && !running && tested > 0 && (
        <ChanceExpectation
          method={method} threshold={threshold} tested={tested} lsFloor={floor} periodMode={periodMode}
        />
      )}
    </>
  );
}

/** The F test's error assumptions, as a parenthetical. */
const F_ASSUMPTIONS = 'normal, independent errors with constant variance';

/**
 * How far the uniform-null benchmark can be trusted for this method and period
 * mode, as one or two sentences. Each claim is limited to what the test
 * guarantees:
 *   COSINOR, fixed 24 h   one F test per gene: uniform under its assumptions.
 *   COSINOR, scan         min p × periods tested (within-gene Bonferroni):
 *                         P(p < t) ≤ t under the same assumptions, so the
 *                         benchmark is an upper bound for null genes.
 *   JTK_CYCLE             discrete exact permutation null, then Bonferroni
 *                         across the gene's period × phase templates.
 *   Lomb–Scargle          approximate false-alarm value with a floor set by
 *                         series length; a scan charges the Horne–Baliunas
 *                         count of independent frequencies, a heuristic.
 */
function NullQualifier({ method, periodMode, floorKnown }: {
  method: RhythmMethod; periodMode?: PeriodMode; floorKnown: boolean;
}) {
  const rough = 'so treat this nominal figure as a rough guide, not an estimate of false positives.';
  if (method === 'cosinor') {
    const fixed = (
      <>With one fixed 24 h period, COSINOR’s F-test p-value is uniform under the null when the test’s
        assumptions hold ({F_ASSUMPTIONS}); outlying replicates or correlated errors make this nominal
        figure approximate.</>
    );
    const scan = (
      <>With a period scan, each gene’s COSINOR p-value is Bonferroni-corrected across its tested
        periods (a within-gene correction, separate from any gene-wise correction). Under the F test’s
        assumptions ({F_ASSUMPTIONS}) that makes null p-values conservative: a gene with no rhythm falls
        below the threshold with probability at most the threshold, so this nominal figure is an upper
        benchmark, not an estimate of false positives.</>
    );
    if (periodMode === 'fixed24') return fixed;
    if (periodMode === 'scan') return scan;
    return (
      <>For one fixed 24 h period, COSINOR’s F-test p-value is uniform under the null when the test’s
        assumptions hold ({F_ASSUMPTIONS}). A period scan Bonferroni-corrects each gene’s p-value across
        its tested periods (within-gene), which makes it conservative under the same assumptions. This
        nominal figure is not an estimate of false positives.</>
    );
  }
  if (method === 'jtk') {
    const templates = periodMode === 'fixed24'
      ? 'its phase templates at the fixed 24 h period'
      : 'its tested period × phase templates';
    return (
      <>Real null p-values here are not uniform: JTK_CYCLE’s exact permutation null is discrete, and
        each gene’s p-value is Bonferroni-corrected across {templates} (a within-gene correction), {rough}</>
    );
  }
  const frequencies = periodMode === 'fixed24'
    ? ' at the single 24 h period'
    : periodMode === 'scan'
      ? ', corrected across the scanned periods with the Horne–Baliunas count of independent frequencies (a heuristic)'
      : '; a period scan corrects it with the Horne–Baliunas count of independent frequencies (a heuristic)';
  const floor = floorKnown ? ', and it cannot fall below a floor set by the series length' : '';
  return (
    <>Real null p-values here are not uniform: the Lomb–Scargle false-alarm value is an
      approximation{frequencies}{floor}, {rough}</>
  );
}

interface ChanceExpectationProps {
  method: RhythmMethod;
  threshold: number;
  tested: number;
  /** A stated floor (statedFloor), or null. */
  lsFloor: LombScargleBound | null;
  periodMode?: PeriodMode;
}

/**
 * The uncorrected count a uniform null would produce, ≈ threshold × tested.
 * It is a nominal benchmark, qualified per method and period mode, and it is
 * replaced by 0 with its reason when the threshold is below the smallest p any
 * gene can reach, so it never contradicts the Lomb–Scargle caveat. That
 * replacement needs a known (finite, positive) floor; without one the nominal
 * benchmark stands and no floor is mentioned.
 *
 * Always rendered with CHANCE_EXPECTATION_ID while adjust is 'none', the scan
 * has finished and tested > 0, because the rhythmic count's aria-describedby
 * points at it under exactly that condition.
 */
function ChanceExpectation({ method, threshold, tested, lsFloor, periodMode }: ChanceExpectationProps) {
  const testedText = <Num>{tested.toLocaleString()}</Num>;
  const cut = <Num>p &lt; {threshold}</Num>;
  const floorKnown = lsFloor != null;
  if (method === 'ls' && lsFloor && !thresholdReachability(lsFloor.floor, tested, 'none', threshold).reachable) {
    return (
      <Note id={CHANCE_EXPECTATION_ID}>
        Expected by chance: <Num>0</Num> of {testedText} tested genes, because the smallest p any
        gene in this arm can reach with Lomb–Scargle (<Num>{lsFloor.floor.toExponential(1)}</Num>) is not
        below the <Num>{threshold}</Num> threshold.
      </Note>
    );
  }
  return (
    <Note id={CHANCE_EXPECTATION_ID}>
      Uncorrected benchmark: if no gene were rhythmic and null p-values were uniform,{' '}
      <Num>≈ {formatExpected(threshold * tested)}</Num> of {testedText} tested genes would fall
      below {cut}.{' '}
      <NullQualifier method={method} periodMode={periodMode} floorKnown={floorKnown} />
    </Note>
  );
}

interface LombScargleFloorProps {
  adjust: AdjustMethod;
  threshold: number;
  /** A stated floor (statedFloor), or null. */
  lsFloor: LombScargleBound | null;
  /** Genes in the correction family; 0 while the scan has not finished. */
  tested: number;
  onSwitchMethod?: (method: RhythmMethod) => void;
}

/**
 * Lomb–Scargle's p cannot fall below a floor set by the series length. Say
 * plainly when that floor, after the chosen correction, makes the threshold
 * unreachable or reachable only by many genes at once.
 *
 * `lsFloor.floor` is a common LOWER bound: the smallest floor over the per-gene
 * series lengths in this arm (genes with missing values have shorter series
 * and can have a higher floor). The copy therefore names it "the smallest p
 * any gene in this arm can reach", and claims impossibility only when even
 * that p cannot pass after the gene-wise correction across `tested` genes.
 */
function LombScargleFloor({ adjust, threshold, lsFloor, tested, onSwitchMethod }: LombScargleFloorProps) {
  if (!lsFloor) return null;
  const lsCeiling = lsFloor.floor;
  const label = adjustedColumnLabel(adjust);
  const floor = <Num>{lsCeiling.toExponential(1)}</Num>;
  const arm = <>in this arm (<Num>n = {lsFloor.n}</Num> libraries)</>;
  const switchButton = onSwitchMethod && (
    <button type="button" style={textButton} onClick={() => onSwitchMethod('cosinor')}>
      Switch to {RHYTHM_METHOD_LABELS.cosinor}
    </button>
  );
  const why = 'This is a limit of the series length, not evidence against rhythmicity.';
  const testedText = <Num>{tested.toLocaleString()}</Num>;

  if (tested > 0) {
    const reach = thresholdReachability(lsCeiling, tested, adjust, threshold);
    if (!reach.reachable) {
      // BH's bound is the floor itself; BY, Holm and Bonferroni scale it with m.
      const scaled = adjust === 'by' || adjust === 'holm' || adjust === 'bonferroni';
      return (
        <Caveat action={switchButton}>
          No gene can reach <Num>{label} &lt; {threshold}</Num> with Lomb–Scargle {arm}. The smallest
          p any gene in this arm can reach is {floor}
          {scaled
            ? <>, and even that p is not below <Num>{threshold}</Num> after {ADJUSTMENT_SHORT_LABELS[adjust]}{' '}
                across {testedText} tested genes.</>
            : <>, which is not below <Num>{threshold}</Num>.</>}{' '}
          {why}
        </Caveat>
      );
    }
    if ((reach.minGenes ?? 1) > 1) {
      return (
        <Caveat action={switchButton}>
          With Lomb–Scargle {arm}, the smallest p any gene in this arm can reach is {floor}. After{' '}
          {ADJUSTMENT_SHORT_LABELS[adjust]} across {testedText} tested genes, a gene can reach{' '}
          <Num>{label} &lt; {threshold}</Num> only if at least{' '}
          <Num>{(reach.minGenes as number).toLocaleString()}</Num> genes pass together. {why}
        </Caveat>
      );
    }
  }
  if (lsCeiling <= 0.001) return null;
  return (
    <Note>
      With Lomb–Scargle {arm}, the smallest p any gene in this arm can reach is {floor}: the data's
      variance bounds the normalized periodogram. A p-value at this limit does not indicate a weak rhythm.
    </Note>
  );
}

export interface NoRhythmicGenesProps {
  running: boolean;
  qLabel: string;
  threshold: number;
  armLabel: string;
  adjust: AdjustMethod;
  method: RhythmMethod;
  /** Key of the arm being shown; used to leave it out of the other-arm counts. */
  arm?: string;
  armCounts?: ArmCount[];
  /**
   * Key of the arm whose scan is executing now; null when none is. Unfinished
   * arms (ArmCount.running) other than this one are queued. When omitted, which
   * unfinished arm is executing is unknown and they are described as pending.
   */
  executing?: string | null;
  /** Libraries per sampled time in this arm (see librariesPerTimepoint). */
  perTimepoint?: { min: number; max: number } | null;
  onLoosenThreshold?: (next: number) => void;
  onSwitchMethod?: (method: RhythmMethod) => void;
}

/** How an unfinished arm is described: only the executing arm is "scanning". */
function unfinishedLabel(arm: string, executing: string | null | undefined): string {
  if (executing === undefined) return 'pending';
  return arm === executing ? 'scanning…' : 'queued';
}

/** The phase map's zero state: scanning, queued, or no gene passed the threshold. */
export function NoRhythmicGenes({
  running, qLabel, threshold, armLabel, arm, armCounts, executing, perTimepoint, onLoosenThreshold,
}: NoRhythmicGenesProps) {
  const style = {
    fontFamily: FONT_SANS, fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)',
    padding: 'var(--sp-3) 0',
  } as const;
  if (running) {
    // The shown arm is unfinished. Say "Scanning…" only when it is the one
    // executing (or when that is unknown, as before the prop existed).
    const queued = executing !== undefined && (arm == null || executing !== arm);
    if (!queued) return <div role="status" style={style}>Scanning…</div>;
    const now = executing != null ? armCounts?.find((a) => a.arm === executing)?.label : undefined;
    return (
      <div role="status" style={style}>
        {executing == null
          ? <>Queued: the {armLabel} scan has not started yet.</>
          : <>Queued: {armLabel} is scanned after {now ?? 'the arm scanning now'} finishes.</>}
      </div>
    );
  }

  const others = (armCounts ?? []).filter((a) => (arm != null ? a.arm !== arm : a.label !== armLabel));
  const looser = SIG_LEVELS.find((s) => s > threshold);
  const lowRep = perTimepoint && perTimepoint.max <= 3;
  const reps = perTimepoint
    ? perTimepoint.min === perTimepoint.max ? `${perTimepoint.min}` : `${perTimepoint.min}–${perTimepoint.max}`
    : '';

  return (
    <div style={style}>
      <div role="status" style={{ color: 'var(--text-primary)' }}>
        No gene reaches <Num>{qLabel} &lt; {threshold}</Num> in {armLabel}.
      </div>
      {others.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0 }}>
          {others.map((a) => (
            <li key={a.arm} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {a.color && (
                <span aria-hidden="true" style={{
                  width: 8, height: 8, borderRadius: '50%', background: a.color, flex: '0 0 auto',
                }} />
              )}
              <span>
                {a.label}:{' '}
                {a.running ? unfinishedLabel(a.arm, executing)
                  : a.rhythmic == null ? 'not scanned'
                    : <><Num>{a.rhythmic.toLocaleString()}</Num> at the same settings</>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {lowRep && (
        <div style={{ marginTop: 6 }}>
          With <Num>{reps}</Num> {perTimepoint.max === 1 ? 'library' : 'libraries'} per timepoint,
          low-amplitude rhythms are hard to detect; a zero count is not evidence of no rhythm.
        </div>
      )}
      {looser != null && onLoosenThreshold && (
        <button type="button" style={{ ...textButton, marginTop: 8 }} onClick={() => onLoosenThreshold(looser)}>
          Show <span style={{ fontFamily: FONT_MONO }}>{qLabel} &lt; {looser}</span>
        </button>
      )}
    </div>
  );
}

export interface MethodFootnoteProps {
  method: RhythmMethod;
}

/** Where the statistics come from, under the results table. */
export function MethodFootnote({ method }: MethodFootnoteProps) {
  return (
    <div style={{
      fontFamily: FONT_SANS, fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5, maxWidth: 900,
    }}>
      Your browser computes rhythm statistics from this dataset's per-library values using the
      settings above.
      {method === 'jtk' && (
        <>
          {' '}JTK_CYCLE uses its canonical Hodges–Lehmann amplitude estimator; the displayed mesor is
          the Hodges–Lehmann location of the observations. Zero amplitude has no estimable period or
          peak. Results were benchmarked against MetaCycle <Num>1.2.1</Num>.
        </>
      )}
      {method === 'ls' && (
        <>
          {' '}Lomb–Scargle’s period is the candidate with the most periodogram power; peak time and
          amplitude come from a cosine fit at that period. Where that fit fails, the period still
          stands, the peak shows a dash and the amplitude is recorded as <Num>0</Num>, not fitted.
        </>
      )}
    </div>
  );
}
