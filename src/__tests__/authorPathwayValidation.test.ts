import { describe, expect, it } from 'vitest';
import { pathwayValidationByDataset } from '../../scripts/lib/authorPathwayValidation.mjs';
import type { CurrentIntakePathwayRecord } from '../../scripts/lib/authorPathwayValidation.mjs';

const registry = [
  { id: 'mouse', geo: 'GSE1', contrasts: [{}] },
  { id: 'macaque_snrna', geo: 'CNGB1', contrasts: [{}] },
];
const migration = () => ({
  schemaVersion: 1,
  baselineCommit: 'a'.repeat(40),
  datasets: [{
    datasetId: 'mouse', accession: 'GSE1', contrastCount: 1,
    status: 'rebuilt_validated',
    baselineKind: 'git_commit', baselineNote: 'Committed pre-audit result files.',
    totals: {
      previousRows: 12, currentRows: 15, addedRows: 5, removedRows: 2, sharedRows: 10,
      nonFiniteRowsBefore: 2, nonFiniteRowsAfter: 1,
      nesDirectionChanges: 1, fdrCallsBefore: 3, fdrCallsAfter: 5,
      fdrCallsGained: 3, fdrCallsLost: 1,
    },
    provenanceFiles: ['geo_replication/datasets/GSE1/processed/GSE1_FGSEA_provenance.tsv'],
  }],
});
const validate = (input: unknown) => pathwayValidationByDataset(input, registry, 'macaque_snrna');
const currentRegistry = [...registry, { id: 'rat_son_salt_gse65663', geo: 'GSE65663', contrasts: [{ id: 'salt_vs_control' }] }];
const current = (): CurrentIntakePathwayRecord => ({
  datasetId: 'rat_son_salt_gse65663', accession: 'GSE65663', state: 'current_provenance_checked',
  provenanceSchemaVersion: 3, contrastCount: 1, currentRows: 100, nonFiniteRows: 2,
  provenanceFiles: ['geo_replication/datasets/GSE65663_rnor_son_salt/processed/GSE65663_FGSEA_provenance.tsv'],
  evidencePath: 'data/intake/oxt-avp-2026-10-19/audit.generated.json', note: 'Current output trace; no migration baseline.',
});

describe('FGSEA migration evidence join', () => {
  it('joins every in-scope dataset without turning pathway evidence into an author-result status', () => {
    const evidence = migration();
    expect([...validate(evidence)]).toEqual([['mouse', {
      state: 'rebuilt_provenance_checked', provenanceSchemaVersion: 3,
      baselineKind: 'git_commit', baselineNote: evidence.datasets[0].baselineNote,
      baselineCommit: evidence.baselineCommit,
      contrastCount: 1, totals: evidence.datasets[0].totals,
      provenanceFiles: evidence.datasets[0].provenanceFiles,
    }]]);
  });

  it('rejects unsupported, missing, duplicate, unknown, and excluded coverage', () => {
    expect(() => validate({ ...migration(), schemaVersion: 2 })).toThrow(/unsupported schema/);
    expect(() => validate({ ...migration(), datasets: [] })).toThrow(/missing 1 dataset/);
    const record = migration().datasets[0];
    expect(() => validate({ ...migration(), datasets: [record, record] })).toThrow(/duplicate/);
    for (const datasetId of ['unknown', 'macaque_snrna']) {
      expect(() => validate({ ...migration(), datasets: [{ ...record, datasetId }] }))
        .toThrow(/unknown or excluded/);
    }
  });

  it('requires the registered accession and complete contrast count', () => {
    const evidence = migration();
    evidence.datasets[0].accession = 'GSE2';
    expect(() => validate(evidence)).toThrow(/accession or contrast count/);
    evidence.datasets[0].accession = 'GSE1';
    evidence.datasets[0].contrastCount = 2;
    expect(() => validate(evidence)).toThrow(/accession or contrast count/);
  });

  it('requires completed migration status and a pinned pre-audit baseline', () => {
    expect(() => validate({ ...migration(), baselineCommit: 'HEAD' })).toThrow(/baseline commit/);
    const evidence = migration();
    evidence.datasets[0].status = 'in_progress';
    expect(() => validate(evidence)).toThrow(/has not been rebuilt and validated/);
  });

  it('preserves a disclosed local-snapshot exception without assigning it Git provenance', () => {
    const evidence = migration();
    evidence.datasets[0].baselineKind = 'local_snapshot';
    evidence.datasets[0].baselineNote = 'Hash-pinned Aug 31 files; no committed baseline exists.';
    expect(validate(evidence).get('mouse')).toEqual(expect.objectContaining({
      baselineKind: 'local_snapshot', baselineCommit: null,
      baselineNote: evidence.datasets[0].baselineNote,
    }));
    evidence.datasets[0].baselineNote = '';
    expect(() => validate(evidence)).toThrow(/baseline kind or exception note/);
    evidence.datasets[0].baselineKind = 'unknown';
    expect(() => validate(evidence)).toThrow(/baseline kind or exception note/);
    const record = migration().datasets[0];
    expect(() => validate({ ...migration(), datasets: [{ ...record, baselineKind: ['git_commit'] }] }))
      .toThrow(/baseline kind or exception note/);
  });

  it('rejects malformed totals and inconsistent row/call accounting', () => {
    for (const patch of [
      { addedRows: -1 }, { addedRows: 1.5 }, { addedRows: undefined },
      { nonFiniteRowsBefore: -1 }, { nonFiniteRowsAfter: 1.5 }, { nonFiniteRowsAfter: undefined },
    ]) {
      const evidence = migration();
      Object.assign(evidence.datasets[0].totals, patch);
      expect(() => validate(evidence)).toThrow(/nonnegative integers/);
    }
    for (const patch of [
      { previousRows: 13 }, { currentRows: 16 }, { nesDirectionChanges: 11 },
      { nonFiniteRowsBefore: 13 }, { nonFiniteRowsAfter: 16 },
      { fdrCallsBefore: 13 }, { fdrCallsAfter: 16 },
      { fdrCallsGained: 6 }, { fdrCallsLost: 4 }, { fdrCallsGained: 2 },
    ]) {
      const evidence = migration();
      Object.assign(evidence.datasets[0].totals, patch);
      expect(() => validate(evidence)).toThrow(/inconsistent/);
    }
  });

  it('requires one valid unique provenance-file reference per registered contrast', () => {
    for (const provenanceFiles of [
      [], [''], ['same.tsv'], ['geo_replication/../GSE1_FGSEA_provenance.tsv'],
      [migration().datasets[0].provenanceFiles[0], migration().datasets[0].provenanceFiles[0]],
    ]) {
      const evidence = migration();
      evidence.datasets[0].provenanceFiles = provenanceFiles;
      expect(() => validate(evidence)).toThrow(/provenance files/);
    }
    const evidence = migration();
    evidence.datasets[0].contrastCount = 2;
    evidence.datasets[0].provenanceFiles.push(evidence.datasets[0].provenanceFiles[0]);
    expect(() => pathwayValidationByDataset(evidence, [
      { ...registry[0], contrasts: [{}, {}] }, registry[1],
    ], 'macaque_snrna')).toThrow(/provenance files/);
  });

  it('joins source-bound current intake evidence while retaining historical evidence unchanged', () => {
    const evidence = current();
    const result = pathwayValidationByDataset(migration(), currentRegistry, 'macaque_snrna', [evidence]);
    expect(result.get('mouse')).toEqual(validate(migration()).get('mouse'));
    expect(result.get(evidence.datasetId)).toEqual({
      state: 'current_provenance_checked', provenanceSchemaVersion: 3, contrastCount: 1,
      currentRows: 100, nonFiniteRows: 2, provenanceFiles: evidence.provenanceFiles,
      evidencePath: evidence.evidencePath, note: evidence.note,
    });
    expect(result.get(evidence.datasetId)).not.toHaveProperty('totals');
    expect(result.get(evidence.datasetId)).not.toHaveProperty('baselineKind');
  });

  it('requires complete current coverage, a bounded source identity, and no overlapping migration claim', () => {
    expect(() => pathwayValidationByDataset(migration(), currentRegistry, 'macaque_snrna')).toThrow(/missing 1 dataset/);
    const record = current();
    expect(() => pathwayValidationByDataset(migration(), currentRegistry, 'macaque_snrna', [record, record])).toThrow(/duplicate current/);
    for (const patch of [{ datasetId: 'mouse' }, { accession: 'GSE30733' }, { datasetId: 'macaque_snrna' }]) {
      expect(() => pathwayValidationByDataset(migration(), currentRegistry, 'macaque_snrna', [{ ...record, ...patch }])).toThrow(/source identities/);
    }
    const overlap = { ...migration().datasets[0], datasetId: record.datasetId, accession: record.accession };
    expect(() => pathwayValidationByDataset({ ...migration(), datasets: [...migration().datasets, overlap] }, currentRegistry, 'macaque_snrna', [record]))
      .toThrow(/overlapping/);
  });

  it('rejects fabricated baselines, invalid current totals, and provenance from another source', () => {
    for (const patch of [
      { totals: migration().datasets[0].totals }, { baselineCommit: 'a'.repeat(40) }, { baselineKind: 'git_commit' },
      { state: 'rebuilt_provenance_checked' }, { currentRows: -1 }, { currentRows: 1.5 }, { nonFiniteRows: 101 },
      { contrastCount: 2 }, { provenanceSchemaVersion: 2 }, { evidencePath: 'stale.json' }, { note: '' },
    ]) {
      expect(() => pathwayValidationByDataset(migration(), currentRegistry, 'macaque_snrna', [{ ...current(), ...patch } as CurrentIntakePathwayRecord]))
        .toThrow(/invalid current|fabricated migration/);
    }
    for (const provenanceFiles of [[], ['geo_replication/datasets/GSE1/processed/GSE1_FGSEA_provenance.tsv'],
      ['geo_replication/datasets/GSE65663_rnor_son_salt/processed/../GSE65663_FGSEA_provenance.tsv']]) {
      expect(() => pathwayValidationByDataset(migration(), currentRegistry, 'macaque_snrna', [{ ...current(), provenanceFiles }]))
        .toThrow(/provenance files/);
    }
  });
});
