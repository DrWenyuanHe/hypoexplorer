import { describe, expect, it } from 'vitest';
import { assessReplicationUnits, validateReviewedReplicationMapping, type AnimalPartitionEvidence, type ReviewedReplicationMapping } from '../../scripts/lib/replicationEvidence.mjs';

const samples = [
  { accession: 'GSM1', title: 'Control animal [TRA1]', description: ['Library name: C1'], characteristics: { animal: 'animal1' } },
  { accession: 'GSM2', title: 'Control animal [TRA1] read2', description: ['Library name: C1'], characteristics: { animal: 'animal1' } },
];
const sheet = [{ sample: 'TRA1', group: 'control' }];
const paths = ['original.soft.gz', 'reviewed-mapping.json'];
function fixture(): ReviewedReplicationMapping {
  return { schemaVersion: 1, mappings: [{ sample: 'TRA1', group: 'control', sourceSamples: ['GSM1', 'GSM2'],
    sourceLabels: samples.map(sample => sample.title), unitType: 'animal', unitKey: 'animal1', identityBasis: 'source_identifier',
    sourceUnitIdentifiers: ['animal1'], constituentIdentifiers: [], independenceDeclared: true, sourcePaths: paths }],
  joins: samples.map(sample => ({ sample: 'TRA1', sourceSample: sample.accession, field: 'title', value: sample.title })) };
}
const validate = (document = fixture()) => validateReviewedReplicationMapping(document, samples, sheet, 'animal', paths);

describe('reviewed GEO alias joins', () => {
  it('retains multiple sequencing records as one reviewed biological unit', () => {
    expect(validate()).toHaveLength(1);
    expect(validate()[0].sourceSamples).toEqual(['GSM1', 'GSM2']);
  });
  it('requires the entire observed source field', () => {
    const document = fixture();
    document.joins[0].value = 'TRA1';
    expect(() => validate(document)).toThrow('changed reviewed GEO join');
    document.joins[0] = { ...document.joins[0], field: 'description', value: 'Library name: C1' };
    expect(validate(document)).toHaveLength(1);
    document.joins[0] = { ...document.joins[0], field: 'characteristic:animal', value: 'animal1' };
    expect(validate(document)).toHaveLength(1);
  });
  it('rejects omitted, duplicated and extra joins', () => {
    const document = fixture();
    document.joins.pop();
    expect(() => validate(document)).toThrow('Incomplete reviewed GEO joins');
    document.joins.push(document.joins[0]);
    expect(() => validate(document)).toThrow('changed reviewed GEO join');
    document.joins[1] = { sample: 'extra', sourceSample: 'GSM2', field: 'title', value: samples[1].title };
    expect(() => validate(document)).toThrow('changed reviewed GEO join');
  });
  it('rejects changed local groups, source labels and missing provenance', () => {
    for (const mutate of [
      (document: ReviewedReplicationMapping) => { document.mappings[0].group = 'case'; },
      (document: ReviewedReplicationMapping) => { document.mappings[0].sourceLabels[0] = 'guessed'; },
      (document: ReviewedReplicationMapping) => { document.mappings[0].sourcePaths = []; },
    ]) {
      const document = fixture(); mutate(document);
      expect(() => validate(document)).toThrow();
    }
  });
  it('does not certify independence from a correct library alias', () => {
    const document = fixture(); document.mappings[0].independenceDeclared = false;
    const rows = validate(document);
    expect(assessReplicationUnits(rows, ['TRA1'], [], 'pass', '', []).status).toBe('not_assessed');
  });
  it('detects one source specimen relabeled as different independent units', () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({ ...fixture().mappings[0], sample: `sample${index}`,
      group: index < 3 ? 'control' : 'case', unitKey: `invented-${index}` }));
    expect(assessReplicationUnits(rows, rows.slice(0, 3).map(row => row.sample), rows.slice(3).map(row => row.sample), 'pass', '', []).status).toBe('review');
  });
  it('detects the same author animal identifier across different GSMs and invented unit keys', () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({ ...fixture().mappings[0], sample: `sample${index}`,
      sourceSamples: [`GSM${index}`], group: index < 3 ? 'control' : 'case', unitKey: `invented-${index}` }));
    expect(assessReplicationUnits(rows, rows.slice(0, 3).map(row => row.sample), rows.slice(3).map(row => row.sample), 'pass', '', []).status).toBe('review');
    rows.forEach((row, index) => { row.sourceUnitIdentifiers = ['study cohort', `animal${index}`]; });
    expect(assessReplicationUnits(rows, rows.slice(0, 3).map(row => row.sample), rows.slice(3).map(row => row.sample), 'pass', '', []).status).toBe('pass');
  });
  it('requires complete disjoint animal evidence before accepting a multiplexed GSM', () => {
    const path = 'partitions.json';
    const proof: AnimalPartitionEvidence = { schemaVersion: 1, policyVersion: 'reviewed-disjoint-animal-partitions-v1', sourceSample: 'GSM1',
      allMetadataRows: 12, selectedMetadataRows: 6, allRowsAssignedExactlyOnce: true, selectedRowsAssignedExactlyOnce: true,
      partitions: Array.from({ length: 6 }, (_, index) => ({ sample: `s${index}`, group: index < 3 ? 'control' : 'case', sourceSample: 'GSM1',
        partitionKey: `brain${index}`, sourceUnitIdentifier: `animal${index}`, allRows: 2, selectedRows: 1, allRowIdentifiersSha256: String(index).repeat(64) })) };
    const mapped: ReviewedReplicationMapping = { schemaVersion: 1,
      mappings: proof.partitions.map(part => ({ ...fixture().mappings[0], sample: part.sample, group: part.group,
        sourceSamples: ['GSM1'], sourceLabels: [samples[0].title], unitKey: part.sourceUnitIdentifier,
        sourceUnitIdentifiers: [part.sourceUnitIdentifier], sourcePaths: [path],
        sourcePartition: { sourceSample: 'GSM1', key: part.partitionKey, animalId: part.sourceUnitIdentifier, evidencePath: path, membershipSha256: part.allRowIdentifiersSha256 } })),
      joins: proof.partitions.map(part => ({ sample: part.sample, sourceSample: 'GSM1', field: 'title', value: samples[0].title })) };
    const roster = proof.partitions.map(({ sample, group }) => ({ sample, group }));
    const run = () => validateReviewedReplicationMapping(mapped, samples, roster, 'animal', [path], { path, artifact: proof });
    const assess = () => assessReplicationUnits(run(), roster.slice(0, 3).map(row => row.sample), roster.slice(3).map(row => row.sample), 'pass', '', []);
    expect(assess().status).toBe('pass');
    expect(() => validateReviewedReplicationMapping(mapped, samples, roster, 'animal', [path])).toThrow('Unproven multiplexed');
    mapped.mappings[0].sourcePartition!.key = 'guessed';
    expect(run).toThrow('Unproven multiplexed');
    mapped.mappings[0].sourcePartition!.key = proof.partitions[0].partitionKey;
    proof.partitions[0].allRows = 3;
    expect(run).toThrow('Incomplete disjoint');
    proof.partitions[0].allRows = 2;
    proof.partitions[0].sourceUnitIdentifier = proof.partitions[1].sourceUnitIdentifier;
    expect(run).toThrow('Incomplete disjoint');
  });
});
