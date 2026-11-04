export type Stars = '****' | '***' | '**' | '*' | 'ns';

export function pToStar(p: number): Stars {
  if (p < 0.0001) return '****';
  if (p < 0.001) return '***';
  if (p < 0.01) return '**';
  if (p < 0.05) return '*';
  return 'ns';
}

// ONE display rule for both p and q, by decision: 2 significant figures in
// exponential below 0.001, 3 decimals at and above it. `fmtFDR` used to floor at
// '< 0.001', which erased the ranking of 5,309 q-values spanning 18.8 orders of
// magnitude in the current corpus; `fmtP` used to render one more digit than its
// estimator supports (fgsea's own log2err puts a factor of ~1.6–2 uncertainty on
// a small padj, so the second mantissa digit carries no information) and one more
// decimal than the q column it sits beside. A non-positive value is the float64
// underflow of a normal tail, not a real zero — it renders as the '< 1e-300'
// sentinel rather than the "0.0e+0" that used to escape from an underflowing tail.
// KNOWN, ACCEPTED artifact: values in [9.95e-4, 1e-3) render '1.0e-3' next to a
// neighbouring '0.001'. Rare cosmetic noise; not worth complicating the rule.
export function fmtP(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return '–';
  if (p <= 0) return '< 1e-300';
  if (p < 0.001) return p.toExponential(1);
  return p.toFixed(3);
}

// p and q share the display rule by decision — same precision, same thresholds —
// so this delegates to `fmtP` and exists only as the name a call site reads as
// "this column is a q". (Delegation, not `export const fmtFDR = fmtP`, because
// knip counts a re-exported binding as a duplicate export.)
export function fmtFDR(q: number | null | undefined): string {
  return fmtP(q);
}

// The "+1.234 / -1.234" signed-number idiom for effect sizes (logFC, NES),
// spelled inline at ~11 sites before this.
// `digits` is REQUIRED and never defaulted: the cross-dataset reports render 2dp
// and the explorer tables 3dp, a deliberate difference a default would silently
// unify. Zero stays unsigned ("0.000"), matching the `x > 0 ? '+' : ''` this
// replaces — including -0, which JS's toFixed already renders unsigned.
export function fmtSigned(value: number, digits: number): string {
  return (value > 0 ? '+' : '') + value.toFixed(digits);
}

export function fmtCutoff(p: number): string {
  if (p >= 0.01) return p.toFixed(3);
  if (p >= 0.001) return p.toFixed(4);
  return p.toExponential(1);
}

// Download sizes, for the loading bars. Binary units (MiB semantics, MB label)
// to match what the bundle files actually measure, and ONE decimal above a
// megabyte — a byte-exact readout on a figure that changes several times a
// second reads as noise, and the tenth is the only digit a user tracks.
// Sub-kilobyte values are never shown: nothing the loaders fetch is that small,
// and "512 B" beside "2.4 MB" would suggest a precision the rest lacks.
export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const kb = bytes / 1024;
  if (kb < 1000) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function truncate(str: string, n: number): string {
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

// Extract the marker subname from a track label like "e9 (POMC/TBX3)" → "POMC/TBX3".
// Pure: pass the active dataset's `labels` map (from the DatasetMeta the caller
// was given). A missing map or unknown id degrades to the bare id — there is no
// ambient-global fallback.
export function getCellSubname(
  id: string,
  labels: Readonly<Record<string, string>> | null | undefined,
): string {
  const label = labels?.[id] || id;
  const match = label.match(/\(([^)]+)\)/);
  return match ? match[1] : label;
}
