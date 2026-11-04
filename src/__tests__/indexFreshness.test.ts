import { describe, expect, it } from 'vitest';
import {
  datasetFreshnessProblems,
  manifestFreshness,
  type FreshnessOptions,
  type Need,
} from '../data/indexFreshness';
import type { QueryManifest } from '../data/queryIndex';
import type { Dataset } from '../types';
import { BULK_DATASET_FIXTURE } from './fixtures';

function mkDataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    ...BULK_DATASET_FIXTURE,
    groups: BULK_DATASET_FIXTURE.groups.map((group) => ({ ...group })),
    contrasts: BULK_DATASET_FIXTURE.contrasts.map((contrast) => ({ ...contrast })),
    ...overrides,
  };
}

function mkManifest(): QueryManifest {
  return {
    v: 2,
    buildId: 'fresh',
    geneShards: 512,
    pathwayShards: 256,
    exprShards: 256,
    dbNames: [],
    trackCounts: { [BULK_DATASET_FIXTURE.id]: 1 },
    tracks: [{
      ds: BULK_DATASET_FIXTURE.id,
      trackId: 'whole',
      label: 'Whole hypothalamus',
      type: 'Tissue',
      lowPower: false,
    }],
    datasets: [{
      ds: BULK_DATASET_FIXTURE.id,
      trackCount: 1,
      defaultTrack: 'whole',
      trackLabel: 'Whole hypothalamus',
      nGenes: 2,
      nBaseline: 5,
      nCase: 5,
      nVaries: false,
      lowPowerTracks: 0,
      sampleOrder: ['C1', 'H1'],
      groupSamples: { chow: ['C1'], hfd: ['H1'] },
      contrastId: 'hfd_vs_chow',
      armKeys: ['chow', 'hfd'],
    }],
  };
}

interface Case {
  name: string;
  needs: Need[];
  manifest?: (manifest: QueryManifest) => void;
  dataset?: (dataset: Dataset) => void;
  metaFor?: FreshnessOptions['metaFor'];
  problems: string[];
}

const ALL_NEEDS: Need[] = ['coverage', 'trackCounts', 'defaultTrack', 'contrast', 'exprScaffold'];
const metaWhole: FreshnessOptions['metaFor'] = () => ({ populations: ['whole'] });

const CASES: Case[] = [
  { name: 'healthy for every need', needs: ALL_NEEDS, metaFor: metaWhole, problems: [] },
  {
    name: 'missing dataset coverage',
    needs: ['coverage'],
    manifest: (manifest) => { manifest.tracks = []; },
    problems: ['no tracks in the manifest'],
  },
  {
    name: 'ordered tracks disagree with metadata',
    needs: ['trackCounts'],
    metaFor: () => ({ populations: ['whole', 'arcuate'] }),
    problems: ['index tracks [whole], meta.js declares [whole, arcuate]'],
  },
  {
    name: 'unknown metadata is not stale',
    needs: ['trackCounts'],
    problems: [],
  },
  {
    name: 'derived track list catches old-manifest drift',
    needs: ['trackCounts'],
    manifest: (manifest) => { delete manifest.trackCounts; },
    metaFor: () => ({ populations: ['whole', 'arcuate'] }),
    problems: ['index tracks [whole], meta.js declares [whole, arcuate]'],
  },
  {
    name: 'trackCounts disagrees with manifest tracks',
    needs: ['trackCounts'],
    manifest: (manifest) => { manifest.trackCounts = { [BULK_DATASET_FIXTURE.id]: 2 }; },
    problems: ['trackCounts records 2 but the manifest contains 1'],
  },
  {
    name: 'same-count track replacement is stale',
    needs: ['trackCounts'],
    metaFor: () => ({ populations: ['replacement'] }),
    problems: ['index tracks [whole], meta.js declares [replacement]'],
  },
  {
    name: 'default track mismatch',
    needs: ['defaultTrack'],
    manifest: (manifest) => { manifest.datasets![0].defaultTrack = 'other'; },
    problems: ['index has default track "other"'],
  },
  {
    name: 'partial summaries fail the missing dataset',
    needs: ['defaultTrack'],
    manifest: (manifest) => { manifest.datasets = [{ ...manifest.datasets![0], ds: 'other' }]; },
    problems: ['no browse summary in the manifest'],
  },
  {
    name: 'contrast id mismatch',
    needs: ['contrast'],
    manifest: (manifest) => { manifest.datasets![0].contrastId = 'other'; },
    problems: ['index built for contrast "other"'],
  },
  {
    name: 'contrast id missing',
    needs: ['contrast'],
    manifest: (manifest) => { delete manifest.datasets![0].contrastId; },
    problems: ['index built for contrast "(none)"'],
  },
  {
    name: 'summary field absent is unverifiable and stale',
    needs: ['contrast'],
    manifest: (manifest) => { delete manifest.datasets; },
    problems: ['no browse summary in the manifest'],
  },
  {
    name: 'empty summaries are unverifiable and stale',
    needs: ['contrast'],
    manifest: (manifest) => { manifest.datasets = []; },
    problems: ['no browse summary in the manifest'],
  },
  {
    name: 'same contrast id with changed arm keys is stale',
    needs: ['contrast'],
    manifest: (manifest) => { manifest.datasets![0].armKeys = ['control', 'hfd']; },
    problems: ['index contrast arms [control, hfd]'],
  },
  {
    name: 'missing expression scaffolding',
    needs: ['exprScaffold'],
    manifest: (manifest) => { delete manifest.datasets![0].sampleOrder; },
    problems: ['summary carries no expression scaffolding'],
  },
  {
    name: 'duplicate sample order ids',
    needs: ['exprScaffold'],
    manifest: (manifest) => { manifest.datasets![0].sampleOrder = ['C1', 'C1']; },
    problems: ['sampleOrder has duplicate sample ids'],
  },
  {
    name: 'missing expression arm',
    needs: ['exprScaffold'],
    manifest: (manifest) => { manifest.datasets![0].groupSamples = { chow: ['C1'] }; },
    problems: ['groupSamples has no non-empty entry for arm "hfd"'],
  },
  {
    name: 'empty expression arm',
    needs: ['exprScaffold'],
    manifest: (manifest) => { manifest.datasets![0].groupSamples = { chow: [], hfd: ['H1'] }; },
    problems: ['groupSamples has no non-empty entry for arm "chow"'],
  },
  {
    name: 'orphan expression arm sample',
    needs: ['exprScaffold'],
    manifest: (manifest) => { manifest.datasets![0].groupSamples = { chow: ['C1'], hfd: ['H2'] }; },
    problems: ['arm sample "H2" is not in sampleOrder'],
  },
  {
    name: 'sample assigned to both expression arms',
    needs: ['exprScaffold'],
    manifest: (manifest) => {
      manifest.datasets![0].sampleOrder = ['C1', 'H1'];
      manifest.datasets![0].groupSamples = { chow: ['C1'], hfd: ['C1', 'H1'] };
    },
    problems: ['arm sample "C1" belongs to both active arms'],
  },
  {
    name: 'unresolvable contrast arms',
    needs: ['exprScaffold'],
    dataset: (dataset) => { dataset.contrasts = []; },
    problems: ['groupSamples has no non-empty entry for arm "(unresolved)"'],
  },
];

describe('query-index freshness predicates', () => {
  it.each(CASES)('$name', ({ needs, manifest: mutateManifest, dataset: mutateDataset, metaFor, problems }) => {
    const manifest = mkManifest();
    const dataset = mkDataset();
    mutateManifest?.(manifest);
    mutateDataset?.(dataset);

    const report = manifestFreshness(manifest, [dataset], needs, { metaFor });
    expect(report.ok).toBe(problems.length === 0);
    for (const problem of problems) expect(report.problems.join('\n')).toContain(problem);
  });

  it('accumulates problems across datasets and needs', () => {
    const first = mkDataset();
    const second = mkDataset({ id: 'second', defaultTrack: 'second-track' });
    const manifest = mkManifest();
    manifest.datasets![0].defaultTrack = 'wrong';

    const report = manifestFreshness(manifest, [first, second], ['coverage', 'defaultTrack']);

    expect(report.ok).toBe(false);
    expect(report.problems.some((problem) => problem.startsWith(`${first.id}: index has default track`))).toBe(true);
    expect(report.problems.some((problem) => problem.startsWith(`${second.id}: no tracks`))).toBe(true);
  });

  it('returns only the requested dataset problems', () => {
    const manifest = mkManifest();
    const other = mkDataset({ id: 'other' });

    expect(datasetFreshnessProblems(manifest, other, ['coverage', 'contrast'])).toEqual([
      'other: no tracks in the manifest',
      'other: no browse summary in the manifest',
    ]);
  });
});
