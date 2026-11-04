import { describe, it, expect } from 'vitest';
import { contrastArmCounts, defaultArmCounts, getActiveContrast } from '../data/contrasts';
import { getDataset } from '../data/datasets';
import { groupSampleTooltip } from '../utils/sampleIds';
import type { DatasetMeta, ResolvedContrast } from '../types';

// REGRESSION — the browse surfaces printed the POOLED arms' counts beside the
// DEFAULT CONTRAST's labels.
//
// `qcFlags` carries one pair per track, always the study's pooled control/case;
// the labels next to it come from the resolved default contrast. Those agreed
// for every dataset right up until GSE135639's age-adjusted contrast was removed
// and the P21 cell became its default — at which point the library card, the
// study record's Replicates row and the Compare header all read
// "8 Chow · P21 vs 9 HFD · P21" for cells holding 3 and 4. Right labels, wrong
// numbers, and `nVaries` false (one track), so nothing softened the claim.
//
// The failure is silent by construction: a plausible integer beside a correct
// label. These pin the derivation, on the real registry rather than a fixture,
// so the next dataset whose default sits on design cells cannot re-open it.

// GSE135639's real shape: pooled 8 v 9 across the two diets, and the four
// design cells underneath. Only `groupN` knows the cells.
const POMC_META: DatasetMeta = {
  populations: ['pomc'],
  labels: { pomc: 'Arcuate POMC neurons (RiboTag)' },
  types: { pomc: 'Tissue' },
  nGenes: { pomc: 15230 },
  colors: { pomc: '#3775BA' },
  qcFlags: { pomc: { nNormal: 8, nObese: 9, status: 'ok' } },
  groupN: { control: 8, case: 9, chow_p0: 5, chow_p21: 3, hfd_p0: 5, hfd_p21: 4 },
};

describe('defaultArmCounts', () => {
  it('reports the default contrast\'s cells, not the pooled pair', () => {
    const ds = getDataset('mouse_pomc_maternal_hfd_gse135639')!;
    const contrast = getActiveContrast(ds)!;
    // Guard the premise: if the default ever moves back onto the pooled arms
    // this test would pass for the wrong reason.
    expect(contrast.baseline.key).toBe('chow_p21');
    expect(contrast.caseGroup.key).toBe('hfd_p21');

    expect(defaultArmCounts(ds, POMC_META, POMC_META.qcFlags?.pomc))
      .toEqual({ nBaseline: 3, nCase: 4 });
  });

  it('is a no-op for a dataset whose default contrast IS the pooled pair', () => {
    // The reason this fix changes exactly one card: where the default compares
    // control vs case, groupN's entries for those keys ARE nNormal/nObese.
    const ds = getDataset('mouse_arc_hfd_gse225038')!;
    const meta: DatasetMeta = {
      populations: ['arcuate'],
      labels: { arcuate: 'Arcuate nucleus' },
      types: { arcuate: 'Tissue' },
      nGenes: { arcuate: 12345 },
      colors: { arcuate: '#3775BA' },
      qcFlags: { arcuate: { nNormal: 4, nObese: 4, status: 'ok' } },
      groupN: { control: 4, case: 4 },
    };
    expect(defaultArmCounts(ds, meta, meta.qcFlags?.arcuate))
      .toEqual({ nBaseline: 4, nCase: 4 });
  });

  it('falls back to the pooled pair when the bundle predates groupN', () => {
    // An older meta.js has no groupN at all. Degrading to today's numbers keeps
    // a stale bundle showing what it always showed; degrading to null would
    // blank the replicate counts on every card the moment this landed.
    const ds = getDataset('mouse_pomc_maternal_hfd_gse135639')!;
    const { groupN: _dropped, ...noGroupN } = POMC_META;
    expect(defaultArmCounts(ds, noGroupN as DatasetMeta, noGroupN.qcFlags?.pomc))
      .toEqual({ nBaseline: 8, nCase: 9 });
  });

  it('falls back per-arm when groupN is missing only one of the two keys', () => {
    // Half a fallback is the dangerous case: pairing one cell count with one
    // pooled count would read as a design the study does not have.
    const ds = getDataset('mouse_pomc_maternal_hfd_gse135639')!;
    const partial: DatasetMeta = { ...POMC_META, groupN: { chow_p21: 3 } };
    expect(defaultArmCounts(ds, partial, partial.qcFlags?.pomc))
      .toEqual({ nBaseline: 3, nCase: 9 });
  });

  it('yields nulls rather than throwing when there is nothing to read', () => {
    const ds = getDataset('mouse_pomc_maternal_hfd_gse135639')!;
    expect(defaultArmCounts(ds, null, null)).toEqual({ nBaseline: null, nCase: null });
    expect(defaultArmCounts(null, POMC_META, undefined)).toEqual({ nBaseline: null, nCase: null });
  });
});

const ACTIVE_CONTRAST = {
  id: 'active',
  baseline: { key: 'normal', label: 'Normal', color: '#4C78A8' },
  caseGroup: { key: 'obese', label: 'Obese', color: '#E45756' },
  supportsPathways: false,
  label: 'Obese vs Normal',
} as ResolvedContrast;

describe('contrastArmCounts', () => {
  it('counts kept group membership before aggregate QC and delegates tooltips', () => {
    const groupSamples = {
      normal: ['S001', 'S002', 'S003'],
      obese: ['S004', 'S005', 'S006'],
    };
    const samplesKept = ['S001', 'S002', 'S004', 'S005', 'S006'];
    const result = contrastArmCounts(
      ACTIVE_CONTRAST,
      { groupSamples, qc: { samplesKept, nNormal: 3, nObese: 3 } },
      null,
      'e9',
    );

    expect(result.nBaseline).toBe(2);
    expect(result.nCase).toBe(3);
    expect(result.baselineTitle).toBe(
      groupSampleTooltip(groupSamples, samplesKept, ACTIVE_CONTRAST.baseline),
    );
    expect(result.caseTitle).toBe(
      groupSampleTooltip(groupSamples, samplesKept, ACTIVE_CONTRAST.caseGroup),
    );
  });

  it('keeps full membership authoritative over a low aggregate pair', () => {
    expect(contrastArmCounts(
      ACTIVE_CONTRAST,
      {
        groupSamples: {
          normal: ['N1', 'N2', 'N3'],
          obese: ['O1', 'O2', 'O3'],
        },
        qc: {
          samplesKept: ['N1', 'N2', 'N3', 'O1', 'O2', 'O3'],
          nNormal: 2,
          nObese: 3,
        },
      },
      null,
      'e9',
    )).toMatchObject({ nBaseline: 3, nCase: 3 });
  });

  it('uses loaded QC when group membership is absent', () => {
    expect(contrastArmCounts(
      ACTIVE_CONTRAST,
      { qc: { nNormal: 2, nObese: 3 } },
      null,
      'e9',
    )).toEqual({
      nBaseline: 2, nCase: 3, baselineTitle: undefined, caseTitle: undefined,
    });
  });

  it('uses per-track meta qcFlags when the track bundle has no counts', () => {
    expect(contrastArmCounts(
      ACTIVE_CONTRAST,
      null,
      { qcFlags: { e9: { nNormal: 7, nObese: 8 } } } as any,
      'e9',
    )).toEqual({
      nBaseline: 7, nCase: 8, baselineTitle: undefined, caseTitle: undefined,
    });
  });

  it('answers factorial cells from groupN before the pooled fallback', () => {
    const factorial = {
      ...ACTIVE_CONTRAST,
      baseline: { key: 'chow_p0', label: 'Chow · P0', color: '#4C78A8' },
      caseGroup: { key: 'hfd_p0', label: 'HFD · P0', color: '#E45756' },
    };
    expect(contrastArmCounts(
      factorial,
      null,
      {
        groupN: { chow_p0: 5, hfd_p0: 5, control: 8, case: 9 },
        qcFlags: { pomc: { nNormal: 8, nObese: 9 } },
      } as any,
      'pomc',
    )).toMatchObject({ nBaseline: 5, nCase: 5 });
  });

  it('falls back independently for each arm', () => {
    expect(contrastArmCounts(
      ACTIVE_CONTRAST,
      {
        groupSamples: { normal: ['N1'], obese: [] },
        qc: { samplesKept: ['N1'], nNormal: 8, nObese: 9 },
      },
      { groupN: { obese: 4 } },
      'e9',
    )).toMatchObject({ nBaseline: 1, nCase: 4 });
  });

  it('returns zero when non-empty membership is entirely QC-dropped', () => {
    expect(contrastArmCounts(
      ACTIVE_CONTRAST,
      {
        groupSamples: { normal: ['N1'], obese: ['O1'] },
        qc: { samplesKept: [], nNormal: 8, nObese: 9 },
      },
      null,
      'e9',
    )).toMatchObject({ nBaseline: 0, nCase: 0 });
  });

  it('falls through empty membership arrays without treating them as zero', () => {
    expect(contrastArmCounts(
      ACTIVE_CONTRAST,
      {
        groupSamples: { normal: [], obese: [] },
        qc: { nNormal: 8, nObese: 9 },
      },
      { groupN: { normal: 0 } },
      'e9',
    )).toMatchObject({ nBaseline: 0, nCase: 9 });
  });

  it('uses the legacy chain directly when the contrast has no groups', () => {
    expect(contrastArmCounts(
      null,
      { qc: { nNormal: 4, nObese: 5 } },
      { qcFlags: { e9: { nNormal: 7, nObese: 8 } } } as any,
      'e9',
    )).toEqual({
      nBaseline: 4, nCase: 5, baselineTitle: undefined, caseTitle: undefined,
    });
  });

  it('returns null counts and undefined titles when no tier answers', () => {
    expect(contrastArmCounts(ACTIVE_CONTRAST, null, {}, 'e9')).toEqual({
      nBaseline: null, nCase: null, baselineTitle: undefined, caseTitle: undefined,
    });
  });
});
