// Filter null/undefined before aggregating so 2v3 pops (where one sample slot
// is null-padded in the canonical 6-slot CPM layout) compute correct means.
function nonNull(arr: Array<number | null | undefined>): number[] {
  const out: number[] = [];
  for (const v of arr) if (v != null) out.push(v);
  return out;
}

export function mean(arr: Array<number | null | undefined>): number {
  const vals = nonNull(arr);
  if (!vals.length) return 0;
  let s = 0;
  for (const v of vals) s += v;
  return s / vals.length;
}

export function std(arr: Array<number | null | undefined>): number {
  const vals = nonNull(arr);
  if (vals.length <= 1) return 0;
  const m = mean(vals);
  let s = 0;
  for (const v of vals) s += (v - m) ** 2;
  return Math.sqrt(s / (vals.length - 1));
}
