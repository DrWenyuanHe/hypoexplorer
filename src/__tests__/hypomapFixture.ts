import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { AtlasTransport } from '../search/hypomap/atlas';

// A small HypoMap atlas export in the installed release's layout (manifest, metadata,
// search index, gene shards), served to the atlas client through its in-memory transport.

type Pair = [positive: number[], logSum: number[]] | null;

export interface AtlasFixture {
  cohort?: string;
  contexts: string[];
  /** Contributing datasets in export order, with eligible cells per context. */
  datasets: { id: string; label: string; eligible: number[] }[];
  genes: [id: string, symbol: string, name: string][];
  aliases?: Record<string, number[]>;
  /** Lower-case symbol → canonical symbols of features outside the export. */
  outside?: Record<string, string[]>;
  /** Per gene position, per dataset: [positive cells, log sums] by context, or null when the dataset lacks the feature (the default). */
  records?: Record<number, Pair[]>;
  shardSize?: number;
  /** 'identity' serves decoded JSON, as a host that applied Content-Encoding would. */
  encoding?: 'gzip' | 'identity';
  /** Rewrites one file's JSON before it is encoded and listed in the manifest. */
  edit?: Record<string, (wire: any) => unknown>;
}

export type AtlasFiles = Record<string, Uint8Array<ArrayBuffer>>;

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const utf8 = (wire: unknown) => new Uint8Array(Buffer.from(JSON.stringify(wire)));
export const gzip = (wire: unknown) => new Uint8Array(gzipSync(Buffer.from(JSON.stringify(wire))));

/** `count` datasets named D01… / "Study 1"…, each with the same eligible cells per context unless `eligible` says otherwise. */
export function fixtureDatasets(count: number, eligible: (i: number) => number[]) {
  return Array.from({ length: count }, (_, i) => ({ id: `D${String(i + 1).padStart(2, '0')}`, label: `Study ${i + 1}`, eligible: eligible(i) }));
}

/** The release's files and the manifest SHA-256 to pin. */
export function atlasFiles(spec: AtlasFixture): { files: AtlasFiles; manifestSha256: string } {
  const shardSize = spec.shardSize ?? 2;
  const current: Record<string, number[]> = {};
  spec.genes.forEach(([, symbol], i) => { current[symbol.toLowerCase()] = [i]; });
  const wire: Record<string, unknown> = {
    'metadata.json.gz': {
      cohort: spec.cohort ?? 'fixture cohort',
      contexts: spec.contexts,
      datasets: spec.datasets.map(ds => ds.id),
      eligible_cells: Object.fromEntries(spec.datasets.map(ds => [ds.id, ds.eligible])),
      study_cards: spec.datasets.map(ds => ({ HypoMap_label: ds.label })),
    },
    'search-index.json.gz': {
      genes: spec.genes,
      current_symbols: current,
      aliases: spec.aliases ?? {},
      outside_export_candidates: Object.fromEntries(Object.entries(spec.outside ?? {})
        .map(([key, symbols]) => [key, symbols.map(canonical_symbol => ({ canonical_symbol }))])),
    },
  };
  for (let start = 0; start < spec.genes.length; start += shardSize) {
    const shard = String(start / shardSize).padStart(4, '0');
    wire[`genes-${shard}.json.gz`] = spec.genes.slice(start, start + shardSize).map((_, offset) => {
      const position = start + offset;
      return [position, spec.datasets.map(() => null), spec.records?.[position] ?? spec.datasets.map(() => null)];
    });
  }
  const files: AtlasFiles = {};
  const entries: { path: string; bytes: number; sha256: string }[] = [];
  for (const [path, value] of Object.entries(wire)) {
    const json = spec.edit?.[path]?.(structuredClone(value)) ?? value;
    const stored = gzip(json);
    entries.push({ path, bytes: stored.length, sha256: sha256(stored) });
    files[path] = spec.encoding === 'identity' ? utf8(json) : stored;
  }
  const manifest = utf8(spec.edit?.['manifest.json']?.({ schema_version: 1, shard_size: shardSize, files: entries })
    ?? { schema_version: 1, shard_size: shardSize, files: entries });
  files['manifest.json'] = manifest;
  return { files, manifestSha256: sha256(manifest) };
}

/** Serves `files` by name, recording each request; `fail` names files whose next request fails once. */
export function memoryTransport(files: AtlasFiles, fail: Set<string> = new Set()) {
  const requests: string[] = [];
  const transport: AtlasTransport = async file => {
    requests.push(file);
    if (fail.delete(file)) throw new Error(`Transport failed for ${file}`);
    const bytes = files[file];
    if (!bytes) throw new Error(`Atlas file returned HTTP 404`);
    return bytes.slice();
  };
  return { transport, requests };
}
