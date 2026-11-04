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

import { useEffect, useMemo, useRef, useState } from 'react';
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
  /** Rows with adjusted q attached, sorted by raw p ascending. Empty while running. */
  rows: RhythmRow[];
  running: boolean;
  /** 0-1; only meaningful while `running`. */
  progress: number;
  /** Genes that produced a usable test (rows.length) out of the bundle's total. */
  tested: number;
  total: number;
}

/**
 * Scan state for one (bundle, method, arm, period grid), re-adjusted whenever the
 * correction changes.
 *
 * The scan is keyed on everything that changes the p-values and on nothing that
 * does not — which is what makes flipping BH → Bonferroni instant while flipping
 * COSINOR → JTK re-runs.
 */
export function useRhythmScan(
  bundle: TimeSeriesBundle | null,
  params: ScanParams,
  adjust: AdjustMethod,
): ScanState {
  const [completed, setCompleted] = useState<{
    bundle: TimeSeriesBundle; key: string; rows: RhythmRow[];
  } | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const total = bundle ? Object.keys(bundle.values).length : 0;

  // Params are compared by value, not identity: the caller builds `periods`
  // inline, so a reference-keyed effect would rescan on every render.
  const key = `${params.method}|${params.arm}|${params.periods.join(',')}`;
  const paramsRef = useRef(params);
  paramsRef.current = params;

  // Params are read through a ref: the value key, rather than the params object
  // identity, decides when to rescan and labels the completed result.
  useEffect(() => {
    if (!bundle) { setCompleted(null); setRunning(false); return; }
    const signal = { aborted: false };
    setRunning(true);
    setProgress(0);
    scanRhythmicity(
      bundle,
      paramsRef.current,
      (done, all) => { if (!signal.aborted) setProgress(all ? done / all : 1); },
      signal,
    ).then((rows) => {
      if (signal.aborted || !rows) return;
      rows.sort((a, b) => a.p - b.p);
      setCompleted({ bundle, key, rows });
      setRunning(false);
      setProgress(1);
    });
    return () => { signal.aborted = true; };
  }, [bundle, key]);

  // Effects start after rendering. Match the completed request synchronously,
  // so the first render with a new setting/bundle cannot expose old statistics
  // with new export metadata, even before setRunning(true) takes effect.
  const matches = !!bundle && completed?.bundle === bundle && completed.key === key;
  const pending = !!bundle && (running || !matches);
  const rows = useMemo(() => (
    pending || !matches || !completed ? [] : adjustRows(completed.rows, adjust)
  ), [completed, adjust, pending, matches]);
  return { rows, running: pending, progress: matches ? progress : 0,
    tested: matches && !pending ? completed.rows.length : 0, total };
}
