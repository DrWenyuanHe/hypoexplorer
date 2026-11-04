// The gene search box: type a name, get the symbols this dataset actually has.
//
// TWO THINGS IT HAS TO GET RIGHT
// ------------------------------
// 1. RANKING. The old version concatenated "starts with" and "contains" and cut
//    at 15, which meant an EXACT match could be pushed down the list — typing
//    AGRP put it behind nothing, but typing POMC listed it after nothing and
//    before POMC-AS1 only by luck of the source ordering. Exactness is now the
//    first sort key, so the thing you typed is the thing on top, every time.
//
// 2. OTHER NAMES. A dataset stores one spelling per gene, and it is often not
//    the one the reader knows. The macaque atlas stores the retired AARS, so
//    someone searching the current AARS1 got an empty dropdown and concluded the
//    gene was not measured. Now every suggestion can also be reached through the
//    authority's aliases, its previous symbols, and its current symbol — see
//    src/data/nomenclature.ts for where those come from.
//
// The alias index is OPTIONAL. Until it arrives (or if it never does — an older
// deploy, a failed request) this behaves exactly as it did before: direct symbol
// matching, ranked. Nothing here waits on it.

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { FONT_MONO, FONT_SANS } from '../styles/constants';
import { useAliasIndex } from '../data/useAliasIndex';
import {
  factsFor, resolveByOtherName,
  type AliasIndex, type NomenclatureAuthority, type SymbolFacts,
} from '../data/nomenclature';

interface GeneSearchBoxProps {
  onAdd: (gene: string) => void;
  selectedGenes: readonly string[];
  geneNames: readonly string[];
  /** The active dataset's symbol namespace. Omit only for a cross-species union. */
  nomenclatureAuthority?: NomenclatureAuthority | null;
  /** Autofocus on mount — set by the modal empty states, which exist to be typed into. */
  autoFocus?: boolean;
  placeholder?: string;
}

/** Why a suggestion is in the list. Also its sort rank — lower wins. */
const RANK = { exact: 0, otherName: 1, prefix: 2, contains: 3 } as const;
type MatchKind = keyof typeof RANK;

interface Suggestion {
  /** The symbol as this dataset spells it — what gets selected. */
  gene: string;
  kind: MatchKind;
  /** The name that matched, when it was not the symbol itself ('AARS1', 'ASIP2'). */
  via?: string;
  facts: SymbolFacts | null;
}

const MAX_SUGGESTIONS = 15;

/**
 * Rank the dataset's symbols against a query, then top up with other names.
 *
 * Direct matches are computed first and always win: a query that names a symbol
 * in this dataset must never be outranked by a redirect, or typing a real gene
 * would offer to take you somewhere else.
 */
function search(
  query: string,
  names: readonly string[],
  index: AliasIndex | null,
  knownUpper: ReadonlyMap<string, string>,
  authority?: NomenclatureAuthority | null,
): Suggestion[] {
  const uq = query.trim().toUpperCase();
  if (!uq) return [];

  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const add = (gene: string, kind: MatchKind, via?: string) => {
    if (seen.has(gene)) return;
    seen.add(gene);
    out.push({ gene, kind, via, facts: factsFor(index, gene, authority) });
  };

  for (const name of names) {
    const un = name.toUpperCase();
    if (un === uq) add(name, 'exact');
    else if (un.startsWith(uq)) add(name, 'prefix');
    else if (un.includes(uq)) add(name, 'contains');
  }

  // Other names are looked up only for an EXACT query. A substring sweep over
  // every alias in the corpus would be both slow and noisy — three characters
  // would drag in hundreds of unrelated genes — and the case this exists for is
  // someone typing a name they know in full.
  for (const gene of resolveByOtherName(index, query, knownUpper, authority)) {
    add(gene, 'otherName', query.trim());
  }

  return out
    .sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.gene.length - b.gene.length || a.gene.localeCompare(b.gene))
    .slice(0, MAX_SUGGESTIONS);
}

/** The authority's current symbol for an outdated one, when there is one. */
/**
 * The current symbol(s) a retired one points at, as a list: currentSymbol is
 * pipe-joined when the authority split a retired symbol across several genes,
 * and rendering the raw 'A|B' would print wire format at the reader.
 */
function outdatedTo(facts: SymbolFacts | null): string[] {
  return facts?.status === 'previous' && facts.currentSymbol
    ? facts.currentSymbol.split('|')
    : [];
}

export function GeneSearchBox({
  onAdd, selectedGenes, geneNames, nomenclatureAuthority, autoFocus, placeholder,
}: GeneSearchBoxProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [showAliases, setShowAliases] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The blur close is deferred so a click on a suggestion lands before the
  // list closes. Both timers must die with the component: a pending one that
  // fires after unmount calls setState against a torn-down tree, which in
  // jsdom surfaces as `ReferenceError: window is not defined` from React's
  // scheduler and fails the run as an unhandled error rather than as a test.
  const blurTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => {
    clearTimeout(timerRef.current);
    clearTimeout(blurTimerRef.current);
  }, []);
  const aliasIndex = useAliasIndex();

  // Read through refs so the debounced search always sees the latest inputs
  // without making `search` itself a changing dependency — the timer is fired
  // from a keystroke handler, not from an effect.
  const geneNamesRef = useRef(geneNames);
  useEffect(() => { geneNamesRef.current = geneNames; }, [geneNames]);
  const aliasIndexRef = useRef(aliasIndex);
  useEffect(() => { aliasIndexRef.current = aliasIndex; }, [aliasIndex]);

  // UPPERCASE -> this dataset's own spelling. See resolveByOtherName on why the
  // dataset's spelling has to come back out, not the nomenclature table's.
  const knownUpper = useMemo(
    () => new Map(geneNames.map((g) => [g.toUpperCase(), g] as const)),
    [geneNames]);
  const knownUpperRef = useRef(knownUpper);
  useEffect(() => { knownUpperRef.current = knownUpper; }, [knownUpper]);
  const authorityRef = useRef(nomenclatureAuthority);
  useEffect(() => { authorityRef.current = nomenclatureAuthority; }, [nomenclatureAuthority]);

  const selectedSet = useMemo(() => new Set(selectedGenes), [selectedGenes]);

  const runSearch = useCallback((q: string) => {
    if (!q.trim()) { setSuggestions([]); setOpen(false); return; }
    setSuggestions(search(
      q, geneNamesRef.current, aliasIndexRef.current, knownUpperRef.current, authorityRef.current,
    ));
    setOpen(true);
  }, []);

  // The index can land AFTER the user has typed. Re-running the open search when
  // it does is what turns "no results" into a redirect without a second
  // keystroke — which is the whole difference between the feature working and
  // the user having already given up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires on index arrival only; adding query/open would re-run on every keystroke and defeat the debounce
  useEffect(() => {
    if (aliasIndex && open && query.trim()) runSearch(query);
  }, [aliasIndex]);

  // Focus on mount when the caller asked for it (the modal empty states exist to
  // be typed into). Done through the ref rather than the `autofocus` attribute:
  // the attribute moves focus during the browser's own parse, before assistive
  // tech has announced the dialog that opened, which is what a11y/noAutofocus is
  // about. An effect runs after the dialog is mounted and announced.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount only
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, []);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => runSearch(v), 80);
  };

  const handleSelect = (gene: string) => {
    if (gene && !selectedSet.has(gene)) onAdd(gene);
    setQuery('');
    setSuggestions([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      // Enter takes the top suggestion, which is already the exact match when
      // there is one. Falling back to the list also makes Enter work for a
      // redirect — typing AARS1 and pressing Enter selects the stored AARS.
      clearTimeout(timerRef.current);
      const ranked = suggestions.length
        ? suggestions
        : search(
          query, geneNamesRef.current, aliasIndexRef.current, knownUpperRef.current, authorityRef.current,
        );
      if (ranked.length) handleSelect(ranked[0].gene);
    }
    if (e.key === 'Escape') setOpen(false);
  };

  const aliasToggleTitle = showAliases
    ? 'Hide alias and previous symbols in the suggestions'
    : 'Show each gene\'s alias and previous symbols from its nomenclature authority';

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: '0 1 380px', minWidth: 0 }}>
      <div style={{ position: 'relative', flex: '1 1 auto', minWidth: 0 }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => query && setOpen(true)}
          onBlur={() => {
            clearTimeout(blurTimerRef.current);
            blurTimerRef.current = setTimeout(() => setOpen(false), 150);
          }}
          aria-label="Search gene"
          placeholder={placeholder ?? 'Search gene, e.g. POMC, NPY, AGRP'}
          style={{
            width: '100%', padding: '5px 10px', fontSize: 13,
            fontFamily: FONT_MONO,
            border: '1px solid var(--border-dark)', borderRadius: 4,
            color: 'var(--text-primary)',
          }}
        />
        {open && suggestions.length > 0 && (
          <div className="gene-suggestions" style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 100,
            background: 'var(--bg-panel)', border: '1px solid var(--border-dark)',
            borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            width: '100%', maxHeight: 320, overflowY: 'auto',
          }}>
            {suggestions.map((s) => {
              const retiredTo = outdatedTo(s.facts);
              // Previous symbols sit alongside aliases here rather than in their
              // own row: from the reader's side both answer "what else is this
              // called", and the distinction is already carried by the outdated
              // badge on the genes where it changes what you should do.
              // Deduped: a name can be both an alias and a previous symbol (MGI
              // lists mouse Agrt as both, for Agrp), and showing it twice in one
              // line reads as a bug.
              const others = [...new Set([...(s.facts?.aliases ?? []), ...(s.facts?.prevSymbols ?? [])])];
              return (
                <button
                  type="button"
                  key={s.gene}
                  className="hover-row"
                  onMouseDown={() => handleSelect(s.gene)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '5px 10px', cursor: 'pointer', fontSize: 12,
                    fontFamily: FONT_MONO, background: 'none',
                    color: selectedSet.has(s.gene) ? 'var(--color-neutral)' : 'var(--text-primary)',
                    border: 'none',
                  }}
                >
                  <span>{s.gene}</span>
                  {selectedSet.has(s.gene) && <span> ✓</span>}
                  {/* When the query IS the current symbol, "matched AARS1 · now
                      AARS1" says the same thing twice; the redirect alone is
                      the whole explanation. */}
                  {s.kind === 'otherName' && s.via
                    && !retiredTo.some((t) => t.toUpperCase() === s.via?.toUpperCase()) && (
                    <span style={{ color: 'var(--accent)', fontFamily: FONT_SANS, fontSize: 11 }}>
                      {' '}· matched {s.via}
                    </span>
                  )}
                  {retiredTo.length > 0 && (
                    <span style={{ color: 'var(--text-muted)', fontFamily: FONT_SANS, fontSize: 11 }}>
                      {' '}· now {retiredTo.join(' / ')}
                    </span>
                  )}
                  {showAliases && others.length > 0 && (
                    <span style={{ color: 'var(--text-muted)', fontFamily: FONT_SANS, fontSize: 11 }}>
                      {' '}· {others.join(', ')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => setShowAliases((v) => !v)}
        aria-pressed={showAliases}
        title={aliasToggleTitle}
        style={{
          flexShrink: 0, fontSize: 11, padding: '4px 9px', cursor: 'pointer',
          border: `1px solid ${showAliases ? 'var(--accent)' : 'var(--border-dark)'}`,
          borderRadius: 4, fontFamily: FONT_SANS, fontWeight: 600,
          background: showAliases ? 'var(--accent)' : 'var(--bg-panel)',
          color: showAliases ? '#fff' : 'var(--text-muted)',
        }}
      >
        Aliases
      </button>
    </div>
  );
}
