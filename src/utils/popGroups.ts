// Shared track grouping for the sidebar (App) and the Compare cell picker.
// Groups track ids by category (cell type). Known categories appear first in
// the provided categoryOrder, then any remaining categories alphabetically.
// Within a group, ids sort naturally (e2 < e10, Ast1 < Ast2).
//
// Pure: groupByType(ids, opts) where opts = { types, categoryOrder }:
//   - opts.types: id -> category map (from the active dataset meta). Required
//     input (may be null mid-load — every id then lands in 'Other').
//   - opts.categoryOrder: ordered category names (dataset.trackCategoryOrder);
//     defaults to the macaque GROUP_ORDER.

export const GROUP_ORDER: string[] = [
  'Glutamatergic',
  'GABAergic',
  'Histaminergic',
  'Oxytocin',
  'Non-neuronal',
];

export interface GroupByTypeOpts {
  types: Readonly<Record<string, string>> | null | undefined;
  categoryOrder?: readonly string[];
}

const byNatural = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export function groupByType(
  ids: readonly string[],
  opts: GroupByTypeOpts,
): Record<string, string[]> {
  const types = opts.types;
  const categoryOrder = opts.categoryOrder ?? GROUP_ORDER;

  const groups: Record<string, string[]> = {};
  for (const id of ids) {
    const type = types?.[id] || 'Other';
    if (!groups[type]) groups[type] = [];
    groups[type].push(id);
  }
  for (const k of Object.keys(groups)) groups[k].sort(byNatural);
  const sorted: Record<string, string[]> = {};
  for (const k of categoryOrder) if (groups[k]) sorted[k] = groups[k];
  for (const k of Object.keys(groups).sort()) if (!sorted[k]) sorted[k] = groups[k];
  return sorted;
}
