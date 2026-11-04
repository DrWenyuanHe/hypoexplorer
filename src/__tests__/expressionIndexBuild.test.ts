import { describe, expect, it } from 'vitest';
import { indexedSourceFromRaw, parseExpressionBundle } from '../../scripts/build_expression_index.mjs';
import { getDataset } from '../data/datasets';
import { EXISTING_EXPRESSION_SOURCES } from '../expression-survey/existingCatalog';
import { expressionIndexBucket, expressionIndexGlobal, expressionIndexKey } from '../expression-survey/expressionIndexFormat';
import type { ExpressionSource, RawTrack } from '../types';

const original = EXISTING_EXPRESSION_SOURCES[0];
const dataset = getDataset(original.datasetId!)!;
function fixture(): { source: ExpressionSource; raw: RawTrack } {
  return {
    source: { ...original, sampleCount: 5, conditions: original.conditions.map((condition, index) => ({ ...condition, sampleCount: index ? 2 : 3 })) },
    raw: {
      meta: { sampleOrder: ['fast', 'fed', 'missing', 'excluded'], groupSamples: { control: ['fed', 'missing', 'absent'], case: ['fast', 'excluded'] }, samplesKept: ['fed', 'fast', 'missing'] },
      cpm: { Exact: [0.12345678901234568, 0, null, 99], AllMissing: [null, null, null, null], lepr: [1, 2, 3, 4], Lepr: [5, 6, 7, 8], 'ENSMUSG00000057722.1': [7, 8, 9, 10], 'Gene.1': [2, 3, 4, 5] },
    },
  };
}

describe('lossless expression index build', () => {
  it('keeps exact values and explicit missing samples in their original group order', () => {
    const { source, raw } = fixture();
    const result = indexedSourceFromRaw(source, raw, dataset);
    expect(result.source.groups.map((group) => group.sampleIds)).toEqual([['fed', 'missing', 'absent'], ['fast', 'excluded']]);
    expect(result.entries.find(([key]) => key === 'EXACT')?.[1]).toEqual([0, 'Exact', [0, null, null, 0.12345678901234568, null]]);
    expect(result.entries.find(([key]) => key === 'ALLMISSING')?.[1][2]).toEqual([null, null, null, null, null]);
  });

  it('preserves candidate insertion order and explicit Ensembl identity without symbol suffix guessing', () => {
    const { source, raw } = fixture();
    const result = indexedSourceFromRaw(source, raw, dataset);
    expect(result.entries.filter(([key]) => key === 'LEPR').map(([, row]) => row[1])).toEqual(['lepr', 'Lepr']);
    expect(result.ambiguousSourceKeys).toBe(1);
    expect(result.entries.find(([key]) => key === 'ENSMUSG00000057722')?.[1][1]).toBe('ENSMUSG00000057722.1');
    expect(result.entries.some(([key]) => key === 'GENE.1')).toBe(true);
    expect(result.entries.some(([key]) => key === 'GENE')).toBe(false);
  });

  it('rejects changed source units and sample-count or overlapping-group drift', () => {
    const { source, raw } = fixture();
    expect(() => indexedSourceFromRaw({ ...source, unit: 'TPM' }, raw, dataset)).toThrow('Expression unit changed');
    expect(() => indexedSourceFromRaw({ ...source, sampleCount: 6 }, raw, dataset)).toThrow('Catalog source count drift');
    raw.meta!.groupSamples!.case = ['fed', 'excluded'];
    expect(() => indexedSourceFromRaw(source, raw, dataset)).toThrow('Overlapping source conditions');
  });

  it('parses a single JSON assignment without evaluating arbitrary source code', () => {
    expect(parseExpressionBundle('var HX_TRACK = {"cpm":{"Lepr":[0.12345678901234568]}};\n').cpm.Lepr[0]).toBe(0.12345678901234568);
    expect(() => parseExpressionBundle('var HX_TRACK = {}; throw new Error("executed");')).toThrow();
  });

  it('normalizes the source key before stable hashing and isolates globals by data build', () => {
    expect(expressionIndexKey(' ensmusg00000057722.8 ')).toBe('ENSMUSG00000057722');
    expect(expressionIndexKey('Gene.1')).toBe('GENE.1');
    expect(expressionIndexBucket('LEPR')).toBe(340);
    expect(expressionIndexGlobal('a'.repeat(64), 358)).not.toBe(expressionIndexGlobal('b'.repeat(64), 358));
  });
});
