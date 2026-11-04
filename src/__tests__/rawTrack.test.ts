import { describe, it, expect } from 'vitest';
import {
  deTableFor, groupSamplesOf, siblingDefaultPathways, siblingPathwaysByContrast,
  strictDeTableFor, strictSiblingPathwaysFor,
} from '../data/rawTrack';
import { buildPopData } from '../data/buildPopData';
import { trackGroupSamples } from '../utils/sampleIds';
import { MACAQUE_DATASET, MACAQUE_CONTRAST } from './fixtures';
import type { GeneDERecord, PathwayDatabase, RawTrack } from '../types';

const DE_A: GeneDERecord[] = [{ gene: 'POMC', logFC: 1, PValue: 0.01, FDR: 0.02 }];
const DE_B: GeneDERecord[] = [{ gene: 'POMC', logFC: -2, PValue: 0.2, FDR: 0.4 }];

/** Minimal well-typed track; each case overrides only the fields it exercises. */
function track(over: Partial<RawTrack>): RawTrack {
  return { cpm: {}, ...over };
}

describe('deTableFor — legacy bundle shapes', () => {
  it('prefers the active contrast’s deByContrast table', () => {
    const raw = track({ de: DE_A, deByContrast: { refed_vs_fed: DE_B } });
    expect(deTableFor(raw, 'refed_vs_fed')).toBe(DE_B);
  });

  it('falls back to the legacy `de` when the contrast has no per-contrast table', () => {
    const raw = track({ de: DE_A, deByContrast: { refed_vs_fed: DE_B } });
    expect(deTableFor(raw, 'fast24_vs_fed')).toBe(DE_A);
  });

  it('falls back to the legacy `de` when there is no contrast id at all', () => {
    // A dataset that resolves no contrast still reads the single-contrast table.
    expect(deTableFor(track({ de: DE_A, deByContrast: { x: DE_B } }), undefined)).toBe(DE_A);
  });

  it('reads a pure legacy bundle (no deByContrast key)', () => {
    expect(deTableFor(track({ de: DE_A }), 'anything')).toBe(DE_A);
  });

  it('yields [] for a bundle with neither field, an explicit null `de`, or no track', () => {
    expect(deTableFor(track({}), 'c')).toEqual([]);
    expect(deTableFor({ cpm: {}, de: null } as unknown as RawTrack, 'c')).toEqual([]);
    expect(deTableFor(null, 'c')).toEqual([]);
    expect(deTableFor(undefined, undefined)).toEqual([]);
  });
});

// The STRICT twin (DATASET_CONTRACT): legacy `de` belongs to the REGISTERED
// DEFAULT, so only the default may fall back to it. These are the branches that
// separate "slow" from "silently wrong" — a regression to the permissive rule
// would serve the default's logFC under a non-default contrast's label.
describe('strictDeTableFor — default-witness rule', () => {
  it('prefers an explicit deByContrast table, default or not', () => {
    const raw = track({ de: DE_A, deByContrast: { refed_vs_fed: DE_B } });
    expect(strictDeTableFor(raw, 'refed_vs_fed', 'refed_vs_fed')).toBe(DE_B);
    expect(strictDeTableFor(raw, 'refed_vs_fed', 'fast24_vs_fed')).toBe(DE_B);
  });

  it('serves the legacy `de` ONLY for the registered default', () => {
    const raw = track({ de: DE_A });
    expect(strictDeTableFor(raw, 'fast24_vs_fed', 'fast24_vs_fed')).toBe(DE_A);
  });

  it('refuses the legacy `de` for a non-default contrast (the whole point)', () => {
    // The permissive twin returns DE_A here; that is the misattribution.
    const raw = track({ de: DE_A });
    expect(deTableFor(raw, 'refed_vs_fed')).toBe(DE_A);
    expect(strictDeTableFor(raw, 'refed_vs_fed', 'fast24_vs_fed')).toEqual([]);
  });

  it('yields [] when no contrast is named — never a guess', () => {
    expect(strictDeTableFor(track({ de: DE_A }), undefined, 'fast24_vs_fed')).toEqual([]);
    expect(strictDeTableFor(track({ de: DE_A }), undefined, undefined)).toEqual([]);
  });

  it('yields [] for a bundle with neither field, or no track', () => {
    expect(strictDeTableFor(track({}), 'c', 'c')).toEqual([]);
    expect(strictDeTableFor(null, 'c', 'c')).toEqual([]);
    expect(strictDeTableFor(undefined, 'c', 'c')).toEqual([]);
  });
});

describe('groupSamplesOf — legacy bundle shapes', () => {
  const GS = { chow: ['c1', 'c2'], hfd: ['h1'] };

  it('prefers the migration-added meta.groupSamples (by identity)', () => {
    const raw = track({ meta: { groupSamples: GS, normalSamples: ['n1'], obeseSamples: ['o1'] } });
    expect(groupSamplesOf(raw)).toBe(GS);
  });

  it('derives normal/obese from the legacy pair when groupSamples is absent', () => {
    const raw = track({ meta: { normalSamples: ['n1', 'n2'], obeseSamples: ['o1'] } });
    expect(groupSamplesOf(raw)).toEqual({ normal: ['n1', 'n2'], obese: ['o1'] });
  });

  it('fills the missing half of a one-sided legacy pair with []', () => {
    expect(groupSamplesOf(track({ meta: { normalSamples: ['n1'] } })))
      .toEqual({ normal: ['n1'], obese: [] });
    expect(groupSamplesOf(track({ meta: { obeseSamples: ['o1'] } })))
      .toEqual({ normal: [], obese: ['o1'] });
  });

  it('keeps an explicitly empty groupSamples record rather than reaching for the legacy pair', () => {
    // {} is a STATEMENT ("this bundle declares no groups"), not an absence.
    expect(groupSamplesOf(track({ meta: { groupSamples: {}, normalSamples: ['n1'] } }))).toEqual({});
  });

  it('returns null — not a fabricated record — when the track declares nothing', () => {
    expect(groupSamplesOf(track({ meta: { sampleOrder: ['a'] } }))).toBeNull();
    expect(groupSamplesOf(track({}))).toBeNull();       // no meta block
    expect(groupSamplesOf(null)).toBeNull();
    expect(groupSamplesOf(undefined)).toBeNull();
  });
});

// The accessor deliberately owns the RULE and not the DEFAULT: the two callers
// disagree about what "declares nothing" means, and both answers are load-bearing.
describe('groupSamplesOf — each caller keeps its own empty default', () => {
  it('buildPopData substitutes the two empty arms; trackGroupSamples substitutes {}', () => {
    const bare = track({ meta: { sampleOrder: ['a', 'b'] } });
    expect(buildPopData(bare, MACAQUE_DATASET, MACAQUE_CONTRAST)!.groupSamples)
      .toEqual({ normal: [], obese: [] });
    expect(trackGroupSamples(bare)).toEqual({});
  });

  it('both callers agree wherever the track DOES declare something', () => {
    const legacy = track({ meta: { normalSamples: ['n1'], obeseSamples: ['o1'] } });
    expect(buildPopData(legacy, MACAQUE_DATASET, MACAQUE_CONTRAST)!.groupSamples)
      .toEqual(trackGroupSamples(legacy));
  });
});

// Rule 3: the pathway sibling bundle's two shapes — the legacy plain block and
// the multi-contrast {default, byContrast} wrapper — unwrap HERE, once, for the
// three consumers (track hydration, cross-dataset pathway query, index builder).
describe('pathway sibling shapes', () => {
  const BLOCK: PathwayDatabase = {
    GO_BP: [{ pathway: 'GOBP_X', pval: 0.01, padj: 0.02, NES: 1.5, size: 30, leadingEdge: [] }],
  };
  const EXTRA: PathwayDatabase = {
    HALLMARK: [{ pathway: 'HALLMARK_Y', pval: 0.03, padj: 0.04, NES: -1.2, size: 50, leadingEdge: [] }],
  };

  it('a legacy plain block IS the default; it has no per-contrast blocks', () => {
    expect(siblingDefaultPathways(BLOCK)).toBe(BLOCK);
    expect(siblingPathwaysByContrast(BLOCK)).toBeNull();
  });

  it('the wrapper unwraps into default + byContrast', () => {
    const wrapper = { default: BLOCK, byContrast: { hfd_vs_chow_p0: EXTRA } };
    expect(siblingDefaultPathways(wrapper)).toBe(BLOCK);
    expect(siblingPathwaysByContrast(wrapper)).toEqual({ hfd_vs_chow_p0: EXTRA });
  });

  it('null/undefined siblings unwrap to null on both accessors', () => {
    expect(siblingDefaultPathways(null)).toBeNull();
    expect(siblingDefaultPathways(undefined)).toBeNull();
    expect(siblingPathwaysByContrast(null)).toBeNull();
    expect(siblingPathwaysByContrast(undefined)).toBeNull();
  });

  // The strict resolver the cross-dataset query and the index builder share.
  // `source` is load-bearing, not decoration: build_query_index audits on it,
  // so a flipped tag turns a loud "unverifiable attribution" warning silent.
  describe('strictSiblingPathwaysFor', () => {
    const WRAPPER = { default: BLOCK, byContrast: { hfd_vs_chow_p0: EXTRA } };
    const DEFAULT_ID = 'hfd_vs_chow_p21';

    it('serves an explicit byContrast block, witnessed by its key', () => {
      expect(strictSiblingPathwaysFor(WRAPPER, 'hfd_vs_chow_p0', DEFAULT_ID))
        .toEqual({ db: EXTRA, source: 'explicit' });
    });

    it('lets the registered default fall back to `default`, tagged unverifiable', () => {
      expect(strictSiblingPathwaysFor(WRAPPER, DEFAULT_ID, DEFAULT_ID))
        .toEqual({ db: BLOCK, source: 'legacy-default' });
    });

    it('refuses a wrapper for a non-default contrast it does not carry', () => {
      // Must NOT hand back `default` — that would label the default's
      // enrichment as another contrast's.
      expect(strictSiblingPathwaysFor(WRAPPER, 'not_carried', DEFAULT_ID))
        .toEqual({ db: null, source: 'refused' });
    });

    it('refuses a wrapper when no contrast is named', () => {
      expect(strictSiblingPathwaysFor(WRAPPER, undefined, DEFAULT_ID).source).toBe('refused');
    });

    it('serves a plain sibling only to the registered default, tagged legacy-plain', () => {
      expect(strictSiblingPathwaysFor(BLOCK, DEFAULT_ID, DEFAULT_ID))
        .toEqual({ db: BLOCK, source: 'legacy-plain' });
      expect(strictSiblingPathwaysFor(BLOCK, 'other', DEFAULT_ID))
        .toEqual({ db: null, source: 'refused' });
    });

    it('serves a plain sibling when NEITHER side names a contrast', () => {
      // An unregistered caller reading a legacy bundle: both ids undefined.
      // The index depends on this; a "require a truthy id" tightening would
      // silently drop every legacy bundle's pathway rows.
      expect(strictSiblingPathwaysFor(BLOCK, undefined, undefined))
        .toEqual({ db: BLOCK, source: 'legacy-plain' });
      expect(strictSiblingPathwaysFor(WRAPPER, undefined, undefined).source).toBe('refused');
    });

    it('refuses a missing sibling', () => {
      expect(strictSiblingPathwaysFor(null, DEFAULT_ID, DEFAULT_ID))
        .toEqual({ db: null, source: 'refused' });
      expect(strictSiblingPathwaysFor(undefined, DEFAULT_ID, DEFAULT_ID).source).toBe('refused');
    });
  });
});
