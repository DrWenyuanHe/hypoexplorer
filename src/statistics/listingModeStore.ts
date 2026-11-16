// Which tracks the result views LIST: only the FDR survivors (q < 0.05), or
// every track with raw p < 0.05, the nominal ones labelled "p < 0.05 only".
//
// Modelled on ../common/chartScaleStore.ts: module state, subscribe /
// getSnapshot for useSyncExternalStore, a named mutator, a test-only reset, and
// every localStorage touch inside a try/catch so a blocked or corrupt store
// degrades to an in-memory preference for the session rather than to an error.
//
// GLOBAL rather than per view, so the search page and the gene and pathway
// reports never disagree about what a list of "results" holds while a reader
// moves between them.
//
// It changes what is listed, never what is called significant: the counts, the
// direction tallies, the colours and the pathway follow-up stay on the FDR call
// (isFdrSignificant) in both modes.
//
// The default is 'nominal' — the behaviour the views have when the reader has
// not chosen.

import { useSyncExternalStore } from 'react';

export type ListingMode = 'nominal' | 'fdr';

export const LISTING_MODE_STORAGE_KEY = 'hypoexplorer:listing-mode';

const DEFAULT_MODE: ListingMode = 'nominal';

type Listener = () => void;

let mode: ListingMode = DEFAULT_MODE;
let loaded = false;
const listeners = new Set<Listener>();

function isListingMode(value: unknown): value is ListingMode {
  return value === 'nominal' || value === 'fdr';
}

// Lazy, and once: reading storage at import time would run before tests seed it,
// and before a page with blocked storage has a chance to fail quietly.
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(LISTING_MODE_STORAGE_KEY);
    if (isListingMode(raw)) mode = raw;
  } catch {
    // Storage blocked, or unreadable: start on the default.
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ListingMode {
  ensureLoaded();
  return mode;
}

export function setListingMode(next: ListingMode): void {
  ensureLoaded();
  if (next === mode) return;
  mode = next;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LISTING_MODE_STORAGE_KEY, next);
  } catch {
    // Storage blocked (private mode, quota): the pick still works for the
    // session, it just does not survive a reload.
  }
  emit();
}

/** The pick as React state. */
export function useListingMode(): ListingMode {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Test-only: reset module state AND the persisted copy between tests, so one
// test's pick cannot leak into the next.
export function _resetListingModeStore(): void {
  mode = DEFAULT_MODE;
  loaded = false;
  listeners.clear();
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(LISTING_MODE_STORAGE_KEY);
  } catch {
    // Nothing to clear when storage is blocked.
  }
}
