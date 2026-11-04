// Shared contract for the unified search: one box for genes and pathways,
// one results page with an All / Genes / Pathways breakdown.
//
// The vocabulary module (searchVocabulary.ts) produces these values, the
// router carries SearchFilter in the URL, and the hub box and results page
// render them. Nothing here loads data.

/** The results page's breakdown. 'all' is the default. */
export type SearchFilter = 'all' | 'gene' | 'pathway';

export const SEARCH_FILTERS: readonly SearchFilter[] = ['all', 'gene', 'pathway'];

/** One gene the corpus stores, with the names a visitor might search it by. */
export interface GeneEntry {
  /** UPPERCASE stored symbol: the key the cross-dataset query index uses. */
  symbol: string;
  /** The preferred authority's full name ('oxytocin/neurophysin I prepropeptide'); '' when unknown. */
  name: string;
  /**
   * Full names other authorities give the same uppercase symbol (MGI calls
   * Oxt plain 'oxytocin'). Searched like `name`, never displayed as the title.
   */
  otherNames: readonly string[];
  /** Other names: authority aliases and previous symbols, as spelled upstream. */
  aliases: readonly string[];
  /** Number of datasets that store this symbol; 0 when unknown. Ranks ties. */
  datasets: number;
}

/**
 * How a gene matched, strongest first. The results page says which one it was
 * ("matched the gene name 'oxytocin'"), so a redirect is never silent.
 *
 *   symbol        the query IS the symbol (OXT)
 *   synonym       the curated dictionary maps the query to this gene (orexin -> HCRT)
 *   name          the query is the whole gene name, ignoring case (oxytocin -> Oxt)
 *   alias         the query is an authority alias or previous symbol (OT -> OXT)
 *   symbol-prefix the symbol starts with the query (POM -> POMC)
 *   name-prefix   the gene name starts with the query (insulin -> 'insulin II')
 *   name-word     a word of the gene name starts with the query
 */
export type GeneMatchKind =
  | 'symbol'
  | 'synonym'
  | 'name'
  | 'alias'
  | 'symbol-prefix'
  | 'name-prefix'
  | 'name-word';

export interface GeneHit {
  entry: GeneEntry;
  match: GeneMatchKind;
  /** The text that matched: the alias, the synonym term, or the name. */
  matchedText: string;
  /** Higher is better; only meaningful within one result list. */
  score: number;
}

/** MSigDB collection, as the query manifest spells it. */
export type PathwayDb = 'GO_BP' | 'HALLMARK' | 'KEGG' | 'REACTOME' | 'OTHER';

export interface PathwayHit {
  /** The stored MSigDB gs_name, e.g. 'GOBP_INSULIN_SECRETION'. Routes use this. */
  id: string;
  db: PathwayDb;
  /** Short collection label for a badge: 'GO BP', 'Hallmark', 'KEGG', 'Reactome'. */
  dbLabel: string;
  /** Readable title: prefix stripped, underscores to spaces, sentence case. */
  title: string;
  score: number;
}

export type BestMatch =
  | { kind: 'gene'; hit: GeneHit }
  | { kind: 'pathway'; hit: PathwayHit };

export interface SearchResults {
  query: string;
  genes: GeneHit[];
  pathways: PathwayHit[];
  /**
   * The result the page should open on, or null when nothing is decisive.
   * A gene wins when it matched by symbol, synonym, whole name or alias; a
   * pathway wins when the query is its id or its whole title.
   */
  best: BestMatch | null;
}

export interface SearchVocabulary {
  genes: readonly GeneEntry[];
  /** Stored pathway ids (MSigDB gs_names). */
  pathways: readonly string[];
}
