import { describe, it, expect } from 'vitest';
import { factsFromMeta, groupCountsFromMeta } from '../common/StudyMetadata';
import { getDataset } from '../data/datasets';
import { getActiveContrast } from '../data/contrasts';
import type { DatasetMeta } from '../types';

// The two adapters that turn a loaded `meta.js` into the record's numbers.
//
// They render into ADJACENT rows of one table, so they have to agree — about
// which track's QC blob they read, and about which comparison's arms the legacy
// pooled pair is allowed to be spent on. datasetInfo.test.tsx pins the track
// half through the rendered panel; this pins the contrast half, and the
// degenerate inputs (no meta, no populations, no QC for the resolved track)
// that a caller can reach before a bundle lands.

const dataset = getDataset('mouse_pomc_maternal_hfd_gse135639')!;

/** Populations name the registry's default track; qcFlags carry only the
 *  study's POOLED control/case pair, as every pre-groupN bundle does. */
const LEGACY_META: DatasetMeta = {
  populations: ['pomc'],
  labels: { pomc: 'POMC neurons' },
  types: { pomc: 'Neuronal' },
  nGenes: { pomc: 15000 },
  colors: { pomc: '#B64342' },
  qcFlags: { pomc: { is3v3: false, nNormal: 8, nObese: 9, status: 'ok' } },
};

const WITH_GROUP_N: DatasetMeta = {
  ...LEGACY_META,
  groupN: { control: 8, case: 9, chow_p0: 5, chow_p21: 3, hfd_p0: 5, hfd_p21: 4 },
};

describe('groupCountsFromMeta', () => {
  it('spends the legacy pooled pair on the arms of the contrast it was passed', () => {
    // GSE135639's DEFAULT contrast is the P21 cell pair. Passing the P0 one has
    // to move the two counts the legacy pair can supply onto the P0 cells —
    // otherwise the modal names the arms the user selected and prints the
    // default's numbers beside them.
    const p0 = getActiveContrast(dataset, 'hfd_vs_chow_p0');
    expect(groupCountsFromMeta(dataset, LEGACY_META, p0)).toEqual({
      byGroup: { chow_p0: 8, hfd_p0: 9 },
      track: 'pomc',
    });
    // Omitting the contrast resolves the dataset's default instead, and the same
    // two numbers land on the other pair of cells.
    expect(groupCountsFromMeta(dataset, LEGACY_META).byGroup).toEqual({ chow_p21: 8, hfd_p21: 9 });
  });

  it('lets meta.groupN answer every group regardless of the contrast', () => {
    // groupN is the real source; the contrast only decides where the legacy
    // FALLBACK may be spent, so a factorial bundle's counts must not shift with
    // the selection.
    const p0 = getActiveContrast(dataset, 'hfd_vs_chow_p0');
    const maturation = getActiveContrast(dataset, 'p21_vs_p0_chow');
    expect(groupCountsFromMeta(dataset, WITH_GROUP_N, p0).byGroup)
      .toEqual(groupCountsFromMeta(dataset, WITH_GROUP_N, maturation).byGroup);
    expect(groupCountsFromMeta(dataset, WITH_GROUP_N, p0).byGroup)
      .toEqual({ control: 8, case: 9, chow_p0: 5, chow_p21: 3, hfd_p0: 5, hfd_p21: 4 });
  });

  it('reports no track when the resolved track carries no QC to quote', () => {
    // The Groups row prints "(n for <track>)" off this field. A meta whose
    // resolved track has no qcFlags entry supplied no per-track number, so
    // qualifying the row with a track name would be a claim about nothing.
    const stale: DatasetMeta = {
      ...WITH_GROUP_N,
      populations: ['other'],
      qcFlags: { pomc: { is3v3: false, nNormal: 8, nObese: 9, status: 'ok' } },
    };
    const counts = groupCountsFromMeta(dataset, stale);
    expect(counts.track).toBeNull();
    // …while the counts groupN plainly holds are still reported.
    expect(counts.byGroup.chow_p21).toBe(3);
  });

  it('yields an empty map rather than throwing when no meta has loaded', () => {
    expect(groupCountsFromMeta(dataset, null)).toEqual({ byGroup: {}, track: null });
    expect(groupCountsFromMeta(dataset, undefined)).toEqual({ byGroup: {}, track: null });
  });
});

describe('factsFromMeta', () => {
  it('counts the arms of the contrast it was passed, not the default contrast', () => {
    const p0 = getActiveContrast(dataset, 'hfd_vs_chow_p0');
    const withContrast = factsFromMeta(dataset, WITH_GROUP_N, p0);
    expect([withContrast.nBaseline, withContrast.nCase]).toEqual([5, 5]);

    // The default path is unchanged, and it is a DIFFERENT pair — which is what
    // makes the assertion above meaningful.
    const byDefault = factsFromMeta(dataset, WITH_GROUP_N);
    expect([byDefault.nBaseline, byDefault.nCase]).toEqual([3, 4]);

    // Everything that is not per-arm is a dataset-level fact and must not move
    // with the selection.
    expect(withContrast.trackCount).toBe(byDefault.trackCount);
    expect(withContrast.nGenes).toBe(byDefault.nGenes);
  });

  it('returns empty facts when there is no meta and when the meta lists no tracks', () => {
    const empty = { trackCount: null, trackLabel: null, nGenes: null,
      nBaseline: null, nCase: null, nVaries: false, lowPowerTracks: 0 };
    expect(factsFromMeta(dataset, null)).toEqual(empty);
    // A meta with no populations cannot name a track, so every per-track fact is
    // unknown — including the arms, even though qcFlags still holds a pair. The
    // record covers that gap from groupCountsFromMeta rather than from here.
    expect(factsFromMeta(dataset, { ...LEGACY_META, populations: [] })).toEqual(empty);
  });
});
