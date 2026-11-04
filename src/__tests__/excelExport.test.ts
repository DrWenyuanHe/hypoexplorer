import { describe, it, expect } from 'vitest';
import {
  rawValueRows, leadingEdgeSummaryRows, groupMeanColumns, pathwayInfoRows,
} from '../utils/excelExport';
import type { PathwayRecordWithDb } from '../types';
import { makePopData } from './fixtures';

// Golden-output tests for the shared export-row builders. These pin the row
// SHAPE, VALUES, and COLUMN ORDER (XLSX.json_to_sheet derives columns from key
// order) so the DRY consolidation stays byte-identical to the old inline code.
// One sample (AGRP/S2) is null to confirm the seam drops it.
const popData = makePopData();

describe('rawValueRows', () => {
  it('emits one tidy row per (gene, present sample), dropping null cells', () => {
    const rows = rawValueRows(popData, ['POMC', 'AGRP']);
    expect(rows).toEqual([
      { Gene: 'POMC', Sample: 'S1', Condition: 'Normal', NormCPM: 10 },
      { Gene: 'POMC', Sample: 'S2', Condition: 'Normal', NormCPM: 20 },
      { Gene: 'POMC', Sample: 'S3', Condition: 'Obese', NormCPM: 30 },
      { Gene: 'POMC', Sample: 'S4', Condition: 'Obese', NormCPM: 40 },
      { Gene: 'AGRP', Sample: 'S1', Condition: 'Normal', NormCPM: 5 },
      { Gene: 'AGRP', Sample: 'S3', Condition: 'Obese', NormCPM: 15 },
      { Gene: 'AGRP', Sample: 'S4', Condition: 'Obese', NormCPM: 25 },
    ]);
  });

  it('pins the column order (Gene, Sample, Condition, <value>)', () => {
    const [row] = rawValueRows(popData, ['POMC']);
    expect(Object.keys(row)).toEqual(['Gene', 'Sample', 'Condition', 'NormCPM']);
  });

  it('names the value column by expression unit (log2 → Log2NormExpr)', () => {
    const [row] = rawValueRows({ ...popData, expressionUnit: 'log2-normalized' }, ['POMC']);
    expect(Object.keys(row)[3]).toBe('Log2NormExpr');
  });
});

describe('leadingEdgeSummaryRows', () => {
  it('emits per-gene DE stats + unit-aware per-group means in the right column order', () => {
    const rows = leadingEdgeSummaryRows(popData, ['POMC', 'AGRP']);
    expect(rows).toEqual([
      { Gene: 'POMC', logFC: 1.5, PValue: 0.001, FDR: 0.01, Stars: '**', MeanNormalCPM: 15, MeanObeseCPM: 35 },
      { Gene: 'AGRP', logFC: -0.8, PValue: 0.04, FDR: 0.2, Stars: '*', MeanNormalCPM: 5, MeanObeseCPM: 20 },
    ]);
    expect(Object.keys(rows[0])).toEqual([
      'Gene', 'logFC', 'PValue', 'FDR', 'Stars', 'MeanNormalCPM', 'MeanObeseCPM',
    ]);
  });

  it('falls back to empty stats for a gene missing from deByGene', () => {
    const [row] = leadingEdgeSummaryRows(popData, ['GHOST']);
    expect(row).toMatchObject({ Gene: 'GHOST', logFC: '', PValue: '', FDR: '', Stars: 'ns' });
  });
});

describe('groupMeanColumns', () => {
  it('labels a log2-normalized dataset honestly (the CSV/XLSX divergence regression)', () => {
    const log2Pop = makePopData({
      expressionUnit: 'log2-normalized',
      contrast: {
        id: 'hfd_vs_chow',
        baseline: { key: 'normal', label: 'Chow', color: '#3775BA' },
        caseGroup: { key: 'obese', label: 'HFD', color: '#B64342' },
        supportsPathways: true,
        label: 'HFD vs Chow',
      },
    });
    const cols = groupMeanColumns(log2Pop, 'POMC');
    expect(Object.keys(cols)).toEqual(['MeanChowLog2', 'MeanHFDLog2']);
    expect(Object.keys(cols)).not.toContain('MeanChow');
    expect(Object.keys(cols)).not.toContain('MeanHFD');
    const log2Rows = leadingEdgeSummaryRows(log2Pop, ['POMC']);
    expect(Object.keys(log2Rows[0])).toEqual([
      'Gene', 'logFC', 'PValue', 'FDR', 'Stars', 'MeanChowLog2', 'MeanHFDLog2',
    ]);
  });
});

describe('pathwayInfoRows', () => {
  const pathway = {
    pathway: 'HALLMARK_ADIPOGENESIS', db: 'HALLMARK', NES: 1.8, padj: 0.01,
    pval: 0.001, size: 200, leadingEdge: ['POMC', 'AGRP'],
  } as unknown as PathwayRecordWithDb;

  it('emits the pathway-detail column order (no QueryGene)', () => {
    const [row] = pathwayInfoRows(pathway, 'e9');
    expect(Object.keys(row)).toEqual([
      'Pathway', 'Database', 'NES', 'FDR', 'PValue', 'Size', 'LeadingEdgeCount', 'Population',
    ]);
    expect(row).toMatchObject({ Pathway: 'HALLMARK_ADIPOGENESIS', LeadingEdgeCount: 2, Population: 'e9' });
  });

  it('inserts QueryGene before Population for the gene-modal shape', () => {
    const [row] = pathwayInfoRows(pathway, 'e9', { queryGene: 'POMC' });
    expect(Object.keys(row)).toEqual([
      'Pathway', 'Database', 'NES', 'FDR', 'PValue', 'Size', 'LeadingEdgeCount', 'QueryGene', 'Population',
    ]);
    expect(row.QueryGene).toBe('POMC');
  });
});
