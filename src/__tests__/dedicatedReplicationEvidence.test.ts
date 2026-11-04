import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { projectSuperseded } from './supersededProjection';
import { assessReplicationUnits, replicationDecision, validateDedicatedReplicationBinding, type BiologicalUnitMapping, type DedicatedReplicationBinding } from '../../scripts/lib/replicationEvidence.mjs';

const read = (path: string): Buffer => readFileSync(path);
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const evidencePath = 'data/internal-qc/advancement-2026-09-05/dedicated-evidence.json';
const records = JSON.parse(read(evidencePath).toString('utf8')).records;
function binding(record: any): DedicatedReplicationBinding {
  return { evidencePath, recordSha256: sha(JSON.stringify(record)),
    replay: { path: record.replayFile, sha256: record.replaySha256, bytes: read(record.replayFile).length },
    pins: Object.entries(record.fingerprints).map(([path, hash]) => ({ path, sha256: hash as string, bytes: read(path).length })) };
}
const pomc = records.find((row: any) => row.configId === 'GSE135639');
const validate = (proof = binding(pomc), reader = read) => validateDedicatedReplicationBinding(proof, pomc.datasetId, pomc.configId, pomc.sheet, Object.keys(pomc.contrasts), reader);

describe('dedicated analysis replication bindings', () => {
  // This dated September 5 evidence pins bytes the R 4.6.0 regeneration replaced. Its reads of those
  // paths receive the verified pre-regeneration bytes through the supersession projection
  // (data/quality/regeneration-r460-2026-09-25/README.md); every other read is current.
  let restore: () => void = () => {};
  beforeAll(async () => { restore = await projectSuperseded(); });
  afterAll(() => restore());

  it('checks both actual dedicated analyses and all five contrast table bindings', () => {
    expect(records).toHaveLength(2);
    expect(records.reduce((sum: number, row: any) => sum + Object.keys(row.contrasts).length, 0)).toBe(5);
    for (const record of records) {
      expect(validateDedicatedReplicationBinding(binding(record), record.datasetId, record.configId, record.sheet, Object.keys(record.contrasts), read)).toHaveLength(Object.keys(record.fingerprints).length + 1);
    }
  });

  it.each(['script', 'input', 'sheet', 'output', 'replay'])('rejects changed dedicated %s bytes', kind => {
    const proof = binding(pomc);
    const path = kind === 'replay' ? proof.replay.path : proof.pins.find(pin => kind === 'script' ? pin.path.startsWith('scripts/de_')
      : kind === 'input' ? pin.path.includes('/raw/') : kind === 'sheet' ? pin.path === pomc.sheet : pin.path.includes('/processed/'))!.path;
    expect(() => validate(proof, item => item === path ? Buffer.from('changed scientific evidence') : read(item))).toThrow(/Dedicated evidence changed/);
  });

  it('rejects omitted or duplicated file pins and another dataset record', () => {
    const proof = binding(pomc);
    expect(() => validate({ ...proof, pins: proof.pins.slice(1) })).toThrow();
    expect(() => validate({ ...proof, pins: [...proof.pins, proof.pins[0]] })).toThrow();
    expect(() => validate(binding(records.find((row: any) => row.configId === 'GSE157077')))).toThrow();
  });

  it('rejects changed analysis metadata, table binding and unreviewed contrasts', () => {
    const changed = structuredClone(JSON.parse(read(evidencePath).toString('utf8')));
    changed.records.find((row: any) => row.configId === 'GSE135639').designNote = 'Different model';
    expect(() => validate(undefined, path => path === evidencePath ? Buffer.from(JSON.stringify(changed)) : read(path))).toThrow(/record changed/);
    const mechanicalPath = 'data/author-validation/mechanical-audit.generated.json';
    const mechanical = JSON.parse(read(mechanicalPath).toString('utf8'));
    mechanical.datasets.find((row: any) => row.datasetId === pomc.datasetId).contrasts[0].table = 'different_DE.tsv';
    expect(() => validate(undefined, path => path === mechanicalPath ? Buffer.from(JSON.stringify(mechanical)) : read(path))).toThrow(/bindings/);
    expect(() => validateDedicatedReplicationBinding(binding(pomc), pomc.datasetId, pomc.configId, pomc.sheet, ['unknown'], read)).toThrow(/contrast binding/);
  });
});

describe('contrast-specific biological replication decisions', () => {
  const spec = { contrasts: ['diet', 'age'], proposedStatus: 'review' as const, note: 'Dataset-level context.',
    contrastDecisions: { diet: { status: 'review' as const, note: 'Maternal litter assignment is missing.' }, age: { status: 'not_assessed' as const, note: 'Age-cohort independence is unresolved.' } } };
  it('keeps each finding and does not inherit the first contrast decision', () => {
    expect(replicationDecision(spec, 'diet')).toEqual(spec.contrastDecisions.diet);
    expect(replicationDecision(spec, 'age')).toEqual(spec.contrastDecisions.age);
    expect(() => replicationDecision({ ...spec, contrastDecisions: { diet: spec.contrastDecisions.diet } }, 'age')).toThrow();
    expect(() => replicationDecision(spec, 'unreviewed')).toThrow();
  });

  it('assesses explicit age subsets even when both use the original control sheet label', () => {
    const make = (sample: string): BiologicalUnitMapping => ({ sample, group: 'control', sourceSamples: [`GSM-${sample}`], sourceLabels: [sample], unitType: 'animal', unitKey: sample,
      identityBasis: 'source_identifier', sourceUnitIdentifiers: [sample], constituentIdentifiers: [], independenceDeclared: true, sourcePaths: ['original-methods.xml'] });
    const before = ['young1', 'young2', 'young3'];
    const after = ['old1', 'old2', 'old3'];
    const mappings = [...before, ...after].map(make);
    expect(assessReplicationUnits(mappings, before, after, 'pass', 'Separate terminal animals.', []).status).toBe('pass');
    mappings[3].unitKey = mappings[0].unitKey;
    expect(assessReplicationUnits(mappings, before, after, 'pass', 'Separate terminal animals.', []).status).toBe('review');
  });
});
