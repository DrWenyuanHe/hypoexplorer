import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { EffectDefinitionReviews } from '../../src/data/authorConcordance';
import type { AuthorValidationRecord } from '../../src/data/authorValidation';

/** Bind semantic reviews to their original sources and the exact reviewed comparison. */
export function validateConcordanceReviews(root: string, definitions: EffectDefinitionReviews,
  records: AuthorValidationRecord[], readBytes: (path: string) => Buffer = readFileSync): number {
  if (definitions.schemaVersion !== 1 || !Array.isArray(definitions.reviews)) throw new Error('Unsupported definition-review schema');
  const seen = new Set<string>();
  for (const entry of definitions.reviews) {
    const key = `${entry.datasetId}/${entry.dimension}`;
    if (seen.has(key)) throw new Error(`Duplicate definition review: ${key}`);
    seen.add(key);
    const record = records.find(row => row.datasetId === entry.datasetId);
    const review = record?.verification.comparability;
    const comparison = record?.directComparison;
    if (!record || !comparison || !review || comparison.type !== 'direct_author_result'
      || review.target !== 'registered_output' || review.registeredContrastIds.length !== 1
      || review.registeredContrastIds[0] !== entry.contrastId || !['effects', 'cohort'].includes(entry.dimension)
      || entry.status !== 'compatible' || !entry.note.trim()
      || !/^[a-f0-9]{64}$/.test(entry.evidenceFingerprint)
      || comparison.evidenceFingerprint !== entry.evidenceFingerprint
      || comparison.localMethod !== entry.localMethod || comparison.authorMethod !== entry.authorMethod
      || comparison.orientation !== entry.orientation
      || review.dimensions[entry.dimension as 'effects' | 'cohort'].status !== entry.priorReview.status
      || review.dimensions[entry.dimension as 'effects' | 'cohort'].note !== entry.priorReview.note) {
      throw new Error(`Stale or unsupported definition review: ${entry.datasetId}`);
    }
    if (entry.sources.length < 2 || new Set(entry.sources.map(source => source.path)).size !== entry.sources.length) {
      throw new Error(`Incomplete or duplicate source pins: ${entry.datasetId}`);
    }
    for (const source of entry.sources) {
      const path = resolve(root, source.path);
      const within = relative(resolve(root), path);
      if (isAbsolute(source.path) || within === '..' || within.startsWith('../') || within.startsWith('..\\')) {
        throw new Error('Definition-review source escapes repository');
      }
      if (!/^[a-f0-9]{64}$/.test(source.sha256)
        || createHash('sha256').update(readBytes(path)).digest('hex') !== source.sha256) {
        throw new Error(`Changed definition-review source: ${source.path}`);
      }
    }
  }
  return seen.size;
}
