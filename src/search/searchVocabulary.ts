// The SEARCH VOCABULARY: everything the unified search box can find, and the
// one function that ranks it.
//
// One box answers for genes AND pathways. Typing "insulin" has to surface INS
// and the rodent Ins1/Ins2 as well as GOBP_INSULIN_SECRETION and
// KEGG_INSULIN_SIGNALING_PATHWAY; typing "oxytocin" has to land on OXT. Neither
// list the app already had could do that alone — the gene index holds symbols,
// not names — so the vocabulary is the union of three sources:
//
//   names.js        gene names and selected aliases per UPPERCASE symbol
//                   (scripts/build_search_names.mts; same-origin, ships with
//                   the app like the rest of public/nomenclature/)
//   gene index      every symbol the cross-dataset query index stores
//                   (loadGeneIndex — includes the LOC…/Gm…/…Rik tail that
//                   names.js leaves out, so a typed symbol is never lost)
//   pathway index   every stored MSigDB gs_name (loadPathwayIndex)
//
// plus the curated common-name dictionary in ./searchSynonyms.ts.
//
// GRACEFUL DEGRADATION
// --------------------
// loadSearchVocabulary never rejects. Each source that fails simply contributes
// nothing: without names.js the box still matches symbols, without the gene
// index it still matches every named gene, and without the pathway index it is a
// gene search. Same never-reject contract as ../data/nomenclature.ts, and for the
// same reason — the hub can start the load on first focus and use whatever
// arrives.
//
// searchAll IS PURE AND PER-KEYSTROKE
// -----------------------------------
// It scans ~112k genes and ~5.8k pathways on every keystroke, so everything that
// does not depend on the query — normalized names, the exact-match maps, pathway
// titles — is computed once per vocabulary VALUE and kept in a WeakMap. The scan
// itself is a handful of startsWith/includes calls per gene.

import { loadOptionalBundle } from '../data/bundleSource';
import { loadGeneIndex, loadPathwayIndex } from '../data/crossDataset';
import { lookupSynonyms, synonymKey } from './searchSynonyms';
import type {
  BestMatch,
  GeneEntry,
  GeneHit,
  GeneMatchKind,
  PathwayDb,
  PathwayHit,
  SearchResults,
  SearchVocabulary,
} from './searchTypes';

// ── Wire format. MUST match scripts/build_search_names.mts. ─────────────────

/**
 * The wire version this client can decode. Any other `v` is treated as absent,
 * for the reason nomenclature.ts gives: /nomenclature/* is an unversioned path,
 * and an old app shell under the service worker WILL eventually be handed a
 * newer file. Symbol-only search is the right failure, not misread names.
 */
const SEARCH_NAMES_WIRE_VERSION = 1;

/** [SYMBOL, preferredName, otherNames (pipe-joined), aliases (pipe-joined), nDatasets] */
type NamesWireRow = [string, string, string, string, number];
interface NamesPayload { v: number; rows: NamesWireRow[] }

// Deliberately NOT prefixed with a dataset's bundleBaseUrl: like aliases.js this
// file ships with the app, so it is never a version behind the UI reading it.
const NAMES_URL = '/nomenclature/names.js';
const NAMES_GLOBAL = 'HX_SEARCH_NAMES';

const splitList = (v: string): string[] => (v ? v.split('|') : []);

// ── Loading ─────────────────────────────────────────────────────────────────

function decodeNames(payload: NamesPayload | null): GeneEntry[] {
  if (payload?.v !== SEARCH_NAMES_WIRE_VERSION || !Array.isArray(payload.rows)) return [];
  const out: GeneEntry[] = [];
  for (const row of payload.rows) {
    if (!Array.isArray(row) || typeof row[0] !== 'string' || !row[0]) continue;
    const [symbol, name, otherNames, aliases, datasets] = row;
    out.push({
      symbol: symbol.toUpperCase(),
      name: typeof name === 'string' ? name : '',
      otherNames: typeof otherNames === 'string' ? splitList(otherNames) : [],
      aliases: typeof aliases === 'string' ? splitList(aliases) : [],
      datasets: typeof datasets === 'number' && datasets > 0 ? datasets : 0,
    });
  }
  return out;
}

/** names.js entries, then every index symbol names.js lacks (with no names). */
function mergeVocabulary(named: GeneEntry[], symbols: readonly string[], pathways: readonly string[]): SearchVocabulary {
  const genes: GeneEntry[] = named.slice();
  const have = new Set(named.map((g) => g.symbol));
  for (const raw of symbols) {
    const symbol = raw.toUpperCase();
    if (!symbol || have.has(symbol)) continue;
    have.add(symbol);
    genes.push({ symbol, name: '', otherNames: [], aliases: [], datasets: 0 });
  }
  return { genes, pathways: [...new Set(pathways.map((p) => p.toUpperCase()))] };
}

let vocabularyPromise: Promise<SearchVocabulary> | null = null;
/** The memoized vocabulary once it has resolved, for synchronous first renders. */
let loadedVocabulary: SearchVocabulary | null = null;

/**
 * The vocabulary if it has already loaded this session, else null. Lets a
 * freshly mounted results page render its answer on the first frame instead of
 * flashing a loading line for a value it already has.
 */
export function peekSearchVocabulary(): SearchVocabulary | null {
  return loadedVocabulary;
}

/**
 * The search vocabulary. Never rejects; resolves to whatever its sources yield.
 *
 * Memoized on the PROMISE, so the hub box and the results page share one load.
 * An all-empty result is NOT memoized — every source failed, most likely a
 * network blip at first focus — so the next caller retries instead of pinning
 * the session to a search that finds nothing. (bundleSource already caches the
 * deterministic misses underneath, so a genuine absence re-resolves instantly.)
 */
export function loadSearchVocabulary(): Promise<SearchVocabulary> {
  if (!vocabularyPromise) {
    vocabularyPromise = Promise.all([
      loadOptionalBundle<NamesPayload>(NAMES_URL, NAMES_GLOBAL).catch(() => null),
      loadGeneIndex().catch(() => [] as string[]),
      loadPathwayIndex().catch(() => [] as string[]),
    ])
      .then(([names, symbols, pathways]) => mergeVocabulary(decodeNames(names), symbols ?? [], pathways ?? []))
      .catch(() => mergeVocabulary([], [], []))
      .then((vocab) => {
        if (!vocab.genes.length && !vocab.pathways.length) vocabularyPromise = null;
        // Build the per-vocabulary index now, off the keystroke path, so the
        // first search after the load does not pay for it.
        else { prepared(vocab); loadedVocabulary = vocab; }
        return vocab;
      });
  }
  return vocabularyPromise;
}

/** Test-only: drop the memoized load so a fixture can be swapped in. */
export function _resetSearchVocabulary(): void {
  vocabularyPromise = null;
  loadedVocabulary = null;
}

// ── Normalization ───────────────────────────────────────────────────────────

/**
 * Lowercase, Greek letters spelled out, every run of punctuation one space.
 * 'pro-opiomelanocortin-alpha' -> 'pro opiomelanocortin alpha'.
 */
function normText(s: string): string {
  return s
    .toLowerCase()
    .replace(/α/g, 'alpha')
    .replace(/β/g, 'beta')
    .replace(/γ/g, 'gamma')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * A trailing token that only numbers a family member: a roman or arabic numeral
 * or a single letter. 'insulin II' and 'growth hormone 1' are what a reader
 * calls 'insulin' and 'growth hormone'.
 */
const TRAILING_ORDINAL = /^(?:[ivx]+|\d+|[a-z])$/;

/**
 * A derived name key shared by more than this many genes is a FAMILY, not a
 * name: 'interleukin 6' would otherwise make every interleukin an exact match
 * for 'interleukin'. Insulin (INS1, INS2) and growth hormone (GH1) stay under it.
 */
const DERIVED_NAME_MAX_GENES = 3;

// ── The per-vocabulary index ────────────────────────────────────────────────

interface NameRef { i: number; text: string }

interface PathwayRow {
  id: string;
  db: PathwayDb;
  dbLabel: string;
  title: string;
  dbOrder: number;
  /** id lowercased, underscores to spaces: 'gobp insulin secretion'. */
  idNorm: string;
  /** Title normalized: 'insulin secretion'. */
  titleNorm: string;
  /** ' ' + collection token + ' ' + titleNorm, for word-prefix tests. */
  words: string;
}

interface PreparedVocabulary {
  genes: readonly GeneEntry[];
  bySymbol: Map<string, number>;
  /** Punctuation-free key of each symbol that HAS punctuation ('HLA-A' -> 'hlaa'). */
  byCompactSymbol: Map<string, number[]>;
  byName: Map<string, NameRef[]>;
  byDerivedName: Map<string, NameRef[]>;
  byAlias: Map<string, NameRef[]>;
  /**
   * Per gene: every normalized name, each preceded by '\n', words separated by
   * ' '. '' for a gene with no names. "\n" + q finds a name prefix; " " + q or
   * "\n" + q finds a word prefix — one includes() per test instead of a loop.
   */
  nameHay: string[];
  /** Indexes of the genes with a non-empty nameHay: the only ones a name scan visits. */
  named: Int32Array;
  /**
   * Every named gene's nameHay, concatenated in `named` order, and where each
   * one starts. A name scan is then a run of indexOf calls over one string —
   * each hit mapped back to its gene by binary search — instead of 40k includes.
   */
  allNames: string;
  allNamesStart: Int32Array;
  /** Gene indexes sorted by symbol, for the symbol-prefix binary search. */
  symbolOrder: Int32Array;
  pathways: PathwayRow[];
}

const cache = new WeakMap<SearchVocabulary, PreparedVocabulary>();

function pushRef(map: Map<string, NameRef[]>, key: string, ref: NameRef): void {
  if (!key) return;
  const at = map.get(key);
  if (!at) map.set(key, [ref]);
  else if (!at.some((r) => r.i === ref.i)) at.push(ref);
}

function prepared(vocab: SearchVocabulary): PreparedVocabulary {
  const hit = cache.get(vocab);
  if (hit) return hit;

  const genes = vocab.genes;
  const bySymbol = new Map<string, number>();
  const byCompactSymbol = new Map<string, number[]>();
  const byName = new Map<string, NameRef[]>();
  const byDerivedName = new Map<string, NameRef[]>();
  const byAlias = new Map<string, NameRef[]>();
  const nameHay: string[] = new Array(genes.length);

  for (let i = 0; i < genes.length; i++) {
    const g = genes[i];
    if (!bySymbol.has(g.symbol)) bySymbol.set(g.symbol, i);
    const compact = synonymKey(g.symbol);
    if (compact && compact !== g.symbol.toLowerCase()) {
      const at = byCompactSymbol.get(compact);
      if (at) at.push(i); else byCompactSymbol.set(compact, [i]);
    }

    let hay = '';
    for (const name of g.name ? [g.name, ...g.otherNames] : g.otherNames) {
      const norm = normText(name);
      if (!norm) continue;
      hay += `\n${norm}`;
      pushRef(byName, norm, { i, text: name });
      const words = norm.split(' ');
      if (words.length >= 2 && TRAILING_ORDINAL.test(words[words.length - 1])) {
        pushRef(byDerivedName, words.slice(0, -1).join(' '), { i, text: name });
      }
      const slash = name.indexOf('/');
      if (slash > 0) pushRef(byDerivedName, normText(name.slice(0, slash)), { i, text: name });
    }
    nameHay[i] = hay;

    for (const alias of g.aliases) pushRef(byAlias, synonymKey(alias), { i, text: alias });
  }
  for (const [key, refs] of byDerivedName) if (refs.length > DERIVED_NAME_MAX_GENES) byDerivedName.delete(key);

  const namedList: number[] = [];
  for (let i = 0; i < genes.length; i++) if (nameHay[i]) namedList.push(i);
  const named = Int32Array.from(namedList);
  const allNamesStart = new Int32Array(named.length);
  const parts: string[] = new Array(named.length);
  let offset = 0;
  for (let k = 0; k < named.length; k++) {
    allNamesStart[k] = offset;
    parts[k] = nameHay[named[k]];
    offset += parts[k].length;
  }
  const allNames = parts.join('');
  const symbolOrder = Int32Array.from(genes.keys()).sort((a, b) => {
    const sa = genes[a].symbol;
    const sb = genes[b].symbol;
    return sa < sb ? -1 : sa > sb ? 1 : a - b;
  });

  const pathways = vocab.pathways.map((id): PathwayRow => {
    const { db, dbLabel, title } = describePathway(id);
    const titleNorm = normText(title);
    const prefix = id.indexOf('_') > 0 && db !== 'OTHER' ? id.slice(0, id.indexOf('_')).toLowerCase() : '';
    return {
      id, db, dbLabel, title,
      dbOrder: DB_ORDER[db],
      idNorm: normText(id),
      titleNorm,
      words: ` ${prefix} ${titleNorm}`,
    };
  });

  const out: PreparedVocabulary = {
    genes, bySymbol, byCompactSymbol, byName, byDerivedName, byAlias, nameHay, named,
    allNames, allNamesStart, symbolOrder, pathways,
  };
  cache.set(vocab, out);
  return out;
}

// ── Pathway titles ──────────────────────────────────────────────────────────

const PATHWAY_PREFIXES: ReadonlyArray<[string, PathwayDb]> = [
  ['GOBP_', 'GO_BP'],
  ['HALLMARK_', 'HALLMARK'],
  ['KEGG_', 'KEGG'],
  ['REACTOME_', 'REACTOME'],
];

const DB_LABEL: Record<PathwayDb, string> = {
  GO_BP: 'GO BP',
  HALLMARK: 'Hallmark',
  KEGG: 'KEGG',
  REACTOME: 'Reactome',
  OTHER: 'Other',
};

/** Tie-break order: the small curated collections before the large ones. */
const DB_ORDER: Record<PathwayDb, number> = { HALLMARK: 0, KEGG: 1, REACTOME: 2, GO_BP: 3, OTHER: 4 };

/**
 * Letter-only tokens that keep a fixed spelling in a sentence-cased title.
 * Tokens mixing letters and digits (MTORC1, IL6, G2M, E2F, P53) and single
 * letters (B cell, vitamin A) stay upper case by rule, so they are not listed.
 */
const TITLE_TOKENS: Readonly<Record<string, string>> = Object.fromEntries([
  'DNA', 'RNA', 'ATP', 'GTP', 'GDP', 'NAD', 'NADH', 'NADP', 'NADPH', 'TNFA', 'TNF', 'NFKB', 'KRAS',
  'JAK', 'STAT', 'MYC', 'TGF', 'WNT', 'ER', 'ROS', 'UV', 'MAPK', 'ERK', 'AKT', 'MTOR', 'AMPK',
  'GPCR', 'TCA', 'HIV', 'NMDA', 'AMPA', 'GABA', 'ECM', 'EGFR', 'ERBB', 'VEGF', 'PDGF', 'FGF',
  'IGF', 'HDL', 'LDL', 'TCR', 'BCR', 'MHC', 'NK', 'TLR', 'HDAC', 'PKA', 'PKC', 'SUMO', 'UTR',
  'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII',
].map((t) => [t, t] as const).concat([
  ['MRNA', 'mRNA'], ['TRNA', 'tRNA'], ['RRNA', 'rRNA'], ['MIRNA', 'miRNA'], ['NCRNA', 'ncRNA'],
  ['SNRNA', 'snRNA'], ['COA', 'CoA'], ['CAMP', 'cAMP'], ['CGMP', 'cGMP'],
]));

function titleToken(token: string): string {
  const upper = token.toUpperCase();
  const fixed = TITLE_TOKENS[upper];
  if (fixed) return fixed;
  if (upper.length === 1 && /[A-Z]/.test(upper)) return upper;
  if (/[A-Z]/.test(upper) && /\d/.test(upper)) return upper;
  return token.toLowerCase();
}

/**
 * A stored gs_name as a reader would want to see it.
 * 'HALLMARK_TNFA_SIGNALING_VIA_NFKB' -> Hallmark, 'TNFA signaling via NFKB';
 * 'GOBP_INSULIN_SECRETION' -> GO BP, 'Insulin secretion'.
 */
export function describePathway(id: string): { db: PathwayDb; dbLabel: string; title: string } {
  const upper = id.toUpperCase();
  const match = PATHWAY_PREFIXES.find(([prefix]) => upper.startsWith(prefix));
  const db: PathwayDb = match ? match[1] : 'OTHER';
  const rest = match ? id.slice(match[0].length) : id;
  const tokens = rest.split('_').filter(Boolean).map(titleToken);
  let title = tokens.join(' ');
  if (title) title = title[0].toUpperCase() + title.slice(1);
  return { db, dbLabel: DB_LABEL[db], title: title || id };
}

// ── Ranking ─────────────────────────────────────────────────────────────────

/** GeneMatchKind strongest first; the index is the tier. */
const KIND_ORDER: readonly GeneMatchKind[] = [
  'symbol', 'synonym', 'name', 'alias', 'symbol-prefix', 'name-prefix', 'name-word',
];
const KIND_TIER = Object.fromEntries(KIND_ORDER.map((k, i) => [k, i])) as Record<GeneMatchKind, number>;

/** The kinds decisive enough for the results page to open on the gene. */
const DECISIVE_KINDS = new Set<GeneMatchKind>(['symbol', 'synonym', 'name', 'alias']);

interface GeneCandidate {
  i: number;
  match: GeneMatchKind;
  matchedText: string;
  /** Position within a curated synonym entry; 0 for every other kind. */
  order: number;
  /**
   * 0 when the matched text is spelled exactly as typed. Within one kind it
   * outranks reach: 'OT' is OXT's previous symbol, while 'ot' is a mouse
   * mutant allele of Glra1 that happens to be stored in more datasets.
   */
  caseExact: 0 | 1;
}

const MIN_QUERY_LENGTH = 2;

export interface SearchOptions {
  geneLimit?: number;
  pathwayLimit?: number;
}

/**
 * Rank the vocabulary against one query. Pure; safe to call per keystroke.
 *
 * Genes, strongest match first (see GeneMatchKind): exact symbol, curated
 * common name, whole gene name, alias, symbol prefix, name prefix, name word.
 * A gene appears once, under its strongest match. Ties go to the curated order
 * within a common-name entry, then to text matched in the case it was typed,
 * then to the gene stored in more datasets, the shorter symbol, alphabetical.
 *
 * Pathways: exact id or title, then title prefix, then every query word
 * prefixing some title word in any order. Ties go Hallmark, KEGG, Reactome,
 * GO BP, then the shorter title.
 *
 * Queries shorter than two characters return nothing.
 */
export function searchAll(vocab: SearchVocabulary, query: string, opts: SearchOptions = {}): SearchResults {
  const trimmed = query.trim();
  const empty: SearchResults = { query: trimmed, genes: [], pathways: [], best: null };
  if (trimmed.length < MIN_QUERY_LENGTH) return empty;
  const geneLimit = opts.geneLimit ?? 50;
  const pathwayLimit = opts.pathwayLimit ?? 50;
  const index = prepared(vocab);

  const genes = geneLimit > 0 ? searchGenes(index, trimmed, geneLimit) : [];
  const pathways = pathwayLimit > 0 ? searchPathways(index, trimmed, pathwayLimit) : [];

  let best: BestMatch | null = null;
  if (genes[0] && DECISIVE_KINDS.has(genes[0].match)) best = { kind: 'gene', hit: genes[0] };
  else if (pathways[0] && pathways[0].score >= PATHWAY_TIER_SCALE * 3) best = { kind: 'pathway', hit: pathways[0] };
  return { query: trimmed, genes, pathways, best };
}

const GENE_TIER_SCALE = 1_000_000;

/** Positions in `named` of every gene whose nameHay contains `needle`, ascending. */
function namedGenesContaining(index: PreparedVocabulary, needle: string): number[] {
  const { allNames, allNamesStart } = index;
  const out: number[] = [];
  let pos = allNames.indexOf(needle);
  while (pos !== -1) {
    // The gene whose slice holds pos: the last start <= pos. A needle cannot
    // straddle two slices, because every slice begins with '\n' and a needle
    // holds one only as its first character.
    let lo = 0;
    let hi = allNamesStart.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (allNamesStart[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    out.push(lo);
    // One hit per gene: resume at the next gene's slice.
    if (lo + 1 >= allNamesStart.length) break;
    pos = allNames.indexOf(needle, allNamesStart[lo + 1]);
  }
  return out;
}

function compareCandidates(genes: readonly GeneEntry[]) {
  return (a: GeneCandidate, b: GeneCandidate): number => {
    const ga = genes[a.i];
    const gb = genes[b.i];
    return a.order - b.order
      || a.caseExact - b.caseExact
      || gb.datasets - ga.datasets
      || ga.symbol.length - gb.symbol.length
      || (ga.symbol < gb.symbol ? -1 : ga.symbol > gb.symbol ? 1 : 0);
  };
}

function searchGenes(index: PreparedVocabulary, query: string, limit: number): GeneHit[] {
  const { genes, nameHay, named, symbolOrder } = index;
  const qUpper = query.toUpperCase();
  const qNorm = normText(query);
  const qCompact = synonymKey(query);

  // ── Exact tiers, from the maps: O(1) per query. ──
  const exact = new Map<number, GeneCandidate>();
  const add = (i: number, match: GeneMatchKind, matchedText: string, order = 0) => {
    const at = exact.get(i);
    if (at && KIND_TIER[match] >= KIND_TIER[at.match]) return;
    exact.set(i, { i, match, matchedText, order, caseExact: matchedText === query ? 0 : 1 });
  };
  const sym = index.bySymbol.get(qUpper);
  if (sym !== undefined) add(sym, 'symbol', genes[sym].symbol);
  else if (qCompact) {
    // Punctuation is not part of what a reader means by a symbol: 'Ins-2' and
    // 'IGF-1' are INS2 and IGF1, and 'hla a' is HLA-A.
    const plain = index.bySymbol.get(qCompact.toUpperCase());
    if (plain !== undefined) add(plain, 'symbol', genes[plain].symbol);
    for (const i of index.byCompactSymbol.get(qCompact) ?? []) add(i, 'symbol', genes[i].symbol);
  }
  for (const entry of lookupSynonyms(query)) {
    entry.symbols.forEach((s, order) => {
      const i = index.bySymbol.get(s.toUpperCase());
      if (i !== undefined) add(i, 'synonym', entry.term, order);
    });
  }
  if (qNorm) {
    for (const ref of index.byName.get(qNorm) ?? []) add(ref.i, 'name', ref.text);
    for (const ref of index.byDerivedName.get(qNorm) ?? []) add(ref.i, 'name', ref.text);
  }
  if (qCompact) for (const ref of index.byAlias.get(qCompact) ?? []) add(ref.i, 'alias', ref.text);

  // One bucket per tier, so only the tiers that reach the limit get sorted.
  const buckets: GeneCandidate[][] = KIND_ORDER.map(() => []);
  const taken = new Uint8Array(genes.length);
  for (const c of exact.values()) { buckets[KIND_TIER[c.match]].push(c); taken[c.i] = 1; }
  let count = exact.size;
  const scanned = (i: number, match: GeneMatchKind, matchedText: string) => {
    buckets[KIND_TIER[match]].push({ i, match, matchedText, order: 0, caseExact: 1 });
    taken[i] = 1;
    count++;
  };

  // ── Symbol prefix: a binary search into the sorted symbols, then a walk. ──
  let lo = 0;
  let hi = symbolOrder.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (genes[symbolOrder[mid]].symbol < qUpper) lo = mid + 1; else hi = mid;
  }
  for (let k = lo; k < symbolOrder.length; k++) {
    const i = symbolOrder[k];
    if (!genes[i].symbol.startsWith(qUpper)) break;
    if (!taken[i]) scanned(i, 'symbol-prefix', qUpper);
  }

  // ── Name prefix, then name words: only genes that have a name. ──
  if (qNorm) {
    for (const k of namedGenesContaining(index, `\n${qNorm}`)) {
      const i = named[k];
      if (!taken[i]) scanned(i, 'name-prefix', query);
    }
    // A name-word hit ranks below every hit so far; once those fill the list,
    // no word hit could be shown and the scan is skipped.
    if (count < limit) {
      // Candidates come from the longest query word (the fewest hits): a word
      // starts a name ('\n') or follows a space. Every other word is then checked
      // against that gene's names alone.
      const words = qNorm.split(' ');
      const lead = words.reduce((a, b) => (b.length > a.length ? b : a));
      const candidates = new Set([
        ...namedGenesContaining(index, ` ${lead}`),
        ...namedGenesContaining(index, `\n${lead}`),
      ]);
      for (const k of candidates) {
        const i = named[k];
        if (taken[i]) continue;
        const hay = nameHay[i];
        let all = true;
        for (const w of words) {
          if (w !== lead && !hay.includes(` ${w}`) && !hay.includes(`\n${w}`)) { all = false; break; }
        }
        if (all) scanned(i, 'name-word', query);
      }
    }
  }

  const compare = compareCandidates(genes);
  const out: GeneHit[] = [];
  for (let tier = 0; tier < buckets.length && out.length < limit; tier++) {
    const bucket = buckets[tier].sort(compare);
    for (let k = 0; k < bucket.length && out.length < limit; k++) {
      const c = bucket[k];
      out.push({
        entry: genes[c.i],
        match: c.match,
        matchedText: c.matchedText,
        // Tier first, then list position, so higher is always better.
        score: (KIND_ORDER.length - tier) * GENE_TIER_SCALE - out.length,
      });
    }
  }
  return out;
}

const PATHWAY_TIER_SCALE = 1_000_000;

function searchPathways(index: PreparedVocabulary, query: string, limit: number): PathwayHit[] {
  // Underscores and hyphens are spaces, so a pasted gs_name finds itself.
  const qNorm = normText(query);
  if (!qNorm) return [];
  const qWords = qNorm.split(' ');
  // 0 exact id or title, 1 title (or id) prefix, 2 every word.
  const found: Array<{ row: PathwayRow; tier: number }> = [];
  for (const row of index.pathways) {
    if (row.idNorm === qNorm || row.titleNorm === qNorm) { found.push({ row, tier: 0 }); continue; }
    if (row.titleNorm.startsWith(qNorm) || row.idNorm.startsWith(qNorm)) { found.push({ row, tier: 1 }); continue; }
    let all = true;
    for (const w of qWords) {
      if (!row.words.includes(` ${w}`)) { all = false; break; }
    }
    if (all) found.push({ row, tier: 2 });
  }
  found.sort((a, b) => a.tier - b.tier
    || a.row.dbOrder - b.row.dbOrder
    || a.row.title.length - b.row.title.length
    || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0));
  const out: PathwayHit[] = [];
  for (let r = 0; r < found.length && r < limit; r++) {
    const { row, tier } = found[r];
    out.push({
      id: row.id,
      db: row.db,
      dbLabel: row.dbLabel,
      title: row.title,
      // Exact matches score >= 3 * PATHWAY_TIER_SCALE; searchAll's `best` relies on it.
      score: (3 - tier) * PATHWAY_TIER_SCALE + (PATHWAY_TIER_SCALE - 1 - r),
    });
  }
  return out;
}

// ── Labels ──────────────────────────────────────────────────────────────────

/**
 * A short explanation of why a gene matched, so a redirect is never silent:
 * "Common name “orexin”", "Alias “OT”", "Name starts with “insulin”".
 */
export function geneMatchLabel(hit: GeneHit): string {
  const t = hit.matchedText;
  switch (hit.match) {
    case 'symbol': return 'Symbol';
    case 'synonym': return `Common name “${t}”`;
    case 'name':
      return t && t.toLowerCase() !== hit.entry.name.toLowerCase() ? `Gene name “${t}”` : 'Gene name';
    case 'alias': return `Alias “${t}”`;
    case 'symbol-prefix': return `Symbol starts with “${t}”`;
    case 'name-prefix': return `Name starts with “${t}”`;
    case 'name-word': return `Name contains “${t}”`;
  }
}
