import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetBundleCache, _setBundleTransport, type BundleOutcome, type BundleTransport,
} from '../data/bundleSource';
import { defineDataset } from '../data/datasets';
import type { TimeSeriesBundle } from '../types';
import {
  ALL_ARMS, armChoices, geneList, loadTimeSeries, seriesFor, summarizeGene,
} from '../circadian/timeSeriesSource';
import { adjustRows, scanRhythmicity } from '../circadian/scan';
import { rawValueRows } from '../circadian/circadianExport';
import { DEFAULT_PERIODS } from '../circadian/rhythmicity';

// A 2-arm, 3-timepoint, 2-replicate series: the smallest shape that still
// exercises arm filtering, replicate aggregation and a null cell.
function fixture(): TimeSeriesBundle {
  const samples = [] as TimeSeriesBundle['meta']['samples'];
  for (const arm of ['control', 'case']) {
    for (const time of [0, 8, 16]) {
      for (let replicate = 1; replicate <= 2; replicate++) {
        samples.push({ id: `${arm}_${time}_${replicate}`, arm, time, replicate });
      }
    }
  }
  return {
    meta: {
      trackId: 'scn',
      label: 'Test track',
      cycleHours: 24,
      timeUnit: 'CT',
      expressionUnit: 'CPM',
      arms: [
        { key: 'control', label: 'Control', color: '#3775BA' },
        { key: 'case', label: 'Treated', color: '#B64342' },
      ],
      samples,
      timepoints: [0, 8, 16],
      nGenes: 3,
    },
    values: {
      // control 0,8,16 = 10,20,30 (dupes) | case = 5,5,5
      Rhythmic: [10, 10, 20, 20, 30, 30, 5, 5, 5, 5, 5, 5],
      // One dropped library in the control arm.
      Gappy: [1, null, 3, 3, 5, 5, 2, 2, 2, 2, 2, 2],
      Flat: [7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7],
    },
  };
}

const dataset = defineDataset({
  id: 'test_ts',
  // Pin the base, like every other dataset fixture: defineDataset defaults
  // bundleBaseUrl to BUNDLE_BASE, which reads VITE_BUNDLE_BASE_URL. The test
  // envDir keeps a developer's .env.local out of the suite, but leaving the
  // default here still couples this file's bare-path assertion to ambient
  // build config — it surfaced as an order-dependent failure asserting the R2
  // origin. The sibling-locator contract under test is the track_ →
  // timeseries_ rewrite; off-origin prefixing is datasets.test.ts's job.
  bundleBaseUrl: '',
  category: 'Circadian',
  name: 'Test dataset',
  organism: 'Mus musculus',
  modality: 'bulk RNA-seq',
  region: 'Suprachiasmatic nucleus',
  perturbation: 'Diet & obesity',
  preparation: 'Bulk tissue',
  featureType: 'gene',
  featureLabel: 'Gene',
  supportsPathways: false,
  citation: 'test',
  isDefault: false,
  defaultTrack: 'scn',
  trackCategoryOrder: ['Tissue'],
  groups: [
    { key: 'control', label: 'Control', color: '#3775BA' },
    { key: 'case', label: 'Treated', color: '#B64342' },
  ],
  contrasts: [{ id: 'c', baseline: 'control', case: 'case', isDefault: true }],
  timeSeries: { tracks: ['scn'], cycleHours: 24, timeUnit: 'CT', design: 'test design' },
});

describe('seriesFor', () => {
  it('returns only the requested arm, at its own sampling times', () => {
    const s = seriesFor(fixture(), 'Rhythmic', 'control');
    expect(s.times).toEqual([0, 0, 8, 8, 16, 16]);
    expect(s.values).toEqual([10, 10, 20, 20, 30, 30]);
  });

  it('pools every arm under ALL_ARMS', () => {
    const s = seriesFor(fixture(), 'Rhythmic', ALL_ARMS);
    expect(s.values).toHaveLength(12);
    expect(s.times.filter((t) => t === 0)).toHaveLength(4);
  });

  it('drops null cells instead of zero-filling them', () => {
    const s = seriesFor(fixture(), 'Gappy', 'control');
    // The dropped library would otherwise enter the fit as a 0 CPM trough.
    expect(s.values).toEqual([1, 3, 3, 5, 5]);
    expect(s.times).toEqual([0, 8, 8, 16, 16]);
    expect(s.values).not.toContain(0);
  });

  it('returns an empty series for an unknown gene', () => {
    expect(seriesFor(fixture(), 'Nope', 'control')).toEqual({ times: [], values: [] });
  });
});

describe('summarizeGene', () => {
  it('aggregates per arm and per timepoint, keeping the replicate values', () => {
    const [control, treated] = summarizeGene(fixture(), 'Rhythmic');
    expect(control.arm.label).toBe('Control');
    expect(control.timepoints.map((t) => t.time)).toEqual([0, 8, 16]);
    expect(control.timepoints.map((t) => t.mean)).toEqual([10, 20, 30]);
    expect(control.timepoints[0].points).toEqual([10, 10]);
    // Identical replicates have no spread.
    expect(control.timepoints[0].sem).toBe(0);
    expect(treated.timepoints.every((t) => t.mean === 5)).toBe(true);
  });

  it('reports a real SEM and an n that follows the surviving libraries', () => {
    const [control] = summarizeGene(fixture(), 'Gappy');
    const t0 = control.timepoints.find((t) => t.time === 0);
    expect(t0?.n).toBe(1);
    expect(t0?.sem).toBe(0);
    expect(control.timepoints.find((t) => t.time === 8)?.n).toBe(2);
  });
});

describe('armChoices', () => {
  it('offers a pooled pseudo-arm when there is more than one arm', () => {
    expect(armChoices(fixture()).map((a) => a.key)).toEqual(['control', 'case', ALL_ARMS]);
  });

  it('offers no pooled arm for a single-arm series (it would duplicate it)', () => {
    const b = fixture();
    b.meta.arms = [b.meta.arms[0]];
    expect(armChoices(b).map((a) => a.key)).toEqual(['control']);
  });
});

describe('geneList', () => {
  it('preserves bundle order, which is the DE rank order', () => {
    expect(geneList(fixture())).toEqual(['Rhythmic', 'Gappy', 'Flat']);
  });
});

describe('loadTimeSeries', () => {
  beforeEach(() => { _resetBundleCache(); });
  afterEach(() => { _setBundleTransport(null); _resetBundleCache(); });

  it('resolves the sibling bundle from the track locators', async () => {
    const seen: string[] = [];
    const transport: BundleTransport = (url) => {
      seen.push(url);
      return Promise.resolve<BundleOutcome>({ status: 'ok', value: fixture() });
    };
    _setBundleTransport(transport);
    const b = await loadTimeSeries(dataset, 'scn');
    expect(b?.meta.trackId).toBe('scn');
    expect(seen).toEqual(['/datasets/test_ts/timeseries_scn.js']);
  });

  it('resolves null without a request for a track that declares no time course', async () => {
    const seen: string[] = [];
    _setBundleTransport((url) => {
      seen.push(url);
      return Promise.resolve<BundleOutcome>({ status: 'ok', value: fixture() });
    });
    await expect(loadTimeSeries(dataset, 'other')).resolves.toBeNull();
    expect(seen).toEqual([]);
  });

  it('labels values with the registry unit, not the one stamped in the bundle', async () => {
    _setBundleTransport(() => Promise.resolve<BundleOutcome>({ status: 'ok', value: fixture() }));
    const relabelled = { ...dataset, expressionUnit: 'log2(FPKM + 1)' };
    expect((await loadTimeSeries(relabelled, 'scn'))?.meta.expressionUnit).toBe('log2(FPKM + 1)');
    // Without a registry unit the bundle's own label stands.
    _resetBundleCache();
    expect((await loadTimeSeries({ ...dataset, expressionUnit: undefined }, 'scn'))?.meta.expressionUnit).toBe('CPM');
  });

  it('resolves null (not a rejection) when the bundle is absent', async () => {
    _setBundleTransport(() => Promise.resolve<BundleOutcome>({ status: 'load-failed' }));
    await expect(loadTimeSeries(dataset, 'scn')).resolves.toBeNull();
  });
});

describe('scanRhythmicity', () => {
  it('scores every gene the test can score, and skips the ones it cannot', async () => {
    const rows = await scanRhythmicity(fixture(), { method: 'cosinor', arm: 'control', periods: DEFAULT_PERIODS });
    expect(rows?.map((r) => r.gene).sort()).toEqual(['Flat', 'Gappy', 'Rhythmic']);
    // A flat gene is scored, and scored as non-rhythmic — not dropped.
    expect(rows?.find((r) => r.gene === 'Flat')?.p).toBe(1);
  });

  it('reports progress over the whole gene list', async () => {
    const seen: Array<[number, number]> = [];
    await scanRhythmicity(
      fixture(), { method: 'jtk', arm: 'control', periods: DEFAULT_PERIODS },
      (done, total) => seen.push([done, total]),
    );
    expect(seen.at(-1)).toEqual([3, 3]);
  });

  it('resolves null when aborted rather than rejecting', async () => {
    const signal = { aborted: true };
    const rows = await scanRhythmicity(
      fixture(), { method: 'jtk', arm: 'control', periods: DEFAULT_PERIODS }, undefined, signal,
    );
    expect(rows).toBeNull();
  });
});

describe('adjustRows', () => {
  it('attaches q without disturbing the raw p', async () => {
    const rows = await scanRhythmicity(
      fixture(), { method: 'cosinor', arm: 'control', periods: DEFAULT_PERIODS },
    );
    const adjusted = adjustRows(rows ?? [], 'bonferroni');
    adjusted.forEach((r, i) => {
      expect(r.p).toBe((rows ?? [])[i].p);
      expect(r.q).toBeGreaterThanOrEqual(r.p);
    });
  });
});

describe('rawValueRows', () => {
  it('emits one tidy row per gene × surviving library', () => {
    const rows = rawValueRows(fixture(), ['Gappy']);
    // 12 libraries minus the one null cell.
    expect(rows).toHaveLength(11);
    expect(rows[0]).toEqual({
      Gene: 'Gappy',
      Sample: 'control_0_1',
      Arm: 'Control',
      TimeHours: 0,
      TimeLabel: 'CT0',
      Replicate: 1,
      NormCPM: 1,
    });
    // The dropped library appears nowhere.
    expect(rows.some((r) => r.Sample === 'control_0_2')).toBe(false);
  });

  it('skips a gene the bundle does not carry rather than emitting blanks', () => {
    expect(rawValueRows(fixture(), ['Nope'])).toEqual([]);
  });
});
