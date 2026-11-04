// Shared CSV / Excel exporters for a set of genes, used by both the SummaryTable
// and the Bar charts pop-up so the two stay byte-for-byte identical.
//
// SCOPE. Both exporters take an optional `scope` that widens what they cover,
// and it exists so a download can never describe a different picture than the
// chart it sits beside. The bar-charts pop-up can draw a factorial dataset's
// FOUR design cells with one bracket per declared comparison; exporting the
// active contrast's two arms from under that view would hand back a file that
// silently drops half the data and three quarters of the statistics.
//
// Omitted, the scope is the active contrast's two arms and ONE stat block.
// Provenance is appended without moving the existing scientific columns.
import { mean } from '../utils/math';
import { pToStar } from '../utils/format';
import { columnsForGroups, groupLabels, meanColumnLabel, valueAt } from '../utils/sampleValues';
import { rawValueRows } from '../utils/excelExport';
import { writeWorkbook } from '../utils/workbook';
import { downloadFile } from '../utils/exportAction';
import { exportCsvCell, exportName, exportProvenance, metadataSheet, provenanceColumns, provenanceColumnValues, trackSubject } from '../utils/exportProvenance';
import type { ExportKind, ExportSettings } from '../utils/exportProvenance';
import type { GeneDERecord, Group, PopData, ResolvedContrast } from '../types';

export interface GeneExportScope {
  /** Display choices recorded with the exported native-scale values. */
  settings?: ExportSettings;
  /** Draw these groups' means + samples instead of the contrast's two arms. */
  groups?: Group[];
  /**
   * One stat block per contrast instead of the active contrast's alone. Shaped
   * structurally (not as ContrastMatrix's `ContrastSlice`) so this module keeps
   * no dependency on a view.
   */
  slices?: Array<{ contrast: ResolvedContrast; popData: PopData }>;
}

/** One logFC/P/FDR/Stars block. `label` is '' for the single-contrast default,
 *  which is what keeps the historical headers unsuffixed. */
interface StatBlock {
  label: string;
  deByGene: Record<string, GeneDERecord | undefined>;
}

interface SummaryRow {
  gene: string;
  /** Parallel to statBlocks(). */
  stats: Array<{ logFC: number | null; PValue: number | null; FDR: number | null; star: string }>;
  /** Parallel to exportGroups(). */
  means: Array<number | null>;
}

interface SampleColumn {
  header: string;
  sample: string;
  condition: string;
  idx: number;
}

// The groups this export covers. Without a scope these are the contrast's two
// arms under the labels groupLabels owns — the ONE spelling of the
// baseline/case fallback, so a header can never read another dataset's
// vocabulary, and a null contrast still yields the two neutrally-named columns
// (with no samples behind them) it always did.
function exportGroups(popData: PopData, scope?: GeneExportScope): Group[] {
  if (scope?.groups?.length) return scope.groups;
  const c = popData.contrast;
  const { baselineLabel, caseLabel } = groupLabels(c);
  return [
    { key: c?.baseline?.key ?? '', label: baselineLabel, color: c?.baseline?.color ?? '' },
    { key: c?.caseGroup?.key ?? '', label: caseLabel, color: c?.caseGroup?.color ?? '' },
  ];
}

function statBlocks(popData: PopData, scope?: GeneExportScope): StatBlock[] {
  if (scope?.slices?.length) {
    return scope.slices.map((s) => ({ label: s.contrast.label, deByGene: s.popData.deByGene }));
  }
  return [{ label: '', deByGene: popData.deByGene }];
}

const statHeaders = (block: StatBlock): string[] =>
  (block.label
    ? ['logFC', 'PValue', 'FDR', 'Stars'].map((h) => `${h} (${block.label})`)
    : ['logFC', 'PValue', 'FDR', 'Stars']);

// Per-gene summary row: full-precision DE stats plus the per-group mean values,
// sourced through the single value seam (columnsForGroups → valueAt) so the
// means follow the dataset's real group membership rather than a positional
// 3+3 slice.
function buildRows(
  genes: string[],
  popData: PopData,
  groups: Group[],
  blocks: StatBlock[],
): SummaryRow[] {
  const columns = columnsForGroups(popData, groups);
  return genes.map((gene) => ({
    gene,
    stats: blocks.map((b) => {
      const de = b.deByGene[gene];
      return {
        logFC: de?.logFC ?? null,
        PValue: de?.PValue ?? null,
        FDR: de?.FDR ?? null,
        star: de?.PValue == null ? '' : pToStar(de.PValue),
      };
    }),
    means: columns.map((col) => {
      const vals: number[] = [];
      for (const s of col.samples) {
        const v = valueAt(popData, gene, s.index);
        if (v != null) vals.push(v);
      }
      return vals.length ? mean(vals) : null;
    }),
  }));
}

// Per-sample WIDE column descriptors, built from the exported groups via the
// value seam (group membership → index in sampleOrder), in group order. The
// header is the SAMPLE ID (`${id} (${label})`) — not a unit label.
function sampleColumns(popData: PopData, groups: Group[]): SampleColumn[] {
  const cols: SampleColumn[] = [];
  for (const group of columnsForGroups(popData, groups)) {
    for (const s of group.samples) {
      cols.push({ header: `${s.id} (${group.label})`, sample: s.id, condition: group.label, idx: s.index });
    }
  }
  return cols;
}

/**
 * The gene adapter over the export-provenance module: the generic track
 * snapshot plus the three settings every gene file records. Shared by the
 * Contrast matrix and the gene pathway pop-up, which export the same genes
 * under other kinds.
 */
export function geneExportProvenance(
  kind: ExportKind, popData: PopData, geneCount: number, groups: Group[], contrasts: ResolvedContrast[],
  settings: ExportSettings = {},
) {
  return exportProvenance(kind, trackSubject(popData, { contrasts, groups }), {
    ...settings, geneCount, geneSelection: 'Explicit genes in the exported row order; volcano thresholds do not filter this selection.',
    significanceStars: 'Unadjusted PValue: **** <0.0001; *** <0.001; ** <0.01; * <0.05; ns otherwise; blank when unavailable.',
  });
}

function exportContrasts(popData: PopData, scope?: GeneExportScope): ResolvedContrast[] {
  return scope?.slices?.length ? scope.slices.map((slice) => slice.contrast) : popData.contrast ? [popData.contrast] : [];
}

// One row per gene: full-precision stats + per-group mean CPM + each sample's raw CPM.
export function exportGenesCSV(genes: string[], popData: PopData, scope?: GeneExportScope): void {
  const groups = exportGroups(popData, scope);
  const blocks = statBlocks(popData, scope);
  const rows = buildRows(genes, popData, groups, blocks);
  const sampleCols = sampleColumns(popData, groups);
  const contrasts = exportContrasts(popData, scope);
  const metadata = geneExportProvenance('genes_summary', popData, genes.length, groups, contrasts, scope?.settings);
  const provenance = provenanceColumns(metadata);
  const headers = ['Gene',
    ...blocks.flatMap(statHeaders),
    ...groups.map((g) => meanColumnLabel(popData, g.label)),
    ...sampleCols.map((c) => c.header), ...Object.keys(provenance)];
  const csvRows = [headers.map(exportCsvCell).join(','), ...rows.map((r, index) =>
    [r.gene,
      ...r.stats.flatMap((s) => [s.logFC, s.PValue, s.FDR, s.star]),
      ...r.means,
      ...sampleCols.map((c) => valueAt(popData, r.gene, c.idx)),
      ...provenanceColumnValues(provenance, index)].map(exportCsvCell).join(','),
  )].join('\n');
  downloadFile(exportName(trackSubject(popData, { contrasts }), ['genes_summary'], 'csv'),
    `data:text/csv;charset=utf-8,${encodeURIComponent(csvRows)}`);
}

// A Summary sheet (one row per gene + per-sample columns) plus a tidy RawValues
// sheet (one row per gene×sample). The mean headers come from meanColumnLabel —
// the SAME rule as the CSV path above — so the two formats can never disagree
// about a dataset's expression unit again.
// Returns a promise that never rejects (writeWorkbook contains the failure), so
// callers may fire-and-forget it exactly as they did when this was synchronous.
export function exportGenesExcel(genes: string[], popData: PopData, scope?: GeneExportScope): Promise<void> {
  const groups = exportGroups(popData, scope);
  const blocks = statBlocks(popData, scope);
  const rows = buildRows(genes, popData, groups, blocks);
  const sampleCols = sampleColumns(popData, groups);
  const contrasts = exportContrasts(popData, scope);
  const metadata = geneExportProvenance('genes_export', popData, genes.length, groups, contrasts, scope?.settings);
  const summaryRows = rows.map((r) => ({
    Gene: r.gene,
    ...Object.fromEntries(blocks.flatMap((b, i) =>
      statHeaders(b).map((h, j) => [h, [r.stats[i].logFC, r.stats[i].PValue, r.stats[i].FDR, r.stats[i].star][j]]))),
    ...Object.fromEntries(groups.map((g, i) => [meanColumnLabel(popData, g.label), r.means[i]])),
    ...Object.fromEntries(sampleCols.map((c) => [c.header, valueAt(popData, r.gene, c.idx)])),
  }));
  return writeWorkbook(exportName(trackSubject(popData, { contrasts }), ['genes_export'], 'xlsx'), [
    { name: 'Summary', rows: summaryRows },
    { name: 'RawValues', rows: rawValueRows(popData, genes, scope?.groups) },
    metadataSheet(metadata),
  ]);
}
