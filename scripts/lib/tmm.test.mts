// npx tsx --test scripts/lib/tmm.test.mts
//
// The expected factors were computed with edgeR 4.10.1 under R 4.6.0:
//   calcNormFactors(m, lib.size = colSums(m), method = "TMM")
// on the fixture built identically in R (genes x libraries, one all-zero row).
import assert from 'node:assert/strict';
import test from 'node:test';
import { calcNormFactorsTMM } from './tmm.mjs';

test('TMM factors match edgeR 4.10.1 calcNormFactors on a fixture with ties and a zero row', () => {
  const genes = 40;
  const libs = 5;
  const columns: number[][] = [];
  for (let j = 1; j <= libs; j++) {
    const col: number[] = [];
    for (let i = 1; i <= genes; i++) {
      col.push(((i * 37 + j * 11) % 23) * (1 + (j % 3)) + (i % 7 === 0 ? 0 : i));
    }
    col[4] = 0;
    columns.push(col);
  }
  const libSizes = columns.map((col) => col.reduce((a, b) => a + b, 0));
  const expected = [1.072898696129438, 0.939029623704967, 1.00998627605856, 1.001439030746621, 0.981345652592682];
  const actual = calcNormFactorsTMM(columns, libSizes);
  for (let j = 0; j < libs; j++) {
    assert.ok(Math.abs(actual[j] - expected[j]) < 1e-12, `library ${j + 1}: ${actual[j]} vs ${expected[j]}`);
  }
});

test('identical libraries normalize to 1', () => {
  const col = [5, 0, 12, 7, 3, 99, 1];
  assert.deepEqual(calcNormFactorsTMM([col, [...col], [...col]], [127, 127, 127]), [1, 1, 1]);
});
