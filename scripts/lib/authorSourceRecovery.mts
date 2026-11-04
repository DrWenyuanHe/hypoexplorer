type Cell = string | number | boolean | null | undefined;
type Row = Record<string, Cell>;

/** Recover damaged spreadsheet symbols through two unchanged source identifiers. */
export function recoverSourceSymbols(workbookRows: Row[], sourceRows: Row[]): Row[] {
  const byStablePair = new Map<string, Row[]>();
  for (const row of sourceRows) {
    if (!row.ensembl_id || !row.locus) continue;
    const key = `${row.ensembl_id}|${row.locus}`;
    byStablePair.set(key, [...(byStablePair.get(key) ?? []), row]);
  }
  return workbookRows.map((row) => {
    if (typeof row.__EMPTY === 'string') return row;
    if (typeof row.__EMPTY !== 'number') throw new Error('Workbook gene label is missing or unsupported');
    const candidates = byStablePair.get(`${row.ensembl_id}|${row.locus}`) ?? [];
    if (candidates.length !== 1 || typeof candidates[0].symbol !== 'string' || !candidates[0].symbol) {
      throw new Error(`Ambiguous source recovery for ${row.ensembl_id}/${row.locus}`);
    }
    return { ...row, __EMPTY: candidates[0].symbol };
  });
}

export function requireUniqueKeys(rows: { key: string }[], context: string): void {
  const keys = new Set<string>();
  for (const row of rows) {
    if (!row.key || keys.has(row.key)) throw new Error(`${context}: missing or duplicate key ${row.key}`);
    keys.add(row.key);
  }
}
