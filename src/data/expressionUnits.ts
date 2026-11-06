// Expression-unit vocabulary shared by the registry, the bundle builders and the
// display helpers. Dependency-free so src/data/datasets.ts and scripts/*.mts can
// both import it.

/**
 * The unit of every COUNT dataset's per-sample values since the R 4.6.0
 * regeneration (2026-09-25): counts ÷ (library size × TMM normalization factor)
 * × 1e6, where the library sizes and TMM factors are the study's own edgeR fit
 * (bulk: `<stem>_CPM_TMM.tsv.gz`; macaque: the per-population `normcpm.csv`).
 * Matrix-input datasets keep the unit their authors deposited.
 */
export const CPM_TMM_UNIT = 'CPM (TMM-normalized)';

/** The pre-regeneration label: counts ÷ raw column total × 1e6, no TMM factor. */
export const LEGACY_CPM_UNIT = 'CPM';

// 'log2(<base> + <offset>)' — a log with a stated pseudocount, so exactly
// invertible. `.+?` is lazy so 'log2(x + y + 1)' splits at the LAST plus (the
// offset group only matches a number, so an early split backtracks).
const LOG2_WITH_OFFSET = /^log2\s*\(\s*(.+?)\s*\+\s*(\d*\.?\d+(?:[eE][+-]?\d+)?)\s*\)$/i;

/** The base and pseudocount of a 'log2(<base> + <offset>)' unit, or null. */
export function parseLog2WithOffset(unit: string | null | undefined): { base: string; offset: number } | null {
  const match = LOG2_WITH_OFFSET.exec((unit ?? '').trim());
  if (!match) return null;
  const offset = Number(match[2]);
  return Number.isFinite(offset) ? { base: match[1], offset } : null;
}
