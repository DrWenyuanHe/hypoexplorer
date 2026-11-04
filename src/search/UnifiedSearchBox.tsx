// The one search box for genes and pathways, used on the homepage ('hub') and
// at the top of the results page ('page').
//
// There is no mode switch: a term is looked up as a gene and as a pathway at
// once, and the suggestion list shows both, in two labelled groups. Submitting
// typed text opens the results page for that text as typed; picking a
// suggestion opens the results page for that gene symbol or pathway id, so the
// page lands on exactly what was picked.
//
// The box follows the familiar web-search shape: a pill with a magnifier, a
// clear button and the go button, and a suggestion list that opens as part of
// the same surface. A press anywhere on that surface keeps focus in the field,
// so clicking a group label, the list's scrollbar or a button never closes the
// list; clicking back into the field reopens it.
//
// The vocabulary (gene symbols, names and aliases plus pathway ids) is fetched
// the first time the hub's field is focused, never on mount, so the homepage
// requests no data until a visitor starts a search. The results page wants it
// at once and loads it immediately.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, MouseEvent } from 'react';
import { geneMatchLabel, searchAll } from './searchVocabulary';
import { useSearchVocabulary } from './useSearchVocabulary';
import type { GeneHit, PathwayHit } from './searchTypes';
import { DbBadge } from './DbBadge';

export interface UnifiedSearchBoxProps {
  /** The text the field starts with, and follows when it changes (the results page's query). */
  initialQuery?: string;
  /** Called with the trimmed typed text, a picked gene's symbol or a picked pathway's id. */
  onSearch: (query: string) => void;
  /** Load the vocabulary on mount instead of on first focus. Defaults to true on the page variant. */
  autoLoad?: boolean;
  variant: 'hub' | 'page';
}

/** Suggestions shown per group. */
const SUGGEST_LIMIT = 6;

type Option =
  | { kind: 'gene'; key: string; value: string; hit: GeneHit }
  | { kind: 'pathway'; key: string; value: string; hit: PathwayHit };

/** Whether a gene suggestion should say how it matched. A symbol match explains itself. */
function showsMatchLabel(hit: GeneHit): boolean {
  return hit.match !== 'symbol' && hit.match !== 'symbol-prefix';
}

/** A symbol with the part the visitor already typed set apart, so the completion stands out. */
function withTypedPrefix(text: string, typed: string) {
  const t = typed.trim();
  if (!t || !text.toLowerCase().startsWith(t.toLowerCase())) return text;
  return <><span className="typed">{text.slice(0, t.length)}</span>{text.slice(t.length)}</>;
}

const MAGNIFIER = (
  <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <circle cx="8.5" cy="8.5" r="5.5" />
    <path d="m13 13 4 4" />
  </svg>
);

/** Whether a key press landed somewhere that takes text or belongs to a dialog. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[role="dialog"]')) return true;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

export function UnifiedSearchBox({ initialQuery = '', onSearch, autoLoad, variant }: UnifiedSearchBoxProps) {
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [wanted, setWanted] = useState(autoLoad ?? variant === 'page');
  const vocab = useSearchVocabulary(wanted);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  // The results page re-renders the box with each new query; the field follows.
  useEffect(() => {
    setQuery(initialQuery);
    setActive(-1);
  }, [initialQuery]);

  const results = useMemo(
    () => (vocab ? searchAll(vocab, query, { geneLimit: SUGGEST_LIMIT, pathwayLimit: SUGGEST_LIMIT }) : null),
    [vocab, query],
  );
  const options = useMemo<Option[]>(() => {
    if (!results) return [];
    return [
      ...results.genes.map((hit): Option => ({ kind: 'gene', key: `g:${hit.entry.symbol}`, value: hit.entry.symbol, hit })),
      ...results.pathways.map((hit): Option => ({ kind: 'pathway', key: `p:${hit.id}`, value: hit.id, hit })),
    ];
  }, [results]);
  const showList = open && options.length > 0;
  const optionId = (i: number) => `${listId}-${i}`;

  // "/" jumps to the homepage's search box from anywhere on the page, as on
  // most search engines, unless the visitor is already typing somewhere else.
  useEffect(() => {
    if (variant !== 'hub') return undefined;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [variant]);

  const submit = (term: string) => {
    const q = term.trim();
    if (!q) {
      input.current?.focus();
      return;
    }
    setOpen(false);
    setActive(-1);
    onSearch(q);
  };

  const pick = (option: Option) => {
    setQuery(option.value);
    submit(option.value);
  };

  const clear = () => {
    setQuery('');
    setActive(-1);
    setOpen(true);
    input.current?.focus();
  };

  // A press on the surface outside the field would blur it and close the list
  // under the pointer; keep focus in the field instead, as search engines do.
  const onSurfaceMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === input.current) return;
    event.preventDefault();
    input.current?.focus();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (showList && active >= 0 && options[active]) pick(options[active]);
    else submit(query);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!options.length) return;
      event.preventDefault();
      setOpen(true);
      // Cycles through both groups and back to the typed text (-1).
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => {
        const next = i + step;
        if (next >= options.length) return -1;
        if (next < -1) return options.length - 1;
        return next;
      });
    } else if (event.key === 'Escape' && showList) {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  };

  const nGenes = results?.genes.length ?? 0;
  const renderOption = (option: Option, i: number) => (
    // biome-ignore lint/a11y/useFocusableInteractive: combobox pattern; focus stays in the field and the arrow keys move aria-activedescendant
    // biome-ignore lint/a11y/useKeyWithClickEvents: the field's onKeyDown picks options (arrows + Enter); the click is the pointer path
    <div
      key={option.key}
      id={optionId(i)}
      role="option"
      aria-selected={i === active}
      className={`hub-search-option hub-search-option--${option.kind}`}
      onClick={() => pick(option)}
    >
      <span className="hub-search-option-icon">{MAGNIFIER}</span>
      {option.kind === 'gene' ? (
        <>
          <span className="sym">{withTypedPrefix(option.hit.entry.symbol, query)}</span>
          {option.hit.entry.name && <span className="nm">{option.hit.entry.name}</span>}
          {showsMatchLabel(option.hit) && <span className="why">{geneMatchLabel(option.hit)}</span>}
        </>
      ) : (
        <>
          <span className="ptitle">{option.hit.title}</span>
          <DbBadge db={option.hit.db} label={option.hit.dbLabel} />
        </>
      )}
    </div>
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: <search> cannot submit; the form's role gives the same landmark
    <form className={`hub-search usearch usearch--${variant}`} role="search" aria-label="Search genes and pathways" onSubmit={onSubmit}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the press only keeps focus in the field; the field and buttons carry the interaction */}
      <div className={`hub-search-box${showList ? ' is-open' : ''}`} onMouseDown={onSurfaceMouseDown}>
        <div className="hub-search-bar">
          <span className="hub-search-icon">{MAGNIFIER}</span>
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-label="Search genes and pathways across all studies"
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls={listId}
            aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
            placeholder="Search a gene or pathway — e.g. insulin, oxytocin, POMC"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(-1); }}
            onFocus={() => { setWanted(true); setOpen(true); }}
            // Clicking into a field that kept focus (after Escape or a search) reopens the list.
            onMouseDown={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
          />
          {query ? (
            <button type="button" className="hub-search-clear" aria-label="Clear search" onClick={clear}>
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          ) : (
            variant === 'hub' && <span className="hub-search-kbd" title="Press / to search" aria-hidden="true">/</span>
          )}
          <button type="submit" className="hub-search-go" aria-label="Search">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 8h10M8.5 3.5 13 8l-4.5 4.5" />
            </svg>
          </button>
        </div>
        <div id={listId} role="listbox" aria-label="Search suggestions" className="hub-search-suggest" hidden={!showList}>
          {showList && results && (
            <>
              {results.genes.length > 0 && (
                // biome-ignore lint/a11y/useSemanticElements: an option group inside a listbox; a fieldset is not allowed there
                <div role="group" aria-label="Genes" className="hub-search-group">
                  <div className="hub-search-group-label" aria-hidden="true">Genes</div>
                  {options.slice(0, nGenes).map((o, i) => renderOption(o, i))}
                </div>
              )}
              {results.pathways.length > 0 && (
                // biome-ignore lint/a11y/useSemanticElements: an option group inside a listbox; a fieldset is not allowed there
                <div role="group" aria-label="Pathways" className="hub-search-group">
                  <div className="hub-search-group-label" aria-hidden="true">Pathways</div>
                  {options.slice(nGenes).map((o, i) => renderOption(o, nGenes + i))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </form>
  );
}
