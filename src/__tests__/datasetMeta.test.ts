import { describe, it, expect } from 'vitest';
import { trackColor, trackLabel, FALLBACK_TRACK_COLOR } from '../data/datasetMeta';
import type { DatasetMeta } from '../types';

// Pure lookups over the active dataset's metadata. The meta flows as a value
// (App state → props); a null meta degrades to the bare id / fallback colour —
// there is no ambient "active dataset" to recover a stale answer from.

const meta = {
  colors: { e9: '#F28E2B' },
  labels: { e9: 'e9 (POMC/TBX3)' },
} as unknown as DatasetMeta;

describe('trackColor', () => {
  it('returns the palette colour for a known track', () => {
    expect(trackColor(meta, 'e9')).toBe('#F28E2B');
  });
  it('falls back to the neutral colour for unknown tracks and null meta', () => {
    expect(trackColor(meta, 'nope')).toBe(FALLBACK_TRACK_COLOR);
    expect(trackColor(null, 'e9')).toBe(FALLBACK_TRACK_COLOR);
    expect(trackColor(undefined, 'e9')).toBe(FALLBACK_TRACK_COLOR);
  });
});

describe('trackLabel', () => {
  it('returns the display label for a known track', () => {
    expect(trackLabel(meta, 'e9')).toBe('e9 (POMC/TBX3)');
  });
  it('falls back to the bare id for unknown tracks and null meta', () => {
    expect(trackLabel(meta, 'i23')).toBe('i23');
    expect(trackLabel(null, 'e9')).toBe('e9');
  });
});
