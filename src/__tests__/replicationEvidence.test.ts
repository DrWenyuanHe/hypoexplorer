import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { projectSuperseded } from './supersededProjection';
import { assessReplicationUnits, reviewedReplicationCheck, type BiologicalUnitMapping } from '../../scripts/lib/replicationEvidence.mjs';

function mapping(sample: string, group: string, unitKey = sample, members: string[] = []): BiologicalUnitMapping {
  return { sample, group, sourceSamples: [`GSM-${sample}`], sourceLabels: [sample], unitKey,
    unitType: 'pool', identityBasis: 'source_identifier', sourceUnitIdentifiers: [unitKey],
    constituentIdentifiers: members, independenceDeclared: true, sourcePaths: ['reviewed-primary-source.xlsx'] };
}
const baseline = ['c1', 'c2', 'c3'];
const cases = ['t1', 't2', 't3'];
const independent = () => [...baseline.map(sample => mapping(sample, 'control')), ...cases.map(sample => mapping(sample, 'case'))];
const assess = (rows: BiologicalUnitMapping[]) => assessReplicationUnits(rows, baseline, cases, 'pass', 'Reviewed pool identities.', []);

describe('primary-source biological replication evidence', () => {
  // This dated September 5 evidence pins bytes the R 4.6.0 regeneration replaced. Its reads of those
  // paths receive the verified pre-regeneration bytes through the supersession projection
  // (data/quality/regeneration-r460-2026-09-25/README.md); every other read is current.
  let restore: () => void = () => {};
  beforeAll(async () => { restore = await projectSuperseded(); });
  afterAll(() => restore());

  it('counts independent pools once instead of counting constituent animals as replicates', () => {
    const rows = independent().map(row => ({ ...row, constituentIdentifiers: [`${row.sample}-bird1`, `${row.sample}-bird2`] }));
    expect(assess(rows)).toMatchObject({ status: 'pass' });
    expect(assess(rows).note).toContain('3 baseline and 3 case pool units');
    const twoPerArm = rows.filter(row => !['c3', 't3'].includes(row.sample));
    expect(assessReplicationUnits(twoPerArm, ['c1', 'c2'], ['t1', 't2'], 'pass', '', []).status).toBe('review');
  });

  it('does not treat unique GEO/library identifiers as biological independence', () => {
    expect(assess(independent().map(row => ({ ...row, independenceDeclared: false }))).status).toBe('not_assessed');
    expect(assess(independent().map(row => ({ ...row, identityBasis: 'unresolved' }))).status).toBe('not_assessed');
    expect(assess(independent().map(row => ({ ...row, unitType: 'unresolved' }))).status).toBe('not_assessed');
  });

  it('retains review when different named pools reuse a constituent animal', () => {
    const rows = independent();
    rows[0].constituentIdentifiers = ['bird-1', 'bird-2'];
    rows[3].constituentIdentifiers = ['bird-2', 'bird-3'];
    expect(assess(rows)).toMatchObject({ status: 'review' });
    expect(assess(rows).note).toContain('constituents recur');
  });

  it('requires paired-model review for the same litter represented in both arms', () => {
    const rows = independent();
    rows[0] = { ...rows[0], unitType: 'litter', unitKey: 'litter-1' };
    rows[3] = { ...rows[3], unitType: 'litter', unitKey: 'litter-1' };
    expect(assess(rows).status).toBe('review');
  });

  it('rejects incomplete or duplicated current sample mappings', () => {
    expect(assess(independent().slice(1)).status).toBe('not_assessed');
    expect(assess([...independent(), independent()[0]]).status).toBe('not_assessed');
    expect(assessReplicationUnits(independent(), ['unsupported'], cases, 'pass', '', []).status).toBe('not_assessed');
  });

  it('preserves measured source-review blockers even when labels appear unique', () => {
    expect(assessReplicationUnits(independent(), baseline, cases, 'review', 'Shared litter mapping is missing.', []).status).toBe('review');
  });

  it('retains actual bird membership and litter aggregation in the integrated evidence proposal', () => {
    const artifact = JSON.parse(readFileSync('data/internal-qc/replication-2026-09-05/replication-evidence.json', 'utf8')) as {
      records: { datasetId: string; mappings: BiologicalUnitMapping[];
        contrasts: Record<string, { check: { status: string; note: string } }> }[];
    };
    const chicken = artifact.records.find(row => row.datasetId === 'chicken_hypo_rfi_gse278826')!;
    expect(chicken.mappings).toHaveLength(10);
    expect(new Set(chicken.mappings.flatMap(row => row.constituentIdentifiers)).size).toBe(20);
    expect(chicken.mappings.find(row => row.unitKey === 'LRFI_Pool1')?.constituentIdentifiers).toEqual(['LRFI-01', 'LRFI-02']);
    expect(Object.values(chicken.contrasts)[0].check.note).toContain('5 baseline and 5 case pool units');
    const benzene = artifact.records.find(row => row.datasetId === 'mouse_hypo_prenatal_benzene_gse229440')!;
    expect(benzene.mappings).toHaveLength(6);
    expect(new Set(benzene.mappings.map(row => row.unitKey)).size).toBe(6);
    expect(Object.values(benzene.contrasts)[0].check.note).toContain('3 baseline and 3 case litter units');
    for (const datasetId of ['pig_hypo_genotype_gse201408', 'pig_hypo_mia_gse245146', 'cattle_hypo_diet_restriction_gse49540', 'human_hypo_pituitary_organoid_gse301692']) {
      const row = artifact.records.find(record => record.datasetId === datasetId)!;
      expect(Object.values(row.contrasts)[0].check.status, datasetId).toBe('review');
    }
  });

  it('validates current provenance before returning a reviewed pass or review blocker', () => {
    const artifact = JSON.parse(readFileSync('data/internal-qc/replication-2026-09-05/replication-evidence.json', 'utf8')) as {
      records: { datasetId: string; config?: Record<string, string>; proposedStatus: string;
        contrasts: Record<string, { baseline: string[]; cases: string[]; check: { status: string } }> }[];
    };
    for (const row of artifact.records) {
      // Each check re-verifies every pinned source from disk, and a record's
      // contrasts share those sources: reading each file once per record hands
      // every check the same bytes as before, without re-reading gigabytes.
      const bytesByPath = new Map<string, Buffer>();
      const read = (path: string): Buffer => {
        const cached = bytesByPath.get(path);
        if (cached) return cached;
        const bytes = readFileSync(path);
        bytesByPath.set(path, bytes);
        return bytes;
      };
      for (const [contrastId, contrast] of Object.entries(row.contrasts)) {
        expect(reviewedReplicationCheck(process.cwd(), row.datasetId, contrastId, row.config, contrast.baseline, contrast.cases, read)?.status, `${row.datasetId}/${contrastId}`).toBe(contrast.check.status);
        expect(reviewedReplicationCheck(process.cwd(), row.datasetId, contrastId, { ...row.config, batch_var: 'unreviewed_litter' }, contrast.baseline, contrast.cases, read)?.status).toBe('not_assessed');
        expect(reviewedReplicationCheck(process.cwd(), row.datasetId, contrastId, row.config, ['unreviewed_sample'], contrast.cases, read)?.status).toBe('not_assessed');
        expect(reviewedReplicationCheck(process.cwd(), row.datasetId, 'unreviewed_contrast', row.config, contrast.baseline, contrast.cases, read)?.status).toBe('not_assessed');
      }
    }
    expect(reviewedReplicationCheck(process.cwd(), 'dataset_without_review', 'contrast', undefined, [], [])).toBeNull();
  });

  it('fails closed when a primary-source file changes instead of retaining the previous pass', () => {
    const artifact = JSON.parse(readFileSync('data/internal-qc/replication-2026-09-05/replication-evidence.json', 'utf8'));
    const row = artifact.records.find((record: { datasetId: string }) => record.datasetId === 'chicken_hypo_rfi_gse278826');
    const [contrastId, contrast] = Object.entries(row.contrasts)[0] as [string, { baseline: string[]; cases: string[] }];
    const readChangedSource = (path: string): Buffer => path.replace(/\\/g, '/').endsWith('/GSE278826/mmc4.xlsx')
      ? Buffer.from('changed original pool assignments') : readFileSync(path);
    const check = reviewedReplicationCheck(process.cwd(), row.datasetId, contrastId, row.config, contrast.baseline, contrast.cases, readChangedSource);
    expect(check?.status).toBe('not_assessed');
    expect(check?.note).toContain('changed source');
  });

  it('does not discard a known review when its generated evidence artifact is missing', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'hypo-replication-test-'));
    try {
      const directory = join(fixtureRoot, 'data/internal-qc/replication-2026-09-05');
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'reviewed-specifications.json'), JSON.stringify({ records: [{ datasetId: 'known_review' }] }));
      expect(reviewedReplicationCheck(fixtureRoot, 'known_review', 'contrast', {}, baseline, cases)?.status).toBe('not_assessed');
      expect(reviewedReplicationCheck(fixtureRoot, 'dataset_without_review', 'contrast', {}, baseline, cases)).toBeNull();
    } finally {
      expect(dirname(resolve(fixtureRoot))).toBe(resolve(tmpdir()));
      expect(basename(fixtureRoot)).toMatch(/^hypo-replication-test-/);
      rmSync(fixtureRoot, { recursive: true });
    }
  });

  it('does not fall back to label-based replication if a reviewed row is removed from the artifact', () => {
    const artifact = JSON.parse(readFileSync('data/internal-qc/replication-2026-09-05/replication-evidence.json', 'utf8'));
    const row = artifact.records.find((record: { datasetId: string }) => record.datasetId === 'chicken_hypo_rfi_gse278826');
    const [contrastId, contrast] = Object.entries(row.contrasts)[0] as [string, { baseline: string[]; cases: string[] }];
    artifact.records = artifact.records.filter((record: { datasetId: string }) => record.datasetId !== row.datasetId);
    const readRemovedRow = (path: string): Buffer => path.replace(/\\/g, '/').endsWith('/replication-evidence.json')
      ? Buffer.from(JSON.stringify(artifact)) : readFileSync(path);
    const check = reviewedReplicationCheck(process.cwd(), row.datasetId, contrastId, row.config, contrast.baseline, contrast.cases, readRemovedRow);
    expect(check?.status).toBe('not_assessed');
    expect(check?.note).toContain('dataset row is missing');
  });

  it('keeps the round-two matched input/IP libraries at three pools and culture independence unresolved', () => {
    const artifact = JSON.parse(readFileSync('data/internal-qc/replication-2026-09-05/replication-evidence.json', 'utf8'));
    const paired = artifact.records.find((record: { accession: string }) => record.accession === 'GSE306829');
    expect(paired.config.batch_var).toBe('pair');
    expect(paired.mappings).toHaveLength(6);
    expect(new Set(paired.mappings.map((row: BiologicalUnitMapping) => row.unitKey)).size).toBe(3);
    expect(Object.values(paired.contrasts)[0]).toMatchObject({ check: { status: 'review' } });
    for (const accession of ['GSE160467', 'GSE270378']) {
      const row = artifact.records.find((record: { accession: string }) => record.accession === accession);
      expect(row.mappings.every((mapping: BiologicalUnitMapping) => !mapping.independenceDeclared)).toBe(true);
      expect(Object.values(row.contrasts)[0]).toMatchObject({ check: { status: 'not_assessed' } });
    }
    const dehydration = artifact.records.find((record: { accession: string }) => record.accession === 'GSE175461');
    expect(dehydration.mappings).toHaveLength(10);
    expect(new Set(dehydration.mappings.flatMap((row: BiologicalUnitMapping) => row.sourceSamples)).size).toBe(10);
    expect(dehydration.mappings.every((row: BiologicalUnitMapping) => row.unitKey === null && !row.independenceDeclared)).toBe(true);
    expect(Object.values(dehydration.contrasts)[0]).toMatchObject({ check: { status: 'review' } });
    expect(dehydration.note).toContain('random assignment of cages');
    expect(dehydration.mappings.find((row: BiologicalUnitMapping) => row.sample === 'Sample_C3')).toMatchObject({ sourceSamples: ['GSM5334788'], sourceLabels: ['Wistar_SON_euhydrated_rep3'] });
    expect(dehydration.sources.some((source: { kind: string }) => source.kind === 'reviewed_web_excerpt')).toBe(true);
  });

  it('rejects edited unit identities even if source files and configuration still match', () => {
    const artifact = JSON.parse(readFileSync('data/internal-qc/replication-2026-09-05/replication-evidence.json', 'utf8'));
    const row = artifact.records.find((record: { accession: string }) => record.accession === 'GSE131172');
    const [contrastId, contrast] = Object.entries(row.contrasts)[0] as [string, { baseline: string[]; cases: string[] }];
    row.mappings[0].unitKey = 'invented-animal';
    const readEditedMapping = (path: string): Buffer => path.replace(/\\/g, '/').endsWith('/replication-evidence.json')
      ? Buffer.from(JSON.stringify(artifact)) : readFileSync(path);
    const check = reviewedReplicationCheck(process.cwd(), row.datasetId, contrastId, row.config, contrast.baseline, contrast.cases, readEditedMapping);
    expect(check?.status).toBe('not_assessed');
    expect(check?.note).toContain('mapping differs');
  });
});
