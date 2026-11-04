import { designCells } from '../data/contrasts';
import type { ContrastSlice } from '../gene-explorer/ContrastMatrix';
import { leadingEdgeSummaryRows, pathwayInfoRows, rawValueRows } from '../utils/excelExport';
import { pToStar } from '../utils/format';
import { exportName, exportProvenance, metadataSheet, trackSubject } from '../utils/exportProvenance';
import type { ExportSettings } from '../utils/exportProvenance';
import type { WorkbookSheet } from '../utils/workbook';
import type { PathwayRecordWithDb, PopData } from '../types';

/** A workbook described as data: what the workbook seam writes, under the name provenance gives it. */
export interface PathwayWorkbook {
  filename: string;
  sheets: WorkbookSheet[];
}

/** Match by both database and name: a label alone is not a pathway identity. */
export function pathwayInSlice(pathway: PathwayRecordWithDb, slice: ContrastSlice): PathwayRecordWithDb | undefined {
  return slice.popData.allPathways.find((row) => row.db === pathway.db && row.pathway === pathway.pathway);
}

export function leadingEdgeSheets(
  popData: PopData,
  genes: string[],
  slices?: ContrastSlice[],
  options?: { queryGene?: string; rawSheetName?: string },
): WorkbookSheet[] {
  const cells = designCells(slices?.map((slice) => slice.contrast));
  const groups = cells.length > 2 ? cells : undefined;
  const sheets: WorkbookSheet[] = [
    { name: 'LeadingEdge', rows: leadingEdgeSummaryRows(popData, genes, groups).map((row) => ({
      ...row,
      ...((slices?.length ?? 0) > 1 ? { Comparison: popData.contrast?.label ?? '' } : {}),
      ...(options?.queryGene ? { IsQueryGene: row.Gene === options.queryGene ? 'YES' : '' } : {}),
    })) },
    { name: options?.rawSheetName ?? 'RawValues', rows: rawValueRows(popData, genes, groups) },
  ];
  if ((slices?.length ?? 0) > 1) {
    sheets.push({ name: 'GeneComparisons', rows: slices!.flatMap((slice) => genes.map((gene) => {
      const de = slice.popData.deByGene[gene];
      return {
        Gene: gene, Comparison: slice.contrast.label,
        Status: de ? 'Available' : 'Not detected',
        logFC: de?.logFC ?? '', PValue: de?.PValue ?? '', FDR: de?.FDR ?? '',
        Stars: de ? pToStar(de.PValue) : '',
      };
    })) });
  }
  return sheets;
}

/** The workbook keeps the selected pathway's leading edge and identifies the
 * comparison behind every statistic, including absent comparisons. */
export function pathwayDetailSheets(
  pathway: PathwayRecordWithDb,
  popData: PopData,
  slices?: ContrastSlice[],
  options?: { queryGene?: string },
): WorkbookSheet[] {
  const sheets: WorkbookSheet[] = [
    { name: 'PathwayInfo', rows: pathwayInfoRows(pathway, popData.meta?.code ?? '', options).map((row) => ({
      ...row,
      ...((slices?.length ?? 0) > 1 ? { Comparison: popData.contrast?.label ?? '' } : {}),
    })) },
    ...leadingEdgeSheets(popData, pathway.leadingEdge ?? [], slices, { ...options, rawSheetName: 'RawCPM' }),
  ];
  if ((slices?.length ?? 0) > 1) {
    sheets.push({ name: 'PathwayComparisons', rows: slices!.map((slice) => {
      const row = pathwayInSlice(pathway, slice);
      return {
        Pathway: pathway.pathway, Database: pathway.db, Comparison: slice.contrast.label,
        Status: row ? 'Available' : 'Not available',
        NES: row?.NES ?? '', FDR: row?.padj ?? '', PValue: row?.pval ?? '',
        Size: row?.size ?? '', LeadingEdge: row?.leadingEdge.join('; ') ?? '',
      };
    }) });
  }
  return sheets;
}

// The track a pathway-detail or leading-edge workbook is evidence of. With more
// than one contrast slice the workbook carries a comparison sheet per slice
// (above), so the record names every slice's contrast and every design cell it
// draws; otherwise it is the active contrast and its two arms.
function detailSubject(popData: PopData, slices?: ContrastSlice[]) {
  const multi = (slices?.length ?? 0) > 1;
  const cells = designCells(slices?.map((slice) => slice.contrast));
  return trackSubject(popData, {
    ...(multi ? { contrasts: slices!.map((slice) => slice.contrast) } : {}),
    ...(cells.length > 2 ? { groups: cells } : {}),
  });
}

const selectedPathway = (pathway: PathwayRecordWithDb) => ({ database: pathway.db, pathway: pathway.pathway });

/**
 * The Pathway Explorer's table export: the rows passing the on-screen filters,
 * in the on-screen order, named and recorded with its dataset, track and
 * contrast so the contrasts of one track never share a file.
 */
export function pathwayTableWorkbook(
  popData: PopData,
  rows: readonly PathwayRecordWithDb[],
  filters: NonNullable<ExportSettings['pathwayFilters']>,
): PathwayWorkbook {
  const subject = trackSubject(popData);
  return {
    filename: exportName(subject, ['pathways_export'], 'xlsx'),
    sheets: [
      { name: 'Pathways', rows: rows.map((p) => ({
        Pathway: p.pathway, DB: p.db, NES: p.NES,
        P_value: p.pval, FDR_padj: p.padj, Size: p.size,
        LeadingEdge: (p.leadingEdge || []).join('; '),
      })) },
      metadataSheet(exportProvenance('pathways_export', subject, {
        pathwayFilters: { ...filters, dbFilter: { ...filters.dbFilter } },
        rowCount: rows.length,
        rowSelection: "Rows passing the database, search and FDR filters, in the table's sort order; paging does not limit the export.",
      })),
    ],
  };
}

/** The selected pathway's full detail, as the Pathway Explorer's detail panel exports it. */
export function pathwayDetailWorkbook(
  pathway: PathwayRecordWithDb,
  popData: PopData,
  slices?: ContrastSlice[],
): PathwayWorkbook {
  const subject = detailSubject(popData, slices);
  return {
    filename: exportName(subject, ['pathway_detail', pathway.pathway], 'xlsx'),
    sheets: [
      ...pathwayDetailSheets(pathway, popData, slices),
      metadataSheet(exportProvenance('pathway_detail', subject, {
        selectedPathway: selectedPathway(pathway), leadingEdgeGenes: pathway.leadingEdge?.length ?? 0,
      })),
    ],
  };
}

/** The leading-edge view's export: every leading-edge gene, not just the ones drawn. */
export function leadingEdgeWorkbook(
  pathway: PathwayRecordWithDb,
  popData: PopData,
  genes: string[],
  slices?: ContrastSlice[],
): PathwayWorkbook {
  const subject = detailSubject(popData, slices);
  return {
    filename: exportName(subject, ['leadingedge', pathway.pathway], 'xlsx'),
    sheets: [
      ...leadingEdgeSheets(popData, genes, slices),
      metadataSheet(exportProvenance('leadingedge', subject, {
        selectedPathway: selectedPathway(pathway), leadingEdgeGenes: genes.length,
      })),
    ],
  };
}
