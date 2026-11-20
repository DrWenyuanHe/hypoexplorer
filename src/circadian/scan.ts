// Whole-transcriptome rhythmicity scan, and the React binding that runs it
// without freezing the tab.
//
// 15,000-16,000 genes x one rhythm test is 0.2-3 s of straight-line arithmetic
// depending on the method and the period grid (JTK over a 17-period scan is the
// expensive corner: it evaluates a Kendall correlation at every period x phase).
// Run synchronously in a useMemo that is a visibly frozen tab, so the scan is
// chunked and yields to the event loop between chunks — the progress bar moves,
// the method selector stays clickable, and switching inputs mid-scan cancels the
// old one instead of racing it to setState.
//
// The scan produces RAW p-values only. The multiple-testing adjustment is a
// separate, cheap pass over the finished rows (adjustRows), so changing the
// correction — the control a user is most likely to toggle repeatedly — costs a
// sort, not a rescan.
//
// The tab scans every arm under the same settings (useArmScans), one arm after
// another with the selected arm first, so per-arm counts compare like with like
// without slowing the arm the table shows. Each arm is its own gene-wise family.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { TimeSeriesBundle } from '../types';
import { adjustPValues, type AdjustMethod } from './multipleTesting';
import { type RhythmMethod, type RhythmResult, runRhythmicity } from './rhythmicity';
import { geneList, seriesFor } from './timeSeriesSource';

export interface RhythmRow extends RhythmResult {
  gene: string;
  /** Adjusted p; equals `p` when the adjustment is 'none'. Null before adjustment. */
  q: number | null;
}

export interface ScanParams {
  method: RhythmMethod;
  /** Arm key, or ALL_ARMS for the pooled series. */
  arm: string;
  periods: number[];
}

// Non-rank tests use 400 genes per chunk. Canonical JTK yields every 32 genes:
// the retained whole-bundle benchmark measured a maximum 12.4 ms chunk across
// the three time courses; browser/device timings can differ.
const CHUNK = 400;

/**
 * Run the scan, yielding between chunks.
 *
 * `signal` is checked at every chunk boundary; an aborted scan resolves to null
 * rather than rejecting, because "you changed the settings" is not an error and
 * every call site would otherwise need a catch that swallows it.
 */
export async function scanRhythmicity(
  bundle: TimeSeriesBundle,
  params: ScanParams,
  onProgress?: (done: number, total: number) => void,
  signal?: { aborted: boolean },
): Promise<RhythmRow[] | null> {
  const genes = geneList(bundle);
  const rows: RhythmRow[] = [];
  const options = { periods: params.periods };
  const chunk = params.method === 'jtk' ? 32 : CHUNK;
  for (let i = 0; i < genes.length; i += chunk) {
    if (signal?.aborted) return null;
    const end = Math.min(i + chunk, genes.length);
    for (let g = i; g < end; g++) {
      const gene = genes[g];
      const result = runRhythmicity(params.method, seriesFor(bundle, gene, params.arm), options);
      if (result) rows.push({ gene, ...result, q: null });
    }
    onProgress?.(end, genes.length);
    // Yield to the event loop. setTimeout(0) rather than a microtask: a
    // microtask would run before paint and starve the progress bar it exists
    // to keep moving.
    await new Promise((r) => setTimeout(r, 0));
  }
  if (signal?.aborted) return null;
  return rows;
}

/** Attach adjusted p-values to finished rows. Pure; safe to run in a useMemo. */
export function adjustRows(rows: RhythmRow[], method: AdjustMethod): RhythmRow[] {
  const q = adjustPValues(rows.map((r) => r.p), method);
  return rows.map((r, i) => ({ ...r, q: q[i] }));
}

export interface ScanState {
  /** Rows with adjusted q attached, sorted by raw p ascending. Empty until the arm's scan finishes. */
  rows: RhythmRow[];
  /** True until this arm's scan has finished: queued behind another arm, or executing. */
  running: boolean;
  /** Genes that produced a usable test (rows.length) out of the bundle's total. */
  tested: number;
  total: number;
}

/** Test and period grid shared by every arm's scan. */
export interface ArmScanSettings {
  method: RhythmMethod;
  periods: number[];
}

// Arm keys are joined into the effect's value key; a newline never appears in one.
const ARM_SEPARATOR = '\n';

const IDLE: Omit<ScanState, 'total'> = { rows: [], running: false, tested: 0 };

/**
 * Fraction complete (0-1) of the arm being scanned now, as an external store.
 *
 * Progress changes once per chunk, hundreds of times in a whole-transcriptome
 * scan. Kept out of React state, it re-renders only the component that draws
 * the bar (useScanProgress), never the finished results beside it.
 */
export interface ScanProgressStore {
  subscribe: (listener: () => void) => () => void;
  get: () => number;
}

/** What useArmScans reports for a set of arms. */
export interface ArmScans {
  /** One entry per requested arm. */
  states: Record<string, ScanState>;
  /**
   * The arm whose scan is executing now, or null when none is. Unfinished arms
   * other than this one are queued behind it.
   */
  executing: string | null;
  /** Progress of the executing arm. */
  progress: ScanProgressStore;
}

/** Subscribe to a scan's progress; re-renders only the calling component. */
export function useScanProgress(store: ScanProgressStore): number {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

interface Completed {
  bundle: TimeSeriesBundle;
  key: string;
  rows: Record<string, RhythmRow[]>;
}

interface Snapshot {
  done: Completed | null;
  executing: { bundle: TimeSeriesBundle; key: string; arm: string } | null;
}

interface Request {
  bundle: TimeSeriesBundle;
  key: string;
  settings: ArmScanSettings;
  arms: string[];
}

interface Runner {
  bundle: TimeSeriesBundle;
  key: string;
  arm: string;
  signal: { aborted: boolean };
}

/**
 * The arm queue behind useArmScans: one scan at a time, highest priority first.
 *
 * A new request (another arm selected, so the priority order changes) does not
 * by itself cancel the scan in flight. That scan continues when it is for the
 * same bundle, test and period grid and its arm is still the first unfinished
 * one in the new order; otherwise it is cancelled and the new first arm starts.
 * Finished arms are kept while the bundle, test and period grid stay the same.
 */
class ArmScanQueue {
  private snapshot: Snapshot = { done: null, executing: null };
  private runner: Runner | null = null;
  private request: Request | null = null;
  private fraction = 0;
  private readonly statusListeners = new Set<() => void>();
  private readonly progressListeners = new Set<() => void>();

  readonly subscribeStatus = (listener: () => void) => {
    this.statusListeners.add(listener);
    return () => { this.statusListeners.delete(listener); };
  };

  readonly getStatus = () => this.snapshot;

  readonly progress: ScanProgressStore = {
    subscribe: (listener) => {
      this.progressListeners.add(listener);
      return () => { this.progressListeners.delete(listener); };
    },
    get: () => this.fraction,
  };

  update(bundle: TimeSeriesBundle | null, key: string, settings: ArmScanSettings, arms: string[]): void {
    if (!bundle) {
      this.abort();
      this.request = null;
      this.setSnapshot({ done: null, executing: null });
      return;
    }
    this.request = { bundle, key, settings, arms };
    const done = this.snapshot.done;
    if (!done || done.bundle !== bundle || done.key !== key) {
      this.setSnapshot({ ...this.snapshot, done: { bundle, key, rows: {} } });
    }
    this.advance();
  }

  dispose(): void {
    this.abort();
    this.request = null;
  }

  private abort(): void {
    if (this.runner) this.runner.signal.aborted = true;
    this.runner = null;
  }

  private advance(): void {
    const request = this.request;
    const done = this.snapshot.done;
    if (!request || !done) return;
    const { bundle, key } = request;
    const next = request.arms.find((arm) => !done.rows[arm]) ?? null;
    const run = this.runner;
    if (run && run.bundle === bundle && run.key === key && run.arm === next) return;
    this.abort();
    if (next == null) {
      if (this.snapshot.executing) this.setSnapshot({ ...this.snapshot, executing: null });
      return;
    }
    const signal = { aborted: false };
    const runner: Runner = { bundle, key, arm: next, signal };
    this.runner = runner;
    this.setProgress(0);
    this.setSnapshot({ ...this.snapshot, executing: { bundle, key, arm: next } });
    const { method, periods } = request.settings;
    void scanRhythmicity(
      bundle,
      { method, periods, arm: next },
      (count, all) => { if (!signal.aborted) this.setProgress(all ? count / all : 1); },
      signal,
    ).then((rows) => {
      if (signal.aborted || !rows || this.runner !== runner) return;
      this.runner = null;
      rows.sort((a, b) => a.p - b.p);
      const current = this.snapshot.done;
      const kept = current && current.bundle === bundle && current.key === key ? current.rows : {};
      // One notification for "this arm finished, the next one started".
      this.snapshot = { done: { bundle, key, rows: { ...kept, [next]: rows } }, executing: null };
      this.advance();
      this.emit(this.statusListeners);
    });
  }

  private setSnapshot(next: Snapshot): void {
    this.snapshot = next;
    this.emit(this.statusListeners);
  }

  private setProgress(fraction: number): void {
    if (fraction === this.fraction) return;
    this.fraction = fraction;
    this.emit(this.progressListeners);
  }

  private emit(listeners: Set<() => void>): void {
    for (const listener of [...listeners]) listener();
  }
}

/**
 * Scan state for several arms of one bundle under ONE test and period grid,
 * re-adjusted whenever the correction changes.
 *
 * `arms` is in priority order: the arms are scanned one after another, never
 * concurrently, so the first (the arm the table shows) is not slowed by the
 * others. Each arm's rows are adjusted against that arm's own scored genes —
 * the gene-wise family is one arm's transcriptome, never the arms pooled.
 *
 * Finished arms are kept while the test and period grid stay the same, so
 * reordering `arms` (the user picks another arm to tabulate) shows an already
 * scanned arm at once, and an arm already being scanned keeps its progress when
 * it becomes the first unfinished arm. A change of bundle, test or period grid
 * discards the finished arms and cancels the scan in flight.
 *
 * Every returned entry is matched synchronously against the current bundle and
 * settings: the render before the replacement effect starts reports the arm as
 * unfinished with no rows, never the previous request's statistics. An arm
 * absent from `arms` (for example one whose design JTK_CYCLE cannot test) has
 * no entry.
 *
 * Progress is published through `progress`, not React state: the component that
 * calls this hook re-renders when an arm starts or finishes, not on every chunk.
 */
export function useArmScans(
  bundle: TimeSeriesBundle | null,
  settings: ArmScanSettings,
  arms: readonly string[],
  adjust: AdjustMethod,
): ArmScans {
  const [queue] = useState(() => new ArmScanQueue());
  const total = bundle ? Object.keys(bundle.values).length : 0;

  // Settings are compared by value, not identity: callers build `periods`
  // inline, so a reference-keyed effect would rescan on every render.
  const key = `${settings.method}|${settings.periods.join(',')}`;
  const armsKey = arms.join(ARM_SEPARATOR);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    queue.update(bundle, key, settingsRef.current, armsKey ? armsKey.split(ARM_SEPARATOR) : []);
  }, [queue, bundle, key, armsKey]);
  useEffect(() => () => queue.dispose(), [queue]);

  const status = useSyncExternalStore(queue.subscribeStatus, queue.getStatus, queue.getStatus);

  // Match the completed requests synchronously (see the comment above).
  const matched = bundle && status.done?.bundle === bundle && status.done.key === key ? status.done.rows : null;
  // Adjusted rows are cached per finished arm, so one arm finishing leaves the
  // other arms' rows, and anything memoized on them, untouched.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new correction must start a new cache.
  const adjustedCache = useMemo(() => new WeakMap<RhythmRow[], RhythmRow[]>(), [adjust]);

  const states = useMemo(() => {
    const out: Record<string, ScanState> = {};
    for (const arm of arms) {
      if (!bundle) { out[arm] = { ...IDLE, total }; continue; }
      const done = matched?.[arm];
      if (!done) { out[arm] = { rows: [], running: true, tested: 0, total }; continue; }
      let rows = adjustedCache.get(done);
      if (!rows) { rows = adjustRows(done, adjust); adjustedCache.set(done, rows); }
      out[arm] = { rows, running: false, tested: done.length, total };
    }
    return out;
  }, [arms, bundle, matched, adjustedCache, adjust, total]);

  const live = status.executing;
  const executing = bundle && live && live.bundle === bundle && live.key === key
    && arms.includes(live.arm) && !matched?.[live.arm] ? live.arm : null;

  return useMemo(() => ({ states, executing, progress: queue.progress }), [states, executing, queue]);
}

/** One arm's scan state, with the fraction of it complete. */
export interface SingleScanState extends ScanState {
  /** 0-1: 1 once finished, the executing fraction while scanning, 0 while waiting. */
  progress: number;
}

/**
 * Scan state for one (bundle, method, arm, period grid), re-adjusted whenever the
 * correction changes: `useArmScans` for a single arm.
 *
 * The scan is keyed on everything that changes the p-values and on nothing that
 * does not — which is what makes flipping BH → Bonferroni instant while flipping
 * COSINOR → JTK re-runs.
 */
export function useRhythmScan(
  bundle: TimeSeriesBundle | null,
  params: ScanParams,
  adjust: AdjustMethod,
): SingleScanState {
  const arms = useMemo(() => [params.arm], [params.arm]);
  const settings = useMemo(
    () => ({ method: params.method, periods: params.periods }),
    [params.method, params.periods],
  );
  const scans = useArmScans(bundle, settings, arms, adjust);
  const fraction = useScanProgress(scans.progress);
  const state = scans.states[params.arm] ?? { ...IDLE, total: bundle ? Object.keys(bundle.values).length : 0 };
  const progress = !state.running ? (bundle ? 1 : 0) : scans.executing === params.arm ? fraction : 0;
  return { ...state, progress };
}
