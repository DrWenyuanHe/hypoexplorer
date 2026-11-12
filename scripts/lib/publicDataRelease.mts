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

/** Written by fetch:data, relative to public/. Dotfiles are never uploaded. */
export const PUBLIC_RELEASE_MARKER = 'datasets/.public-data-release.json';
/** Added by the release, relative to public/. */
export const KEGG_NOTE = 'datasets/KEGG_NOT_INCLUDED.md';
const MACAQUE = 'macaque_snrna';

export interface ReducedBundleScope {
  /** Only this dataset's bundles are being published (`upload:bundles --only`). */
  only?: string | null;
}

/** Parse a `var NAME = {...};` bundle; null when it is not one. */
function bundlePayload(text: string): unknown {
  const start = text.indexOf('{', Math.max(0, text.indexOf('var ')));
  if (start < 0) return null;
  try {
    return JSON.parse(text.slice(start).replace(/;\s*$/, ''));
  } catch {
    return null;
  }
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
    const macaque = path.join(datasetsRoot, MACAQUE);
    const tracks = existsSync(macaque)
      ? (await readdir(macaque)).filter((name) => /^track_.+\.js$/.test(name) && !name.endsWith('.pathways.js'))
      : [];
    let withheld = 0;
    for (const name of tracks) {
      const payload = bundlePayload(await readFile(path.join(macaque, name), 'utf8')) as { cpm?: unknown } | null;
      if (payload && 'cpm' in payload && isEmptyObject(payload.cpm)) withheld++;
    }
    if (withheld) {
      findings.push(`${withheld} of ${tracks.length} datasets/${MACAQUE} track bundles have an empty per-animal CPM, as the public release withholds it`);
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
