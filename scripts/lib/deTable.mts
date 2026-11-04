// The DE-table contract, in one place: which columns a `<id>_DE.tsv` must
// carry, and how a cell of each becomes a number.
//
// WHY THIS EXISTS
// ---------------
// Three builders read the identical DE schema written by the same R scripts,
// and only ONE of them checked that the columns were there. Commit 6154ffa
// added that check to build_normalized_bundles.mts after a header rename
// shipped an empty table; the other two never got it. Their failure mode is
// worse than the empty table the commit was written to prevent:
//
//   `indexOf` yields -1 for a missing column, `row[-1]` is undefined,
//   `+undefined` is NaN, and `JSON.stringify(NaN)` is `null` — so a renamed
//   column ships a full-size gene list with `"logFC":null` on every row. Nothing
//   throws, nothing is empty, and the volcano renders blank with no explanation.
//
// The same two builders also coerced numeric cells with a bare `+`. `+'NA'` is
// NaN, which is harmless, but `+''` is 0 — and an empty padj cell is therefore a
// gene with FDR exactly 0, i.e. a fabricated maximally-significant hit. R's
// `fwrite` writes NA as an empty string, so that is one upstream option away.
// (Checked against the committed corpus: no shipped bundle currently carries an
// exact-zero FDR, so this guard is closing a latent hole, not a live one.)
//
// WHAT IT DOES NOT DO
// -------------------
// It is not a generic row builder. The builders genuinely differ in symbol
// normalization, Ensembl/RefSeq joins, SE sidecars and filtering, so gene and SE
// resolution stay with the caller. What is centralized is the part that must be
// identical: the header contract, the missing-column assertion and the NA rule.

/** The columns every DE table must carry, whatever else it also carries. */
export const REQUIRED_DE_COLUMNS = ['symbol', 'logFC', 'stat', 'pvalue', 'padj', 'method'] as const;

export type DeColumnIndex = Record<string, number>;

/**
 * Index a DE header by column name, asserting every column this pipeline reads
 * is present.
 *
 * `extra` names columns a particular builder additionally depends on (`id` for
 * the ones that join on Ensembl). Pass them rather than reading them
 * unchecked — a drifted `id` column silently produces `undefined` keys and an
 * SE sidecar that joins to nothing.
 */
export function indexDeHeader(
  header: string[],
  label: string,
  extra: readonly string[] = [],
): DeColumnIndex {
  const di: DeColumnIndex = Object.fromEntries(header.map((h, i) => [h, i]));
  for (const col of [...REQUIRED_DE_COLUMNS, ...extra]) {
    if (!(col in di) || di[col] < 0) {
      throw new Error(
        `${label}: no "${col}" column (header: ${header.join(', ')}) — `
        + 'the DE writer and this reader have drifted apart.',
      );
    }
  }
  return di;
}

/**
 * Parse a numeric cell, treating R's NA / NaN / empty string as NaN — never 0.
 *
 * `fwrite` writes NA as an empty string and `Number('')` is 0, which would turn
 * a missing q-value into a perfect hit.
 */
export function numCell(v: string | undefined): number {
  const t = (v ?? '').trim();
  return t === '' || t === 'NA' || t === 'NaN' ? Number.NaN : Number(t);
}

/**
 * Signed -log10(FDR), capped — the macaque `rank_score` semantics.
 *
 * `Number(fdr) || 1` treated an FDR of exactly 0 as 1, because 0 is falsy, so a
 * gene whose q-value underflowed sorted LAST among significant genes instead of
 * first. Two builders carried that bug and a third carried the fix plus a
 * comment about it; this is the fix, once.
 */
export function rankScore(logFC: number, fdr: number): number {
  const s = Math.sign(logFC) || 1;
  const f = Number(fdr);
  const v = s * -Math.log10(Math.max(Number.isFinite(f) ? f : 1, 1e-300));
  return Math.max(-1000, Math.min(1000, +v.toFixed(4)));
}

/** The three statistics every builder reads off a DE row, NA-safe. */
export function deStats(row: string[], di: DeColumnIndex): {
  logFC: number; PValue: number; FDR: number; stat: number; method: string;
} {
  return {
    logFC: numCell(row[di.logFC]),
    PValue: numCell(row[di.pvalue]),
    FDR: numCell(row[di.padj]),
    stat: numCell(row[di.stat]),
    method: row[di.method],
  };
}
