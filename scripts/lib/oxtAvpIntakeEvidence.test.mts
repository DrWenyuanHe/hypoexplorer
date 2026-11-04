import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { createOxtAvpIntakeReader, OXT_AVP_AUDIT, OXT_AVP_AUDIT_DEPENDENCIES, OXT_AVP_INTAKE } from './oxtAvpIntakeEvidence.mjs';

test('only a complete current source-bound audit can supply OXT/AVP quality checks', (t) => {
  const base = resolve(process.cwd(), '.tmp'); mkdirSync(base, { recursive: true });
  const root = mkdtempSync(resolve(base, 'oxt-avp-reader-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path: string, value: unknown) => {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), typeof value === 'string' ? value : JSON.stringify(value));
  };
  const manifest = `${OXT_AVP_INTAKE}/studies.json`;
  const directory = 'geo_replication/datasets/GSE65663_rnor_son_salt';
  const track = { id: 'son', analysisId: 'GSE65663', matrix: `${directory}/raw/expression.tsv`, samplesheet: `${directory}/metadata/samplesheet.tsv` };
  put(manifest, [{ id: 'rat_son_salt_gse65663', accession: 'GSE65663', dir: directory, tracks: [track], contrasts: [{ id: 'salt_vs_control' }], designReview: { replicationStatus: 'pass_with_notes',
    biologicalUnit: 'Independent RNA pool', note: 'Pools are independently prepared; animals within a pool are not replicates.', evidencePaths: ['source.txt'] } }]);
  put('source.txt', 'Retained reviewed source bytes\n');
  const read = (path: string) => readFileSync(resolve(root, path));
  const evaluate = () => createOxtAvpIntakeReader(root, read).evaluate('rat_son_salt_gse65663', 'son', 'salt_vs_control')!;
  assert.equal(evaluate().preparation.status, 'not_assessed', 'Missing audit must not inherit a pass');
  const record = { datasetId: 'rat_son_salt_gse65663', track: 'son', contrast: 'salt_vs_control',
    analysisId: 'GSE65663', sourceIntegrity: 'pass', preparedInputTrace: 'pass', expressionTrace: 'pass', deTrace: 'pass', pathwayProvenance: 'pass', modelEffectTrace: 'pass' };
  const dependencies = [...OXT_AVP_AUDIT_DEPENDENCIES, 'source.txt', track.matrix, track.samplesheet,
    `${directory}/metadata/GSE65663_source_files.tsv`, ...['model_input.tsv.gz', 'expression.tsv.gz', 'feature_map.tsv.gz', 'DE.tsv', 'SE.tsv', 'provenance.tsv'].map(suffix => `${directory}/processed/GSE65663_${suffix}`),
    'public/datasets/rat_son_salt_gse65663/track_son.js', 'public/datasets/rat_son_salt_gse65663/track_son.pathways.js'];
  for (const path of dependencies) if (![manifest, 'source.txt'].includes(path)) put(path, 'retained dependency\n');
  const pins = () => Object.fromEntries(dependencies.map(path => [path, createHash('sha256').update(read(path)).digest('hex')]));
  const document = { schemaVersion: 1, fingerprints: pins(), analyses: [record] };
  put(OXT_AVP_AUDIT, document);
  const current = evaluate();
  assert.equal(current.preparation.status, 'pass'); assert.equal(current.replication.status, 'pass');
  assert.equal(current.conservation.status, 'not_applicable');
  assert.match(current.effects.note, /not independently reconstructed/);
  for (const analyses of [[{ ...record, modelEffectTrace: 'not_assessed' }], [record, record], [{ ...record, contrast: 'other' }]]) {
    put(OXT_AVP_AUDIT, { ...document, analyses });
    assert.equal(evaluate().preparation.status, 'not_assessed', 'Incomplete, ambiguous or differently scoped evidence cannot pass');
  }
  const missingProducer = { ...document.fingerprints }; delete missingProducer['scripts/regen-r460/run_oxt_avp_r460.R'];
  put(OXT_AVP_AUDIT, { ...document, fingerprints: missingProducer });
  assert.equal(evaluate().effects.status, 'not_assessed', 'Omitting the producer fingerprint must not hide code drift');
  put(OXT_AVP_AUDIT, document); put('source.txt', 'Changed source bytes\n');
  assert.equal(evaluate().normalization.status, 'not_assessed', 'Edited source invalidates saved normalization evidence');
  put(OXT_AVP_AUDIT, { ...document, fingerprints: {} });
  assert.equal(evaluate().replication.status, 'not_assessed', 'An empty fingerprint inventory cannot pass');
  assert.equal(createOxtAvpIntakeReader(root, read).evaluate('unrelated', 'son', 'salt_vs_control'), null);
});
