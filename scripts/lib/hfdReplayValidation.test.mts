import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateHfdReplays } from './hfdReplayValidation.mjs';

const json = (path: string): any => JSON.parse(readFileSync(path, 'utf8'));
const studies = json('data/intake/hfd-2026-09-12/studies.json');
const analyses = json('data/intake/hfd-2026-09-12/analyses.json');
const reports = (accession: string): Map<string, any> => new Map((accession === 'GSE104709'
  ? ['104709-independent.json'] : ['107324-source-independent.json', '107324-independent.json'])
  .map(name => [name, json(`data/internal-qc/hfd-intake-2026-09-12/${name}`)]));

test('complete independent source and model replays cover all three registered tracks', () => {
  for (const study of studies) validateHfdReplays(study, analyses, reports(study.accession));
});
test('source-only mouse replay cannot support a model-QC pass', () => {
  const study = studies.find((s: any) => s.accession === 'GSE104709'), replay = reports(study.accession);
  replay.get('104709-independent.json').pipelineCompared = false;
  assert.throws(() => validateHfdReplays(study, analyses, replay), /did not compare pipeline/);
});
test('missing sex, incomplete statistics and missing dependencies are refused', () => {
  const study = studies.find((s: any) => s.accession === 'GSE107324');
  const missingTrack = reports(study.accession);
  missingTrack.get('107324-independent.json').tracks.pop();
  assert.throws(() => validateHfdReplays(study, analyses, missingTrack), /track coverage/);
  const stats = reports(study.accession);
  delete stats.get('107324-independent.json').tracks[0].maxDEDifferences.padj;
  assert.throws(() => validateHfdReplays(study, analyses, stats), /statistics incomplete/);
  const dependency = reports(study.accession);
  dependency.get('107324-independent.json').tracks[0].dependencies.pop();
  assert.throws(() => validateHfdReplays(study, analyses, dependency), /dependency missing/);
});
