// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  COMPARE_SET_MAX, COMPARE_SET_STORAGE_KEY, _resetCompareSetStore,
  addItem, clear, compareSetKey, getSnapshot, hasItem, removeItem, subscribe, toggleItem, useCompareSet,
} from '../compareset/compareSetStore';
import { listDatasets } from '../data/datasets';

// The compare set is the one piece of user state that outlives a view and a
// reload, so its contract is pinned at the store rather than through the UI:
// what it accepts, what it refuses, what it persists, and what it forgives.

const E9 = { datasetId: 'macaque_snrna', trackId: 'e9' };
const I23 = { datasetId: 'macaque_snrna', trackId: 'i23' };
const MOUSE = { datasetId: 'mouse_hypo_hfd_gse220533', trackId: 'whole' };

const stored = () => JSON.parse(localStorage.getItem(COMPARE_SET_STORAGE_KEY) ?? 'null');

beforeEach(() => { _resetCompareSetStore(); });
afterEach(() => { vi.restoreAllMocks(); _resetCompareSetStore(); });

describe('compareSetStore — membership', () => {
  it('keys an item by dataset and track', () => {
    expect(compareSetKey(I23)).toBe('macaque_snrna:i23');
  });

  it('starts empty and appends in insertion order', () => {
    expect(getSnapshot()).toEqual([]);
    expect(addItem(MOUSE)).toEqual({ ok: true });
    expect(addItem(E9)).toEqual({ ok: true });
    expect(getSnapshot()).toEqual([MOUSE, E9]);
    expect(hasItem(E9)).toBe(true);
  });

  it('treats a duplicate add as a success that changes nothing', () => {
    addItem(E9);
    const before = getSnapshot();
    expect(addItem({ ...E9 })).toEqual({ ok: true });
    expect(getSnapshot()).toBe(before);
    expect(getSnapshot()).toHaveLength(1);
  });

  it('toggles in and out, and ignores a remove of something absent', () => {
    expect(toggleItem(E9)).toEqual({ ok: true });
    expect(hasItem(E9)).toBe(true);
    expect(toggleItem(E9)).toEqual({ ok: true });
    expect(hasItem(E9)).toBe(false);
    const before = getSnapshot();
    removeItem(I23);
    expect(getSnapshot()).toBe(before);
  });

  it('refuses an unknown dataset and an empty track', () => {
    expect(addItem({ datasetId: 'no_such_dataset', trackId: 'x' })).toEqual({ ok: false, reason: 'invalid' });
    expect(addItem({ datasetId: 'macaque_snrna', trackId: '' })).toEqual({ ok: false, reason: 'invalid' });
    expect(getSnapshot()).toEqual([]);
  });

  it("stores a copy, never the caller's object", () => {
    const mine = { ...E9 };
    addItem(mine);
    mine.trackId = 'mutated';
    expect(getSnapshot()[0]).toEqual(E9);
  });

  it('caps the set, and re-admits once something is removed', () => {
    const twelve = listDatasets().slice(0, COMPARE_SET_MAX).map((d) => ({ datasetId: d.id, trackId: d.defaultTrack }));
    for (const item of twelve) expect(addItem(item)).toEqual({ ok: true });
    expect(getSnapshot()).toHaveLength(COMPARE_SET_MAX);

    const thirteenth = { datasetId: listDatasets()[COMPARE_SET_MAX].id, trackId: 'whatever' };
    expect(addItem(thirteenth)).toEqual({ ok: false, reason: 'full' });
    expect(getSnapshot()).toHaveLength(COMPARE_SET_MAX);

    removeItem(twelve[0]);
    expect(addItem(thirteenth)).toEqual({ ok: true });
    expect(getSnapshot()).toHaveLength(COMPARE_SET_MAX);
  });

  it('clears, and persists the empty set', () => {
    addItem(E9);
    addItem(MOUSE);
    clear();
    expect(getSnapshot()).toEqual([]);
    expect(stored()).toEqual({ v: 1, items: [] });
  });
});

describe('compareSetStore — snapshots and listeners', () => {
  it('returns the same snapshot until something actually changes', () => {
    const a = getSnapshot();
    expect(getSnapshot()).toBe(a);
    addItem(E9);
    const b = getSnapshot();
    expect(b).not.toBe(a);
    removeItem(I23); // absent: no change
    expect(getSnapshot()).toBe(b);
    addItem(E9); // duplicate: no change
    expect(getSnapshot()).toBe(b);
  });

  it('notifies once per mutation, never for a no-op, and not after unsubscribing', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    addItem(E9);
    addItem(E9);
    removeItem(I23);
    expect(listener).toHaveBeenCalledTimes(1);
    toggleItem(MOUSE);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    clear();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('re-renders a subscribed component on change', () => {
    const { result } = renderHook(() => useCompareSet());
    expect(result.current).toEqual([]);
    act(() => { addItem(E9); });
    expect(result.current).toEqual([E9]);
    expect(result.current).toBe(getSnapshot());
  });
});

describe('compareSetStore — persistence', () => {
  it('writes every change and reads it back on a fresh load', () => {
    addItem(E9);
    addItem(MOUSE);
    expect(stored()).toEqual({ v: 1, items: [E9, MOUSE] });

    const payload = localStorage.getItem(COMPARE_SET_STORAGE_KEY) as string;
    _resetCompareSetStore();
    localStorage.setItem(COMPARE_SET_STORAGE_KEY, payload);
    expect(getSnapshot()).toEqual([E9, MOUSE]);
  });

  it.each([
    ['not JSON', '{nope'],
    ['the wrong version', JSON.stringify({ v: 2, items: [E9] })],
    ['the wrong shape', JSON.stringify({ v: 1, items: 'x' })],
    ['non-string fields', JSON.stringify({ v: 1, items: [{ datasetId: 4, trackId: null }] })],
  ])('starts empty when the stored payload is %s', (_label, payload) => {
    localStorage.setItem(COMPARE_SET_STORAGE_KEY, payload);
    expect(getSnapshot()).toEqual([]);
  });

  it('drops ids this build does not know, dedupes, and truncates to the cap', () => {
    const many = listDatasets().slice(0, COMPARE_SET_MAX + 3).map((d) => ({ datasetId: d.id, trackId: d.defaultTrack }));
    localStorage.setItem(COMPARE_SET_STORAGE_KEY, JSON.stringify({
      v: 1,
      items: [{ datasetId: 'no_such', trackId: 'x' }, I23, I23, ...many],
    }));
    const snapshot = getSnapshot();
    expect(snapshot[0]).toEqual(I23);
    expect(snapshot).toHaveLength(COMPARE_SET_MAX);
    expect(new Set(snapshot.map(compareSetKey)).size).toBe(COMPARE_SET_MAX);
  });

  it('keeps working for the session when storage refuses writes', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(addItem(E9)).toEqual({ ok: true });
    expect(getSnapshot()).toEqual([E9]);
  });

  it('starts empty when storage refuses reads', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(getSnapshot()).toEqual([]);
    expect(addItem(E9)).toEqual({ ok: true });
  });
});
