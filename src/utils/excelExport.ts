// Shared XLSX/CSV sheet-row builders for the export paths across the gene +
// pathway explorers and Compare. Centralizes the two row shapes that were
// duplicated across ~5 export sites so they stay byte-identical. Object key
// order is deliberate: XLSX.utils.json_to_sheet derives column order from it.
import { mean } from './math';
import { pToStar } from './format';
import { getGroupedValues, getRawSampleRows, getValuesForGroups, meanColumnLabel, valueColumnName } from './sampleValues';
import { requireContrast } from '../data/contrasts';
import type { Group, PathwayRecordWithDb, PopData } from '../types';

export type SheetRow = Record<string, string | number>;

// One tidy row per (gene, present sample): real sample id, the group label as
// Condition, and the unit-aware value column (CPM stays "NormCPM"). Null cells
// are already dropped by getRawSampleRows. Columns: Gene, Sample, Condition, <value>.
// Used for the RawValues / RawCPM / GeneCPM sheets (single-pop). Compare prepends
// a Pop column by spreading: `rawValueRows(pd, genes).map(r => ({ Pop, ...r }))`.
// `groups` widens the sheet past the contrast's two arms (the multi-condition
// export); omitted, it is the two arms exactly as before.
export function rawValueRows(
  popData: PopData,
  genes: string[],
  groups?: Group[] | null,
): SheetRow[] {
  const valueKey = valueColumnName(popData);
  return getRawSampleRows(popData, genes, groups).map((r) => ({
    Gene: r.gene,
    Sample: r.sample,
    Condition: r.condition,
    [valueKey]: r.value,
  }));
}

// The two per-group mean columns (rounded to 4dp) for one gene, keyed by the
// unit-aware header from the sample-value seam (meanColumnLabel), so a
// log2-normalized dataset's means are never mislabelled CPM. Column order:
// Mean<base><unit>, Mean<case><unit>. Spread into a row: `{ ...stats, ...groupMeanColumns(pd, g) }`.
export function groupMeanColumns(popData: PopData, gene: string, groups?: Group[]): SheetRow {
  if (groups) {
    return Object.fromEntries(getValuesForGroups(popData, gene, groups).map((group) => [
      meanColumnLabel(popData, group.label), group.n ? +mean(group.values).toFixed(4) : '',
    ]));
  }
  const { baseline, caseGroup } = requireContrast(popData.contrast);
  const [b, c] = getGroupedValues(popData, gene, popData.contrast);
  return {
    [meanColumnLabel(popData, baseline.label)]: +mean(b?.values ?? []).toFixed(4),
    [meanColumnLabel(popData, caseGroup.label)]: +mean(c?.values ?? []).toFixed(4),
  };
}

// One row per gene: DE stats + the two per-group means, sourced through the
// value seam so the means follow real group membership and carry unit-aware
// headers (Mean<label>CPM / Mean<label>Log2 — same convention as the CSV path).
// Columns: Gene, logFC, PValue, FDR, Stars, Mean<base><unit>, Mean<case><unit>.
// Callers that need an extra trailing column (e.g. IsQueryGene) spread:
// `{ ...row, IsQueryGene }`.
export function leadingEdgeSummaryRows(popData: PopData, genes: string[], groups?: Group[]): SheetRow[] {
  return genes.map((gene) => {
    const de = popData.deByGene[gene];
    return {
      Gene: gene,
      logFC: de?.logFC ?? '',
      PValue: de?.PValue ?? '',
      FDR: de?.FDR ?? '',
      Stars: pToStar(de?.PValue ?? 1),
      ...groupMeanColumns(popData, gene, groups),
    };
  });
}

// The one-row PathwayInfo sheet (pathway metadata + provenance). QueryGene is
// inserted before Population only when a query gene is present — preserving the
// two historical column orders (gene modal vs pathway explorer detail).
export function pathwayInfoRows(
  pathway: PathwayRecordWithDb,
  populationCode: string,
  options?: { queryGene?: string },
): SheetRow[] {
  const leadingEdge = pathway.leadingEdge ?? [];
  return [{
    Pathway: pathway.pathway,
    Database: pathway.db,
    NES: pathway.NES,
    FDR: pathway.padj,
    PValue: pathway.pval,
    Size: pathway.size,
    LeadingEdgeCount: leadingEdge.length,
    ...(options?.queryGene ? { QueryGene: options.queryGene } : {}),
    Population: populationCode,
  }];
}
