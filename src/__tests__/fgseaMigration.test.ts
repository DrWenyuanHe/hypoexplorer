import { describe, expect, it } from 'vitest';
import { compareFgseaRows } from '../../scripts/lib/fgseaMigration.mjs';

const row = (pathway: string, NES: string, padj: string, size = '20', leadingEdge = 'A;B') => ({
  pathway, pval: padj, padj, NES, size, leadingEdge,
});

describe('compareFgseaRows', () => {
  it('compares complete universes and records additions, removals, FDR changes, and reversals', () => {
    const result = compareFgseaRows(
      [row('shared', '1', '0.01'), row('removed', '2', '0.02')],
      [row('shared', '-1.5', '0.2', '30', 'A;C'), row('added', '2', '0.01')],
    );
    expect(result).toMatchObject({
      previousRows: 2, currentRows: 2, addedRows: 1, removedRows: 1, sharedRows: 1,
      changedSharedRows: 1, pathwaySizesChanged: 1, leadingEdgesChanged: 1,
      nesDirectionChanges: 1, maxAbsNesDelta: 2.5, medianAbsNesDelta: 2.5,
      fdrCallsBefore: 2, fdrCallsAfter: 1, fdrCallsShared: 0, fdrCallsGained: 1, fdrCallsLost: 2,
      fdrCallJaccard: 0, addedPathways: ['added'], removedPathways: ['removed'],
      gainedFdrCalls: ['added'], lostFdrCalls: ['removed', 'shared'], directionChangedPathways: ['shared'],
    });
  });

  it('does not turn missing probabilities into significant zeroes or missing NES into reversals', () => {
    const result = compareFgseaRows([row('a', 'NA', '')], [row('a', '1', 'NA')]);
    expect(result).toMatchObject({
      fdrCallsBefore: 0, fdrCallsAfter: 0, fdrCallJaccard: 1,
      nesDirectionChanges: 0, maxAbsNesDelta: null, medianAbsNesDelta: null,
      nonFiniteRowsBefore: 1, nonFiniteRowsAfter: 1,
      nonFinitePathwaysBefore: ['a'], nonFinitePathwaysAfter: ['a'],
    });
  });

  it('records a probability-floor result separately from untestable rows', () => {
    const result = compareFgseaRows([], [row('floor', '-2.8', '1e-50'), row('missing', 'NA', 'NA')]);
    expect(result.pvalueAtDefaultFloorPathwaysAfter).toEqual(['floor']);
    expect(result.nonFinitePathwaysAfter).toEqual(['missing']);
    expect(result.fdrCallsAfter).toBe(1);
  });

  it('compares leading-edge membership independently of order and rejects duplicate pathway ids', () => {
    expect(compareFgseaRows([row('a', '1', '0.2')], [row('a', '1', '0.2', '20', 'B;A')]).leadingEdgesChanged).toBe(0);
    expect(() => compareFgseaRows([row('a', '1', '0.2'), row('a', '1', '0.2')], [])).toThrow(/unique/);
  });
});
