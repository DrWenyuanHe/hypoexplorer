// The HypoMap atlas files the app reads (src/search/hypomap/atlas.ts) from
// `${BUNDLE_BASE}/hypomap/<tag>/`, with the tag pinned in hypomap-release.json.
// Where the release sits and which names it may hold are part of the data-origin
// layout (src/data/dataOriginLayout.ts); this module adds the integrity checks
// the R2 uploader (upload_bundles_r2.mts) runs before publishing it.
//
// The release holds manifest.json, metadata.json.gz, search-index.json.gz and
// gene shards genes-NNNN.json.gz (scripts/fetch/fetch_hypomap.mts installs and
// verifies them under public/hypomap/<tag>/).
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import release from '../../hypomap-release.json';
import {
  HYPOMAP_FIXED_FILES, HYPOMAP_KEY_PREFIX, HYPOMAP_SHARD_DIGITS, HYPOMAP_SHARD_PREFIX, HYPOMAP_TAG,
} from '../../src/data/dataOriginLayout';

const SHARD = new RegExp(`^${HYPOMAP_SHARD_PREFIX}\\d{${HYPOMAP_SHARD_DIGITS}}\\.json\\.gz$`);

/** The exact file names a release may contain. Stricter than the edge rule, which cannot test for digits. */
export function hypomapFileAllowed(name: string): boolean {
  return (HYPOMAP_FIXED_FILES as readonly string[]).includes(name) || SHARD.test(name);
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * The installed atlas files for the pinned tag, verified against the pinned
 * manifest checksum and every per-file size and checksum it lists, or null when
 * public/hypomap/<tag>/ is not installed. Throws on any extra, missing or
 * altered file, so the uploader never publishes a partial or edited release.
 */
export async function installedHypomapAtlas(publicRoot: string): Promise<string[] | null> {
  const directory = path.join(publicRoot, 'hypomap', HYPOMAP_TAG);
  const manifestBytes = await readFile(path.join(directory, 'manifest.json')).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!manifestBytes) return null;
  if (sha256(manifestBytes) !== release.manifestSha256) throw new Error(`public/${HYPOMAP_KEY_PREFIX}manifest.json does not match hypomap-release.json`);
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as { files?: { path: string; bytes: number; sha256: string }[] };
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('HypoMap manifest lists no files');
  const listed = new Set<string>();
  for (const file of manifest.files) {
    if (file.path === 'manifest.json' || !hypomapFileAllowed(file.path) || listed.has(file.path)) {
      throw new Error(`HypoMap manifest lists an unexpected file: ${file.path}`);
    }
    listed.add(file.path);
  }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'manifest.json') continue;
    if (!entry.isFile() || !listed.has(entry.name)) throw new Error(`Unexpected entry in public/${HYPOMAP_KEY_PREFIX}: ${entry.name}`);
  }
  for (const file of manifest.files) {
    const bytes = await readFile(path.join(directory, file.path));
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) {
      throw new Error(`public/${HYPOMAP_KEY_PREFIX}${file.path} does not match the manifest; rerun pnpm run fetch:hypomap`);
    }
  }
  return ['manifest.json', ...listed].map((name) => path.join(directory, name));
}
