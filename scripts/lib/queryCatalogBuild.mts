import { readFileSync } from 'node:fs';
import { parsePointer } from '../../src/data/dataOriginLayout';
import { queryCatalogContent } from '../../src/data/queryCatalogIdentity';

/** Bind browse counts to the same query corpus that accompanies this app build. */
export function readQueryCatalogBuild(path: string): { buildId: string; content: string } {
  const { buildId, manifest } = parsePointer('tracks', readFileSync(path, 'utf8'));
  if (!Array.isArray(manifest.tracks) || !manifest.tracks.length || !Array.isArray(manifest.datasets) || !manifest.datasets.length) {
    throw new Error('Query catalog has no track or dataset summaries');
  }
  return { buildId, content: queryCatalogContent(manifest as unknown as Parameters<typeof queryCatalogContent>[0]) };
}
