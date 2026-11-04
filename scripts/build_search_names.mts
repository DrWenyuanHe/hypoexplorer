// Builds the SEARCH NAMES table: public/nomenclature/names.js.
//
// The unified search box answers "oxytocin" with OXT and "insulin" with INS,
// Ins1 and Ins2. The symbol lists the app already ships cannot do that — they
// hold symbols only — so this file adds the gene NAMES the authorities give
// each stored symbol, plus a selective slice of their aliases.
//
// Input is the committed nomenclature table (data/nomenclature/nomenclature.tsv,
// written by scripts/build_nomenclature.mts). Nothing is fetched: the table
// already joins every stored symbol to its species-appropriate authority, and
// re-deriving that join here would let the two files disagree.
//
// ONE ROW PER UPPERCASE SYMBOL
// ----------------------------
// The cross-dataset query index keys genes by UPPERCASE symbol, so macaque POMC,
// mouse Pomc and rat Pomc are one search result. Their rows merge here:
//
//   name        the preferred authority's name: HGNC > MGI > RGD > NCBI Gene,
//               and within one rank the row stored in more datasets.
//   otherNames  every other distinct name (case-insensitive). MGI calls Oxt plain
//               'oxytocin' while HGNC says 'oxytocin/neurophysin I prepropeptide';
//               both must be searchable, only one can be the title.
//   aliases     previous symbols, the authority's current symbol when the stored
//               one is retired, and aliases — but ONLY for symbols stored in at
//               least ALIAS_MIN_DATASETS datasets, and at most ALIAS_CAP of them.
//               Keeping every alias doubles the file for names nobody searches.
//   datasets    the most datasets any of the merged rows is stored in.
//
// WHAT IS LEFT OUT
// ----------------
// Placeholder loci (LOC…, Gm…, ENS…) and placeholder names ('predicted gene',
// 'RIKEN cDNA', 'uncharacterized', 'expressed sequence') carry nothing a person
// would type. Those symbols still reach the search vocabulary through the gene
// index — they simply arrive without a name. A symbol with neither a usable name
// nor a kept alias gets no row for the same reason.
// Ambiguous authority rows carry diagnostic candidate IDs, not a selected gene's
// name or aliases. Exclude them; valid rows from other authorities still merge,
// and the gene index retains the stored symbol itself.
//
// Usage:
//   tsx scripts/build_search_names.mts           write public/nomenclature/names.js
//   tsx scripts/build_search_names.mts --check   rebuild in memory and diff against
//                                                the committed file (CI guard)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const TSV_IN = path.resolve('data/nomenclature/nomenclature.tsv');
const OUT = path.resolve('public/nomenclature/names.js');
const GLOBAL_KEY = 'HX_SEARCH_NAMES';

/** Wire version. MUST match SEARCH_NAMES_WIRE_VERSION in src/search/searchVocabulary.ts. */
const WIRE_VERSION = 1;

/** Aliases are kept only for symbols stored in at least this many datasets. */
const ALIAS_MIN_DATASETS = 3;
/** And at most this many per symbol. */
const ALIAS_CAP = 5;

const CHECK = process.argv.slice(2).includes('--check');

const PLACEHOLDER_SYMBOL = /^(?:LOC\d|GM\d+$|ENS[A-Z]*\d)/;
const PLACEHOLDER_NAME = /^(?:predicted gene|riken cdna|uncharacterized|expressed sequence)/i;
// Aliases nobody types: EST and clone accessions (AA986540, BC012345), locus
// placeholders, zebrafish clone ids, bare (fj33a01) or colon-scoped
// (si:dkey-193l8.2, wu:fj33a01), and RIKEN clone names. They were a third of the
// alias bytes and none of the value.
const PLACEHOLDER_ALIAS = /^(?:[A-Z]{1,3}_?\d{5,}(?:\.\d+)?|[A-Z]{2}\d{2}[A-Z]\d{2}|(?:LOC|GM)\d.*|\d+[A-Z]\d+RIK|.*:.*)$/i;

/** Names that differ only in case or punctuation are one name to a searcher. */
const nameKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Lower is preferred. Every NCBI Gene namespace shares the last rank. */
function authorityRank(authority: string): number {
  if (authority === 'HGNC') return 0;
  if (authority === 'MGI') return 1;
  if (authority === 'RGD') return 2;
  return 3;
}

interface TsvRow {
  authority: string;
  currentSymbol: string;
  name: string;
  aliases: string[];
  prev: string[];
  datasets: number;
}

// The wire joins lists with '|'. No authority name has ever contained one, which
// is exactly why it would go unnoticed if one did — so it is neutralized.
const clean = (s: string): string => s.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const splitList = (v: string | undefined): string[] => (v ? v.split('|').map(clean).filter(Boolean) : []);

async function build(): Promise<{ content: string; rows: number }> {
  const text = await readFile(TSV_IN, 'utf8');
  const lines = text.split(/\r?\n/);
  const header = lines[0].split('\t');
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`${path.relative(process.cwd(), TSV_IN)}: missing column '${name}'`);
    return i;
  };
  const iSymbol = col('symbol');
  const iAuthority = col('authority');
  const iStatus = col('status');
  const iCurrent = col('current_symbol');
  const iName = col('gene_name');
  const iAliases = col('aliases');
  const iPrev = col('previous_symbols');
  const iDatasets = col('n_datasets');

  const bySymbol = new Map<string, TsvRow[]>();
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li];
    if (!line) continue;
    const f = line.split('\t');
    if (f[iStatus] === 'ambiguous') continue;
    const key = f[iSymbol].trim().toUpperCase();
    if (!key || PLACEHOLDER_SYMBOL.test(key)) continue;
    const rawName = clean(f[iName] ?? '');
    const row: TsvRow = {
      authority: f[iAuthority],
      currentSymbol: f[iCurrent] ?? '',
      name: PLACEHOLDER_NAME.test(rawName) ? '' : rawName,
      aliases: splitList(f[iAliases]),
      prev: splitList(f[iPrev]),
      datasets: Number(f[iDatasets]) || 0,
    };
    const at = bySymbol.get(key);
    if (at) at.push(row); else bySymbol.set(key, [row]);
  }

  const out: Array<[string, string, string, string, number]> = [];
  for (const key of [...bySymbol.keys()].sort()) {
    const rows = bySymbol.get(key)!.slice().sort((a, b) =>
      // A named row always beats an unnamed one, then authority, then reach.
      Number(!a.name) - Number(!b.name)
      || authorityRank(a.authority) - authorityRank(b.authority)
      || b.datasets - a.datasets
      || a.authority.localeCompare(b.authority));
    const datasets = Math.max(...rows.map((r) => r.datasets));

    const name = rows[0].name;
    const seenNames = new Set<string>(name ? [nameKey(name)] : []);
    const otherNames: string[] = [];
    for (const r of rows) {
      const n = r.name;
      if (n && !seenNames.has(nameKey(n))) { seenNames.add(nameKey(n)); otherNames.push(n); }
    }

    const aliases: string[] = [];
    if (datasets >= ALIAS_MIN_DATASETS) {
      // The symbol itself and anything already searchable as a name are not
      // aliases — MGI lists a marker's own symbol among its synonyms often.
      const seen = new Set<string>([nameKey(key), ...seenNames]);
      const push = (a: string) => {
        const k = nameKey(a);
        if (aliases.length >= ALIAS_CAP || a.length < 2 || !k || seen.has(k) || PLACEHOLDER_ALIAS.test(a)) return;
        seen.add(k);
        aliases.push(a);
      };
      // Most useful first, so the cap drops the long tail: a retired symbol's
      // current spelling (type AARS1, find the stored AARS), then previous
      // symbols, then aliases — preferred authority first throughout.
      for (const r of rows) for (const c of splitList(r.currentSymbol)) push(c);
      for (const r of rows) for (const p of r.prev) push(p);
      for (const r of rows) for (const a of r.aliases) push(a);
    }

    if (!name && !aliases.length) continue;
    out.push([key, name, otherNames.join('|'), aliases.join('|'), datasets]);
  }

  const payload = { v: WIRE_VERSION, rows: out };
  const content = `// AUTO-GENERATED by scripts/build_search_names.mts — do not edit\n`
    + `// one row per UPPERCASE stored symbol: [symbol, name, otherNames, aliases, nDatasets] (unified search)\n`
    + `var ${GLOBAL_KEY} = ${JSON.stringify(payload)};\n`;
  return { content, rows: out.length };
}

async function main() {
  const { content, rows } = await build();
  if (CHECK) {
    const existing = await readFile(OUT, 'utf8').catch(() => null);
    if (existing !== content) {
      process.stdout.write(`  DRIFT ${path.relative(process.cwd(), OUT)}${existing === null ? ' (missing)' : ''}\n`);
      process.stdout.write('\nRun `npm run build:search-names` and commit the result.\n');
      process.exit(1);
    }
    process.stdout.write('  committed output is up to date\n');
    return;
  }
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, content);
  process.stdout.write(`  wrote ${path.relative(process.cwd(), OUT)} (${rows} rows, ${(content.length / 1e6).toFixed(2)} MB)\n`);
}

main().catch((e) => {
  process.stderr.write(`${e?.stack || e}\n`);
  process.exit(1);
});
