// Builds the SEARCH NAMES table, public/nomenclature/names.js, and the SYMBOL
// RENAMES table, public/nomenclature/renames.js.
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
// RENAMES
// -------
// The corpus stores whatever symbol each study's annotation produced, so one
// gene can be stored under its current symbol in some studies and under a
// retired one in others: MGI renamed Gm8773 to Fam237b, and 38 mouse studies
// still store Gm8773. A RENAME GROUP is a current symbol plus the retired
// symbols its authority links to it. Every member is a symbol the corpus
// stores, and a retired symbol joins only when:
//   * its row is 'previous' with exactly one current symbol (a split is not a
//     rename of one gene), or 'alias' with one current symbol when the stored
//     symbol is a locus placeholder (LOC…, RGD…, Gm…, a clone accession):
//     RGD records most namings of its placeholders as aliases, and a
//     placeholder names no other gene. A named alias does not join, because
//     the NCBI and RGD alias lists mix in paralogs (chicken CCNB2 is listed
//     under CCNB1, rat Eola2 under Eola1),
//   * that symbol is stored as 'current' under the SAME authority as one
//     record: once, or as rows that differ only in case and share one
//     authority ID (MGI stores Tango2 and TANGO2, both MGI:101825); the group
//     takes the spelling the retired row names,
//   * both rows carry the same authority ID (MGI:3646213 for both spellings),
//   * the retired symbol is not itself current there, and its first letter
//     has the current symbol's case (MGI and RGD list lowercase allele names
//     such as av for Pcdh15 as previous symbols; a study that stores av did
//     not measure a gene called Pcdh15 under another name).
// A name the authority approves for any gene is 'current', never 'alias', so
// an alias member never names another gene in its own authority.
//
// renames.js carries the groups for the reports, which then read a study's
// result under whichever member it stores, in that study's authority only.
// names.js uses them twice: a group's members are always each other's search
// aliases (placeholder spellings and the caps included), and a retired member
// gets a row of its own even when it looks like a placeholder, so typing
// Gm8773 says what it is.
//
// WHAT IS LEFT OUT
// ----------------
// Placeholder loci (LOC…, Gm…, ENS…) and placeholder names ('predicted gene',
// 'RIKEN cDNA', 'uncharacterized', 'expressed sequence') carry nothing a person
// would type. Those symbols still reach the search vocabulary through the gene
// index — they simply arrive without a name. A symbol with neither a usable name
// nor a kept alias gets no row for the same reason.
// An other name that the same authority calls another stored gene's CURRENT
// symbol is left out unless it is in the symbol's rename group: pig NCBI lists
// its own FAM237A among FAM237B's aliases, and searching FAM237A should not
// offer FAM237B.
// Ambiguous authority rows carry diagnostic candidate IDs, not a selected gene's
// name or aliases. Exclude them; valid rows from other authorities still merge,
// and the gene index retains the stored symbol itself.
//
// Usage:
//   tsx scripts/build_search_names.mts           write names.js and renames.js
//   tsx scripts/build_search_names.mts --check   rebuild in memory and diff against
//                                                the committed files (CI guard)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const TSV_IN = path.resolve('data/nomenclature/nomenclature.tsv');
const OUT = path.resolve('public/nomenclature/names.js');
const GLOBAL_KEY = 'HX_SEARCH_NAMES';
const RENAMES_OUT = path.resolve('public/nomenclature/renames.js');
const RENAMES_GLOBAL_KEY = 'HX_SYMBOL_RENAMES';

/** Wire version. MUST match SEARCH_NAMES_WIRE_VERSION in src/search/searchVocabulary.ts. */
const WIRE_VERSION = 1;
/** Wire version. MUST match SYMBOL_RENAMES_WIRE_VERSION in src/data/symbolRenames.ts. */
const RENAMES_WIRE_VERSION = 1;

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

/** One authority's rename: its current symbol and the retired ones that join it. */
interface RenameGroup {
  authority: string;
  current: string;
  retired: string[];
}

interface ParsedRow {
  symbol: string;
  authority: string;
  status: string;
  currentSymbol: string;
  authorityId: string;
}

const startsLower = (s: string): boolean => /^[a-z]/.test(s);

/** A locus placeholder: an NCBI LOC id, an RGD or MGI placeholder, an MGC or
 *  EG id, or a clone accession (AABR07005004.3, AC120712.4, BC067074). */
const PLACEHOLDER_LOCUS = /^(?:LOC\d+|RGD\d+|Gm\d+|EG\d+|MGC\d+|[A-Z]{1,4}\d{5,}(?:\.\d+)?)$/;

/**
 * The rename groups the table supports. See RENAMES in the header: every
 * condition there is checked here, and a retired symbol failing any of them
 * simply stays out of every group.
 */
function renameGroups(rows: readonly ParsedRow[]): RenameGroup[] {
  const currentByKey = new Map<string, ParsedRow[]>();
  for (const r of rows) {
    if (r.status !== 'current') continue;
    const key = `${r.authority}\x00${r.symbol.toUpperCase()}`;
    const at = currentByKey.get(key);
    if (at) at.push(r); else currentByKey.set(key, [r]);
  }
  const groups = new Map<string, RenameGroup>();
  for (const r of rows) {
    if (r.status !== 'previous' && !(r.status === 'alias' && PLACEHOLDER_LOCUS.test(r.symbol))) continue;
    const target = r.currentSymbol.trim();
    if (!target || target.includes('|') || !r.authorityId) continue;
    if (r.symbol.toUpperCase() === target.toUpperCase()) continue;
    if (currentByKey.has(`${r.authority}\x00${r.symbol.toUpperCase()}`)) continue;
    const key = `${r.authority}\x00${target.toUpperCase()}`;
    const current = currentByKey.get(key);
    // Current rows that differ only in case are one record when they share its ID.
    if (!current || new Set(current.map((c) => c.authorityId)).size !== 1 || current[0].authorityId !== r.authorityId) continue;
    const primary = current.find((c) => c.symbol === target) ?? current[0];
    if (startsLower(r.symbol) !== startsLower(primary.symbol)) continue;
    const group = groups.get(key) ?? { authority: r.authority, current: primary.symbol, retired: [] };
    if (!group.retired.some((s) => s.toUpperCase() === r.symbol.toUpperCase())) group.retired.push(r.symbol);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, retired: g.retired.slice().sort((a, b) => a.toUpperCase().localeCompare(b.toUpperCase())) }))
    .sort((a, b) => a.authority.localeCompare(b.authority)
      || a.current.toUpperCase().localeCompare(b.current.toUpperCase()));
}

interface BuildOutput {
  names: { content: string; rows: number };
  renames: { content: string; groups: number };
}

async function build(): Promise<BuildOutput> {
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
  const iId = col('authority_id');
  const iDatasets = col('n_datasets');

  const fields: string[][] = [];
  for (let li = 1; li < lines.length; li++) if (lines[li]) fields.push(lines[li].split('\t'));

  const parsed: ParsedRow[] = fields.map((f) => ({
    symbol: f[iSymbol].trim(),
    authority: f[iAuthority],
    status: f[iStatus],
    currentSymbol: f[iCurrent] ?? '',
    authorityId: (f[iId] ?? '').trim(),
  }));
  const groups = renameGroups(parsed);

  // UPPERCASE member -> the other members, spelled, across every authority's
  // groups (names.js is one row per uppercase symbol, like the query index).
  const partners = new Map<string, string[]>();
  for (const g of groups) {
    const members = [g.current, ...g.retired];
    for (const m of members) {
      const at = partners.get(m.toUpperCase()) ?? [];
      for (const other of members) {
        if (other !== m && !at.some((s) => s.toUpperCase() === other.toUpperCase())) at.push(other);
      }
      partners.set(m.toUpperCase(), at);
    }
  }
  // authority + UPPERCASE symbol, for every symbol that authority calls current
  // for a stored gene.
  const storedCurrent = new Set(parsed.filter((r) => r.status === 'current')
    .map((r) => `${r.authority}\x00${r.symbol.toUpperCase()}`));

  const bySymbol = new Map<string, TsvRow[]>();
  for (const f of fields) {
    if (f[iStatus] === 'ambiguous') continue;
    const key = f[iSymbol].trim().toUpperCase();
    if (!key || (PLACEHOLDER_SYMBOL.test(key) && !partners.has(key))) continue;
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
    // The symbol itself and anything already searchable as a name are not
    // aliases — MGI lists a marker's own symbol among its synonyms often.
    const seen = new Set<string>([nameKey(key), ...seenNames]);
    // Rename partners first, past every filter and cap below: they are the
    // same gene stored under another symbol, which is the one alias a reader
    // of this corpus needs most.
    const own = partners.get(key) ?? [];
    const ownKeys = new Set(own.map((s) => s.toUpperCase()));
    for (const p of own) {
      const k = nameKey(p);
      if (k && !seen.has(k)) { seen.add(k); aliases.push(p); }
    }
    if (datasets >= ALIAS_MIN_DATASETS) {
      let kept = 0;
      const push = (a: string, authority: string | null) => {
        const k = nameKey(a);
        if (kept >= ALIAS_CAP || a.length < 2 || !k || seen.has(k) || PLACEHOLDER_ALIAS.test(a)) return;
        // A name its own authority calls another stored gene's current symbol
        // names THAT gene. Only the same authority: a previous human symbol
        // that a pig study still stores (OBFC1 for STN1) is the same gene.
        if (authority && storedCurrent.has(`${authority}\x00${a.toUpperCase()}`) && !ownKeys.has(a.toUpperCase())) return;
        seen.add(k);
        aliases.push(a);
        kept++;
      };
      // Most useful first, so the cap drops the long tail: a retired symbol's
      // current spelling (type AARS1, find the stored AARS), then previous
      // symbols, then aliases — preferred authority first throughout.
      // A row's own current symbol is its gene, never another one, so it is
      // not asked whether it names another stored gene.
      for (const r of rows) for (const c of splitList(r.currentSymbol)) push(c, null);
      for (const r of rows) for (const p of r.prev) push(p, r.authority);
      for (const r of rows) for (const a of r.aliases) push(a, r.authority);
    }

    if (!name && !aliases.length) continue;
    out.push([key, name, otherNames.join('|'), aliases.join('|'), datasets]);
  }

  const payload = { v: WIRE_VERSION, rows: out };
  const content = `// AUTO-GENERATED by scripts/build_search_names.mts — do not edit\n`
    + `// one row per UPPERCASE stored symbol: [symbol, name, otherNames, aliases, nDatasets] (unified search)\n`
    + `var ${GLOBAL_KEY} = ${JSON.stringify(payload)};\n`;

  // Authorities are named once and referenced by position, so the payload
  // never depends on the app's own authority order.
  const authorities = [...new Set(groups.map((g) => g.authority))].sort();
  const renamesPayload = {
    v: RENAMES_WIRE_VERSION,
    authorities,
    groups: groups.map((g) => [authorities.indexOf(g.authority), g.current, ...g.retired]),
  };
  const renamesContent = `// AUTO-GENERATED by scripts/build_search_names.mts — do not edit\n`
    + `// symbol renames stored in the corpus: groups are [authorityIndex, currentSymbol, ...retiredSymbols]\n`
    + `var ${RENAMES_GLOBAL_KEY} = ${JSON.stringify(renamesPayload)};\n`;

  return { names: { content, rows: out.length }, renames: { content: renamesContent, groups: groups.length } };
}

async function main() {
  const built = await build();
  const outputs: Array<[string, string, string]> = [
    [OUT, built.names.content, `${built.names.rows} rows`],
    [RENAMES_OUT, built.renames.content, `${built.renames.groups} groups`],
  ];
  if (CHECK) {
    let drift = false;
    for (const [file, content] of outputs) {
      const existing = await readFile(file, 'utf8').catch(() => null);
      if (existing !== content) {
        drift = true;
        process.stdout.write(`  DRIFT ${path.relative(process.cwd(), file)}${existing === null ? ' (missing)' : ''}\n`);
      }
    }
    if (drift) {
      process.stdout.write('\nRun `npm run build:search-names` and commit the result.\n');
      process.exit(1);
    }
    process.stdout.write('  committed outputs are up to date\n');
    return;
  }
  for (const [file, content, summary] of outputs) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
    process.stdout.write(`  wrote ${path.relative(process.cwd(), file)} (${summary}, ${(content.length / 1e6).toFixed(2)} MB)\n`);
  }
}

main().catch((e) => {
  process.stderr.write(`${e?.stack || e}\n`);
  process.exit(1);
});
