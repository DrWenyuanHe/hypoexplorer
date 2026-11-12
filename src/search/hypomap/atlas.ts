import { BUNDLE_BASE } from '../../data/bundleBase';
import release from '../../../hypomap-release.json';

type Manifest = {
  schema_version: number;
  shard_size: number;
  files: { path: string; sha256: string }[];
};
type MetricPair = [number[], number[]];
type GeneRecord = [number, (unknown[] | null)[], (MetricPair | null)[]];
type Gene = [id: string, symbol: string, name: string];
type Metadata = {
  cohort: string;
  contexts: string[];
  datasets: string[];
  eligible_cells: Record<string, number[]>;
  study_cards: { HypoMap_label: string }[];
};
type SearchIndex = {
  genes: Gene[];
  current_symbols: Record<string, number[]>;
  aliases: Record<string, number[]>;
  outside_export_candidates: Record<string, { canonical_symbol: string }[]>;
};

const base = `${BUNDLE_BASE}/hypomap/${release.tag}`;
const cache = new Map<string, Promise<unknown>>();

function read<T>(file: string): Promise<T> {
  let pending = cache.get(file);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(`${base}/${file}`);
      if (!response.ok) throw new Error(`Atlas file returned HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      // A host may supply Content-Encoding and expose decompressed bytes to fetch.
      // The installer verifies the original compressed bytes before publishing.
      if (file === 'manifest.json' || (bytes[0] === 0x1f && bytes[1] === 0x8b)) {
        const expected = file === 'manifest.json' ? release.manifestSha256
          : (await read<Manifest>('manifest.json')).files.find(entry => entry.path === file)?.sha256;
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (hash !== expected) throw new Error('Atlas file checksum mismatch');
      }
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
      }
      return JSON.parse(new TextDecoder().decode(bytes));
    })();
    cache.set(file, pending);
    pending.catch(() => cache.delete(file));
  }
  return pending as Promise<T>;
}

export async function loadAtlasGene(symbol: string) {
  const [manifest, metadata, index] = await Promise.all([
    read<Manifest>('manifest.json'),
    read<Metadata>('metadata.json.gz'),
    read<SearchIndex>('search-index.json.gz'),
  ]);
  if (manifest.schema_version !== 1 || metadata.datasets.length !== 18) {
    throw new Error('Expected the published 18-dataset HypoMap export');
  }
  const key = symbol.trim().toLowerCase();
  const exact = Object.prototype.hasOwnProperty.call(index.current_symbols, key) ? index.current_symbols[key] : undefined;
  const matches = exact ?? (Object.prototype.hasOwnProperty.call(index.aliases, key) ? index.aliases[key] : []);
  const outside = !exact && Object.prototype.hasOwnProperty.call(index.outside_export_candidates, key)
    ? index.outside_export_candidates[key] : [];
  if (matches.length + outside.length > 1) {
    return { state: 'ambiguous', candidates: [...matches.map(i => index.genes[i][1]), ...outside.map(g => g.canonical_symbol)] } as const;
  }
  if (!matches.length) return { state: 'missing' } as const;
  const i = matches[0];
  const shard = Math.floor(i / manifest.shard_size).toString().padStart(4, '0');
  const records = await read<GeneRecord[]>(`genes-${shard}.json.gz`);
  const record = records[i % manifest.shard_size];
  if (record?.[0] !== i) throw new Error('Atlas gene identity mismatch');
  return { state: 'ready', metadata, record, gene: index.genes[i], geneAt: (position: number) => index.genes[position] } as const;
}

function metrics(eligible: number, positive: number | null, logSum: number | null) {
  return {
    eligible, positive, logSum,
    detection: eligible > 0 && positive !== null ? 100 * positive / eligible : null,
    mean: positive && logSum !== null ? logSum / positive : null,
  };
}

export type Metrics = ReturnType<typeof metrics>;

export function datasetMetrics(metadata: Metadata, record: GeneRecord, region: string) {
  const context = metadata.contexts.indexOf(region);
  return metadata.datasets.map((id, i) => ({
    id,
    label: metadata.study_cards[i].HypoMap_label,
    ...metrics(metadata.eligible_cells[id][context], record[2][i]?.[0][context] ?? null, record[2][i]?.[1][context] ?? null),
  }));
}

export type DatasetMetrics = ReturnType<typeof datasetMetrics>[number];

export function poolMetrics(rows: DatasetMetrics[]) {
  const supported = rows.filter(row => row.positive !== null && row.eligible > 0);
  return metrics(
    supported.reduce((sum, row) => sum + row.eligible, 0),
    supported.reduce((sum, row) => sum + (row.positive ?? 0), 0),
    supported.reduce((sum, row) => sum + (row.logSum ?? 0), 0),
  );
}
