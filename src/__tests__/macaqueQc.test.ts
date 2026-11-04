import { describe, expect, it } from 'vitest';
import {
  MACAQUE_AUDIT_VERSION, MACAQUE_HASH_SCHEME, MACAQUE_SAMPLES, MACAQUE_SOURCE_PATHS, aggregateMacaqueTracks, atlasFingerprint,
  auditMacaqueTrack, macaqueEvidenceCurrent, macaqueProtocol, parseMacaqueBundle, parseMacaqueCsv, type MacaqueTrackInput,
} from '../../scripts/lib/macaqueQc.mjs';

function input(): MacaqueTrackInput {
  const groups = Object.fromEntries(MACAQUE_SAMPLES.map((sample, i) => [sample, i < 3 ? 'Normal' : 'Obese']));
  const flags = { nNormal: 3, nObese: 3, minCells: 15, is3v3: true };
  return {
    id: 'e9', protocol: { minimumCells: 15, aliases: {}, groups, valid: true }, evidence: ['fixture'],
    bundle: { meta: { code: 'e9', sampleNames: MACAQUE_SAMPLES, sampleOrder: MACAQUE_SAMPLES, normalSamples: MACAQUE_SAMPLES.slice(0, 3), obeseSamples: MACAQUE_SAMPLES.slice(3), samplesKept: MACAQUE_SAMPLES,
      groupSamples: { normal: MACAQUE_SAMPLES.slice(0, 3), obese: MACAQUE_SAMPLES.slice(3) }, nGenes: 1 },
      qc: { cluster: 'e9', samplesKept: MACAQUE_SAMPLES, ...flags }, de: [{ gene: 'A', logFC: 0.1235, logCPM: 2.1235, PValue: 0.5, FDR: 0.5, se: null }], cpm: { A: [1, 2, 3, 4, 5, 6] } },
    datasetMeta: { nGenes: { e9: 1 }, qcFlags: { e9: { ...flags } } },
    de: [{ gene: 'A', logFC: '0.123456', logCPM: '2.123456', F: '2', PValue: '0.5', FDR: '0.5' }],
    cpm: { header: ['gene', ...MACAQUE_SAMPLES], rows: [{ gene: 'A', ...Object.fromEntries(MACAQUE_SAMPLES.map((sample, i) => [sample, String(i + 1)])) }] },
    groupRows: [{ cluster: 'e9', min_cells: '15', n_normal: '3', n_obese: '3', is_3v3: 'TRUE', samples_kept: MACAQUE_SAMPLES.join(';') }],
    composition: MACAQUE_SAMPLES.map((sample) => ({ sample, cluster: 'e9', n_cells: '20' })),
    runRows: [{ cluster: 'e9', status: 'ok' }],
  };
}
const status = (data: MacaqueTrackInput, id: string) => auditMacaqueTrack(data).assessment.checks.find((check) => check.id === id)?.status;

describe('macaque saved-output QC', () => {
  it('verifies complete saved outputs without promoting missing upstream evidence', () => {
    const result = auditMacaqueTrack(input());
    expect(result.assessment.status).toBe('not_assessed');
    for (const id of ['sample_assignment', 'retained_sample_support', 'output_integrity', 'normalized_output_integrity', 'design_identifiability', 'run_completion']) expect(result.assessment.checks.find((c) => c.id === id)?.status).toBe('pass');
    for (const id of ['source_integrity', 'independent_replication', 'matrix_values', 'library_detection', 'count_conservation', 'normalization', 'model_validity']) expect(result.assessment.checks.find((c) => c.id === id)?.status).toBe('not_assessed');
  });

  it('requires review for two retained samples and checks canonical null slots', () => {
    const data = input();
    const kept = MACAQUE_SAMPLES.slice(1);
    data.composition[0].n_cells = '10';
    Object.assign(data.groupRows[0], { n_normal: '2', is_3v3: 'FALSE', samples_kept: kept.join(';') });
    data.bundle.meta.samplesKept = kept;
    Object.assign(data.bundle.qc, { samplesKept: kept, nNormal: 2, is3v3: false });
    Object.assign(data.datasetMeta.qcFlags.e9, { nNormal: 2, is3v3: false });
    data.cpm.header = ['gene', ...kept];
    delete data.cpm.rows[0][MACAQUE_SAMPLES[0]];
    data.bundle.cpm.A[0] = null;
    expect(status(data, 'sample_assignment')).toBe('pass');
    expect(status(data, 'retained_sample_support')).toBe('review');
    expect(status(data, 'normalized_output_integrity')).toBe('pass');
    expect(status(data, 'independent_replication')).toBe('not_assessed');
    data.bundle.cpm.A[0] = 0;
    expect(status(data, 'normalized_output_integrity')).toBe('fail');
  });

  it('detects source and display discrepancies outside a selected gene subset', () => {
    const data = input();
    data.de.push({ ...data.de[0], gene: 'B' });
    expect(status(data, 'output_integrity')).toBe('fail');
    expect(status(data, 'normalized_output_integrity')).toBe('fail');
  });

  it('recomputes BH rather than trusting a matched but wrong FDR export', () => {
    const data = input();
    data.de[0].FDR = '0.9';
    data.bundle.de[0].FDR = 0.9;
    expect(status(data, 'output_integrity')).toBe('fail');
  });

  it('rejects incorrect group metadata, count support and CPM ordering', () => {
    const data = input();
    data.bundle.meta.groupSamples.normal = MACAQUE_SAMPLES.slice(3);
    expect(status(data, 'sample_assignment')).toBe('fail');
    const wrongCells = input();
    wrongCells.composition[0].n_cells = '14';
    expect(status(wrongCells, 'sample_assignment')).toBe('fail');
    const wrongOrder = input();
    wrongOrder.bundle.cpm.A = [2, 1, 3, 4, 5, 6];
    expect(status(wrongOrder, 'normalized_output_integrity')).toBe('fail');
  });

  it('rejects fabricated standard errors and an unsuccessful run', () => {
    const data = input();
    data.bundle.de[0].se = 0.4;
    data.runRows[0].status = 'failed';
    expect(status(data, 'output_integrity')).toBe('fail');
    expect(status(data, 'run_completion')).toBe('fail');
  });

  it('parses JSON bundles and CSV without executing code or losing quoting', () => {
    expect(parseMacaqueBundle('// comment\nvar X = {"a":1};\n')).toEqual({ a: 1 });
    expect(() => parseMacaqueBundle('var X = {}; process.exit();')).toThrow();
    expect(parseMacaqueCsv('"gene","x"\n"A,B",2').rows[0]).toEqual({ gene: 'A,B', x: '2' });
    expect(() => parseMacaqueCsv('gene,x\nA,1,2')).toThrow();
    expect(macaqueProtocol('MIN_CELLS <- 15').valid).toBe(false);
  });

  it('requires all current tracks, all input hashes and the current audit script', () => {
    const paths = ['public/datasets/macaque_snrna/track_e9.js', 'data/raw/results/e9__POMC/de/DE_all.csv', 'data/raw/results/e9__POMC/de/normcpm.csv', 'data/raw/results/e9__POMC/qc/group_sizes.csv'];
    const hashes = Object.fromEntries([...MACAQUE_SOURCE_PATHS, ...paths].map((path) => [path, 'hash']));
    const track = { ...auditMacaqueTrack(input()), paths };
    const evidence = { auditVersion: MACAQUE_AUDIT_VERSION, fingerprintScheme: MACAQUE_HASH_SCHEME, trackIds: ['e9'], tracks: [track], fingerprints: hashes };
    expect(macaqueEvidenceCurrent(evidence, ['e9'], hashes)).toBe(true);
    expect(macaqueEvidenceCurrent(evidence, ['e9', 'i23'], hashes)).toBe(false);
    expect(macaqueEvidenceCurrent(evidence, ['e9'], { ...hashes, [MACAQUE_SOURCE_PATHS[0]]: 'changed' })).toBe(false);
    expect(macaqueEvidenceCurrent({ ...evidence, tracks: [] }, ['e9'], hashes)).toBe(false);
    const missing = { ...hashes };
    delete missing['scripts/audit_macaque_internal_qc.mts'];
    expect(macaqueEvidenceCurrent({ ...evidence, fingerprints: missing }, ['e9'], missing)).toBe(false);
    const wrongPathTrack = { ...track, paths: [paths[1], paths[0], ...paths.slice(2)] };
    expect(macaqueEvidenceCurrent({ ...evidence, tracks: [wrongPathTrack] }, ['e9'], hashes)).toBe(false);
    const missingCheck = { ...track, assessment: { ...track.assessment, checks: track.assessment.checks.slice(1) } };
    expect(macaqueEvidenceCurrent({ ...evidence, tracks: [missingCheck] }, ['e9'], hashes)).toBe(false);
    const duplicateCheck = { ...track, assessment: { ...track.assessment, checks: [...track.assessment.checks.slice(1), track.assessment.checks[1]] } };
    expect(macaqueEvidenceCurrent({ ...evidence, tracks: [duplicateCheck] }, ['e9'], hashes)).toBe(false);
    const optionalCheck = { ...track, assessment: { ...track.assessment, checks: track.assessment.checks.map((check) => ({ ...check, required: false })) } };
    expect(macaqueEvidenceCurrent({ ...evidence, tracks: [optionalCheck] }, ['e9'], hashes)).toBe(false);
    expect(aggregateMacaqueTracks([track]).status).toBe('not_assessed');
  });

  it('normalizes only CRLF line endings under the versioned text hash scheme', () => {
    expect(atlasFingerprint('gene,value\r\nA,1.2\r\n')).toBe(atlasFingerprint('gene,value\nA,1.2\n'));
    expect(atlasFingerprint(new TextEncoder().encode('gene,value\r\nA,1.2\r\n'))).toBe(atlasFingerprint('gene,value\nA,1.2\n'));
    expect(atlasFingerprint('gene,value\nA,1.2\n')).not.toBe(atlasFingerprint('gene,value\nA,1.3\n'));
    expect(atlasFingerprint('gene,value\nA,1.2\n')).not.toBe(atlasFingerprint('gene,value\nA,1.20\n'));
    expect(atlasFingerprint('gene,value\nA,1.2\n')).not.toBe(atlasFingerprint('gene,value\rA,1.2\r'));
    expect(atlasFingerprint(new TextEncoder().encode('\uFEFFgene,value\nA,1.2\n'))).toBe(atlasFingerprint('\uFEFFgene,value\nA,1.2\n'));
    expect(atlasFingerprint('gene,value\nA,1.2\n')).not.toBe(atlasFingerprint('\uFEFFgene,value\nA,1.2\n'));
    expect(() => atlasFingerprint(new Uint8Array([255]))).toThrow();
  });
});
