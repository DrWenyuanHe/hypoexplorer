// The library's two header rows, after Attio's record views: a view row (saved
// view, export, layout) and a filter row (sort, one chip per active facet, an
// "add filter" menu, search).
//
// It replaced a 224px facet rail. The rail listed every value of every facet
// all the time, which cost the table a quarter of the screen to show choices
// most visits never make; the chips show only the narrowing that is ACTIVE, and
// the menus still carry the per-value counts the rail did, computed the same way
// (disjunctive facet counts — see libraryFilters.facetCounts).
//
// Colour follows the app, not Attio: selection is the one orange, and chips are
// neutral, because a coloured chip would claim a meaning it does not have.

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { LibraryPopover } from './LibraryPopover';
import { DATASET_CATEGORIES, type DatasetCategory } from '../data/datasetCategories';
import { DATASET_THEMES, type DatasetTheme } from '../data/datasetThemes';
import { DATASET_PERTURBATIONS, DATASET_PREPARATIONS, DATASET_REGIONS } from '../data/datasetFacets';
import type { DatasetCard } from '../data/datasetCatalog';
import { FONT_MONO } from '../styles/constants';
import {
  SORT_LABELS, facetCounts, hasActiveFilters, minNCount, MIN_N_CHOICES,
  type FacetKey, type LibraryFilters, type LibrarySort,
} from './libraryFilters';

// Same fixed palette the landing hub cycles for its scope chips, indexed the
// same way, so a category is the same colour on both surfaces.
const CATEGORY_DOTS = ['#9C755F', '#4C78A8', '#59A14F', '#B07AA1', '#E45756'];
export const categoryColor = (category: string) =>
  CATEGORY_DOTS[Math.max(0, DATASET_CATEGORIES.indexOf(category as never)) % CATEGORY_DOTS.length];

// ── Icons ─────────────────────────────────────────────────────────────────────

const ICONS = {
  view: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  sort: 'M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4',
  filter: 'M4 5h16M7 12h10M10 19h4',
  plus: 'M12 5v14M5 12h14',
  chevron: 'm6 9 6 6 6-6',
  back: 'm15 18-6-6 6-6',
  x: 'M18 6 6 18M6 6l12 12',
  check: 'm5 13 4 4L19 7',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4-4',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  category: 'M4 6h16M4 12h16M4 18h10',
  region: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  perturbation: 'M13 2 4 14h7l-1 8 9-12h-7z',
  preparation: 'M9 3h6M10 3v6L5 19a1.5 1.5 0 0 0 1.3 2h11.4a1.5 1.5 0 0 0 1.3-2L14 9V3',
  power: 'M5 20V10M12 20V4M19 20v-7',
  table: 'M3 5h18v14H3zM3 10h18M9 10v9',
  cards: 'M3 4h8v7H3zM13 4h8v7h-8zM3 13h8v7H3zM13 13h8v7h-8z',
  hash: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
  layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z',
  contrast: 'M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4',
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 13, color = 'currentColor' }: { name: IconName; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d={ICONS[name]} />
    </svg>
  );
}

// ── Facets ────────────────────────────────────────────────────────────────────

interface FacetSpec {
  key: FacetKey | 'minN';
  title: string;
  icon: IconName;
}

/**
 * The facets on offer: the biology, then power. Quality is absent on purpose —
 * provenance is what you consult about a study you have already found, so it
 * lives in the record and the table's Validation column (and free-text search).
 */
const FACETS: FacetSpec[] = [
  { key: 'category', title: 'Category', icon: 'category' },
  { key: 'region', title: 'Region', icon: 'region' },
  { key: 'perturbation', title: 'Perturbation', icon: 'perturbation' },
  { key: 'preparation', title: 'Preparation', icon: 'preparation' },
  { key: 'minN', title: 'Replicates', icon: 'power' },
];

const FLAT_OPTIONS: Partial<Record<FacetKey, readonly string[]>> = {
  region: DATASET_REGIONS,
  perturbation: DATASET_PERTURBATIONS,
  preparation: DATASET_PREPARATIONS,
};

function selectedCount(filters: LibraryFilters, key: FacetSpec['key']): number {
  return key === 'minN' ? (filters.minN > 0 ? 1 : 0) : (filters[key] ?? []).length;
}

// ── Shared bits ───────────────────────────────────────────────────────────────

const chipBase = {
  display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px',
  border: '1px solid var(--border)', borderRadius: 7, background: 'var(--bg-panel)',
  color: 'var(--text-mono)', fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer',
  whiteSpace: 'nowrap' as const, flexShrink: 0,
};

const menuRow = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 30,
  padding: '5px 8px', border: 'none', borderRadius: 5, background: 'transparent',
  color: 'var(--text-mono)', fontSize: 12.5, fontFamily: 'inherit', textAlign: 'left' as const,
  cursor: 'pointer', lineHeight: 1.35,
};

const menuCount = { fontFamily: FONT_MONO, fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' as const };

const menuHeading = {
  fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const,
  color: 'var(--text-muted)', padding: '8px 8px 4px',
};

/** The tri-state box every menu row wears. `mixed` is a theme with some, but
 *  not all, of its categories ticked. */
function CheckBox({ on, mixed }: { on: boolean; mixed?: boolean }) {
  const filled = on || mixed;
  return (
    <span aria-hidden="true" style={{
      width: 14, height: 14, borderRadius: 4, flexShrink: 0,
      border: `1.5px solid ${filled ? 'var(--color-selected)' : 'var(--border-dark)'}`,
      background: filled ? 'var(--color-selected)' : 'var(--bg-panel)',
      display: 'grid', placeItems: 'center',
    }}>
      {on && <Icon name="check" size={10} color="#fff" />}
      {!on && mixed && <span style={{ width: 7, height: 2, borderRadius: 1, background: '#fff' }} />}
    </span>
  );
}

interface OptionRowProps {
  label: string;
  count: number;
  on: boolean;
  mixed?: boolean;
  dot?: string;
  heading?: boolean;
  indented?: boolean;
  onToggle: () => void;
}

/** One tickable value. Its accessible name is the label then the count, so
 *  tests and screen readers can find a value by the prefix it starts with. */
function OptionRow({ label, count, on, mixed, dot, heading, indented, onToggle }: OptionRowProps) {
  return (
    <button type="button" aria-pressed={on} onClick={onToggle} className="library-menu-row"
      style={{
        ...menuRow,
        paddingLeft: indented ? 30 : 8,
        color: count === 0 && !on ? 'var(--text-muted)' : 'var(--text-mono)',
        fontWeight: on || mixed || heading ? 600 : 400,
      }}>
      <CheckBox on={on} mixed={mixed} />
      {dot && <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: dot }} />}
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      <span style={menuCount}>{count}</span>
    </button>
  );
}

// ── The per-facet option lists ────────────────────────────────────────────────

interface FacetOptionsProps {
  facet: FacetSpec;
  all: DatasetCard[];
  filters: LibraryFilters;
  onToggle: (key: FacetKey, value: string) => void;
  onToggleTheme: (categories: readonly DatasetCategory[]) => void;
  onMinN: (n: number) => void;
}

function FacetOptions({ facet, all, filters, onToggle, onToggleTheme, onMinN }: FacetOptionsProps) {
  if (facet.key === 'minN') {
    // One floor at a time, so these are radios: "n ≥ 4" and "n ≥ 6" together can
    // only mean the higher, and a tickable pair that silently collapses to one is
    // a lie about what the control does. Clicking the live rung clears it.
    return (
      <div role="radiogroup" aria-label="Minimum replicates in both arms">
        {MIN_N_CHOICES.map((n) => {
          const on = filters.minN === n;
          return (
            // biome-ignore lint/a11y/useSemanticElements: an <input type="radio"> cannot carry the label/count row; the rung is keyboard-operable as a button with role + aria-checked
            <button key={n} type="button" role="radio" aria-checked={on} onClick={() => onMinN(n)}
              className="library-menu-row"
              title="Studies whose replicate counts are unmeasured are excluded while a floor is on."
              style={{ ...menuRow, fontWeight: on ? 600 : 400 }}>
              <span aria-hidden="true" style={{
                width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                border: `1.5px solid ${on ? 'var(--color-selected)' : 'var(--border-dark)'}`,
                display: 'grid', placeItems: 'center',
              }}>
                {on && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--color-selected)' }} />}
              </span>
              <span style={{ flex: 1 }}>n ≥ {n} in both arms</span>
              <span style={menuCount}>{minNCount(all, filters, n)}</span>
            </button>
          );
        })}
      </div>
    );
  }

  const key = facet.key;
  const counts = facetCounts(all, filters, key);
  const selected = filters[key] ?? [];

  if (key === 'category') {
    // Grouped into browse themes (see datasetThemes). A theme holding a single
    // category collapses to that category's own row.
    return (
      <>
        {DATASET_THEMES.map((theme) => {
          const total = theme.categories.reduce((n, c) => n + (counts[c] ?? 0), 0);
          const chosen = theme.categories.filter((c) => selected.includes(c));
          if (theme.categories.length === 1) {
            const only = theme.categories[0];
            return (
              <OptionRow key={theme.id} label={only} count={counts[only] ?? 0}
                on={chosen.length === 1} dot={categoryColor(only)}
                onToggle={() => onToggle('category', only)} />
            );
          }
          return (
            <div key={theme.id}>
              <OptionRow label={theme.title} count={total} heading
                on={chosen.length === theme.categories.length}
                mixed={chosen.length > 0 && chosen.length < theme.categories.length}
                onToggle={() => onToggleTheme(theme.categories)} />
              {theme.categories.map((category) => (
                <OptionRow key={category} label={category} count={counts[category] ?? 0}
                  on={selected.includes(category)} dot={categoryColor(category)} indented
                  onToggle={() => onToggle('category', category)} />
              ))}
            </div>
          );
        })}
      </>
    );
  }

  return (
    <>
      {(FLAT_OPTIONS[key] ?? []).map((option) => (
        <OptionRow key={option} label={option} count={counts[option] ?? 0}
          on={selected.includes(option)} onToggle={() => onToggle(key, option)} />
      ))}
    </>
  );
}

// ── Chips ─────────────────────────────────────────────────────────────────────

/** What an active facet chip says after its name: the value when there is one,
 *  the first value and how many more otherwise. */
function chipValue(filters: LibraryFilters, key: FacetSpec['key']): string {
  if (key === 'minN') return `n ≥ ${filters.minN} in both arms`;
  const values = filters[key] ?? [];
  return values.length === 1 ? values[0] : `${values[0]}, +${values.length - 1}`;
}

function FilterChip({ facet, filters, onOpen, onClear, anchorRef }: {
  facet: FacetSpec; filters: LibraryFilters;
  onOpen: () => void; onClear: () => void;
  anchorRef: React.RefObject<HTMLButtonElement>;
}) {
  const n = selectedCount(filters, facet.key);
  return (
    <span style={{ ...chipBase, padding: 0, gap: 0, cursor: 'default', overflow: 'hidden' }}>
      <button ref={anchorRef} type="button" onClick={onOpen} aria-haspopup="dialog"
        aria-label={`${facet.title}, ${n} selected`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, height: '100%', padding: '0 9px',
          border: 'none', background: 'transparent', font: 'inherit', color: 'inherit', cursor: 'pointer',
        }}>
        <Icon name={facet.icon} color="var(--text-muted)" />
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{facet.title}</span>
        <span style={{ color: 'var(--text-muted)' }}>is</span>
        <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{chipValue(filters, facet.key)}</span>
      </button>
      <button type="button" onClick={onClear} aria-label={`Remove ${facet.title} filter`}
        style={{
          alignSelf: 'stretch', display: 'grid', placeItems: 'center', width: 26,
          border: 'none', borderLeft: '1px solid var(--border)', background: 'transparent',
          color: 'var(--text-muted)', cursor: 'pointer',
        }}>
        <Icon name="x" size={12} />
      </button>
    </span>
  );
}

// ── Views ─────────────────────────────────────────────────────────────────────

/** The theme whose category set equals the current one, if any. */
function activeTheme(categories: readonly string[]): DatasetTheme | null {
  if (!categories.length) return null;
  return DATASET_THEMES.find((t) => (
    t.categories.length === categories.length && t.categories.every((c) => categories.includes(c))
  )) ?? null;
}

// ── The two rows ──────────────────────────────────────────────────────────────

type Menu =
  | { kind: 'view' }
  | { kind: 'sort' }
  | { kind: 'add'; facet: FacetSpec | null }
  | { kind: 'chip'; facet: FacetSpec };

interface LibraryToolbarProps {
  all: DatasetCard[];
  visibleCount: number;
  filters: LibraryFilters;
  setFilters: React.Dispatch<React.SetStateAction<LibraryFilters>>;
  onToggleFacet: (key: FacetKey, value: string) => void;
  onToggleTheme: (categories: readonly DatasetCategory[]) => void;
  onReset: () => void;
  sort: LibrarySort;
  onSort: (sort: LibrarySort) => void;
  view: 'cards' | 'table';
  onView: (view: 'cards' | 'table') => void;
  onExport: () => void;
}

export function LibraryToolbar({
  all, visibleCount, filters, setFilters, onToggleFacet, onToggleTheme, onReset,
  sort, onSort, view, onView, onExport,
}: LibraryToolbarProps) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [viewQuery, setViewQuery] = useState('');
  const close = useCallback(() => setMenu(null), []);

  const viewRef = useRef<HTMLButtonElement>(null);
  const sortRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  // One ref per facet so a chip's menu opens under that chip.
  const chipRefs = {
    category: useRef<HTMLButtonElement>(null),
    region: useRef<HTMLButtonElement>(null),
    perturbation: useRef<HTMLButtonElement>(null),
    preparation: useRef<HTMLButtonElement>(null),
    minN: useRef<HTMLButtonElement>(null),
  } as Record<FacetSpec['key'], React.RefObject<HTMLButtonElement>>;

  const onMinN = useCallback(
    (n: number) => setFilters((f) => ({ ...f, minN: f.minN === n ? 0 : n })),
    [setFilters],
  );
  const clearFacet = (key: FacetSpec['key']) => {
    setFilters((f) => (key === 'minN' ? { ...f, minN: 0 } : { ...f, [key]: [] }));
    setMenu(null);
  };

  const theme = activeTheme(filters.category);
  const viewLabel = !filters.category.length
    ? 'All studies'
    : theme ? theme.title
      : filters.category.length === 1 ? filters.category[0] : `${filters.category.length} categories`;

  // Views count the whole corpus, not the filtered one: a view is a place, and
  // its size should not change because of a chip set somewhere else.
  const themeSize = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of DATASET_THEMES) out[t.id] = all.filter((c) => t.categories.includes(c.dataset.category)).length;
    return out;
  }, [all]);
  const views = DATASET_THEMES.filter((t) => t.title.toLowerCase().includes(viewQuery.trim().toLowerCase()));

  const active = FACETS.filter((f) => selectedCount(filters, f.key) > 0);
  const filtering = hasActiveFilters(filters);

  const optionProps = { all, filters, onToggle: onToggleFacet, onToggleTheme, onMinN };

  return (
    <>
      {/* ── View row ─────────────────────────────────────────────────────── */}
      <div className="library-viewbar">
        <button ref={viewRef} type="button" aria-haspopup="dialog" aria-expanded={menu?.kind === 'view'}
          onClick={() => { setViewQuery(''); setMenu(menu?.kind === 'view' ? null : { kind: 'view' }); }}
          style={{ ...chipBase, height: 32, fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 }}>
          <Icon name="view" color="var(--accent)" />
          <span style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>{viewLabel}</span>
          <Icon name="chevron" size={12} color="var(--text-muted)" />
        </button>

        <span className="library-viewbar-spacer" />

        <button type="button" onClick={onExport} style={{ ...chipBase, height: 32 }} aria-label="Export CSV"
          title="Download the studies in this view, as shown, as a CSV file">
          <Icon name="download" color="var(--text-muted)" />
          <span className="library-hide-compact">Export CSV</span>
        </button>

        <fieldset className="library-layout-toggle">
          <legend className="visually-hidden-legend">Result layout</legend>
          {(['table', 'cards'] as const).map((mode) => (
            <button key={mode} type="button" onClick={() => onView(mode)} aria-pressed={view === mode}
              aria-label={mode === 'table' ? 'Table' : 'Cards'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 11px',
                border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5,
                background: view === mode ? 'var(--bg-panel)' : 'transparent',
                boxShadow: view === mode ? '0 1px 2px rgba(15, 22, 28, 0.08), 0 0 0 1px var(--border)' : undefined,
                color: view === mode ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: view === mode ? 600 : 400,
              }}>
              <Icon name={mode === 'table' ? 'table' : 'cards'} />
              <span className="library-hide-narrow">{mode === 'table' ? 'Table' : 'Cards'}</span>
            </button>
          ))}
        </fieldset>
      </div>

      {/* ── Filter row ───────────────────────────────────────────────────── */}
      <section aria-label="Filter datasets" className="library-filterbar">
        <div className="library-chips">
          <button ref={sortRef} type="button" aria-haspopup="dialog" aria-expanded={menu?.kind === 'sort'}
            onClick={() => setMenu(menu?.kind === 'sort' ? null : { kind: 'sort' })}
            style={chipBase}>
            <Icon name="sort" color="var(--text-muted)" />
            <span style={{ color: 'var(--text-muted)' }}>Sorted by</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{SORT_LABELS[sort].replace(/ \(.*\)$/, '')}</span>
          </button>

          <span aria-hidden="true" style={{ width: 1, height: 18, background: 'var(--border)', flexShrink: 0 }} />

          {active.map((facet) => (
            <FilterChip key={facet.key} facet={facet} filters={filters} anchorRef={chipRefs[facet.key]}
              onOpen={() => setMenu(menu?.kind === 'chip' && menu.facet.key === facet.key ? null : { kind: 'chip', facet })}
              onClear={() => clearFacet(facet.key)} />
          ))}

          <button ref={addRef} type="button" aria-haspopup="dialog" aria-expanded={menu?.kind === 'add'}
            onClick={() => setMenu(menu?.kind === 'add' ? null : { kind: 'add', facet: null })}
            style={{ ...chipBase, borderStyle: 'dashed', color: 'var(--text-muted)' }}>
            <Icon name={active.length ? 'plus' : 'filter'} />
            {active.length ? 'Add filter' : 'Filter'}
          </button>

          {filtering && (
            <button type="button" onClick={onReset}
              style={{
                border: 'none', background: 'none', padding: '0 4px', cursor: 'pointer', flexShrink: 0,
                fontFamily: 'inherit', fontSize: 12.5, color: 'var(--accent)', whiteSpace: 'nowrap',
              }}>
              Clear filters
            </button>
          )}
        </div>

        <div className="library-search">
          <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', display: 'flex' }}>
            <Icon name="search" color="var(--text-muted)" />
          </span>
          <input type="search" aria-label="Search datasets" placeholder="Search studies, accessions, arms…"
            value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            style={{
              width: '100%', height: 30, padding: '0 10px 0 29px', fontSize: 12.5, fontFamily: 'inherit',
              border: '1px solid var(--border)', borderRadius: 7,
              background: 'var(--bg-panel)', color: 'var(--text-primary)',
            }} />
        </div>

        <span className="library-count" style={{
          fontFamily: FONT_MONO, fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {`${visibleCount} of ${all.length} studies`}
        </span>

        {/* ── Menus. Inside the section, so they belong to its landmark. ── */}
        {menu?.kind === 'view' && (
          <LibraryPopover anchorRef={viewRef} onClose={close} label="Views" width={300}>
            <input type="search" aria-label="Search views" placeholder="Search views…" value={viewQuery}
              onChange={(e) => setViewQuery(e.target.value)}
              style={{
                width: '100%', height: 32, padding: '0 8px', marginBottom: 4, fontSize: 12.5,
                fontFamily: 'inherit', border: 'none', borderBottom: '1px solid var(--border)',
                background: 'transparent', color: 'var(--text-primary)', outline: 'none',
              }} />
            <ViewRow label="All studies" count={all.length} on={!filters.category.length}
              onPick={() => { setFilters((f) => ({ ...f, category: [] })); close(); }} />
            {views.map((t) => (
              <ViewRow key={t.id} label={t.title} count={themeSize[t.id]} on={theme?.id === t.id}
                dot={t.categories.length === 1 ? categoryColor(t.categories[0]) : undefined}
                onPick={() => { setFilters((f) => ({ ...f, category: [...t.categories] })); close(); }} />
            ))}
          </LibraryPopover>
        )}

        {menu?.kind === 'sort' && (
          <LibraryPopover anchorRef={sortRef} onClose={close} label="Sort studies" width={240}>
            <div role="radiogroup" aria-label="Sort studies by">
              {(Object.keys(SORT_LABELS) as LibrarySort[]).map((k) => (
                // biome-ignore lint/a11y/useSemanticElements: the rung is a styled row; role + aria-checked keep it a radio to assistive tech
                <button key={k} type="button" role="radio" aria-checked={sort === k}
                  className="library-menu-row"
                  onClick={() => { onSort(k); close(); }}
                  style={{ ...menuRow, fontWeight: sort === k ? 600 : 400 }}>
                  <span style={{ width: 14, display: 'flex' }}>
                    {sort === k && <Icon name="check" color="var(--color-selected)" />}
                  </span>
                  {SORT_LABELS[k]}
                </button>
              ))}
            </div>
          </LibraryPopover>
        )}

        {menu?.kind === 'add' && (
          <LibraryPopover anchorRef={addRef} onClose={close}
            label={menu.facet ? `Filter by ${menu.facet.title}` : 'Add filter'} width={320}>
            {menu.facet
              ? <>
                  <button type="button" className="library-menu-row" onClick={() => setMenu({ kind: 'add', facet: null })}
                    style={{ ...menuRow, color: 'var(--text-muted)' }}>
                    <Icon name="back" />
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{menu.facet.title}</span>
                  </button>
                  <div style={{ height: 1, background: 'var(--border)', margin: '4px -4px' }} />
                  <FacetOptions facet={menu.facet} {...optionProps} />
                </>
              : <>
                  <div style={menuHeading}>Filter by</div>
                  {FACETS.map((facet) => (
                    <button key={facet.key} type="button" className="library-menu-row"
                      onClick={() => setMenu({ kind: 'add', facet })} style={menuRow}>
                      <Icon name={facet.icon} color="var(--text-muted)" />
                      <span style={{ flex: 1 }}>{facet.title}</span>
                      {selectedCount(filters, facet.key) > 0 && (
                        <span style={{ ...menuCount, color: 'var(--color-selected)', fontWeight: 600 }}>
                          {selectedCount(filters, facet.key)}
                        </span>
                      )}
                    </button>
                  ))}
                </>}
          </LibraryPopover>
        )}

        {menu?.kind === 'chip' && (
          <LibraryPopover anchorRef={chipRefs[menu.facet.key]} onClose={close}
            label={`Filter by ${menu.facet.title}`} width={320}>
            <FacetOptions facet={menu.facet} {...optionProps} />
          </LibraryPopover>
        )}
      </section>
    </>
  );
}

function ViewRow({ label, count, on, dot, onPick }: {
  label: string; count: number; on: boolean; dot?: string; onPick: () => void;
}): ReactNode {
  return (
    <button type="button" aria-pressed={on} onClick={onPick} className="library-menu-row"
      style={{ ...menuRow, fontWeight: on ? 600 : 400, color: on ? 'var(--text-primary)' : 'var(--text-mono)' }}>
      {dot
        ? <span aria-hidden="true" style={{ width: 7, height: 7, margin: '0 3px', borderRadius: '50%', flexShrink: 0, background: dot }} />
        : <Icon name="view" color="var(--text-muted)" />}
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      <span style={menuCount}>{count}</span>
      <span style={{ width: 14, display: 'flex' }}>{on && <Icon name="check" color="var(--color-selected)" />}</span>
    </button>
  );
}
