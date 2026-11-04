// Client for the GENE NOMENCLATURE TABLE (see scripts/build_nomenclature.mts,
// which emits public/nomenclature/**).
//
// The corpus stores whatever symbol its upstream analysis produced. That symbol
// may be the authority's current one, one the authority has since REPLACED, or
// an informal alias — and until this module existed the app could not tell those
// apart, so two things were impossible:
//
//   * Searching a gene by the name you know it by. Type AARS1 and the macaque
//     atlas — which stores the retired AARS — had nothing for you.
//   * Knowing whether the symbol on screen is current.
//
// Both are answered from one small precomputed table instead of a live
// nomenclature API, which would put a third-party network dependency on the
// critical path of every keystroke.
//
// TWO FILES, TWO READERS
// ----------------------
//   aliases.js  the SEARCH path. Only symbols that have something to redirect
//               (an alias, a previous symbol, or a non-current status), which is
//               about a third of the corpus: the Gm…/…Rik/LOC… tail carries no
//               synonyms and would triple the file for nothing.
//   table.js    the reference page's payload — every row, every column. Nobody
//               pays for it until they open that page.
//
// GRACEFUL DEGRADATION IS THE POINT
// ---------------------------------
// Every entry point resolves to `null` rather than rejecting when the table is
// absent or unparseable, and every caller treats null as "no alias knowledge" —
// searching still matches symbols directly, and the explorer works exactly as it
// did before this file existed. That is what makes it safe for the gene box to
// kick off the load in the background and simply use it if it arrives.
//
// Same JSONP convention as the data bundles: a classic script assigning a window
// global. Everything about how those bytes are fetched lives behind
// loadOptionalBundle, including the ?v= cache bust and the never-reject policy.

import { loadOptionalBundle } from './bundleSource';
import {
  NOMENCLATURE_AUTHORITIES,
  NOMENCLATURE_AUTHORITY_ID_PREFIX,
  NOMENCLATURE_STATUS,
  type NomenclatureAuthority,
  type NomenclatureStatus,
} from './nomenclatureWire';
export {
  NOMENCLATURE_AUTHORITIES,
  NOMENCLATURE_AUTHORITY_BY_ORGANISM,
  NOMENCLATURE_AUTHORITY_ID_PREFIX,
  NOMENCLATURE_STATUS,
  nomenclatureAuthorityForOrganism,
  nomenclatureAuthorityForStoredDatasetSymbols,
} from './nomenclatureWire';
export type { NomenclatureAuthority, NomenclatureStatus } from './nomenclatureWire';

// ── Wire format. MUST match scripts/build_nomenclature.mts. ─────────────────

/**
 * The wire version this client can decode. A payload with any other `v` is
 * treated as absent rather than guessed at: under the prompt-type service
 * worker an old app shell can outlive many deploys, and /nomenclature/* is an
 * unversioned path — so a future wire bump WILL eventually hand new bytes to
 * an old parser, and the graceful-degradation contract (null, app works
 * without alias knowledge) is the right failure, not misdecoded statuses.
 */
const NOMENCLATURE_WIRE_VERSION = 1;

/** [symbol, authorityCode, statusCode, currentSymbol|0, aliases, prevSymbols] */
type AliasWireRow = [string, number, number, string | 0, string, string];
/** [symbol, authority, status, currentSymbol, geneName, aliases, prev, id, locusIx, nDatasets] */
type TableWireRow = [string, number, number, string, string, string, string, string, number, number];

interface AliasPayload { v: number; rows: AliasWireRow[] }
interface TablePayload {
  v: number;
  columns: string[];
  locusTypes: string[];
  tally: Record<NomenclatureStatus, number>;
  sources: Record<string, { url: string; file: string; bytes: number; records: number }>;
  rows: TableWireRow[];
}

const ALIASES_URL = '/nomenclature/aliases.js';
const TABLE_URL = '/nomenclature/table.js';

// Deliberately NOT prefixed with a dataset's bundleBaseUrl. The bundles move to
// R2; this table ships with the app (public/nomenclature/ is not in
// vite.config's dropOffOriginData list), so it is same-origin on every deploy
// and can never be a version behind the UI that reads it.

const splitList = (v: string): string[] => (v ? v.split('|') : []);

// ── The search-path index ───────────────────────────────────────────────────

/** What the app knows about one symbol the corpus actually stores. */
export interface SymbolFacts {
  /** The symbol as the corpus spells it (macaque POMC, mouse Pomc). */
  symbol: string;
  authority: NomenclatureAuthority;
  status: NomenclatureStatus;
  /** The authority's current symbol; '' when the symbol IS current or unknown.
   *  Pipe-joined when a retired symbol was split across several genes. */
  currentSymbol: string;
  aliases: string[];
  prevSymbols: string[];
}

export interface AliasIndex {
  /**
   * UPPERCASE stored symbol -> its facts.
   *
   * An ARRAY because the corpus spans several species in one table and their symbols
   * collide case-insensitively: macaque POMC and mouse Pomc are different records
   * under different authorities. Callers disambiguate by asking which of them the
   * dataset in front of them actually contains — which is also the only
   * disambiguation that could be correct, since the species is a property of the
   * dataset and not of the query.
   */
  bySymbol: Map<string, SymbolFacts[]>;
  /**
   * UPPERCASE other-name -> the stored symbols that name would find.
   *
   * One map for all three directions, because from the search box's point of view
   * they are the same question — "I typed a name that is not in this dataset; is
   * it another name for something that is?":
   *
   *   current symbol -> stored retired symbol   (type AARS1, find the stored AARS)
   *   alias          -> stored symbol           (type ASIP2, find AGRP)
   *   previous symbol-> stored symbol           (type Agrt,  find Agrp)
   */
  byOtherName: Map<string, string[]>;
  /** Same lookup, partitioned by authority for single-dataset search. */
  byOtherNameByAuthority: Map<string, string[]>;
}

function pushMulti(map: Map<string, string[]>, key: string, value: string): void {
  const at = map.get(key);
  if (at) { if (!at.includes(value)) at.push(value); }
  else map.set(key, [value]);
}

function buildAliasIndex(payload: AliasPayload): AliasIndex {
  const bySymbol = new Map<string, SymbolFacts[]>();
  const byOtherName = new Map<string, string[]>();
  const byOtherNameByAuthority = new Map<string, string[]>();
  const ambiguousNames = new Set(payload.rows.filter((row) => NOMENCLATURE_STATUS[row[2]] === 'ambiguous')
    .map((row) => `${NOMENCLATURE_AUTHORITIES[row[1]]}\x00${row[0].toUpperCase()}`));

  for (const [symbol, auth, status, current, aliases, prev] of payload.rows) {
    const authority = NOMENCLATURE_AUTHORITIES[auth];
    const statusName = NOMENCLATURE_STATUS[status];
    // Out-of-range codes fail CLOSED: dropping the row degrades to "no alias
    // knowledge for this symbol", while defaulting would confidently mislabel
    // it ('current', under 'HGNC') — the one thing this table must never do.
    if (!authority || !statusName) continue;
    const facts: SymbolFacts = {
      symbol,
      authority,
      status: statusName,
      currentSymbol: statusName === 'ambiguous' || current === 0 ? '' : current,
      aliases: statusName === 'ambiguous' ? [] : splitList(aliases),
      prevSymbols: statusName === 'ambiguous' ? [] : splitList(prev),
    };
    const key = symbol.toUpperCase();
    const at = bySymbol.get(key);
    if (at) at.push(facts); else bySymbol.set(key, [facts]);

    for (const other of [...facts.currentSymbol.split('|'), ...facts.aliases, ...facts.prevSymbols]) {
      const u = other.trim().toUpperCase();
      // A name that IS the symbol is not an "other" name. MGI in particular
      // lists a marker's own symbol among its synonyms often enough that
      // skipping this would make every such gene look like its own alias.
      if (u && u !== key && !ambiguousNames.has(`${authority}\x00${u}`)) {
        pushMulti(byOtherName, u, symbol);
        pushMulti(byOtherNameByAuthority, `${authority}\x00${u}`, symbol);
      }
    }
  }
  return { bySymbol, byOtherName, byOtherNameByAuthority };
}

let aliasIndexPromise: Promise<AliasIndex | null> | null = null;

/**
 * The search-path index, or null when the table is unavailable.
 *
 * Memoized on the PROMISE, so the twenty-odd components that want it during one
 * session share a single request — and a session that never searches never makes
 * one. A null result is NOT memoized here: bundleSource already caches the
 * deterministic misses (absent file, malformed bundle) and never caches a
 * transport failure, so dropping our memo on null lets its policy govern —
 * a genuine miss re-resolves instantly from its miss cache, while a network
 * blip at first search gets to retry instead of pinning the session.
 */
export function loadAliasIndex(): Promise<AliasIndex | null> {
  if (!aliasIndexPromise) {
    aliasIndexPromise = loadOptionalBundle<AliasPayload>(ALIASES_URL, 'HX_NOMENCLATURE_ALIASES')
      .then((p) => {
        const index = p?.v === NOMENCLATURE_WIRE_VERSION && p.rows?.length ? buildAliasIndex(p) : null;
        // A null is NOT memoized here: bundleSource already caches the
        // deterministic misses (absent file, malformed bundle) and never
        // caches a transport failure, so dropping our memo lets its policy
        // govern — a genuine miss re-resolves instantly from its miss cache,
        // while a network blip at first search gets to retry instead of
        // pinning the whole session to "no alias knowledge".
        if (index === null) aliasIndexPromise = null;
        return index;
      });
  }
  return aliasIndexPromise;
}

// ── Lookup helpers ──────────────────────────────────────────────────────────

/**
 * The facts for one stored symbol, as spelled in a specific dataset.
 *
 * `symbol` must be a symbol the dataset actually contains: matching is exact on
 * the way out (after a case-insensitive lookup) so that asking about macaque
 * POMC can never hand back mouse Pomc's record.
 */
export function factsFor(
  index: AliasIndex | null,
  symbol: string,
  authority?: NomenclatureAuthority | null,
): SymbolFacts | null {
  const candidates = index?.bySymbol.get(symbol.toUpperCase());
  if (!candidates?.length) return null;
  const inAuthority = authority ? candidates.filter((f) => f.authority === authority) : candidates;
  const exact = inAuthority.filter((f) => f.symbol === symbol);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  return inAuthority.length === 1 ? inAuthority[0] : null;
}

/**
 * Stored symbols that a query finds by another name.
 *
 * `known` maps UPPERCASE -> the dataset's OWN spelling of each symbol it has.
 * A map rather than a set, and the result is the dataset's spelling rather than
 * the table's, because the table spans species whose symbols differ only in
 * case. `AARS1` is a previous-symbol redirect for both the mouse `Aars` and the
 * macaque `AARS`; filtering a case-insensitive set would pass BOTH of them for
 * either dataset, and the macaque atlas would offer a mouse-spelled gene it does
 * not contain. Mapping back through the dataset's own spelling makes that
 * impossible by construction — and dedupes, since both candidates resolve to the
 * one symbol this dataset actually has.
 *
 * Returns [] when the query is itself a stored symbol: it needs no redirect, and
 * offering one would put a duplicate at the top of every successful search.
 */
export function resolveByOtherName(
  index: AliasIndex | null,
  query: string,
  known: ReadonlyMap<string, string>,
  authority?: NomenclatureAuthority | null,
): string[] {
  if (!index) return [];
  const u = query.trim().toUpperCase();
  if (!u || known.has(u)) return [];
  const out = new Set<string>();
  const candidates = authority
    ? index.byOtherNameByAuthority.get(`${authority}\x00${u}`) ?? []
    : index.byOtherName.get(u) ?? [];
  for (const symbol of candidates) {
    const own = known.get(symbol.toUpperCase());
    // An unscoped, same-spelling symbol shared by several authorities cannot be
    // attributed honestly. Single-dataset callers pass their authority; the
    // cross-dataset picker fails closed for an ambiguous alias.
    if (own && (authority || factsFor(index, own))) out.add(own);
  }
  return [...out];
}

// ── The reference page's full table ─────────────────────────────────────────

/** One row of the nomenclature reference table. */
export interface NomenclatureRow {
  symbol: string;
  authority: NomenclatureAuthority;
  status: NomenclatureStatus;
  currentSymbol: string;
  geneName: string;
  aliases: string[];
  prevSymbols: string[];
  /** Fully qualified again ('HGNC:330'); the wire strips the implied prefix. */
  authorityId: string;
  locusType: string;
  datasetCount: number;
}

export interface NomenclatureTable {
  rows: NomenclatureRow[];
  tally: Record<NomenclatureStatus, number>;
  sources: TablePayload['sources'];
}

let tablePromise: Promise<NomenclatureTable | null> | null = null;

/** The full table, or null when it is unavailable. Memoized like the index. */
export function loadNomenclatureTable(): Promise<NomenclatureTable | null> {
  if (!tablePromise) {
    tablePromise = loadOptionalBundle<TablePayload>(TABLE_URL, 'HX_NOMENCLATURE_TABLE').then((p) => {
      if (p?.v !== NOMENCLATURE_WIRE_VERSION || !p.rows?.length) {
        // See loadAliasIndex: nulls are re-askable, not memoized.
        tablePromise = null;
        return null;
      }
      const locusTypes = p.locusTypes ?? [];
      const rows: NomenclatureRow[] = [];
      for (const [symbol, auth, status, current, name, aliases, prev, id, locusIx, n] of p.rows) {
        const authority = NOMENCLATURE_AUTHORITIES[auth];
        const statusName = NOMENCLATURE_STATUS[status];
        // Fail closed on out-of-range codes, as buildAliasIndex does.
        if (!authority || !statusName) continue;
        rows.push({
          symbol,
          authority,
          status: statusName,
          currentSymbol: statusName === 'ambiguous' ? '' : current,
          geneName: name,
          aliases: statusName === 'ambiguous' ? [] : splitList(aliases),
          prevSymbols: statusName === 'ambiguous' ? [] : splitList(prev),
          authorityId: id && statusName !== 'ambiguous' ? `${NOMENCLATURE_AUTHORITY_ID_PREFIX[authority]}:${id}` : '',
          locusType: locusTypes[locusIx] ?? '',
          datasetCount: n,
        });
      }
      // Tally the DECODED rows, not the payload’s own counts. Rows whose authority
      // this build does not know are dropped above, so a payload from a newer
      // generator would otherwise render counts for species absent from the table
      // beneath them — chips promising rows the export cannot produce. Counting
      // what survived keeps the two honest to each other.
      const tally: Record<NomenclatureStatus, number> = { current: 0, previous: 0, alias: 0, unrecognized: 0, ambiguous: 0 };
      for (const row of rows) tally[row.status] += 1;
      return { rows, tally, sources: p.sources ?? {} };
    });
  }
  return tablePromise;
}

/** Test-only: drop the memoized loads so a fixture can be swapped in. */
export function _resetNomenclature(): void {
  aliasIndexPromise = null;
  tablePromise = null;
}
