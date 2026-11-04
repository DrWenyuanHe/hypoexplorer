import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listDatasets } from '../data/datasets';
import {
  sourceAccession, UPSTREAM_NOT_STATED, UPSTREAM_PROCESSING, upstreamDisplay, upstreamSource, upstreamSummary,
} from '../data/upstreamProcessing';

// The depositor's upstream processing (aligner, genome build, annotation) for
// every registered study. scripts/build_upstream_processing.mts --check owns
// regeneration; these tests hold the closure and the display contract.

const TSV = resolve(process.cwd(), 'geo_replication/config/upstream_processing.tsv');

function tsvRows(): Array<Record<string, string>> {
  const [header, ...lines] = readFileSync(TSV, 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n');
  const columns = header.split('\t');
  return lines.map((line) => Object.fromEntries(line.split('\t').map((value, index) => [columns[index], value])));
}

describe('upstream processing closure', () => {
  it('has a record for every registered dataset and none for unregistered accessions', () => {
    const datasets = listDatasets();
    const accessions = new Set(datasets.map((dataset) => sourceAccession(dataset)));
    for (const dataset of datasets) {
      const accession = sourceAccession(dataset);
      expect(accession, dataset.id).toBeTruthy();
      expect(UPSTREAM_PROCESSING[accession!], `${dataset.id} (${accession})`).toBeDefined();
    }
    expect(Object.keys(UPSTREAM_PROCESSING).sort()).toEqual([...accessions].sort());
  });

  it('keeps the TSV and the generated JSON on the same accessions and statuses', () => {
    const rows = tsvRows();
    expect(rows.map((row) => row.accession).sort()).toEqual(Object.keys(UPSTREAM_PROCESSING).sort());
    for (const row of rows) {
      expect(UPSTREAM_PROCESSING[row.accession].status, row.accession).toBe(row.review_status);
      expect(UPSTREAM_PROCESSING[row.accession].evidence, row.accession).toBe(row.evidence_kind);
      if (row.evidence_path !== 'NA') expect(row.evidence_sha256, row.accession).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('carries one row per source accession: GSE68177 backs two registry entries', () => {
    const backers = listDatasets().filter((dataset) => dataset.geo === 'GSE68177');
    expect(backers.length).toBe(2);
    expect(tsvRows().filter((row) => row.accession === 'GSE68177')).toHaveLength(1);
  });

  it('pins the macaque source review and keeps unstated snRNA methods separate from Stereo-seq', () => {
    const row = tsvRows().find((entry) => entry.accession === 'CNP0003785')!;
    const evidence = readFileSync(resolve(process.cwd(), row.evidence_path), 'utf8').replace(/\r\n/g, '\n');
    expect(createHash('sha256').update(evidence).digest('hex')).toBe(row.evidence_sha256);
    const review = JSON.parse(evidence);
    for (const kind of ['tree', 'audit']) {
      const source = readFileSync(resolve(dirname(row.evidence_path), review.author_code[kind]), 'utf8').replace(/\r\n/g, '\n');
      expect(createHash('sha256').update(source).digest('hex')).toBe(review.author_code[`${kind}_sha256_lf`]);
    }
    expect(row).toMatchObject({
      aligner: 'STAR', aligner_version: '2.5.3',
      genome_build: 'Macaca_fascicularis_5.0 (pre-mRNA reference)',
      annotation: 'NA', annotation_version: 'NA', quantifier: 'NA', quantifier_version: 'NA',
      evidence_kind: 'paper_methods', review_status: 'reviewed',
    });
    const record = UPSTREAM_PROCESSING.CNP0003785;
    expect(record.annotation).toBeUndefined();
    expect(record.quantifier).toBeUndefined();
    expect(upstreamSource(record)).toContain('Annotation provider/release and the snRNA-seq counting tool are not stated');
  });
});

describe('upstream processing display', () => {
  it('joins aligner, genome and annotation, adding the quantifier only when it is a different tool', () => {
    expect(upstreamSummary({
      aligner: 'STAR 2.5.1b', genome: 'mm9', annotation: 'Ensembl 67', evidence: 'geo_data_processing', status: 'reviewed',
    })).toBe('STAR 2.5.1b · mm9 · Ensembl 67 (as deposited)');
    expect(upstreamSummary({
      aligner: 'Cell Ranger 2.0.0', genome: 'mm10', quantifier: 'Cell Ranger 2.0.0', evidence: 'geo_data_processing', status: 'reviewed',
    })).toBe('Cell Ranger 2.0.0 · mm10 (as deposited)');
    expect(UPSTREAM_PROCESSING.GSE104709).toMatchObject({ aligner: 'STAR 2.5.1b', genome: 'mm9', annotation: 'Ensembl 67' });
  });

  it('says "Not stated by depositor" when a checked record names none of the four', () => {
    expect(upstreamDisplay({ evidence: 'geo_data_processing', status: 'not_stated' })).toBe(UPSTREAM_NOT_STATED);
    expect(upstreamDisplay(undefined)).toBeNull();
  });
});
