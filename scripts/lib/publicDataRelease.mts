// Recognize dataset bundles restored from the public data release.
//
// The hypoexplorer-data release that `pnpm run fetch:data` (and `data:offline`)
// restores is reduced: every KEGG collection is an empty list, KEGG names are
// gone from the pathway indexes, and the macaque track bundles' per-animal CPM is
// an empty object (docs/DEVELOPMENT.md). Those bundles run the app offline, but
// uploading them to R2 would replace the full production bundles with them.
//
// Four independent signs, so one surviving is enough:
// - the marker fetch:data writes beside the bundles (a dotfile, never uploaded);
// - the KEGG_NOT_INCLUDED.md note the release adds to public/datasets/;
// - a macaque track bundle whose `cpm` is present and empty;
// - a corpus whose pathway bundles hold KEGG collections and every one is empty.
//   This one runs only over the whole corpus: a single study can legitimately
//   have no KEGG results.

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { getDataset } from '../../src/data/datasets';
import { datasetBundlePaths, readOptionalJsonp } from './bundleReader.mjs';

/** Written by fetch:data, relative to public/. Dotfiles are never uploaded. */
export const PUBLIC_RELEASE_MARKER = 'datasets/.public-data-release.json';
/** Added by the release, relative to public/. */
export const KEGG_NOTE = 'datasets/KEGG_NOT_INCLUDED.md';
const MACAQUE = 'macaque_snrna';

export interface ReducedBundleScope {
  /** Only this dataset's bundles are being published (`upload:bundles --only`). */
  only?: string | null;
}

const isEmptyObject = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;

/** How many KEGG collections a pathway bundle's text holds, and how many are empty. */
export function keggCollections(text: string): { total: number; empty: number } {
  let total = 0;
  let empty = 0;
  for (const match of text.matchAll(/"KEGG"\s*:\s*\[\s*(\])?/g)) {
    total++;
    if (match[1]) empty++;
  }
  return { total, empty };
}

/**
 * Reasons to believe `publicRoot` (the checkout's public/) holds bundles from the
 * public data release. An empty list means none was found.
 */
export async function reducedBundleFindings(publicRoot: string, scope: ReducedBundleScope = {}): Promise<string[]> {
  const findings: string[] = [];
  const markerPath = path.join(publicRoot, PUBLIC_RELEASE_MARKER);
  if (existsSync(markerPath)) {
    let tag = '';
    try { tag = JSON.parse(await readFile(markerPath, 'utf8')).tag ?? ''; } catch { /* still a marker */ }
    findings.push(`public/${PUBLIC_RELEASE_MARKER} records a restore of the public data release${tag ? ` ${tag}` : ''} (pnpm run fetch:data)`);
  }
  if (existsSync(path.join(publicRoot, KEGG_NOTE))) {
    findings.push(`public/${KEGG_NOTE} is present; the public data release adds it beside its reduced bundles`);
  }

  const datasetsRoot = path.join(publicRoot, 'datasets');
  if (!existsSync(datasetsRoot)) return findings;

  if (!scope.only || scope.only === MACAQUE) {
    // Every macaque track bundle the upload would publish: the tracks meta.js
    // declares AND every track_<id>.js file in the folder, since the uploader
    // walks the whole directory (a missing meta.js or an undeclared file must
    // not slip past the check). Each is named and parsed by the bundle reader;
    // a malformed or misplaced bundle throws (BundleReadError) rather than
    // passing as "not reduced": the upload stops on it in every mode.
    const macaque = getDataset(MACAQUE);
    if (!macaque) throw new Error(`${MACAQUE} is not in the dataset registry`);
    const paths = datasetBundlePaths(macaque, { publicRoot });
    const meta = readOptionalJsonp<{ populations?: string[] }>(paths.meta.file, paths.meta.global);
    const trackIds = new Set(meta?.populations ?? []);
    if (existsSync(paths.dir)) {
      for (const name of (await readdir(paths.dir)).sort()) {
        const id = /^track_(.+)\.js$/.exec(name)?.[1];
        if (!id || name.endsWith('.pathways.js')) continue;
        if (path.resolve(paths.track(id).file) !== path.resolve(paths.dir, name)) {
          throw new Error(`datasets/${MACAQUE}/${name}: not a track bundle its locator names; cannot check it`);
        }
        trackIds.add(id);
      }
    }
    let present = 0;
    let withheld = 0;
    for (const trackId of trackIds) {
      const bundle = paths.track(trackId);
      const payload = readOptionalJsonp<{ cpm?: unknown }>(bundle.file, bundle.global);
      if (!payload) continue;
      present++;
      if (typeof payload === 'object' && 'cpm' in payload && isEmptyObject(payload.cpm)) withheld++;
    }
    if (withheld) {
      findings.push(`${withheld} of ${present} datasets/${MACAQUE} track bundles have an empty per-animal CPM, as the public release withholds it`);
    }
  }

  if (!scope.only) {
    let total = 0;
    let empty = 0;
    for (const entry of await readdir(datasetsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const name of await readdir(path.join(datasetsRoot, entry.name))) {
        if (!name.endsWith('.pathways.js')) continue;
        const counts = keggCollections(await readFile(path.join(datasetsRoot, entry.name, name), 'utf8'));
        total += counts.total;
        empty += counts.empty;
      }
    }
    if (total > 0 && empty === total) {
      findings.push(`all ${total} KEGG collections in the pathway bundles are empty, as in the public release`);
    }
  }
  return findings;
}
