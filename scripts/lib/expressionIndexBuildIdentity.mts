import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expressionManifestKey, parsePointer, POINTERS, verifyExpressionManifest } from '../../src/data/dataOriginLayout';
import { EXPRESSION_INDEX_SCHEMA_VERSION, EXPRESSION_INDEX_SHARDS } from '../../src/expression-survey/expressionIndexFormat';

/**
 * Pin the app to a complete immutable expression corpus, independent of pointer
 * caches: the build id the pointer under `publicRoot` names, after checking the
 * index format and that the generation's immutable manifest holds the same payload.
 */
export function readExpressionIndexBuild(publicRoot: string): string {
  const read = (key: string) => readFileSync(join(publicRoot, ...key.split('/')), 'utf8');
  try {
    const pointer = parsePointer('expression', read(POINTERS.expression.key));
    const { schemaVersion, shardCount, sources } = pointer.manifest;
    if (schemaVersion !== EXPRESSION_INDEX_SCHEMA_VERSION || shardCount !== EXPRESSION_INDEX_SHARDS || !Array.isArray(sources) || !sources.length) {
      throw new Error(`${pointer.key} is not a schema ${EXPRESSION_INDEX_SCHEMA_VERSION}, ${EXPRESSION_INDEX_SHARDS}-shard index with sources`);
    }
    verifyExpressionManifest(pointer, read(expressionManifestKey(pointer.buildId)));
    return pointer.buildId;
  } catch (error) {
    throw new Error(`Expression index has no valid build identity (${error instanceof Error ? error.message : String(error)}); run npm run build:expression-index.`);
  }
}
