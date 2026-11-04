import { fnv1a } from '../data/queryWire';
import type { ExpressionSource } from './expressionTypes';

/** Independent from the rounded, default-track-only cross-dataset expression index. */
export const EXPRESSION_INDEX_SCHEMA_VERSION = 1;
export const EXPRESSION_INDEX_SHARDS = 512;
export const EXPRESSION_INDEX_POINTER_GLOBAL = 'HX_EXPRESSION_MANIFEST';

export interface ExpressionIndexGroup {
  key: string;
  label: string;
  referenceEligible: boolean;
  sampleIds: string[];
}

export interface ExpressionIndexSource {
  id: string;
  datasetId: string;
  trackId: string;
  unit: string;
  source: ExpressionSource;
  groups: ExpressionIndexGroup[];
  featureCount: number;
}

export interface ExpressionIndexTotals {
  sourceCount: number;
  trackCount: number;
  queryKeyCount: number;
  featureRows: number;
  sampleSlots: number;
  finiteValues: number;
  missingValues: number;
  ambiguousSourceKeys: number;
}

export interface ExpressionIndexManifest {
  schemaVersion: typeof EXPRESSION_INDEX_SCHEMA_VERSION;
  buildId: string;
  shardCount: typeof EXPRESSION_INDEX_SHARDS;
  sources: ExpressionIndexSource[];
  totals: ExpressionIndexTotals;
}

/** Values flatten groups in manifest order, then each group's sampleIds order. */
export type ExpressionIndexRow = [sourceIndex: number, feature: string, values: Array<number | null>];

export interface ExpressionIndexShard {
  schemaVersion: typeof EXPRESSION_INDEX_SCHEMA_VERSION;
  buildId: string;
  bucket: number;
  genes: Record<string, ExpressionIndexRow[]>;
}

/** Matches the full-track adapter: only explicit Ensembl version suffixes fold. */
export function expressionIndexKey(value: string): string {
  const key = value.trim().toUpperCase();
  return /^ENS[A-Z]*G\d+(?:\.\d+)?$/.test(key) ? key.replace(/\.\d+$/, '') : key;
}

/** Accepts a normalized key; normalization is explicit at query/index boundaries. */
export function expressionIndexBucket(key: string): number {
  return fnv1a(key) % EXPRESSION_INDEX_SHARDS;
}

export function expressionIndexShardFile(bucket: number): string {
  return `shards/e${String(bucket).padStart(3, '0')}.js`;
}

/** The build ID is in both the URL and global, so old eager globals cannot win. */
export function expressionIndexGlobal(buildId: string, part: 'manifest' | number): string {
  const suffix = part === 'manifest' ? 'MANIFEST' : `E${String(part).padStart(3, '0')}`;
  return `HX_EXPRESSION_${buildId}_${suffix}`;
}
