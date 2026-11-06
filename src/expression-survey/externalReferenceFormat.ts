// On-disk format shared by the external reference builders (scripts/) and the
// browser reader. DOM-free: the Node builders import it.
//
// One provider (GTEx, HPA, Allen) writes one directory: a manifest, key-sharded lookup
// files, feature-sharded value files and a validation report. A query reads the
// manifest once, then one lookup shard and one value shard per gene, so no
// client ever downloads a whole gene index.
import { fnv1a } from '../data/queryWire';
import type { ExpressionSource } from './expressionTypes';

export const EXTERNAL_REFERENCE_SCHEMA_VERSION = 1;
export const EXTERNAL_LOOKUP_SHARDS = 1024;

export type ExternalProvider = 'gtex' | 'hpa' | 'allen';
export const EXTERNAL_PROVIDERS: readonly ExternalProvider[] = ['gtex', 'hpa', 'allen'];
export const EXTERNAL_REFERENCE_ROOTS: Record<ExternalProvider, string> = {
  gtex: '/expression/gtex',
  hpa: '/expression/hpa',
  allen: '/expression/allen-human',
};

/** One stored value slot: a sample, or a summary column when `sample` is null. */
export interface ExternalColumn {
  group: string;
  sample: string | null;
}

export interface ExternalSample {
  id: string;
  label: string;
  sourceId: string;
  groupId: string;
  /** Source-reported fields (sex, age band, Hardy scale, animal label), as text. */
  metadata: Record<string, string>;
}

export interface ExternalReferenceManifest {
  schemaVersion: typeof EXTERNAL_REFERENCE_SCHEMA_VERSION;
  provider: ExternalProvider;
  title: string;
  release: string;
  sources: ExpressionSource[];
  /** Column order of every value vector, per source. */
  columns: Record<string, ExternalColumn[]>;
  samples: ExternalSample[];
  featureCounts: Record<string, number>;
  lookupShardCount: typeof EXTERNAL_LOOKUP_SHARDS;
  valueShardCount: number;
  validationPath: string;
  notes: string[];
}

export interface ExternalLookupEntry {
  source: string;
  /** Stable source feature ID, e.g. a versioned GENCODE ID. */
  id: string;
  symbol: string;
  /** Unversioned Ensembl gene ID when the source has one; otherwise ''. */
  ensemblId: string;
}

/** On disk: [index into manifest.sources, id, symbol, ensemblId]. */
export type ExternalLookupRow = [source: number, id: string, symbol: string, ensemblId: string];

export interface ExternalLookupShard {
  schemaVersion: typeof EXTERNAL_REFERENCE_SCHEMA_VERSION;
  provider: ExternalProvider;
  bucket: number;
  keys: Record<string, ExternalLookupRow[]>;
}

export interface ExternalValueShard {
  schemaVersion: typeof EXTERNAL_REFERENCE_SCHEMA_VERSION;
  provider: ExternalProvider;
  bucket: number;
  /** source id -> feature id -> values in that source's column order. */
  rows: Record<string, Record<string, Array<number | null>>>;
}

export interface ExternalValidationCheckpoint {
  source: string;
  feature: string;
  symbol: string;
  column: string;
  /** The value's text in the retained source file. */
  sourceText: string;
  value: number;
}

export interface ExternalValidation {
  schemaVersion: typeof EXTERNAL_REFERENCE_SCHEMA_VERSION;
  status: 'verified';
  provider: ExternalProvider;
  release: string;
  comparedValues: number;
  exactMatches: number;
  maxAbsoluteDifference: number;
  numericalPolicy: string;
  inputs: Array<{ name: string; url: string; bytes: number; sha256: string }>;
  sources: Array<{ id: string; features: number; columns: number }>;
  checkpoints: ExternalValidationCheckpoint[];
  notes: string[];
}

/** Uppercase; only an explicit Ensembl version suffix folds (as the existing index). */
export function externalKey(value: string): string {
  const key = value.trim().toUpperCase();
  return /^ENS[A-Z]*G\d+(?:\.\d+)?$/.test(key) ? key.replace(/\.\d+$/, '') : key;
}

export function externalLookupBucket(key: string): number {
  return fnv1a(key) % EXTERNAL_LOOKUP_SHARDS;
}

/** Value shards are keyed by feature ID alone, so one gene's sources share a file. */
export function externalValueBucket(featureId: string, shardCount: number): number {
  return fnv1a(featureId) % shardCount;
}

export function externalLookupFile(bucket: number): string {
  return `lookup/l${String(bucket).padStart(4, '0')}.json`;
}

export function externalValueFile(bucket: number): string {
  return `values/v${String(bucket).padStart(4, '0')}.json`;
}

/**
 * Every lookup key a feature answers to: its symbol, ID and unversioned Ensembl ID.
 *
 * @public Used by the atlas builder in scripts/lib/externalReference.mts.
 */
export function externalFeatureKeys(entry: Pick<ExternalLookupEntry, 'id' | 'symbol' | 'ensemblId'>): string[] {
  return [...new Set([entry.symbol, entry.id, entry.ensemblId].filter(Boolean).map(externalKey))];
}
