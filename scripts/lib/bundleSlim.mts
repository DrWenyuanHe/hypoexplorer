// Shared wire-size policy for the data bundles under public/datasets/**.
//
// ONE definition of what a shipped DE / pathway record carries and how its
// floats are serialized, used by BOTH the in-place optimizer
// (scripts/optimize_bundles.mts) and the bundle generators at write time — so
// regenerating a dataset can never silently restore the bloat the optimizer
// removed.
//
// Policy (why each rule is safe):
//
//   Probabilities (PValue, FDR, pval, padj): 6 significant digits WITH a
//   threshold guard. Full float64 tails are the least-compressible bytes in a
//   bundle, but the app decides significance with `fdr < 0.05` (and stars at
//   1e-4/1e-3/0.01/0.05), and rounding can move a value ACROSS a cliff —
//   rounding FDR to 3 sig digits flipped 19 real rows in this corpus (e.g.
//   macaque i40 ARRB1 at FDR 0.0499876… → 0.05 → fails `< 0.05`). So any value
//   whose rounding would change a threshold classification keeps full
//   precision. Same construction as build_query_index.mts's prob(); arbitrary
//   user-typed volcano cutoffs beyond these thresholds can differ at the 7th
//   significant digit, which is far below the estimates' own noise floor.
//
//   Effects with float64 tails (se, rank_score): 5 significant digits. se is
//   what the cross-dataset forest's 95% CI whisker is drawn from; its own
//   sampling error is orders of magnitude above the 5th significant digit. logFC /
//   NES / ES already arrive rounded to 4 decimals by the generators and are
//   NOT touched here.
//
//   de[].rankPos: dropped — it always equals the record's 1-based position in
//   the rank-sorted table (verified before dropping; a non-sequential table
//   keeps the field and is reported). The app derives rank from array order
//   (src/pathway-explorer/RunningScorePlot.tsx).
//
//   de[].logCPM === null: dropped — the bulk generators emit a literal
//   `"logCPM":null` on every row (~500 KB of dead text in the largest bundle).
//   Real logCPM numbers are kept.
//
//   de[].ens: dropped — an internal expression-matrix join key that leaked
//   into the shipped records; untyped in GeneDERecord and read by nothing in
//   src/ or the query-index builder. The Ensembl ids remain available in the
//   committed analysis CSVs.

export const SIG_PROB = 6;
export const SIG_EFFECT = 5;

// The significance cliffs the app (and its exports) classify against: star
// ratings at 1e-4 / 1e-3 / 0.01 and the `fdr < 0.05` significance rule.
const PROB_THRESHOLDS = [0.0001, 0.001, 0.01, 0.05] as const;

function roundSig(x: number, sig: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  return Number(x.toPrecision(sig));
}

/** Threshold-guarded probability rounding: 6 sig digits unless that would
 *  change any `< threshold` classification, in which case the exact value is
 *  kept. Non-numbers (null FDR from R's NA) pass through untouched. */
export function roundProb(x: unknown): unknown {
  if (typeof x !== 'number') return x;
  const r = roundSig(x, SIG_PROB);
  for (const t of PROB_THRESHOLDS) {
    if (x < t !== r < t) return x;
  }
  return r;
}

/** Effect-size rounding for fields serialized with full float64 tails. */
export function roundEffect(x: unknown): unknown {
  if (typeof x !== 'number') return x;
  return roundSig(x, SIG_EFFECT);
}

export interface SlimStats {
  rankPosDropped: number;
  logCpmNullDropped: number;
  ensDropped: number;
  /** false when a table violated rankPos === index+1 and kept the field. */
  rankPosSequential: boolean;
}

type Rec = Record<string, unknown>;

/** Slim a DE table in place. Returns what it did, so callers can log/refuse. */
export function slimDeTable(de: Rec[]): SlimStats {
  const stats: SlimStats = {
    rankPosDropped: 0,
    logCpmNullDropped: 0,
    ensDropped: 0,
    rankPosSequential: true,
  };
  for (let i = 0; i < de.length; i++) {
    const rp = de[i].rankPos;
    if (rp !== undefined && rp !== i + 1) {
      stats.rankPosSequential = false;
      break;
    }
  }
  for (const d of de) {
    if (stats.rankPosSequential && 'rankPos' in d) {
      delete d.rankPos;
      stats.rankPosDropped++;
    }
    if (d.logCPM === null) {
      delete d.logCPM;
      stats.logCpmNullDropped++;
    }
    if ('ens' in d) {
      delete d.ens;
      stats.ensDropped++;
    }
    if ('PValue' in d) d.PValue = roundProb(d.PValue);
    if ('FDR' in d) d.FDR = roundProb(d.FDR);
    if ('se' in d) d.se = roundEffect(d.se);
    if ('rank_score' in d) d.rank_score = roundEffect(d.rank_score);
  }
  return stats;
}

/** Slim a pathways block ({GO_BP: [...], HALLMARK: [...], …}) in place. */
export function slimPathwayBlock(block: Rec): void {
  for (const db of Object.keys(block)) {
    const list = block[db];
    if (!Array.isArray(list)) continue;
    for (const p of list as Rec[]) {
      if ('pval' in p) p.pval = roundProb(p.pval);
      if ('padj' in p) p.padj = roundProb(p.padj);
    }
  }
}

/** Slim a whole track object (de, deByContrast tables, embedded pathways). */
export function slimTrackObject(track: Rec): SlimStats {
  const total: SlimStats = {
    rankPosDropped: 0,
    logCpmNullDropped: 0,
    ensDropped: 0,
    rankPosSequential: true,
  };
  const merge = (s: SlimStats) => {
    total.rankPosDropped += s.rankPosDropped;
    total.logCpmNullDropped += s.logCpmNullDropped;
    total.ensDropped += s.ensDropped;
    total.rankPosSequential = total.rankPosSequential && s.rankPosSequential;
  };
  if (Array.isArray(track.de)) merge(slimDeTable(track.de as Rec[]));
  if (track.deByContrast && typeof track.deByContrast === 'object') {
    for (const t of Object.values(track.deByContrast as Record<string, unknown>)) {
      if (Array.isArray(t)) merge(slimDeTable(t as Rec[]));
    }
  }
  if (track.pathways && typeof track.pathways === 'object') {
    slimPathwayBlock(track.pathways as Rec);
  }
  return total;
}
