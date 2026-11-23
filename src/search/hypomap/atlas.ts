import { BUNDLE_BASE } from '../../data/bundleBase';
import type { AtlasExportKind, AtlasSubject, ExportSettings } from '../../utils/exportProvenance';
import release from '../../../hypomap-release.json';
import type { Csv } from './CsvDialog';

/**
 * Client for the static HypoMap atlas export (installed by `scripts/lib/hypomapAtlas.mts`
 * under the tag `hypomap-release.json` pins).
 *
 * The single place the export becomes values: transport, SHA-256 verification against the
 * pinned manifest, gzip, the cohort check, symbol resolution, named gene records, the
 * region vocabulary and expression unit, per-scope metrics, the dataset mean and SEM, and
 * the CSV tables the cards preview and download. Views never read the wire.
 *
 * `loadAtlasGene` keeps one load per symbol, so the gene report's two HypoMap cards resolve
 * a gene once; a failed load is forgotten so Retry fetches again. The transport is
 * swappable (`_setAtlasTransport`: fetch in the browser, an in-memory map in tests) and
 * `_resetAtlasCache` drops every cached file and gene.
 */

/** The scope covering every included cell, and the scope of cells HypoMap leaves unassigned. */
export const WHOLE = 'Whole hypothalamus';
export const NO_REGION = 'No HypoMap region';
/** The unit of the stored log-normalized expression the mean is taken over. */
export const EXPRESSION_UNIT = 'ln(1 + counts per 10k)';
/** The published cohort the client accepts (the dataset count is checked on every load). */
export const COHORT = { cells: 384_925, datasets: 18 } as const;

const MANIFEST = 'manifest.json';

type Manifest = {
  schema_version: number;
  shard_size: number;
  files: { path: string; sha256: string }[];
};
type MetricPair = [positive: number[], logSum: number[]];
/** [position, per-dataset annotations, per-dataset [positive cells, log sum] by context, null when the dataset lacks the feature]. */
type GeneRecord = [number, (unknown[] | null)[], (MetricPair | null)[]];
type WireGene = [id: string, symbol: string, name: string];
type Metadata = {
  cohort: string;
  contexts: string[];
  datasets: string[];
  eligible_cells: Record<string, number[]>;
  study_cards: { HypoMap_label: string }[];
};
type SearchIndex<G> = {
  genes: G[];
  current_symbols: Record<string, number[]>;
  aliases: Record<string, number[]>;
  outside_export_candidates: Record<string, { canonical_symbol: string }[]>;
};

/**
 * One feature of the export. Views read the named fields. Positions 0–2 repeat them in
 * the export's wire order because the co-detection client (codetection.ts) still indexes
 * genes positionally; drop them once it reads the names.
 */
export type Gene = WireGene & { readonly id: string; readonly symbol: string; readonly name: string };

function named([id, symbol, name]: WireGene): Gene {
  return Object.assign([id, symbol, name] as WireGene, { id, symbol, name });
}

// ── Transport ──────────────────────────────────────────────────────────────

/** Fetches one file of the pinned release as the bytes served; rejects on a transport failure. */
export type AtlasTransport = (file: string) => Promise<Uint8Array<ArrayBuffer>>;

const fetchTransport: AtlasTransport = async file => {
  const response = await fetch(`${BUNDLE_BASE}/hypomap/${release.tag}/${file}`);
  if (!response.ok) throw new Error(`Atlas file returned HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

let transport = fetchTransport;
const files = new Map<string, Promise<unknown>>();
const genes = new Map<string, Promise<AtlasResult>>();

/** Test-only: install a transport (e.g. one backed by an in-memory export), or restore fetch. */
export function _setAtlasTransport(next: AtlasTransport | null): void {
  transport = next ?? fetchTransport;
}

/** Test-only: forget every cached file and gene. */
export function _resetAtlasCache(): void {
  files.clear();
  genes.clear();
}

/** One pending value per key; a rejection is forgotten so the next call tries again. */
function remember<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = load();
  cache.set(key, pending);
  pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
  return pending;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** One verified, decoded file, shaped once by `parse` (each file is read in one place). */
function read<T, W = T>(file: string, parse: (wire: W) => T = wire => wire as unknown as T): Promise<T> {
  return remember(files, file, async () => {
    const bytes = await transport(file);
    const gzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
    // A host may supply Content-Encoding and expose decompressed bytes to fetch.
    // The installer verifies the original compressed bytes before publishing.
    if (file === MANIFEST || gzip) {
      const expected = file === MANIFEST ? release.manifestSha256
        : (await read<Manifest>(MANIFEST)).files.find(entry => entry.path === file)?.sha256;
      if (await sha256(bytes) !== expected) throw new Error('Atlas file checksum mismatch');
    }
    const wire = gzip
      ? await new Response((new Response(bytes).body as ReadableStream<Uint8Array<ArrayBuffer>>).pipeThrough(new DecompressionStream('gzip'))).json()
      : JSON.parse(new TextDecoder().decode(bytes));
    return parse(wire as W);
  }) as Promise<T>;
}

async function atlasExport() {
  const [manifest, metadata, index] = await Promise.all([
    read<Manifest>(MANIFEST),
    read<Metadata>('metadata.json.gz'),
    read('search-index.json.gz', (wire: SearchIndex<WireGene>): SearchIndex<Gene> => ({ ...wire, genes: wire.genes.map(named) })),
  ]);
  if (manifest.schema_version !== 1 || metadata.datasets.length !== COHORT.datasets) {
    throw new Error(`Expected the published ${COHORT.datasets}-dataset HypoMap export`);
  }
  return { manifest, metadata, index };
}

// ── Resolution ─────────────────────────────────────────────────────────────

/** A symbol the export cannot resolve to one feature. */
export type AtlasMiss = { state: 'missing' } | { state: 'ambiguous'; candidates: readonly string[] };

/** Own-property lookup, so a symbol such as "constructor" never reads the prototype. */
function own<T>(record: Record<string, T>, key: string): T | undefined {
  // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn requires ES2022; the app targets ES2020.
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

const keyOf = (symbol: string) => symbol.trim().toLowerCase();

/** A current symbol first, then an alias; a symbol also naming a feature outside the export is ambiguous. */
function resolve(index: SearchIndex<Gene>, symbol: string): { state: 'found'; position: number } | AtlasMiss {
  const key = keyOf(symbol);
  const exact = own(index.current_symbols, key);
  const matches = exact ?? own(index.aliases, key) ?? [];
  const outside = (!exact && own(index.outside_export_candidates, key)) || [];
  if (matches.length + outside.length > 1) {
    return { state: 'ambiguous', candidates: [...matches.map(i => index.genes[i].symbol), ...outside.map(g => g.canonical_symbol)] };
  }
  return matches.length ? { state: 'found', position: matches[0] } : { state: 'missing' };
}

/** The sentence both cards show for a symbol the export cannot resolve. */
export function missMessage(miss: AtlasMiss, symbol: string): string {
  return miss.state === 'ambiguous'
    ? `Multiple HypoMap features match ${symbol}. Search a canonical symbol: ${miss.candidates.join(', ')}.`
    : `No HypoMap feature matched ${symbol}.`;
}

/** Resolves a symbol to its feature through the search index alone (no expression record). */
export async function findAtlasGene(symbol: string): Promise<{ state: 'ready'; gene: Gene } | AtlasMiss> {
  const { index } = await atlasExport();
  const found = resolve(index, symbol);
  return found.state === 'found' ? { state: 'ready', gene: index.genes[found.position] } : found;
}

// ── Metrics ────────────────────────────────────────────────────────────────

function metrics(eligible: number, positive: number | null, logSum: number | null) {
  return {
    eligible, positive, logSum,
    detection: eligible > 0 && positive !== null ? 100 * positive / eligible : null,
    mean: positive && logSum !== null ? logSum / positive : null,
  };
}

/** Cells in one scope: eligible, detected (null when the feature is absent), and the derived % detected and mean when detected. */
export type Metrics = ReturnType<typeof metrics>;
export type DatasetMetrics = Metrics & { id: string; label: string };
export type MetricField = 'detection' | 'mean';
export type AtlasDataset = { id: string; label: string };

/** Pools cells over the datasets that measured the gene; an absent feature is left out, not counted as zero. */
function pool(rows: readonly Metrics[]): Metrics {
  const supported = rows.filter(row => row.positive !== null && row.eligible > 0);
  return metrics(
    supported.reduce((sum, row) => sum + row.eligible, 0),
    supported.reduce((sum, row) => sum + (row.positive ?? 0), 0),
    supported.reduce((sum, row) => sum + (row.logSum ?? 0), 0),
  );
}

/** The unweighted mean of the datasets' values for one metric, with its standard error. */
export function datasetSummary(rows: readonly DatasetMetrics[], field: MetricField) {
  const values = rows.flatMap(row => row[field] === null ? [] : [row[field]]);
  const mean = values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
  const sem = mean !== null && values.length > 1
    ? Math.sqrt(values.reduce((sum, n) => sum + (n - mean) ** 2, 0) / (values.length * (values.length - 1))) : null;
  return { values, mean, sem };
}

// ── The loaded gene ────────────────────────────────────────────────────────

export interface ReadyAtlas {
  state: 'ready';
  gene: Gene;
  /** Contributing datasets in export order. */
  datasets: readonly AtlasDataset[];
  /** Every scope the export reports, in export order (WHOLE and NO_REGION included). */
  regions: readonly string[];
  /** The anatomical regions: every scope except WHOLE and NO_REGION. */
  namedRegions: readonly string[];
  /** Pooled metrics per scope. */
  pooled: Readonly<Record<string, Metrics>>;
  /** Each dataset's metrics in one scope, in export order. */
  byDataset(region: string): DatasetMetrics[];
  /** The wire the co-detection client checks the service against; views do not read these. */
  metadata: Metadata;
  record: GeneRecord;
  /** Positions the co-detection service reports index this same export; `undefined` is a contract break. */
  geneAt(position: number): Gene | undefined;
}

export type AtlasResult = ReadyAtlas | AtlasMiss;

function readyAtlas(metadata: Metadata, index: SearchIndex<Gene>, record: GeneRecord): ReadyAtlas {
  const datasets = metadata.datasets.map((id, i) => ({ id, label: metadata.study_cards[i].HypoMap_label }));
  const byDataset = (region: string) => {
    const context = metadata.contexts.indexOf(region);
    return datasets.map((dataset, i) => ({
      ...dataset,
      ...metrics(metadata.eligible_cells[dataset.id][context], record[2][i]?.[0][context] ?? null, record[2][i]?.[1][context] ?? null),
    }));
  };
  return {
    state: 'ready',
    gene: index.genes[record[0]],
    datasets,
    regions: metadata.contexts,
    namedRegions: metadata.contexts.filter(context => context !== WHOLE && context !== NO_REGION),
    pooled: Object.fromEntries(metadata.contexts.map(context => [context, pool(byDataset(context))])),
    byDataset,
    metadata,
    record,
    geneAt: position => index.genes[position],
  };
}

async function loadGene(symbol: string): Promise<AtlasResult> {
  const { manifest, metadata, index } = await atlasExport();
  const found = resolve(index, symbol);
  if (found.state !== 'found') return found;
  const i = found.position;
  const shard = Math.floor(i / manifest.shard_size).toString().padStart(4, '0');
  const records = await read<GeneRecord[]>(`genes-${shard}.json.gz`);
  const record = records[i % manifest.shard_size];
  if (record?.[0] !== i) throw new Error('Atlas gene identity mismatch');
  return readyAtlas(metadata, index, record);
}

/** The gene's expression across the atlas, loaded once per symbol (case and surrounding space ignored). */
export function loadAtlasGene(symbol: string): Promise<AtlasResult> {
  return remember(genes, keyOf(symbol), () => loadGene(symbol));
}

// ── Exported tables ────────────────────────────────────────────────────────

/** A table a card previews and downloads, with what the export-provenance seam records for it. */
export type AtlasTable = { kind: AtlasExportKind; csv: Csv; subject: AtlasSubject; settings: ExportSettings };

const metricHeader = (field: MetricField) => field === 'detection' ? '% detected' : EXPRESSION_UNIT;

/** Wraps a table with the atlas release, cohort and gene it was read from. */
export function atlasTable(atlas: ReadyAtlas, kind: AtlasExportKind, csv: Csv, settings: ExportSettings = {}): AtlasTable {
  return {
    kind,
    csv,
    subject: {
      shape: 'atlas',
      release: { tag: release.tag, manifestSha256: release.manifestSha256 },
      cohort: atlas.metadata.cohort,
      gene: { id: atlas.gene.id, symbol: atlas.gene.symbol },
      expressionUnit: kind === 'hypomap_comparison' ? 'Not applicable: cell counts and percentages of eligible cells.' : EXPRESSION_UNIT,
    },
    settings,
  };
}

/** Pooled metrics for every scope the export reports. */
export function spatialTable(atlas: ReadyAtlas): AtlasTable {
  return atlasTable(atlas, 'hypomap_spatial', {
    title: `${atlas.gene.symbol} · Spatial expression`,
    headers: ['Region', 'Eligible cells', 'Detected cells', '% detected', EXPRESSION_UNIT],
    rows: atlas.regions.map(name => {
      const row = atlas.pooled[name];
      return [name, row.eligible, row.positive, row.detection, row.mean];
    }),
  });
}

/** One metric for the chosen datasets (`ids`, kept in export order) in one scope. */
export function datasetTable(atlas: ReadyAtlas, region: string, field: MetricField, ids: readonly string[]): AtlasTable {
  return atlasTable(atlas, 'hypomap_datasets', {
    title: `${atlas.gene.symbol} · ${region} · ${field === 'detection' ? 'Detection' : 'Mean expression'} by dataset`,
    headers: ['Dataset', 'Accession', 'Region', metricHeader(field)],
    rows: atlas.byDataset(region).filter(row => ids.includes(row.id)).map(row => [row.label, row.id, region, row[field]]),
  }, { region, metric: field, datasets: [...ids] });
}
