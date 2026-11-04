import { describe, it, expect } from 'vitest';
import {
  columnsForGroups,
  displayUnit,
  unitProvenance,
  getGroupColumns,
  getGroupedValues,
  getRawSampleRows,
  getValuesForGroups,
  groupLabels,
  sampleAxis,
  valueColumnName,
  meanColumnLabel,
} from '../utils/sampleValues';
import type { Group, PopData, ResolvedContrast } from '../types';
import { makePopData } from './fixtures';

// The sample-value seam. getGroupColumns is the indexing primitive (group →
// sampleId → index in sampleOrder); getGroupedValues (charts) and
// getRawSampleRows (exports) both build on it. None of them assume 6 samples or
// a positional 3+3 split; null/missing values are dropped in exactly one place.

// A minimal contrast object (full group objects, as getActiveContrast returns).
const contrast = (baseKey: string, baseLabel: string, caseKey: string, caseLabel: string) => ({
  id: `${caseKey}_vs_${baseKey}`,
  baseline: { key: baseKey, label: baseLabel, color: '#3775BA' },
  caseGroup: { key: caseKey, label: caseLabel, color: '#B64342' },
}) as unknown as ResolvedContrast;

describe('getGroupColumns (indexing primitive)', () => {
  it('maps each group to its samples and their index in sampleOrder', () => {
    const popData = makePopData({
      sampleOrder: ['A', 'B', 'C', 'D'],
      groupSamples: { g1: ['A', 'C'], g2: ['B', 'D'] },
      cpm: {},
    });
    const cols = getGroupColumns(popData, contrast('g1', 'G1', 'g2', 'G2'));
    expect(cols.map(c => c.key)).toEqual(['g1', 'g2']);
    expect(cols[0]).toMatchObject({ key: 'g1', label: 'G1', color: '#3775BA' });
    expect(cols[0].samples).toEqual([{ id: 'A', index: 0 }, { id: 'C', index: 2 }]);
    expect(cols[1].samples).toEqual([{ id: 'B', index: 1 }, { id: 'D', index: 3 }]);
  });

  it('marks a sample absent from sampleOrder with index -1 (drop is left to value reads)', () => {
    const popData = makePopData({ sampleOrder: ['S1', 'S2'], groupSamples: { normal: ['S1', 'GHOST'], obese: ['S2'] }, cpm: {} });
    const [base] = getGroupColumns(popData, contrast('normal', 'Normal', 'obese', 'Obese'));
    expect(base.samples).toEqual([{ id: 'S1', index: 0 }, { id: 'GHOST', index: -1 }]);
  });

  it('falls back to popData.contrast when no contrast arg is given, [] for null', () => {
    const popData = makePopData({
      contrast: contrast('chow', 'Chow', 'hfd', 'HFD'),
      sampleOrder: ['c', 'h'], groupSamples: { chow: ['c'], hfd: ['h'] }, cpm: {},
    });
    expect(getGroupColumns(popData).map(c => c.label)).toEqual(['Chow', 'HFD']);
    expect(getGroupColumns(null)).toEqual([]);
    expect(getGroupColumns({ cpm: {} } as unknown as PopData, null)).toEqual([]);
  });
});

// The axis-shaped reader: the whole sample axis, not just the two arms. It
// exists for views that render EVERY column (the leading-edge heatmap), where a
// sample belonging to neither arm is a rendered grey column, not a dropped one.
describe('sampleAxis (axis-shaped reader)', () => {
  it('returns one slot per sampleOrder entry, in order, indexed by position', () => {
    const popData = makePopData({
      sampleOrder: ['A', 'B', 'C', 'D'],
      groupSamples: { g1: ['A', 'C'], g2: ['B', 'D'] },
      cpm: {},
    });
    const axis = sampleAxis(popData, contrast('g1', 'G1', 'g2', 'G2'));
    expect(axis.map(s => s.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(axis.map(s => s.index)).toEqual([0, 1, 2, 3]);
  });

  it('tags each slot with the arm that claims it (membership, not position)', () => {
    const popData = makePopData({
      sampleOrder: ['A', 'B', 'C', 'D'],
      groupSamples: { g1: ['A', 'C'], g2: ['B', 'D'] },
      cpm: {},
    });
    const axis = sampleAxis(popData, contrast('g1', 'G1', 'g2', 'G2'));
    expect(axis.map(s => s.group?.key ?? null)).toEqual(['g1', 'g2', 'g1', 'g2']);
    expect(axis[0].group).toEqual({ key: 'g1', label: 'G1', color: '#3775BA' });
    expect(axis[1].group).toEqual({ key: 'g2', label: 'G2', color: '#B64342' });
  });

  it('tags a sample in NEITHER arm null, and still gives it a slot', () => {
    const popData = makePopData({
      sampleOrder: ['c1', 'c2', 'x9', 'h1'],
      groupSamples: { chow: ['c1', 'c2'], hfd: ['h1'] }, // x9 in neither
      cpm: {},
    });
    const axis = sampleAxis(popData, contrast('chow', 'Chow', 'hfd', 'HFD'));
    expect(axis).toHaveLength(4);
    expect(axis[2]).toEqual({ id: 'x9', index: 2, group: null });
  });

  it('tags every slot null when groupSamples is empty — the axis is unchanged', () => {
    const popData = makePopData({ sampleOrder: ['S1', 'S2'], groupSamples: {}, cpm: {} });
    const axis = sampleAxis(popData, contrast('normal', 'Normal', 'obese', 'Obese'));
    expect(axis).toEqual([
      { id: 'S1', index: 0, group: null },
      { id: 'S2', index: 1, group: null },
    ]);
  });

  it('drops nothing for a ghost group member (an id absent from sampleOrder)', () => {
    const popData = makePopData({
      sampleOrder: ['S1', 'S2'],
      groupSamples: { normal: ['S1', 'GHOST'], obese: ['S2'] },
      cpm: {},
    });
    // GHOST has no sampleOrder slot to tag, so it simply never appears; the
    // index<0 rule stays in getGroupColumns/valueAt.
    expect(sampleAxis(popData, contrast('normal', 'Normal', 'obese', 'Obese'))).toEqual([
      { id: 'S1', index: 0, group: { key: 'normal', label: 'Normal', color: '#3775BA' } },
      { id: 'S2', index: 1, group: { key: 'obese', label: 'Obese', color: '#B64342' } },
    ]);
  });

  it('resolves the baseline arm first when a sample is listed in both', () => {
    const popData = makePopData({
      sampleOrder: ['S1'],
      groupSamples: { normal: ['S1'], obese: ['S1'] },
      cpm: {},
    });
    const [slot] = sampleAxis(popData, contrast('normal', 'Normal', 'obese', 'Obese'));
    expect(slot.group?.key).toBe('normal');
  });

  it('falls back to popData.contrast, and keeps the full axis with a null contrast', () => {
    const popData = makePopData({
      contrast: contrast('chow', 'Chow', 'hfd', 'HFD'),
      sampleOrder: ['c', 'h'], groupSamples: { chow: ['c'], hfd: ['h'] }, cpm: {},
    });
    expect(sampleAxis(popData).map(s => s.group?.label ?? null)).toEqual(['Chow', 'HFD']);
    // A null argument falls back to popData.contrast, exactly as getGroupColumns
    // does — the axis reader mirrors the primitive rather than second-guessing it.
    expect(sampleAxis(popData, null).map(s => s.group?.label ?? null)).toEqual(['Chow', 'HFD']);
  });

  it('keeps the full axis when nothing resolves the arms (null contrast)', () => {
    const popData = makePopData({
      contrast: null,
      sampleOrder: ['c', 'h'], groupSamples: { chow: ['c'], hfd: ['h'] }, cpm: {},
    });
    // No arms to tag with, but the axis itself is still the axis.
    expect(sampleAxis(popData)).toEqual([
      { id: 'c', index: 0, group: null },
      { id: 'h', index: 1, group: null },
    ]);
  });

  it('returns [] for null popData or an empty sampleOrder', () => {
    expect(sampleAxis(null)).toEqual([]);
    expect(sampleAxis(makePopData({ sampleOrder: [], groupSamples: {}, cpm: {} }))).toEqual([]);
  });
});

describe('getGroupedValues', () => {
  it('3+3 macaque-style split returns baseline then caseGroup with correct values', () => {
    const popData = makePopData({
      sampleOrder: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
      groupSamples: { normal: ['S1', 'S2', 'S3'], obese: ['S4', 'S5', 'S6'] },
      cpm: { GENE: [10, 12, 11, 25, 28, 30] },
    });
    const [base, cs] = getGroupedValues(popData, 'GENE', contrast('normal', 'Normal', 'obese', 'Obese'));
    expect(base.key).toBe('normal');
    expect(base.label).toBe('Normal');
    expect(base.values).toEqual([10, 12, 11]);
    expect(base.n).toBe(3);
    expect(cs.key).toBe('obese');
    expect(cs.values).toEqual([25, 28, 30]);
    expect(cs.n).toBe(3);
  });

  it('5+5 bulk-style split reads all ten samples', () => {
    const order = ['C1', 'C2', 'C3', 'C4', 'C5', 'H1', 'H2', 'H3', 'H4', 'H5'];
    const popData = makePopData({
      sampleOrder: order,
      groupSamples: { chow: order.slice(0, 5), hfd: order.slice(5, 10) },
      cpm: { LEP: [4, 5, 4, 6, 5, 12, 14, 13, 15, 11] },
    });
    const [chow, hfd] = getGroupedValues(popData, 'LEP', contrast('chow', 'Chow', 'hfd', 'HFD'));
    expect(chow.values).toEqual([4, 5, 4, 6, 5]);
    expect(chow.n).toBe(5);
    expect(hfd.values).toEqual([12, 14, 13, 15, 11]);
    expect(hfd.n).toBe(5);
  });

  it('2v3 (dropped sample) drops the null and reports n=2 for that group only', () => {
    const popData = makePopData({
      sampleOrder: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
      groupSamples: { normal: ['S1', 'S2', 'S3'], obese: ['S4', 'S5', 'S6'] },
      cpm: { GENE: [null, 5, 5, 10, 10, 10] },
    });
    const [base, cs] = getGroupedValues(popData, 'GENE', contrast('normal', 'Normal', 'obese', 'Obese'));
    expect(base.values).toEqual([5, 5]); // null dropped
    expect(base.n).toBe(2);
    expect(cs.values).toEqual([10, 10, 10]);
    expect(cs.n).toBe(3);
  });

  it('missing feature yields empty value arrays and n=0 per group (no throw)', () => {
    const popData = makePopData({
      sampleOrder: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
      groupSamples: { normal: ['S1', 'S2', 'S3'], obese: ['S4', 'S5', 'S6'] },
      cpm: { OTHER: [1, 2, 3, 4, 5, 6] },
    });
    const [base, cs] = getGroupedValues(popData, 'ABSENT', contrast('normal', 'Normal', 'obese', 'Obese'));
    expect(base.values).toEqual([]);
    expect(base.n).toBe(0);
    expect(cs.values).toEqual([]);
    expect(cs.n).toBe(0);
  });

  it('uses real sample ids → sampleOrder index mapping, not positional order', () => {
    const popData = makePopData({
      sampleOrder: ['A', 'B', 'C', 'D'],
      groupSamples: { g1: ['A', 'C'], g2: ['B', 'D'] },
      cpm: { GENE: [100, 200, 300, 400] },
    });
    const [g1, g2] = getGroupedValues(popData, 'GENE', contrast('g1', 'G1', 'g2', 'G2'));
    expect(g1.values).toEqual([100, 300]); // A=idx0, C=idx2
    expect(g2.values).toEqual([200, 400]); // B=idx1, D=idx3
  });

  it('drops a sample id that is absent from sampleOrder', () => {
    const popData = makePopData({
      sampleOrder: ['S1', 'S2'],
      groupSamples: { normal: ['S1', 'GHOST'], obese: ['S2'] },
      cpm: { GENE: [7, 9] },
    });
    const [base, cs] = getGroupedValues(popData, 'GENE', contrast('normal', 'Normal', 'obese', 'Obese'));
    expect(base.values).toEqual([7]); // GHOST has no index → dropped
    expect(base.n).toBe(1);
    expect(cs.values).toEqual([9]);
  });

  it('returns [] for null popData or null contrast', () => {
    expect(getGroupedValues(null, 'GENE', contrast('a', 'A', 'b', 'B'))).toEqual([]);
    expect(getGroupedValues({ cpm: {}, sampleOrder: [], groupSamples: {} } as unknown as PopData, 'GENE', null)).toEqual([]);
  });

  it('handles an empty baseline group (single non-empty group still resolves)', () => {
    const popData = makePopData({
      sampleOrder: ['S1', 'S2', 'S3'],
      groupSamples: { normal: [], obese: ['S1', 'S2', 'S3'] },
      cpm: { GENE: [3, 4, 5] },
    });
    const [base, cs] = getGroupedValues(popData, 'GENE', contrast('normal', 'Normal', 'obese', 'Obese'));
    expect(base.values).toEqual([]);
    expect(base.n).toBe(0);
    expect(cs.values).toEqual([3, 4, 5]);
    expect(cs.n).toBe(3);
  });
});

describe('getRawSampleRows', () => {
  const popData = makePopData({
    contrast: contrast('normal', 'Normal', 'obese', 'Obese'),
    sampleOrder: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
    groupSamples: { normal: ['S1', 'S2', 'S3'], obese: ['S4', 'S5', 'S6'] },
    cpm: { A: [1, 2, 3, 4, 5, 6], B: [null, 8, 8, 9, 9, 9] },
  });

  it('emits one tidy row per (feature, present sample) with neutral keys', () => {
    const rows = getRawSampleRows(popData, ['A']);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({ gene: 'A', sample: 'S1', condition: 'Normal', value: 1 });
    expect(rows[3]).toEqual({ gene: 'A', sample: 'S4', condition: 'Obese', value: 4 });
  });

  it('drops samples whose value is null and spans multiple features', () => {
    const rows = getRawSampleRows(popData, ['A', 'B']);
    // A: 6 rows, B: 5 rows (S1 null dropped) → 11
    expect(rows).toHaveLength(11);
    expect(rows.filter(r => r.gene === 'B').map(r => r.sample)).toEqual(['S2', 'S3', 'S4', 'S5', 'S6']);
  });

  it('drops a ghost sample (a groupSamples id absent from sampleOrder)', () => {
    const pd = makePopData({
      contrast: contrast('n', 'Normal', 'o', 'Obese'),
      sampleOrder: ['S1', 'S2'],
      groupSamples: { n: ['S1', 'GHOST'], o: ['S2'] },
      cpm: { A: [1, 2] },
    });
    // GHOST has index -1 in sampleOrder → valueAt returns null → row dropped.
    expect(getRawSampleRows(pd, ['A']).map(r => r.sample)).toEqual(['S1', 'S2']);
  });
});

describe('valueColumnName / meanColumnLabel (unit-aware export headers)', () => {
  it('CPM datasets keep the historical macaque headers', () => {
    const pd = { expressionUnit: 'CPM' } as unknown as PopData;
    expect(valueColumnName(pd)).toBe('NormCPM');
    expect(meanColumnLabel(pd, 'Normal')).toBe('MeanNormalCPM');
  });
  it('defaults to TMM-normalized CPM when expressionUnit is absent', () => {
    // Since the R 4.6.0 regeneration an absent unit means TMM-normalized CPM
    // (rule C2, data/quality/regeneration-r460-2026-09-25/README.md).
    expect(valueColumnName({} as unknown as PopData)).toBe('CPM (TMM-normalized)');
    expect(meanColumnLabel({} as unknown as PopData, 'Obese')).toBe('MeanObese CPM (TMM-normalized)');
  });
  it('log2-normalized datasets get honest, distinct headers', () => {
    const pd = { expressionUnit: 'log2-normalized' } as unknown as PopData;
    expect(valueColumnName(pd)).toBe('Log2NormExpr');
    expect(meanColumnLabel(pd, 'Chow')).toBe('MeanChowLog2');
  });
  it('an unrecognized expressionUnit gets neutral NormValue / Value headers', () => {
    // A future unit (e.g. miRNA 'rpm') must not be mislabelled CPM — it falls
    // through to the neutral header rather than a wrong one.
    const pd = { expressionUnit: 'rpm' } as unknown as PopData;
    expect(valueColumnName(pd)).toBe('NormValue');
    expect(meanColumnLabel(pd, 'HFD')).toBe('MeanHFDValue');
  });
});

// The group-label seam. Five views used to hand-spell these fallbacks in three
// vocabularies ('Obese'/'Normal', 'Normal'/'Obese', 'Baseline'/'Case'), so a
// null contrast on a mouse dataset could render macaque labels on-screen and
// inside a downloaded workbook.
describe('groupLabels (group-label fallback seam)', () => {
  it('reads the resolved contrast’s own arm labels, unchanged', () => {
    const c = contrast('chow', 'Chow', 'hfd', 'HFD');
    expect(groupLabels(c)).toEqual({ baselineLabel: 'Chow', caseLabel: 'HFD' });
  });
  it('null/undefined contrast degrades to NEUTRAL labels — never macaque vocabulary', () => {
    expect(groupLabels(null)).toEqual({ baselineLabel: 'Baseline', caseLabel: 'Case' });
    expect(groupLabels(undefined)).toEqual({ baselineLabel: 'Baseline', caseLabel: 'Case' });
  });
});

describe('displayUnit (on-screen unit token)', () => {
  it('shows CPM for CPM datasets and TMM-normalized CPM when the unit is absent', () => {
    expect(displayUnit({ expressionUnit: 'CPM' } as unknown as PopData)).toBe('CPM');
    // Since the R 4.6.0 regeneration an absent unit means TMM-normalized CPM
    // (rule C2, data/quality/regeneration-r460-2026-09-25/README.md).
    expect(displayUnit({} as unknown as PopData)).toBe('CPM (TMM-normalized)');
    expect(displayUnit(null)).toBe('CPM (TMM-normalized)');
  });
  it('shortens log2-normalized to log2', () => {
    expect(displayUnit({ expressionUnit: 'log2-normalized' } as unknown as PopData)).toBe('log2');
  });
  it('shows an unknown unit verbatim, never mislabelled CPM', () => {
    expect(displayUnit({ expressionUnit: 'rpm' } as unknown as PopData)).toBe('rpm');
  });
});

// The hover text behind every unit token. It is the app's answer to "why CPM and
// not TPM?", so the load-bearing claim (these values are NOT gene-length
// normalized) must survive any future rewording of the sentence around it.
describe('unitProvenance (unit hover text)', () => {
  it('states the CPM formula and that it is not gene-length normalized', () => {
    const t = unitProvenance({ expressionUnit: 'CPM' });
    expect(t).toContain('counts per million');
    expect(t).toContain('NOT gene-length normalized');
    expect(t).toContain('TPM');
  });
  it('defaults to the TMM-normalized CPM explanation when the unit is absent', () => {
    // Since the R 4.6.0 regeneration an absent unit means TMM-normalized CPM
    // (rule C2, data/quality/regeneration-r460-2026-09-25/README.md).
    const tmm = unitProvenance({ expressionUnit: 'CPM (TMM-normalized)' });
    expect(tmm).toContain('TMM');
    expect(tmm).toContain('Not gene-length normalized');
    expect(unitProvenance({})).toBe(tmm);
    expect(unitProvenance(null)).toBe(tmm);
  });
  it('explains log2-normalized as the submitters’ own scale, not CPM', () => {
    const t = unitProvenance({ expressionUnit: 'log2-normalized' });
    expect(t).toContain('log2-normalized');
    expect(t).toContain('shown unchanged');
    expect(t).not.toContain('counts per million');
    // GSE220533 was deposited already logged; the tooltip claims nothing about
    // gene-length normalization it cannot know.
    expect(t).not.toMatch(/gene-length/);
  });
  it('explains a log2(<base> + <offset>) unit by its base and pseudocount', () => {
    const fpkm = unitProvenance({ expressionUnit: 'log2(FPKM + 1)' });
    expect(fpkm).toContain('log2 of (FPKM + 1). Adding 1 keeps zeros finite');
    expect(fpkm).toContain('gene-length correction');
    const cpm = unitProvenance({ expressionUnit: 'log2(normalized CPM + 1)' });
    expect(cpm).toContain('normalized CPM');
    expect(cpm).toContain('not gene-length normalized');
    expect(unitProvenance({ expressionUnit: 'log2(DESeq2-normalized count + 1)' })).not.toMatch(/gene-length/);
  });
  it('names an unknown unit verbatim rather than describing it as CPM', () => {
    const t = unitProvenance({ expressionUnit: 'rpm' });
    expect(t).toContain('rpm');
    expect(t).not.toContain('counts per million');
  });
  it('accepts a Dataset-shaped source, not just PopData', () => {
    const dataset = { id: 'x', expressionUnit: 'CPM' };
    expect(unitProvenance(dataset)).toContain('counts per million');
  });
});

// ── The multi-group seam ─────────────────────────────────────────────────────
// A factorial dataset's chart draws MORE groups than any one contrast names, so
// the same indexing primitive has to answer for an explicit group list. These
// pin the two properties that matter: the order is the caller's, and a group the
// track does not carry renders empty rather than borrowing another's samples.

const CELLS: Group[] = [
  { key: 'chow_p0', label: 'Chow · P0', color: '#6FA1DC' },
  { key: 'hfd_p0', label: 'HFD · P0', color: '#D98886' },
  { key: 'chow_p21', label: 'Chow · P21', color: '#25537F' },
  { key: 'hfd_p21', label: 'HFD · P21', color: '#8A2F2E' },
];

const factorialPop = () => makePopData({
  sampleOrder: ['C0a', 'C0b', 'H0a', 'C21a', 'H21a', 'H21b'],
  groupSamples: {
    chow_p0: ['C0a', 'C0b'],
    hfd_p0: ['H0a'],
    chow_p21: ['C21a'],
    hfd_p21: ['H21a', 'H21b'],
    // The pooled arms overlap the cells; nothing below may draw them.
    control: ['C0a', 'C0b', 'C21a'],
    case: ['H0a', 'H21a', 'H21b'],
  },
  cpm: { Timp1: [1, 3, 10, 5, 20, 22] },
});

describe('columnsForGroups / getValuesForGroups (explicit group list)', () => {
  it('resolves four design cells in the order given, each with its own samples', () => {
    const cols = columnsForGroups(factorialPop(), CELLS);
    expect(cols.map((c) => c.key)).toEqual(['chow_p0', 'hfd_p0', 'chow_p21', 'hfd_p21']);
    expect(cols[0].samples).toEqual([{ id: 'C0a', index: 0 }, { id: 'C0b', index: 1 }]);
    expect(cols[3].samples).toEqual([{ id: 'H21a', index: 4 }, { id: 'H21b', index: 5 }]);
  });

  it('reads each cell\'s values and n independently of the active contrast', () => {
    const vals = getValuesForGroups(factorialPop(), 'Timp1', CELLS);
    expect(vals.map((v) => v.label)).toEqual(['Chow · P0', 'HFD · P0', 'Chow · P21', 'HFD · P21']);
    expect(vals.map((v) => v.values)).toEqual([[1, 3], [10], [5], [20, 22]]);
    expect(vals.map((v) => v.n)).toEqual([2, 1, 1, 2]);
  });

  it('renders a group the track does not carry as empty, shifting nobody', () => {
    const vals = getValuesForGroups(factorialPop(), 'Timp1', [
      CELLS[0], { key: 'not_a_group', label: 'Absent', color: '#000' },
    ]);
    expect(vals.map((v) => v.values)).toEqual([[1, 3], []]);
  });

  it('returns [] for no groups rather than falling back to the contrast', () => {
    expect(getValuesForGroups(factorialPop(), 'Timp1', [])).toEqual([]);
    expect(columnsForGroups(factorialPop(), null)).toEqual([]);
  });

  it('widens the export rows to every cell when groups are supplied', () => {
    const rows = getRawSampleRows(factorialPop(), ['Timp1'], CELLS);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.condition)).toEqual([
      'Chow · P0', 'Chow · P0', 'HFD · P0', 'Chow · P21', 'HFD · P21', 'HFD · P21',
    ]);
    // Without groups the scope is unchanged: this fixture names no contrast arm.
    expect(getRawSampleRows(factorialPop(), ['Timp1'])).toHaveLength(0);
  });
});
