import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  sourceCurrent: true,
  study: {} as any,
  analyses: [] as any[],
  verify: vi.fn(),
}));
vi.mock('node:fs', () => ({
  readFileSync: (path: string) => Buffer.from(JSON.stringify(String(path).endsWith('studies.json') ? [fixture.study] : fixture.analyses)),
}));
vi.mock('../../scripts/lib/historicalEvidence.mjs', () => ({
  readAdditiveIntake: () => ({ datasetIds: new Set(['rat_son_salt_gse65663']) }),
}));
vi.mock('../../scripts/lib/oxtAvpIntakeEvidence.mjs', () => ({
  OXT_AVP_INTAKE: 'data/intake/oxt-avp-2026-10-19',
  OXT_AVP_AUDIT: 'data/intake/oxt-avp-2026-10-19/audit.generated.json',
  createOxtAvpIntakeReader: () => ({ evaluate: () => ({
    preparation: { status: fixture.sourceCurrent ? 'pass' : 'not_assessed' },
    effects: { status: fixture.sourceCurrent ? 'pass' : 'not_assessed' },
    replication: { status: fixture.sourceCurrent ? 'pass' : 'not_assessed' },
  }) }),
}));
vi.mock('../../scripts/lib/fgseaProvenance.mjs', () => ({
  FGSEA_DATABASES: ['GO_BP', 'HALLMARK', 'KEGG', 'REACTOME'],
  readVerifiedFgseaSet: fixture.verify,
}));

// Keep the Node-only evidence constructor out of the browser typecheck graph.
const constructorModule = '../../scripts/lib/currentIntakePathwayEvidence.mjs';
const registry = [{ id: 'rat_son_salt_gse65663', geo: 'GSE65663', contrasts: [{ id: 'salt_vs_control' }] }];
const prefix = 'geo_replication/datasets/GSE65663_rnor_son_salt/processed/GSE65663';
beforeEach(() => {
  fixture.sourceCurrent = true;
  fixture.study = { id: registry[0].id, accession: 'GSE65663', organism: 'Rattus norvegicus',
    dir: 'geo_replication/datasets/GSE65663_rnor_son_salt',
    tracks: [{ id: 'son', analysisId: 'GSE65663' }], contrasts: registry[0].contrasts };
  fixture.analyses = [{ studyId: registry[0].id, analysisId: 'GSE65663', track: 'son', contrast: 'salt_vs_control' }];
  fixture.verify.mockReset().mockImplementation((dePath: string) => ({
    provenancePath: dePath.replace(/_DE.tsv$/, '_FGSEA_provenance.tsv'),
    rawRows: {
      GO_BP: [{ pval: '.1', padj: '.2', NES: '1' }, { pval: 'NA', padj: 'NA', NES: 'NaN' }],
      HALLMARK: [], KEGG: [{ pval: '.3', padj: '.5', NES: '-1' }], REACTOME: [],
    },
  }));
});

describe('current intake pathway evidence constructor', () => {
  it('requires both the fresh source audit and independent current schema-3 verification', async () => {
    const { readCurrentIntakePathwayRecords } = await import(constructorModule);
    const [record] = readCurrentIntakePathwayRecords('/repo', registry);
    expect(record).toMatchObject({ state: 'current_provenance_checked', currentRows: 3, nonFiniteRows: 1, contrastCount: 1 });
    expect(record).not.toHaveProperty('totals');
    expect(record).not.toHaveProperty('baselineCommit');
    expect(fixture.verify).toHaveBeenCalledOnce();
    expect(fixture.verify.mock.calls[0][0].replaceAll('\\', '/')).toContain(`${prefix}_DE.tsv`);
    expect(fixture.verify.mock.calls[0][1]).toEqual({ expectedSpecies: 'Rattus norvegicus' });
    fixture.sourceCurrent = false;
    fixture.verify.mockClear();
    expect(() => readCurrentIntakePathwayRecords('/repo', registry)).toThrow(/missing or stale/);
    expect(fixture.verify).not.toHaveBeenCalled();
  });

  it('fails on provenance/hash rejection and incomplete or changed analysis identities', async () => {
    const { readCurrentIntakePathwayRecords } = await import(constructorModule);
    fixture.verify.mockImplementation(() => { throw new Error('schema-3 output hash mismatch'); });
    expect(() => readCurrentIntakePathwayRecords('/repo', registry)).toThrow(/hash mismatch/);
    fixture.analyses[0].analysisId = 'GSE30733';
    expect(() => readCurrentIntakePathwayRecords('/repo', registry)).toThrow(/analysis identity changed/);
    fixture.analyses = [];
    expect(() => readCurrentIntakePathwayRecords('/repo', registry)).toThrow(/analysis coverage changed/);
  });

  it('does not provide a bypass for older datasets and rejects changed registered coverage', async () => {
    const { readCurrentIntakePathwayRecords } = await import(constructorModule);
    expect(readCurrentIntakePathwayRecords('/repo', [{ id: 'mouse', geo: 'GSE1', contrasts: [] }])).toEqual([]);
    expect(fixture.verify).not.toHaveBeenCalled();
    expect(() => readCurrentIntakePathwayRecords('/repo', [{ ...registry[0], geo: 'GSE1' }])).toThrow(/accession changed/);
    expect(() => readCurrentIntakePathwayRecords('/repo', [{ ...registry[0], contrasts: [{ id: 'different' }] }])).toThrow(/contrasts changed/);
    fixture.study.tracks.push({ id: 'other', analysisId: 'GSE65663_other' });
    expect(() => readCurrentIntakePathwayRecords('/repo', registry)).toThrow(/track coverage/);
  });
});
