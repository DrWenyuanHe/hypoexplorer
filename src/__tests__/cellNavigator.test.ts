import { describe, it, expect } from 'vitest';
import { matchesCellQuery } from '../explorer/CellNavigator';
import type { DatasetMeta } from '../types';

// The sidebar search deliberately spans three fields — track id, marker-gene
// label, and category — because users arrive with any of the three ("e9",
// "POMC", "GABAergic"). CellSelectorPopup shares this predicate, so these cases
// pin the search behavior of both pickers.

const META = {
  labels: { e9: 'e9 (POMC/TBX3)', i23: 'i23 (AGRP/MCTP2)' },
  types: { e9: 'Glutamatergic', i23: 'GABAergic' },
} as unknown as DatasetMeta;

describe('matchesCellQuery', () => {
  it('empty or whitespace-only query matches everything', () => {
    expect(matchesCellQuery(META, 'e9', '')).toBe(true);
    expect(matchesCellQuery(META, 'e9', '   ')).toBe(true);
  });

  it('matches on track id, case-insensitively', () => {
    expect(matchesCellQuery(META, 'e9', 'E9')).toBe(true);
    expect(matchesCellQuery(META, 'i23', 'e9')).toBe(false);
  });

  it('matches on the marker-gene label, not just the id', () => {
    expect(matchesCellQuery(META, 'e9', 'pomc')).toBe(true);
    expect(matchesCellQuery(META, 'i23', 'agrp')).toBe(true);
    expect(matchesCellQuery(META, 'e9', 'agrp')).toBe(false);
  });

  it('matches on the category', () => {
    expect(matchesCellQuery(META, 'e9', 'glut')).toBe(true);
    expect(matchesCellQuery(META, 'i23', 'gaba')).toBe(true);
    expect(matchesCellQuery(META, 'e9', 'gaba')).toBe(false);
  });

  it('null meta still matches by id but not by label or type', () => {
    expect(matchesCellQuery(null, 'e9', 'e9')).toBe(true);
    expect(matchesCellQuery(null, 'e9', 'pomc')).toBe(false);
  });
});
