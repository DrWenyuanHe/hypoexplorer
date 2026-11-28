// The one transport for the expression survey's release-local JSON: NeuroSeq,
// the OXT cell reference and the GTEx/HPA/Allen/Visium atlases. Each family's
// generated products live under one same-origin root, belong to the app
// release (`?v=` app version) and are fetched lazily, once per session.
//
// The family names which files may be read, so a path taken from a manifest
// cannot reach another family's products or anything outside its root. A
// failed request is forgotten, so the next caller retries it; a successful
// one is shared by every later caller, including the search page's teaser.

import { EXTERNAL_REFERENCE_ROOTS } from './externalReferenceFormat';
import type { ExternalProvider } from './externalReferenceFormat';

export type SourceFamily = 'neuroseq' | 'oxt-reference' | ExternalProvider;

interface FamilyRule { root: string; files: RegExp; name: string }

const GENE_FILES = /^(?:manifest|gene-index|validation|shards\/[a-f0-9]{2})\.json$/;
const ATLAS_FILES = /^(?:manifest|validation|lookup\/l\d{4}|values\/v\d{4})\.json$/;
const atlas = (provider: ExternalProvider): FamilyRule =>
  ({ root: EXTERNAL_REFERENCE_ROOTS[provider], files: ATLAS_FILES, name: 'External reference' });

const FAMILIES: Record<SourceFamily, FamilyRule> = {
  neuroseq: { root: '/expression/neuroseq', files: GENE_FILES, name: 'NeuroSeq expression' },
  'oxt-reference': { root: '/expression/oxt-reference', files: GENE_FILES, name: 'Reference expression' },
  gtex: atlas('gtex'),
  hpa: atlas('hpa'),
  allen: atlas('allen'),
  // Visium also ships the index of its curated section images (src/search/visiumSectionIndex.ts).
  visium: { ...atlas('visium'), files: /^(?:manifest|validation|lookup\/l\d{4}|values\/v\d{4}|sections\/index)\.json$/ },
};

const requests = new Map<string, Promise<unknown>>();

/**
 * One generated file of a family, by its absolute site path (as the family's
 * manifest spells it). Rejects a path outside the family's file list; a failed
 * load is not cached.
 */
export function sourceJson<T>(family: SourceFamily, path: string): Promise<T> {
  const rule = Object.keys(FAMILIES).includes(family) ? FAMILIES[family] : null;
  const file = rule && path.startsWith(`${rule.root}/`) ? path.slice(rule.root.length + 1) : null;
  if (!rule || file === null || !rule.files.test(file)) {
    return Promise.reject(new Error(`Invalid ${rule?.name ?? 'expression'} asset path.`));
  }
  let request = requests.get(path);
  if (!request) {
    request = fetch(`${path}?v=${encodeURIComponent(__APP_VERSION__)}`, { cache: 'no-cache' }).then(async (response) => {
      if (!response.ok) throw new Error(`${rule.name} unavailable (${response.status}). Please retry.`);
      return response.json();
    }).catch((error: unknown) => { requests.delete(path); throw error; });
    requests.set(path, request);
  }
  return request as Promise<T>;
}

/** Test seam: forget every cached request of every family. */
export function resetSourceRequests(): void { requests.clear(); }
