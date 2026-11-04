// The compare set: the studies — and single populations — a user has picked to
// line up side by side, kept across every view and across reloads.
//
// Modelled on ../pwa/updateStore.ts: module state, subscribe/getSnapshot for
// useSyncExternalStore, named mutators, a test-only reset. Persisted to
// localStorage the way versionWatch.ts treats sessionStorage: every read and
// write sits in a try/catch, and a blocked or corrupt store degrades to an
// in-memory set for the session rather than to an error.
//
// An ITEM is a (dataset, track) pair, not a dataset. A macaque population is
// something worth setting beside a bulk study, and a study's default track is
// simply the pair the library picks when it adds that study.
//
// The set is a STAGING AREA. The compare-set view renders the items named in
// its URL, so a link is a snapshot that can be shared; this store is what the
// drawer's "Compare N →" builds that URL from. Opening someone else's link
// never touches it.

import { useSyncExternalStore } from 'react';
import { getDataset } from '../data/datasets';

export interface CompareSetItem {
  datasetId: string;
  trackId: string;
}

/** Each item costs a track bundle (median 2.5 MB) plus its pathway sibling
 *  (median 1.1 MB) when the view loads it, so the set is capped. */
export const COMPARE_SET_MAX = 12;
export const COMPARE_SET_STORAGE_KEY = 'hypoexplorer:compare-set';

export type CompareSetAddResult =
  | { ok: true }
  | { ok: false; reason: 'full' | 'invalid' };

type Listener = () => void;

const EMPTY: readonly CompareSetItem[] = Object.freeze([]);
// Replaced ONLY in commit(): useSyncExternalStore compares snapshots by
// identity, so a getSnapshot that built a fresh array would re-render forever.
let items: readonly CompareSetItem[] = EMPTY;
let loaded = false;
const listeners = new Set<Listener>();

export function compareSetKey(item: CompareSetItem): string {
  return `${item.datasetId}:${item.trackId}`;
}

function isItemShape(value: unknown): value is CompareSetItem {
  if (typeof value !== 'object' || value === null) return false;
  const { datasetId, trackId } = value as { datasetId?: unknown; trackId?: unknown };
  return typeof datasetId === 'string' && datasetId !== '' && typeof trackId === 'string' && trackId !== '';
}

/**
 * The stored payload, reduced to what this build can still honour.
 *
 * A dataset id from an older deploy is dropped rather than carried: the
 * registry is what the view loads from, and `datasetCategory` THROWS on an id
 * it does not know, so a stale id must never reach a render. Track ids are not
 * checked here — that needs the dataset's metadata, which is a network request
 * — so the view reports an unknown track as such.
 */
function sanitize(parsed: unknown): CompareSetItem[] {
  if (typeof parsed !== 'object' || parsed === null) return [];
  const { v, items: raw } = parsed as { v?: unknown; items?: unknown };
  if (v !== 1 || !Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CompareSetItem[] = [];
  for (const entry of raw) {
    if (!isItemShape(entry)) continue;
    if (!getDataset(entry.datasetId)) continue;
    const item = { datasetId: entry.datasetId, trackId: entry.trackId };
    const key = compareSetKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= COMPARE_SET_MAX) break;
  }
  return out;
}

// Lazy, and once: reading storage at import time would run before tests seed
// it, and before a page with blocked storage has a chance to fail quietly.
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(COMPARE_SET_STORAGE_KEY);
    if (!raw) return;
    items = Object.freeze(sanitize(JSON.parse(raw)));
  } catch {
    // Storage blocked, or the payload is not JSON: start empty for the session.
    items = EMPTY;
  }
}

function save(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(COMPARE_SET_STORAGE_KEY, JSON.stringify({ v: 1, items }));
  } catch {
    // Storage blocked (private mode, quota): the set still works for the
    // session, it just does not survive a reload.
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

function commit(next: CompareSetItem[]): void {
  items = Object.freeze(next);
  save();
  emit();
}

// useSyncExternalStore contract: register a listener, return an unsubscribe fn.
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): readonly CompareSetItem[] {
  ensureLoaded();
  return items;
}

export function hasItem(item: CompareSetItem): boolean {
  ensureLoaded();
  const key = compareSetKey(item);
  return items.some((it) => compareSetKey(it) === key);
}

/**
 * Add one pair. A duplicate is a success that changes nothing (and emits
 * nothing); an unknown dataset or an empty track id is refused, as is a set
 * already at the cap — the caller is told which, since a full set is the
 * user's to fix and a stale id is not.
 */
export function addItem(item: CompareSetItem): CompareSetAddResult {
  ensureLoaded();
  if (!item.trackId || !getDataset(item.datasetId)) return { ok: false, reason: 'invalid' };
  if (hasItem(item)) return { ok: true };
  if (items.length >= COMPARE_SET_MAX) return { ok: false, reason: 'full' };
  // Copy the two fields: the caller's object must not become the stored one.
  commit([...items, { datasetId: item.datasetId, trackId: item.trackId }]);
  return { ok: true };
}

export function removeItem(item: CompareSetItem): void {
  ensureLoaded();
  const key = compareSetKey(item);
  if (!items.some((it) => compareSetKey(it) === key)) return;
  commit(items.filter((it) => compareSetKey(it) !== key));
}

export function toggleItem(item: CompareSetItem): CompareSetAddResult {
  if (hasItem(item)) {
    removeItem(item);
    return { ok: true };
  }
  return addItem(item);
}

export function clear(): void {
  ensureLoaded();
  if (items.length === 0) return;
  commit([]);
}

/** The set as React state: one subscription per caller, stable snapshots. */
export function useCompareSet(): readonly CompareSetItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Test-only: reset module state AND the persisted copy between tests. jsdom's
// localStorage outlives a test file's individual tests, so forgetting the key
// would let one test's set leak into the next.
export function _resetCompareSetStore(): void {
  items = EMPTY;
  loaded = false;
  listeners.clear();
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(COMPARE_SET_STORAGE_KEY);
  } catch {
    // Nothing to clear when storage is blocked.
  }
}
