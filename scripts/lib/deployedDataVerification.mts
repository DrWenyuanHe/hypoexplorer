import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expressionManifestKey, isBuildId, POINTERS } from '../../src/data/dataOriginLayout';
import { sha256 } from './releaseBuild.mjs';

export interface ServedDataCheck { ok: boolean; name: string; detail: string }
export type FetchBytes = (url: string) => Promise<{ status: number; body: Buffer }>;

// Deliberate samples: an animal-pseudobulk track and a factorial deposited-value
// track. These checks establish exact bytes for these objects, not the corpus.
export const REPRESENTATIVE_TRACKS = [
  '/datasets/macaque_snrna/track_Ast1.js',
  '/datasets/mouse_pomc_maternal_hfd_gse135639/track_pomc.js',
] as const;

export async function verifyServedReleaseData(
  root: string,
  options: { dataOrigin: string; bundleVersion: string; querySha256: string | null; expressionBuildId: string | null },
  fetchBytes: FetchBytes,
): Promise<ServedDataCheck[]> {
  const results: ServedDataCheck[] = [];
  const version = `?v=${encodeURIComponent(options.bundleVersion)}`;
  const expressionBuildId = isBuildId('expression', options.expressionBuildId) ? options.expressionBuildId : null;
  const targets = [
    { path: `/${POINTERS.tracks.key}`, suffix: version, name: 'deployed query pointer matches release SHA-256', pinnedHash: options.querySha256 },
    { path: `/${POINTERS.expression.key}`, suffix: version, name: 'deployed expression pointer matches local bytes' },
    ...(expressionBuildId ? [{
      path: `/${expressionManifestKey(expressionBuildId)}`, suffix: '',
      name: 'deployed pinned expression manifest matches local bytes',
    }] : []),
    ...REPRESENTATIVE_TRACKS.map((path) => ({ path, suffix: version, name: `sampled track matches local SHA-256: ${path}` })),
  ];
  if (!expressionBuildId) {
    results.push({ ok: false, name: 'deployed pinned expression manifest matches local bytes', detail: 'No valid local expression build identity' });
  }
  for (const target of targets) {
    try {
      const local = readFileSync(resolve(root, `public${target.path}`));
      const expected = sha256(local);
      if ('pinnedHash' in target && (!target.pinnedHash || target.pinnedHash !== expected)) {
        throw new Error('Local query pointer does not match the release identity');
      }
      const url = `${options.dataOrigin.replace(/\/+$/, '')}${target.path}${target.suffix}`;
      const remote = await fetchBytes(url);
      const actual = sha256(remote.body);
      const ok = remote.status === 200 && actual === expected;
      results.push({ ok, name: target.name, detail: ok
        ? `${url}: ${local.length} bytes, SHA-256 ${expected}`
        : `${url}: HTTP ${remote.status}, SHA-256 ${actual}; expected ${expected}` });
    } catch (error) {
      results.push({ ok: false, name: target.name, detail: String(error) });
    }
  }
  return results;
}
