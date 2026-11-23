// The query index's corpus read (scripts/lib/queryIndexCorpus.mts), over a
// temp-directory corpus written by the bundle writer and then damaged: which
// bundles are indexed, which are skipped (and why), and which stop the build.
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BundleReadError, datasetBundlePaths } from '../../scripts/lib/bundleReader.mjs';
import { writeDatasetBundles, type TrackBundlePayload } from '../../scripts/lib/bundleWriter.mjs';
import { openQueryCorpus, type QueryCorpusSkip } from '../../scripts/lib/queryIndexCorpus.mjs';
import { defineDataset } from '../data/datasets';
import type { Dataset } from '../types';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'querycorpus-'));
  tempDirs.push(dir);
  return dir;
}

function dataset(id: string): Dataset {
  return defineDataset({
    id,
    category: 'Diet-induced obesity',
    name: `Synthetic ${id}`,
    organism: 'Mus musculus',
    modality: 'bulk RNA-seq',
    region: 'Whole hypothalamus',
    perturbation: 'Diet & obesity',
    preparation: 'Bulk tissue',
    featureType: 'gene',
    featureLabel: 'Gene',
    supportsPathways: true,
    citation: 'Synthetic fixture',
    isDefault: false,
    defaultTrack: 'a',
    trackCategoryOrder: ['Tissue'],
    groups: [
      { key: 'control', label: 'Control', color: '#3775BA' },
      { key: 'case', label: 'Case', color: '#B64342' },
    ],
    contrasts: [{ id: 'main', baseline: 'control', case: 'case', isDefault: true }],
  });
}

function payload(trackId: string): TrackBundlePayload {
  return {
    trackId,
    armKeys: ['control', 'case'],
    defaultContrastBinding: { id: 'main', baseline: 'control', case: 'case' },
    color: '#4C78A8',
    nSig: 1,
    meta: {
      code: trackId,
      label: `Track ${trackId}`,
      type: 'Tissue',
      nGenes: 1,
      sampleOrder: ['C1', 'K1'],
      groupSamples: { control: ['C1'], case: ['K1'] },
    },
    qc: {
      cluster: trackId, clusterLabel: `Track ${trackId}`, minCells: null,
      nNormal: 1, nObese: 1, is3v3: false, samplesKept: ['C1', 'K1'],
    },
    de: [{ gene: 'A', logFC: 1, logCPM: 2, PValue: 0.001, FDR: 0.01, rank_score: 1, rankPos: 1 }],
    cpm: { A: [1, 2] },
    pathways: { GO_BP: [{ pathway: 'P', pval: 0.01, padj: 0.02, NES: 1.5, size: 2, leadingEdge: ['A'] }] },
  };
}

/** Read the whole corpus, collecting what was indexed and what was skipped. */
function sweep(root: string, registry: Dataset[]) {
  const corpus = openQueryCorpus({ publicRoot: root, registry });
  const skipped: QueryCorpusSkip[] = [];
  const indexed: string[] = [];
  for (const entry of corpus.read((skip) => skipped.push(skip))) {
    for (const track of entry.tracks()) {
      indexed.push(`${entry.dataset.id}/${track.trackId}${track.pathways ? '+pathways' : ''}`);
    }
  }
  return { corpus, skipped: skipped.map((skip) => skip.entry), indexed };
}

describe('query index corpus read', () => {
  it('reads every declared track and its sibling in directory order, raw', () => {
    const root = tempRoot();
    const b = dataset('corpus_b');
    const a = dataset('corpus_a');
    writeDatasetBundles(b, [payload('a')], { outRoot: root });
    writeDatasetBundles(a, [payload('a'), payload('b')], { outRoot: root });
    const { skipped, indexed, corpus } = sweep(root, [b, a]);
    expect(skipped).toEqual([]);
    expect(indexed).toEqual(['corpus_a/a+pathways', 'corpus_a/b+pathways', 'corpus_b/a+pathways']);
    const reopened = corpus.track('corpus_a', 'b');
    expect('raw' in reopened && reopened.raw.de?.[0].gene).toBe('A');
    expect(corpus.track('corpus_x', 'a')).toEqual({ skip: 'dataset is not in the corpus' });
  });

  it('skips missing and malformed bundles with their reason, and indexes the rest', () => {
    const root = tempRoot();
    const ds = dataset('damaged');
    writeDatasetBundles(ds, ['a', 'b', 'c', 'd', 'e'].map(payload), { outRoot: root });
    const paths = datasetBundlePaths(ds, { publicRoot: root });
    unlinkSync(paths.track('b').file);
    writeFileSync(paths.track('c').file, `var ${paths.track('c').global} = {"de":[;\n`);
    writeFileSync(paths.track('d').file, `var ${paths.track('d').global} = {"de":[{"gene":"A","logFC":"1"}]};\n`);
    writeFileSync(paths.pathways('e').file, `var ${paths.pathways('e').global} = {}; alert(1);\n`);
    unlinkSync(paths.pathways('a').file);

    const { skipped, indexed, corpus } = sweep(root, [ds]);
    expect(indexed).toEqual(['damaged/a']); // an absent sibling is "no pathway analysis"
    expect(skipped).toEqual([
      'damaged/b (bundle missing)',
      expect.stringMatching(/^damaged\/c \(bundle malformed: payload is not JSON/),
      expect.stringMatching(/^damaged\/d \(bundle malformed: not a track bundle/),
      expect.stringMatching(/^damaged\/e \(pathway sibling malformed: payload is not JSON/),
    ]);
    expect(corpus.track('damaged', 'b')).toEqual({ skip: 'bundle missing' });
  });

  it('skips a dataset whose meta.js is missing, malformed or declares no tracks', () => {
    const root = tempRoot();
    const missing = dataset('meta_missing');
    const broken = dataset('meta_broken');
    const empty = dataset('meta_empty');
    for (const ds of [missing, broken, empty]) writeDatasetBundles(ds, [payload('a')], { outRoot: root });
    unlinkSync(datasetBundlePaths(missing, { publicRoot: root }).meta.file);
    const brokenMeta = datasetBundlePaths(broken, { publicRoot: root }).meta;
    writeFileSync(brokenMeta.file, `var ${brokenMeta.global} = {populations:["a"]};\n`);
    const emptyMeta = datasetBundlePaths(empty, { publicRoot: root }).meta;
    writeFileSync(emptyMeta.file, `var ${emptyMeta.global} = {"populations":[]};\n`);

    const { skipped, indexed } = sweep(root, [missing, broken, empty]);
    expect(indexed).toEqual([]);
    expect(skipped).toEqual([
      expect.stringMatching(/^meta_broken \(meta\.js malformed: payload is not JSON/),
      'meta_empty (meta.js declares no populations)',
      'meta_missing (meta.js missing)',
    ]);
  });

  it("stops on a bundle that assigns another study's global, even mid-sweep", () => {
    const root = tempRoot();
    const ds = dataset('misplaced');
    writeDatasetBundles(ds, [payload('a'), payload('b')], { outRoot: root });
    const paths = datasetBundlePaths(ds, { publicRoot: root });
    writeFileSync(paths.track('b').file, 'var HX_OTHER_STUDY_B = {"de":[]};\n');
    expect(() => sweep(root, [ds])).toThrow(BundleReadError);
    expect(() => sweep(root, [ds])).toThrow('assigns HX_OTHER_STUDY_B; expected HX_MISPLACED_B');

    const metaRoot = tempRoot();
    writeDatasetBundles(ds, [payload('a')], { outRoot: metaRoot });
    writeFileSync(datasetBundlePaths(ds, { publicRoot: metaRoot }).meta.file, 'var HX_OTHER_META = {"populations":["a"]};\n');
    expect(() => sweep(metaRoot, [ds])).toThrow('assigns HX_OTHER_META; expected HX_MISPLACED_META');
  });

  it('names unregistered directories and absent datasets without reading them', () => {
    const root = tempRoot();
    const present = dataset('present');
    writeDatasetBundles(present, [payload('a')], { outRoot: root });
    // A stray folder with a perfectly readable bundle is still not a study.
    mkdirSync(join(root, 'datasets', 'stray'), { recursive: true });
    writeFileSync(join(root, 'datasets', 'stray', 'meta.js'), 'var HX_STRAY_META = {"populations":["a"]};\n');
    const { corpus, indexed, skipped } = sweep(root, [present, dataset('gone')]);
    expect(corpus.unregistered).toEqual(['stray']);
    expect(corpus.absent.map((ds) => ds.id)).toEqual(['gone']);
    expect(indexed).toEqual(['present/a+pathways']);
    expect(skipped).toEqual([]);
  });
});
