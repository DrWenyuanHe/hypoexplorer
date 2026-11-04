import { describe, expect, it } from 'vitest';
import {
  DATASETS,
  defineBulkStudy,
  type BulkStudyDefinition,
} from '../data/datasets';

// ── Registry golden ───────────────────────────────────────────────────────────────────────
// The fully-resolved DATASETS registry defines scientific data: which arms a
// study compares, in which direction, under which expression unit (see
// docs/REFACTOR_CHECKLIST.md, "Data-safety guardrail"). This snapshot pins
// EVERY field of EVERY entry, in registry order, so a registry refactor is
// provably recursively value-equivalent. Key order inside an entry is
// canonicalized (alphabetical) because it is not part of the contract, while
// entry order and property presence ARE pinned.
//
// If this test fails after an edit, the registry's DATA changed: fix the
// entry. Never `vitest -u` this snapshot during a refactor. Regenerate it only
// for a deliberate manifest change (new dataset, corrected label), in the same
// commit that makes the change, and say so in the commit message.

const UNDEFINED_SENTINEL = '__DATASETS_REGISTRY_PRESENT_BUT_UNDEFINED__';

/** Sort object keys while preserving arrays and explicit undefined values. */
function canonical(value: unknown): unknown {
  if (value === undefined) return UNDEFINED_SENTINEL;
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError(`Unsupported registry value: ${typeof value}`);
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Registry values must use plain-object prototypes');
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError('Registry objects must not have symbol keys');
    }

    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

describe('DATASETS registry golden', () => {
  it('has one entry per registered dataset', () => {
    expect(DATASETS).toHaveLength(162);
  });

  it('resolves every field of every entry to the pinned values, in order', () => {
    // Includes the reviewed R 4.6.0 edits and the deliberately added GSE65663
    // study; see data/intake/oxt-avp-2026-10-19/README.md for the new source.
    expect(canonical(DATASETS)).toMatchSnapshot();
  });
});

describe('defineBulkStudy (bulk-study defaults)', () => {
  const WIDE_IDS = new Set(['macaque_snrna', 'mouse_pomc_maternal_hfd_gse135639',
    'mouse_cvh_hfd_gse104709', 'rat_hypo_maternal_hfd_gse107324',
    'gse148252', 'emtab15488', 'gse337822', 'gse262407', 'gse314184', 'gse308884']);
  // Every bulk-study expression-unit exception is pinned explicitly. Most are
  // GEO-deposited normalized matrices analyzed with limma; the precise labels
  // are part of the scientific contract and must not silently collapse to CPM.
  const NON_CPM_UNITS = new Map<string, string>([
    ['gse224274', 'log2(CPM + 1)'],
    ['mouse_hypo_hfd_gse220533', 'log2-normalized'],
    ['mouse_scn_hfd_gse157077', 'log2(FPKM + 1)'],
    ['rat_hypo_exercise_gse242354', 'log2(CPM + 1)'],
    ['mouse_agrp_fedfast_gse124693', 'log2(DESeq2-normalized count + 1)'],
    ['mouse_arc_fasting_gse96627', 'log2(RPKM + 1)'],
    ['rat_poa_lbn_gse174753', 'log2(gene-summed FPKM + 1)'],
    ['rat_hypo_ozone_gse133293', 'log2(DESeq2-normalized count + 1)'],
    ['mouse_hypo_clic1_gse229799', 'log2(RSEM-normalized expression + 1)'],
    ['mouse_arc_cagrilintide_gse296488', 'log2(gene-summed TPM + 1)'],
    ['rat_pvn_stress_gse261833', 'log2(FPKM + 1)'],
    ['mouse_hypo_smc3_gse243287', 'log2(normalized CPM + 1)'],
    ['mouse_hypo_cp_ins2_gse218188', 'log2(DESeq2-normalized count + 1)'],
    ['rat_hypo_fructose_gse56238', 'log2(FPKM + 1)'],
    ['rat_vmh_hfd_gse330152', 'variance-stabilized expression (VST)'],
    ['mouse_vmh_thrb_gse98690', 'log2 counts per million (log2-CPM)'],
    ['mouse_hypo_crd_gse264350', 'log2(FPKM + 1)'],
    ['mouse_hypo_estrous_cycle_gse131172', 'log2(FPKM + 1)'],
    ['rat_fetal_hypo_ozone_gse156859', 'log2(CPM + 0.0001)'],
    ['mouse_hypo_thrb_k146q_gse167105', 'log2(author-normalized expression + 1)'],
    ['mouse_arc_neun_development_gse189945', 'DESeq2 variance-stabilized expression'],
    ['pig_hypo_mia_gse227725', 'log2(TPM + 1)'],
    ['pig_hypo_genotype_gse201408', 'log2(author-normalized expression + 1)'],
    ['mouse_scn_exercise_gse207992', 'log2(DESeq2-normalized count + 1)'],
    ['mouse_hypo_heat_stress_gse128660', 'log2(FPKM + 1)'],
    ['pig_hypo_mia_gse245146', 'log2(TPM + 1)'],
    ['rat_son_aging_gse231617', 'log2(DESeq2-normalized count + 1)'],
    ['mouse_mbh_maternal_emulsifier_gse231769', 'log2 CPM (TMM-normalized)'],
    ['cattle_hypo_nutrition_gse153495', 'log2(TMM-normalized count abundance + 1)'],
    ['cattle_arc_nutrition_gse153498', 'log2(TMM-normalized count abundance + 1)'],
    ['rat_son_salt_gse65663', 'log2 RMA (GeneSpring median-baselined)'],
  ]);

  it('every registered bulk study carries the shared defaults (no silent drift)', () => {
    for (const dataset of DATASETS.filter((entry) => !WIDE_IDS.has(entry.id))) {
      expect(dataset.expressionUnit, dataset.id).toBe(
        // Count studies display TMM-normalized CPM since the R 4.6.0 regeneration
        // (rule C2, data/quality/regeneration-r460-2026-09-25/README.md).
        NON_CPM_UNITS.get(dataset.id) ?? 'CPM (TMM-normalized)',
      );
      if (dataset.timeSeries) {
        expect(dataset.timeSeries.tracks, dataset.id).toEqual([dataset.defaultTrack]);
      }
      expect(dataset.featureType, dataset.id).toBe('gene');
      expect(dataset.featureLabel, dataset.id).toBe('Gene');
      expect(dataset.supportsPathways, dataset.id).toBe(true);
      expect(dataset.isDefault, dataset.id).toBe(false);
      expect(dataset.trackNoun, dataset.id).toBe('track');
      expect(dataset.trackCategoryOrder, dataset.id).toEqual(['Tissue']);
      expect(dataset.geo, dataset.id).toBeTruthy();
      expect(
        dataset.groups.map((group) => group.color),
        dataset.id,
      ).toEqual(['#3775BA', '#B64342']);
      expect(dataset.contrasts, dataset.id).toHaveLength(1);
      expect(dataset.contrasts[0], dataset.id).toMatchObject({
        baseline: dataset.groups[0].key,
        case: dataset.groups[1].key,
        isDefault: true,
      });
    }
  });

  const study: BulkStudyDefinition = {
    id: 'mouse_test_gse1',
    category: 'Diet-induced obesity',
    name: 'x',
    organism: 'Mus musculus',
    modality: 'bulk RNA-seq',
    region: 'Whole hypothalamus',
    perturbation: 'Diet & obesity',
    preparation: 'Bulk tissue',
    citation: 'x',
    doi: '',
    geo: 'GSE1',
    pmid: '',
    track: 'hypothalamus',
    arms: { baseline: 'Chow', case: 'HFD' },
    contrast: 'hfd_vs_chow',
  };

  it('fills the bulk defaults and derives control/case arm keys', () => {
    const dataset = defineBulkStudy(study);
    expect(dataset.groups).toEqual([
      { key: 'control', label: 'Chow', color: '#3775BA' },
      { key: 'case', label: 'HFD', color: '#B64342' },
    ]);
    expect(dataset.contrasts).toEqual([
      { id: 'hfd_vs_chow', baseline: 'control', case: 'case', isDefault: true },
    ]);
    // The default unit is TMM-normalized CPM since the R 4.6.0 regeneration
    // (rule C2, data/quality/regeneration-r460-2026-09-25/README.md).
    expect(dataset.expressionUnit).toBe('CPM (TMM-normalized)');
    expect(dataset.defaultTrack).toBe('hypothalamus');
    expect('timeSeries' in dataset).toBe(false);
    expect(dataset.metaGlobalKey).toBe('HX_MOUSE_TEST_GSE1_META');
  });

  it('honours keys, expressionUnit, and timeSeries deviations', () => {
    const timeSeries = {
      tracks: ['hypothalamus'],
      cycleHours: 24,
      timeUnit: 'ZT' as const,
      design: 'Hypothalamus sampled every 4 h across one 24 h cycle.',
    };
    const dataset = defineBulkStudy({
      ...study,
      arms: { ...study.arms, keys: ['chow', 'hfd'] },
      expressionUnit: 'log2-normalized',
      timeSeries,
    });
    expect(dataset.groups.map((group) => group.key)).toEqual(['chow', 'hfd']);
    expect(dataset.contrasts[0]).toMatchObject({ baseline: 'chow', case: 'hfd' });
    expect(dataset.expressionUnit).toBe('log2-normalized');
    expect(dataset.timeSeries).toEqual(timeSeries);
  });
});
