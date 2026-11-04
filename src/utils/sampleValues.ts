// The sample-value seam.
//
// Resolves a dataset's contrast groups to their samples' positions in the cpm
// array, and reads per-group / per-sample values from there. Nothing here
// assumes 6 samples or a positional 3+3 split — group membership comes from
// popData.groupSamples, mapped through popData.sampleOrder to a cpm index.
//
// One indexing primitive underlies the whole concern:
//   columnsForGroups(popData, groups) → ANY list of groups with each sample's
//     index (the ONE place the group→sampleId→index resolution and the
//     index<0 / null-drop contract live).
//   getGroupColumns(popData, contrast?) → the [baseline, caseGroup] case of it.
//   sampleAxis(popData, contrast?) → the WHOLE sample axis in sampleOrder order,
//     each slot tagged with the arm that claims it (null when a sample is in
//     neither), for views that render every column rather than just the arms.
//   getGroupedValues(popData, feature, contrast?) → per-group aggregated values
//     for charts (built on getGroupColumns; public shape unchanged).
//   getValuesForGroups(popData, feature, groups) → the same aggregation over an
//     explicit group list, for the multi-condition chart of a factorial design.
//   getRawSampleRows(popData, features, groups?) → tidy
//     { gene, sample, condition, value } rows for CSV/XLSX export.
//   valueColumnName / meanColumnLabel → unit-aware export headers so a
//     log2-normalized dataset isn't mislabelled "CPM".
//   groupLabels → the [baseline, caseGroup] display labels with NEUTRAL
//     fallbacks, so a null contrast never renders another dataset's vocabulary.

import { CPM_TMM_UNIT, LEGACY_CPM_UNIT, parseLog2WithOffset } from '../data/expressionUnits';
import type { Group, PopData, ResolvedContrast } from '../types';

export interface SampleIndex {
  id: string;
  index: number;
}

export interface GroupColumn {
  key: string;
  label: string;
  color: string;
  samples: SampleIndex[];
}

// One slot of the sample axis: a sampleOrder position (= its cpm column, ready
// for valueAt) plus the contrast arm that claims it. `group` is null for a
// sample that belongs to NEITHER arm — a real case (an extra arm of a
// multi-group dataset, an unassigned replicate) that views render rather than
// hide, which is why the axis is not just the two arms concatenated.
export interface SampleSlot {
  id: string;
  index: number;
  group: Omit<GroupColumn, 'samples'> | null;
}

export interface GroupValues {
  key: string;
  label: string;
  color: string;
  values: number[];
  n: number;
}

export interface SampleRow {
  gene: string;
  sample: string;
  condition: string;
  value: number;
}

// Resolve an EXPLICIT list of groups to their samples + each sample's index in
// popData.sampleOrder, in the order given. This is the primitive; getGroupColumns
// is the two-arm case of it.
//
// It exists because a contrast is not the only lens on a track. A factorial
// dataset declares more design cells than any single contrast draws (GSE135639
// has four — chow/HFD × P0/P21 — and each contrast draws two of them), and the
// question "what does this gene do across the whole design?" needs all of them
// on one axis. Group membership still comes from popData.groupSamples, so a
// group naming samples the track does not carry simply renders empty rather
// than shifting anyone else's values.
export function columnsForGroups(
  popData: PopData | null | undefined,
  groups: Array<Group | null | undefined> | null | undefined,
): GroupColumn[] {
  if (!popData || !groups?.length) return [];
  const sampleOrder = popData.sampleOrder ?? [];
  const groupSamples = popData.groupSamples ?? {};
  const out: GroupColumn[] = [];
  for (const group of groups) {
    if (!group) continue;
    out.push({
      key: group.key,
      label: group.label,
      color: group.color,
      samples: (groupSamples[group.key] ?? []).map((id) => ({ id, index: sampleOrder.indexOf(id) })),
    });
  }
  return out;
}

// Resolve [baseline, caseGroup] to their samples + each sample's index in
// popData.sampleOrder. index === -1 means the sample id isn't in sampleOrder;
// value reads drop those (see valueAt). Returns [] for null popData / contrast.
export function getGroupColumns(
  popData: PopData | null | undefined,
  contrast?: ResolvedContrast | null,
): GroupColumn[] {
  const c = contrast ?? popData?.contrast;
  if (!popData || !c) return [];
  return columnsForGroups(popData, [c.baseline, c.caseGroup]);
}

// The full sample axis, in sampleOrder order: one slot per cpm column, tagged
// with the contrast arm that claims it. Membership is decided by exactly the
// resolution getGroupColumns performs — the arms are walked in
// [baseline, caseGroup] order and the FIRST one claiming a sample wins — so a
// view never re-derives group→sample membership from popData.groupSamples.
// EVERY sampleOrder slot is returned regardless of membership; only the tag is
// the groups' business. The lone index<0 rule stays in getGroupColumns/valueAt:
// a groupSamples id absent from sampleOrder has no slot here to tag, so it
// simply never appears, and no slot is dropped on its account.
export function sampleAxis(
  popData: PopData | null | undefined,
  contrast?: ResolvedContrast | null,
  groups?: Group[],
): SampleSlot[] {
  const armOf = new Map<string, Omit<GroupColumn, 'samples'>>();
  for (const col of groups ? columnsForGroups(popData, groups) : getGroupColumns(popData, contrast)) {
    const group = { key: col.key, label: col.label, color: col.color };
    for (const s of col.samples) {
      if (!armOf.has(s.id)) armOf.set(s.id, group);
    }
  }
  return (popData?.sampleOrder ?? []).map((id, index) => ({
    id,
    index,
    group: armOf.get(id) ?? null,
  }));
}

// The single source of the "missing value is dropped" rule: a sample with no
// sampleOrder index, or a null/undefined cpm cell, reads as null. Exported so
// geneExport's wide per-sample columns read through this one rule too, instead
// of re-implementing the index<0 / null-cell drop.
export function valueAt(popData: PopData, feature: string, index: number): number | null {
  if (index < 0) return null;
  const v = popData.cpm?.[feature]?.[index];
  return v == null ? null : v;
}

// Aggregate resolved columns to one feature's per-group values. The nulls are
// already dropped by valueAt, so `n` is the number of samples that actually
// carry a value — not the size of the arm on paper.
function valuesFromColumns(
  popData: PopData,
  feature: string,
  columns: GroupColumn[],
): GroupValues[] {
  return columns.map((group) => {
    const values: number[] = [];
    for (const s of group.samples) {
      const v = valueAt(popData, feature, s.index);
      if (v != null) values.push(v);
    }
    return { key: group.key, label: group.label, color: group.color, values, n: values.length };
  });
}

// Per-group aggregated values for one feature, in [baseline, caseGroup] order.
// Public shape unchanged: [{ key, label, color, values:number[], n }].
export function getGroupedValues(
  popData: PopData | null | undefined,
  feature: string,
  contrast?: ResolvedContrast | null,
): GroupValues[] {
  if (!popData || !(contrast ?? popData?.contrast)) return [];
  return valuesFromColumns(popData, feature, getGroupColumns(popData, contrast));
}

// The same aggregation over an EXPLICIT group list rather than a contrast's two
// arms — the multi-condition chart's reader. Order follows `groups`.
export function getValuesForGroups(
  popData: PopData | null | undefined,
  feature: string,
  groups: Array<Group | null | undefined> | null | undefined,
): GroupValues[] {
  if (!popData) return [];
  return valuesFromColumns(popData, feature, columnsForGroups(popData, groups));
}

// Tidy per-sample rows for export, across `features`. One row per (feature,
// present sample): { gene, sample, condition, value }. The value is unit-neutral;
// callers name the column with valueColumnName(popData).
//
// `groups` widens the export past the contrast's two arms — the multi-condition
// view exports every design cell it drew, not the pair the active contrast
// happens to name. Omitted, it is exactly the contrast's two arms as before.
export function getRawSampleRows(
  popData: PopData,
  features: string[],
  groups?: Array<Group | null | undefined> | null,
): SampleRow[] {
  const cols = groups?.length ? columnsForGroups(popData, groups) : getGroupColumns(popData);
  const rows: SampleRow[] = [];
  for (const gene of features) {
    for (const group of cols) {
      for (const s of group.samples) {
        const v = valueAt(popData, gene, s.index);
        if (v == null) continue;
        rows.push({ gene, sample: s.id, condition: group.label, value: v });
      }
    }
  }
  return rows;
}

// Human-readable unit token for on-screen labels (chart captions, table
// headers): "CPM", "log2", or the dataset's own unit string verbatim. An
// unknown unit is shown as itself, never mislabelled "CPM". This is the display
// counterpart of the camel-cased export headers below — every view that names
// the expression unit reads it from here, so one dataset fact has one spelling.
// Takes the minimal structural shape rather than PopData, as unitProvenance
// below already does, so chartScale.ts can shorten a bare unit string without a
// cast and the shortening rule stays spelled once.
export function displayUnit(source: { expressionUnit?: string } | null | undefined): string {
  const unit = source?.expressionUnit || CPM_TMM_UNIT;
  return unit === 'log2-normalized' ? 'log2' : unit;
}

// One-line provenance for the expression unit, used as the `title` tooltip
// wherever displayUnit's token is rendered. It exists because "why CPM and not
// TPM?" is a recurring question about these charts, and the answer is a property
// of the data, not of the view: none of the bundles carry gene lengths, and the
// macaque source is 3'-tag snRNA-seq, where a length correction is not just
// absent but wrong (one count per molecule regardless of transcript length).
// Kept beside displayUnit so the unit and its explanation never drift apart.
// Takes the minimal structural shape rather than PopData so a Dataset manifest
// entry (which carries the same field) can be explained without a cast.
export function unitProvenance(source: { expressionUnit?: string } | null | undefined): string {
  const unit = source?.expressionUnit || CPM_TMM_UNIT;
  if (unit === CPM_TMM_UNIT) {
    return 'CPM (TMM-normalized) — counts per million on TMM-effective library sizes: '
      + 'per-sample counts ÷ (library size × TMM normalization factor) × 1e6, using the '
      + 'library sizes and TMM factors of the study’s own edgeR fit. '
      + 'Not gene-length normalized (so not TPM/FPKM): '
      + 'compare one gene across samples, not different genes against each other.';
  }
  if (unit === LEGACY_CPM_UNIT) {
    return 'CPM — counts per million: per-sample counts ÷ library size × 1e6. '
      + 'Library-size normalized, NOT gene-length normalized (so not TPM/FPKM): '
      + 'compare one gene across samples, not different genes against each other.';
  }
  if (unit === 'log2-normalized') {
    return 'log2-normalized — deposited by the original study already on a log2 scale. '
      + 'Raw counts were not available, so the values are shown unchanged: the '
      + 'normalization and transform are the submitters’ own.';
  }
  const logged = parseLog2WithOffset(unit);
  if (logged) {
    const { base, offset } = logged;
    const length = /\b(FPKM|RPKM|TPM)\b/i.test(base)
      ? ` The ${base} values include a gene-length correction.`
      : /\bCPM\b/i.test(base) ? ` The ${base} values are library-size normalized, not gene-length normalized.` : '';
    return `${unit} — log2 of (${base} + ${offset}). Adding ${offset} keeps zeros finite, `
      + `so the ${base} values can be recovered exactly.${length} `
      + 'The Methodology page describes how deposited matrices are handled.';
  }
  return `${unit} — see the Methodology page for how this dataset’s values were normalized.`;
}

// Display labels for a contrast's two arms. Every spelling of the group-label
// fallback resolves here: when the contrast is resolved (the overwhelming case)
// these are the contrast's own labels, unchanged; on the degraded null-contrast
// path they fall back to the NEUTRAL 'Baseline'/'Case' — never one dataset's
// vocabulary ('Normal'/'Obese') on another dataset's screen or inside its
// downloaded workbook.
export function groupLabels(
  contrast: ResolvedContrast | null | undefined,
): { baselineLabel: string; caseLabel: string } {
  return {
    baselineLabel: contrast?.baseline?.label ?? 'Baseline',
    caseLabel: contrast?.caseGroup?.label ?? 'Case',
  };
}

// Export column header for the raw per-sample value, honouring the dataset's
// expression unit. TMM-normalized CPM (every count dataset) names its unit in
// full; a plain-CPM value keeps the historical "NormCPM" header; other units
// get a unit-specific header so they read honestly (a log2-normalized dataset
// is NOT CPM).
export function valueColumnName(popData: PopData | null | undefined): string {
  const unit = popData?.expressionUnit || CPM_TMM_UNIT;
  if (unit === CPM_TMM_UNIT) return CPM_TMM_UNIT;
  if (unit === LEGACY_CPM_UNIT) return 'NormCPM';
  if (unit === 'log2-normalized') return 'Log2NormExpr';
  return 'NormValue';
}

// Export header for a per-group mean column, e.g. "MeanNormal CPM (TMM-normalized)"
// (count datasets), "MeanNormalCPM" (plain CPM) or "MeanChowLog2" (log2-normalized).
export function meanColumnLabel(popData: PopData | null | undefined, groupLabel: string): string {
  const unit = popData?.expressionUnit || CPM_TMM_UNIT;
  if (unit === CPM_TMM_UNIT) return `Mean${groupLabel} ${CPM_TMM_UNIT}`;
  const suffix = unit === LEGACY_CPM_UNIT ? 'CPM' : unit === 'log2-normalized' ? 'Log2' : 'Value';
  return `Mean${groupLabel}${suffix}`;
}
