export type FgseaTextRow = Record<string, string>;

const numeric = (value: string | undefined): number | null => {
  if (value == null || value.trim() === '' || value === 'NA' || value === 'NaN') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const sortedDifference = (left: Set<string>, right: Set<string>) => (
  [...left].filter((value) => !right.has(value)).sort()
);

const edgeSet = (row: FgseaTextRow) => [...new Set((row.leadingEdge ?? '').split(';').filter(Boolean))].sort().join(';');

/** Compare whole contrast/collection result universes, not just shared calls. */
export function compareFgseaRows(previous: FgseaTextRow[], current: FgseaTextRow[]) {
  const before = new Map(previous.map((row) => [row.pathway, row]));
  const after = new Map(current.map((row) => [row.pathway, row]));
  if (before.size !== previous.length || after.size !== current.length) {
    throw new Error('FGSEA migration comparison requires unique pathway names');
  }
  const beforeNames = new Set(before.keys());
  const afterNames = new Set(after.keys());
  const sharedNames = [...afterNames].filter((name) => beforeNames.has(name));
  const addedPathways = sortedDifference(afterNames, beforeNames);
  const removedPathways = sortedDifference(beforeNames, afterNames);
  const significant = (rows: FgseaTextRow[]) => new Set(rows.filter((row) => {
    const fdr = numeric(row.padj);
    return fdr != null && fdr < 0.05;
  }).map((row) => row.pathway));
  const beforeCalls = significant(previous);
  const afterCalls = significant(current);
  const gainedFdrCalls = sortedDifference(afterCalls, beforeCalls);
  const lostFdrCalls = sortedDifference(beforeCalls, afterCalls);
  const sharedFdrCalls = [...afterCalls].filter((name) => beforeCalls.has(name)).length;
  const fdrUnion = new Set([...beforeCalls, ...afterCalls]).size;
  const nesDeltas: number[] = [];
  const directionChangedPathways: string[] = [];
  let changedSharedRows = 0;
  let pathwaySizesChanged = 0;
  let leadingEdgesChanged = 0;
  for (const name of sharedNames) {
    const left = before.get(name)!;
    const right = after.get(name)!;
    const sizeChanged = numeric(left.size) !== numeric(right.size);
    const edgeChanged = edgeSet(left) !== edgeSet(right);
    if (sizeChanged) pathwaySizesChanged++;
    if (edgeChanged) leadingEdgesChanged++;
    if (sizeChanged || edgeChanged || ['pval', 'padj', 'NES'].some((key) => numeric(left[key]) !== numeric(right[key]))) {
      changedSharedRows++;
    }
    const leftNes = numeric(left.NES);
    const rightNes = numeric(right.NES);
    if (leftNes != null && rightNes != null) {
      nesDeltas.push(Math.abs(rightNes - leftNes));
      if (leftNes !== 0 && rightNes !== 0 && Math.sign(leftNes) !== Math.sign(rightNes)) {
        directionChangedPathways.push(name);
      }
    }
  }
  nesDeltas.sort((a, b) => a - b);
  const middle = Math.floor(nesDeltas.length / 2);
  const median = !nesDeltas.length ? null : nesDeltas.length % 2
    ? nesDeltas[middle] : (nesDeltas[middle - 1] + nesDeltas[middle]) / 2;
  const nonFinitePathways = (rows: FgseaTextRow[]) => rows.filter((row) => (
    ['pval', 'padj', 'NES'].some((key) => numeric(row[key]) == null)
  )).map((row) => row.pathway).sort();
  const nonFinitePathwaysBefore = nonFinitePathways(previous);
  const nonFinitePathwaysAfter = nonFinitePathways(current);
  return {
    previousRows: previous.length,
    currentRows: current.length,
    addedRows: addedPathways.length,
    removedRows: removedPathways.length,
    sharedRows: sharedNames.length,
    changedSharedRows,
    pathwaySizesChanged,
    leadingEdgesChanged,
    nesDirectionChanges: directionChangedPathways.length,
    maxAbsNesDelta: nesDeltas.length ? nesDeltas[nesDeltas.length - 1] : null,
    medianAbsNesDelta: median,
    nonFiniteRowsBefore: nonFinitePathwaysBefore.length,
    nonFiniteRowsAfter: nonFinitePathwaysAfter.length,
    nonFinitePathwaysBefore,
    nonFinitePathwaysAfter,
    pvalueAtDefaultFloorPathwaysAfter: current.filter((row) => numeric(row.pval) === 1e-50).map((row) => row.pathway).sort(),
    fdrCallsBefore: beforeCalls.size,
    fdrCallsAfter: afterCalls.size,
    fdrCallsShared: sharedFdrCalls,
    fdrCallsGained: gainedFdrCalls.length,
    fdrCallsLost: lostFdrCalls.length,
    fdrCallJaccard: fdrUnion ? sharedFdrCalls / fdrUnion : 1,
    addedPathways,
    removedPathways,
    gainedFdrCalls,
    lostFdrCalls,
    directionChangedPathways: directionChangedPathways.sort(),
  };
}
