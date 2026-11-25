// The expression survey's derivations: which sources a filter selects, what a
// result panel shows (ranked bars, the gene matrix, the "Matched X → Y" note)
// and what an export writes. Pure functions of their inputs; the view renders
// what they return and the load hook (useSurveyLoad.ts) supplies the results.
//
// Two rules are stated once here:
// - Reference eligibility: `inReferenceScope` is the only spelling of "keep
//   this cohort or sample under the eligible-reference filter".
// - Value status: `ValueStatus` codes are what an export writes; the detail
//   table shows `VALUE_STATUS_LABEL` of the same code.
import { exportFilename } from '../utils/exportAction';
import { providerOf } from './externalReference';
import type { ExternalProvider, ExternalReferenceManifest } from './externalReferenceFormat';
import type { NeuroseqManifest } from './neuroseqExpression';
import type { ReferenceManifest } from './referenceExpression';
import type { ExpressionGeneResult, ExpressionSource } from './expressionTypes';

/** The expression survey page's sections; a gene's values live on its gene page and in the page's multi-gene survey. */
export type SurveySection = 'survey' | 'catalog' | 'sources';
/** Which sources a gene survey reads: defined populations, or tissue and broadly isolated neurons. */
export type SurveyMode = 'populations' | 'tissue';
export type Collection = 'neuroseq' | 'existing' | 'reference' | 'external' | 'all' | 'agrp';
export type TissueKind = 'whole' | 'arc' | 'isolated' | 'external' | 'all';
type ResultGroup = ExpressionGeneResult['groups'][number];

// ── Source presentation ──────────────────────────────────────────────────────

/** The collection a source is credited to: NeuroSeq, its provider, or its GEO accession. */
export function sourceCollection(source: ExpressionSource): string {
  if (source.collection === 'neuroseq') return 'NeuroSeq';
  if (source.collection === 'external') return source.provider?.name ?? 'External reference';
  return source.sourceUrl.match(/[?&]acc=(GSE\d+)/i)?.[1] ?? 'Study library';
}

export function isSummary(source: ExpressionSource | undefined): boolean {
  return source?.valueKind === 'summary';
}

/** Source-defined HY boundary structures (SFO), excluded from the population survey by default. */
export function isBoundary(source: ExpressionSource): boolean {
  return /\bSFO\b/i.test(source.region) || source.id.includes('.SFO_');
}

/** A summary group's published value, otherwise the stored-value mean; never a mean of summaries. */
export function groupValue(group: ResultGroup): number | null {
  return group.summary !== undefined ? group.summary : group.mean;
}

export function formatValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  return value < 0.01 || value >= 100000
    ? value.toExponential(2)
    : value.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/** Counts belong to the catalog when provided; they are never invented from DE arms. */
export function sampleCount(source: ExpressionSource): string {
  const count = 'sampleCount' in source ? source.sampleCount : null;
  return typeof count === 'number' ? String(count) : 'See cohorts';
}

export function missingLabel(result: ExpressionGeneResult | undefined): string {
  if (!result) return 'Unavailable';
  if (result.status === 'ambiguous')
    return `Ambiguous identifier${result.candidates?.length ? `: ${result.candidates.join(', ')}` : ''}`;
  return 'Not retained in this source';
}

// ── Reference eligibility and value status ───────────────────────────────────

/**
 * Whether a cohort or sample is shown under the eligible-reference filter. An
 * item without an explicit `referenceEligible: true` (an external atlas sample,
 * say) is never eligible.
 */
export function inReferenceScope(item: object, referenceOnly: boolean): boolean {
  return !referenceOnly || ('referenceEligible' in item && item.referenceEligible === true);
}

function scopedGroups(result: ExpressionGeneResult, referenceOnly: boolean): ResultGroup[] {
  return result.groups.filter((group) => inReferenceScope(group, referenceOnly));
}

export type ValueStatus = 'measured' | 'measured-zero' | 'missing' | 'published-summary';

export const VALUE_STATUS_LABEL: Record<ValueStatus, string> = {
  measured: 'Measured',
  'measured-zero': 'Measured zero',
  missing: 'Missing value',
  'published-summary': 'Published summary',
};

/** A stored sample value's status; a missing value is never a measured zero. */
export function sampleStatus(value: number | null): ValueStatus {
  return value == null ? 'missing' : value === 0 ? 'measured-zero' : 'measured';
}

function summaryStatus(value: number | null): ValueStatus {
  return value == null ? 'missing' : 'published-summary';
}

// ── Source selection ─────────────────────────────────────────────────────────

export interface SourceFilters {
  mode: SurveyMode;
  collection: Collection;
  region: string;
  includeSfo: boolean;
  /** Population ids the user picked; null means every choice. */
  selectedIds: readonly string[] | null;
  tissueKind: TissueKind;
}

/**
 * Everything that decides which sources a gene survey reads and which cohorts
 * it shows. The gene page and the survey page each hold one; the survey page
 * hands its scope to the gene page when a single gene is surveyed.
 */
export interface SurveyScope extends SourceFilters {
  /** Show only cohorts explicitly eligible as fed / reference cohorts. */
  referenceOnly: boolean;
}

export const DEFAULT_SURVEY_SCOPE: SurveyScope = {
  mode: 'populations',
  collection: 'neuroseq',
  region: 'all',
  includeSfo: false,
  selectedIds: null,
  tissueKind: 'whole',
  referenceOnly: false,
};

export interface SourceSelection {
  /** Regions offered by the region filter for the chosen collection. */
  regions: string[];
  /** Populations offered by the population picker. */
  choices: ExpressionSource[];
  /** The sources the survey loads: the picked populations, or the tissue sources in tissue mode. */
  selected: ExpressionSource[];
}

function inTissueKind(source: ExpressionSource, kind: TissueKind): boolean {
  if (source.scope === 'population') return false;
  if (kind === 'all') return true;
  if (kind === 'external') return source.collection === 'external';
  if (kind === 'isolated') return source.scope === 'isolated-neurons';
  if (source.scope !== 'tissue') return false;
  return kind === 'arc'
    ? /arcuate|\bAR[CH]\b/i.test(source.region)
    : /whole|^hypothalamus$/i.test(source.region);
}

export function selectSources(sources: readonly ExpressionSource[], filters: SourceFilters): SourceSelection {
  const { mode, collection, region, includeSfo, selectedIds, tissueKind } = filters;
  const inCollection = sources.filter(
    (source) =>
      source.scope === 'population' &&
      (collection === 'all' ||
        (collection === 'agrp' ? source.populationId === 'agrp' : source.collection === collection)) &&
      (includeSfo || !isBoundary(source)),
  );
  const regions = [...new Set(inCollection.map((source) => source.region))].sort();
  const choices = inCollection.filter((source) => region === 'all' || source.region === region);
  const selected =
    mode === 'tissue'
      ? sources.filter((source) => inTissueKind(source, tissueKind))
      : choices.filter((source) => selectedIds == null || selectedIds.includes(source.id));
  return { regions, choices, selected };
}

export interface CatalogFilters {
  collection: string;
  region: string;
  query: string;
}

/** Regions offered by the catalog's region filter. */
export function catalogRegions(sources: readonly ExpressionSource[]): string[] {
  return [...new Set(sources.filter((source) => source.scope === 'population').map((source) => source.region))].sort();
}

export function catalogEntries(sources: readonly ExpressionSource[], filters: CatalogFilters): ExpressionSource[] {
  const query = filters.query.toLowerCase();
  return sources.filter(
    (source) =>
      source.scope === 'population' &&
      (filters.collection === 'all' || source.collection === filters.collection) &&
      (filters.region === 'all' || source.region === filters.region) &&
      [
        source.label,
        source.id,
        source.populationLabel,
        source.region,
        source.assay,
        source.datasetId,
        source.notes,
        source.driverOrMarker,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query),
  );
}

/** Result panels: NeuroSeq populations share one matrix and unit, so they share a panel; every other source has its own. */
export function panelGroups(sources: readonly ExpressionSource[]): Array<[string, ExpressionSource[]]> {
  const groups = new Map<string, ExpressionSource[]>();
  for (const source of sources) {
    const key = source.collection === 'neuroseq' ? 'neuroseq' : source.id;
    groups.set(key, [...(groups.get(key) ?? []), source]);
  }
  return [...groups.entries()];
}

// ── Result panel ─────────────────────────────────────────────────────────────

export interface RankRow {
  source: ExpressionSource;
  group: ResultGroup;
  result: ExpressionGeneResult;
}

export interface BarAxis {
  minimum: number;
  maximum: number;
  range: number;
}

export interface MatrixCell {
  gene: string;
  /** Each probe's value, joined with " · "; a probe-level source is never merged. */
  text: string;
  title: string;
}

export interface MatrixRow {
  source: ExpressionSource;
  group: ResultGroup;
  cells: MatrixCell[];
}

export interface SurveyPanel {
  /** Results that belong to this panel's sources. */
  results: ExpressionGeneResult[];
  /** The first gene's cohorts (one row per probe), highest value first. */
  rows: RankRow[];
  axis: BarAxis;
  /** "query → gene (probe or gene id)" for each query whose matched feature differs, or null. */
  matched: string | null;
  /** Cohort × gene cells; empty unless the matrix display was asked for. */
  matrix: MatrixRow[];
  unavailable: ExpressionGeneResult[];
  /** What to say when nothing is shown, or null. */
  empty: string | null;
}

export interface PanelOptions {
  referenceOnly: boolean;
  matrix: boolean;
}

function matchedNote(results: readonly ExpressionGeneResult[]): string | null {
  // Name the matched feature whenever it differs from the query (case, species or ID).
  const matched = results.filter(
    (result) => result.status === 'available' && result.gene && result.gene !== result.query,
  );
  if (!matched.length) return null;
  return [...new Set(matched.map((result) => result.query))]
    .map((query) => {
      const hits = matched.filter((result) => result.query === query);
      const probes = hits.flatMap((result) => (result.probe ? [result.probe] : []));
      return `${query} → ${hits[0].gene} (${probes.length ? `${probes.length === 1 ? 'probe' : `${probes.length} probes`} ${probes.join(', ')}` : hits[0].geneId})`;
    })
    .join(' · ');
}

function matrixRows(
  sources: readonly ExpressionSource[],
  results: readonly ExpressionGeneResult[],
  genes: readonly string[],
  referenceOnly: boolean,
): MatrixRow[] {
  const summary = isSummary(sources[0]);
  return sources.flatMap((source) => {
    const rowResult = results.find((r) => r.sourceId === source.id && r.status === 'available');
    return (rowResult ? scopedGroups(rowResult, referenceOnly) : []).map((group) => ({
      source,
      group,
      cells: genes.map((gene) => {
        // A probe-level source has one result per probe; show each, never a merge.
        const found = results.filter((r) => r.sourceId === source.id && r.query === gene);
        const result = found[0];
        const values = found.map((r) => r.groups.find((g) => g.key === group.key));
        const probes = found.flatMap((r) => (r.probe ? [r.probe] : []));
        return {
          gene,
          text: values.length
            ? values.map((cell) => formatValue(cell ? groupValue(cell) : null)).join(' · ')
            : formatValue(null),
          title:
            result?.status === 'available'
              ? summary
                ? `Published value · ${result.unit}`
                : `${probes.length ? `Probes ${probes.join(', ')} · ` : ''}${values[0]?.n ?? 0} measured samples · ${result.unit}`
              : missingLabel(result),
        };
      }),
    }));
  });
}

/** Everything one result panel shows, for its sources and the surveyed genes (the first gene drives the bars). */
export function surveyPanel(
  sources: readonly ExpressionSource[],
  allResults: readonly ExpressionGeneResult[],
  genes: readonly string[],
  { referenceOnly, matrix }: PanelOptions,
): SurveyPanel {
  const ids = new Set(sources.map((source) => source.id));
  const byId = new Map(sources.map((source) => [source.id, source]));
  const results = allResults.filter((result) => ids.has(result.sourceId));
  const rows: RankRow[] = [];
  for (const result of results.filter((r) => r.query === genes[0])) {
    const source = byId.get(result.sourceId);
    if (source && result.status === 'available')
      for (const group of scopedGroups(result, referenceOnly)) rows.push({ source, group, result });
  }
  rows.sort((a, b) => (groupValue(b.group) ?? -Infinity) - (groupValue(a.group) ?? -Infinity));
  // The axis changes between studies. Within NeuroSeq, populations share the
  // same source matrix and unit, so a common axis is scientifically meaningful.
  const maximum = Math.max(0, ...rows.map((row) => groupValue(row.group) ?? 0));
  const minimum = Math.min(0, ...rows.map((row) => groupValue(row.group) ?? 0));
  const cells = matrix ? matrixRows(sources, results, genes, referenceOnly) : [];
  return {
    results,
    rows,
    axis: { minimum, maximum, range: maximum - minimum || 1 },
    matched: matchedNote(results),
    matrix: cells,
    unavailable: results.filter((result) => result.status !== 'available'),
    empty:
      rows.length || (matrix && cells.length)
        ? null
        : referenceOnly && results.some((r) => r.status === 'available')
          ? 'No explicitly eligible reference cohort in this selection. Use all reported states to inspect the source.'
          : 'No expression value is available for this selection.',
  };
}

/** A bar's zero line, left edge and width, as percentages of the panel axis. */
export function barGeometry(value: number | null, { minimum, range }: BarAxis): { zero: number; left: number; width: number } {
  return {
    zero: (-minimum / range) * 100,
    left: ((Math.min(0, value ?? 0) - minimum) / range) * 100,
    width: (Math.abs(value ?? 0) / range) * 100,
  };
}

// ── Exports ──────────────────────────────────────────────────────────────────

export type ExportFormat = 'samples' | 'summary' | 'metadata';

export interface ExportManifests {
  neuroseq: NeuroseqManifest | null;
  reference: ReferenceManifest | null;
  external: ExternalReferenceManifest[];
}

/** The sample manifests a metadata export reads for these sources. */
export function exportManifestNeeds(sources: readonly ExpressionSource[]): {
  neuroseq: boolean;
  reference: boolean;
  providers: ExternalProvider[];
} {
  return {
    neuroseq: sources.some((source) => source.collection === 'neuroseq'),
    reference: sources.some((source) => source.collection === 'reference'),
    providers: [...new Set(sources.filter((source) => source.collection === 'external').map(providerOf))],
  };
}

export interface ExportInput {
  sources: readonly ExpressionSource[];
  results: readonly ExpressionGeneResult[];
  genes: readonly string[];
  referenceOnly: boolean;
  /** ISO timestamp written into a metadata export. */
  exportedAt: string;
  /** Required for the metadata format; see `exportManifestNeeds`. */
  manifests?: ExportManifests;
}

export interface SurveyExport {
  filename: string;
  content: string;
  type: string;
}

const CSV_BASE_COLUMNS = [
  'source_id',
  'source_url',
  'population',
  'species',
  'region',
  'assay',
  'rna_fraction',
  'query',
  'gene',
  'gene_id',
  'probe',
  'identifier_candidates',
  'gene_status',
  'cohort_key',
  'cohort',
  'reference_eligible',
  'unit',
];
const CSV_VALUE_COLUMNS = {
  samples: ['sample_id', 'value', 'value_status'],
  summary: ['mean_stored_value', 'measured_samples', 'total_samples', 'value_kind'],
};

/** The survey's own CSV cell: quoted, with text that a spreadsheet would evaluate kept literal. */
function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  // Keep text identifiers literal in spreadsheet applications. Numeric values,
  // including negative transformed expression, retain their numeric spelling.
  const literal = typeof value === 'string' && /^[\t\r\n ]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${literal.replace(/"/g, '""')}"`;
}

function scopedResults(results: readonly ExpressionGeneResult[], referenceOnly: boolean): ExpressionGeneResult[] {
  return results.map((result) => ({ ...result, groups: scopedGroups(result, referenceOnly) }));
}

/** The header and rows of a samples or cohort-means CSV, before cell escaping. */
export function csvTable(format: 'samples' | 'summary', input: Pick<ExportInput, 'sources' | 'results' | 'referenceOnly'>): unknown[][] {
  const sourceMap = new Map(input.sources.map((source) => [source.id, source]));
  const rows: unknown[][] = [[...CSV_BASE_COLUMNS, ...CSV_VALUE_COLUMNS[format]]];
  for (const result of scopedResults(input.results, input.referenceOnly)) {
    const source = sourceMap.get(result.sourceId);
    if (!source) continue;
    const base = [
      source.id,
      source.sourceUrl,
      source.populationLabel,
      source.species,
      source.region,
      source.assay,
      source.rnaFraction,
      result.query,
      result.gene,
      result.geneId,
      result.probe,
      result.candidates?.join('; '),
      result.status,
    ];
    if (!result.groups.length) rows.push([...base, '', '', '', result.unit, '', '', '', ...(format === 'samples' ? [] : [''])]);
    for (const group of result.groups) {
      const cohort = [...base, group.key, group.label, group.referenceEligible, result.unit];
      if (group.summary !== undefined) {
        // A published summary has no sample; it is exported as stated, never as a mean.
        rows.push(format === 'samples'
          ? [...cohort, '', group.summary, summaryStatus(group.summary)]
          : [...cohort, group.summary, '', '', 'published-summary']);
      } else if (format === 'samples') {
        for (const sample of group.samples) rows.push([...cohort, sample.id, sample.value, sampleStatus(sample.value)]);
      } else rows.push([...cohort, group.mean, group.n, group.totalSamples, 'mean']);
    }
  }
  return rows;
}

function metadataDocument(input: ExportInput): unknown {
  const { sources, referenceOnly } = input;
  const manifests = input.manifests ?? { neuroseq: null, reference: null, external: [] };
  const neuroseqIds = new Set(sources.filter((source) => source.collection === 'neuroseq').map((source) => source.id));
  const referenceIds = new Set(sources.filter((source) => source.collection === 'reference').map((source) => source.id));
  const externalIds = new Set(sources.filter((source) => source.collection === 'external').map((source) => source.id));
  const sampleMetadata = [
    ...(manifests.neuroseq?.samples.filter(
      (sample) => neuroseqIds.has(sample.populationId) && inReferenceScope(sample, referenceOnly),
    ) ?? []),
    ...(manifests.reference?.samples.filter(
      (sample) => referenceIds.has(sample.sourceId) && inReferenceScope(sample, referenceOnly),
    ) ?? []),
    // External samples carry no eligibility, so the reference filter excludes them.
    ...manifests.external.flatMap((manifest) =>
      manifest.samples.filter((sample) => externalIds.has(sample.sourceId) && inReferenceScope(sample, referenceOnly)),
    ),
  ];
  return {
    exportedAt: input.exportedAt,
    genes: input.genes,
    referenceOnly,
    summary:
      'Arithmetic mean of available stored sample values within each source and cohort; no cross-study mean. Summary sources carry the provider\'s published value in `summary` and no computed mean.',
    sources,
    sampleMetadata,
    results: scopedResults(input.results, referenceOnly),
  };
}

/** The file an export writes: sample values or cohort means as CSV, or values with sample metadata as JSON. */
export function surveyExport(format: ExportFormat, input: ExportInput): SurveyExport {
  const filename = exportFilename(['expression', input.genes.join('-'), format], format === 'metadata' ? 'json' : 'csv');
  if (format === 'metadata')
    return { filename, content: JSON.stringify(metadataDocument(input), null, 2), type: 'application/json' };
  return {
    filename,
    content: csvTable(format, input).map((row) => row.map(csvCell).join(',')).join('\r\n'),
    type: 'text/csv;charset=utf-8',
  };
}
