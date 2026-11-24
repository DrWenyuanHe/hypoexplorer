// @vitest-environment jsdom
// Overlay parity: a Node script reading a published meta.js through
// scripts/lib/bundleReader.mts must show the same track labels as the browser's
// loadDatasetMeta. Before the reader existed, the agent export read meta.labels
// raw and published "animal pseudobulk" where the app shows "litter pseudobulk".
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { datasetBundlePaths, readDatasetFromDisk } from '../../scripts/lib/bundleReader.mjs';
import { trackLabel } from '../data/datasetMeta';
import { getDataset } from '../data/datasets';
import { _resetDatasetMetaCache, loadDatasetMeta } from '../data/loadDatasetMeta';
import { listDatasets } from '../data/datasets';

const REVIEWED = 'mouse_pvn_crh_ela_gse174085';

afterEach(() => {
  for (const dataset of listDatasets()) delete (window as unknown as Record<string, unknown>)[dataset.metaGlobalKey];
  _resetDatasetMetaCache();
});

/** What the browser shows: evaluate the bundle as a <script> would, then load it. */
async function browserMeta(id: string) {
  const dataset = getDataset(id)!;
  const { file, global } = datasetBundlePaths(dataset).meta;
  const context: Record<string, unknown> = {};
  vm.runInNewContext(readFileSync(file, 'utf8'), context, { filename: file });
  (window as unknown as Record<string, unknown>)[global] = JSON.parse(JSON.stringify(context[global]));
  return loadDatasetMeta(dataset);
}

describe('Node reader ↔ browser loader label parity', () => {
  it('applies the reviewed GSE174085 label the explorer shows', async () => {
    const dataset = getDataset(REVIEWED)!;
    const raw = readFileSync(datasetBundlePaths(dataset).meta.file, 'utf8');
    // The published bytes keep the source wording; the correction is display-only.
    expect(raw).toContain('PVN CRH neurons (animal pseudobulk)');

    const node = readDatasetFromDisk(dataset).meta;
    const browser = await browserMeta(REVIEWED);
    expect(trackLabel(node, 'crh_pvn')).toBe('PVN CRH neurons (litter pseudobulk)');
    expect(trackLabel(node, 'crh_pvn')).toBe(trackLabel(browser, 'crh_pvn'));
  });

  it.each([
    ['mouse_arc_kcnb1_gse246918', 'arcuate', 'Arcuate nucleus (ARC)', 'Whole hypothalamus'],
    ['mouse_gnrh_androgen_gse162563', 'poa', 'GnRH / preoptic area (TRAP)', 'Preoptic area (GnRH-depleted TRAP supernatant)'],
  ])('applies the reviewed label of %s in the browser loader', async (id, track, source, corrected) => {
    expect(readFileSync(datasetBundlePaths(getDataset(id)!).meta.file, 'utf8')).toContain(source);
    expect(trackLabel(await browserMeta(id), track)).toBe(corrected);
  });

  it('matches the browser label for every track of every committed meta.js', async () => {
    for (const dataset of listDatasets()) {
      const node = readDatasetFromDisk(dataset).meta;
      const browser = await browserMeta(dataset.id);
      for (const trackId of node.populations) {
        expect(trackLabel(node, trackId), `${dataset.id}/${trackId}`).toBe(trackLabel(browser, trackId));
      }
    }
  });
});
