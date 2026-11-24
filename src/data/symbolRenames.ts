// Client for the SYMBOL RENAMES table (public/nomenclature/renames.js, written
// by scripts/build_search_names.mts from data/nomenclature/nomenclature.tsv).
//
// The corpus stores whatever symbol each study's annotation produced, so one
// gene can be stored under its current symbol in some studies and a retired one
// in others: MGI renamed Gm8773 to Fam237b, and dozens of mouse studies still
// store Gm8773. Matching on the symbol alone splits that gene in two, and each
// half looks complete.
//
// A RENAME GROUP is one authority's current symbol plus the retired symbols the
// authority links to the same record (same authority ID, one target, never a
// split; the builder's header states every condition). A study's result for a
// gene is read under whichever member that study stores, and only in the study's
// own authority: a mouse group says nothing about a macaque or pig study.
//
// Same policy as the alias index (./nomenclature.ts): every entry point resolves
// null rather than rejecting when the table is absent or unreadable, and every
// caller treats null as "no rename knowledge", which is exactly how the app
// behaved before this table existed.

import { loadOptionalBundle } from './bundleSource';
import {
  NOMENCLATURE_AUTHORITIES,
  nomenclatureAuthorityForStoredDatasetSymbols,
  type NomenclatureAuthority,
} from './nomenclatureWire';

/** MUST match RENAMES_WIRE_VERSION in scripts/build_search_names.mts. */
export const SYMBOL_RENAMES_WIRE_VERSION = 1;

const RENAMES_URL = '/nomenclature/renames.js';
const RENAMES_GLOBAL = 'HX_SYMBOL_RENAMES';

/** [authorityIndex, currentSymbol, ...retiredSymbols] */
type RenameWireGroup = [number, string, ...string[]];
interface RenamesPayload { v: number; authorities: string[]; groups: RenameWireGroup[] }

/** One gene under every symbol the corpus stores it by, in one authority. */
export interface RenameGroup {
  authority: NomenclatureAuthority;
  /** The authority's current symbol, as it spells it. */
  current: string;
  /** Retired symbols the corpus still stores, as the authority spells them. */
  retired: readonly string[];
  /** `current` then `retired`. */
  members: readonly string[];
}

export interface SymbolRenames {
  /** `${authority}\0${UPPERCASE member}` -> its group. */
  byMember: ReadonlyMap<string, RenameGroup>;
}

const memberKey = (authority: string, symbol: string): string => `${authority}\x00${symbol.toUpperCase()}`;

const KNOWN_AUTHORITIES = new Set<string>(NOMENCLATURE_AUTHORITIES);

/** Decode a payload. Exported for tests; null for any payload this client cannot read. */
export function buildSymbolRenames(payload: unknown): SymbolRenames | null {
  const p = payload as RenamesPayload | null;
  if (p?.v !== SYMBOL_RENAMES_WIRE_VERSION || !Array.isArray(p.groups) || !Array.isArray(p.authorities)) return null;
  const byMember = new Map<string, RenameGroup>();
  for (const row of p.groups) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const [code, current, ...retired] = row;
    const authority = p.authorities[code];
    // An authority this build does not know is dropped, as the alias index
    // drops out-of-range codes: no group is better than one read in the wrong
    // namespace.
    if (!authority || !KNOWN_AUTHORITIES.has(authority) || typeof current !== 'string') continue;
    const group: RenameGroup = {
      authority: authority as NomenclatureAuthority,
      current,
      retired,
      members: [current, ...retired],
    };
    for (const m of group.members) byMember.set(memberKey(authority, m), group);
  }
  return byMember.size ? { byMember } : null;
}

let renamesPromise: Promise<SymbolRenames | null> | null = null;

/**
 * The rename table, or null when it is unavailable. Memoized on the promise;
 * a null is not memoized, so a transport blip can be retried (see
 * loadAliasIndex, whose policy this follows).
 */
export function loadSymbolRenames(): Promise<SymbolRenames | null> {
  if (!renamesPromise) {
    renamesPromise = loadOptionalBundle<RenamesPayload>(RENAMES_URL, RENAMES_GLOBAL)
      .then((payload) => {
        const renames = buildSymbolRenames(payload);
        if (renames === null) renamesPromise = null;
        return renames;
      });
  }
  return renamesPromise;
}

/** The group `symbol` belongs to in `authority`, or null. Case-insensitive. */
export function renameGroupOf(
  renames: SymbolRenames | null,
  symbol: string,
  authority: NomenclatureAuthority | null | undefined,
): RenameGroup | null {
  if (!renames || !authority) return null;
  return renames.byMember.get(memberKey(authority, symbol)) ?? null;
}

/** The other members of `symbol`'s group in `authority`; [] without one. */
export function renamePartners(
  renames: SymbolRenames | null,
  symbol: string,
  authority: NomenclatureAuthority | null | undefined,
): string[] {
  const group = renameGroupOf(renames, symbol, authority);
  if (!group) return [];
  const u = symbol.toUpperCase();
  return group.members.filter((m) => m.toUpperCase() !== u);
}

/**
 * Which of the partners a study stores answers for the gene, when the study
 * does not store the queried symbol itself (that row always answers first).
 * One stored partner answers; several answer through the group's current
 * symbol, or not at all when it is not among them: two retired names in one
 * study are two features, and choosing between them would be a guess.
 * Every reader of renamed rows (the reports, Compare columns) uses this rule.
 */
export function pickStoredMember<T>(
  found: ReadonlyArray<{ symbol: string; value: T }>,
  group: RenameGroup,
): { symbol: string; value: T } | null {
  if (found.length === 1) return found[0];
  const current = group.current.toUpperCase();
  return found.find((f) => f.symbol.toUpperCase() === current) ?? null;
}

/** The authority whose rename groups apply to a dataset's stored symbols. */
export function renameAuthorityOf(dataset: { id: string; organism: string } | null | undefined): NomenclatureAuthority | null {
  return dataset ? nomenclatureAuthorityForStoredDatasetSymbols(dataset) : null;
}

/**
 * Every group `symbol` belongs to, one per authority. The reports query one
 * symbol across studies of several species, and each authority may rename it
 * differently (or not at all).
 */
export function renameGroupsFor(renames: SymbolRenames | null, symbol: string): RenameGroup[] {
  if (!renames) return [];
  const out: RenameGroup[] = [];
  for (const authority of NOMENCLATURE_AUTHORITIES) {
    const group = renames.byMember.get(memberKey(authority, symbol));
    if (group) out.push(group);
  }
  return out;
}

/** Test-only: drop the memoized load so a fixture can be swapped in. */
export function _resetSymbolRenames(): void {
  renamesPromise = null;
}
