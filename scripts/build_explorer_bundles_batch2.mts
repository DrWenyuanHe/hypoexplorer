// Build explorer bundles for the 2026 batch-2 mouse datasets processed into
// geo_replication (config/datasets.tsv → processed/<id>_DE.tsv + the symbol-level
// expression table + samplesheet). Generic + samplesheet-driven (unlike the
// bespoke build_geo_datasets.mts), so adding a dataset is a one-line MANIFEST entry.
//
// Since the R 4.6.0 regeneration (2026-09-25) every input is symbol-keyed and
// unique per public symbol (scripts/lib/regenTables.mts): count datasets ship the
// DE fit's own TMM CPM (<id>_CPM_TMM.tsv.gz, unit CPM_TMM_UNIT) and matrix
// datasets their deposited-scale <id>_expression.tsv.gz. Nothing is deduplicated
// or summed here any more; duplicates and unit/registry disagreements throw.
//
// Output (contract-shaped, see docs/DATASET_CONTRACT.md):
//   public/datasets/<websiteId>/meta.js       -> HX_<DSID>_META
//   public/datasets/<websiteId>/track_<t>.js  -> HX_<DSID>_<TRACK>
//   public/datasets/<websiteId>/qc_global.js  -> HX_<DSID>_QC
//
// Bundles are self-contained static JS globals served from public/datasets/ and
// loaded with `bundleBaseUrl + file?v=APP_VERSION` — so they can be moved to
// Cloudflare R2 / any CDN later by setting bundleBaseUrl (VITE_BUNDLE_BASE_URL).
// FGSEA is only persisted for the 2 focal IGF pathways (not a browsable set) →
// supportsPathways:false, pathways:null, matching the other mouse bulk datasets.
//
// Run: tsx scripts/build_explorer_bundles_batch2.mts
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultContrastBinding, outDirFromArgv, requireDataset, writeDatasetBundles } from './lib/bundleWriter.mjs';
import { seFromStat } from '../src/utils/seRecovery';
import { assertRectangular } from './lib/matrixShape.mjs';
import { rankScore, numCell } from './lib/deTable.mjs';
import {
  CPM_TMM_UNIT, assertUniqueKeys, expressionSource, readSymbolDe, readSymbolMatrix, readSymbolSe,
} from './lib/regenTables.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GEO = resolve(ROOT, 'geo_replication');
const OUT_ROOT = outDirFromArgv();

interface ManifestEntry {
  geoId: string;
  websiteId: string;
  trackId: string;
  trackLabel: string;
  color: string;
  armKeys: readonly [string, string];
  /**
   * Axis/export unit label for the expression values (docs/DATASET_CONTRACT.md).
   * Omit for the count datasets — they ship the DE fit's TMM CPM and are
   * labelled CPM_TMM_UNIT. REQUIRED for an input_kind=matrix dataset, whose
   * values are passed through as the upstream analysis normalized them (e.g.
   * 'log2 FPKM'). Must equal the registry's expressionUnit either way.
   */
  expressionUnit?: string;
}
const MANIFEST: ManifestEntry[] = [
  { geoId: 'GSE284408', websiteId: 'mouse_arc_hfd_gse284408',
    trackId: 'arcuate', trackLabel: 'Arcuate nucleus (bulk)',
    color: '#E15759', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE235479', websiteId: 'mouse_hypo_hfhs_gse235479',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#F28E2B', armKeys: ['control', 'case'] as const, },
  { geoId: 'E-MTAB-6929', websiteId: 'mouse_hypo_hfd_emtab6929',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#4E79A7', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE167264', websiteId: 'mouse_hypo_obob_gse167264',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#76B7B2', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE314029', websiteId: 'mouse_hypo_glp1_gse314029',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#59A14F', armKeys: ['control', 'case'] as const, },
  // ── 2026 within-niche metabolic additions (single-contrast; supportsPathways:false) ──
  { geoId: 'GSE294478', websiteId: 'mouse_hypo_fasting_gse294478',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#B07AA1', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE247825', websiteId: 'mouse_hypo_overfeed_gse247825',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#9C755F', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE305719', websiteId: 'mouse_hypo_hfd_tc_gse305719',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#EDC948', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE236077', websiteId: 'mouse_hypo_hfd_gse236077',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#FF9DA7', armKeys: ['control', 'case'] as const, },
  // ── 2026 cell-type-resolved metabolic additions (TRAP/bacTRAP translatome; supportsPathways:false) ──
  { geoId: 'GSE214683', websiteId: 'mouse_hypo_astro_trap_gse214683',
    trackId: 'astrocytes', trackLabel: 'Hypothalamic astrocytes (TRAP)',
    color: '#8CD17D', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE292416', websiteId: 'mouse_arc_pnoc_trap_gse292416',
    trackId: 'pnoc', trackLabel: 'Arcuate PNOC neurons (bacTRAP)',
    color: '#D4A6C8', armKeys: ['control', 'case'] as const, },
  // ── PVN nucleus addition (promoted from the prior shortlist; chow vs HFD, drop minocycline arm) ──
  { geoId: 'GSE198437', websiteId: 'mouse_pvn_hfd_gse198437',
    trackId: 'pvn', trackLabel: 'Paraventricular nucleus (PVN)',
    color: '#F1A340', armKeys: ['control', 'case'] as const, },
  // ── Neuroimmune axis: hypothalamic Tregs, SD vs HFD ──
  { geoId: 'GSE282067', websiteId: 'mouse_hypo_treg_gse282067',
    trackId: 'treg', trackLabel: 'Hypothalamic Tregs (sorted)',
    color: '#17BECF', armKeys: ['control', 'case'] as const, },
  // ── Chronic-DIO whole-hypothalamus (fetched + processed this session; closest match to the chronic 60% HFD paradigm) ──
  { geoId: 'GSE329539', websiteId: 'mouse_hypo_obesity_gse329539',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#D37295', armKeys: ['control', 'case'] as const, },
  // ── Batch-3: GEO-fetched + edgeR-QL processed this session ──
  { geoId: 'GSE68177', websiteId: 'mouse_agrp_fedfast_gse68177',
    trackId: 'agrp', trackLabel: 'Arcuate AGRP neurons (FACS)',
    color: '#9467BD', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE162673', websiteId: 'mouse_hypo_hypoxia_gse162673',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#8C564B', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE148641', websiteId: 'mouse_arc_reverb_gse148641',
    trackId: 'arcuate', trackLabel: 'Arcuate nucleus (ARC)',
    color: '#E377C2', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE123983', websiteId: 'mouse_leprb_stat3_gse123983',
    trackId: 'leprb', trackLabel: 'LepRb neurons (TRAP)',
    color: '#7F7F7F', armKeys: ['control', 'case'] as const, },
  // ── Batch-4: GEO-fetched + edgeR-QL processed this session (reproduction / circadian / tanycyte / incretin / insulin / aging) ──
  { geoId: 'GSE285006', websiteId: 'mouse_poa_fgf_gse285006',
    trackId: 'poa', trackLabel: 'Preoptic area (POA)',
    color: '#BAB0AC', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE328990', websiteId: 'mouse_hypo_pomc_estrogen_gse328990',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#FF9DA7', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE162744', websiteId: 'mouse_hypo_maternal_protein_gse162744',
    // LP / HP are GEO's group codes for Low-fat + PBS and High-fat + PBS — the
    // second letter is the postnatal injection, not a macronutrient. Registered
    // here as a protein study until 2026-08-27; it is a maternal OBESITY study.
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#86BCB6', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE305688', websiteId: 'mouse_hypo_maternal_care_gse305688',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#F1CE63', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE252364', websiteId: 'mouse_scn_mcd_gse252364',
    trackId: 'scn', trackLabel: 'Suprachiasmatic nucleus (SCN)',
    color: '#A0CBE8', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE248462', websiteId: 'mouse_arc_clock_gse248462',
    trackId: 'arcuate', trackLabel: 'Arcuate nucleus (ARC)',
    color: '#B6992D', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE185074', websiteId: 'mouse_tanycyte_insulin_gse185074',
    trackId: 'tanycyte', trackLabel: 'Tanycytes (BAC-TRAP)',
    color: '#499894', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE160802', websiteId: 'mouse_arc_pyy_glp1_gse160802',
    trackId: 'arcuate', trackLabel: 'Arcuate nucleus (ARC)',
    color: '#D7B5A6', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE132352', websiteId: 'mouse_hypo_insulin_gse132352',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#79706E', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE280382', websiteId: 'mouse_hypo_aging_glp1r_gse280382',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#FABFD2', armKeys: ['control', 'case'] as const, },
  // ── Batch-5: GEO-fetched + edgeR-QL processed this session (stress, antipsychotic/MC4R, dopamine-POMC, androgenization, hibernation, FGF1, diabetes, cachexia) ──
  { geoId: 'GSE246918', websiteId: 'mouse_arc_kcnb1_gse246918',
    trackId: 'arcuate', trackLabel: 'Arcuate nucleus (ARC)',
    color: '#4E79A7', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE158751', websiteId: 'mouse_hypo_risperidone_gse158751',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#F28E2B', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE210311', websiteId: 'mouse_arc_pomc_drd2_gse210311',
    trackId: 'pomc', trackLabel: 'Arcuate POMC neurons (RiboTag)',
    color: '#76B7B2', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE190712', websiteId: 'mouse_pvn_dex_gse190712',
    trackId: 'pvn', trackLabel: 'Paraventricular nucleus (PVN)',
    color: '#E15759', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE162563', websiteId: 'mouse_gnrh_androgen_gse162563',
    trackId: 'poa', trackLabel: 'GnRH / preoptic area (TRAP)',
    color: '#B07AA1', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE295250', websiteId: 'mouse_hypo_hibernation_gse295250',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#59A14F', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE153551', websiteId: 'mouse_hypo_obob_fgf1_gse153551',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus (ob/ob)',
    color: '#EDC948', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE329555', websiteId: 'mouse_hypo_diabetes_gse329555',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#FF9DA7', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE285906', websiteId: 'mouse_hypo_oxaliplatin_gse285906',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#9C755F', armKeys: ['control', 'case'] as const, },
  // ── POMC arm of GSE68177 (sorted POMC neurons fed vs fasted) — the second cell
  //    type from He/Belsham's IGF1 fasting reanalysis (the AgRP arm is above).
  //    geoId is a synthetic id (shares the GSE68177 count matrix); geo stays GSE68177.
  { geoId: 'GSE68177_POMC', websiteId: 'mouse_pomc_fedfast_gse68177',
    trackId: 'pomc', trackLabel: 'Arcuate POMC neurons (FACS)',
    color: '#E45756', armKeys: ['control', 'case'] as const, },
  // ── Batch-6 (2026-08): GEO-fetched + edgeR-QL processed this session. Adds the VMH as a
  //    region, MACS-sorted hypothalamic astrocytes, an AgRP NuTRAP translatome and an
  //    oxytocin-neuron RiboTag translatome, plus fasting / pharmacology depth.
  { geoId: 'GSE181204', websiteId: 'mouse_vmhvl_estradiol_gse181204',
    trackId: 'vmhvl', trackLabel: 'Ventrolateral VMH (VMHvl)',
    color: '#4E79A7', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE205313', websiteId: 'mouse_hypo_astro_hfhs_gse205313',
    trackId: 'astrocytes', trackLabel: 'Hypothalamic astrocytes (ACSA-2+)',
    color: '#8CD17D', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE212299', websiteId: 'mouse_hypo_abi3_gse212299',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#E15759', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE217420', websiteId: 'mouse_hypo_ube3a_gse217420',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#B07AA1', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE224780', websiteId: 'mouse_hypo_cox10_gse224780',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#79706E', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE229838', websiteId: 'mouse_hypo_pel_gse229838',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#9C755F', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE234483', websiteId: 'mouse_hypo_glylow_gse234483',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#EDC948', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE240484', websiteId: 'mouse_arc_agrp_trap_gse240484',
    trackId: 'agrp', trackLabel: 'Arcuate AGRP neurons (NuTRAP)',
    color: '#9467BD', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE242187', websiteId: 'mouse_hypo_maternal_hcd_gse242187',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#86BCB6', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE242245', websiteId: 'mouse_hypo_oxt_trap_gse242245',
    trackId: 'oxytocin', trackLabel: 'Oxytocin neurons (RiboTag)',
    color: '#17BECF', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE245727', websiteId: 'mouse_hypo_glp1_gse245727',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#59A14F', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE252779', websiteId: 'mouse_hypo_celastrol_gse252779',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#D37295', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE235792', websiteId: 'mouse_hypo_diabetes_gse235792',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#C44E52', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE254155', websiteId: 'mouse_hypo_fedfast_gse254155',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#F28E2B', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE289833', websiteId: 'mouse_hypo_fasting_gse289833',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#D37295', armKeys: ['control', 'case'] as const, },
  // ── Aging module: validated chronological-age contrasts ─────────────────
  { geoId: 'GSE240365', websiteId: 'mouse_hypo_aging_gse240365',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#7B61A8', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE314817_6v27mo', websiteId: 'mouse_hypo_aging_gse314817',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#9B77C8', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE201207_young_vs_old', websiteId: 'mouse_hypo_circadian_aging_gse201207',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#B28ACF', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE212336', websiteId: 'mouse_hypo_aging_gse212336',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#7651A8', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE99791', websiteId: 'mouse_hypo_astro_aging_gse99791',
    trackId: 'astrocytes', trackLabel: 'Hypothalamic astrocytes (GFAP-RiboTag IP)',
    color: '#9B77C8', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE270383', websiteId: 'mouse_hypo_spatial_aging_gse270383',
    trackId: 'hypothalamus', trackLabel: 'Hypothalamus (spatial animal pseudobulk)',
    color: '#8F6BB3', armKeys: ['control', 'case'] as const, },
  // A fixed-age dietary intervention belongs with feeding/fasting, not the
  // direct chronological-age section.
  { geoId: 'GSE273038', websiteId: 'mouse_hypo_spatial_cr_gse273038',
    trackId: 'hypothalamus', trackLabel: 'Hypothalamus (spatial animal pseudobulk)',
    color: '#4E9F8A', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE227689', websiteId: 'mouse_hypo_dr_gse227689',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#4E9F8A', armKeys: ['control', 'case'] as const, },
  // ── Bulk continuation: independent in-vivo units (or culture replicates) ──
  { geoId: 'GSE232510', websiteId: 'rat_arc_hfd_gse232510',
    trackId: 'arcuate', trackLabel: 'Arcuate nucleus (ARC)',
    color: '#E76F51', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE229440', websiteId: 'mouse_hypo_prenatal_benzene_gse229440',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus (litter aggregate)',
    color: '#8C564B', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE280030', websiteId: 'mouse_mhypoa_palmitate_gse280030',
    trackId: 'mhypoa', trackLabel: 'mHypoA-2/12 hypothalamic neurons',
    color: '#D37295', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE168151', websiteId: 'rat_mbh_edc_gse168151',
    trackId: 'mbh_poa', trackLabel: 'Mediobasal hypothalamus / preoptic area',
    color: '#B07AA1', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE175461', websiteId: 'rat_son_dehydration_gse175461',
    trackId: 'son', trackLabel: 'Supraoptic nucleus (SON)',
    color: '#4E79A7', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE145431', websiteId: 'rat_pvn_sodium_depletion_gse145431',
    trackId: 'pvn', trackLabel: 'Paraventricular nucleus (PVN)',
    color: '#59A14F', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE225359', websiteId: 'rat_mbh_perinatal_des_gse225359',
    trackId: 'mbh', trackLabel: 'Mediobasal hypothalamus (MBH)',
    color: '#F28E2B', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE169296', websiteId: 'rat_pvn_adolescent_stress_gse169296',
    trackId: 'pvn', trackLabel: 'Paraventricular nucleus (PVN)',
    color: '#E15759', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE242354', websiteId: 'rat_hypo_exercise_gse242354',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#2A9D8F', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(CPM + 1)', },
  { geoId: 'GSE124693', websiteId: 'mouse_agrp_fedfast_gse124693',
    trackId: 'agrp', trackLabel: 'Arcuate AgRP neurons (RiboTag)',
    color: '#9467BD', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(DESeq2-normalized count + 1)', },
  { geoId: 'GSE96627', websiteId: 'mouse_arc_fasting_gse96627',
    trackId: 'arcuate', trackLabel: 'Arcuate nucleus (laser capture)',
    color: '#F4A261', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(RPKM + 1)', },
  { geoId: 'GSE174753', websiteId: 'rat_poa_lbn_gse174753',
    trackId: 'poa', trackLabel: 'Medial preoptic area (mPOA)',
    color: '#8C564B', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(gene-summed FPKM + 1)', },
  { geoId: 'GSE133293', websiteId: 'rat_hypo_ozone_gse133293',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#86BCB6', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(DESeq2-normalized count + 1)', },
  { geoId: 'GSE160467', websiteId: 'mouse_gt17_mkrn3_gse160467',
    trackId: 'gt17', trackLabel: 'GT1-7 hypothalamic neurons',
    color: '#4E79A7', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE270378', websiteId: 'mouse_mhypoa_cbd_gse270378',
    trackId: 'mhypoa', trackLabel: 'mHypoA-2/12 hypothalamic neurons',
    color: '#59A14F', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE275887', websiteId: 'mouse_hypothalamic_cells_mogroside_gse275887',
    trackId: 'hypothalamic_cells', trackLabel: 'Cultured adult mouse hypothalamic neurons',
    color: '#F28E2B', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE229799', websiteId: 'mouse_hypo_clic1_gse229799',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#6C5CE7', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(RSEM-normalized expression + 1)', },
  { geoId: 'GSE296488', websiteId: 'mouse_arc_cagrilintide_gse296488',
    trackId: 'arcuate', trackLabel: 'Arcuate nucleus (ARC)',
    color: '#E76F51', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(gene-summed TPM + 1)', },
  { geoId: 'GSE281503', websiteId: 'mouse_hypo_lps_gse281503',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#D47AAE', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE261833', websiteId: 'rat_pvn_stress_gse261833',
    trackId: 'pvn', trackLabel: 'Paraventricular nucleus (PVN)',
    color: '#8C564B', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(FPKM + 1)', },
  { geoId: 'GSE128537', websiteId: 'macaque_hypo_aging_gse128537',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#7651A8', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE102415', websiteId: 'mouse_hypo_glp1_dexa_gse102415',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#2A9D8F', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE253875', websiteId: 'mouse_gt17_alisolb_gse253875',
    trackId: 'gt17', trackLabel: 'GT1-7 hypothalamic GnRH neurons',
    color: '#E15759', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE243287', websiteId: 'mouse_hypo_smc3_gse243287',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#4E79A7', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(normalized CPM + 1)', },
  // ── Tracker continuation: non-bulk RNA-seq, animal-level pseudobulk ───
  { geoId: 'GSE212491', websiteId: 'mouse_hypo_akkermansia_gse212491',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus (Drop-seq pseudobulk)',
    color: '#2A9D8F', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE143818', websiteId: 'mouse_vmh_sf1_sex_gse143818',
    trackId: 'vmh_sf1', trackLabel: 'VMH Sf1-lineage neurons (mouse pseudobulk)',
    color: '#D47AAE', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE130597', websiteId: 'mouse_lha_hfd_gse130597',
    trackId: 'lha', trackLabel: 'Lateral hypothalamus (all-cell pseudobulk)',
    color: '#E76F51', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE174085', websiteId: 'mouse_pvn_crh_ela_gse174085',
    trackId: 'crh_pvn', trackLabel: 'PVN CRH neurons (animal pseudobulk)',
    color: '#8C564B', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE289461', websiteId: 'mouse_arc_mettl14_gse289461',
    trackId: 'arcuate', trackLabel: 'Arcuate nucleus (mouse pseudobulk)',
    color: '#6C5CE7', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE87544', websiteId: 'mouse_hypo_fasting_gse87544',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus (mouse pseudobulk)',
    color: '#F4A261', armKeys: ['control', 'case'] as const, },
  // ── Bulk continuation C: normalized matrices, count inputs, paired TRAP ─
  { geoId: 'GSE218188', websiteId: 'mouse_hypo_cp_ins2_gse218188',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#2A9D8F', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(DESeq2-normalized count + 1)', },
  { geoId: 'GSE56238', websiteId: 'rat_hypo_fructose_gse56238',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#F4A261', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(FPKM + 1)', },
  { geoId: 'GSE100349', websiteId: 'rat_hypo_hfd_wtts_gse100349',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus (WTTS-seq)',
    color: '#E76F51', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE314970', websiteId: 'rat_hypo_aging_gse314970',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#8F6BB3', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE306829', websiteId: 'mouse_mpoa_pnoc_bactrap_gse306829',
    trackId: 'mpoa', trackLabel: 'Medial preoptic PNOC neurons (BacTRAP)',
    color: '#9467BD', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE102471', websiteId: 'rat_mbh_eed_gse102471',
    trackId: 'mbh', trackLabel: 'Mediobasal hypothalamus (MBH)',
    color: '#D35D8B', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE330152', websiteId: 'rat_vmh_hfd_gse330152',
    trackId: 'vmh', trackLabel: 'Ventromedial hypothalamus (VMH)',
    color: '#E76F51', armKeys: ['control', 'case'] as const,
    expressionUnit: 'variance-stabilized expression (VST)', },
  { geoId: 'GSE95243', websiteId: 'human_ipsc_hypo_obesity_gse95243',
    trackId: 'hypothalamic_neurons', trackLabel: 'iPSC-derived hypothalamic neurons',
    color: '#D35D8B', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE98519', websiteId: 'mouse_hypo_lef1_gse98519',
    trackId: 'hypothalamus', trackLabel: 'P22 whole hypothalamus',
    color: '#6C5CE7', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE98690', websiteId: 'mouse_vmh_thrb_gse98690',
    trackId: 'vmh', trackLabel: 'Ventromedial hypothalamus (VMH)',
    color: '#E76F51', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2 counts per million (log2-CPM)', },
  { geoId: 'GSE99690', websiteId: 'mouse_gt17_orexin_gse99690',
    trackId: 'gt17', trackLabel: 'GT1-7 hypothalamic neurons',
    color: '#4E79A7', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE132308', websiteId: 'mouse_vlpo_galanin_sleep_gse132308',
    trackId: 'vlpo_galanin', trackLabel: 'VLPO galanin neurons (LCM)',
    color: '#7651A8', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE214877', websiteId: 'human_htnsc_differentiation_gse214877',
    trackId: 'hypothalamic_nsc', trackLabel: 'Hypothalamic neural stem-cell model',
    color: '#D35D8B', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE229159', websiteId: 'rat_rph_noise_stress_gse229159',
    trackId: 'rph', trackLabel: 'Rostral posterior hypothalamus (rPH)',
    color: '#8C564B', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE264350', websiteId: 'mouse_hypo_crd_gse264350',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#A0CBE8', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(FPKM + 1)', },
  { geoId: 'GSE298648', websiteId: 'chicken_poah_ehc_gse298648',
    trackId: 'poah', trackLabel: 'Pre-optic anterior hypothalamic area (POAH)',
    color: '#E76F51', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE131172', websiteId: 'mouse_hypo_estrous_cycle_gse131172',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#F28E2B', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(FPKM + 1)', },
  { geoId: 'E-MTAB-12340', websiteId: 'mouse_hypo_puberty_emtab12340',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#B279A2', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE128148', websiteId: 'mouse_arc_corticosterone_gse128148',
    trackId: 'arc', trackLabel: 'Arcuate nucleus (LCM)',
    color: '#E15759', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE156859', websiteId: 'rat_fetal_hypo_ozone_gse156859',
    trackId: 'fetal_hypothalamus', trackLabel: 'Whole fetal hypothalamus',
    color: '#76B7B2', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(CPM + 0.0001)', },
  { geoId: 'GSE167105', websiteId: 'mouse_hypo_thrb_k146q_gse167105',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#59A14F', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(author-normalized expression + 1)', },
  { geoId: 'GSE189945', websiteId: 'mouse_arc_neun_development_gse189945',
    trackId: 'arc_neun', trackLabel: 'Arcuate NeuN-positive nuclei',
    color: '#EDC949', armKeys: ['control', 'case'] as const,
    expressionUnit: 'DESeq2 variance-stabilized expression', },
  { geoId: 'GSE190389', websiteId: 'mouse_scn_trf_gse190389',
    trackId: 'scn', trackLabel: 'Suprachiasmatic nucleus',
    color: '#4E79A7', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE204883', websiteId: 'hamster_tanycyte_photoperiod_gse204883',
    trackId: 'tanycytes', trackLabel: 'Third-ventricle tanycytes (LCM)',
    color: '#76B7B2', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE179663', websiteId: 'hamster_hypo_torpor_gse179663',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#F28E2B', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE104255', websiteId: 'chicken_hypo_development_gse104255',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#4E79A7', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE141144', websiteId: 'zebrafish_hypo_fluoxetine_gse141144',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#59A14F', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE202003', websiteId: 'chicken_hypo_lcitrulline_gse202003',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#EDC949', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE227725', websiteId: 'pig_hypo_mia_gse227725',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#AF7AA1', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(TPM + 1)', },
  { geoId: 'GSE201408', websiteId: 'pig_hypo_genotype_gse201408',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#E15759', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(author-normalized expression + 1)', },
  { geoId: 'GSE274003', websiteId: 'hamster_mbh_photoperiod_gse274003',
    trackId: 'mbh', trackLabel: 'Mediobasal hypothalamus',
    color: '#76B7B2', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE207494', websiteId: 'dormouse_hypo_torpor_gse207494',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#9C755F', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE207992', websiteId: 'mouse_scn_exercise_gse207992',
    trackId: 'scn', trackLabel: 'Suprachiasmatic nucleus (LCM)',
    color: '#59A14F', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(DESeq2-normalized count + 1)', },
  { geoId: 'GSE208722', websiteId: 'human_hypo_neuron_mkrn3_gse208722',
    trackId: 'hypothalamic_neurons', trackLabel: 'iPSC-derived hypothalamic neurons',
    color: '#D35D8B', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE243697', websiteId: 'mouse_hypo_plx3397_gse243697',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#AF7AA1', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE128660', websiteId: 'mouse_hypo_heat_stress_gse128660',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#E15759', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(FPKM + 1)', },
  { geoId: 'GSE245146', websiteId: 'pig_hypo_mia_gse245146',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#AF7AA1', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(TPM + 1)', },
  { geoId: 'GSE266472', websiteId: 'mouse_scn_photoperiod_gse266472',
    trackId: 'scn', trackLabel: 'Suprachiasmatic nucleus',
    color: '#4E79A7', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE278826', websiteId: 'chicken_hypo_rfi_gse278826',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#F28E2B', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE281726', websiteId: 'pig_hypo_formula_gse281726',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#59A14F', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE299412', websiteId: 'zebrafish_hypo_cyp19a1b_gse299412',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#E15759', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE231617', websiteId: 'rat_son_aging_gse231617',
    trackId: 'son', trackLabel: 'Supraoptic nucleus',
    color: '#8C564B', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(DESeq2-normalized count + 1)', },
  { geoId: 'GSE231769', websiteId: 'mouse_mbh_maternal_emulsifier_gse231769',
    trackId: 'mbh', trackLabel: 'Mediobasal hypothalamus',
    color: '#F28E2B', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2 CPM (TMM-normalized)', },
  { geoId: 'GSE224254', websiteId: 'mouse_sst_neuron_sex_gse224254',
    trackId: 'sst_neurons', trackLabel: 'Tuberal-hypothalamic SST neurons (FACS)',
    color: '#D47AAE', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE153495', websiteId: 'cattle_hypo_nutrition_gse153495',
    trackId: 'hypothalamus', trackLabel: 'Remaining hypothalamus',
    color: '#4E79A7', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(TMM-normalized count abundance + 1)', },
  { geoId: 'GSE153498', websiteId: 'cattle_arc_nutrition_gse153498',
    trackId: 'arcuate', trackLabel: 'Arcuate nucleus region',
    color: '#F28E2B', armKeys: ['control', 'case'] as const,
    expressionUnit: 'log2(TMM-normalized count abundance + 1)', },
  { geoId: 'GSE301692', websiteId: 'human_hypo_pituitary_organoid_gse301692',
    trackId: 'organoid', trackLabel: 'Hypothalamus-pituitary organoid',
    color: '#B279A2', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE324226', websiteId: 'pig_hypo_low_growth_gse324226',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#59A14F', armKeys: ['control', 'case'] as const, },
  { geoId: 'GSE49540', websiteId: 'cattle_hypo_diet_restriction_gse49540',
    trackId: 'hypothalamus', trackLabel: 'Whole hypothalamus',
    color: '#E15759', armKeys: ['control', 'case'] as const, },
];

const parseDelim = (text: string, delim: string | RegExp, label = 'matrix') => {
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  // Whitespace-delimited matrices (e.g. GSE214683) split on a regex; trim first
  // so a leading space doesn't yield a phantom empty first field. Tab/comma keep
  // the plain string split. Strip surrounding double-quotes per field so quoted
  // CSV matrices (e.g. GSE285006 "col","val") parse identically to R's
  // quote-aware read.delim — our matrices never contain in-field delimiters.
  const split = (l: string) =>
    (delim instanceof RegExp ? l.trim().split(delim) : l.split(delim)).map((f) =>
      f.length > 1 && f.charCodeAt(0) === 34 && f.charCodeAt(f.length - 1) === 34 ? f.slice(1, -1) : f,
    );
  const header = split(lines[0]);
  const parsed = lines.slice(1).map(split);
  assertRectangular(label, header, parsed[0]);
  return { header, rows: parsed };
};
// rankScore and numCell come from scripts/lib/deTable.mts, beside the header
// contract they belong with — this file used to carry its own copies of both
// and no header assertion at all.

// Read the FGSEA tables produced by scripts/run_mouse_fgsea.R into a
// PathwayDatabase ({GO_BP,HALLMARK,KEGG,REACTOME}); null when none exist yet.
const PW_DBS = ['GO_BP', 'HALLMARK', 'KEGG', 'REACTOME'] as const;
function readPathways(dir: string, geoId: string) {
  const out: Record<string, Array<Record<string, unknown>>> = {};
  for (const db of PW_DBS) {
    const p = resolve(GEO, dir, 'processed', `${geoId}_FGSEA_${db}.tsv`);
    if (!existsSync(p)) continue;
    const t = parseDelim(readFileSync(p, 'utf8'), '\t', p);
    const ix = Object.fromEntries(t.header.map((h, i) => [h, i]));
    out[db] = t.rows.map((row) => {
      const NES = numCell(row[ix.NES]);
      return {
        pathway: row[ix.pathway],
        pval: numCell(row[ix.pval]),
        padj: numCell(row[ix.padj]),
        NES: Number.isFinite(NES) ? +NES.toFixed(4) : NES,
        size: +row[ix.size],
        leadingEdge: (row[ix.leadingEdge] ?? '').split(';').filter(Boolean),
      };
      // Drop fgsea's NA rows (unbalanced gene-level stats → pval/padj/NES = NA,
      // written by fwrite as an empty string — numCell maps those to NaN).
    }).filter((p) => Number.isFinite(p.pval) && Number.isFinite(p.padj) && Number.isFinite(p.NES));
  }
  return Object.keys(out).length ? out : null;
}

// config/datasets.tsv lookup
const cfgText = readFileSync(resolve(GEO, 'config/datasets.tsv'), 'utf8').trim().split('\n');
const cfgHead = cfgText[0].split('\t');
const cfg = cfgText.slice(1).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [cfgHead[i], v])));

function build(m: ManifestEntry) {
  const dataset = requireDataset(m.websiteId);
  const r = cfg.find((c) => c.id === m.geoId);
  if (!r) throw new Error(`${m.geoId} not in config/datasets.tsv`);
  console.log(`${m.geoId} → ${m.websiteId}:`);

  const processed = resolve(GEO, r.dir, 'processed');
  // ---- DE table: symbol-keyed, one row per public symbol --------------------
  const deTable = readSymbolDe(resolve(processed, `${m.geoId}_DE.tsv`), `${m.geoId}_DE.tsv`);
  // Per-gene SE from scripts/compute_edger_se.R. edgeR-QL SEs cannot be derived
  // from the reported statistic (see src/utils/seRecovery.ts), so a dataset
  // without this sidecar emits no `se` and abstains from inverse-variance
  // pooling rather than entering it on a proxy.
  const seBySymbol = readSymbolSe(resolve(processed, `${r.id}_SE.tsv`), `${r.id}_SE.tsv`);

  // ---- samplesheet → control/case sample columns ----
  const ssText = readFileSync(resolve(GEO, r.samplesheet), 'utf8').trim().split(/\r?\n/);
  const ssHead = ssText[0].split('\t');
  const sIdx = ssHead.indexOf('sample'), gIdx = ssHead.indexOf('group');
  const ss = ssText.slice(1).map((l) => l.split('\t'));
  const control = ss.filter((c) => c[gIdx] === 'control').map((c) => c[sIdx]);
  const caseS = ss.filter((c) => c[gIdx] === 'case').map((c) => c[sIdx]);
  const order = [...control, ...caseS];
  assertUniqueKeys(order, `${m.geoId} samplesheet`);
  console.log(`  control(${control.length}) + case(${caseS.length})`);

  // ---- expression values: symbol-level table written by the DE run ----------
  //   input_kind=counts → <id>_CPM_TMM.tsv.gz: counts / (filtered library size x
  //     the fit's TMM factor) x 1e6, over the fit's full feature set.
  //   input_kind=matrix → <id>_expression.tsv.gz: the deposited values after the
  //     same symbol aggregation the fit used; meta.expressionUnit says what they are.
  const isMatrix = r.input_kind === 'matrix';
  if (isMatrix && !m.expressionUnit)
    throw new Error(`${m.geoId}: input_kind=matrix requires an explicit expressionUnit in MANIFEST`);
  if (!isMatrix && m.expressionUnit)
    throw new Error(`${m.geoId}: a count dataset ships TMM CPM; drop the MANIFEST expressionUnit override`);
  const expressionUnit = isMatrix ? m.expressionUnit! : CPM_TMM_UNIT;
  if (dataset.expressionUnit !== expressionUnit) {
    throw new Error(`${m.geoId}: registry expressionUnit "${dataset.expressionUnit}" != bundle unit "${expressionUnit}"`);
  }
  const source = expressionSource(processed, m.geoId, r.input_kind);
  const expr = readSymbolMatrix(source.path, order, `${m.geoId} ${source.kind}`);

  // ---- finalize track (every published DE symbol has values; rank) ----------
  const absent = deTable.filter((d) => !expr.has(d.gene)).map((d) => d.gene);
  if (absent.length) {
    throw new Error(`${m.geoId}: ${absent.length} DE symbol(s) missing from ${source.path}: ${absent.slice(0, 5).join(', ')}`);
  }
  const deFinal = deTable
    .map((d) => ({
      gene: d.gene, logFC: +d.logFC.toFixed(4), logCPM: null, PValue: d.PValue, FDR: d.FDR,
      se: seFromStat(d.logFC, d.stat, d.method, seBySymbol.get(d.gene)), rank_score: rankScore(d.logFC, d.FDR),
    }))
    .sort((a, b) => b.rank_score - a.rank_score)
    .map((d, i) => ({ ...d, rankPos: i + 1 }));
  const cpm: Record<string, number[]> = {};
  for (const d of deFinal) cpm[d.gene] = expr.get(d.gene)!.map((v) => +v.toFixed(4));
  const nSig = deFinal.filter((d) => d.PValue < 0.01).length;
  const is3v3 = control.length === caseS.length && control.length === 3;

  const trackObj = {
    meta: {
      code: m.trackId, label: m.trackLabel, type: 'Tissue', nGenes: deFinal.length,
      sampleOrder: order,
      groupSamples: { [m.armKeys[0]]: control, [m.armKeys[1]]: caseS },
      expressionUnit,
    },
    qc: {
      cluster: m.trackId, clusterLabel: m.trackLabel, minCells: 0,
      nNormal: control.length, nObese: caseS.length, is3v3, samplesKept: order,
    },
    de: deFinal, cpm,
  };
  // Pathways live in a SIBLING bundle (track_<id>.pathways.js), not in the track —
  // so the cross-dataset gene query / single-track loads don't pay the FGSEA tax.
  const pathways = readPathways(r.dir, m.geoId);
  writeDatasetBundles(dataset, [{
    trackId: m.trackId,
    armKeys: m.armKeys,
    defaultContrastBinding: defaultContrastBinding(dataset, m.armKeys),
    color: m.color,
    nSig,
    meta: trackObj.meta,
    qc: trackObj.qc,
    de: deFinal,
    cpm,
    pathways,
  }], { outRoot: OUT_ROOT });
  const ig = deFinal.find((d) => ['IGFBP2', 'IGFBP5'].includes(d.gene.toUpperCase()));
  console.log(`  genes:${deFinal.length} nSig(P<.01):${nSig} | ${ig ? `${ig.gene} logFC=${ig.logFC}` : 'no IGFBP'} → public/datasets/${m.websiteId}/`);
}

const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const only = new Set((onlyArg?.slice('--only='.length) ?? '').split(',').filter(Boolean));
const selected = only.size
  ? MANIFEST.filter((m) => only.has(m.geoId) || only.has(m.websiteId))
  : MANIFEST;
if (only.size) {
  const matched = new Set(selected.flatMap((m) => [m.geoId, m.websiteId]));
  const missing = [...only].filter((id) => !matched.has(id));
  if (missing.length) throw new Error(`Unknown --only dataset(s): ${missing.join(', ')}`);
}
for (const m of selected) build(m);
console.log('Done. Register the websiteIds in src/data/datasets.ts (see batch-2 entries).');
