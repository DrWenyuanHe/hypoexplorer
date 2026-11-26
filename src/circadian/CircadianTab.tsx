// The Circadian tab: rhythm detection over a dataset's time course.
//
// Shape of the screen, top to bottom:
//   controls   the four choices that define the analysis — test, period, arm,
//              multiple-testing correction — laid out in that order because each
//              one narrows the meaning of the one after it. The right of the
//              strip carries the rhythmic count for every arm.
//   figure     the selected gene's trace with its statistics in every arm, plus
//              the phase map of everything that passed in the selected arm. One
//              gene and the whole transcriptome, side by side.
//   table      every gene the test scored, sortable, searchable, downloadable.
//
// This file owns the state, loading, scans, selection and figures. The settings
// strip (CircadianControls), the explanatory notes (CircadianNotes), the
// per-arm statistics under the trace (ArmStatsStrip) and the results table with
// its exports (CircadianResultsTable) live in their own files.
//
// The scan runs in the browser rather than being precomputed at build time, and
// that is the design decision the rest of the module hangs off. Precomputed
// results would be one method, one period and one correction, chosen by whoever
// ran the generator; here the user picks, and picking again is a re-scan of a
// few hundred milliseconds. What ships in the bundle is the DATA, not one
// analyst's reading of it.
//
// Every arm is scanned under the same settings, the selected arm first, so the
// counts and the per-arm statistics compare like with like. Each arm's
// gene-wise correction runs over that arm's own scored genes.
//
// Scan progress is read from an external store by the progress bar alone
// (useScanProgress), so the per-chunk updates of a background arm never
// re-render the finished results table; the table is memoized on stable props.

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../common/EmptyState';
import { ProgressBar } from '../common/ProgressBar';
import { FONT_MONO, FONT_SANS } from '../styles/constants';
import type { Dataset, TimeSeriesBundle } from '../types';
import { type ArmStat, ArmStatsStrip } from './ArmStatsStrip';
import { CircadianControls, type PeriodMode } from './CircadianControls';
import {
  type ArmCount, CHANCE_EXPECTATION_ID, DesignCaveats, MethodFootnote, NoRhythmicGenes, librariesPerTimepoint,
} from './CircadianNotes';
import { CircadianResultsTable } from './CircadianResultsTable';
import { PhaseMap } from './PhaseMap';
import { hasEstimablePeak } from './peak';
import { RhythmTrace } from './RhythmTrace';
import { adjustedColumnLabel, type AdjustMethod } from './multipleTesting';
import {
  DEFAULT_PERIODS, RHYTHM_METHOD_LABELS, SCAN_PERIODS,
  type RhythmMethod, type RhythmResult, runRhythmicity,
} from './rhythmicity';
import { type RhythmRow, type ScanProgressStore, type ScanState, useArmScans, useScanProgress } from './scan';
import { ALL_ARMS, armChoices, loadTimeSeries, seriesFor } from './timeSeriesSource';
import type { ExportContext } from './circadianExport';
import { type JtkSupport, jtkSupport } from './jtkCycle';
import { armLombScargleFloor } from './lombScargleFloor';
import { isRhythmic } from './rhythmCall';

export interface CircadianTabProps {
  dataset: Dataset;
  trackId: string;
  /** Gene to open on, if the user arrived from another tab. */
  initialGene?: string;
}

const visuallyHidden = {
  position: 'absolute', width: 1, height: 1, overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
} as const;

const textButton = {
  fontFamily: FONT_SANS, fontSize: 12, padding: '3px 10px', cursor: 'pointer',
  border: '1px solid var(--border-dark)', borderRadius: 4,
  background: 'var(--bg-panel)', color: 'var(--text-primary)',
} as const;

// The results table re-renders only when its own inputs change: not when a
// background arm starts, advances or finishes.
const ResultsTable = memo(CircadianResultsTable);
const NO_ROWS: RhythmRow[] = [];

/** Sampling times of one arm, or of every library for the pooled pseudo-arm. */
function armTimes(bundle: TimeSeriesBundle, arm: string): number[] {
  return bundle.meta.samples.filter((s) => arm === ALL_ARMS || s.arm === arm).map((s) => s.time);
}

/**
 * Why the selected gene has no test in an arm, from that gene's own observed
 * (non-missing) times there: missing libraries can leave too few observations,
 * break JTK_CYCLE's regular grid, or drop periods the arm's schedule supports.
 */
function geneUnavailableReason(
  bundle: TimeSeriesBundle, gene: string, arm: string, method: RhythmMethod, periods: number[],
  armSupport: JtkSupport | undefined,
): string {
  const { times } = seriesFor(bundle, gene, arm);
  if (method === 'jtk') {
    const own = jtkSupport(times, periods);
    if (!own.supported && own.reason) return own.reason;
    return armSupport?.reason ?? 'JTK_CYCLE cannot test this sampling design.';
  }
  if (times.length < 4) return 'Fewer than four observations of this gene in this arm.';
  if (new Set(times).size < 3) return 'Fewer than three sampling times for this gene in this arm.';
  return `${RHYTHM_METHOD_LABELS[method]} could not fit this gene's observations in this arm.`;
}

export function CircadianTab({ dataset, trackId, initialGene }: CircadianTabProps) {
  const [bundle, setBundle] = useState<TimeSeriesBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [method, setMethod] = useState<RhythmMethod>('jtk');
  const [periodMode, setPeriodMode] = useState<PeriodMode>('fixed24');
  const [arm, setArm] = useState<string>('');
  const [adjust, setAdjust] = useState<AdjustMethod>('bh');
  const [threshold, setThreshold] = useState<number>(0.05);
  // The selection belongs to the dataset, track and loaded bundle, not to the
  // test settings: changing the arm, test or period keeps the gene the user is
  // looking at. It falls back to the top gene only when the new scan did not
  // score it.
  const selectionScope = `${dataset.id}|${trackId}`;
  const [selection, setSelection] = useState<{
    scope: string; bundle: TimeSeriesBundle | null; gene: string | null;
  }>({ scope: selectionScope, bundle: null, gene: initialGene ?? null });
  const selected = selection.scope === selectionScope && selection.bundle === bundle
    ? selection.gene : null;
  const [doublePlot, setDoublePlot] = useState(false);

  // ── data ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let live = true;
    setBundle(null);
    setLoadError(null);
    loadTimeSeries(dataset, trackId)
      .then((b) => { if (live) { setBundle(b); if (!b) setLoadError('This track has no time-series data.'); } })
      .catch(() => { if (live) setLoadError('Could not load the time-series data.'); });
    return () => { live = false; };
  }, [dataset, trackId]);

  // Default the arm to the first one the moment a bundle arrives, and reset it
  // when the dataset changes — an arm key from another dataset would silently
  // scan nothing.
  useEffect(() => {
    if (bundle) setArm(bundle.meta.arms[0]?.key ?? ALL_ARMS);
  }, [bundle]);

  const periods = periodMode === 'scan' ? SCAN_PERIODS : DEFAULT_PERIODS;

  // Arms the counts and the per-arm statistics cover: every real arm, plus the
  // pooled pseudo-arm while it is the one selected.
  const countArms = useMemo(() => {
    if (!bundle || !arm) return [];
    const real = bundle.meta.arms.map((a) => a.key);
    return arm === ALL_ARMS ? [...real, ALL_ARMS] : real;
  }, [bundle, arm]);
  const arms = useMemo(() => (bundle ? armChoices(bundle) : []), [bundle]);
  const armLabelOf = useCallback((key: string) => arms.find((a) => a.key === key)?.label ?? key, [arms]);
  const armLabel = armLabelOf(arm);

  // JTK's supported design per arm; arms can differ in their sampling times.
  const jtkByArm = useMemo(() => {
    const out: Record<string, JtkSupport> = {};
    if (bundle) for (const a of countArms) out[a] = jtkSupport(armTimes(bundle, a), periods);
    return out;
  }, [bundle, countArms, periods]);
  const jtkDesign = jtkByArm[arm] ?? null;
  const jtkScanPeriods = useMemo(
    () => (bundle && arm ? jtkSupport(armTimes(bundle, arm), SCAN_PERIODS).periods : undefined),
    [bundle, arm],
  );
  const testable = useCallback(
    (a: string) => method !== 'jtk' || !!jtkByArm[a]?.supported,
    [method, jtkByArm],
  );

  // The selected arm first, so the table is never kept waiting by the others.
  const scanOrder = useMemo(
    () => (arm ? [arm, ...countArms.filter((a) => a !== arm)] : []).filter(testable),
    [arm, countArms, testable],
  );
  const scanSettings = useMemo(() => ({ method, periods }), [method, periods]);
  const scans = useArmScans(bundle, scanSettings, scanOrder, adjust);
  const total = bundle ? Object.keys(bundle.values).length : 0;
  const activeState: ScanState | undefined = scans.states[arm];
  const rows = activeState?.rows ?? NO_ROWS;
  const running = activeState?.running ?? false;
  const tested = activeState?.tested ?? 0;
  const jtkBlocked = method === 'jtk' && !!bundle && !!arm && !jtkDesign?.supported;
  // The active arm's scan finished and scored nothing. The selection is kept
  // (switching back to an arm that scored the gene shows it again) but not
  // drawn: a trace beside "no scorable genes" would read as this scan's result.
  const settled = !!activeState && !activeState.running;
  const scoredNothing = settled && rows.length === 0;
  const scoredGenes = useMemo(() => new Set(rows.map((r) => r.gene)), [rows]);
  // The gene on screen, derived during render. Once the selected arm's rows are
  // in (a finished scan, or an arm already scanned under these settings), it is
  // the selection if that arm scored it, else the gene the user arrived with,
  // else the strongest rhythm; a gene the arm did not score is never drawn, not
  // even for the one render before the effect below commits the fallback. While
  // the arm's scan is pending, the prior selection stays up, dimmed.
  const shown = scoredNothing ? null
    : settled
      ? (selected != null && scoredGenes.has(selected) ? selected
        : initialGene != null && scoredGenes.has(initialGene) ? initialGene : rows[0].gene)
      : selected;

  // ── derived ───────────────────────────────────────────────────────────────
  // Whether a row is rhythmic is rhythmCall.ts's rule, shared with the table's
  // emphasis and the per-arm verdicts.
  const rhythmic = useMemo(
    () => rows.filter((r) => isRhythmic(r, { adjust, threshold })),
    [rows, adjust, threshold],
  );
  // A gene can pass with no estimable peak (canonical JTK_CYCLE reports period 0
  // and peak 0 when every candidate's amplitude is zero). It counts as rhythmic
  // but has no place on the phase map; plotting it would put it at midnight.
  // Lomb–Scargle can likewise pass a gene whose cosine fit failed (period
  // reported, amplitude and peak 0). hasEstimablePeak excludes both.
  const phased = useMemo(() => rhythmic.filter(hasEstimablePeak), [rhythmic]);

  // Commit the gene derived above, so it stays selected when the arm, test or
  // period changes again. The render already shows it; this only records it.
  useEffect(() => {
    if (!settled || shown == null || !bundle) return;
    setSelection((cur) => (cur.scope === selectionScope && cur.bundle === bundle && cur.gene === shown
      ? cur : { scope: selectionScope, bundle, gene: shown }));
  }, [settled, shown, selectionScope, bundle]);

  // The selected gene's own test in every arm, computed directly rather than
  // read from the scans: the trace overlays every arm whether or not its scan
  // has finished, and these are the same single-gene tests the scans run.
  const fits = useMemo(() => {
    const out: Record<string, RhythmResult | null> = {};
    if (!bundle || !shown) return out;
    for (const a of countArms) {
      out[a] = testable(a) ? runRhythmicity(method, seriesFor(bundle, shown, a), { periods }) : null;
    }
    return out;
  }, [bundle, shown, method, periods, countArms, testable]);
  const traceFits = useMemo(() => {
    const out: Record<string, RhythmResult | null> = {};
    for (const a of bundle?.meta.arms ?? []) out[a.key] = fits[a.key] ?? null;
    return out;
  }, [bundle, fits]);

  const selectGene = useCallback(
    (gene: string) => setSelection({ scope: selectionScope, bundle, gene }),
    [selectionScope, bundle],
  );

  // Each arm's adjusted value for the selected gene, once that arm's scan is done.
  const selectedQ = useMemo(() => {
    const out: Record<string, number | null | undefined> = {};
    if (!shown) return out;
    for (const a of countArms) {
      const state = scans.states[a];
      out[a] = !state ? null : state.running ? undefined : (state.rows.find((r) => r.gene === shown)?.q ?? null);
    }
    return out;
  }, [scans.states, shown, countArms]);

  // Rhythmic counts per arm, cached per finished arm's rows: an arm finishing
  // (or the progress of another) does not recount the arms already done.
  // Keyed on the primitives: rows keep their identity when only the correction
  // or the threshold changes, so either must start a new cache.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new correction or threshold must start a new cache.
  const rhythmicCache = useMemo(() => new WeakMap<RhythmRow[], number>(), [adjust, threshold]);
  const armCounts: ArmCount[] = useMemo(() => countArms.map((a) => {
    const state = scans.states[a];
    const done = !!state && !state.running;
    let count: number | null = null;
    if (state && done) {
      count = rhythmicCache.get(state.rows) ?? null;
      if (count == null) {
        count = state.rows.reduce((n, r) => n + (isRhythmic(r, { adjust, threshold }) ? 1 : 0), 0);
        rhythmicCache.set(state.rows, count);
      }
    }
    const info = arms.find((x) => x.key === a);
    return {
      arm: a, label: info?.label ?? a, color: info?.color,
      rhythmic: count, tested: done ? state.tested : null, running: !!state?.running,
    };
  }), [countArms, scans.states, rhythmicCache, adjust, threshold, arms]);

  // Lomb–Scargle's floor for the selected arm, or null to state none. When one
  // may be stated is armLombScargleFloor's decision, not this view's.
  const lsFloor = useMemo(
    () => (bundle ? armLombScargleFloor({ method, state: activeState, bundle, arm, periods }) : null),
    [method, bundle, arm, activeState, periods],
  );

  const exportCtx: ExportContext | null = useMemo(() => (bundle ? {
    bundle, dataset, method, adjust, armLabel, periods,
    effectivePeriods: method === 'jtk' ? jtkDesign?.periods : periods,
    genesScored: tested,
  } : null), [bundle, dataset, method, adjust, armLabel, periods, jtkDesign, tested]);

  if (loadError) {
    return <EmptyState title="No time course for this track" hint={loadError} />;
  }
  if (!bundle || !exportCtx) {
    return (
      <div style={{ padding: 'var(--sp-4)' }}>
        <ProgressBar label="Loading time-series data" />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, fontFamily: FONT_SANS }}>
          Loading the time course…
        </div>
      </div>
    );
  }

  const armColor = arms.find((a) => a.key === arm)?.color;
  const qLabel = adjustedColumnLabel(adjust);
  const statLabel = method === 'cosinor' ? 'F' : method === 'jtk' ? '|τ|' : 'power';
  const unit = bundle.meta.timeUnit === 'h' ? '' : bundle.meta.timeUnit;

  const armStats: ArmStat[] = countArms.map((a) => {
    const fit = fits[a] ?? null;
    return {
      key: a, label: armLabelOf(a), color: arms.find((x) => x.key === a)?.color ?? '#6B7280',
      fit, q: selectedQ[a], selected: a === arm,
      periodFamily: method === 'jtk' ? (jtkByArm[a]?.periods ?? null) : periods,
      unavailable: fit || !shown ? null
        : geneUnavailableReason(bundle, shown, a, method, periods, jtkByArm[a]),
    };
  });
  const untested = method === 'jtk'
    ? `${RHYTHM_METHOD_LABELS.jtk} cannot test this sampling design in any arm.`
    : 'No arm was tested.';
  const unestimable = rhythmic.length - phased.length;

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 'var(--sp-3) var(--sp-4)', fontFamily: FONT_SANS }}>
      {/* ── design line ───────────────────────────────────────────────────── */}
      <div style={{
        fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 'var(--sp-3)',
      }}>
        <strong style={{ color: 'var(--text-primary)' }}>{bundle.meta.label}</strong> ·{' '}
        {dataset.timeSeries?.design}
      </div>

      {/* ── controls ──────────────────────────────────────────────────────── */}
      <CircadianControls
        method={method} setMethod={setMethod}
        periodMode={periodMode} setPeriodMode={setPeriodMode}
        arm={arm} setArm={setArm} arms={arms}
        adjust={adjust} setAdjust={setAdjust}
        threshold={threshold} setThreshold={setThreshold}
        qLabel={qLabel}
        effectivePeriods={method === 'jtk' ? jtkDesign?.periods : undefined}
        jtkScanPeriods={method === 'jtk' ? jtkScanPeriods : undefined}
        summary={(
          <ScanSummary
            counts={armCounts} activeArm={arm} qLabel={qLabel} threshold={threshold} total={total}
            executing={scans.executing} executingLabel={scans.executing ? armLabelOf(scans.executing) : null}
            progress={scans.progress} untested={untested}
            describedBy={adjust === 'none' && !running && tested > 0 ? CHANCE_EXPECTATION_ID : undefined}
          />
        )}
      />

      <DesignCaveats
        method={method} adjust={adjust} threshold={threshold} periodMode={periodMode}
        lsFloor={lsFloor} jtkDesign={jtkDesign}
        tested={tested} rhythmicCount={rhythmic.length} running={running}
        armCounts={armCounts} onSwitchMethod={setMethod}
      />

      {/* ── figures ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', marginBottom: 'var(--sp-3)' }}>
        <div style={{
          flex: '1 1 520px', minWidth: 0, background: 'var(--bg-panel)',
          border: '1px solid var(--border)', borderRadius: 4, padding: 'var(--sp-2)',
        }}>
          {jtkBlocked ? (
            <EmptyState
              title={`${RHYTHM_METHOD_LABELS.jtk} cannot test ${armLabel}`}
              hint={jtkDesign?.reason ?? 'JTK_CYCLE is unavailable for this sampling design.'}
              action={(
                <button type="button" style={textButton} onClick={() => setMethod('cosinor')}>
                  Use {RHYTHM_METHOD_LABELS.cosinor} instead
                </button>
              )}
            />
          ) : shown ? (
            <>
              <div style={{ position: 'relative' }}>
                {running && (
                  <div style={{
                    position: 'absolute', top: 4, right: 8, fontSize: 11, color: 'var(--text-muted)',
                    fontFamily: FONT_SANS, zIndex: 1,
                  }}>
                    Rescanning…
                  </div>
                )}
                <div
                  data-testid="circadian-figure"
                  aria-busy={running || undefined}
                  style={{ opacity: running ? 0.5 : 1, transition: 'opacity 120ms ease' }}
                >
                  <RhythmTrace bundle={bundle} gene={shown} fits={traceFits} doublePlot={doublePlot} />
                </div>
              </div>
              <div style={{
                display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap',
                fontSize: 11, color: 'var(--text-muted)', paddingLeft: 6,
              }}>
                <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="checkbox" checked={doublePlot} onChange={(e) => setDoublePlot(e.target.checked)}
                    style={{ accentColor: 'var(--text-primary)' }}
                  />
                  Double-plot
                </label>
                <span>Dashed line: fitted cosine. Bars: mean ± SEM. Dots: individual libraries.</span>
              </div>
              <ArmStatsStrip
                gene={shown} arms={armStats} adjust={adjust} qLabel={qLabel}
                threshold={threshold} unit={unit}
              />
            </>
          ) : scoredNothing ? (
            <EmptyState title="No scorable genes" hint={`The ${RHYTHM_METHOD_LABELS[method]} scan scored no gene in ${armLabel}.`} />
          ) : (
            <EmptyState title={`Scanning ${armLabel}`} hint="The strongest rhythm opens here when the scan finishes." />
          )}
        </div>

        <div style={{
          flex: '0 1 300px', minWidth: 0, background: 'var(--bg-panel)', border: '1px solid var(--border)',
          borderRadius: 4, padding: 'var(--sp-2)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>
            Phase map
          </div>
          {jtkBlocked ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 'var(--sp-3) 0', lineHeight: 1.5 }}>
              No phase map: {RHYTHM_METHOD_LABELS.jtk} did not test {armLabel}.
            </div>
          ) : rhythmic.length ? (
            <>
              {phased.length > 0 && (
                <PhaseMap
                  acrophases={phased.map((r) => r.acrophase)}
                  cycleHours={bundle.meta.cycleHours}
                  timeUnit={bundle.meta.timeUnit}
                  color={armColor}
                />
              )}
              <div data-testid="phase-map-caption" style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 6 }}>
                {unestimable === 0 ? (
                  <>
                    Peak times of the <span style={{ fontFamily: FONT_MONO }}>{phased.length.toLocaleString()}</span> genes
                    passing <span style={{ fontFamily: FONT_MONO }}>{qLabel} &lt; {threshold}</span> in {armLabel}.
                  </>
                ) : phased.length > 0 ? (
                  <>
                    Peak times of the <span style={{ fontFamily: FONT_MONO }}>{phased.length.toLocaleString()}</span> of{' '}
                    <span style={{ fontFamily: FONT_MONO }}>{rhythmic.length.toLocaleString()}</span> genes
                    passing <span style={{ fontFamily: FONT_MONO }}>{qLabel} &lt; {threshold}</span> in {armLabel} that
                    have an estimable peak. The other <span style={{ fontFamily: FONT_MONO }}>{unestimable.toLocaleString()}</span>{' '}
                    {unestimable === 1 ? 'has' : 'have'} no estimable peak time and {unestimable === 1 ? 'is' : 'are'} not plotted.
                  </>
                ) : (
                  <>
                    None of the <span style={{ fontFamily: FONT_MONO }}>{rhythmic.length.toLocaleString()}</span>{' '}
                    {rhythmic.length === 1 ? 'gene' : 'genes'} passing{' '}
                    <span style={{ fontFamily: FONT_MONO }}>{qLabel} &lt; {threshold}</span> in {armLabel} has an
                    estimable peak time, so there is nothing to plot.
                  </>
                )}
                {phased.length > 0 && (bundle.meta.timeUnit === 'ZT' ? ' Shaded half is the dark phase.' : ' Shaded half is subjective night.')}
              </div>
            </>
          ) : (
            <NoRhythmicGenes
              running={running} qLabel={qLabel} threshold={threshold} armLabel={armLabel}
              adjust={adjust} method={method} arm={arm} armCounts={armCounts} executing={scans.executing}
              perTimepoint={librariesPerTimepoint(armTimes(bundle, arm))}
              onLoosenThreshold={setThreshold} onSwitchMethod={setMethod}
            />
          )}
        </div>
      </div>

      {/* ── table ─────────────────────────────────────────────────────────── */}
      {/* Hidden, not unmounted, while JTK_CYCLE cannot test the arm: the figure
          area explains why and offers COSINOR, and the table's filter and sort
          are still there when the user takes that offer. */}
      <div hidden={jtkBlocked || undefined} data-testid="circadian-results">
        <ResultsTable
          bundle={bundle} dataset={dataset} rows={rows}
          running={running} total={total}
          selected={shown} onSelect={selectGene}
          threshold={threshold} adjust={adjust} qLabel={qLabel}
          periodMode={periodMode} statLabel={statLabel} unit={unit} exportCtx={exportCtx}
        />
      </div>

      <MethodFootnote method={method} />
    </div>
  );
}

interface ScanSummaryProps {
  counts: ArmCount[];
  activeArm: string;
  qLabel: string;
  threshold: number;
  total: number;
  /** Key of the arm whose scan is executing now; null when none is. */
  executing: string | null;
  executingLabel: string | null;
  progress: ScanProgressStore;
  /** Terminal text when no arm is scanning, queued or finished. */
  untested: string;
  describedBy?: string;
}

/** The scan's progress bar: the only component that re-renders per chunk. */
function ScanProgress({ store, label }: { store: ScanProgressStore; label: string }) {
  const value = useScanProgress(store);
  return <ProgressBar value={value} label={`Scanning ${label} for rhythms`} width={120} />;
}

/**
 * The rhythmic count for every arm, in one line: "50 Chow · 0 High-fat diet".
 *
 * The counts sit in a polite live region whose text changes only when a scan
 * starts or finishes (or the threshold changes), so a screen reader hears each
 * finished count once. The progress bar is outside it: its every step would
 * otherwise be read aloud. It is the tab's one progress indicator, and it names
 * the arm being scanned now, never one queued behind it.
 */
function ScanSummary({
  counts, activeArm, qLabel, threshold, total, executing, executingLabel, progress, untested, describedBy,
}: ScanSummaryProps) {
  const finished = counts.filter((c) => c.tested != null);
  const pending = counts.some((c) => c.running);
  const testedValues = [...new Set(finished.map((c) => c.tested as number))];
  const testedText = testedValues.length === 1
    ? testedValues[0].toLocaleString()
    : finished.map((c) => (c.tested as number).toLocaleString()).join(' / ');

  return (
    <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'right', minWidth: 0, maxWidth: '100%' }}>
      {executing && executingLabel && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 11 }}>Scanning {executingLabel}</span>
          <ScanProgress store={progress} label={executingLabel} />
        </div>
      )}
      <div aria-live="polite" aria-atomic="true" aria-describedby={describedBy} data-testid="circadian-counts">
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'baseline', columnGap: 8 }}>
          {counts.map((c, i) => (
            <span key={c.arm} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
              {i > 0 && <span aria-hidden="true">·</span>}
              {c.color && (
                <span aria-hidden="true" style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: c.color,
                  alignSelf: 'center',
                }} />
              )}
              <span style={{
                fontFamily: FONT_MONO, fontSize: c.arm === activeArm ? 15 : 13,
                fontWeight: c.arm === activeArm ? 600 : 400, color: 'var(--text-primary)',
              }}>
                {c.running
                  ? <><span aria-hidden="true">…</span><span style={visuallyHidden}>{c.arm === executing ? 'scanning' : 'queued'}</span></>
                  : c.rhythmic == null ? <><span aria-hidden="true">—</span><span style={visuallyHidden}>not tested</span></>
                  : c.rhythmic.toLocaleString()}
              </span>
              <span style={{ color: c.arm === activeArm ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                {c.label}
              </span>
            </span>
          ))}
        </div>
        <div>
          {finished.length
            ? <>rhythmic at <span style={{ fontFamily: FONT_MONO }}>{qLabel} &lt; {threshold}</span> of{' '}
              <span style={{ fontFamily: FONT_MONO }}>{testedText}</span> tested</>
            : pending
              ? <>Scanning <span style={{ fontFamily: FONT_MONO }}>{total.toLocaleString()}</span> {total === 1 ? 'gene' : 'genes'}</>
              : untested}
        </div>
      </div>
    </div>
  );
}
