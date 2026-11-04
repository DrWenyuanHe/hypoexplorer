import { describe, it, expect, vi } from 'vitest';
import { buildPopData, _resetBuildPopDataWarnings } from '../data/buildPopData';
import { getActiveContrast } from '../data/contrasts';
import { getPopData } from '../data/popCache';
import type { Dataset, RawTrack } from '../types';
import {
  POP_E9_FIXTURE,
  MACAQUE_DATASET,
  MACAQUE_CONTRAST,
  HX_MACAQUE_SNRNA_E9_FIXTURE,
  BULK_DATASET_FIXTURE,
  BULK_TRACK_FIXTURE,
  MIRNA_DATASET_FIXTURE,
  MIRNA_TRACK_FIXTURE,
  MULTICONTRAST_DATASET_FIXTURE,
  MULTICONTRAST_TRACK_FIXTURE,
} from './fixtures';

describe('buildPopData — macaque dataset + default contrast', () => {
  it('keeps de/deByGene/geneNames/cpm/qc/volcanoPts/meta and adds contrast/groups/groupSamples/sampleOrder', () => {
    const pd = buildPopData(HX_MACAQUE_SNRNA_E9_FIXTURE, MACAQUE_DATASET, MACAQUE_CONTRAST)!;
    expect(pd.dataset).toBe(MACAQUE_DATASET);
    expect(pd.de).toBe(HX_MACAQUE_SNRNA_E9_FIXTURE.de);
    expect(pd.geneNames).toEqual(['POMC', 'IP6K1', 'TBX3']);
    expect(pd.deByGene.POMC!.logFC).toBe(1.2);
    expect(pd.cpm).toBe(HX_MACAQUE_SNRNA_E9_FIXTURE.cpm);
    expect(pd.volcanoPts.length).toBe(3);
    // The macaque contrast passed in is obese_vs_normal.
    expect(pd.contrast!.id).toBe('obese_vs_normal');
    expect(pd.groups.map(g => g.key)).toEqual(['normal', 'obese']);
    // groupSamples comes straight from the migrated meta.
    expect(pd.groupSamples).toEqual(HX_MACAQUE_SNRNA_E9_FIXTURE.meta!.groupSamples);
    expect(pd.sampleOrder).toEqual(HX_MACAQUE_SNRNA_E9_FIXTURE.meta!.sampleNames);
  });

  it('flattens pathways into allPathways with 4 distinct db tags', () => {
    const pd = buildPopData(HX_MACAQUE_SNRNA_E9_FIXTURE, MACAQUE_DATASET, MACAQUE_CONTRAST)!;
    const dbs = new Set(pd.allPathways.map(p => p.db));
    expect(dbs).toEqual(new Set(['GO_BP', 'HALLMARK', 'KEGG', 'REACTOME']));
  });

  it('derives groupSamples/sampleOrder from legacy normalSamples/obeseSamples when meta lacks them', () => {
    // POP_E9_FIXTURE.meta has NO sampleOrder / groupSamples — only the legacy fields.
    const pd = buildPopData(POP_E9_FIXTURE, MACAQUE_DATASET, MACAQUE_CONTRAST)!;
    expect(pd.groupSamples).toEqual({
      normal: POP_E9_FIXTURE.meta!.normalSamples,
      obese: POP_E9_FIXTURE.meta!.obeseSamples,
    });
    expect(pd.sampleOrder).toEqual(POP_E9_FIXTURE.meta!.sampleNames);
  });
});

describe('buildPopData — volcano points', () => {
  it('plots null FDR (unknown, from R NA) at yFdr 0, never as maximally significant', () => {
    const raw: RawTrack = {
      meta: { code: 'x', label: 'x', type: 'X', sampleNames: ['a', 'b'], normalSamples: ['a'], obeseSamples: ['b'], nGenes: 2 },
      de: [
        { gene: 'KNOWN', logFC: 1, PValue: 0.001, FDR: 0.01, rank_score: 1, rankPos: 1 },
        { gene: 'UNKNOWN_FDR', logFC: 1, PValue: 0.001, FDR: null, rank_score: 0.5, rankPos: 2 },
      ],
      cpm: {},
    };
    const pd = buildPopData(raw, MACAQUE_DATASET, MACAQUE_CONTRAST)!;
    const known = pd.volcanoPts.find(p => p.gene === 'KNOWN')!;
    const unknown = pd.volcanoPts.find(p => p.gene === 'UNKNOWN_FDR')!;
    expect(known.yFdr).toBeCloseTo(2, 5);
    // The regression this pins: `?? 0` turned null FDR into -log10(1e-300) = 300.
    expect(unknown.yFdr).toBe(0);
    expect(unknown.fdr).toBeNull();
  });
});

describe('buildPopData — null guards', () => {
  it('returns null for a null raw track', () => {
    expect(buildPopData(null, MACAQUE_DATASET, MACAQUE_CONTRAST)).toBeNull();
  });

  it('guards a track with no de array (de defaults to [])', () => {
    const raw = {
      meta: { code: 'x', label: 'x', type: 'X', sampleNames: ['a', 'b'], normalSamples: ['a'], obeseSamples: ['b'], nGenes: 0 },
      qc: null,
      cpm: {},
      // no `de` key on purpose
    } as unknown as RawTrack;
    const pd = buildPopData(raw, MACAQUE_DATASET, MACAQUE_CONTRAST)!;
    expect(pd.de).toEqual([]);
    expect(pd.deByGene).toEqual({});
    expect(pd.geneNames).toEqual([]);
    expect(pd.volcanoPts).toEqual([]);
  });

  it('guards an explicit de:null (does not throw on .map)', () => {
    // `de` present but null — the `?? []` coalesce must catch this, not just a
    // missing key, so buildPopData({de:null}) never reaches null.map().
    const raw = {
      meta: { sampleNames: ['a', 'b'], normalSamples: ['a'], obeseSamples: ['b'] },
      qc: null,
      cpm: {},
      de: null,
    } as unknown as RawTrack;
    const pd = buildPopData(raw, MACAQUE_DATASET, MACAQUE_CONTRAST)!;
    expect(pd.de).toEqual([]);
    expect(pd.geneNames).toEqual([]);
    expect(pd.volcanoPts).toEqual([]);
  });
});

describe('buildPopData — modality: supportsPathways', () => {
  it('BULK dataset (supportsPathways:true) flattens its pathways', () => {
    const pd = buildPopData(BULK_TRACK_FIXTURE, BULK_DATASET_FIXTURE, getActiveContrast(BULK_DATASET_FIXTURE))!;
    expect(pd.allPathways.length).toBeGreaterThan(0);
    expect(pd.allPathways.some(p => p.db === 'GO_BP')).toBe(true);
    expect(pd.contrast!.baseline.key).toBe('chow');
    expect(pd.groupSamples.chow).toHaveLength(5);
    expect(pd.groupSamples.hfd).toHaveLength(5);
  });

  it('miRNA dataset (supportsPathways:false, no pathways block) → allPathways=[]', () => {
    const pd = buildPopData(MIRNA_TRACK_FIXTURE, MIRNA_DATASET_FIXTURE, getActiveContrast(MIRNA_DATASET_FIXTURE))!;
    expect(pd.allPathways).toEqual([]);
    expect(pd.contrast!.supportsPathways).toBe(false);
    expect(pd.geneNames).toEqual(['miR-200a-3p', 'miR-133b']);
  });

  it('allPathways is [] even if a pathways block exists when the dataset opts out', () => {
    // Hand a bulk track (which HAS pathways) to a dataset declaring supportsPathways:false.
    const noPathwaysDataset = { ...BULK_DATASET_FIXTURE, supportsPathways: false };
    const pd = buildPopData(BULK_TRACK_FIXTURE, noPathwaysDataset, getActiveContrast(noPathwaysDataset))!;
    expect(pd.allPathways).toEqual([]);
  });
});

describe('buildPopData — multi-contrast selection', () => {
  const ds = MULTICONTRAST_DATASET_FIXTURE;

  it('selects the active contrast’s deByContrast table + pathways', () => {
    // Default contrast (fast24_vs_fed): IGFBP2 down, FOS up; fasting pathway.
    const fast = buildPopData(MULTICONTRAST_TRACK_FIXTURE, ds, getActiveContrast(ds))!;
    expect(fast.contrast!.id).toBe('fast24_vs_fed');
    expect(fast.deByGene.IGFBP2!.logFC).toBe(-1.4);
    expect(fast.deByGene.FOS!.logFC).toBe(2.1);
    expect(fast.allPathways.map(p => p.pathway)).toContain('GOBP_RESPONSE_TO_FASTING');

    // Other contrast (refed_vs_fed): different DE table + different pathway.
    const refed = buildPopData(MULTICONTRAST_TRACK_FIXTURE, ds, getActiveContrast(ds, 'refed_vs_fed'))!;
    expect(refed.contrast!.id).toBe('refed_vs_fed');
    expect(refed.deByGene.IGFBP2!.logFC).toBe(0.3);
    expect(refed.deByGene.FOS!.logFC).toBe(-0.5);
    expect(refed.allPathways.map(p => p.pathway)).toContain('GOBP_RESPONSE_TO_NUTRIENT_LEVELS');
  });

  it('groups reflect the active contrast’s baseline/case (shared fed baseline)', () => {
    const refed = buildPopData(MULTICONTRAST_TRACK_FIXTURE, ds, getActiveContrast(ds, 'refed_vs_fed'))!;
    expect(refed.groups.map(g => g.key)).toEqual(['fed', 'refed']);
    // groupSamples carries ALL three groups regardless of the active contrast.
    expect(Object.keys(refed.groupSamples).sort()).toEqual(['fast24', 'fed', 'refed']);
  });

  it('does not substitute the default results for a missing non-default comparison', () => {
    _resetBuildPopDataWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const legacyTrack: RawTrack = {
        ...MULTICONTRAST_TRACK_FIXTURE,
        deByContrast: undefined,
        pathwaysByContrast: undefined,
      };
      const pd = buildPopData(legacyTrack, ds, getActiveContrast(ds, 'refed_vs_fed'))!;
      expect(pd.de).toEqual([]);
      expect(pd.allPathways).toEqual([]);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toMatch(/results are unavailable/);
      // Warned ONCE per bundle, not once per render.
      buildPopData(legacyTrack, ds, getActiveContrast(ds, 'refed_vs_fed'));
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps explicit non-default DE while refusing an absent pathway table', () => {
    const raw = { ...MULTICONTRAST_TRACK_FIXTURE, pathwaysByContrast: undefined };
    const pd = buildPopData(raw, ds, getActiveContrast(ds, 'refed_vs_fed'))!;
    expect(pd.deByGene.IGFBP2!.logFC).toBe(0.3);
    expect(pd.allPathways).toEqual([]);
    const defaultData = buildPopData(raw, ds, getActiveContrast(ds))!;
    expect(defaultData.allPathways.map(p => p.pathway)).toContain('GOBP_RESPONSE_TO_FASTING');
  });

  it('does NOT warn for a single-contrast dataset on the legacy `de` field', () => {
    // The legitimate legacy case: every shipped single-contrast bundle. A
    // warning here would fire on almost the whole corpus.
    _resetBuildPopDataWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      buildPopData(BULK_TRACK_FIXTURE, BULK_DATASET_FIXTURE, getActiveContrast(BULK_DATASET_FIXTURE));
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('does NOT warn on the DEFAULT contrast, whose table lives in `de` by format', () => {
    // The shape the bundle BUILDER actually emits, which the shared fixture
    // does not model: `de` carries the default contrast's table and
    // `deByContrast` carries only the others - the same split the pathway
    // sibling spells out as `{ default, byContrast }`. On the default contrast
    // the fallback to `de` is the format working as designed, so warning there
    // fires on every correct multi-contrast bundle, on the contrast that loads
    // first. Regression guard: the shipped GSE135639 bundle did exactly this.
    _resetBuildPopDataWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const builderShaped: RawTrack = {
        ...MULTICONTRAST_TRACK_FIXTURE,
        deByContrast: { refed_vs_fed: MULTICONTRAST_TRACK_FIXTURE.deByContrast!.refed_vs_fed },
      };
      const pd = buildPopData(builderShaped, ds, getActiveContrast(ds))!;
      expect(warn).not.toHaveBeenCalled();
      // ...and it read the right numbers: `de` IS the default contrast's table.
      expect(pd.contrast!.id).toBe('fast24_vs_fed');
      expect(pd.deByGene.IGFBP2!.logFC).toBe(-1.4);

      // The non-default contrast still resolves from its own entry, silently.
      expect(buildPopData(builderShaped, ds, getActiveContrast(ds, 'refed_vs_fed'))!
        .deByGene.IGFBP2!.logFC).toBe(0.3);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('warns DIFFERENTLY for an EMPTY per-contrast table - no fallback applies', () => {
    // The other half of the stale-bundle fault, and the quieter one: deTableFor
    // coalesces with `??`, so an empty array counts as present and the explorer
    // renders nothing rather than the default contrast's numbers. The warning
    // must say that, not claim a fallback that did not happen.
    _resetBuildPopDataWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const emptyTable: RawTrack = {
        ...MULTICONTRAST_TRACK_FIXTURE,
        deByContrast: { ...MULTICONTRAST_TRACK_FIXTURE.deByContrast, refed_vs_fed: [] },
      };
      const pd = buildPopData(emptyTable, ds, getActiveContrast(ds, 'refed_vs_fed'))!;
      expect(pd.deByGene).toEqual({});
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toMatch(/EMPTY DE table/);
      expect(warn.mock.calls[0][0]).not.toMatch(/falling back/);
    } finally {
      warn.mockRestore();
    }
  });

  it('warns per CONTRAST, so a second broken contrast is not swallowed by the first', () => {
    // Needs TWO non-default contrasts: the default is exempt by format (see the
    // test below), so the 2-contrast fixture cannot show per-contrast keying.
    const ds3: Dataset = {
      ...ds,
      contrasts: [...ds.contrasts, { id: 'refed_vs_fast24', baseline: 'fast24', case: 'refed' }],
    };
    _resetBuildPopDataWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const legacyTrack: RawTrack = {
        ...MULTICONTRAST_TRACK_FIXTURE,
        deByContrast: undefined,
        pathwaysByContrast: undefined,
      };
      buildPopData(legacyTrack, ds3, getActiveContrast(ds3, 'refed_vs_fed'));
      buildPopData(legacyTrack, ds3, getActiveContrast(ds3, 'refed_vs_fast24'));
      expect(warn).toHaveBeenCalledTimes(2);
      // ...but still once each, not once per render.
      buildPopData(legacyTrack, ds3, getActiveContrast(ds3, 'refed_vs_fed'));
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('does NOT warn when the bundle DOES carry the active contrast\'s table', () => {
    _resetBuildPopDataWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      buildPopData(MULTICONTRAST_TRACK_FIXTURE, ds, getActiveContrast(ds, 'refed_vs_fed'));
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('getPopData cache — contrast keying', () => {
  it('returns DISTINCT transforms for the same raw track under different contrasts', () => {
    const ds = MULTICONTRAST_DATASET_FIXTURE;
    const raw = MULTICONTRAST_TRACK_FIXTURE;
    const a = getPopData(raw, ds, getActiveContrast(ds, 'fast24_vs_fed'))!;
    const b = getPopData(raw, ds, getActiveContrast(ds, 'refed_vs_fed'))!;
    // Not cross-served: each contrast yields its own table.
    expect(a.contrast!.id).toBe('fast24_vs_fed');
    expect(b.contrast!.id).toBe('refed_vs_fed');
    expect(a.deByGene.IGFBP2!.logFC).toBe(-1.4);
    expect(b.deByGene.IGFBP2!.logFC).toBe(0.3);
    expect(a).not.toBe(b);
    // But a repeat call for the same (raw, contrast) is memoized (same object).
    const aAgain = getPopData(raw, ds, getActiveContrast(ds, 'fast24_vs_fed'));
    expect(aAgain).toBe(a);
  });
});
