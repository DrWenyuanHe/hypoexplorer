import { readFileSync } from 'node:fs';
import { queryCatalogContent } from '../../src/data/queryCatalogIdentity';

/** Bind browse counts to the same query corpus that accompanies this app build. */
export function readQueryCatalogBuild(path: string): { buildId: string; content: string } {
  const source = readFileSync(path, 'utf8');
  const match = source.match(/^(?:\s|\/\/[^\n]*\n)*var HX_QUERY_TRACKS\s*=\s*(\{[\s\S]*\})\s*;\s*$/);
  if (!match) throw new Error('Query catalog is missing its expected data wrapper');
  const manifest = JSON.parse(match[1]);
  if (typeof manifest.buildId !== 'string' || !manifest.buildId.trim()
    || !Array.isArray(manifest.tracks) || !manifest.tracks.length
    || !Array.isArray(manifest.datasets) || !manifest.datasets.length) {
    throw new Error('Query catalog has no build identity or dataset summaries');
  }
  return { buildId: manifest.buildId, content: queryCatalogContent(manifest) };
}
