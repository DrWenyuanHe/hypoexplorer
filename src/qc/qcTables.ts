import type { SortableColumn } from '../common/SortableTable';
import { trackColor } from '../data/datasetMeta';
import type { Dataset, DatasetMeta, Group, QcGlobal, QCFlags, ResolvedContrast } from '../types';
import { commonSamplePrefix } from '../utils/sampleIds';
import { groupLabels } from '../utils/sampleValues';
import { isLowPower } from '../utils/qcFlags';
import { aggregateFgseaSummary } from './fgseaSummary';
import type { FgseaAggregateRow, FgseaSummaryRecord } from './fgseaSummary';

// QcGlobal is deliberately loose. These aliases state the bundle fields' real
// shapes once, at this boundary, so every downstream read stays type-checked.
export type QcRunStatusRecord = {
  cluster?: string | null;
  status?: string | null;
  elapsed_sec?: number | null;
  message?: string | null;
};

export type QcDeSummaryRecord = {
  cluster?: string | null;
  cluster_label?: string | null;
  clusterLabel?: string | null;
  nGenes?: number | null;
  nSig?: number | null;
  n_DEG_FDR05_lfc025?: number | null;
  n_DEG_FDR05_LeiThresh?: number | null;
  n_DEG_fragile_LOO?: number | null;
  top5_up?: string | null;
  top5_down?: string | null;
};

export type QcCompositionRow = Record<string, string | number | null | undefined>;
export type QcComposition = {
  countsWide?: QcCompositionRow[];
  propsWide?: QcCompositionRow[];
  daQuasiAll?: QcCompositionRow[];
};

type LooseFgseaSummaryRecord = Omit<FgseaSummaryRecord, 'cluster' | 'cluster_label'> & {
  cluster?: string | null;
  cluster_label?: string | null;
};

export interface QcTableSpec<Row> {
  rows: Row[];
  columns: SortableColumn<Row>[];
}

export interface QcVocabulary {
  baseLabel: string;
  caseLabel: string;
  trackNoun: string;
  trackNounPlural: string;
  trackNounCap: string;
  supportsPathways: boolean;
  hasDataset: boolean;
  sampleGroups: Group[];
}

export type QcRunRow = {
  _key: string;
  cluster: string;
  label: string;
  status?: string | null;
  elapsed?: number | null;
  message: string;
};

export type QcSizeRow = {
  _key: string;
  cluster: string;
  label: string;
  nNormal: number | null;
  nObese: number | null;
  is3v3?: boolean;
  minCells: number | null;
};

export type QcDeRow = {
  _key: string;
  cluster: string;
  label: string | null | undefined;
  nGenes?: number | null;
  nSig?: number | null;
  nDEG_lfc025?: number | null;
  nDEG_leiThresh?: number | null;
  nDEG_fragile?: number | null;
  top5_up?: string | null;
  top5_down?: string | null;
};

export type QcReportRow = {
  _key: string;
  cluster: string;
  label: string;
  filename: string | null;
};

export interface QcSection {
  id: string;
  label: string;
}

// Legacy no-contrast arms: keys must still match the old macaque bundles'
// groupSamples ('normal'/'obese'); labels come from the groupLabels seam
// (neutral, never the macaque vocabulary); colors are the registry's standard
// baseline/case palette, spelled here because there is no Dataset to read.
const LEGACY_FALLBACK_ARMS = [
  { key: 'normal', color: '#3775BA' },
  { key: 'obese', color: '#B64342' },
] as const;

const QC_SECTIONS: QcSection[] = [
  { id: 'runs', label: 'Runs' },
  { id: 'sizes', label: 'Sizes' },
  { id: 'de', label: 'DE' },
  { id: 'fgsea', label: 'FGSEA' },
  { id: 'composition', label: 'Composition' },
  { id: 'reports', label: 'QA reports' },
];

function clusterId(cluster: string | null | undefined): string {
  return typeof cluster === 'string' ? cluster : '';
}

function filterByQuery<Row extends { cluster: string; label: string | null | undefined }>(
  rows: Row[],
  query: string,
): Row[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    (r.cluster || '').toLowerCase().includes(q) ||
    (r.label || '').toLowerCase().includes(q));
}

export function qcVocabulary(
  dataset: Dataset | null | undefined,
  contrast: ResolvedContrast | null | undefined,
): QcVocabulary {
  const { baselineLabel: baseLabel, caseLabel } = groupLabels(contrast);
  const trackNoun = dataset?.trackNoun ?? 'population';
  return {
    baseLabel,
    caseLabel,
    trackNoun,
    trackNounPlural: `${trackNoun}s`,
    trackNounCap: trackNoun.charAt(0).toUpperCase() + trackNoun.slice(1),
    supportsPathways: dataset ? !!dataset.supportsPathways : true,
    hasDataset: !!dataset,
    sampleGroups: contrast
      ? [contrast.baseline, contrast.caseGroup]
      : LEGACY_FALLBACK_ARMS.map((arm, i) => ({
          ...arm,
          label: i === 0 ? baseLabel : caseLabel,
        })),
  };
}

export function runTable(
  qc: QcGlobal | null | undefined,
  meta: DatasetMeta | null | undefined,
  v: QcVocabulary,
): QcTableSpec<QcRunRow> {
  const runStatus = (qc?.runStatus ?? []) as QcRunStatusRecord[];
  const labels = meta?.labels ?? {};
  const rows = runStatus.map((r) => {
    const cluster = clusterId(r.cluster);
    return {
      _key: cluster,
      cluster,
      label: labels[cluster] || cluster,
      status: r.status,
      elapsed: r.elapsed_sec,
      message: r.message ?? '',
    };
  });
  const columns: SortableColumn<QcRunRow>[] = [
    { key: 'cluster', label: v.trackNounCap, align: 'left', color: (r) => trackColor(meta, r.cluster) },
    { key: 'label', label: 'Label', align: 'left' },
    { key: 'status', label: 'Status', align: 'left' },
  ];
  if (runStatus.some((r) => r.elapsed_sec != null)) {
    columns.push({ key: 'elapsed', label: 'Elapsed (s)', align: 'right' });
  }
  if (runStatus.some((r) => r.message != null && r.message !== '')) {
    columns.push({ key: 'message', label: 'Message', align: 'left', sortable: false });
  }
  return { rows, columns };
}

export function sizeTable(
  meta: DatasetMeta | null | undefined,
  v: QcVocabulary,
): QcTableSpec<QcSizeRow> {
  const qcFlags: Record<string, QCFlags> = meta?.qcFlags ?? {};
  const labels = meta?.labels ?? {};
  const rows = (meta?.populations ?? []).map((id) => {
    const q = qcFlags[id] || {};
    return {
      _key: id,
      cluster: id,
      label: labels[id] || id,
      nNormal: q.nNormal ?? null,
      nObese: q.nObese ?? null,
      is3v3: q.is3v3,
      minCells: q.minCells ?? null,
    };
  });
  return {
    rows,
    columns: [
      { key: 'cluster', label: v.trackNounCap, align: 'left', color: (r) => trackColor(meta, r.cluster) },
      { key: 'label', label: 'Label', align: 'left' },
      { key: 'nNormal', label: `n ${v.baseLabel}`, align: 'right' },
      { key: 'nObese', label: `n ${v.caseLabel}`, align: 'right' },
      { key: 'is3v3', label: 'Design', align: 'left',
        sortValue: (r) => r.is3v3 === true ? 0 : r.is3v3 === false ? 1 : 2 },
      { key: 'minCells', label: 'Min cells', align: 'right' },
      { key: 'samples', label: 'Replicate samples', align: 'left', sortable: false },
    ],
  };
}

export function deTable(
  qc: QcGlobal | null | undefined,
  meta: DatasetMeta | null | undefined,
  v: QcVocabulary,
  opts: { query: string; showAll: boolean },
): QcTableSpec<QcDeRow> & { hasExtraColumns: boolean } {
  const deSummary = (qc?.deSummary ?? []) as QcDeSummaryRecord[];
  const labels = meta?.labels ?? {};
  const allRows: QcDeRow[] = deSummary.map((r) => {
    const cluster = clusterId(r.cluster);
    return {
      _key: cluster,
      cluster,
      label: r.cluster_label ?? r.clusterLabel ?? labels[cluster],
      nGenes: r.nGenes,
      nSig: r.nSig,
      nDEG_lfc025: r.n_DEG_FDR05_lfc025,
      nDEG_leiThresh: r.n_DEG_FDR05_LeiThresh,
      nDEG_fragile: r.n_DEG_fragile_LOO,
      top5_up: r.top5_up,
      top5_down: r.top5_down,
    };
  });
  const deHas = (key: keyof QcDeRow) => allRows.some((r) => r[key] != null);
  const baseColumns = ([
    { key: 'cluster', label: v.trackNounCap, align: 'left', color: (r: QcDeRow) => trackColor(meta, r.cluster) },
    { key: 'label', label: 'Label', align: 'left' },
    deHas('nGenes') && { key: 'nGenes', label: 'Genes tested', align: 'right' },
    deHas('nDEG_lfc025') && { key: 'nDEG_lfc025', label: 'DEG (FDR<.05, lfc≥.25)', align: 'right' },
    deHas('nSig') && { key: 'nSig', label: 'Sig (P<0.01)', align: 'right' },
    deHas('nDEG_fragile') && { key: 'nDEG_fragile', label: 'Fragile LOO', align: 'right' },
    deHas('top5_up') && { key: 'top5_up', label: 'Top 5 ↑', align: 'left', sortable: false },
    deHas('top5_down') && { key: 'top5_down', label: 'Top 5 ↓', align: 'left', sortable: false },
  ].filter(Boolean)) as SortableColumn<QcDeRow>[];
  const extraColumns: SortableColumn<QcDeRow>[] = deHas('nDEG_leiThresh')
    ? [{ key: 'nDEG_leiThresh', label: 'DEG (Lei thresh)', align: 'right' }]
    : [];
  return {
    rows: filterByQuery(allRows, opts.query),
    columns: opts.showAll ? [...baseColumns, ...extraColumns] : baseColumns,
    hasExtraColumns: extraColumns.length > 0,
  };
}

export function fgseaTable(
  qc: QcGlobal | null | undefined,
  meta: DatasetMeta | null | undefined,
  v: QcVocabulary,
  opts: { query: string; showAll: boolean },
): QcTableSpec<FgseaAggregateRow> {
  const summary = (qc?.fgseaSummary ?? []) as LooseFgseaSummaryRecord[];
  const normalized: FgseaSummaryRecord[] = summary.map((r) => ({
    ...r,
    cluster: clusterId(r.cluster),
    cluster_label: r.cluster_label ?? undefined,
  }));
  const rows = filterByQuery(aggregateFgseaSummary(normalized), opts.query);
  const baseColumns: SortableColumn<FgseaAggregateRow>[] = [
    { key: 'cluster', label: v.trackNounCap, align: 'left', color: (r) => trackColor(meta, r.cluster) },
    { key: 'label', label: 'Label', align: 'left' },
    { key: 'hallmark_005', label: 'Hallmark (0.05)', align: 'right' },
    { key: 'kegg_005', label: 'KEGG (0.05)', align: 'right' },
    { key: 'gobp_005', label: 'GO_BP (0.05)', align: 'right' },
    { key: 'reactome_005', label: 'Reactome (0.05)', align: 'right' },
  ];
  const extraColumns: SortableColumn<FgseaAggregateRow>[] = [
    { key: 'hallmark_025', label: 'Hallmark (0.25)', align: 'right' },
    { key: 'kegg_025', label: 'KEGG (0.25)', align: 'right' },
    { key: 'gobp_025', label: 'GO_BP (0.25)', align: 'right' },
    { key: 'reactome_025', label: 'Reactome (0.25)', align: 'right' },
  ];
  return { rows, columns: opts.showAll ? [...baseColumns, ...extraColumns] : baseColumns };
}

export function compositionTables(
  qc: QcGlobal | null | undefined,
  meta: DatasetMeta | null | undefined,
  mode: 'counts' | 'props',
): { wide: QcTableSpec<QcCompositionRow>; daQuasi: QcTableSpec<QcCompositionRow>; hasData: boolean } {
  const composition = (qc?.composition ?? {}) as QcComposition;
  const wideSource = (mode === 'counts' ? composition.countsWide : composition.propsWide) || [];
  const wideRows = wideSource.map((r, i) => ({ ...r, _key: r.cluster ?? i }));
  let wideColumns: SortableColumn<QcCompositionRow>[] = [];
  if (wideSource.length > 0) {
    const keys = Object.keys(wideSource[0]);
    const prefix = commonSamplePrefix(keys.slice(1));
    wideColumns = keys.map((k, idx) => ({
      key: k,
      label: prefix && k.startsWith(prefix) ? k.slice(prefix.length) : k,
      align: idx === 0 ? 'left' : 'right',
      render: idx === 0 ? undefined : (r) => {
        const value = r[k];
        return typeof value === 'number' ? value.toFixed(mode === 'counts' ? 0 : 2) : value;
      },
    }));
  }

  const daQuasiSource = composition.daQuasiAll || [];
  const daQuasiRows = daQuasiSource.map((r, i) => ({ ...r, _key: r.cluster ?? i }));
  let daQuasiColumns: SortableColumn<QcCompositionRow>[] = [];
  if (daQuasiSource.length > 0) {
    daQuasiColumns = Object.keys(daQuasiSource[0]).map((k, idx) => ({
      key: k,
      label: k.replace(/_/g, ' '),
      align: idx === 0 ? 'left' : 'right',
      color: idx === 0 ? (r) => trackColor(meta, typeof r.cluster === 'string' ? r.cluster : '') : undefined,
      render: idx === 0 ? undefined : (r) => {
        const value = r[k];
        return typeof value === 'number'
          ? (Math.abs(value) < 0.001 ? value.toExponential(2) : value.toFixed(4))
          : value;
      },
    }));
  }

  return {
    wide: { rows: wideRows, columns: wideColumns },
    daQuasi: { rows: daQuasiRows, columns: daQuasiColumns },
    // Deliberately mode-dependent: this mirrors the legacy active-tab gate.
    hasData: wideRows.length > 0 || daQuasiRows.length > 0,
  };
}

export function reportTable(
  meta: DatasetMeta | null | undefined,
  v: QcVocabulary,
): QcTableSpec<QcReportRow> {
  const labels = meta?.labels ?? {};
  const qaFilenames = meta?.qaReportFilenames ?? {};
  const rows = (meta?.populations ?? []).map((id) => ({
    _key: id,
    cluster: id,
    label: labels[id] || id,
    filename: qaFilenames[id] || null,
  }));
  return {
    rows,
    columns: [
      { key: 'cluster', label: v.trackNounCap, align: 'left', color: (r) => trackColor(meta, r.cluster) },
      { key: 'label', label: 'Label', align: 'left' },
      { key: 'filename', label: 'QA report', align: 'left', sortable: false },
    ],
  };
}

export function qcKpis(
  qc: QcGlobal | null | undefined,
  meta: DatasetMeta | null | undefined,
): { pops: number; statusOk: number; statusFail: number; lowPower: number; noQa: number } {
  const runStatus = (qc?.runStatus ?? []) as QcRunStatusRecord[];
  return {
    pops: meta?.populations?.length || 0,
    statusOk: runStatus.filter((r) => r.status === 'ok').length,
    statusFail: runStatus.filter((r) => r.status && r.status !== 'ok').length,
    lowPower: Object.values(meta?.qcFlags ?? {}).filter(isLowPower).length,
    noQa: Object.values(meta?.qaReportFilenames ?? {}).filter((value) => !value).length,
  };
}

export function visibleQcSections(v: QcVocabulary, hasComposition: boolean): QcSection[] {
  return QC_SECTIONS.filter((section) =>
    (section.id !== 'fgsea' || v.supportsPathways) &&
    (section.id !== 'composition' || !v.hasDataset || hasComposition));
}
