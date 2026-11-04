import { describe, expect, it } from 'vitest';
import {
  compositionTables, deTable, fgseaTable, qcKpis, qcVocabulary, reportTable, runTable, sizeTable,
  visibleQcSections,
} from '../qc/qcTables';
import type {
  QcComposition, QcDeSummaryRecord, QcRunStatusRecord, QcSection, QcTableSpec, QcVocabulary,
} from '../qc/qcTables';
import type { Dataset, DatasetMeta, QcGlobal, ResolvedContrast } from '../types';

function makeMeta(overrides: Partial<DatasetMeta> = {}): DatasetMeta {
  return {
    populations: [],
    labels: {},
    types: {},
    nGenes: {},
    colors: {},
    qcFlags: {},
    ...overrides,
  };
}

function columnLabels<Row>(spec: QcTableSpec<Row>): string[] {
  return spec.columns.map((column) => column.label);
}

const legacyVocabulary: QcVocabulary = qcVocabulary(null, null);

describe('qcVocabulary', () => {
  it('uses resolved contrast arms verbatim', () => {
    const contrast: ResolvedContrast = {
      id: 'hfd-vs-chow',
      baseline: { key: 'chow', label: 'Chow', color: '#123456' },
      caseGroup: { key: 'hfd', label: 'HFD', color: '#654321' },
      supportsPathways: true,
      label: 'HFD vs Chow',
    };
    const v = qcVocabulary(null, contrast);
    expect(v.baseLabel).toBe('Chow');
    expect(v.caseLabel).toBe('HFD');
    expect(v.sampleGroups[0]).toBe(contrast.baseline);
    expect(v.sampleGroups[1]).toBe(contrast.caseGroup);
  });

  it('keeps the legacy arm keys/colors but neutral fallback labels', () => {
    expect(legacyVocabulary).toMatchObject({
      baseLabel: 'Baseline',
      caseLabel: 'Case',
      trackNoun: 'population',
      trackNounPlural: 'populations',
      trackNounCap: 'Population',
      supportsPathways: true,
      hasDataset: false,
      sampleGroups: [
        { key: 'normal', label: 'Baseline', color: '#3775BA' },
        { key: 'obese', label: 'Case', color: '#B64342' },
      ],
    });
  });

  it('reads noun and pathway support from a dataset', () => {
    const dataset = { trackNoun: 'track', supportsPathways: false } as Dataset;
    expect(qcVocabulary(dataset, null)).toMatchObject({
      trackNoun: 'track',
      trackNounPlural: 'tracks',
      trackNounCap: 'Track',
      supportsPathways: false,
      hasDataset: true,
    });
  });
});

describe('runTable', () => {
  it('maps rows with the original label/message fallbacks', () => {
    const runStatus: QcRunStatusRecord[] = [
      { cluster: 'a', status: 'ok', elapsed_sec: null, message: null },
      { cluster: 'b', status: null, elapsed_sec: 0, message: '' },
    ];
    const spec = runTable(
      { runStatus },
      makeMeta({ labels: { a: '', b: 'Beta' } }),
      legacyVocabulary,
    );
    expect(spec.rows).toEqual([
      { _key: 'a', cluster: 'a', label: 'a', status: 'ok', elapsed: null, message: '' },
      { _key: 'b', cluster: 'b', label: 'Beta', status: null, elapsed: 0, message: '' },
    ]);
  });

  it('shows elapsed/message only when any source row records them', () => {
    const empty = runTable(
      { runStatus: [{ cluster: 'a', elapsed_sec: null, message: null }] },
      makeMeta(),
      legacyVocabulary,
    );
    expect(columnLabels(empty)).toEqual(['Population', 'Label', 'Status']);

    const populated = runTable(
      { runStatus: [{ cluster: 'a', elapsed_sec: 12, message: 'low cells' }] },
      makeMeta(),
      legacyVocabulary,
    );
    expect(columnLabels(populated)).toEqual(['Population', 'Label', 'Status', 'Elapsed (s)', 'Message']);
    expect(populated.columns.find((column) => column.key === 'message')?.sortable).toBe(false);
  });
});

describe('sizeTable', () => {
  it('maps populations and preserves column sort contracts', () => {
    const spec = sizeTable(makeMeta({
      populations: ['full', 'low', 'unknown'],
      labels: { full: '', low: 'Low' },
      qcFlags: {
        full: { nNormal: 3, nObese: 3, is3v3: true, minCells: 0 },
        low: { nNormal: 2, nObese: 3, is3v3: false },
      },
    }), legacyVocabulary);
    expect(spec.rows).toEqual([
      { _key: 'full', cluster: 'full', label: 'full', nNormal: 3, nObese: 3, is3v3: true, minCells: 0 },
      { _key: 'low', cluster: 'low', label: 'Low', nNormal: 2, nObese: 3, is3v3: false, minCells: null },
      { _key: 'unknown', cluster: 'unknown', label: 'unknown', nNormal: null, nObese: null, is3v3: undefined, minCells: null },
    ]);
    expect(columnLabels(spec)).toEqual([
      'Population', 'Label', 'n Baseline', 'n Case', 'Design', 'Min cells', 'Replicate samples',
    ]);

    const design = spec.columns.find((column) => column.key === 'is3v3');
    expect(spec.rows.map((row) => design?.sortValue?.(row))).toEqual([0, 1, 2]);
    expect(design?.sortable).toBeUndefined();
    expect(design?.render).toBeUndefined();
    const samples = spec.columns.find((column) => column.key === 'samples');
    expect(samples?.sortable).toBe(false);
    expect(samples?.render).toBeUndefined();
  });
});

describe('deTable', () => {
  it('uses presence gates and appends the Lei column only under showAll', () => {
    const deSummary: QcDeSummaryRecord[] = [
      { cluster: 'geo', cluster_label: 'GEO', nGenes: 100, nSig: 3 },
      { cluster: 'rich', clusterLabel: 'Rich row', n_DEG_FDR05_LeiThresh: 7, top5_up: 'A' },
    ];
    const hidden = deTable({ deSummary }, makeMeta(), legacyVocabulary, { query: 'geo', showAll: false });
    expect(hidden.rows.map((row) => row.cluster)).toEqual(['geo']);
    expect(hidden.hasExtraColumns).toBe(true);
    expect(columnLabels(hidden)).not.toContain('DEG (Lei thresh)');

    const shown = deTable({ deSummary }, makeMeta(), legacyVocabulary, { query: 'geo', showAll: true });
    expect(shown.rows.map((row) => row.cluster)).toEqual(['geo']);
    expect(columnLabels(shown)).toContain('DEG (Lei thresh)');
    expect(columnLabels(shown)).toContain('Top 5 ↑');
  });

  it('keeps a GEO-shaped summary to Genes/Sig and filters cluster or label case-insensitively', () => {
    const qc = {
      deSummary: [
        { cluster: 'alpha', cluster_label: 'First track', nGenes: 10, nSig: 2 },
        { cluster: 'BETA', cluster_label: 'Second track', nGenes: 20, nSig: 4 },
      ],
    };
    const all = deTable(qc, makeMeta(), legacyVocabulary, { query: '', showAll: true });
    expect(columnLabels(all)).toEqual(['Population', 'Label', 'Genes tested', 'Sig (P<0.01)']);
    expect(deTable(qc, makeMeta(), legacyVocabulary, { query: 'ALP', showAll: false }).rows[0].cluster).toBe('alpha');
    expect(deTable(qc, makeMeta(), legacyVocabulary, { query: 'second', showAll: false }).rows[0].cluster).toBe('BETA');
  });

  it('preserves the DE nullish label chain, including an empty-string label', () => {
    const spec = deTable({
      deSummary: [
        { cluster: 'a', cluster_label: '', clusterLabel: 'ignored' },
        { cluster: 'b', clusterLabel: 'Legacy label' },
        { cluster: 'c' },
      ],
    }, makeMeta({ labels: { c: 'Meta label' } }), legacyVocabulary, { query: '', showAll: false });
    expect(spec.rows.map((row) => row.label)).toEqual(['', 'Legacy label', 'Meta label']);
  });
});

describe('fgseaTable', () => {
  it('filters aggregated rows and appends four 0.25 columns under showAll', () => {
    const qc = {
      fgseaSummary: [
        { cluster: 'a', cluster_label: 'Alpha', collection: 'hallmark', padj: 0.01 },
        { cluster: 'b', cluster_label: 'Beta', collection: 'kegg', padj: 0.2 },
      ],
    };
    const base = fgseaTable(qc, makeMeta(), legacyVocabulary, { query: 'ALPHA', showAll: false });
    expect(base.rows.map((row) => row.cluster)).toEqual(['a']);
    expect(base.columns).toHaveLength(6);
    const all = fgseaTable(qc, makeMeta(), legacyVocabulary, { query: '', showAll: true });
    expect(all.columns).toHaveLength(10);
    expect(columnLabels(all).slice(-4)).toEqual([
      'Hallmark (0.25)', 'KEGG (0.25)', 'GO_BP (0.25)', 'Reactome (0.25)',
    ]);
  });
});

describe('compositionTables', () => {
  it('strips a shared sample prefix and formats counts/proportions as strings', () => {
    const composition: QcComposition = {
      countsWide: [{ cluster: 'a', DONOR_R1: 1.6, DONOR_R2: 'missing' }],
      propsWide: [{ cluster: 'a', DONOR_R1: 0.126 }],
    };
    const qc: QcGlobal = { composition };
    const counts = compositionTables(qc, makeMeta(), 'counts');
    expect(columnLabels(counts.wide)).toEqual(['cluster', 'R1', 'R2']);
    expect(counts.wide.columns[1].render?.(counts.wide.rows[0])).toBe('2');
    expect(counts.wide.columns[2].render?.(counts.wide.rows[0])).toBe('missing');

    const props = compositionTables(qc, makeMeta(), 'props');
    expect(props.wide.columns[1].render?.(props.wide.rows[0])).toBe('0.13');
  });

  it('formats daQuasi labels and small/ordinary numbers with the legacy policy', () => {
    const result = compositionTables({
      composition: { daQuasiAll: [{ cluster: 'a', p_value: 0.00012, effect_size: 1.23456 }] },
    }, makeMeta(), 'counts');
    expect(columnLabels(result.daQuasi)).toEqual(['cluster', 'p value', 'effect size']);
    expect(result.daQuasi.columns[1].render?.(result.daQuasi.rows[0])).toBe('1.20e-4');
    expect(result.daQuasi.columns[2].render?.(result.daQuasi.rows[0])).toBe('1.2346');
  });

  it('keeps hasData mode-dependent while daQuasi data applies to either mode', () => {
    const countsOnly = { composition: { countsWide: [{ cluster: 'a', s1: 1 }] } };
    expect(compositionTables(countsOnly, makeMeta(), 'counts').hasData).toBe(true);
    expect(compositionTables(countsOnly, makeMeta(), 'props').hasData).toBe(false);
    expect(compositionTables({ composition: {} }, makeMeta(), 'counts').hasData).toBe(false);
    expect(compositionTables(
      { composition: { daQuasiAll: [{ cluster: 'a', p: 1 }] } },
      makeMeta(),
      'props',
    ).hasData).toBe(true);
  });
});

describe('reportTable', () => {
  it('includes every population and preserves || fallbacks for labels/filenames', () => {
    const spec = reportTable(makeMeta({
      populations: ['a', 'b'],
      labels: { a: '', b: 'Beta' },
      qaReportFilenames: { a: '', b: 'beta.pdf' },
    }), legacyVocabulary);
    expect(spec.rows).toEqual([
      { _key: 'a', cluster: 'a', label: 'a', filename: null },
      { _key: 'b', cluster: 'b', label: 'Beta', filename: 'beta.pdf' },
    ]);
    expect(spec.columns.find((column) => column.key === 'filename')?.sortable).toBe(false);
  });
});

describe('qcKpis', () => {
  it('counts statuses and missing QA filenames with the original truthiness rules', () => {
    expect(qcKpis({
      runStatus: [
        { cluster: 'a', status: 'ok' },
        { cluster: 'b', status: 'error' },
        { cluster: 'c', status: '' },
        { cluster: 'd' },
      ],
    }, makeMeta({
      populations: ['a', 'b'],
      qaReportFilenames: { a: '', b: 'b.pdf' },
    }))).toMatchObject({ pops: 2, statusOk: 1, statusFail: 1, noQa: 1 });
  });

  it('uses the shared low-power rule', () => {
    const meta = makeMeta({
      qcFlags: {
        dropped: { is3v3: false, nNormal: 2, nObese: 3 },
        balanced: { is3v3: false, nNormal: 7, nObese: 8 },
      },
    });
    expect(qcKpis({}, meta).lowPower).toBe(1);
  });
});

describe('visibleQcSections', () => {
  it('returns four sections for bulk, six for legacy, and composition when dataset data exists', () => {
    const bulk = qcVocabulary({ trackNoun: 'track', supportsPathways: false } as Dataset, null);
    const bulkSections: QcSection[] = visibleQcSections(bulk, false);
    expect(bulkSections.map((section) => section.id)).toEqual(['runs', 'sizes', 'de', 'reports']);
    expect(visibleQcSections(legacyVocabulary, false)).toHaveLength(6);
    expect(visibleQcSections(bulk, true).map((section) => section.id)).toEqual([
      'runs', 'sizes', 'de', 'composition', 'reports',
    ]);
  });
});
