// The gitignored inputs a production build ships but this repository does not
// carry, and how to tell whether a checkout (or a built dist/) has them.
//
// - public/query/{tracks.js,expression-manifest.js,expression/<id>/manifest.js}:
//   the query catalog Vite stamps into the app. It must be the catalog the data
//   origin serves, or the deployed app pins an index generation R2 does not hold.
// - public/tracker/catalog.js: the Dataset Tracker catalog, generated from survey
//   notes that are not in this repository.
// - public/expression/{gtex,hpa,allen-human}/: the GTEx, HPA and Allen reference
//   atlases the Expression survey loads same-origin. A deploy without them
//   removes them from the live site.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  EXTERNAL_LOOKUP_SHARDS, EXTERNAL_PROVIDERS, EXTERNAL_REFERENCE_ROOTS, externalLookupFile, externalValueFile,
} from '../../src/expression-survey/externalReferenceFormat';

/** Directory names under expression/, e.g. 'gtex', 'hpa', 'allen-human'. */
export const ATLAS_DIRS: readonly string[] = EXTERNAL_PROVIDERS.map((provider) => EXTERNAL_REFERENCE_ROOTS[provider].replace(/^\/expression\//, ''));

export const TRACKER_CATALOG = 'tracker/catalog.js';
export const QUERY_POINTERS = ['query/tracks.js', 'query/expression-manifest.js'] as const;

interface AtlasManifestCounts {
  lookupShardCount: number;
  valueShardCount: number;
  validationPath?: string;
}

/** Every file of one atlas other than its manifest, relative to the atlas directory. */
export function atlasFiles(manifest: AtlasManifestCounts): string[] {
  for (const key of ['lookupShardCount', 'valueShardCount'] as const) {
    if (!Number.isInteger(manifest[key]) || manifest[key] < 1) throw new Error(`atlas manifest has no valid ${key}`);
  }
  return [
    manifest.validationPath || 'validation.json',
    ...Array.from({ length: manifest.lookupShardCount }, (_, i) => externalLookupFile(i)),
    ...Array.from({ length: manifest.valueShardCount }, (_, i) => externalValueFile(i)),
  ];
}

/**
 * Problems with one atlas directory: a missing or unreadable manifest, or files
 * the manifest names that are absent. An empty list means the atlas is complete.
 */
export function atlasProblems(atlasRoot: string, label: string): string[] {
  const manifestPath = path.join(atlasRoot, 'manifest.json');
  if (!existsSync(manifestPath)) return [`${label}/manifest.json is missing`];
  let manifest: AtlasManifestCounts;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return [`${label}/manifest.json does not parse`];
  }
  if (manifest.lookupShardCount !== EXTERNAL_LOOKUP_SHARDS) {
    return [`${label}/manifest.json names ${manifest.lookupShardCount} lookup shards, not ${EXTERNAL_LOOKUP_SHARDS}`];
  }
  let files: string[];
  try {
    files = atlasFiles(manifest);
  } catch (error) {
    return [`${label}/manifest.json: ${error instanceof Error ? error.message : String(error)}`];
  }
  const missing = files.filter((file) => !existsSync(path.join(atlasRoot, file)));
  if (!missing.length) return [];
  const shown = missing.slice(0, 3).join(', ');
  return [`${label}/ is missing ${missing.length} of ${files.length} files (${shown}${missing.length > 3 ? ', …' : ''})`];
}

/** Problems across every atlas under `<root>/expression/`. `root` is public/ or dist/. */
export function allAtlasProblems(root: string, rootLabel: string): string[] {
  return ATLAS_DIRS.flatMap((dir) => atlasProblems(path.join(root, 'expression', dir), `${rootLabel}/expression/${dir}`));
}

/** The expression build a pointer file names, or null. */
export function expressionBuildIdOf(pointer: string): string | null {
  return pointer.match(/"buildId":"([a-f0-9]{64})"/)?.[1] ?? null;
}
