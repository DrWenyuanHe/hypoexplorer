// Contract for the Node bundle reader (scripts/lib/bundleReader.mts): what the
// writer emits, the reader reads back through the same locators, with the
// browser's display rules applied. The overlay parity with the browser loader
// lives in bundleReaderParity.test.ts (it needs a DOM).
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BundleReadError,
  datasetBundlePaths,
  parseJsonp,
  readDatasetFromDisk,
  readJsonp,
  readOptionalJsonp,
} from '../../scripts/lib/bundleReader.mjs';
import {
  writeDatasetBundles,
  writeTimeSeriesBundle,
  type TrackBundlePayload,
} from '../../scripts/lib/bundleWriter.mjs';
import { defineDataset } from '../data/datasets';
import { CPM_TMM_UNIT } from '../data/expressionUnits';
import type { Dataset, TimeSeriesBundle } from '../types';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bundlereader-'));
  tempDirs.push(dir);
  return dir;
}

function dataset(id = 'reader_ds', unit: string | null = 'CPM', withSeries = false): Dataset {
  const ds = defineDataset({
    id,
    category: 'Diet-induced obesity',
    name: 'Synthetic reader fixture',
    organism: 'Mus musculus',
    modality: 'bulk RNA-seq',
    region: 'Whole hypothalamus',
    perturbation: 'Diet & obesity',
    preparation: 'Bulk tissue',
    featureType: 'gene',
    featureLabel: 'Gene',
    ...(unit ? { expressionUnit: unit } : {}),
    supportsPathways: true,
    citation: 'Synthetic fixture',
    isDefault: false,
    defaultTrack: 'whole',
    trackCategoryOrder: ['Tissue'],
    groups: [
      { key: 'control', label: 'Control', color: '#3775BA' },
      { key: 'case', label: 'Case', color: '#B64342' },
      { key: 'cell_a', label: 'Cell A', color: '#59A14F' },
    ],
    contrasts: [
      { id: 'main', baseline: 'control', case: 'case', isDefault: true },
      { id: 'extra', baseline: 'control', case: 'cell_a' },
    ],
  });
  // defineDataset defaults the unit; a registry entry stating none is a hand-built Dataset.
  if (!unit) delete (ds as Partial<Dataset>).expressionUnit;
  return withSeries
    ? { ...ds, timeSeries: { tracks: ['whole'], cycleHours: 24, timeUnit: 'ZT', design: 'Synthetic' } }
    : ds;
}

function payload(): TrackBundlePayload {
  const pathway = (name: string) => ({ pathway: name, pval: 0.01, padj: 0.02, NES: 1.5, size: 2, leadingEdge: ['A'] });
  return {
    trackId: 'whole',
    armKeys: ['control', 'case'],
    defaultContrastBinding: { id: 'main', baseline: 'control', case: 'case' },
    extraContrastBindings: [{ id: 'extra', baseline: 'control', case: 'cell_a' }],
    color: '#4C78A8',
    nSig: 1,
    meta: {
      code: 'whole',
      label: 'Whole tissue',
      type: 'Tissue',
      nGenes: 2,
      sampleOrder: ['C1', 'K1'],
      groupSamples: { control: ['C1'], case: ['K1'], cell_a: ['K1'] },
      expressionUnit: 'log2(CPM + 1)',
    },
    qc: {
      cluster: 'whole', clusterLabel: 'Whole tissue', minCells: null,
      nNormal: 1, nObese: 1, is3v3: false, samplesKept: ['C1', 'K1'],
    },
    de: [
      { gene: 'A', logFC: 1, logCPM: 2, PValue: 0.001, FDR: 0.01, rank_score: 1, rankPos: 1 },
      { gene: 'B', logFC: -1, logCPM: 1, PValue: 0.2, FDR: 0.3, rank_score: -1, rankPos: 2 },
    ],
    deByContrast: {
      extra: [{ gene: 'A', logFC: 2, logCPM: 2, PValue: 0.0009, FDR: 0.004, rank_score: 2, rankPos: 1 }],
    },
    cpm: { A: [1, 2], B: [3, 4] },
    pathways: { GO_BP: [pathway('DEFAULT_PATH')] },
    pathwaysByContrast: { extra: { KEGG: [pathway('EXTRA_PATH')] } },
  };
}

function series(): TimeSeriesBundle {
  return {
    meta: {
      trackId: 'whole', label: 'Whole tissue', cycleHours: 24, timeUnit: 'ZT', expressionUnit: 'CPM',
      arms: [
        { key: 'control', label: 'Control', color: '#3775BA' },
        { key: 'case', label: 'Case', color: '#B64342' },
        { key: 'cell_a', label: 'Cell A', color: '#59A14F' },
      ],
      samples: [{ id: 'C1', arm: 'control', time: 0, replicate: 1 }],
      timepoints: [0], nGenes: 1,
    },
    values: { A: [1] },
  };
}

function failure(fn: () => unknown): BundleReadError {
  try {
    fn();
  } catch (error) {
    if (error instanceof BundleReadError) return error;
    throw error;
  }
  throw new Error('expected a BundleReadError');
}

describe('parseJsonp', () => {
  it('reads the writer shape, a generator comment header, window assignment and a missing semicolon', () => {
    expect(parseJsonp('var HX_A = {"x":1};\n', 'HX_A')).toEqual({ x: 1 });
    expect(parseJsonp('// AUTO-GENERATED\n// second line\nvar HX_A = [1,2];\n', 'HX_A')).toEqual([1, 2]);
    expect(parseJsonp('/* header */\nwindow.HX_A = {"y":[]}', 'HX_A')).toEqual({ y: [] });
  });

  it('refuses a bundle that assigns a different global', () => {
    const error = failure(() => parseJsonp('var HX_OTHER = {};', 'HX_A', 'x.js'));
    expect(error.reason).toBe('wrong-global');
    expect(error.detail).toBe('assigns HX_OTHER; expected HX_A');
    expect(error.message).toBe('x.js: assigns HX_OTHER; expected HX_A');
  });

  it('refuses code around the payload instead of slicing to the first brace', () => {
    expect(failure(() => parseJsonp('var HX_A = {}; alert(1);', 'HX_A')).reason).toBe('malformed');
    expect(failure(() => parseJsonp('var HX_A = f({});', 'HX_A')).reason).toBe('malformed');
    expect(failure(() => parseJsonp('alert(1); var HX_A = {};', 'HX_A')).reason).toBe('malformed');
  });

  it('distinguishes a missing required bundle from an absent optional one', () => {
    const root = tempRoot();
    const absent = join(root, 'absent.js');
    const missing = failure(() => readJsonp(absent, 'HX_A'));
    expect(missing.reason).toBe('missing');
    expect(missing.message).toBe(`${absent}: is missing`);
    expect(readOptionalJsonp(absent, 'HX_A')).toBeNull();
    const broken = join(root, 'broken.js');
    writeFileSync(broken, 'var HX_A = {;\n');
    expect(failure(() => readOptionalJsonp(broken, 'HX_A')).reason).toBe('malformed');
  });
});

describe('writer → reader round trip', () => {
  it('locates every written file through the shared locators', () => {
    const ds = dataset('locate_ds', 'CPM', true);
    const root = tempRoot();
    const { files } = writeDatasetBundles(ds, [payload()], { outRoot: root });
    const { file: seriesFile } = writeTimeSeriesBundle(ds, 'whole', series(), { outRoot: root });
    const paths = datasetBundlePaths(ds, { publicRoot: root });
    expect([...files, seriesFile].sort()).toEqual([
      paths.meta.file, paths.qc.file, paths.track('whole').file, paths.pathways('whole').file,
      paths.pathwayIndex.file, paths.timeSeries('whole').file,
    ].sort());
    expect(readJsonp<string[]>(paths.pathwayIndex.file, paths.pathwayIndex.global))
      .toEqual(['DEFAULT_PATH', 'EXTRA_PATH']);
  });

  it('reads back the dataset with the browser rules applied', () => {
    const ds = dataset('roundtrip_ds', 'CPM', true);
    const root = tempRoot();
    writeDatasetBundles(ds, [payload()], { outRoot: root });
    writeTimeSeriesBundle(ds, 'whole', series(), { outRoot: root });

    const disk = readDatasetFromDisk(ds, { publicRoot: root });
    expect(disk.meta.populations).toEqual(['whole']);
    expect(disk.qc().runStatus?.[0]).toMatchObject({ cluster: 'whole', status: 'ok' });

    const track = disk.track('whole');
    expect(track.label).toBe('Whole tissue');
    expect(track.expressionUnit).toBe('CPM'); // the registry wins over the bundle's log2 unit
    expect(track.lowPower).toBe(true); // 1 v 1
    expect(track.groupSamples).toEqual({ control: ['C1'], case: ['K1'], cell_a: ['K1'] });
    expect(track.deFor('main').map((row) => [row.gene, row.logFC])).toEqual([['A', 1], ['B', -1]]);
    expect(track.deFor('extra').map((row) => [row.gene, row.logFC])).toEqual([['A', 2]]);
    expect(track.deFor('unregistered')).toEqual([]);
    expect(track.pathwaysFor('main')).toMatchObject({ source: 'legacy-default', db: { GO_BP: [{ pathway: 'DEFAULT_PATH' }] } });
    expect(track.pathwaysFor('extra')).toMatchObject({ source: 'explicit', db: { KEGG: [{ pathway: 'EXTRA_PATH' }] } });
    expect(disk.timeSeries('whole')?.values).toEqual({ A: [1] });
    expect(() => disk.track('undeclared')).toThrow(/not declared by meta\.populations/);
    expect(() => disk.timeSeries('undeclared')).toThrow(/not declared by meta\.populations/);
  });

  it("falls back to the bundle's unit, then CPM (TMM-normalized), when the registry states none", () => {
    const ds = dataset('unit_ds', null);
    const root = tempRoot();
    writeDatasetBundles(ds, [payload()], { outRoot: root });
    expect(readDatasetFromDisk(ds, { publicRoot: root }).track('whole').expressionUnit).toBe('log2(CPM + 1)');

    const bare = payload();
    delete bare.meta.expressionUnit;
    const bareDs = dataset('bare_unit_ds', null);
    writeDatasetBundles(bareDs, [bare], { outRoot: root });
    expect(readDatasetFromDisk(bareDs, { publicRoot: root }).track('whole').expressionUnit).toBe(CPM_TMM_UNIT);
  });

  it('treats absent optional siblings as absent', () => {
    const ds = dataset('optional_ds');
    const root = tempRoot();
    writeDatasetBundles(ds, [{ ...payload(), pathways: null, pathwaysByContrast: undefined }], { outRoot: root });
    const disk = readDatasetFromDisk(ds, { publicRoot: root });
    expect(disk.track('whole').pathwaysFor('main')).toEqual({ db: null, source: 'refused' });
    expect(disk.timeSeries('whole')).toBeNull();
  });

  it("refuses a dataset folder holding another dataset's bundle", () => {
    const source = dataset('source_ds');
    const target = dataset('target_ds');
    const root = tempRoot();
    writeDatasetBundles(source, [payload()], { outRoot: root });
    const targetMeta = datasetBundlePaths(target, { publicRoot: root }).meta.file;
    mkdirSync(dirname(targetMeta), { recursive: true });
    copyFileSync(datasetBundlePaths(source, { publicRoot: root }).meta.file, targetMeta);
    const error = failure(() => readDatasetFromDisk(target, { publicRoot: root }));
    expect(error.reason).toBe('wrong-global');
    expect(error.detail).toBe('assigns HX_SOURCE_DS_META; expected HX_TARGET_DS_META');
    expect(error.message).toContain(targetMeta);
  });

  it('refuses a meta bundle that declares no tracks', () => {
    const ds = dataset('empty_ds');
    const root = tempRoot();
    const meta = datasetBundlePaths(ds, { publicRoot: root }).meta;
    mkdirSync(dirname(meta.file), { recursive: true });
    writeFileSync(meta.file, `var ${meta.global} = {"populations":[]};\n`);
    expect(failure(() => readDatasetFromDisk(ds, { publicRoot: root })).message).toMatch(/declares no tracks/);
  });
});
