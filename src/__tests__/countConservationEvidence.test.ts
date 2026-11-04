import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONSERVATION_EVIDENCE, conservationFingerprint, createCountConservationReader } from '../../scripts/lib/countConservationEvidence.mjs';

const root = process.cwd();
const evidencePath = resolve(root, CONSERVATION_EVIDENCE);
const evidence = () => JSON.parse(readFileSync(evidencePath, 'utf8'));
const target = (document: any, id = 'GSE198437') => document.records.find((row: any) => row.configId === id);
const request = (row: any) => ({
  datasetId: row.datasetId, config: row.config, currentInputPath: row.inputPath,
  matrix: { rows: row.samples[0].output_rows, samples: row.samples.map((s: any) => s.sample),
    sums: Object.fromEntries(row.samples.map((s: any) => [s.sample, s.output_library_size])) },
});
function evaluate(mutate?: (document: any) => void, id = 'GSE198437') {
  const document = evidence();
  const originalRequest = request(target(document, id));
  mutate?.(document);
  const reader = createCountConservationReader(root, { readBytes: path => path === evidencePath
    ? Buffer.from(JSON.stringify(document)) : readFileSync(path) });
  return reader.evaluate(originalRequest);
}

describe('complete source-to-input conservation evidence', () => {
  it('accepts the independently remeasured exact priority source', () => {
    expect(evaluate().status).toBe('pass');
  });
  it('explains signed raw total changes for declared R rounding', () => {
    const result = evaluate(undefined, 'GSE235479');
    expect(result.status).toBe('pass');
    expect(result.note).toContain('raw library totals change');
    expect(result.note).toContain('not described as lossless');
  });
  it('does not trust an altered saved dataset status', () => {
    expect(evaluate(d => { target(d).status = 'review'; }).status).toBe('not_assessed');
  });
  it('rejects missing per-cell mismatch evidence', () => {
    expect(evaluate(d => { delete target(d).samples[0].mismatching_retained_cells; }).status).toBe('not_assessed');
  });
  it('rejects a partial selected-sample audit', () => {
    expect(evaluate(d => { target(d).samples.pop(); }).status).toBe('not_assessed');
  });
  it('rejects duplicate selected samples', () => {
    expect(evaluate(d => { target(d).samples[1] = target(d).samples[0]; }).status).toBe('not_assessed');
  });
  it('rejects source substitution even when another pinned file exists', () => {
    expect(evaluate(d => { target(d).specification.source = target(d).inputPath; }).status).toBe('not_assessed');
  });
  it('requires the original source file pin', () => {
    expect(evaluate(d => { const r = target(d); r.pins = r.pins.filter((p: any) => p.path !== r.specification.source); }).status).toBe('not_assessed');
  });
  it('detects changed actual source bytes through a read-only injection', () => {
    const row = target(evidence());
    const source = resolve(root, row.specification.source);
    const reader = createCountConservationReader(root, { readBytes: path => path === source
      ? Buffer.concat([readFileSync(path), Buffer.from('changed')]) : readFileSync(path) });
    expect(reader.evaluate(request(row)).status).toBe('not_assessed');
  });
  it('refuses a different current sample roster', () => {
    const row = target(evidence());
    const req = request(row);
    req.matrix.samples[0] = 'unregistered_sample';
    expect(createCountConservationReader(root).evaluate(req).status).toBe('not_assessed');
  });
  it('refuses a substituted config samplesheet', () => {
    const row = target(evidence());
    const req = request(row);
    req.config = { ...req.config, samplesheet: 'unrelated.tsv' };
    expect(createCountConservationReader(root).evaluate(req).status).toBe('not_assessed');
  });
  it('keeps a current measured total disagreement visible', () => {
    const req = request(target(evidence()));
    req.matrix.sums[req.matrix.samples[0]] += 1;
    expect(createCountConservationReader(root).evaluate(req).status).toBe('review');
  });
  it('preserves an existing failure', () => {
    const req = request(target(evidence()));
    expect(createCountConservationReader(root).evaluate({ ...req,
      previous: { id: 'count_conservation', label: 'Count conservation', status: 'fail', note: 'Known discrepancy' } }).status).toBe('fail');
  });
  it('requires original fractional totals and a signed rounding delta', () => {
    expect(evaluate(d => { delete target(d, 'GSE235479').samples[0].declared_rounding_delta; }, 'GSE235479').status).toBe('not_assessed');
  });
  it('requires the complete number of retained count cells', () => {
    expect(evaluate(d => { target(d).comparedCells -= 1; }).status).toBe('not_assessed');
  });
  it('does not accept a different retained preparation for rounding', () => {
    const result = evaluate(d => {
      const row = target(d, 'GSE235479');
      row.pins = row.pins.filter((p: any) => !p.path.endsWith('/prep_2026batch2.R'));
      row.pins.push(target(d, 'GSE229838').pins.find((p: any) => p.path.endsWith('/prep_GSE229838.R')));
    }, 'GSE235479');
    expect(result.status).toBe('not_assessed');
    expect(result.note).toContain('rounding code/runtime evidence absent');
  });
  it('requires nonempty source column names', () => {
    const result = evaluate(d => { const r = target(d); r.sourceColumns[r.samples[0].sample] = ' '; });
    expect(result.status).toBe('not_assessed');
    expect(result.note).toContain('Source columns must be nonempty');
  });
  it('does not count the same source column as two independent selected columns', () => {
    const result = evaluate(d => { const r = target(d); r.sourceColumns[r.samples[1].sample] = r.sourceColumns[r.samples[0].sample]; });
    expect(result.status).toBe('not_assessed');
    expect(result.note).toContain('Source columns must be nonempty and unique');
  });
  it('binds directory-member hashes to their checked original files', () => {
    const result = evaluate(d => { target(d, 'GSE266472').sourceMembers[0].sha256 = '0'.repeat(64); }, 'GSE266472');
    expect(result.status).toBe('not_assessed');
    expect(result.note).toContain('Source member does not match its checked file pin');
  });
  it('makes CRLF portability explicit without accepting a numeric change', () => {
    expect(conservationFingerprint(Buffer.from('s\t1\n'), 'utf8-crlf-to-lf'))
      .toEqual(conservationFingerprint(Buffer.from('s\t1\r\n'), 'utf8-crlf-to-lf'));
    expect(conservationFingerprint(Buffer.from('s\t2\n'), 'utf8-crlf-to-lf').sha256)
      .not.toBe(conservationFingerprint(Buffer.from('s\t1\n'), 'utf8-crlf-to-lf').sha256);
    expect(conservationFingerprint(Buffer.from('s\t1\n'), 'exact-bytes').sha256)
      .not.toBe(conservationFingerprint(Buffer.from('s\t1\r\n'), 'exact-bytes').sha256);
  });

  it.each(['GSE245727', 'GSE254155', 'GSE289833', 'GSE201207_young_vs_old', 'GSE314817_6v27mo'])(
    'accepts complete independently reread recovered source counts for %s', id => {
      expect(evaluate(undefined, id).status).toBe('pass');
    },
  );
  it('keeps keyed conservation distinct from strict GSE254155 reconstruction', () => {
    const result = evaluate(undefined, 'GSE254155');
    expect(result.note).toContain('row collation differs');
    expect(result.note).toContain('strict reconstruction remains unassessed');
  });
  it('requires original pre-aggregation library totals', () => {
    const result = evaluate(d => { delete target(d, 'GSE314817_6v27mo').samples[0].original_source_library_size; }, 'GSE314817_6v27mo');
    expect(result.status).toBe('not_assessed');
    expect(result.note).toContain('original-to-aggregated source accounting');
  });
  it('does not hide an original-to-aggregate discrepancy behind matching output totals', () => {
    const result = evaluate(d => {
      const row = target(d, 'GSE201207_young_vs_old').samples[0];
      row.original_source_library_size += 1;
      row.source_aggregation_delta -= 1;
    }, 'GSE201207_young_vs_old');
    expect(result.status).toBe('not_assessed');
  });
  it('requires all recovered original archive members in the inventory', () => {
    const result = evaluate(d => { target(d, 'GSE254155').sourceArchiveInventory.pop(); }, 'GSE254155');
    expect(result.status).toBe('not_assessed');
    expect(result.note).toContain('archive inventory');
  });
  it('requires the selected source member mapping', () => {
    const result = evaluate(d => { target(d, 'GSE245727').sampleSourceMapping.pop(); }, 'GSE245727');
    expect(result.status).toBe('not_assessed');
  });
  it('rejects a swapped case/control source mapping', () => {
    const result = evaluate(d => { target(d, 'GSE289833').sampleSourceMapping[0].group = 'case'; }, 'GSE289833');
    expect(result.status).toBe('not_assessed');
    expect(result.note).toContain('bind to one complete original count column');
  });
  it('requires original recovered source acquisition logs', () => {
    const result = evaluate(d => {
      const row = target(d, 'GSE245727');
      row.pins = row.pins.filter((p: any) => p.path !== row.specification.sourceLogs[0]);
    }, 'GSE245727');
    expect(result.status).toBe('not_assessed');
  });
});
