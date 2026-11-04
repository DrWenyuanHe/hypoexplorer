import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {test} from 'node:test';
import {readScopedAuthorEvidence, SCOPED_AUTHOR_PATH} from './scopedAuthorEvidence.mjs';

const root = process.cwd();
const cache = new Map<string, Buffer>();
const read = (path: string) => {
  if (!cache.has(path)) cache.set(path, readFileSync(path));
  return cache.get(path)!;
};
test('loads four independently pinned complete comparisons', () => {
  const result = readScopedAuthorEvidence(root, read);
  assert.equal(result.size, 1);
  assert.equal(result.get('gse148252')!.length, 4);
});
test('rejects each missing or changed original dependency and measurement', () => {
  const doc = JSON.parse(read(resolve(root, SCOPED_AUTHOR_PATH)).toString('utf8'));
  for (const ref of [...doc.dependencyClosure, ...doc.measurementReferences]) {
    const target = resolve(root, ref.path);
    assert.throws(() => readScopedAuthorEvidence(root, path => {
      if (path === target) throw Error('Missing source');
      return read(path);
    }), undefined, ref.path);
    assert.throws(() => readScopedAuthorEvidence(root, path => path === target
      ? Buffer.concat([read(path), Buffer.from('changed')]) : read(path)), undefined, ref.path);
  }
});
test('rejects a forged result and every borrowed registry context', () => {
  assert.throws(() => readScopedAuthorEvidence(root, path => path === resolve(root, SCOPED_AUTHOR_PATH)
    ? Buffer.from(read(path).toString('utf8').replace('gse148252', 'gse262407')) : read(path)), /seal differs/);
  const target = resolve(root, 'data/intake/september5-2026/analyses.json');
  for (const field of ['track', 'contrast', 'analysisId', 'deSha256']) {
    assert.throws(() => readScopedAuthorEvidence(root, path => {
      if (path !== target) return read(path);
      const analyses = JSON.parse(read(path).toString('utf8'));
      analyses.find((row: {studyId: string}) => row.studyId === 'gse148252')[field] = 'borrowed';
      return Buffer.from(JSON.stringify(analyses));
    }));
  }
});
test('rejects reversed groups, borrowed track inputs and changed registered source matrices', () => {
  const target = resolve(root, 'data/intake/september5-2026/studies.json');
  for (const mutation of ['arms', 'matrix', 'samplesheet', 'organism']) {
    assert.throws(() => readScopedAuthorEvidence(root, path => {
      if (path !== target) return read(path);
      const studies = JSON.parse(read(path).toString('utf8'));
      const study = studies.find((row: {id: string}) => row.id === 'gse148252');
      if (mutation === 'arms') [study.contrasts[0].baseline, study.contrasts[0].case] = [study.contrasts[0].case, study.contrasts[0].baseline];
      if (mutation === 'matrix' || mutation === 'samplesheet') study.tracks[0][mutation] = 'borrowed.tsv';
      if (mutation === 'organism') study.organism = 'Rattus norvegicus';
      return Buffer.from(JSON.stringify(studies));
    }), /scope changed/);
  }
  const matrix = resolve(root, 'geo_replication/datasets/GSE148252_discovery_20260905/processed/GSE148252_source_counts.tsv.gz');
  assert.throws(() => readScopedAuthorEvidence(root, path => path === matrix
    ? Buffer.concat([read(path), Buffer.from('changed')]) : read(path)), /source matrix differs/);
});
