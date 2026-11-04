import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expressionIndexGlobal } from '../../src/expression-survey/expressionIndexFormat';

/** Pin the app to a complete immutable expression corpus, independent of pointer caches. */
export function readExpressionIndexBuild(pointerPath: string): string {
  const read = (path: string, global: string) => {
    const source = readFileSync(path, 'utf8');
    const match = source.match(new RegExp(`^(?:\\s|//[^\\n]*\\n)*var ${global}\\s*=\\s*(\\{[\\s\\S]*\\})\\s*;\\s*$`));
    if (!match) throw new Error('Expression index has an invalid data wrapper; run npm run build:expression-index.');
    return JSON.parse(match[1]);
  };
  const manifest = read(pointerPath, 'HX_EXPRESSION_MANIFEST');
  if (manifest.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(manifest.buildId) ||
      manifest.shardCount !== 512 || !Array.isArray(manifest.sources) || !manifest.sources.length) {
    throw new Error('Expression index has no valid build identity; run npm run build:expression-index.');
  }
  const immutable = read(join(dirname(pointerPath), 'expression', manifest.buildId, 'manifest.js'),
    expressionIndexGlobal(manifest.buildId, 'manifest'));
  if (JSON.stringify(immutable) !== JSON.stringify(manifest)) {
    throw new Error('Expression index pointer does not match its immutable manifest.');
  }
  return manifest.buildId;
}
