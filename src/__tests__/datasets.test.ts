import { describe, it, expect, vi } from 'vitest';
import {
  DATASETS,
  defineDataset,
  type DatasetDefinition,
  listDatasets,
  getDataset,
  getDefaultDataset,
  datasetCategory,
  datasetsByCategory,
  DATASET_CATEGORIES,
} from '../data/datasets';
import { designCells, getActiveContrast, listContrasts } from '../data/contrasts';
import { resolveTrackUrl, resolveTrackGlobalKey } from '../data/bundleLocators';
import type { Dataset } from '../types';
import { BULK_DATASET_FIXTURE, MIRNA_DATASET_FIXTURE, MULTICONTRAST_DATASET_FIXTURE } from './fixtures';

// The bundled DATASETS registry is the single source of truth for which
// datasets the explorer can browse. These tests pin the manifest contract and
// the resolver helpers that the loaders + App depend on.
describe('datasets registry', () => {
  it('registers each dataset once, macaque atlas first and only default', () => {
    expect(listDatasets()).toBe(DATASETS);
    const ids = DATASETS.map((d) => d.id);
    expect(new Set(ids).size).toBe(DATASETS.length);
    expect(DATASETS.length).toBeGreaterThanOrEqual(56);
    expect(DATASETS.filter((d) => d.isDefault).map((d) => d.id)).toEqual(['macaque_snrna']);
    const ds = DATASETS[0];
    expect(ds.id).toBe('macaque_snrna');
    expect(ds.isDefault).toBe(true);
    expect(ds.modality).toBe('snRNA-seq');
    expect(ds.featureType).toBe('gene');
    expect(ds.supportsPathways).toBe(true);
    expect(ds.defaultTrack).toBe('e9');
    expect(ds.metaGlobalKey).toBe('HX_MACAQUE_SNRNA_META');
    expect(ds.qcGlobalKey).toBe('HX_MACAQUE_SNRNA_QC');
  });

  it('every dataset satisfies the registry invariants', () => {
    for (const d of DATASETS) {
      expect(d.contrasts.length, d.id).toBeGreaterThan(0);
      expect(new Set(d.contrasts.map((contrast) => contrast.id)).size, d.id).toBe(d.contrasts.length);
      expect(d.contrasts.filter((contrast) => contrast.isDefault).length, d.id).toBeLessThanOrEqual(1);

      const groupKeys = d.groups.map((group) => group.key);
      expect(new Set(groupKeys).size, d.id).toBe(groupKeys.length);
      for (const contrast of d.contrasts) {
        expect(groupKeys, `${d.id}:${contrast.id}.baseline`).toContain(contrast.baseline);
        expect(groupKeys, `${d.id}:${contrast.id}.case`).toContain(contrast.case);
      }

      expect(getActiveContrast(d), d.id).not.toBeNull();
      expect(d.defaultTrack, d.id).toBeTruthy();
      expect(d.trackCategoryOrder.length, d.id).toBeGreaterThan(0);
      if (d.timeSeries) expect(d.timeSeries.tracks.length, d.id).toBeGreaterThan(0);
    }
  });

  it('registers the two tier-1 mouse HFD bulk datasets (chow vs HFD, with pathways)', () => {
    for (const id of ['mouse_hypo_hfd_gse220533', 'mouse_arc_hfd_gse225038']) {
      const ds = getDataset(id)!;
      expect(ds, id).toBeTruthy();
      expect(ds.organism).toBe('Mus musculus');
      expect(ds.modality).toBe('bulk RNA-seq');
      expect(ds.featureType).toBe('gene');
      // FGSEA now computed for the mouse datasets (scripts/run_mouse_fgsea.R) →
      // pathways are browsable and feed the cross-dataset pathway report.
      expect(ds.supportsPathways).toBe(true);
      expect(ds.isDefault).toBe(false);
      // chow vs HFD contrast.
      expect(ds.groups.map(g => g.key)).toEqual(['chow', 'hfd']);
      expect(ds.contrasts[0]).toMatchObject({ id: 'hfd_vs_chow', baseline: 'chow', case: 'hfd', isDefault: true });
      // single whole-tissue track, namespaced global key.
      expect(ds.trackCategoryOrder).toEqual(['Tissue']);
      expect(resolveTrackGlobalKey(ds, ds.defaultTrack)).toBe(`${ds.globalKeyTemplate.replace('{TRACKID}', ds.defaultTrack.toUpperCase())}`);
      expect(ds.expressionUnit).toMatch(/CPM|log2/);
    }
    expect(getDataset('mouse_hypo_hfd_gse220533')!.defaultTrack).toBe('whole');
    expect(getDataset('mouse_arc_hfd_gse225038')!.defaultTrack).toBe('arcuate');
  });

  it('getDataset returns the manifest by id, or null for unknown ids', () => {
    expect(getDataset('macaque_snrna')).toBe(DATASETS[0]);
    expect(getDataset('nope')).toBeNull();
  });

  it('getDefaultDataset returns the isDefault manifest', () => {
    expect(getDefaultDataset()).toBe(DATASETS[0]);
  });

  it('groups are normal/obese with their hex colors', () => {
    const ds = DATASETS[0];
    expect(ds.groups.map(g => g.key)).toEqual(['normal', 'obese']);
    expect(ds.groups[0]).toMatchObject({ key: 'normal', label: 'Normal' });
    expect(ds.groups[1]).toMatchObject({ key: 'obese', label: 'Obese' });
    expect(ds.groups[0].color).toMatch(/^#/);
    expect(ds.groups[1].color).toMatch(/^#/);
  });
});

describe('getActiveContrast', () => {
  it('resolves the default contrast and maps group KEYS to full group objects', () => {
    const ds = DATASETS[0];
    const c = getActiveContrast(ds)!;
    expect(c.id).toBe('obese_vs_normal');
    // baseline / caseGroup are full {key,label,color} objects, not bare keys.
    expect(c.baseline).toEqual(ds.groups[0]);
    expect(c.caseGroup).toEqual(ds.groups[1]);
    expect(c.supportsPathways).toBe(true);
  });

  it('uses caseGroup as the field name (never the reserved word "case")', () => {
    const c = getActiveContrast(DATASETS[0]);
    expect(c).toHaveProperty('caseGroup');
    expect(c).not.toHaveProperty('case');
  });

  it('resolves a contrast by explicit id', () => {
    const c = getActiveContrast(DATASETS[0], 'obese_vs_normal')!;
    expect(c.id).toBe('obese_vs_normal');
  });

  it('falls back to the isDefault contrast when the id is unknown', () => {
    const c = getActiveContrast(DATASETS[0], 'does_not_exist')!;
    expect(c.id).toBe('obese_vs_normal');
  });

  it('derives a "<case> vs <baseline>" label when none is authored', () => {
    const c = getActiveContrast(DATASETS[0])!;
    expect(c.label).toBe('Obese vs Normal');
  });

  it('selects each precomputed contrast of a multi-contrast dataset by id, with authored labels', () => {
    const ds = MULTICONTRAST_DATASET_FIXTURE;
    // Default (no id) → the isDefault contrast.
    const def = getActiveContrast(ds)!;
    expect(def.id).toBe('fast24_vs_fed');
    expect(def.label).toBe('Fasted 24h vs Fed');
    expect(def.baseline.key).toBe('fed');
    expect(def.caseGroup.key).toBe('fast24');
    // Explicit non-default id → the other contrast, against the same baseline.
    const refed = getActiveContrast(ds, 'refed_vs_fed')!;
    expect(refed.id).toBe('refed_vs_fed');
    expect(refed.label).toBe('Refed vs Fed');
    expect(refed.baseline.key).toBe('fed');
    expect(refed.caseGroup.key).toBe('refed');
  });

  it('works for a non-macaque dataset (bulk, chow/hfd group keys)', () => {
    const c = getActiveContrast(BULK_DATASET_FIXTURE)!;
    expect(c.id).toBe('hfd_vs_chow');
    expect(c.baseline).toMatchObject({ key: 'chow', label: 'Chow' });
    expect(c.caseGroup).toMatchObject({ key: 'hfd', label: 'HFD' });
    expect(c.supportsPathways).toBe(true);
  });

  it('reflects supportsPathways:false for the miRNA dataset', () => {
    const c = getActiveContrast(MIRNA_DATASET_FIXTURE)!;
    expect(c.supportsPathways).toBe(false);
    expect(c.baseline.key).toBe('control');
    expect(c.caseGroup.key).toBe('hfd');
  });

  it('returns null (not a throw) when the dataset declares no contrasts', () => {
    // App.jsx and the chart/QC fallbacks rely on null here to degrade
    // gracefully (skip hero chips, default arm labels) instead of crashing.
    expect(getActiveContrast({ groups: [], contrasts: [] } as unknown as Dataset)).toBeNull();
    expect(getActiveContrast({} as Dataset)).toBeNull();
    expect(getActiveContrast(null)).toBeNull();
  });

  it('rejects a self-comparison (baseline === case) as null and warns', () => {
    // A manifest typo authoring the same group on both arms would render
    // "X vs X" with identical values; the guard treats it as no contrast.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ds = {
      groups: [{ key: 'a', label: 'A', color: '#111111' }],
      contrasts: [{ id: 'a_vs_a', baseline: 'a', case: 'a', isDefault: true }],
    } as Dataset;
    expect(getActiveContrast(ds)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('listContrasts', () => {
  it('returns a single resolved contrast for a single-contrast dataset', () => {
    const list = listContrasts(DATASETS[0]);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('obese_vs_normal');
    expect(list[0].label).toBe('Obese vs Normal');
  });

  it('returns every declared contrast in manifest order for a multi-contrast dataset', () => {
    const list = listContrasts(MULTICONTRAST_DATASET_FIXTURE);
    expect(list.map(c => c.id)).toEqual(['fast24_vs_fed', 'refed_vs_fed']);
    expect(list.map(c => c.label)).toEqual(['Fasted 24h vs Fed', 'Refed vs Fed']);
    // Full group objects resolved on each.
    expect(list[0].baseline.label).toBe('Fed');
    expect(list[1].caseGroup.label).toBe('Refed');
  });

  it('skips self-comparison contrasts (and does not throw)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ds = {
      groups: [
        { key: 'a', label: 'A', color: '#111111' },
        { key: 'b', label: 'B', color: '#222222' },
      ],
      contrasts: [
        { id: 'a_vs_a', baseline: 'a', case: 'a' },
        { id: 'b_vs_a', baseline: 'a', case: 'b', isDefault: true },
      ],
    } as Dataset;
    const list = listContrasts(ds);
    expect(list.map(c => c.id)).toEqual(['b_vs_a']);
    warn.mockRestore();
  });

  it('returns [] for a dataset with no contrasts', () => {
    expect(listContrasts({ groups: [], contrasts: [] } as unknown as Dataset)).toEqual([]);
    expect(listContrasts(null)).toEqual([]);
  });
});

describe('designCells', () => {
  it('is the union of the groups the contrasts draw, in declaration order', () => {
    const cells = designCells(listContrasts(getDataset('mouse_pomc_maternal_hfd_gse135639')));
    expect(cells.map((g) => g.key)).toEqual(['chow_p0', 'hfd_p0', 'chow_p21', 'hfd_p21']);
    expect(cells.map((g) => g.label))
      .toEqual(['Chow · P0', 'HFD · P0', 'Chow · P21', 'HFD · P21']);
  });

  it('excludes declared groups no contrast draws, so pooled arms never join the cells', () => {
    const dataset = getDataset('mouse_pomc_maternal_hfd_gse135639');
    // The manifest declares six groups; the pooled control/case arms CONTAIN the
    // four cells, so plotting them beside the cells would draw every sample
    // twice and invite a comparison against a pool the bar belongs to.
    expect(dataset?.groups.map((g) => g.key)).toContain('control');
    expect(designCells(listContrasts(dataset)).map((g) => g.key)).not.toContain('control');
  });

  it('gives a two-arm dataset exactly its two groups, which is how the view stays gated', () => {
    expect(designCells(listContrasts(DATASETS[0])).map((g) => g.key)).toEqual(['normal', 'obese']);
    expect(designCells(listContrasts(MULTICONTRAST_DATASET_FIXTURE)).length).toBeGreaterThan(2);
  });

  it('returns [] for no contrasts', () => {
    expect(designCells([])).toEqual([]);
    expect(designCells(null)).toEqual([]);
  });
});

describe('dataset categories', () => {
  it('assigns every registered dataset a category in the canonical list', () => {
    for (const d of DATASETS) {
      expect(DATASET_CATEGORIES, d.id).toContain(datasetCategory(d.id));
    }
  });

  it('macaque is the Primate atlas; mouse HFD sets are Diet-induced obesity', () => {
    expect(datasetCategory('macaque_snrna')).toBe('Primate atlas');
    expect(datasetCategory('mouse_hypo_hfd_gse220533')).toBe('Diet-induced obesity');
  });

  it('throws for an unknown dataset id instead of silently defaulting a category', () => {
    // The old CATEGORY_BY_ID side table defaulted unlisted ids to
    // 'Diet-induced obesity' — a plausible wrong answer that filed a study under
    // the wrong report heading. Category is now a required manifest field; an
    // unknown id is a bug and must be loud.
    expect(() => datasetCategory('never_registered')).toThrow(/unknown dataset id/);
  });

  it('datasetsByCategory partitions all datasets exactly once, in display order', () => {
    const groups = datasetsByCategory();
    // Every dataset appears exactly once across the groups.
    const ids = groups.flatMap((g) => g.datasets.map((d) => d.id));
    expect(ids.slice().sort()).toEqual(DATASETS.map((d) => d.id).sort());
    expect(new Set(ids).size).toBe(DATASETS.length);
    // Group order follows DATASET_CATEGORIES; no empty groups.
    const order = groups.map((g) => g.category);
    expect(order).toEqual([...DATASET_CATEGORIES].filter((c) => order.includes(c)));
    for (const g of groups) expect(g.datasets.length).toBeGreaterThan(0);
  });
});

describe('defineDataset (bundle-locator derivation)', () => {
  // The minimal non-derivable manifest: what an author actually writes.
  const definition: DatasetDefinition = {
    id: 'mouse_hypo_hfd_gse220533',
    category: 'Diet-induced obesity',
    name: 'x', organism: 'x', modality: 'x',
    region: 'Whole hypothalamus', perturbation: 'Diet & obesity', preparation: 'Bulk tissue',
    featureType: 'gene', featureLabel: 'Gene', supportsPathways: true,
    citation: 'x', isDefault: false, defaultTrack: 'whole',
    trackCategoryOrder: ['Tissue'], groups: [], contrasts: [],
  };

  it('derives all seven locator fields from the id (digits + underscores preserved)', () => {
    const ds = defineDataset(definition);
    expect(ds.metaFile).toBe('/datasets/mouse_hypo_hfd_gse220533/meta.js');
    expect(ds.metaGlobalKey).toBe('HX_MOUSE_HYPO_HFD_GSE220533_META');
    expect(ds.qcFile).toBe('/datasets/mouse_hypo_hfd_gse220533/qc_global.js');
    expect(ds.qcGlobalKey).toBe('HX_MOUSE_HYPO_HFD_GSE220533_QC');
    expect(ds.bundleFileTemplate).toBe('/datasets/mouse_hypo_hfd_gse220533/track_{trackId}.js');
    expect(ds.globalKeyTemplate).toBe('HX_MOUSE_HYPO_HFD_GSE220533_{TRACKID}');
  });

  it('honours explicit overrides, including an intentional empty bundleBaseUrl', () => {
    const ds = defineDataset({
      ...definition,
      bundleBaseUrl: '',
      metaGlobalKey: 'HX_CUSTOM_META',
    });
    expect(ds.bundleBaseUrl).toBe('');
    expect(ds.metaGlobalKey).toBe('HX_CUSTOM_META');
    // Non-overridden fields still derive.
    expect(ds.qcGlobalKey).toBe('HX_MOUSE_HYPO_HFD_GSE220533_QC');
  });

  it('every registered dataset matches the derivation (no silent drift)', () => {
    // Regression for the migration itself: the factory must reproduce exactly
    // what the 41 hand-written entries used to say.
    for (const ds of DATASETS) {
      const ns = ds.id.toUpperCase();
      expect(ds.metaFile, ds.id).toBe(`/datasets/${ds.id}/meta.js`);
      expect(ds.metaGlobalKey, ds.id).toBe(`HX_${ns}_META`);
      expect(ds.qcFile, ds.id).toBe(`/datasets/${ds.id}/qc_global.js`);
      expect(ds.qcGlobalKey, ds.id).toBe(`HX_${ns}_QC`);
      expect(ds.bundleFileTemplate, ds.id).toBe(`/datasets/${ds.id}/track_{trackId}.js`);
      expect(ds.globalKeyTemplate, ds.id).toBe(`HX_${ns}_{TRACKID}`);
    }
  });
});

describe('resolveTrackUrl / resolveTrackGlobalKey', () => {
  it('substitutes {trackId} into the bundle file template', () => {
    // Pin the base explicitly: DATASETS[0].bundleBaseUrl comes from
    // VITE_BUNDLE_BASE_URL, so a local .env.local pointing bundles at R2 would
    // otherwise make this assert an absolute origin and fail.
    const ds = { ...DATASETS[0], bundleBaseUrl: '' };
    expect(resolveTrackUrl(ds, 'e9')).toBe('/datasets/macaque_snrna/track_e9.js');
    expect(resolveTrackUrl(ds, 'Ast1')).toBe('/datasets/macaque_snrna/track_Ast1.js');
  });

  it('prepends bundleBaseUrl when present', () => {
    const ds = { ...DATASETS[0], bundleBaseUrl: 'https://cdn.example.com' };
    expect(resolveTrackUrl(ds, 'e9')).toBe('https://cdn.example.com/datasets/macaque_snrna/track_e9.js');
  });

  it('uppercases the track id for the global key', () => {
    const ds = DATASETS[0];
    expect(resolveTrackGlobalKey(ds, 'e9')).toBe('HX_MACAQUE_SNRNA_E9');
    expect(resolveTrackGlobalKey(ds, 'Ast1')).toBe('HX_MACAQUE_SNRNA_AST1');
  });
});

describe('aging datasets', () => {
  it('contains exactly the nine validated aging studies', () => {
    expect(
      DATASETS
        .filter((dataset) => dataset.category === 'Aging')
        .map((dataset) => dataset.id)
        .sort(),
    ).toEqual([
      'macaque_hypo_aging_gse128537',
      'mouse_hypo_aging_gse212336',
      'mouse_hypo_aging_gse240365',
      'mouse_hypo_aging_gse314817',
      'mouse_hypo_astro_aging_gse99791',
      'mouse_hypo_circadian_aging_gse201207',
      'mouse_hypo_spatial_aging_gse270383',
      'rat_hypo_aging_gse314970',
      'rat_son_aging_gse231617',
    ]);
  });
});

// ── Developmental programming (maternal exposure → offspring) ───────────────
// The category and its three studies. All profile the PUP after a manipulation
// applied to the MOTHER, which is what separates them from the reproductive
// datasets they used to sit beside. All three are maternal obesogenic-diet
// studies, which is what keeps the category a coherent section rather than a
// loose theme (see the note in src/data/datasetCategories.ts).
describe('developmental programming datasets', () => {
  const inCategory = () => DATASETS.filter((d) => d.category === 'Developmental programming');

  it('groups the maternal-exposure studies under one category', () => {
    expect(inCategory().map((d) => d.id).sort()).toEqual([
      'mouse_hypo_maternal_hcd_gse242187',
      'mouse_hypo_maternal_protein_gse162744',
      'mouse_pomc_maternal_hfd_gse135639',
      'rat_hypo_maternal_hfd_gse107324',
    ]);
  });

  it('reports GSE135639 on its deposited scale, not a relabelled CPM', () => {
    const ds = getDataset('mouse_pomc_maternal_hfd_gse135639')!;
    // GEO deposits edgeR CPM and never the raw counts, so the values are
    // log2(deposited CPM + 1), not this pipeline's CPM (TMM-normalized).
    // See scripts/de_gse135639.R.
    expect(ds.expressionUnit).toBe('log2(normalized CPM + 1)');
    expect(ds.preparation).toBe('Translatome');
    expect(ds.region).toBe('Arcuate nucleus');
    expect(ds.supportsPathways).toBe(true);
  });

  it('describes GSE162744 as the maternal-obesity study it is', () => {
    // Regression. This shipped as "maternal low- vs high-PROTEIN diet" because
    // GEO's group codes LP/HP were read as macronutrients. They are Low-fat +
    // PBS and High-fat + PBS — the second letter is the postnatal injection.
    // Low-protein programming is a real but DIFFERENT paradigm, so the old
    // label sent readers to the wrong literature entirely.
    const ds = getDataset('mouse_hypo_maternal_protein_gse162744')!;
    expect(ds.name).not.toMatch(/protein/i);
    expect(ds.citation).not.toMatch(/high-protein/i);
    expect(ds.groups.map((g) => g.label)).toEqual(['Maternal low-fat', 'Maternal HFHS']);
    expect(ds.doi).toBe('10.1016/j.mce.2021.111218');
    // The contrast direction was always right: low-fat is the baseline.
    expect(ds.contrasts[0]).toMatchObject({ baseline: 'control', case: 'case', isDefault: true });
  });

  it('names the maternal arms from the mother, not the pup', () => {
    const ds = getDataset('mouse_pomc_maternal_hfd_gse135639')!;
    // Pooled arms first, then the four diet × age design cells the contrasts
    // draw. The pooled pair is deliberately kept although NO contrast compares
    // it any more (the age-adjusted contrast that did was removed): they are
    // still the study's two diet arms, and the bundle's groupSamples and
    // qc.nNormal/nObese remain keyed by them.
    expect(ds.groups.map((g) => g.label)).toEqual([
      'Maternal chow', 'Maternal HFD',
      'Chow · P0', 'Chow · P21', 'HFD · P0', 'HFD · P21',
    ]);
  });

  it('exposes the 2x2 as four contrasts, grouped by design axis', () => {
    const ds = getDataset('mouse_pomc_maternal_hfd_gse135639')!;
    // The age-adjusted `~ age + diet` contrast was REMOVED. It averaged the two
    // ages under an untested additivity assumption, was not the raw difference
    // between the arms the app draws, and found nothing (0 genes at FDR<0.05
    // against 21 for P21). Its DE + FGSEA tables are gone from geo_replication
    // and de_gse135639.R no longer fits it.
    expect(ds.contrasts.map((c) => c.id)).toEqual([
      'hfd_vs_chow_p0', 'hfd_vs_chow_p21',
      'p21_vs_p0_chow', 'p21_vs_p0_hfd',
    ]);
    expect(ds.contrasts.map((c) => c.id)).not.toContain('mat_hfd_vs_chow');
    // The default is now the P21 diet cell — the cross-dataset report and the
    // query index both speak for it, so it has to stay a maternal-DIET effect to
    // sit beside the other two maternal obesogenic-diet studies in the
    // 'Developmental programming' section.
    expect(ds.contrasts.filter((c) => c.isDefault).map((c) => c.id)).toEqual(['hfd_vs_chow_p21']);
    // Each contrast references declared groups.
    const keys = new Set(ds.groups.map((g) => g.key));
    for (const c of ds.contrasts) {
      expect(keys.has(c.baseline), c.id).toBe(true);
      expect(keys.has(c.case), c.id).toBe(true);
    }
    // The selector's optgroups: the diet-axis pair vs the maturation axis.
    expect(ds.contrasts.map((c) => c.group)).toEqual([
      'Maternal-diet effect', 'Maternal-diet effect',
      'Maturation (P0 → P21)', 'Maturation (P0 → P21)',
    ]);
  });

  it('records that the diet contrasts are not the source study\'s contrasts', () => {
    // The paper's DE is the P0→P21 trajectory within each diet arm; the diet
    // comparisons here are re-analysis. A reader who assumes otherwise would
    // read a null volcano as "the study found nothing", so the citation has to
    // carry the distinction.
    const ds = getDataset('mouse_pomc_maternal_hfd_gse135639')!;
    // Two wordings are forbidden here, both from contrasts that no longer ship.
    // "at matched age" described the additive fit as a within-age comparison,
    // which it never was; "age-adjusted" described it correctly but the fit
    // itself is gone, so claiming it in the citation would advertise a contrast
    // the app cannot show. The diet effect is now stated per age.
    expect(ds.citation).toMatch(/at each age separately/i);
    expect(ds.citation).toMatch(/not contrasts the source study ran/i);
    expect(ds.citation).not.toMatch(/matched age/i);
    expect(ds.citation).not.toMatch(/age-adjusted/i);
    expect(ds.citation).toMatch(/GSE135639/);
    expect(ds.doi).toBe('10.1016/j.molmet.2020.02.006');
  });
});

// The "exploratory contrast" warning in the explorer study bar is driven by
// Contrast.exploratory (NOT description presence — a description can also
// annotate a faithful re-fit of the paper's own axis). These pin the data side:
// exactly the comparisons the source study never ran carry the flag.
describe('contrast flags gate the exploratory warning', () => {
  it('marks GSE135639\'s two diet contrasts and nothing else', () => {
    const flagged = DATASETS.flatMap((d) =>
      d.contrasts.filter((c) => c.exploratory).map((c) => `${d.id}/${c.id}`));
    // Was three: the age-adjusted contrast carried the flag too, until it was
    // removed. Note the surviving DEFAULT contrast is one of these, so this
    // dataset opens with the exploratory warning showing — which is correct,
    // the source study did not run a diet comparison at either age.
    expect(flagged).toEqual([
      'mouse_pomc_maternal_hfd_gse135639/hfd_vs_chow_p0',
      'mouse_pomc_maternal_hfd_gse135639/hfd_vs_chow_p21',
      'mouse_hypo_fasting_gse87544/deprived_vs_fed',
    ]);
  });

  it('presents GSE87544 as exploratory: effect sizes and pathway ranks, no gene-level FDR call', () => {
    // The R 4.6.0 re-fit (~ batch + group, seven units) has one residual df, so
    // the badge and its description must stop a reader treating FDR as a call.
    const c = getDataset('mouse_hypo_fasting_gse87544')!.contrasts[0];
    expect(c.isDefault).toBe(true);
    expect(c.exploratory).toBe(true);
    expect(c.description).toMatch(/one residual degree of\s+freedom/i);
    expect(c.description).toMatch(/effect sizes \(logFC\) and pathway ranks/i);
    expect(c.description).toMatch(/no gene-level FDR call/i);
  });

  it('gives every GSE135639 contrast a description — including the paper\'s own maturation axis, UNflagged', () => {
    const ds = getDataset('mouse_pomc_maternal_hfd_gse135639')!;
    for (const c of ds.contrasts) expect(c.description, c.id).toBeTruthy();
    // The maturation contrasts ARE the study's own axis (re-fit): described,
    // but never branded exploratory.
    for (const id of ['p21_vs_p0_chow', 'p21_vs_p0_hfd']) {
      const c = ds.contrasts.find((x) => x.id === id)!;
      expect(c.exploratory, id).toBeUndefined();
      expect(c.description).toMatch(/source study's own axis/i);
    }
  });

  it('says what a reader would otherwise get wrong', () => {
    const ds = getDataset('mouse_pomc_maternal_hfd_gse135639')!;
    // Both surviving diet contrasts have to disown the source paper, because a
    // null volcano on a comparison the study never ran reads as "the study
    // found nothing" otherwise. Each also names its own age, since that is now
    // the only thing distinguishing them.
    //
    // The old assertion here was `/not the raw difference/` on the age-adjusted
    // contrast — a warning that its coefficient did not match the per-sample
    // bars drawn beneath it. That contrast is gone, and the warning does not
    // transfer: a cell contrast IS the plain difference between the two arms it
    // draws, which is the point of preferring it.
    for (const id of ['hfd_vs_chow_p0', 'hfd_vs_chow_p21']) {
      const c = ds.contrasts.find((x) => x.id === id)!;
      expect(c.description, id).toMatch(/not a contrast from the source paper/i);
      expect(c.exploratory, id).toBe(true);
      expect(c.label, id).toMatch(id === 'hfd_vs_chow_p0' ? /P0/ : /P21/);
    }
    expect(ds.contrasts.every((c) => !/age-adjusted/i.test(c.label ?? ''))).toBe(true);
  });
});

// R 4.6.0 regeneration (2026-09-25): count datasets ship the DE fit's TMM CPM and
// are labelled CPM_TMM_UNIT. The September 5 registry file is byte-pinned and
// keeps its legacy 'CPM', so the registry relabels it; this pins that the
// relabel covers exactly the studies whose value tables are TMM CPM.
describe('regenerated count datasets carry the TMM CPM unit', () => {
  it('labels September 5 studies by the kind of value table they ship', async () => {
    const { CPM_TMM_UNIT } = await import('../data/expressionUnits');
    const studies = (await import('../data/september5Studies.generated.json')).default as Array<{ id: string; geo: string }>;
    const analyses = (await import('../../data/intake/september5-2026/analyses.json')).default as Array<{ accession: string; analysisId: string }>;
    const sidecar = (await import('../../data/intake/regeneration-r460-2026-09-25.json')).default as {
      intakes: Record<string, Record<string, { kind: string }>>;
    };
    const kinds = sidecar.intakes['september5-2026'];
    for (const study of studies) {
      const studyKinds = new Set(analyses.filter((a) => a.accession === study.geo).map((a) => kinds[a.analysisId]?.kind));
      expect(studyKinds.size, study.id).toBe(1);
      const unit = getDataset(study.id)!.expressionUnit;
      if (studyKinds.has('cpm_tmm')) expect(unit, study.id).toBe(CPM_TMM_UNIT);
      else expect(unit, study.id).not.toMatch(/^CPM/);
    }
  });

  it('never leaves the plain pre-regeneration CPM label on a registered dataset', () => {
    expect(DATASETS.filter((d) => d.expressionUnit === 'CPM').map((d) => d.id)).toEqual([]);
  });
});
