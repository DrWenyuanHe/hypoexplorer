import { describe, it, expect, beforeAll } from 'vitest';
import {
  compareGenesCsv, compareGenesWorkbook, compareSummaryLongRows, compareSummaryRows, compareValueRows, compareValuesCsv,
} from '../compare/compareSummary';
import { makePopData, MACAQUE_DATASET } from './fixtures';
import type { CompareColumn } from '../compare/compareColumns';
import type { PopData } from '../types';
import { loadExportEvidence } from '../utils/lazyExport';

// Export snapshots record the internal QC ledger, which the app loads on the
// first export (utils/lazyExport.ts); load it before any export runs.
beforeAll(() => loadExportEvidence());

// The fixture's per-sample values: S1,S2 Normal and S3,S4 Obese.
// POMC = 10, 20 | 30, 40; AGRP = 5, (missing) | 15, 25.
const pop = (code: string) => makePopData({ dataset: MACAQUE_DATASET, meta: { code } });
const columns: CompareColumn[] = [
  { key: 'e9', label: 'e9', chartLabel: 'e9 (POMC/TBX3)', color: '#000', qc: null },
  { key: 'i23', label: 'i23', chartLabel: 'i23 (AGRP/MCTP2)', color: '#111', qc: null },
];
const popDataMap: Record<string, PopData | null> = { e9: pop('e9'), i23: pop('i23') };

describe('compare downloads are long format', () => {
  it('writes one summary row per gene × population with each arm\'s n, mean and SEM', () => {
    const rows = compareSummaryLongRows(columns, popDataMap, ['POMC', 'AGRP']);
    expect(rows.map((r) => `${r.Gene}:${r.Population}`)).toEqual(['POMC:e9', 'POMC:i23', 'AGRP:e9', 'AGRP:i23']);
    expect(rows[0]).toMatchObject({
      Label: 'e9 (POMC/TBX3)', Detected: 'yes', logFC: 1.5, PValue: 0.001, FDR: 0.01, Stars: '**',
      Baseline: 'Normal', 'Baseline n': 2, 'Baseline mean': 15, 'Baseline SEM': 5,
      Case: 'Obese', 'Case n': 2, 'Case mean': 35, 'Case SEM': 5,
      Unit: 'CPM',
    });
    // A missing sample is dropped, not read as zero, and one value has no SEM.
    expect(rows[2]).toMatchObject({ 'Baseline n': 1, 'Baseline mean': 5, 'Baseline SEM': '', 'Case mean': 20 });
  });

  it('keeps a row for a gene a population did not detect', () => {
    const [row] = compareSummaryLongRows(columns.slice(0, 1), popDataMap, ['NOT_A_GENE']);
    expect(row).toMatchObject({ Gene: 'NOT_A_GENE', Population: 'e9', Detected: 'no', logFC: '', 'Baseline n': '' });
  });

  it('lists every animal\'s value behind each bar for replotting', () => {
    const rows = compareValueRows(columns, popDataMap, ['AGRP']);
    expect(rows.filter((r) => r.Population === 'e9')).toEqual([
      { Gene: 'AGRP', Population: 'e9', Label: 'e9 (POMC/TBX3)', Group: 'Normal', Sample: 'S1', Value: 5, Unit: 'CPM' },
      { Gene: 'AGRP', Population: 'e9', Label: 'e9 (POMC/TBX3)', Group: 'Obese', Sample: 'S3', Value: 15, Unit: 'CPM' },
      { Gene: 'AGRP', Population: 'e9', Label: 'e9 (POMC/TBX3)', Group: 'Obese', Sample: 'S4', Value: 25, Unit: 'CPM' },
    ]);
    expect(rows).toHaveLength(6);
  });

  it('puts Compare, Values and Metadata sheets in the workbook', () => {
    const { sheets } = compareGenesWorkbook(columns, popDataMap, ['POMC']);
    expect(sheets.map((s) => s.name)).toEqual(['Compare', 'Values', 'Metadata']);
    expect(sheets[0].rows).toHaveLength(2);
    expect(sheets[1].rows).toHaveLength(8);
  });

  it('writes the summary and the values as separate, named CSVs', () => {
    const summary = compareGenesCsv(columns, popDataMap, ['POMC']);
    expect(summary.filename).toBe('macaque_snrna_e9+i23_obese_vs_normal_compare.csv');
    expect(summary.columns.slice(0, 4)).toEqual(['Gene', 'Population', 'Label', 'Detected']);
    expect(summary.rows).toHaveLength(2);
    const values = compareValuesCsv(columns, popDataMap, ['POMC']);
    expect(values.filename).toBe('macaque_snrna_e9+i23_obese_vs_normal_compare_values.csv');
    expect(values.columns).toEqual(['Gene', 'Population', 'Label', 'Group', 'Sample', 'Value', 'Unit']);
    expect(values.rows).toHaveLength(8);
  });

  it('gives each CSV row the provenance of its own population', () => {
    const csv = compareValuesCsv(columns, popDataMap, ['POMC']);
    const track = (i: number) => {
      const p = csv.rowProvenance(i);
      return 'columns' in p ? 'columns' : p.track.id;
    };
    expect(track(0)).toBe('e9');
    expect(track(csv.rows.length - 1)).toBe('i23');
    // One record per population, reused across that population's rows.
    expect(csv.rowProvenance(0)).toBe(csv.rowProvenance(1));
  });
});

describe('compare-set summary sheet', () => {
  it('leaves the group means blank for a study that did not measure the gene', () => {
    // i23 has no AGRP at all: no DE row and no per-sample values.
    const withAgrp = pop('e9');
    const withoutAgrp = makePopData({
      dataset: MACAQUE_DATASET,
      meta: { code: 'i23' },
      de: withAgrp.de.filter((d) => d.gene !== 'AGRP'),
      cpm: { POMC: [10, 20, 30, 40] },
    });
    const [row] = compareSummaryRows(columns, { e9: withAgrp, i23: withoutAgrp }, ['AGRP']);
    expect(row).toMatchObject({
      'e9_MeanNormalCPM': 5, 'e9_MeanObeseCPM': 20,
      'i23_logFC': '', 'i23_PValue': '', 'i23_Stars': '',
      'i23_MeanNormalCPM': '', 'i23_MeanObeseCPM': '',
    });
  });
});
