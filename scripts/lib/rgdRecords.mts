export interface RgdRecordIdentity {
  id: string;
  symbol: string;
  nomenclatureStatus: string;
}

/**
 * Nomenclature approval is distinct from RefSeq status and assembly membership.
 * An explicit, unique APPROVED name wins over PROVISIONAL duplicates. Nothing
 * else chooses between multiple active IDs; source order is not gene identity.
 */
export function selectRgdRecords<T extends RgdRecordIdentity>(
  records: Iterable<T>,
): Map<
  string,
  {
    selected: T | null;
    candidates: T[];
  }
> {
  const grouped = new Map<string, Map<string, T>>();
  for (const record of records) {
    const key = record.symbol.toUpperCase();
    const group = grouped.get(key) ?? new Map<string, T>();
    if (group.has(record.id)) throw new Error(`Duplicate active RGD ID ${record.id}`);
    group.set(record.id, record);
    grouped.set(key, group);
  }
  return new Map(
    [...grouped].map(([key, byId]) => {
      const candidates = [...byId.values()].sort((a, b) =>
        a.id.localeCompare(b.id, 'en', { numeric: true }),
      );
      const approved = candidates.filter((record) => record.nomenclatureStatus === 'APPROVED');
      const selected =
        candidates.length === 1
          ? candidates[0]
          : approved.length === 1 &&
              candidates.every((record) =>
                ['APPROVED', 'PROVISIONAL'].includes(record.nomenclatureStatus),
              )
            ? approved[0]
            : null;
      return [key, { selected, candidates }];
    }),
  );
}
