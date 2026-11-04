import { describe, it, expect } from 'vitest';
import { aggregateFgseaSummary } from '../qc/fgseaSummary';
import type { FgseaSummaryRecord } from '../qc/fgseaSummary';

// The per-collection FGSEA fold behind the QC tab's FGSEA table. It lived inline
// in QCTab, so the only way to reach it was to mount the whole tab and read
// numbers out of a table; nothing exercised the collection arms, the gobp/go_bp
// alias, or the two thresholds.

const row = (o: Partial<FgseaSummaryRecord> & { cluster: string }): FgseaSummaryRecord => ({
  collection: 'HALLMARK', padj: 0.5, ...o,
});

const ZERO = {
  hallmark_005: 0, kegg_005: 0, gobp_005: 0, reactome_005: 0,
  hallmark_025: 0, kegg_025: 0, gobp_025: 0, reactome_025: 0,
};

describe('aggregateFgseaSummary', () => {
  it('returns no rows for no input', () => {
    expect(aggregateFgseaSummary([])).toEqual([]);
  });

  it('counts each collection into its own pair of columns', () => {
    const out = aggregateFgseaSummary([
      row({ cluster: 'e9', collection: 'HALLMARK', padj: 0.01 }),
      row({ cluster: 'e9', collection: 'KEGG', padj: 0.02 }),
      row({ cluster: 'e9', collection: 'GOBP', padj: 0.03 }),
      row({ cluster: 'e9', collection: 'REACTOME', padj: 0.04 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      hallmark_005: 1, kegg_005: 1, gobp_005: 1, reactome_005: 1,
      hallmark_025: 1, kegg_025: 1, gobp_025: 1, reactome_025: 1,
    });
  });

  it('treats go_bp as an alias of gobp — both land in the GO_BP columns', () => {
    const out = aggregateFgseaSummary([
      row({ cluster: 'e9', collection: 'gobp', padj: 0.01 }),
      row({ cluster: 'e9', collection: 'go_bp', padj: 0.02 }),
      row({ cluster: 'e9', collection: 'GO_BP', padj: 0.2 }),
    ]);
    expect(out[0]).toMatchObject({ gobp_005: 2, gobp_025: 3 });
  });

  it('matches the collection case-insensitively', () => {
    const out = aggregateFgseaSummary([
      row({ cluster: 'e9', collection: 'Hallmark', padj: 0.01 }),
      row({ cluster: 'e9', collection: 'kEgG', padj: 0.01 }),
    ]);
    expect(out[0]).toMatchObject({ hallmark_005: 1, kegg_005: 1 });
  });

  it('applies the two thresholds independently — 0.05 nests inside 0.25', () => {
    const out = aggregateFgseaSummary([
      row({ cluster: 'e9', collection: 'KEGG', padj: 0.049 }), // both
      row({ cluster: 'e9', collection: 'KEGG', padj: 0.05 }), // 0.25 only — both cuts are strict <
      row({ cluster: 'e9', collection: 'KEGG', padj: 0.1 }), // 0.25 only
      row({ cluster: 'e9', collection: 'KEGG', padj: 0.25 }), // neither (strict <)
      row({ cluster: 'e9', collection: 'KEGG', padj: 0.9 }), // neither
    ]);
    expect(out[0]).toMatchObject({ kegg_005: 1, kegg_025: 3 });
  });

  it('counts an unknown collection nowhere, but still emits the cluster row', () => {
    const out = aggregateFgseaSummary([
      row({ cluster: 'e9', cluster_label: 'POMC/TBX3', collection: 'WIKIPATHWAYS', padj: 0.001 }),
      row({ cluster: 'e9', collection: '', padj: 0.001 }),
      row({ cluster: 'e9', collection: undefined, padj: 0.001 }),
    ]);
    expect(out).toEqual([{ _key: 'e9', cluster: 'e9', label: 'POMC/TBX3', ...ZERO }]);
  });

  it('counts nothing for a missing padj rather than throwing', () => {
    const out = aggregateFgseaSummary([row({ cluster: 'e9', collection: 'HALLMARK', padj: undefined })]);
    expect(out[0]).toMatchObject({ hallmark_005: 0, hallmark_025: 0 });
  });

  it('groups by cluster in first-seen order, labelled from the first row seen', () => {
    const out = aggregateFgseaSummary([
      row({ cluster: 'i23', cluster_label: 'AGRP', collection: 'KEGG', padj: 0.01 }),
      row({ cluster: 'e9', cluster_label: 'POMC', collection: 'KEGG', padj: 0.01 }),
      row({ cluster: 'i23', cluster_label: 'IGNORED', collection: 'KEGG', padj: 0.2 }),
    ]);
    expect(out.map((r) => r.cluster)).toEqual(['i23', 'e9']);
    expect(out.map((r) => r.label)).toEqual(['AGRP', 'POMC']);
    expect(out[0]).toMatchObject({ kegg_005: 1, kegg_025: 2 });
    expect(out[1]).toMatchObject({ kegg_005: 1, kegg_025: 1 });
  });

  it('emits every column, in the order the QC table declares them', () => {
    const out = aggregateFgseaSummary([row({ cluster: 'e9', cluster_label: 'POMC' })]);
    expect(Object.keys(out[0])).toEqual([
      '_key', 'cluster', 'label',
      'hallmark_005', 'kegg_005', 'gobp_005', 'reactome_005',
      'hallmark_025', 'kegg_025', 'gobp_025', 'reactome_025',
    ]);
  });

  it('leaves the label undefined when the summary carries none', () => {
    expect(aggregateFgseaSummary([row({ cluster: 'e9' })])[0].label).toBeUndefined();
  });
});
