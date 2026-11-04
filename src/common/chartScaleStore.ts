// The bar charts' scale preference: linear, log2, or each dataset as deposited.
//
// Modelled on ../compareset/compareSetStore.ts — module state, subscribe /
// getSnapshot for useSyncExternalStore, a named mutator, a test-only reset, and
// every localStorage touch inside a try/catch so a blocked or corrupt store
// degrades to an in-memory preference for the session rather than to an error.
//
// It is GLOBAL rather than per view or per chart, deliberately. Charts render in
// grids of tens (the gene explorer's modal, a pathway's leading edge, one gene
// across every dataset), and a control per chart would be noise at that count
// while a control per view would have the compare tab and the gene explorer
// disagree about what "log2" meant. One pick, honoured by every chart that can
// and reported by every chart that cannot (see resolveChartScale).
//
// The default is 'native' — every dataset on the scale it was deposited in,
// which is what the charts did before this existed. Defaulting to either
// transform would silently restate 145 studies' axes on first load.

import { useSyncExternalStore } from 'react';
import type { ChartScale } from '../utils/chartScale';
import { CHART_SCALES } from '../utils/chartScale';

export const CHART_SCALE_STORAGE_KEY = 'hypoexplorer:chart-scale';

type Listener = () => void;

let scale: ChartScale = 'native';
let loaded = false;
const listeners = new Set<Listener>();

function isChartScale(value: unknown): value is ChartScale {
  return typeof value === 'string' && (CHART_SCALES as readonly string[]).includes(value);
}

// Lazy, and once: reading storage at import time would run before tests seed it,
// and before a page with blocked storage has a chance to fail quietly.
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(CHART_SCALE_STORAGE_KEY);
    // A value this build no longer knows falls back to 'native' rather than
    // throwing — the stored string outlives the deploy that wrote it.
    if (isChartScale(raw)) scale = raw;
  } catch {
    // Storage blocked, or unreadable: start on the deposited scale.
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** useSyncExternalStore contract: register a listener, return an unsubscribe fn. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Returns a primitive, so Object.is comparison is stable between renders when
// nothing changed — no memoization needed at the fifty-odd subscribing charts.
export function getSnapshot(): ChartScale {
  ensureLoaded();
  return scale;
}

export function setChartScale(next: ChartScale): void {
  ensureLoaded();
  if (next === scale) return;
  scale = next;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(CHART_SCALE_STORAGE_KEY, next);
  } catch {
    // Storage blocked (private mode, quota): the pick still works for the
    // session, it just does not survive a reload.
  }
  emit();
}

/** The pick as React state: one subscription per chart, stable snapshots. */
export function useChartScale(): ChartScale {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Test-only: reset module state AND the persisted copy between tests. jsdom's
// localStorage outlives a test file's individual tests, so forgetting the key
// would let one test's pick leak into the next.
export function _resetChartScaleStore(): void {
  scale = 'native';
  loaded = false;
  listeners.clear();
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(CHART_SCALE_STORAGE_KEY);
  } catch {
    // Nothing to clear when storage is blocked.
  }
}
