import release from '../../../hypomap-release.json';
import { type Gene, type ReadyAtlas, WHOLE } from './atlas';
import type { Csv } from './CsvDialog';

/**
 * Client for the gated HypoMap co-detection service (`services/hypomap/comparison_service.py`).
 *
 * The single place the co-expression card talks to the service: transport, response
 * validation, the export-identity check, resolution of the service's gene positions
 * against the static atlas export, pooling checks and the CSV rows. Views receive
 * discriminated unions and never read the wire. The wire is pinned on both sides by
 * `services/hypomap/codetection_wire.json`.
 *
 * Failure policy: a transport failure (network, HTTP status) rejects the promise, so a
 * caller can offer Retry; a response that disagrees with the static export or breaks the
 * contract resolves to `{ state: 'rejected' }` with a message to show, because retrying
 * cannot fix it and the numbers must not be rendered.
 */

/** Routed to the service's `/api/` by the offline dev proxy (vite.config.ts) or a hosted reverse proxy. */
const API = '/hypomap-preview-api';

export const CATEGORIES = ['both', 'queryOnly', 'partnerOnly', 'neither'] as const;
export type Category = (typeof CATEGORIES)[number];
export type Counts = {
  eligible: number;
  counts: Record<Category, number>;
  percentages: Record<Category, number | null>;
  conditionalPercent: number | null;
};
export type Population = Counts & { label: string };

/** One selected dataset: pooled when both genes are measured in it, otherwise named with each gene's state. */
export type DatasetOutcome =
  | (Counts & { state: 'measured'; dataset: string; label: string; c7: Population[] })
  | { state: 'unsupported'; dataset: string; label: string; query: string; partner: string };

type Measured = Extract<DatasetOutcome, { state: 'measured' }>;
type Unsupported = Extract<DatasetOutcome, { state: 'unsupported' }>;

export type Rejected = { state: 'rejected'; reason: 'export-mismatch' | 'invalid-response'; message: string };

export type Partner = { gene: Gene; both: number; conditionalPercent: number | null; reverseRank: number };
export type Ranking = { state: 'ready'; datasetCount: number; queryPositive: number; partners: Partner[] } | Rejected;

export type MeasuredComparison = {
  /** `partial` when at least one selected dataset could not be measured and is left out of the pooled counts. */
  state: 'ready' | 'partial';
  whole: Counts;
  c7: Population[];
  /** Every selected dataset, in atlas order. */
  datasets: DatasetOutcome[];
};
export type Comparison = MeasuredComparison | { state: 'unsupported'; datasets: DatasetOutcome[] } | Rejected;

const EXPORT_MISMATCH = 'The co-detection service was built from a different HypoMap export than this page reads, so its results are not shown.';

class ContractError extends Error {
  constructor(readonly reason: Rejected['reason'], message: string) {
    super(message);
  }
}

function fail(message: string): never {
  throw new ContractError('invalid-response', `The co-detection service sent an invalid response: ${message}.`);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) fail(`${what} is not a list`);
  return value;
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string') fail(`${what} is not text`);
  return value;
}

function integer(value: unknown, what: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) fail(`${what} is not an integer ≥ ${min}`);
  return value;
}

/** Category shares of all eligible cells, and the share of query-positive cells that also detect the partner. */
function summarize(counts: Record<Category, number>): Counts {
  const eligible = CATEGORIES.reduce((sum, key) => sum + counts[key], 0);
  const query = counts.both + counts.queryOnly;
  return {
    eligible,
    counts,
    percentages: Object.fromEntries(CATEGORIES.map(key => [key, eligible ? 100 * counts[key] / eligible : null])) as Counts['percentages'],
    conditionalPercent: query ? 100 * counts.both / query : null,
  };
}

/** Counts are pooled across datasets before any percentage is taken. */
function pool(rows: Counts[]): Counts {
  return summarize(Object.fromEntries(CATEGORIES.map(key => [key, rows.reduce((sum, row) => sum + row.counts[key], 0)])) as Counts['counts']);
}

const samePercent = (wire: unknown, derived: number | null) => derived === null ? wire === null
  : typeof wire === 'number' && Math.abs(wire - derived) <= 1e-9 * Math.max(1, Math.abs(derived));

/** Reads a wire summary, re-deriving its percentages from its counts. */
function parseCounts(value: unknown, what: string): Counts {
  if (!isRecord(value) || !isRecord(value.counts) || !isRecord(value.percentages)) fail(`${what} has no counts`);
  const wire = value.counts;
  const derived = summarize(Object.fromEntries(CATEGORIES.map(key => [key, integer(wire[key], `${what} ${key}`)])) as Counts['counts']);
  if (integer(value.eligible, `${what} eligible`) !== derived.eligible) fail(`${what} categories do not sum to its eligible cells`);
  const percentages = value.percentages;
  if (!CATEGORIES.every(key => samePercent(percentages[key], derived.percentages[key]))
    || !samePercent(value.conditionalPercent, derived.conditionalPercent)) fail(`${what} percentages disagree with its counts`);
  return derived;
}

function parsePopulations(value: unknown, what: string): Population[] {
  const rows = list(value, what).map((row, i) => {
    const label = text(isRecord(row) ? row.label : undefined, `${what} ${i} label`);
    return { label, ...parseCounts(row, `${what} ${label}`) };
  });
  if (new Set(rows.map(row => row.label)).size !== rows.length) fail(`${what} repeats a population`);
  return rows;
}

const sameCounts = (a: Counts, b: Counts) => CATEGORIES.every(key => a.counts[key] === b.counts[key]);

/** Pools each population label across datasets. */
function poolPopulations(groups: Population[][]): Map<string, Counts> {
  const byLabel = new Map<string, Counts[]>();
  for (const row of groups.flat()) byLabel.set(row.label, [...byLabel.get(row.label) ?? [], row]);
  return new Map([...byLabel].map(([label, rows]) => [label, pool(rows)]));
}

function checkExport(wire: Record<string, unknown>, atlas: ReadyAtlas) {
  if (wire.source_export_manifest_sha256 !== release.manifestSha256 || wire.cohort !== atlas.metadata.cohort) {
    throw new ContractError('export-mismatch', EXPORT_MISMATCH);
  }
}

function parseRanking(wire: unknown, atlas: ReadyAtlas): Ranking {
  if (!isRecord(wire)) fail('the ranking is not an object');
  checkExport(wire, atlas);
  const [position, datasets, positive, partners, ...extra] = list(wire.record, 'the ranking record');
  if (extra.length) fail('the ranking record has extra fields');
  if (position !== atlas.record[0]) fail(`the ranking is for another gene than ${atlas.gene[1]}`);
  const positions = list(datasets, 'ranking datasets').map(i => integer(i, 'a ranking dataset'));
  if (new Set(positions).size !== positions.length || positions.some(i => i >= atlas.metadata.datasets.length)) {
    fail('the ranking names unknown or repeated datasets');
  }
  const queryPositive = integer(positive, 'the query-positive cell count');
  const seen = new Set<number>([atlas.record[0]]);
  let previous = Number.POSITIVE_INFINITY;
  const resolved = list(partners, 'ranking partners').map(entry => {
    const [index, both, reverseRank, ...rest] = list(entry, 'a ranking partner');
    if (rest.length) fail('a ranking partner has extra fields');
    const at = integer(index, 'a partner position');
    const gene = atlas.geneAt(at);
    if (!gene || seen.has(at)) fail(`partner position ${at} is not a distinct gene of this export`);
    seen.add(at);
    const shared = integer(both, `${gene[1]} co-detected cells`, 1);
    if (shared > queryPositive || shared > previous) fail(`${gene[1]} co-detection is out of order or exceeds the query-positive cells`);
    previous = shared;
    return { gene, both: shared, conditionalPercent: 100 * shared / queryPositive, reverseRank: integer(reverseRank, `${gene[1]} reverse rank`, 1) };
  });
  return { state: 'ready', datasetCount: positions.length, queryPositive, partners: resolved };
}

function parseComparison(wire: unknown, atlas: ReadyAtlas, partner: Gene, selected: readonly string[]): Comparison {
  if (!isRecord(wire)) fail('the comparison is not an object');
  checkExport(wire, atlas);
  if (wire.query !== atlas.gene[0] || wire.partner !== partner[0] || wire.region !== WHOLE) {
    fail(`the comparison is not ${atlas.gene[1]} × ${partner[1]} across the whole hypothalamus`);
  }
  if (wire.state !== 'ready' && wire.state !== 'unsupported') fail(`unknown comparison state ${String(wire.state)}`);
  const { metadata } = atlas;
  const labelOf = (dataset: string) => {
    const i = metadata.datasets.indexOf(dataset);
    if (i < 0 || !selected.includes(dataset)) fail(`dataset ${dataset} was not selected`);
    return metadata.study_cards[i].HypoMap_label;
  };
  const measured = list(wire.datasets, 'datasets').map((row): Measured => {
    const dataset = text(isRecord(row) ? row.dataset : undefined, 'a dataset id');
    const totals = parseCounts(row, dataset);
    const c7 = parsePopulations((row as Record<string, unknown>).c7, `${dataset} C7`);
    if (!sameCounts(pool(c7), totals)) fail(`${dataset} C7 populations do not reconcile with its total`);
    return { state: 'measured', dataset, label: labelOf(dataset), ...totals, c7 };
  });
  const unsupported = list(wire.unsupported, 'unsupported datasets').map((row): Unsupported => {
    if (!isRecord(row)) fail('an unsupported dataset is not an object');
    const dataset = text(row.dataset, 'an unsupported dataset id');
    const query = text(row.query, `${dataset} query state`);
    const partnerState = text(row.partner, `${dataset} partner state`);
    if (query === 'supported' && partnerState === 'supported') fail(`${dataset} is unsupported although both genes are measured`);
    return { state: 'unsupported', dataset, label: labelOf(dataset), query, partner: partnerState };
  });
  const datasets: DatasetOutcome[] = [...measured, ...unsupported];
  if (datasets.length !== selected.length || new Set(datasets.map(row => row.dataset)).size !== selected.length) {
    fail('the comparison does not account for every selected dataset exactly once');
  }
  datasets.sort((a, b) => metadata.datasets.indexOf(a.dataset) - metadata.datasets.indexOf(b.dataset));
  if ((wire.state === 'ready') !== (measured.length > 0)) fail(`state ${wire.state} disagrees with ${measured.length} measured datasets`);

  const whole = parseCounts(wire.whole, 'the pooled total');
  const c7 = parsePopulations(wire.c7, 'pooled C7');
  const pooled = poolPopulations(measured.map(row => row.c7));
  if (!sameCounts(whole, pool(measured))) fail('the pooled total is not the sum of the measured datasets');
  if (c7.length !== pooled.size || c7.some(row => !pooled.has(row.label) || !sameCounts(row, pooled.get(row.label) as Counts))) {
    fail('pooled C7 populations are not the sum of the measured datasets');
  }
  if (!measured.length) return { state: 'unsupported', datasets };
  return { state: unsupported.length ? 'partial' : 'ready', whole, c7, datasets };
}

async function request<T>(endpoint: string, params: Record<string, string>, parse: (wire: unknown) => T, signal?: AbortSignal): Promise<T | Rejected> {
  const response = await fetch(`${API}/${endpoint}?${new URLSearchParams(params)}`, { signal });
  if (!response.ok) throw new Error(`HypoMap co-detection service returned HTTP ${response.status}`);
  const body = await response.text();
  try {
    let wire: unknown;
    try {
      wire = JSON.parse(body);
    } catch {
      fail('the body is not JSON');
    }
    return parse(wire);
  } catch (error) {
    if (error instanceof ContractError) return { state: 'rejected', reason: error.reason, message: error.message };
    throw error;
  }
}

/** The five partners most often co-detected with the atlas gene, pooled over the service's datasets. */
export function loadRanking(atlas: ReadyAtlas, signal?: AbortSignal): Promise<Ranking> {
  return request('recommendations', { gene: atlas.gene[0] }, wire => parseRanking(wire, atlas), signal);
}

/** Measured co-detection of the atlas gene and `partner`, pooled over the selected datasets. */
export function loadComparison(atlas: ReadyAtlas, partner: Gene, datasets: readonly string[], signal?: AbortSignal): Promise<Comparison> {
  return request('compare', { a: atlas.gene[0], b: partner[0], datasets: datasets.join(',') },
    wire => parseComparison(wire, atlas, partner, datasets), signal);
}

const FEATURE_STATES = new Map([
  ['supported', 'measured'],
  ['gene_not_found', 'not in this dataset'],
  ['duplicate_dataset_mapping', 'ambiguous feature mapping'],
]);

/** Why a dataset could not be measured, naming only the gene(s) it lacks. */
export function unsupportedReason(row: Unsupported, query: Gene, partner: Gene) {
  return ([[query, row.query], [partner, row.partner]] as const)
    .filter(([, state]) => state !== 'supported')
    .map(([gene, state]) => `${gene[1]}: ${FEATURE_STATES.get(state) ?? state.replace(/_/g, ' ')}`)
    .join('; ');
}

/** Category labels as the card and CSV spell them. */
export function categoryLabels(query: Gene, partner: Gene): Record<Category, string> {
  return { both: 'Both genes', queryOnly: `${query[1]} only`, partnerOnly: `${partner[1]} only`, neither: 'Neither gene' };
}

const EMPTY = summarize({ both: 0, queryOnly: 0, partnerOnly: 0, neither: 0 });

/**
 * The comparison as CSV rows for one scope (`population` null = all hypothalamic cells):
 * the pooled aggregate, then every selected dataset in atlas order. Unsupported datasets
 * stay in the table with a status and empty values, so a reader sees what the pool left out.
 */
export function comparisonCsv(comparison: MeasuredComparison, query: Gene, partner: Gene, population: string | null): Csv {
  const labels = categoryLabels(query, partner);
  const scope = population ?? 'All hypothalamic cells';
  const aggregate = population === null ? comparison.whole : comparison.c7.find(row => row.label === population) ?? EMPTY;
  const measured = comparison.datasets.filter(row => row.state === 'measured').length;
  const values = (row: Counts | null) => row === null
    ? [null, ...CATEGORIES.flatMap(() => [null, null]), null, null, null]
    : [row.eligible, ...CATEGORIES.flatMap(key => [row.counts[key], row.percentages[key]]),
      row.counts.both + row.counts.queryOnly, row.counts.both + row.counts.partnerOnly, row.conditionalPercent];
  return {
    title: `${query[1]} × ${partner[1]} · ${scope}`,
    headers: ['Dataset', 'Accession', 'Status', 'Eligible cells', ...CATEGORIES.flatMap(key => [`${labels[key]} (cells)`, `${labels[key]} (%)`]),
      `${query[1]}-positive cells`, `${partner[1]}-positive cells`, 'Conditional co-detection (%)'],
    rows: [
      ['Aggregate', null, `Pooled over ${measured} of ${comparison.datasets.length} selected datasets`, ...values(aggregate)],
      ...comparison.datasets.map(row => row.state === 'measured'
        ? [row.label, row.dataset, 'Measured', ...values(population === null ? row : row.c7.find(entry => entry.label === population) ?? EMPTY)]
        : [row.label, row.dataset, `Not measured (${unsupportedReason(row, query, partner)})`, ...values(null)]),
    ],
  };
}
