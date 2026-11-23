import { describe, it, expect, beforeAll } from 'vitest';
import {
  compareGenesCsv, compareGenesWorkbook, compareSummaryLongRows, compareSummaryRows, compareValueRows, compareValuesCsv,
} from '../compare/compareSummary';
import { makePopData, MACAQUE_DATASET } from './fixtures';
import type { CompareColumn } from '../compare/compareColumns';
import type { PopData } from '../types';
import { loadExportEvidence } from '../utils/lazyExport';

// Sheet LAYOUT: which rows each download has, in what order, under which
// headers. What a (column, gene) cell holds — n, mean, SEM, the dropped-sample
// rule, unavailable vs not detected — is tested once, at compareCell.

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
const failed: CompareColumn = {
  key: 'x1', label: 'x1', color: '#222', qc: null, unavailable: { status: 'failed', message: 'HTTP 500' },
};
// The failed column still has a popData in the map: the column's flag, not the
// map, decides that it is unavailable.
const popDataMap: Record<string, PopData | null> = { e9: pop('e9'), i23: pop('i23'), x1: pop('x1') };

describe('compare downloads are long format', () => {
  it('writes one summary row per gene × population under fixed headers', () => {
    const rows = compareSummaryLongRows(columns, popDataMap, ['POMC', 'AGRP']);
    expect(rows.map((r) => `${r.Gene}:${r.Population}`)).toEqual(['POMC:e9', 'POMC:i23', 'AGRP:e9', 'AGRP:i23']);
    expect(Object.keys(rows[0])).toEqual([
      'Gene', 'Population', 'Label', 'Detected', 'logFC', 'PValue', 'FDR', 'Stars',
      'Baseline', 'Baseline n', 'Baseline mean', 'Baseline SEM', 'Case', 'Case n', 'Case mean', 'Case SEM', 'Unit',
    ]);
    expect(rows[0]).toMatchObject({
      Label: 'e9 (POMC/TBX3)', Detected: 'yes', logFC: 1.5, PValue: 0.001, FDR: 0.01, Stars: '**',
      Baseline: 'Normal', 'Baseline n': 2, 'Baseline mean': 15, 'Baseline SEM': 5,
      Case: 'Obese', 'Case n': 2, 'Case mean': 35, 'Case SEM': 5,
      Unit: 'CPM',
    });
  });

  it('keeps a blank row for a gene a population did not detect', () => {
    const [row] = compareSummaryLongRows(columns.slice(0, 1), popDataMap, ['NOT_A_GENE']);
    expect(row).toMatchObject({
      Gene: 'NOT_A_GENE', Population: 'e9', Detected: 'no', logFC: '', Stars: '',
      Baseline: 'Normal', 'Baseline n': '', 'Baseline mean': '', 'Case n': '', 'Case SEM': '',
    });
  });

  it('lists every present sample behind each bar, one row each', () => {
    const rows = compareValueRows(columns, popDataMap, ['AGRP']);
    expect(rows.filter((r) => r.Population === 'e9')).toEqual([
      { Gene: 'AGRP', Population: 'e9', Label: 'e9 (POMC/TBX3)', Group: 'Normal', Sample: 'S1', Value: 5, Unit: 'CPM' },
      { Gene: 'AGRP', Population: 'e9', Label: 'e9 (POMC/TBX3)', Group: 'Obese', Sample: 'S3', Value: 15, Unit: 'CPM' },
      { Gene: 'AGRP', Population: 'e9', Label: 'e9 (POMC/TBX3)', Group: 'Obese', Sample: 'S4', Value: 25, Unit: 'CPM' },
    ]);
    expect(rows).toHaveLength(6);
    expect(compareValueRows(columns, popDataMap, ['NOT_A_GENE'])).toEqual([]);
  });

  it('leaves an unavailable column out of every sheet', () => {
    const withFailed = [...columns, failed];
    expect(compareSummaryLongRows(withFailed, popDataMap, ['POMC']).map((r) => r.Population)).toEqual(['e9', 'i23']);
    expect(new Set(compareValueRows(withFailed, popDataMap, ['POMC']).map((r) => r.Population))).toEqual(new Set(['e9', 'i23']));
    const [wide] = compareSummaryRows(withFailed, popDataMap, ['POMC']);
    expect(Object.keys(wide).some((k) => k.startsWith('x1_'))).toBe(false);
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
  // i23 has no AGRP DE row, but its cpm matrix still carries AGRP values.
  const withoutAgrpDE = makePopData({
    dataset: MACAQUE_DATASET,
    meta: { code: 'i23' },
    de: pop('e9').de.filter((d) => d.gene !== 'AGRP'),
  });
  const map = { e9: pop('e9'), i23: withoutAgrpDE };

  it('writes a prefixed block per column, led by the tally when asked', () => {
    const [row] = compareSummaryRows(columns, map, ['AGRP'], { tally: true });
    expect(Object.keys(row)).toEqual([
      'Gene', 'Detected', 'SigFDR05', 'Up', 'Down',
      'e9_logFC', 'e9_PValue', 'e9_Stars', 'e9_MeanNormalCPM', 'e9_MeanObeseCPM',
      'i23_logFC', 'i23_PValue', 'i23_Stars', 'i23_MeanNormalCPM', 'i23_MeanObeseCPM',
    ]);
    expect(row).toMatchObject({ Gene: 'AGRP', Detected: 1, SigFDR05: 0, e9_MeanNormalCPM: 5, e9_MeanObeseCPM: 20 });
    expect(Object.keys(compareSummaryRows(columns, map, ['AGRP'])[0])[1]).toBe('e9_logFC');
  });

  it('leaves every cell blank, means included, for a study that did not detect the gene', () => {
    // Deliberate: the group means used to be read from the cpm matrix even
    // with no DE row, so this sheet printed means the long sheet and the
    // on-screen tile both call "not detected".
    const [row] = compareSummaryRows(columns, map, ['AGRP']);
    expect(row).toMatchObject({
      i23_logFC: '', i23_PValue: '', i23_Stars: '', i23_MeanNormalCPM: '', i23_MeanObeseCPM: '',
    });
  });
});
