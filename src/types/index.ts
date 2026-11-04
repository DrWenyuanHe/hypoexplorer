// Shared domain model for HypoExplorer — the single source of truth for the
// shapes that flow through the data layer, the buildPopData transform, and every
// tab. Reverse-engineered from src/data/*, docs/DATASET_CONTRACT.md, and
// docs/REAL_DATA_SHAPES.md. Keep this in sync with the bundle generators.

// ── Registry / manifest (src/data/datasets.ts) ──────────────────────────────

import type { DatasetCategory } from '../data/datasetCategories';
import type { DatasetPerturbation, DatasetPreparation, DatasetRegion } from '../data/datasetFacets';

export type FeatureType = 'gene' | 'miRNA';

/** An experimental arm (Normal, Obese, Chow, HFD, …). */
export interface Group {
  key: string;
  label: string;
  color: string;
}

/** A baseline→case comparison referencing two group keys (manifest form). */
export interface Contrast {
  id: string;
  baseline: string;
  /** group key; resolves to `caseGroup` in ResolvedContrast (reserved word). */
  case: string;
  isDefault?: boolean;
  /** Selector display label (e.g. "ZT6 vs ZT0"). Defaults to `${case} vs ${baseline}` labels. */
  label?: string;
  /** Optional longer description of the comparison (tooltip/help text). */
  description?: string;
  /**
   * Marks a comparison that must be read as exploratory: one the SOURCE STUDY
   * never ran (a re-analysis contrast whose meaning does not follow from its
   * arm names), or one whose re-fit cannot support gene-level significance
   * (GSE87544: one residual degree of freedom, so only effect sizes and pathway
   * ranks are presented). `description` must say which. Drives the
   * "exploratory contrast" warning badge in the study bar. Deliberately not
   * inferred from `description` being present: a description can also annotate
   * a faithful re-fit of the paper's own axis, which must not be flagged.
   */
  exploratory?: boolean;
  /**
   * Selector grouping label for datasets whose contrasts come from a factorial
   * design (e.g. "Maternal-diet effect" vs "Maturation (P0 → P21)"). Contrasts
   * sharing a `group` render under one <optgroup>; ungrouped ones render flat.
   */
  group?: string;
}

/** One study/modality the explorer can browse. */
export interface Dataset {
  id: string;
  name: string;
  /** Thematic category — drives the selector groups, hub scope chips and the
   *  cross-dataset report's sections. Required: a silently-defaulted category
   *  once filed datasets under the wrong heading. */
  category: DatasetCategory;
  organism: string;
  modality: string;
  /** Browse facets for the dataset library — anatomical origin, what the
   *  contrast manipulates, and how the library was prepared. Authored rather
   *  than derived (see ../data/datasetFacets for why), and required for the same
   *  reason `category` is: a silently-defaulted facet puts a dataset in the
   *  wrong filter bucket, where the user's conclusion is that it does not exist. */
  region: DatasetRegion;
  perturbation: DatasetPerturbation;
  preparation: DatasetPreparation;
  featureType: FeatureType;
  featureLabel: string;
  /** Axis/export unit label. Optional; buildPopData falls back to 'CPM'. */
  expressionUnit?: string;
  supportsPathways: boolean;
  citation: string;
  doi?: string;
  geo?: string;
  /** PubMed id of the source publication, digits only. Empty/absent when the
   *  deposit has no paper — several series in the corpus are unpublished, so a
   *  missing PMID is a fact about the study, not a gap in the registry. Held as
   *  its own field rather than mined out of `citation`: the citation is prose,
   *  and prose that has to stay machine-parseable is a trap for whoever edits
   *  it next. */
  pmid?: string;
  isDefault: boolean;
  bundleBaseUrl: string;
  metaFile: string;
  metaGlobalKey: string;
  qcFile: string;
  qcGlobalKey: string;
  bundleFileTemplate: string;
  globalKeyTemplate: string;
  defaultTrack: string;
  defaultCompareTracks?: string[];
  trackNoun?: string;
  trackCategoryOrder: string[];
  groups: Group[];
  contrasts: Contrast[];
  /** Present only on datasets with a sampled time course (see TimeSeriesDescriptor). */
  timeSeries?: TimeSeriesDescriptor;
}

/** A contrast resolved against a dataset: baseline/case are full Group objects. */
export interface ResolvedContrast {
  id: string;
  baseline: Group;
  caseGroup: Group;
  supportsPathways: boolean;
  /** Display label for the contrast selector; authored `Contrast.label` or a derived default. */
  label: string;
  /** Optional longer description (tooltip/help text); carried through from Contrast.description. */
  description?: string;
  /** Carried through from Contrast.exploratory — see that field's note. */
  exploratory?: boolean;
  /** Carried through from Contrast.group — the selector's <optgroup> label. */
  group?: string;
}

// ── Dataset-level metadata (meta.js → window[metaGlobalKey]) ─────────────────

/** Per-track QC summary flags (read by isLowPower). All optional — varies by modality. */
export interface QCFlags {
  is3v3?: boolean;
  nNormal?: number;
  nObese?: number;
  minCells?: number;
  status?: string;
  elapsedSec?: number;
}

export interface DatasetMeta {
  populations: string[];
  labels: Record<string, string>;
  types: Record<string, string>;
  nGenes: Record<string, number>;
  colors: Record<string, string>;
  qcFlags: Record<string, QCFlags>;
  qaReportFilenames?: Record<string, string>;
  /**
   * Replicate count per group KEY, for multi-group (factorial) datasets whose
   * arms are not the legacy nNormal/nObese pair. Optional; written by the
   * bundle builders when a dataset declares more than two groups, and read as
   * a pre-bundle fallback for the hero pills and the dataset info panel.
   */
  groupN?: Record<string, number>;
}

/** Dataset-level QC blob (qc_global.js → window[qcGlobalKey]). Loosely typed. */
export interface QcGlobal {
  runStatus?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

// ── Track bundle (track_<id>.js → window[globalKey]) ─────────────────────────

/**
 * One DE row. The row id is `gene` regardless of modality (gene symbol or miR id).
 * FDR is `number | null` — null on small-n designs (serialized from R's NA).
 */
export interface GeneDERecord {
  gene: string;
  logFC: number;
  logCPM?: number;
  PValue: number;
  FDR: number | null;
  /**
   * Standard error of logFC on the log2 scale, for the row's own 95% CI
   * whisker in the cross-dataset forest. Exact for limma (|logFC|/|t| IS limma's moderated SE). NOT
   * derivable for edgeR-QL: glmQLFTest reports a deviance-ratio statistic, not
   * a Wald statistic, so |logFC|/sqrt(F) is a test-calibrated proxy rather than
   * a sampling SD and is no longer used — see src/utils/seRecovery.ts for the
   * measurement that rejected it. edgeR datasets carry an SE only when
   * scripts/compute_edger_se.R persisted one from a refit; otherwise this is
   * null and the track plots a bare dot with no interval.
   * Optional — absent on bundles built before this field.
   */
  se?: number | null;
  rank_score?: number;
  rankPos?: number;
}

export interface PathwayRecord {
  pathway: string;
  pval: number;
  padj: number;
  NES: number;
  size: number;
  leadingEdge: string[];
}

export type DbName = 'GO_BP' | 'HALLMARK' | 'KEGG' | 'REACTOME';
export type PathwayDatabase = Partial<Record<DbName, PathwayRecord[]>>;
export interface PathwayRecordWithDb extends PathwayRecord {
  db: DbName;
}

/**
 * The value shape of a pathway sibling bundle (track_<id>.pathways.js).
 *
 * Legacy single-contrast bundles set the global to a plain PathwayDatabase.
 * Multi-contrast bundles set it to the wrapper form: `default` is the default
 * contrast's block (what every legacy consumer wants) and `byContrast` carries
 * the non-default contrasts keyed by Contrast.id. Consumers go through the
 * unwrap helpers in src/data/rawTrack.ts rather than sniffing the shape inline.
 */
export type PathwaySibling =
  | PathwayDatabase
  | { default: PathwayDatabase; byContrast: Record<string, PathwayDatabase> };

export interface TrackMeta {
  code?: string;
  label?: string;
  type?: string;
  nGenes?: number;
  /** Canonical sample order; `cpm[feature]` arrays are positional-parallel to this. */
  sampleOrder?: string[];
  /** Legacy alias for sampleOrder. */
  sampleNames?: string[];
  /** Real per-group sample ids, e.g. { chow: ['C1','C2'], hfd: ['H1'] }. */
  groupSamples?: Record<string, string[]>;
  /** Legacy per-group sample arrays (pre-groupSamples). */
  normalSamples?: string[];
  obeseSamples?: string[];
  /** Samples retained after QC (also carried on TrackQC). */
  samplesKept?: string[];
  expressionUnit?: string;
}

export interface TrackQC {
  cluster?: string;
  clusterLabel?: string;
  minCells?: number | null;
  nNormal?: number;
  nObese?: number;
  is3v3?: boolean;
  samplesKept?: string[];
  status?: string;
}

/** Per-feature, per-sample value matrix. Each array is parallel to TrackMeta.sampleOrder. */
export type CpmMatrix = Record<string, Array<number | null>>;

export interface RawTrack {
  meta?: TrackMeta;
  qc?: TrackQC;
  /**
   * DE table for the dataset's DEFAULT contrast (the back-compat single-contrast
   * field). Multi-contrast bundles additionally carry `deByContrast` keyed by
   * contrast id; buildPopData prefers that for the active contrast and falls
   * back to this.
   */
  de?: GeneDERecord[];
  /** Per-contrast DE tables, keyed by Contrast.id. Optional; multi-contrast bundles only. */
  deByContrast?: Record<string, GeneDERecord[]>;
  cpm: CpmMatrix;
  /** Omitted entirely (not empty) when the dataset doesn't support pathways. */
  pathways?: PathwayDatabase;
  /** Per-contrast pathway tables, keyed by Contrast.id. Optional; multi-contrast bundles only. */
  pathwaysByContrast?: Record<string, PathwayDatabase>;
}

// ── Transformed popData (buildPopData output) ────────────────────────────────

export interface VolcanoPoint {
  gene: string;
  logfc: number;
  pval: number;
  fdr: number | null;
  yPval: number;
  yFdr: number;
}

/** The React-friendly transform threaded through every tab. */
export interface PopData {
  /** Source registry value retained for self-contained exports; absent on legacy fixtures. */
  dataset?: Dataset;
  de: GeneDERecord[];
  /**
   * DE record per gene. The value is `| undefined` on purpose: this is an index
   * over whatever genes the track's DE table happens to carry, and callers
   * routinely look up a gene it does not (a leading-edge gene absent from this
   * population, a cross-dataset query gene). Stating that here is what lets the
   * call sites use `?.` / `??` instead of re-asserting the lie one cast at a time.
   */
  deByGene: Record<string, GeneDERecord | undefined>;
  geneNames: string[];
  cpm: CpmMatrix;
  qc: TrackQC | null;
  volcanoPts: VolcanoPoint[];
  /** Flattened pathways tagged with their DB; [] when !supportsPathways. */
  allPathways: PathwayRecordWithDb[];
  meta?: TrackMeta;
  contrast: ResolvedContrast | null;
  /** [] or [baseline, caseGroup]. */
  groups: Group[];
  groupSamples: Record<string, string[]>;
  sampleOrder: string[];
  expressionUnit: string;
}

// ── Cross-dataset gene report (src/data/crossDataset.js) ─────────────────────

export type Direction = 'up' | 'down' | 'flat';

export interface TrackRow {
  trackId: string;
  label: string;
  type: string;
  logFC: number;
  fdr: number | null;
  pval: number;
  /** logFC standard error (log2) for the row's own 95% CI; null if the bundle lacks it. */
  se: number | null;
  direction: Direction;
  significant: boolean;
  lowPower: boolean;
}

export interface DatasetGroup {
  dataset: Dataset;
  contrast: ResolvedContrast | null;
  tracks: TrackRow[];
  error?: boolean;
}

export interface CrossDatasetGeneReport {
  gene: string;
  total: number;
  loaded: number;
  groups: DatasetGroup[];
}

export interface GroupSummary {
  up: number;
  down: number;
  nSig: number;
  nTracks: number;
  strongest: TrackRow | null;
}

// ── Cross-dataset pathway report (src/data/crossDataset.ts) ──────────────────
// The pathway analog of the gene report: one FGSEA pathway's enrichment across
// every track of every pathway-capable dataset. Mirrors TrackRow but on NES/padj.

export interface PathwayTrackRow {
  trackId: string;
  label: string;
  type: string;
  NES: number;
  padj: number;
  pval: number;
  size: number;
  db: DbName;
  direction: Direction;
  significant: boolean;
}

export interface PathwayDatasetGroup {
  dataset: Dataset;
  contrast: ResolvedContrast | null;
  tracks: PathwayTrackRow[];
  error?: boolean;
}

export interface CrossDatasetPathwayReport {
  pathway: string;
  total: number;
  loaded: number;
  groups: PathwayDatasetGroup[];
}

// ── Dataset tracker (window.HX_TRACKER_CATALOG, src/dataset-tracker/*) ────────

export type ReviewStatus = 'new' | 'reviewed' | 'pipeline' | 'added' | 'rejected';

export interface ReviewState {
  status?: ReviewStatus;
  note?: string;
  updated?: string;
  auto?: boolean;
}

export type Reviews = Record<string, ReviewState>;

/** A candidate-dataset row from the tracker catalog. Detail fields are loose. */
export interface TrackerRow {
  acc: string;
  title?: string;
  species?: string;
  region?: string;
  modality?: string;
  platform?: string;
  phenotype?: string;
  design?: string;
  n?: string;
  raw?: string;
  publication?: string;
  pass?: number;
  searchTag?: string;
  method?: string;
  repoUrl?: string;
  evidenceUrl?: string;
  links?: {
    doi?: string;
    pmid?: string;
    pmc?: string;
    bioproject?: string;
    sra?: string;
    cellxgene?: string;
    ega?: string;
    geo?: string;
    [key: string]: string | undefined;
  };
  alsoAs?: string;
  correctionNotes?: string;
  isCellLine?: boolean;
  integrated?: boolean;
  related?: boolean;
  match?: { tier: string; id: string; name: string; via: string } | null;
  // Loose catalog detail blobs (generated from the research survey); the fields
  // accessed by trackerLogic (feas.tier, nadeq.min, score.fit) plus assorted
  // dossier fields, kept permissive.
  score?: Record<string, any> | null;
  feas?: Record<string, any> | null;
  nadeq?: Record<string, any> | null;
  [key: string]: unknown;
}

export interface TrackerCatalog {
  rows: TrackerRow[];
  count?: number;
  integratedCount?: number;
  relatedCount?: number;
  generatedFrom?: string;
  explorer?: Array<{
    id: string;
    name: string;
    organism: string;
    modality: string;
    geo?: string;
    doi?: string;
    accessions?: string[];
  }>;
}

// ── Time-series (circadian) bundles ─────────────────────────────────────────
// A second, OPTIONAL bundle per track, sibling to track_<id>.js. The DE bundle
// answers "case vs baseline"; this one answers "what does this gene do across
// the sampling cycle", which the two-arm contrast shape cannot express — every
// timepoint is a first-class column here rather than being pooled away.
//
// Only datasets whose manifest carries a `timeSeries` descriptor have one.

/** One arm of a time course (a genotype, a diet), sampled at every timepoint. */
export interface TimeSeriesArm {
  key: string;
  label: string;
  color: string;
}

/** One library: which arm it belongs to and when it was collected. */
export interface TimeSeriesSample {
  id: string;
  arm: string;
  /** Sampling time in hours on the dataset's own axis (ZT/CT value). */
  time: number;
  /** 1-based replicate index within (arm, time). */
  replicate: number;
}

export interface TimeSeriesMeta {
  trackId: string;
  label: string;
  /** Length of the experimental cycle in hours — 24 for every current dataset. */
  cycleHours: number;
  /** Axis prefix: 'ZT' (entrained), 'CT' (free-running) or 'h' (elapsed). */
  timeUnit: 'ZT' | 'CT' | 'h';
  expressionUnit: string;
  arms: TimeSeriesArm[];
  samples: TimeSeriesSample[];
  /** Distinct sampling times, ascending. */
  timepoints: number[];
  nGenes: number;
}

/** Per-gene values, positionally parallel to `TimeSeriesMeta.samples`. */
export type TimeSeriesMatrix = Record<string, Array<number | null>>;

export interface TimeSeriesBundle {
  meta: TimeSeriesMeta;
  values: TimeSeriesMatrix;
}

/** Manifest descriptor: the dataset HAS a time course, and how to describe it. */
export interface TimeSeriesDescriptor {
  /** Tracks carrying a timeseries_<trackId>.js sibling. */
  tracks: string[];
  cycleHours: number;
  timeUnit: 'ZT' | 'CT' | 'h';
  /** One line on how the series was sampled — shown above the rhythm figure. */
  design: string;
}

/** Expression sources retain study, material and condition identity; they are never pooled across studies. */
export interface ExpressionCondition {
  key: string;
  label: string;
  referenceEligible: boolean;
  feedingState: string;
  notes: string;
  sampleCount?: number;
  age?: string;
  sex?: string;
  timeOfDay?: string;
  genotype?: string;
  treatment?: string;
}

/** Who published an external reference, under which release and terms. */
export interface ExpressionProvider {
  name: string;
  release: string;
  license: string;
  licenseUrl: string;
  /** Attribution the provider requires wherever its values are shown. */
  attribution: string;
}

export interface ExpressionSource {
  id: string;
  label: string;
  collection: 'existing' | 'neuroseq' | 'reference' | 'external';
  scope: 'population' | 'tissue' | 'isolated-neurons';
  populationId: string;
  populationLabel: string;
  region: string;
  species: string;
  assay: string;
  rnaFraction: string;
  unit: string;
  normalization: string;
  replicateUnit: string;
  identityMethod: string;
  driverOrMarker?: string;
  conditions: ExpressionCondition[];
  datasetId?: string;
  trackId?: string;
  sourceUrl: string;
  citation: string;
  notes: string;
  sampleCount?: number;
  sourceGroupIds?: string[];
  /** Includes source-defined HY boundary structures such as SFO. */
  boundary?: boolean;
  sharedSampleNote?: string;
  /**
   * 'summary' sources publish one value per condition (a consensus, cluster or
   * region value) and no sample rows; absent means per-sample values.
   */
  valueKind?: 'samples' | 'summary';
  /** What a summary source's published value is, e.g. "HPA subregion nTPM". */
  summaryStatistic?: string;
  /**
   * 'probe' sources (microarrays) return one result per probe of the queried
   * gene instead of reporting several probes as ambiguous; absent means 'gene'.
   */
  featureLevel?: 'gene' | 'probe';
  provider?: ExpressionProvider;
}

export interface ExpressionSampleValue {
  id: string;
  value: number | null;
}

export interface ExpressionGroupResult {
  key: string;
  label: string;
  referenceEligible: boolean;
  samples: ExpressionSampleValue[];
  /** Arithmetic mean of the stored values, including measured zeroes. */
  mean: number | null;
  /** Profiles with a finite value, which need not be individual animals. */
  n: number;
  totalSamples: number;
  /**
   * The provider's published value for a summary source's condition. Summary
   * groups have no samples, a null mean and n = 0; nothing is recomputed.
   */
  summary?: number | null;
}

export interface ExpressionGeneResult {
  sourceId: string;
  query: string;
  status: 'available' | 'not-retained' | 'ambiguous';
  gene?: string;
  geneId?: string;
  /** The probe behind this result, for a probe-level source; one result per probe. */
  probe?: string;
  candidates?: string[];
  unit: string;
  groups: ExpressionGroupResult[];
}
