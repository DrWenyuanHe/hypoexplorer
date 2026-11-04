// Minimal data fixtures mirroring the real POP_META / POP_E9 / QC_GLOBAL shapes.
// Keep small — 3 genes and 2 pathways per DB is enough for smoke tests.
import { getDefaultDataset, listDatasets } from '../data/datasets';
import { getActiveContrast } from '../data/contrasts';
import { queryCatalogContent } from '../data/queryCatalogIdentity';
import { METRIC_DEFAULT_SIG_THRESH } from '../explorer/explorerSession';
import type { GeneSelection, VolcanoView } from '../explorer/explorerSession';
import type {
  Dataset, DatasetMeta, GeneDERecord, PathwayDatabase, PopData, QcGlobal, RawTrack,
  ResolvedContrast, TrackMeta,
} from '../types';

// The macaque snRNA dataset + its default contrast. buildPopData / popDataFor
// take these explicitly now; they used to be an implicit fallback inside the
// transform, which is how CompareTab ended up rendering the wrong contrast.
// Tests that used to call buildPopData(fixture) pass these instead.
export const MACAQUE_DATASET: Dataset = getDefaultDataset();
export const MACAQUE_CONTRAST = getActiveContrast(MACAQUE_DATASET);

export const POP_META_FIXTURE: DatasetMeta = {
  populations: ['e9', 'i23', 'e33', 'i26', 'i40', 'o30', 'e38'],
  labels: {
    e9: 'e9 (POMC/TBX3)',
    i23: 'i23 (AGRP/MCTP2)',
    e33: 'e33 (KISS1/ESR1)',
    i26: 'i26 (GALP/HTR2C)',
    i40: 'i40 (GHRH/PIK3R1)',
    o30: 'o30 (OXT/PTGFR)',
    e38: 'e38 (NPY/ITGA8)',
  },
  types: {
    e9: 'Glutamatergic',
    i23: 'GABAergic',
    e33: 'Glutamatergic',
    i26: 'GABAergic',
    i40: 'GABAergic',
    o30: 'Oxytocin',
    e38: 'Glutamatergic',
  },
  nGenes: { e9: 3, i23: 3, e33: 3, i26: 3, i40: 3, o30: 3, e38: 3 },
  colors: {
    e9: '#4C78A8', i23: '#59A14F', e33: '#E45756',
    i26: '#B07AA1', i40: '#FF9DA7', o30: '#9C755F',
    e38: 'hsl(30, 65%, 55%)',
  },
  qcFlags: {
    e9:  { is3v3: true,  nNormal: 3, nObese: 3, minCells: 15, status: 'ok', elapsedSec: 42 },
    i23: { is3v3: true,  nNormal: 3, nObese: 3, minCells: 15, status: 'ok', elapsedSec: 40 },
    e33: { is3v3: true,  nNormal: 3, nObese: 3, minCells: 15, status: 'ok', elapsedSec: 38 },
    i26: { is3v3: true,  nNormal: 3, nObese: 3, minCells: 15, status: 'ok', elapsedSec: 44 },
    i40: { is3v3: true,  nNormal: 3, nObese: 3, minCells: 15, status: 'ok', elapsedSec: 39 },
    o30: { is3v3: true,  nNormal: 3, nObese: 3, minCells: 15, status: 'ok', elapsedSec: 41 },
    e38: { is3v3: false, nNormal: 2, nObese: 3, minCells: 15, status: 'ok', elapsedSec: 37 },
  },
  qaReportFilenames: {
    e9: 'e9__POMC_TBX3.pdf',
    i23: 'i23__AGRP_MCTP2.pdf',
    e33: 'e33__KISS1_ESR1.pdf',
    i26: 'i26__GALP_HTR2C.pdf',
    i40: 'i40__GHRH_PIK3R1.pdf',
    o30: 'o30__OXT_PTGFR.pdf',
    e38: 'e38__NPY_ITGA8.pdf',
  },
};

const CANONICAL_SAMPLES = [
  'HCA_Macaque001_S001', 'HCA_Macaque001_S002', 'HCA_Macaque001_S003',
  'HCA_Macaque001_S004', 'HCA_Macaque001_S005', 'HCA_Macaque001_S006',
];

export const POP_E9_FIXTURE: RawTrack = {
  meta: {
    code: 'e9',
    label: 'e9 (POMC/TBX3)',
    type: 'Glutamatergic',
    sampleNames: CANONICAL_SAMPLES,
    samplesKept: CANONICAL_SAMPLES,
    normalSamples: CANONICAL_SAMPLES.slice(0, 3),
    obeseSamples:  CANONICAL_SAMPLES.slice(3, 6),
    nGenes: 3,
  },
  qc: {
    cluster: 'e9', clusterLabel: 'POMC/TBX3',
    minCells: 15, nNormal: 3, nObese: 3, is3v3: true,
    samplesKept: CANONICAL_SAMPLES,
  },
  // rank_score / rankPos mimic the fields preprocess_multi.py adds to real
  // pop_*.js data — RunningScorePlot reads them to place gene ticks.
  de: [
    { gene: 'POMC',  logFC:  1.2,   PValue: 0.001, FDR: 0.02,  rank_score:  Math.PI, rankPos: 1 },
    { gene: 'IP6K1', logFC:  0.315, PValue: 0.127, FDR: 0.351, rank_score:  0.896, rankPos: 2 },
    { gene: 'TBX3',  logFC: -0.8,   PValue: 0.05,  FDR: 0.15,  rank_score: -1.301, rankPos: 3 },
  ],
  cpm: {
    POMC:  [10, 12, 11,  25, 28, 30],
    TBX3:  [45, 50, 48,  32, 30, 28],
    IP6K1: [20, 22, 19,  24, 26, 25],
  },
  pathways: {
    GO_BP: [
      { pathway: 'GOBP_NEURON_DIFFERENTIATION', pval: 0.01, padj: 0.05, NES: 1.8, size: 20, leadingEdge: ['POMC', 'TBX3'] },
      { pathway: 'GOBP_APOPTOSIS',              pval: 0.10, padj: 0.20, NES: 1.1, size: 30, leadingEdge: ['POMC'] },
    ],
    HALLMARK: [
      { pathway: 'HALLMARK_INFLAMMATORY_RESPONSE', pval: 0.02, padj: 0.06, NES: 1.6, size: 50, leadingEdge: ['POMC', 'IP6K1'] },
      { pathway: 'HALLMARK_APOPTOSIS',             pval: 0.08, padj: 0.19, NES: 1.2, size: 40, leadingEdge: ['TBX3'] },
    ],
    KEGG: [
      { pathway: 'KEGG_INSULIN_SIGNALING', pval: 0.03, padj: 0.10, NES: 1.4, size: 25, leadingEdge: ['POMC', 'IP6K1'] },
      { pathway: 'KEGG_MAPK_SIGNALING',    pval: 0.07, padj: 0.18, NES: 1.2, size: 22, leadingEdge: ['TBX3'] },
    ],
    REACTOME: [
      { pathway: 'REACTOME_NEURON_DEVELOPMENT', pval: 0.08, padj: 0.19, NES: 1.25, size: 24, leadingEdge: ['POMC', 'TBX3'] },
      { pathway: 'REACTOME_CELL_CYCLE',         pval: 0.15, padj: 0.25, NES: 1.05, size: 40, leadingEdge: ['TBX3'] },
    ],
  },
};

export const QC_GLOBAL_FIXTURE: QcGlobal = {
  runStatus: POP_META_FIXTURE.populations.map(id => ({
    cluster: id,
    cluster_label: POP_META_FIXTURE.labels[id]?.replace(/^[eiho]\d+\s*\(/, '').replace(/\)$/, ''),
    status: 'ok',
    elapsed_sec: 40,
    message: null,
  })),
  deSummary: POP_META_FIXTURE.populations.map(id => ({
    cluster: id, cluster_label: id,
    n_DEG_FDR05_lfc025: 10, n_DEG_FDR05_LeiThresh: 10, n_DEG_fragile_LOO: 1,
    top5_up: 'A;B;C;D;E', top5_down: 'F;G;H;I;J',
  })),
  fgseaSummary: [],
  composition: {
    countsLong: [], countsWide: [], propsLong: [], propsWide: [],
    daQuasiAll: [], daPropellerVsQuasi: [],
  },
};

// ─── Migrated macaque track shape (HX_MACAQUE_SNRNA_E9) ─────────────────────
// Same data as POP_E9_FIXTURE, but with meta.sampleOrder + meta.groupSamples
// added by the migration generator. setup.js seeds this as the eager global
// HX_MACAQUE_SNRNA_E9 (and POP_META_FIXTURE as HX_MACAQUE_SNRNA_META) so the
// multi-dataset App/loaders resolve the macaque default without a network hit.
const E9_META = POP_E9_FIXTURE.meta as TrackMeta;
export const HX_MACAQUE_SNRNA_E9_FIXTURE: RawTrack = {
  ...POP_E9_FIXTURE,
  meta: {
    ...E9_META,
    sampleOrder: E9_META.sampleNames,
    groupSamples: {
      normal: E9_META.normalSamples ?? [],
      obese: E9_META.obeseSamples ?? [],
    },
  },
};

// ─── Synthetic test-only fixtures (other modalities) ─────────────────────────
// These prove the dataset contract generalizes beyond macaque snRNA. They are
// plain objects for unit tests — NOT real datasets and NOT shipped in the app.

// Mini BULK dataset: a single whole-tissue track, 5 chow vs 5 HFD, genes,
// supportsPathways:true. Group keys are 'chow' / 'hfd' (NOT normal/obese), so
// it also proves nothing is hardcoded to the macaque group keys.
export const BULK_DATASET_FIXTURE: Dataset = {
  id: 'mouse_bulk_hfd',
  category: 'Diet-induced obesity',
  name: 'Mouse hypothalamus (bulk RNA-seq, HFD)',
  organism: 'Mus musculus',
  modality: 'bulk RNA-seq',
  region: 'Whole hypothalamus',
  perturbation: 'Diet & obesity',
  preparation: 'Bulk tissue',
  featureType: 'gene',
  featureLabel: 'Gene',
  supportsPathways: true,
  citation: 'Synthetic fixture',
  doi: '10.0000/synthetic.bulk',
  isDefault: false,
  bundleBaseUrl: '',
  metaFile: '/datasets/mouse_bulk_hfd/meta.js',
  metaGlobalKey: 'HX_MOUSE_BULK_HFD_META',
  qcFile: '/datasets/mouse_bulk_hfd/qc_global.js',
  qcGlobalKey: 'HX_MOUSE_BULK_HFD_QC',
  bundleFileTemplate: '/datasets/mouse_bulk_hfd/track_{trackId}.js',
  globalKeyTemplate: 'HX_MOUSE_BULK_HFD_{TRACKID}',
  defaultTrack: 'whole',
  trackCategoryOrder: ['Whole tissue'],
  groups: [
    { key: 'chow', label: 'Chow', color: '#3775BA' },
    { key: 'hfd', label: 'HFD', color: '#B64342' },
  ],
  contrasts: [
    { id: 'hfd_vs_chow', baseline: 'chow', case: 'hfd', isDefault: true },
  ],
};

const BULK_SAMPLES = ['C1', 'C2', 'C3', 'C4', 'C5', 'H1', 'H2', 'H3', 'H4', 'H5'];

export const BULK_TRACK_FIXTURE: RawTrack = {
  meta: {
    code: 'whole',
    label: 'Whole hypothalamus',
    type: 'Whole tissue',
    sampleNames: BULK_SAMPLES,
    samplesKept: BULK_SAMPLES,
    sampleOrder: BULK_SAMPLES,
    groupSamples: {
      chow: BULK_SAMPLES.slice(0, 5),
      hfd: BULK_SAMPLES.slice(5, 10),
    },
    nGenes: 2,
  },
  qc: {
    cluster: 'whole', clusterLabel: 'Whole hypothalamus',
    minCells: null, nNormal: 5, nObese: 5, is3v3: true,
    samplesKept: BULK_SAMPLES,
  },
  de: [
    { gene: 'LEP', logFC: 1.5, logCPM: 6.2, PValue: 0.001, FDR: 0.01, rank_score: 3.1, rankPos: 1 },
    { gene: 'POMC', logFC: -0.9, logCPM: 5.4, PValue: 0.02, FDR: 0.08, rank_score: -1.4, rankPos: 2 },
  ],
  cpm: {
    LEP: [4, 5, 4, 6, 5, 12, 14, 13, 15, 11],
    POMC: [30, 28, 32, 29, 31, 18, 20, 17, 19, 21],
  },
  pathways: {
    GO_BP: [
      { pathway: 'GOBP_ENERGY_HOMEOSTASIS', pval: 0.01, padj: 0.04, NES: 2.0, size: 40, leadingEdge: ['LEP', 'POMC'] },
    ],
    HALLMARK: [
      { pathway: 'HALLMARK_ADIPOGENESIS', pval: 0.03, padj: 0.09, NES: 1.7, size: 60, leadingEdge: ['LEP'] },
    ],
    KEGG: [],
    REACTOME: [],
  },
};

// Mini miRNA dataset: a single whole-tissue track, 3 control vs 3 HFD, miRNA
// feature ids, supportsPathways:false, NO pathways block. Proves the optional
// pathway support and non-gene feature labels.
export const MIRNA_DATASET_FIXTURE: Dataset = {
  id: 'mouse_mirna',
  category: 'Diet-induced obesity',
  name: 'Mouse hypothalamus (miRNA array)',
  organism: 'Mus musculus',
  modality: 'miRNA microarray',
  region: 'Whole hypothalamus',
  perturbation: 'Diet & obesity',
  preparation: 'Bulk tissue',
  featureType: 'miRNA',
  featureLabel: 'miRNA',
  supportsPathways: false,
  citation: 'Synthetic fixture',
  doi: '10.0000/synthetic.mirna',
  isDefault: false,
  bundleBaseUrl: '',
  metaFile: '/datasets/mouse_mirna/meta.js',
  metaGlobalKey: 'HX_MOUSE_MIRNA_META',
  qcFile: '/datasets/mouse_mirna/qc_global.js',
  qcGlobalKey: 'HX_MOUSE_MIRNA_QC',
  bundleFileTemplate: '/datasets/mouse_mirna/track_{trackId}.js',
  globalKeyTemplate: 'HX_MOUSE_MIRNA_{TRACKID}',
  defaultTrack: 'whole',
  trackCategoryOrder: ['Whole tissue'],
  groups: [
    { key: 'control', label: 'Control', color: '#3775BA' },
    { key: 'hfd', label: 'HFD', color: '#B64342' },
  ],
  contrasts: [
    { id: 'hfd_vs_control', baseline: 'control', case: 'hfd', isDefault: true },
  ],
};

const MIRNA_SAMPLES = ['Ctrl1', 'Ctrl2', 'Ctrl3', 'HFD1', 'HFD2', 'HFD3'];

export const MIRNA_TRACK_FIXTURE: RawTrack = {
  meta: {
    code: 'whole',
    label: 'Whole hypothalamus (miRNA)',
    type: 'Whole tissue',
    sampleNames: MIRNA_SAMPLES,
    samplesKept: MIRNA_SAMPLES,
    sampleOrder: MIRNA_SAMPLES,
    groupSamples: {
      control: MIRNA_SAMPLES.slice(0, 3),
      hfd: MIRNA_SAMPLES.slice(3, 6),
    },
    nGenes: 2,
  },
  qc: {
    cluster: 'whole', clusterLabel: 'Whole hypothalamus (miRNA)',
    minCells: null, nNormal: 3, nObese: 3, is3v3: true,
    samplesKept: MIRNA_SAMPLES,
  },
  de: [
    { gene: 'miR-200a-3p', logFC: 1.1, logCPM: 4.0, PValue: 0.004, FDR: 0.03, rank_score: 2.2, rankPos: 1 },
    { gene: 'miR-133b', logFC: -0.7, logCPM: 3.5, PValue: 0.04, FDR: 0.12, rank_score: -1.1, rankPos: 2 },
  ],
  cpm: {
    'miR-200a-3p': [5, 6, 5, 9, 10, 8],
    'miR-133b': [12, 11, 13, 7, 8, 6],
  },
  // No pathways block on purpose — supportsPathways:false.
};

// ─── Multi-contrast dataset (N groups + selectable precomputed contrasts) ────
// A fasting timecourse: 3 groups (fed / fast24 / refed), 2 pairwise contrasts
// against the shared `fed` baseline. Proves the N-group + multi-contrast schema:
// the bundle carries the default DE table in legacy `de` and only non-default
// tables in `deByContrast`, matching the real GSE135639 bundle contract.
// Pathways keep both explicit blocks so other fixture consumers can select
// either contrast. The two contrasts give IGFBP2/FOS deliberately different
// logFC so a test can prove the correct table is selected.
export const MULTICONTRAST_DATASET_FIXTURE: Dataset = {
  id: 'mouse_fasting_tc',
  category: 'Feeding & fasting',
  name: 'Mouse hypothalamus (fasting timecourse, bulk RNA-seq)',
  organism: 'Mus musculus',
  modality: 'bulk RNA-seq',
  region: 'Whole hypothalamus',
  perturbation: 'Fasting & feeding',
  preparation: 'Bulk tissue',
  featureType: 'gene',
  featureLabel: 'Gene',
  supportsPathways: true,
  citation: 'Synthetic fixture',
  doi: '10.0000/synthetic.fasting',
  isDefault: false,
  bundleBaseUrl: '',
  metaFile: '/datasets/mouse_fasting_tc/meta.js',
  metaGlobalKey: 'HX_MOUSE_FASTING_TC_META',
  qcFile: '/datasets/mouse_fasting_tc/qc_global.js',
  qcGlobalKey: 'HX_MOUSE_FASTING_TC_QC',
  bundleFileTemplate: '/datasets/mouse_fasting_tc/track_{trackId}.js',
  globalKeyTemplate: 'HX_MOUSE_FASTING_TC_{TRACKID}',
  defaultTrack: 'whole',
  trackCategoryOrder: ['Whole tissue'],
  groups: [
    { key: 'fed', label: 'Fed', color: '#3775BA' },
    { key: 'fast24', label: 'Fasted 24h', color: '#B64342' },
    { key: 'refed', label: 'Refed', color: '#59A14F' },
  ],
  contrasts: [
    { id: 'fast24_vs_fed', baseline: 'fed', case: 'fast24', isDefault: true, label: 'Fasted 24h vs Fed' },
    { id: 'refed_vs_fed', baseline: 'fed', case: 'refed', label: 'Refed vs Fed' },
  ],
};

const FASTING_SAMPLES = ['Fed1', 'Fed2', 'Fed3', 'Fast1', 'Fast2', 'Fast3', 'Re1', 'Re2', 'Re3'];

const FAST24_DE: GeneDERecord[] = [
  { gene: 'IGFBP2', logFC: -1.4, logCPM: 5.0, PValue: 0.001, FDR: 0.01, rank_score: -3.0, rankPos: 1 },
  { gene: 'FOS', logFC: 2.1, logCPM: 6.0, PValue: 0.002, FDR: 0.02, rank_score: 3.3, rankPos: 2 },
];
const REFED_DE: GeneDERecord[] = [
  { gene: 'IGFBP2', logFC: 0.3, logCPM: 5.0, PValue: 0.40, FDR: 0.60, rank_score: 0.4, rankPos: 2 },
  { gene: 'FOS', logFC: -0.5, logCPM: 6.0, PValue: 0.20, FDR: 0.45, rank_score: -0.8, rankPos: 1 },
];
const FAST24_PW: PathwayDatabase = {
  GO_BP: [{ pathway: 'GOBP_RESPONSE_TO_FASTING', pval: 0.01, padj: 0.03, NES: 2.1, size: 30, leadingEdge: ['IGFBP2', 'FOS'] }],
  HALLMARK: [], KEGG: [], REACTOME: [],
};
const REFED_PW: PathwayDatabase = {
  GO_BP: [{ pathway: 'GOBP_RESPONSE_TO_NUTRIENT_LEVELS', pval: 0.04, padj: 0.10, NES: 1.5, size: 25, leadingEdge: ['FOS'] }],
  HALLMARK: [], KEGG: [], REACTOME: [],
};

export const MULTICONTRAST_TRACK_FIXTURE: RawTrack = {
  meta: {
    code: 'whole',
    label: 'Whole hypothalamus',
    type: 'Whole tissue',
    sampleNames: FASTING_SAMPLES,
    samplesKept: FASTING_SAMPLES,
    sampleOrder: FASTING_SAMPLES,
    groupSamples: {
      fed: FASTING_SAMPLES.slice(0, 3),
      fast24: FASTING_SAMPLES.slice(3, 6),
      refed: FASTING_SAMPLES.slice(6, 9),
    },
    nGenes: 2,
  },
  qc: {
    cluster: 'whole', clusterLabel: 'Whole hypothalamus',
    minCells: null, nNormal: 3, nObese: 3, is3v3: true,
    samplesKept: FASTING_SAMPLES,
  },
  // Back-compat default-contrast tables (mirror fast24_vs_fed).
  de: FAST24_DE,
  pathways: FAST24_PW,
  deByContrast: { refed_vs_fed: REFED_DE },
  pathwaysByContrast: { fast24_vs_fed: FAST24_PW, refed_vs_fed: REFED_PW },
  cpm: {
    IGFBP2: [20, 22, 19, 8, 7, 9, 18, 19, 17],
    FOS: [5, 6, 5, 30, 28, 32, 8, 7, 9],
  },
};

// ─── Transformed popData (buildPopData OUTPUT shape) ─────────────────────────
// Unit tests of the seams that consume popData (sample-value reads, export rows,
// the leading-edge heatmap) used to hand-build a partial literal and
// `as unknown as PopData` it. Every one of those re-spelled the same triple —
// contrast + sampleOrder + groupSamples — which is exactly what the sample-value
// seam keys on, and the cast hid any change to the PopData contract. This is the
// one realistic default: a 2v2 normal/obese CPM track, coherent the way
// buildPopData's output is (deByGene/geneNames derived FROM `de`,
// groups = [baseline, caseGroup], cpm arrays parallel to sampleOrder).
const POPDATA_SAMPLE_ORDER = ['S1', 'S2', 'S3', 'S4'];

const POPDATA_CONTRAST: ResolvedContrast = {
  id: 'obese_vs_normal',
  baseline: { key: 'normal', label: 'Normal', color: '#3775BA' },
  caseGroup: { key: 'obese', label: 'Obese', color: '#B64342' },
  supportsPathways: true,
  label: 'Obese vs Normal',
};

const POPDATA_DE: GeneDERecord[] = [
  { gene: 'POMC', logFC: 1.5, PValue: 0.001, FDR: 0.01 },
  { gene: 'AGRP', logFC: -0.8, PValue: 0.04, FDR: 0.2 },
];

/**
 * A complete, type-checked PopData. Pass `overrides` for whatever the test
 * actually asserts on; `deByGene` / `geneNames` follow `de` unless overridden
 * themselves, so a test that supplies its own DE table stays coherent.
 */
export function makePopData(overrides: Partial<PopData> = {}): PopData {
  const de = overrides.de ?? POPDATA_DE;
  return {
    de,
    deByGene: Object.fromEntries(de.map((d) => [d.gene, d])),
    geneNames: de.map((d) => d.gene),
    cpm: {
      POMC: [10, 20, 30, 40],
      AGRP: [5, null, 15, 25], // S2 (null) exercises the seam's drop rule
    },
    qc: null,
    volcanoPts: [],
    allPathways: [],
    meta: { sampleOrder: POPDATA_SAMPLE_ORDER },
    contrast: POPDATA_CONTRAST,
    groups: [POPDATA_CONTRAST.baseline, POPDATA_CONTRAST.caseGroup],
    groupSamples: { normal: ['S1', 'S2'], obese: ['S3', 'S4'] },
    sampleOrder: POPDATA_SAMPLE_ORDER,
    expressionUnit: 'CPM',
    ...overrides,
  };
}

// ── Cross-dataset query manifest ────────────────────────────────────────────

/**
 * Seed `window.HX_QUERY_TRACKS` so anything reading the query manifest resolves
 * synchronously.
 *
 * Needed because bundleSource's transports go through fetch() or a <script src>,
 * neither of which lands in jsdom — a component that awaits the manifest would
 * otherwise sit on its loading state until the test times out, which reads as
 * "the component is broken" rather than "the transport has no network". The
 * loaders short-circuit on an already-set global (see peekGlobalBundle), so
 * seeding one is the same trick index.html's eager <script> tags play.
 *
 * Built from the REAL registry, so every dataset gets a browse summary and the
 * library renders the same 42 cards it renders in the app.
 */
export function seedQueryManifest(): () => void {
  const previousContent = (globalThis as any).__QUERY_CATALOG_CONTENT__;
  const datasets = listDatasets();
  (window as any).HX_QUERY_TRACKS = {
    v: 2,
    buildId: 'test',
    // Must mirror the client's GENE_SHARDS / PATHWAY_SHARDS, or loadQueryManifest
    // rejects the manifest as a shard-count mismatch and returns null.
    geneShards: 512,
    pathwayShards: 256,
    dbNames: ['GO_BP', 'HALLMARK', 'KEGG', 'REACTOME'],
    trackCounts: Object.fromEntries(datasets.map((d) => [d.id, 1])),
    tracks: datasets.map((d) => ({
      ds: d.id, trackId: d.defaultTrack, label: d.defaultTrack, type: 'Tissue', lowPower: false,
    })),
    datasets: datasets.map((d) => {
      const contrast = getActiveContrast(d);
      return {
        ds: d.id,
        trackCount: d.id === 'macaque_snrna' ? 60 : 1,
        // MUST equal the registry's default track or datasetCatalog rejects the
        // summary as belonging to a different corpus.
        defaultTrack: d.defaultTrack,
        trackLabel: d.id === 'macaque_snrna' ? 'e9 (POMC/TBX3)' : 'Whole hypothalamus',
        nGenes: 12627,
        // ASYMMETRIC on one dataset, matching its real counts (Chow 7 / HFD 8).
        // Seeding 3v3 everywhere made a whole class of bug invisible: a view that
        // renders the arms in one order and the counts in the other looks correct
        // for as long as the two numbers are equal.
        nBaseline: d.id === 'mouse_hypo_hfd_gse220533' ? 7 : 3,
        nCase: d.id === 'mouse_hypo_hfd_gse220533' ? 8 : 3,
        // Only the macaque atlas has tracks that disagree on replicate count.
        nVaries: d.id === 'macaque_snrna',
        lowPowerTracks: d.id === 'macaque_snrna' ? 5 : 0,
        contrastId: contrast?.id ?? null,
        armKeys: contrast ? [contrast.baseline.key, contrast.caseGroup.key] : [],
        // Two states on purpose. The macaque finds NOTHING on its default
        // population while 20 of its 60 do, which is the case the card has to
        // state rather than round off; everything else finds something. Seeding
        // only the second would hide the zero path entirely.
        discoveries: d.id === 'macaque_snrna'
          ? {
            genes: 0, genesUp: 0, genesDown: 0, genesTested: 12627,
            paths: 57, pathsUp: 11, pathsDown: 46, pathsTested: 4584,
            pathsByDb: { GO_BP: { up: 5, down: 18, tested: 3450 }, REACTOME: { up: 6, down: 18, tested: 932 } },
            tracksWithGenes: 20,
          }
          : {
            genes: 491, genesUp: 339, genesDown: 152, genesTested: 15242,
            paths: 121, pathsUp: 116, pathsDown: 5, pathsTested: 4866,
            pathsByDb: { GO_BP: { up: 36, down: 4, tested: 3629 }, REACTOME: { up: 62, down: 0, tested: 1030 } },
            tracksWithGenes: 1,
          },
      };
    }),
  };
  (globalThis as any).__QUERY_CATALOG_CONTENT__ = queryCatalogContent((window as any).HX_QUERY_TRACKS);
  return () => {
    delete (window as any).HX_QUERY_TRACKS;
    if (previousContent === undefined) delete (globalThis as any).__QUERY_CATALOG_CONTENT__;
    else (globalThis as any).__QUERY_CATALOG_CONTENT__ = previousContent;
  };
}

// ── Explorer-session stubs ──────────────────────────────────────────────────
// Inert slices for tests that only RENDER a tab. A test that needs the controls
// to actually work should call the real hooks (useGeneSelection /
// useVolcanoView / usePathwayView) inside a harness component instead — those
// are the production implementations and exercising them is the point.

/** A gene selection that holds `genes` and swallows every mutation. */
export function stubGeneSelection(genes: string[] = []): GeneSelection {
  return { genes, add: () => {}, addMany: () => {}, remove: () => {}, clear: () => {}, replace: () => {} };
}

/** A volcano view at the given metric, with that metric's default threshold. */
export function stubVolcanoView(overrides: Partial<VolcanoView> = {}): VolcanoView {
  const metric = overrides.metric ?? 'pval';
  return {
    metric,
    selectMetric: () => {},
    logFCThresh: 0,
    setLogFCThresh: () => {},
    sigThresh: METRIC_DEFAULT_SIG_THRESH[metric],
    setSigThresh: () => {},
    ...overrides,
  };
}
