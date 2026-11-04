// Mouse gene-symbol normalizer used by the bundle builders so that NO raw
// Ensembl / Entrez / RefSeq identifier ever reaches a track's gene names. The
// upstream R pipeline keeps the raw id when org.Mm.eg.db can't map it, so a long
// tail of ENSMUSG (and a few RefSeq / Excel-corrupted symbols) would otherwise
// leak into the browsable gene list. Strategy, in order:
//
//   1. "ENSMUSG…|Sym" combined ids        -> take the symbol part
//   2. Excel-corrupted March/Sept symbols -> Marchf{N} / Septin{N}
//   3. ENSMUSG (version-stripped)         -> MGI symbol (mmus_ens2sym.json), else DROP
//   4. other Ensembl (transcript/protein) -> DROP
//   5. RefSeq / pure-numeric Entrez        -> DROP (small unmapped tails)
//   6. htseq-count "__" summary rows       -> DROP (counting stats, not features)
//   7. bare "-<n>" unnamed-feature indices -> DROP (no recoverable identity)
//   8. anything else, incl. LOC###### NCBI placeholder symbols -> kept as-is
//
// `mmus_ens2sym.json` is the Ensembl-gene-id -> MGI-symbol table generated from
// MGI's MRK_ENSEMBL.rpt (column 6 -> column 2). Regenerate it with:
//   curl -sSL https://www.informatics.jax.org/downloads/reports/MRK_ENSEMBL.rpt > scripts/lib/MRK_ENSEMBL.rpt
//   node -e "const fs=require('fs');const m={};for(const l of fs.readFileSync('scripts/lib/MRK_ENSEMBL.rpt','utf8').split(/\\r?\\n/)){const c=l.split('\\t');if(c.length>5&&/^ENSMUSG/.test(c[5]||'')&&c[1])m[c[5]]=c[1];}fs.writeFileSync('scripts/lib/mmus_ens2sym.json',JSON.stringify(m));"
// (the .rpt itself is gitignored; the derived JSON is committed.)
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENS2SYM: Record<string, string> = JSON.parse(
  readFileSync(resolve(HERE, 'mmus_ens2sym.json'), 'utf8'),
);

const MONTH_NUM = /^(\d+)-(Mar|Sep)$/i;
const MONTH_NUM_REV = /^(Mar|Sep)-(\d+)$/i;
const isEns = (s: string) => /^ENS(MUSG|MUST|MUSP|RNOG|RNOT|RNOP|G|MMUG|MMUT|MFAG)\d/i.test(s);

/** Standardize a raw gene identifier to a mouse SYMBOL, or null to DROP it. */
export function normalizeGene(raw: string): string | null {
  if (!raw) return null;
  let g = String(raw).trim();
  // 1. combined "id|symbol" — keep the part that isn't an Ensembl id / number
  if (g.includes('|')) {
    const parts = g.split('|').map((s) => s.trim()).filter(Boolean);
    g = parts.find((p) => !isEns(p) && !/^\d+$/.test(p)) ?? parts[0] ?? g;
  }
  // 2. Excel-corrupted March/Septin family (e.g. "1-Mar" -> Marchf1, "2-Sep" -> Septin2)
  const md = g.match(MONTH_NUM) || g.match(MONTH_NUM_REV);
  if (md) {
    // Excel may zero-pad the day ("Sep-01"); gene numbers are never padded.
    const num = String(Number(/^\d/.test(g) ? md[1] : md[2]));
    const mon = /^\d/.test(g) ? md[2] : md[1];
    return mon.toLowerCase() === 'mar' ? `Marchf${num}` : `Septin${num}`;
  }
  // 3. Ensembl gene id -> MGI symbol (strip version), else drop
  if (/^ENSMUSG\d/i.test(g)) return ENS2SYM[g.replace(/\..*$/, '')] ?? null;
  // 4. other Ensembl ids (transcript / protein / cross-species) -> drop
  if (isEns(g)) return null;
  // 5. RefSeq accessions / pure-numeric Entrez -> drop (small unmapped tails)
  if (/^(N[MR]_|X[MR]_)\d/i.test(g)) return null;
  if (/^\d+$/.test(g)) return null;
  // 6. htseq-count trailing summary rows -> drop. htseq-count appends its
  //    counting stats (__no_feature, __ambiguous, __too_low_aQual,
  //    __not_aligned, __alignment_not_unique) as rows of the count matrix. They
  //    carry per-sample totals, so DE runs on them and emits a logFC/p-value —
  //    GSE68177 shipped __no_feature and __ambiguous as browsable "genes" on the
  //    volcano. No symbol in any authority starts with "__", so drop the family.
  if (/^__/.test(g)) return null;
  // 7. bare "-<n>" unnamed-feature placeholders -> drop. GSE314029's count
  //    matrix names its 599 symbol-less features "-1".."-599", numbered
  //    sequentially down the file in genomic order (NOT truncated miRNA names —
  //    the run is complete, gap-free and duplicate-free, and the set has no
  //    relation to Mir* numbering). The index carries no gene identity and
  //    nothing upstream can recover one, so there is nothing to rename it to.
  if (/^-\d+$/.test(g)) return null;
  // 8. already a usable symbol (incl. LOC###### NCBI placeholders) -> keep
  return g;
}
