import { resolveNeuroseqGenes } from './neuroseqExpression';
import {
  EXTERNAL_LOOKUP_SHARDS, EXTERNAL_PROVIDERS, EXTERNAL_REFERENCE_ROOTS, EXTERNAL_REFERENCE_SCHEMA_VERSION,
  externalKey, externalLookupBucket, externalLookupFile, externalValueBucket, externalValueFile,
} from './externalReferenceFormat';
import type {
  ExternalLookupEntry, ExternalLookupShard, ExternalProvider, ExternalReferenceManifest,
  ExternalValidation, ExternalValueShard,
} from './externalReferenceFormat';
import type { ExpressionGeneResult, ExpressionGroupResult, ExpressionSource } from './expressionTypes';

const requests = new Map<string, Promise<unknown>>();
const checked = new WeakSet<object>();
const FILE = /^(?:manifest|validation|lookup\/l\d{4}|values\/v\d{4})\.json$/;

/** Same-origin generated products; only this family's file names are accepted. */
export function externalJson<T>(provider: ExternalProvider, file: string): Promise<T> {
  if (!EXTERNAL_PROVIDERS.includes(provider) || !FILE.test(file)) {
    return Promise.reject(new Error('Invalid external reference asset path.'));
  }
  const path = `${EXTERNAL_REFERENCE_ROOTS[provider]}/${file}`;
  let request = requests.get(path);
  if (!request) {
    request = fetch(`${path}?v=${encodeURIComponent(__APP_VERSION__)}`, { cache: 'no-cache' }).then(async (response) => {
      if (!response.ok) throw new Error(`External reference unavailable (${response.status}). Please retry.`);
      return response.json();
    }).catch((error: unknown) => { requests.delete(path); throw error; });
    requests.set(path, request);
  }
  return request as Promise<T>;
}

function validateManifest(manifest: ExternalReferenceManifest, provider: ExternalProvider): void {
  if (checked.has(manifest)) return;
  const fail = (what: string): never => { throw new Error(`External reference ${what} is inconsistent.`); };
  if (manifest?.schemaVersion !== EXTERNAL_REFERENCE_SCHEMA_VERSION || manifest.provider !== provider ||
      manifest.lookupShardCount !== EXTERNAL_LOOKUP_SHARDS || !Number.isInteger(manifest.valueShardCount) ||
      manifest.valueShardCount < 1 || !Array.isArray(manifest.sources) || !manifest.sources.length) fail('metadata');
  if (new Set(manifest.sources.map((source) => source.id)).size !== manifest.sources.length) fail('source metadata');
  const sampleIds = new Set<string>();
  for (const sample of manifest.samples) {
    if (sampleIds.has(sample.id)) fail('sample metadata');
    sampleIds.add(sample.id);
  }
  for (const source of manifest.sources) {
    const columns = manifest.columns[source.id];
    const summary = source.valueKind === 'summary';
    if (source.collection !== 'external' || !source.provider || !Array.isArray(columns) || !columns.length ||
        !Number.isInteger(manifest.featureCounts[source.id])) fail('source metadata');
    const keys = new Set(source.conditions.map((condition) => condition.key));
    if (keys.size !== source.conditions.length) fail('cohort metadata');
    for (const condition of source.conditions) {
      const own = columns.filter((column) => column.group === condition.key);
      const ok = summary
        ? own.length === 1 && own[0].sample === null
        : own.length === condition.sampleCount && own.every((column) => column.sample !== null);
      if (!ok) fail('cohort metadata');
    }
    for (const column of columns) {
      if (!keys.has(column.group)) fail('cohort metadata');
      if (column.sample !== null) {
        const sample = manifest.samples.find((entry) => entry.id === column.sample);
        if (!sample || sample.sourceId !== source.id || sample.groupId !== column.group) fail('sample metadata');
      }
    }
  }
  checked.add(manifest);
}

export async function loadExternalManifest(provider: ExternalProvider): Promise<ExternalReferenceManifest> {
  const manifest = await externalJson<ExternalReferenceManifest>(provider, 'manifest.json');
  validateManifest(manifest, provider);
  return manifest;
}

/** A provider whose products are missing or inconsistent is reported, not hidden. */
export async function loadExternalSources(): Promise<{ sources: ExpressionSource[]; errors: Partial<Record<ExternalProvider, string>> }> {
  const settled = await Promise.allSettled(EXTERNAL_PROVIDERS.map((provider) => loadExternalManifest(provider)));
  const sources: ExpressionSource[] = [];
  const errors: Partial<Record<ExternalProvider, string>> = {};
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') sources.push(...result.value.sources);
    else errors[EXTERNAL_PROVIDERS[index]] = result.reason instanceof Error ? result.reason.message : 'Unavailable.';
  });
  return { sources, errors };
}

export function providerOf(source: ExpressionSource): ExternalProvider {
  const provider = EXTERNAL_PROVIDERS.find((candidate) => source.id.startsWith(`${candidate}-`));
  if (!provider || source.collection !== 'external') throw new Error(`Unknown external source: ${source.id}`);
  return provider;
}

/** Builds groups in the source's own order; summary groups carry no samples and no mean. */
export function externalGeneResult(
  manifest: ExternalReferenceManifest, source: ExpressionSource, query: string,
  entry: ExternalLookupEntry, values: Array<number | null>,
): ExpressionGeneResult {
  const columns = manifest.columns[source.id];
  // Log-scale units (e.g. log2 microarray intensity) may be negative; linear ones may not.
  const signed = /\blog/i.test(source.unit);
  if (values.length !== columns.length ||
      values.some((value) => value !== null && (!Number.isFinite(value) || (!signed && value < 0)))) {
    throw new Error('External reference values do not match the source columns.');
  }
  const labels = new Map(manifest.samples.map((sample) => [sample.id, sample.label]));
  const groups: ExpressionGroupResult[] = source.conditions.map((condition) => {
    const slots = columns.flatMap((column, index) => column.group === condition.key ? [{ column, value: values[index] }] : []);
    if (source.valueKind === 'summary') {
      return { key: condition.key, label: condition.label, referenceEligible: condition.referenceEligible,
        samples: [], mean: null, n: 0, totalSamples: 0, summary: slots[0]?.value ?? null };
    }
    const samples = slots.map(({ column, value }) => ({ id: labels.get(column.sample!) ?? column.sample!, value }));
    const finite = samples.flatMap((sample) => sample.value == null ? [] : [sample.value]);
    return { key: condition.key, label: condition.label, referenceEligible: condition.referenceEligible,
      samples, mean: finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null,
      n: finite.length, totalSamples: samples.length };
  });
  return { sourceId: source.id, query, status: 'available', gene: entry.symbol || entry.id,
    geneId: entry.ensemblId || entry.id, unit: source.unit, groups,
    ...(source.featureLevel === 'probe' ? { probe: entry.id } : {}) };
}

export async function loadExternalExpression(source: ExpressionSource, genes: string[]): Promise<ExpressionGeneResult[]> {
  const provider = providerOf(source);
  const manifest = await loadExternalManifest(provider);
  const known = manifest.sources.find((candidate) => candidate.id === source.id);
  if (!known) throw new Error('Unknown external reference source.');
  const perQuery = await Promise.all(genes.map(async (query): Promise<ExpressionGeneResult[]> => {
    const base = { sourceId: known.id, query, unit: known.unit, groups: [] };
    const key = externalKey(query);
    const bucket = externalLookupBucket(key);
    const lookup = await externalJson<ExternalLookupShard>(provider, externalLookupFile(bucket));
    if (lookup.schemaVersion !== EXTERNAL_REFERENCE_SCHEMA_VERSION || lookup.provider !== provider || lookup.bucket !== bucket) {
      throw new Error('External reference lookup shard is inconsistent.');
    }
    const sourceIndex = manifest.sources.indexOf(known);
    const rows = lookup.keys[key] ?? [];
    if (!Array.isArray(rows) || rows.some((row) => !Array.isArray(row) || row.length !== 4 || !manifest.sources[row[0]])) {
      throw new Error('External reference lookup shard is inconsistent.');
    }
    const candidates: ExternalLookupEntry[] = rows.filter((row) => row[0] === sourceIndex)
      .map(([, id, symbol, ensemblId]) => ({ source: known.id, id, symbol, ensemblId }));
    const matches = resolveNeuroseqGenes(candidates.map((entry) => ({ ...entry, shard: '' })), query);
    if (!matches.length) return [{ ...base, status: 'not-retained' as const }];
    // Several probes of one gene are separate measurements, not an ambiguity.
    const probes = known.featureLevel === 'probe' && new Set(matches.map((entry) => entry.symbol)).size === 1;
    if (matches.length > 1 && !probes) {
      return [{ ...base, status: 'ambiguous' as const, candidates: matches.map((entry) => `${entry.symbol || entry.id} (${entry.id})`) }];
    }
    return Promise.all(matches.map(async (match) => {
      const entry = candidates.find((candidate) => candidate.id === match.id)!;
      const valueBucket = externalValueBucket(entry.id, manifest.valueShardCount);
      const shard = await externalJson<ExternalValueShard>(provider, externalValueFile(valueBucket));
      const values = shard.rows?.[known.id]?.[entry.id];
      if (shard.schemaVersion !== EXTERNAL_REFERENCE_SCHEMA_VERSION || shard.provider !== provider ||
          shard.bucket !== valueBucket || !Array.isArray(values)) {
        throw new Error('External reference value shard is inconsistent.');
      }
      return externalGeneResult(manifest, known, query, entry, values);
    }));
  }));
  return perQuery.flat();
}

/** The UI may say "verified" only when the report shows exact agreement. */
export async function loadExternalValidation(provider: ExternalProvider): Promise<ExternalValidation> {
  const manifest = await loadExternalManifest(provider);
  const report = await externalJson<ExternalValidation>(provider, 'validation.json');
  const features = manifest.sources.reduce((sum, source) => sum + manifest.featureCounts[source.id] * manifest.columns[source.id].length, 0);
  if (report.status !== 'verified' || report.provider !== provider || report.comparedValues !== features ||
      report.exactMatches !== report.comparedValues || report.maxAbsoluteDifference !== 0 ||
      !report.checkpoints.length || report.checkpoints.some((point) => Number(point.sourceText) !== point.value)) {
    throw new Error(`The ${provider.toUpperCase()} validation report does not establish exact source agreement.`);
  }
  return report;
}

export function resetExternalRequests(): void { requests.clear(); }
