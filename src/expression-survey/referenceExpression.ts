import { resolveNeuroseqGenes } from './neuroseqExpression';
import type { ExpressionGeneResult, ExpressionSource } from './expressionTypes';

export interface ReferenceSample {
  id: string;
  label: string;
  sourceId: string;
  groupId: string;
  sourceAnimalLabel: string;
  age: string;
  fluorogold: string;
  sourcePlate: string;
  referenceEligible: boolean;
}

export interface ReferenceManifest {
  schemaVersion: number;
  geneCount: number;
  sampleCount: number;
  sources: ExpressionSource[];
  samples: ReferenceSample[];
  geneIndexPath: string;
  validationPath: string;
}

interface GeneEntry { id: string; symbol: string; ensemblId: string; shard: string }
interface GeneValues extends Omit<GeneEntry, 'shard'> { values: number[] }
const requests = new Map<string, Promise<unknown>>();

/** Release-local source data; accept only this reference's generated products. */
export function referenceJson<T>(path: string): Promise<T> {
  if (!/^\/expression\/oxt-reference\/(?:manifest|gene-index|validation|shards\/[a-f0-9]{2})\.json$/.test(path)) {
    return Promise.reject(new Error('Invalid reference expression asset path.'));
  }
  let request = requests.get(path);
  if (!request) {
    request = fetch(`${path}?v=${encodeURIComponent(__APP_VERSION__)}`, { cache: 'no-cache' }).then(async (response) => {
      if (!response.ok) throw new Error(`Reference expression unavailable (${response.status}). Please retry.`);
      return response.json();
    }).catch((error: unknown) => { requests.delete(path); throw error; });
    requests.set(path, request);
  }
  return request as Promise<T>;
}

export async function loadReferenceManifest(): Promise<ReferenceManifest> {
  const manifest = await referenceJson<ReferenceManifest>('/expression/oxt-reference/manifest.json');
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.sources) || !manifest.sources.length ||
      !Array.isArray(manifest.samples) || manifest.samples.length !== manifest.sampleCount ||
      new Set(manifest.samples.map((sample) => sample.id)).size !== manifest.sampleCount ||
      new Set(manifest.sources.map((source) => source.id)).size !== manifest.sources.length) {
    throw new Error('Reference expression sample metadata is inconsistent.');
  }
  for (const source of manifest.sources) {
    const samples = manifest.samples.filter((sample) => sample.sourceId === source.id);
    if (source.collection !== 'reference' || samples.length !== source.sampleCount ||
        new Set(source.conditions.map((group) => group.key)).size !== source.conditions.length ||
        samples.some((sample) => !source.conditions.some((group) => group.key === sample.groupId)) ||
        source.conditions.some((group) => samples.filter((sample) => sample.groupId === group.key).length !== group.sampleCount)) {
      throw new Error('Reference expression cohort metadata is inconsistent.');
    }
  }
  if (manifest.samples.some((sample) => !manifest.sources.some((source) => source.id === sample.sourceId))) {
    throw new Error('Unknown reference expression source.');
  }
  return manifest;
}

export function referenceGeneResult(manifest: ReferenceManifest, sourceId: string, query: string, row: GeneValues): ExpressionGeneResult {
  const source = manifest.sources.find((candidate) => candidate.id === sourceId);
  if (!source || row.values.length !== manifest.sampleCount || row.values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('Reference expression values do not match the sample manifest.');
  }
  return {
    sourceId, query, status: 'available', gene: row.symbol, geneId: row.ensemblId || row.id, unit: source.unit,
    groups: source.conditions.map((condition) => {
      const samples = manifest.samples.flatMap((sample, index) => sample.sourceId === sourceId && sample.groupId === condition.key
        ? [{ id: sample.id, value: row.values[index] }] : []);
      return { key: condition.key, label: condition.label, referenceEligible: condition.referenceEligible,
        samples, mean: samples.length ? samples.reduce((sum, sample) => sum + sample.value, 0) / samples.length : null,
        n: samples.length, totalSamples: samples.length };
    }),
  };
}

export async function loadReferenceExpression(sourceId: string, genes: string[]): Promise<ExpressionGeneResult[]> {
  const manifest = await loadReferenceManifest();
  const source = manifest.sources.find((candidate) => candidate.id === sourceId);
  if (!source) throw new Error('Unknown reference expression source.');
  const index = await referenceJson<{ schemaVersion: number; genes: GeneEntry[] }>(manifest.geneIndexPath);
  if (index.schemaVersion !== 1 || index.genes.length !== manifest.geneCount ||
      new Set(index.genes.map((entry) => entry.id)).size !== manifest.geneCount) {
    throw new Error('Reference expression gene index is inconsistent.');
  }
  return Promise.all(genes.map(async (query) => {
    const matches = resolveNeuroseqGenes(index.genes, query);
    const base = { sourceId, query, unit: source.unit, groups: [] };
    if (!matches.length) return { ...base, status: 'not-retained' as const };
    if (matches.length > 1) return { ...base, status: 'ambiguous' as const, candidates: matches.map((entry) => `${entry.symbol} (${entry.ensemblId || entry.id})`) };
    const entry = matches[0];
    const shard = await referenceJson<{ schemaVersion: number; genes: Record<string, GeneValues> }>(entry.shard);
    const row = shard.genes[entry.id];
    if (shard.schemaVersion !== 1 || !row || row.id !== entry.id || row.symbol !== entry.symbol || row.ensemblId !== entry.ensemblId) {
      throw new Error('Reference expression gene shard is inconsistent.');
    }
    return referenceGeneResult(manifest, sourceId, query, row);
  }));
}

export function resetReferenceRequests(): void { requests.clear(); }
