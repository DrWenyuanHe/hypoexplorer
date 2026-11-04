import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultContrastBinding,
  outDirFromArgv,
  planPathwayBundles,
  registryDefaultContrast,
  requireDataset,
  writeDatasetBundles,
  writeTimeSeriesBundle,
  type TrackBundlePayload,
} from '../../scripts/lib/bundleWriter.mjs';
import { applyPathwayBundlePlans } from '../../scripts/lib/pathwayBundleRefresh.mjs';
import { roundProb } from '../../scripts/lib/bundleSlim.mjs';
import {
  resolvePathwayGlobalKey,
  resolvePathwayIndexGlobalKey,
  resolvePathwayIndexUrl,
  resolvePathwayUrl,
  resolveTimeSeriesGlobalKey,
  resolveTimeSeriesUrl,
  resolveTrackGlobalKey,
  resolveTrackUrl,
} from '../data/bundleLocators';
import { getActiveContrast } from '../data/contrasts';
import { defineDataset } from '../data/datasets';
import {
  deTableFor,
  groupSamplesOf,
  siblingDefaultPathways,
  siblingPathwaysByContrast,
} from '../data/rawTrack';
import type { Dataset, PathwayDatabase, PathwaySibling, RawTrack, TimeSeriesBundle } from '../types';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bundlewriter-'));
  tempDirs.push(dir);
  return dir;
}

function dataset(id = 'test_ds', multi = true): Dataset {
  return defineDataset({
    id,
    category: 'Diet-induced obesity',
    name: 'Synthetic writer fixture',
    organism: 'Mus musculus',
    modality: 'bulk RNA-seq',
    region: 'Whole hypothalamus',
    perturbation: 'Diet & obesity',
    preparation: 'Bulk tissue',
    featureType: 'gene',
    featureLabel: 'Gene',
    expressionUnit: 'CPM',
    supportsPathways: true,
    citation: 'Synthetic fixture',
    isDefault: false,
    defaultTrack: 'whole',
    trackCategoryOrder: ['Tissue'],
    groups: [
      { key: 'control', label: 'Control', color: '#3775BA' },
      { key: 'case', label: 'Case', color: '#B64342' },
      ...(multi ? [{ key: 'cell_a', label: 'Cell A', color: '#59A14F' }] : []),
    ],
    contrasts: [
      { id: 'main', baseline: 'control', case: 'case', isDefault: true },
      ...(multi ? [{ id: 'extra', baseline: 'control', case: 'cell_a' }] : []),
    ],
  });
}

function pathway(pathway: string, pval: number, padj: number) {
  return { pathway, pval, padj, NES: 1.25, size: 2, leadingEdge: ['A'] };
}

function payload(multi = true): TrackBundlePayload {
  const defaultPathways: PathwayDatabase = {
    GO_BP: [pathway('Z_DEFAULT', 0.123456789, 0.234567891)],
  };
  return {
    trackId: 'whole',
    armKeys: ['control', 'case'],
    defaultContrastBinding: { id: 'main', baseline: 'control', case: 'case' },
    extraContrastBindings: multi ? [{ id: 'extra', baseline: 'control', case: 'cell_a' }] : [],
    color: '#4C78A8',
    nSig: 1,
    meta: {
      code: 'whole',
      label: 'Whole tissue',
      type: 'Tissue',
      nGenes: 2,
      sampleOrder: ['C1', 'K1'],
      groupSamples: {
        control: ['C1'],
        case: ['K1'],
        ...(multi ? { cell_a: ['K1'] } : {}),
      },
      expressionUnit: 'CPM',
    },
    qc: {
      cluster: 'whole',
      clusterLabel: 'Whole tissue',
      minCells: null,
      nNormal: 1,
      nObese: 1,
      is3v3: false,
      samplesKept: ['C1', 'K1'],
    },
    de: [
      {
        gene: 'A', logFC: 1, logCPM: 2, PValue: 0.00123456789,
        FDR: 0.0123456789, rank_score: 1.23456789, rankPos: 1,
      },
      {
        gene: 'B', logFC: -1, logCPM: null, PValue: 0.223456789,
        FDR: 0.323456789, rank_score: -1.23456789, rankPos: 2,
      },
    ],
    deByContrast: multi
      ? {
        extra: [{
          gene: 'A', logFC: 2, logCPM: null, PValue: 0.000987654321,
          FDR: 0.00456789123, rank_score: 2.34567891, rankPos: 1,
        }],
      }
      : undefined,
    cpm: { A: [1, 2], B: [3, 4] },
    pathways: defaultPathways,
    pathwaysByContrast: multi
      ? { extra: { KEGG: [pathway('A_EXTRA_ONLY', 0.345678912, 0.456789123)] } }
      : undefined,
  };
}

function seriesDataset(): Dataset {
  return {
    ...dataset('series_ds', false),
    timeSeries: {
      tracks: ['whole'],
      cycleHours: 24,
      timeUnit: 'ZT',
      design: 'Synthetic 24-hour fixture',
    },
  };
}

function seriesBundle(): TimeSeriesBundle {
  return {
    meta: {
      trackId: 'whole', label: 'Whole tissue', cycleHours: 24, timeUnit: 'ZT',
      expressionUnit: 'CPM',
      arms: [
        { key: 'control', label: 'Control', color: '#3775BA' },
        { key: 'case', label: 'Case', color: '#B64342' },
      ],
      samples: [{ id: 'C1', arm: 'control', time: 0, replicate: 1 }],
      timepoints: [0], nGenes: 1,
    },
    values: { A: [1] },
  };
}

function localFile(outRoot: string, url: string): string {
  return resolve(outRoot, ...url.slice(1).split('/'));
}

function parseJsonp<T>(file: string): { key: string; payload: T; source: string } {
  const source = readFileSync(file, 'utf8');
  const varAt = source.indexOf('var ');
  const equalsAt = source.indexOf(' = ', varAt);
  const objectAt = source.indexOf('{', equalsAt);
  const arrayAt = source.indexOf('[', equalsAt);
  const payloadAt = objectAt < 0 ? arrayAt : arrayAt < 0 ? objectAt : Math.min(objectAt, arrayAt);
  return {
    key: source.slice(varAt + 4, equalsAt),
    payload: JSON.parse(source.slice(payloadAt, source.lastIndexOf(';'))) as T,
    source,
  };
}

// The default-contrast seam the three batch builders now share. The arm ORDER
// is the load-bearing part: baseline first. A swap here relabels every bundle's
// direction of effect, and the builders no longer spell the rule themselves.
describe('default-contrast helpers', () => {
  it('binds the registry default over the manifest arm keys, baseline first', () => {
    expect(defaultContrastBinding(dataset(), ['control', 'case']))
      .toEqual({ id: 'main', baseline: 'control', case: 'case' });
  });

  it('prefers the isDefault entry over the first when they differ', () => {
    const ds = {
      ...dataset(),
      contrasts: [
        { id: 'first', baseline: 'control', case: 'case' },
        { id: 'flagged', baseline: 'control', case: 'case', isDefault: true },
      ],
    } as Dataset;
    expect(registryDefaultContrast(ds).id).toBe('flagged');
  });

  it('falls back to the first contrast when none is flagged', () => {
    const ds = {
      ...dataset(),
      contrasts: [{ id: 'only', baseline: 'control', case: 'case' }],
    } as Dataset;
    expect(registryDefaultContrast(ds).id).toBe('only');
  });

  it('agrees with the reader-side resolution (getActiveContrast)', () => {
    const ds = dataset();
    expect(registryDefaultContrast(ds).id).toBe(getActiveContrast(ds)?.id);
  });

  it('throws on an empty contrast list — a registry bug, not a default', () => {
    const ds = { ...dataset(), contrasts: [] } as Dataset;
    expect(() => registryDefaultContrast(ds)).toThrow(/registry has no contrast/);
    expect(() => defaultContrastBinding(ds, ['control', 'case'])).toThrow(/registry has no contrast/);
  });
});

describe('bundleWriter writer-reader contract', () => {
  it('plans pathway-only output identical to the full writer for single and multiple contrasts', () => {
    for (const multi of [false, true]) {
      const ds = dataset(`pathway_plan_${multi}`, multi);
      const out = tempRoot();
      const track = payload(multi);
      const blocks = { main: track.pathways!, ...(track.pathwaysByContrast ?? {}) };
      writeDatasetBundles(ds, [track], { outRoot: out });
      const plans = planPathwayBundles(ds, 'whole', blocks, { outRoot: out });
      expect(plans).toHaveLength(2);
      for (const plan of plans) expect(readFileSync(plan.file, 'utf8')).toBe(plan.body);
      expect(applyPathwayBundlePlans(plans, { check: true }).changed).toEqual([]);
    }
  });

  it('refreshes only pathway bytes, with read-only check/dry modes and protected-target guards', () => {
    const ds = dataset('pathway_refresh', false);
    const out = tempRoot();
    const track = payload(false);
    const written = writeDatasetBundles(ds, [track], { outRoot: out });
    const protectedFiles = written.files.filter((file) => !file.endsWith('.pathways.js') && !file.endsWith('pathways_index.js'));
    const protectedBytes = protectedFiles.map((file) => readFileSync(file));
    const plans = planPathwayBundles(ds, 'whole', {
      main: { REACTOME: [pathway('NEW_PATHWAY', 0.01, 0.02)] },
    }, { outRoot: out });
    const before = plans.map((plan) => readFileSync(plan.file));
    expect(() => applyPathwayBundlePlans(plans, { check: true, protectedFiles })).toThrow(/stale/);
    expect(applyPathwayBundlePlans(plans, { dry: true, protectedFiles }).changed).toHaveLength(2);
    plans.forEach((plan, index) => { expect(readFileSync(plan.file)).toEqual(before[index]); });
    expect(applyPathwayBundlePlans(plans, { protectedFiles }).changed).toHaveLength(2);
    protectedFiles.forEach((file, index) => { expect(readFileSync(file)).toEqual(protectedBytes[index]); });
    expect(applyPathwayBundlePlans(plans, { check: true, protectedFiles }).changed).toEqual([]);
    expect(() => applyPathwayBundlePlans([plans[0], plans[0]], { protectedFiles })).toThrow(/duplicate or protected/);
    expect(() => applyPathwayBundlePlans([{ ...plans[0], file: protectedFiles[0] }], { protectedFiles }))
      .toThrow(/duplicate or protected/);
    expect(() => planPathwayBundles(ds, 'whole', { wrong: {} }, { outRoot: out })).toThrow(/every registered contrast/);
  });

  it('derives every name, round-trips readers, slims the wire, and unions pathway names', () => {
    const ds = dataset();
    const out = tempRoot();
    const written = writeDatasetBundles(ds, [payload()], { outRoot: out });
    const located = { ...ds, bundleBaseUrl: '' };
    const expectedFiles = [
      localFile(out, ds.metaFile),
      localFile(out, ds.qcFile),
      localFile(out, resolveTrackUrl(located, 'whole')),
      localFile(out, resolvePathwayUrl(located, 'whole')),
      localFile(out, resolvePathwayIndexUrl(located)),
    ];
    expect(new Set(written.files)).toEqual(new Set(expectedFiles));

    const track = parseJsonp<RawTrack>(localFile(out, resolveTrackUrl(located, 'whole')));
    expect(track.key).toBe(resolveTrackGlobalKey(ds, 'whole'));
    expect(track.source).toBe(`var ${track.key} = ${JSON.stringify(track.payload)};\n`);
    expect(getActiveContrast(ds)?.id).toBe('main');
    expect(deTableFor(track.payload, 'main').map((row) => row.gene)).toEqual(['A', 'B']);
    expect(deTableFor(track.payload, 'extra').map((row) => row.gene)).toEqual(['A']);
    expect(groupSamplesOf(track.payload)).toEqual({ control: ['C1'], case: ['K1'], cell_a: ['K1'] });
    expect(track.payload.de?.[0]).not.toHaveProperty('rankPos');
    expect(track.payload.de?.[1]).not.toHaveProperty('logCPM');
    expect(track.payload.de?.[0].FDR).toBe(roundProb(0.0123456789));

    const sibling = parseJsonp<PathwaySibling>(localFile(out, resolvePathwayUrl(located, 'whole')));
    expect(sibling.key).toBe(resolvePathwayGlobalKey(ds, 'whole'));
    expect(siblingDefaultPathways(sibling.payload)?.GO_BP?.[0].pathway).toBe('Z_DEFAULT');
    expect(siblingPathwaysByContrast(sibling.payload)?.extra.KEGG?.[0].pathway).toBe('A_EXTRA_ONLY');

    const index = parseJsonp<string[]>(localFile(out, resolvePathwayIndexUrl(located)));
    expect(index.key).toBe(resolvePathwayIndexGlobalKey(ds));
    expect(index.payload).toEqual(['A_EXTRA_ONLY', 'Z_DEFAULT']);

    const meta = parseJsonp<Record<string, unknown>>(localFile(out, ds.metaFile));
    expect(meta.key).toBe(ds.metaGlobalKey);
    expect(JSON.stringify(meta.payload)).toBe(JSON.stringify({
      populations: ['whole'],
      labels: { whole: 'Whole tissue' },
      types: { whole: 'Tissue' },
      nGenes: { whole: 2 },
      colors: { whole: '#4C78A8' },
      qcFlags: { whole: { is3v3: false, nNormal: 1, nObese: 1, minCells: 0, status: 'ok' } },
      groupN: { control: 1, case: 1, cell_a: 1 },
      qaReportFilenames: {},
    }));
    expect(parseJsonp(localFile(out, ds.qcFile)).key).toBe(ds.qcGlobalKey);
  });

  it('keeps a single-contrast pathway sibling plain', () => {
    const ds = dataset('single_ds', false);
    const out = tempRoot();
    writeDatasetBundles(ds, [payload(false)], { outRoot: out });
    const sibling = parseJsonp<PathwaySibling>(localFile(out, resolvePathwayUrl({ ...ds, bundleBaseUrl: '' }, 'whole')));
    expect(siblingDefaultPathways(sibling.payload)?.GO_BP?.[0].pathway).toBe('Z_DEFAULT');
    expect(siblingPathwaysByContrast(sibling.payload)).toBeNull();
  });

  it('derives time-series names and honors dry runs', () => {
    const ds = seriesDataset();
    const out = tempRoot();
    const bundle = seriesBundle();
    const located = { ...ds, bundleBaseUrl: '' };
    const written = writeTimeSeriesBundle(ds, 'whole', bundle, { outRoot: out });
    expect(written.file).toBe(localFile(out, resolveTimeSeriesUrl(located, 'whole')));
    expect(parseJsonp(written.file).key).toBe(resolveTimeSeriesGlobalKey(ds, 'whole'));

    const dryOut = join(out, 'dry');
    const dry = writeTimeSeriesBundle(ds, 'whole', bundle, { outRoot: dryOut, dry: true });
    expect(existsSync(dry.file)).toBe(false);
  });

  it('fails loudly on registry drift and unsafe locator paths', () => {
    const ds = dataset();
    const badTrack = payload();
    badTrack.trackId = 'other';
    expect(() => writeDatasetBundles(ds, [badTrack], { outRoot: tempRoot() })).toThrow(/defaultTrack/);

    const badArms = payload();
    badArms.armKeys = ['case', 'control'];
    expect(() => writeDatasetBundles(ds, [badArms], { outRoot: tempRoot() })).toThrow(/begin with/);

    const duplicateExtra = payload();
    duplicateExtra.extraContrastBindings = [
      { id: 'extra', baseline: 'control', case: 'cell_a' },
      { id: 'extra', baseline: 'control', case: 'cell_a' },
    ];
    expect(() => writeDatasetBundles(ds, [duplicateExtra], { outRoot: tempRoot() })).toThrow(/unique/);

    expect(() => writeDatasetBundles({ ...ds, metaFile: '../outside.js' }, [payload()], { outRoot: tempRoot() }))
      .toThrow(/non-local dataset path/);
    expect(() => requireDataset('nope')).toThrow(/no registry entry/);
    expect(outDirFromArgv(['--out-dir', 'somewhere'])).toBe(resolve('somewhere'));
  });

  it('rejects stale nested track identifiers', () => {
    const ds = dataset();
    const badMeta = payload();
    badMeta.meta.code = 'stale';
    expect(() => writeDatasetBundles(ds, [badMeta], { outRoot: tempRoot() })).toThrow(/meta\.code/);

    const badQc = payload();
    badQc.qc.cluster = 'stale';
    expect(() => writeDatasetBundles(ds, [badQc], { outRoot: tempRoot() })).toThrow(/qc\.cluster/);
  });

  it('rejects default and extra contrast meaning drift', () => {
    const ds = dataset();
    const reversedDefault = payload();
    reversedDefault.defaultContrastBinding = { id: 'main', baseline: 'case', case: 'control' };
    expect(() => writeDatasetBundles(ds, [reversedDefault], { outRoot: tempRoot() }))
      .toThrow(/default contrast binding/);

    const staleExtra = payload();
    staleExtra.extraContrastBindings = [{ id: 'extra', baseline: 'cell_a', case: 'control' }];
    expect(() => writeDatasetBundles(ds, [staleExtra], { outRoot: tempRoot() }))
      .toThrow(/extra contrast binding/);
  });

  it('rejects extra pathway tables without a default block', () => {
    const ds = dataset();
    const bad = payload();
    bad.pathways = null;
    expect(() => writeDatasetBundles(ds, [bad], { outRoot: tempRoot() }))
      .toThrow(/requires a default pathways block/);
  });

  it('preflights path collisions and JSONP keys before writing', () => {
    const ds = dataset();
    const collisionRoot = tempRoot();
    const trackPathCollision = { ...ds, bundleFileTemplate: `/datasets/${ds.id}/track_{trackId}` };
    expect(() => writeDatasetBundles(trackPathCollision, [payload()], { outRoot: collisionRoot }))
      .toThrow(/output path collides/);
    expect(existsSync(localFile(collisionRoot, ds.metaFile))).toBe(false);

    const metaQcCollision = { ...ds, qcFile: ds.metaFile };
    expect(() => writeDatasetBundles(metaQcCollision, [payload()], { outRoot: tempRoot() }))
      .toThrow(/output path collides/);

    const invalidKey = { ...ds, metaGlobalKey: 'BROKEN-KEY' };
    expect(() => writeDatasetBundles(invalidKey, [payload()], { outRoot: tempRoot() }))
      .toThrow(/invalid JSONP global key/);
    const reservedKey = { ...ds, metaGlobalKey: 'for' };
    expect(() => writeDatasetBundles(reservedKey, [payload()], { outRoot: tempRoot() }))
      .toThrow(/invalid JSONP global key/);
  });

  it('rejects unsupported and Windows-reserved path components', () => {
    const ds = dataset();
    expect(() => writeDatasetBundles(
      { ...ds, metaFile: `/datasets/${ds.id}/meta:stream.js` },
      [payload()],
      { outRoot: tempRoot() },
    )).toThrow(/unsupported dataset path component/);
    expect(() => writeDatasetBundles(
      { ...ds, metaFile: `/datasets/${ds.id}/CON.js` },
      [payload()],
      { outRoot: tempRoot() },
    )).toThrow(/unsupported dataset path component/);
  });

  it('validates the complete time-series registry descriptor', () => {
    const valid = seriesDataset();

    expect(() => writeTimeSeriesBundle(
      { ...valid, timeSeries: undefined }, 'whole', seriesBundle(), { outRoot: tempRoot(), dry: true },
    )).toThrow(/timeSeries\.tracks/);
    expect(() => writeTimeSeriesBundle(
      { ...valid, timeSeries: { ...valid.timeSeries!, tracks: ['other'] } },
      'whole', seriesBundle(), { outRoot: tempRoot(), dry: true },
    )).toThrow(/timeSeries\.tracks/);

    const badTrack = seriesBundle();
    badTrack.meta.trackId = 'other';
    expect(() => writeTimeSeriesBundle(valid, 'whole', badTrack, { outRoot: tempRoot(), dry: true }))
      .toThrow(/meta\.trackId/);

    const badCycle = seriesBundle();
    badCycle.meta.cycleHours = 12;
    expect(() => writeTimeSeriesBundle(valid, 'whole', badCycle, { outRoot: tempRoot(), dry: true }))
      .toThrow(/cycleHours/);

    const badUnit = seriesBundle();
    badUnit.meta.timeUnit = 'CT';
    expect(() => writeTimeSeriesBundle(valid, 'whole', badUnit, { outRoot: tempRoot(), dry: true }))
      .toThrow(/timeUnit/);

    const badArms = seriesBundle();
    badArms.meta.arms.reverse();
    expect(() => writeTimeSeriesBundle(valid, 'whole', badArms, { outRoot: tempRoot(), dry: true }))
      .toThrow(/arm keys/);
  });

  it('rejects a time-series locator that aliases another bundle', () => {
    const ds = {
      ...seriesDataset(),
      bundleFileTemplate: '/datasets/series_ds/{trackId}.js',
    };
    expect(() => writeTimeSeriesBundle(ds, 'whole', seriesBundle(), { outRoot: tempRoot(), dry: true }))
      .toThrow(/output path collides/);
  });
});
