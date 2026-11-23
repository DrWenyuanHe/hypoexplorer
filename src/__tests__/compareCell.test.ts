import { describe, it, expect } from 'vitest';
import { compareCell, type CompareCell } from '../compare/compareCell';
import { tallyGene } from '../compare/compareSummary';
import { makePopData, MACAQUE_DATASET } from './fixtures';
import type { CompareColumn } from '../compare/compareColumns';
import type { PopData } from '../types';

// The fixture's per-sample values: S1,S2 Normal and S3,S4 Obese.
// POMC = 10, 20 | 30, 40; AGRP = 5, (missing) | 15, 25.
const pop = (overrides: Partial<PopData> = {}) => makePopData({ dataset: MACAQUE_DATASET, ...overrides });
const column = (key: string, unavailable?: CompareColumn['unavailable']): CompareColumn => ({
  key, label: key, color: '#000', qc: null, unavailable,
});

// A study whose cpm matrix carries LEP but whose DE table does not: the gene
// was not tested there, so it is not detected however the matrix spells it.
const untested = pop({ cpm: { POMC: [10, 20, 30, 40], LEP: [1, 2, 3, 4] } });
// A mouse study: same values, mouse spelling.
const mouse = pop({
  de: [{ gene: 'Pomc', logFC: -0.5, PValue: 0.2, FDR: 0.6 }],
  cpm: { Pomc: [10, 20, 30, 40] },
});

const popDataMap: Record<string, PopData | null> = {
  ready: pop(), loading: pop(), absent: null, untested, mouse, bare: pop({ contrast: null }),
};

/** The cell reduced to what a reader of it can see. */
function summarize(cell: CompareCell) {
  if (cell.kind === 'unavailable') return { kind: cell.kind, status: cell.status, message: cell.message };
  if (cell.kind === 'not-detected') return { kind: cell.kind };
  return {
    kind: cell.kind,
    gene: cell.gene,
    logFC: cell.de.logFC,
    arms: cell.arms.map((a) => ({
      label: a.label, samples: a.samples.map((s) => s.id), n: a.n, mean: a.mean, sem: a.sem,
    })),
  };
}

describe('compareCell', () => {
  it.each<[string, CompareColumn, string, ReturnType<typeof summarize>]>([
    ['a flagged column is unavailable even when popData is present',
      column('loading', { status: 'loading', message: 'Loading…' }), 'POMC',
      { kind: 'unavailable', status: 'loading', message: 'Loading…' }],
    ['a column with no popData is unavailable, never "not detected"',
      column('absent'), 'POMC',
      { kind: 'unavailable', status: 'failed', message: 'No data loaded for this column' }],
    ['a gene missing from the DE table is not detected',
      column('ready'), 'NOT_A_GENE', { kind: 'not-detected' }],
    ['cpm values without a DE row do not make a gene detected',
      column('untested'), 'LEP', { kind: 'not-detected' }],
    ['a dropped sample leaves a single-value arm with a mean and no SEM',
      column('ready'), 'AGRP',
      { kind: 'measured', gene: 'AGRP', logFC: -0.8, arms: [
        { label: 'Normal', samples: ['S1'], n: 1, mean: 5, sem: null },
        { label: 'Obese', samples: ['S3', 'S4'], n: 2, mean: 20, sem: 5 },
      ] }],
    ['a measured gene carries each arm\'s n, mean and SEM',
      column('ready'), 'POMC',
      { kind: 'measured', gene: 'POMC', logFC: 1.5, arms: [
        { label: 'Normal', samples: ['S1', 'S2'], n: 2, mean: 15, sem: 5 },
        { label: 'Obese', samples: ['S3', 'S4'], n: 2, mean: 35, sem: 5 },
      ] }],
    ['a column answers in its own spelling of the gene',
      column('mouse'), 'POMC',
      { kind: 'measured', gene: 'Pomc', logFC: -0.5, arms: [
        { label: 'Normal', samples: ['S1', 'S2'], n: 2, mean: 15, sem: 5 },
        { label: 'Obese', samples: ['S3', 'S4'], n: 2, mean: 35, sem: 5 },
      ] }],
    ['a column with no contrast is measured with no arms',
      column('bare'), 'POMC', { kind: 'measured', gene: 'POMC', logFC: 1.5, arms: [] }],
  ])('%s', (_, col, gene, expected) => {
    expect(summarize(compareCell(col, popDataMap, gene))).toEqual(expected);
  });
});

describe('tallyGene', () => {
  it('counts detected and FDR calls over the cells that have data', () => {
    const cols = [column('ready'), column('mouse'), column('untested'), column('absent'),
      column('loading', { status: 'loading', message: 'Loading…' })];
    const cells = cols.map((c) => compareCell(c, popDataMap, 'POMC'));
    // ready and untested call POMC up at FDR 0.01; mouse detects Pomc at FDR 0.6;
    // the two unavailable columns are not in the denominator at all.
    expect(tallyGene(cells)).toEqual({ ready: 3, detected: 3, sig: 2, up: 2, down: 0 });
    const agrp = cols.map((c) => compareCell(c, popDataMap, 'AGRP'));
    expect(tallyGene(agrp)).toEqual({ ready: 3, detected: 2, sig: 0, up: 0, down: 0 });
  });
});
