// The dataset library: the corpus as a place you can browse.
//
// Replaces the explorer topbar's 42-option <select>, which asked the user to
// pick a study from a list of names with no replicate counts, no design, no
// region, and no way to narrow. Every card here leads with the thing that
// decides whether a study is worth opening — its arms and their N — and the
// facets are the biology (region, what was perturbed, how the library was
// prepared) rather than the file layout.
//
// SELECTION IS NOT COMMITMENT
// ---------------------------
// Clicking a study opens its record page (StudyRecord) and touches nothing else.
// Only "Open in explorer" navigates, because entering a dataset eagerly loads a
// track bundle and resets the explorer's per-track state — that is a real cost
// and it must be the user's explicit act, not a side effect of looking.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageShell } from '../common/PageShell';
import { AuthorValidationBadge, AuthorEvidenceLabel } from '../common/AuthorValidation';
import { ArmPills } from '../common/StudyMetadata';
import { ResultBars, ResultScaleLegend, discoveryScaleMax } from './ResultBars';
import { loadDatasetCatalog, registryCards, type CatalogState, type DatasetCard } from '../data/datasetCatalog';
import type { DatasetCategory } from '../data/datasetCategories';
import { COLOR_WARNING_BG, COLOR_WARNING_TEXT, FONT_MONO } from '../styles/constants';
import { DEFAULT_FDR_CUTOFF } from '../statistics/policy';
import { CompareSetButton } from '../compareset/CompareSetButton';
import { CompareSetToggle } from '../compareset/CompareSetToggle';
import {
  compareSetKey, toggleItem, useCompareSet, type CompareSetAddResult, type CompareSetItem,
} from '../compareset/compareSetStore';
import type { Dataset } from '../types';
import {
  EMPTY_FILTERS, filterCards, groupByCategory, sortCards,
  type FacetKey, type LibraryFilters, type LibrarySort,
} from './libraryFilters';
import { LibraryToolbar, categoryColor, Icon, type IconName } from './LibraryToolbar';
import { downloadCsv, libraryCsv } from './libraryExport';
import { StudyRecord } from './StudyRecord';

/**
 * A category list flattened to one string, for comparing lists by value.
 *
 * NOT joined with a comma. 'Leptin, insulin & energy signaling' contains one,
 * so a comma-joined key cannot be split back into the list it came from — it
 * yields 'Leptin' and ' insulin & energy signaling' as separate categories,
 * neither of which matches anything. (appLinks hits the same name and escapes
 * its way around it; here there is no encoding step, so the separator itself has
 * to be one no category name can contain.)
 */
const scopeKey = (categories: readonly string[] | null | undefined) => (categories ?? []).join('\u0000');
const fromScopeKey = (key: string) => (key ? key.split('\u0000') : []);


/** What "add this study" means here: the study at its default track. */
const defaultItem = (d: Dataset): CompareSetItem => ({ datasetId: d.id, trackId: d.defaultTrack });

const eyebrow = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const,
  color: 'var(--text-muted)',
};


interface DatasetLibraryProps {
  onHome: () => void;
  /** Commit: open this dataset in the explorer at its default track. */
  onOpenInExplorer: (datasetId: string) => void;
  onOpenTracker?: (acc: string) => void;
  /**
   * The header indicator's "Compare N →": open the compare-set view on the
   * set's columns. Adding TO the set is the library's own affair — it is as
   * cheap as selecting, and touches nothing (see the header comment).
   */
  onCompareSet: (items: readonly CompareSetItem[]) => void;
  /** Open with one study's record already showing (a `#/library/<id>` link). */
  initialSelectedId?: string | null;
  /**
   * Which record is showing, reported back as it changes.
   *
   * The selection stays local state — it is the library's own affair — but the
   * URL names it, so it has to be observable. Without this, arriving on
   * `#/library/<id>` and then clicking a different study would leave the address
   * bar pointing at the study you are no longer looking at: a link that is
   * wrong is worse than a link that is vague.
   */
  onSelectedIdChange?: (datasetId: string | null) => void;
  /** Open with the rail already narrowed (a `#/library/in/<cats>` link). */
  initialCategories?: readonly DatasetCategory[] | null;
  /**
   * Which categories are ticked, reported back as they change.
   *
   * Only this facet is reported, because only this one is in the URL — see
   * libraryHref. Arriving scoped and then unticking has to shorten the address
   * bar, or the link would keep claiming a narrowing that is no longer on
   * screen; the same reason `onSelectedIdChange` exists.
   */
  onCategoriesChange?: (categories: DatasetCategory[]) => void;
}

export function DatasetLibrary({
  onHome, onOpenInExplorer, onOpenTracker, onCompareSet, initialSelectedId = null, onSelectedIdChange,
  initialCategories = null, onCategoriesChange,
}: DatasetLibraryProps) {
  // Seeded from the registry so the library is usable on the first frame; the
  // catalog then upgrades the cards in place with the measured numbers.
  const [cards, setCards] = useState<DatasetCard[]>(registryCards);
  const [state, setState] = useState<CatalogState>('loading');
  const [filters, setFilters] = useState<LibraryFilters>(
    () => (initialCategories?.length ? { ...EMPTY_FILTERS, category: [...initialCategories] } : EMPTY_FILTERS),
  );
  const [sort, setSort] = useState<LibrarySort>('category');
  // Table first, as in a record view: 161 rows scan faster down a column than
  // across a grid of cards. Cards stay one click away for the result bars.
  const [view, setView] = useState<'cards' | 'table'>('table');
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  // Whether the reader has asked to see a record's volcano in this visit. Off
  // until they do, so opening a record downloads nothing; once on, records they
  // step to draw theirs too.
  const [volcanoWanted, setVolcanoWanted] = useState(false);
  const wantVolcano = useCallback(() => setVolcanoWanted(true), []);

  // The compare set, subscribed ONCE for the whole grid. The library renders
  // every card (the mount is already O(corpus) — see TODOS), so each card is
  // handed a boolean rather than a subscription of its own. A study joins the
  // set at its default track; the explorer topbar is where a specific
  // population is picked.
  const compareSet = useCompareSet();
  const inCompareSet = useMemo(() => new Set(compareSet.map(compareSetKey)), [compareSet]);
  const isInSet = useCallback((d: Dataset) => inCompareSet.has(compareSetKey(defaultItem(d))), [inCompareSet]);
  const toggleCompare = useCallback((d: Dataset) => toggleItem(defaultItem(d)), []);

  // Every selection goes through here so the URL cannot miss one — the three
  // call sites (table row, card, record back and step) are easy to grow a fourth of.
  const resultsRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);
  const selectStudy = useCallback((id: string | null) => {
    // Read the list's offset while it is still laid out; once the record shows,
    // the list is display:none and reports 0.
    if (id && resultsRef.current && resultsRef.current.offsetParent !== null) {
      savedScroll.current = resultsRef.current.scrollTop;
    }
    setSelectedId(id);
    onSelectedIdChange?.(id);
  }, [onSelectedIdChange]);

  useEffect(() => {
    let alive = true;
    loadDatasetCatalog().then((catalog) => {
      if (!alive) return;
      setCards(catalog.cards);
      setState(catalog.state);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => { setSelectedId(initialSelectedId); }, [initialSelectedId]);

  // ── Keeping the rail and the URL in step ──────────────────────────────────
  //
  // The category facet is the one piece of rail state the URL names, so it moves
  // in both directions. Both are keyed on the joined names rather than on the
  // array, because a re-render that rebuilds an equal array is not a change.

  /** The scope last agreed on with the router, in either direction. */
  const agreedScope = useRef(scopeKey(initialCategories));

  // IN: Back/Forward, or a freshly pasted link. Touches ONLY the category facet
  // — the rest of the rail is not in the URL, so a route change says nothing
  // about it and must not clear it.
  const incomingScope = scopeKey(initialCategories);
  useEffect(() => {
    agreedScope.current = incomingScope;
    setFilters((f) => ({ ...f, category: fromScopeKey(incomingScope) }));
  }, [incomingScope]);

  // OUT: the user working the rail. From an effect rather than from the toggle
  // handlers, because those compute the next value inside a setState updater,
  // and an updater that calls the parent's setState is a side effect in code
  // React is free to run twice.
  useEffect(() => {
    const key = scopeKey(filters.category);
    if (agreedScope.current === key) return;
    agreedScope.current = key;
    onCategoriesChange?.(filters.category as DatasetCategory[]);
  }, [filters.category, onCategoriesChange]);

  const all = cards;
  const missingCount = useMemo(() => all.filter((c) => c.trackCount == null).length, [all]);
  const visible = useMemo(() => sortCards(filterCards(all, filters), sort), [all, filters, sort]);
  // Over the WHOLE corpus, not `visible`: a bar that grew when you ticked a
  // facet would be comparing each study against whatever else is on screen.
  const scaleMax = useMemo(() => discoveryScaleMax(all), [all]);
  const selected = useMemo(
    () => (selectedId ? all.find((c) => c.dataset.id === selectedId) ?? null : null),
    [all, selectedId],
  );
  // -1 when the record is not in the current results (a pasted link to a study
  // the filters exclude): the record still opens, it just has no neighbours.
  const selectedIndex = selected ? visible.indexOf(selected) : -1;

  // ── Leaving the list for a record and coming back ─────────────────────────
  //
  // The list stays mounted (hidden) while a record shows, so its filters and
  // layout survive. Its scroll offset does not survive display:none, so it is
  // kept here, and focus goes back to the study the reader left from — or, after
  // stepping through records, to the one they ended on.
  const lastRecord = useRef<string | null>(null);
  useEffect(() => {
    if (selectedId) {
      lastRecord.current = selectedId;
      return;
    }
    const returning = lastRecord.current;
    lastRecord.current = null;
    if (!returning || !resultsRef.current) return;
    resultsRef.current.scrollTop = savedScroll.current;
    resultsRef.current.querySelector<HTMLElement>(`[data-study-id="${CSS.escape(returning)}"]`)?.focus();
  }, [selectedId]);

  const toggleFacet = useCallback((key: FacetKey, value: string) => {
    setFilters((f) => {
      const current = f[key] ?? [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...f, [key]: next };
    });
  }, []);

  /** Tick or untick a whole theme — every category under it, in one act. */
  const toggleTheme = useCallback((categories: readonly DatasetCategory[]) => {
    setFilters((f) => {
      const all = categories.every((c) => f.category.includes(c));
      return {
        ...f,
        category: all
          ? f.category.filter((c) => !categories.includes(c as DatasetCategory))
          : [...f.category, ...categories.filter((c) => !f.category.includes(c))],
      };
    });
  }, []);

  const resetFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

  const exportView = useCallback(() => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`hypoexplorer-studies-${stamp}.csv`, libraryCsv(visible));
  }, [visible]);

  return (
    <PageShell
      onHome={onHome}
      breadcrumbs={selected
        ? [
            {
              label: (
                <button type="button" onClick={() => selectStudy(null)} className="crumb-link">
                  Dataset library
                </button>
              ),
            },
            { label: selected.dataset.name, current: true, maxWidth: 'min(420px, 40vw)' },
          ]
        : [{ label: 'Dataset library', current: true }]}
      // The toolbar and the results share one column; the results scroll inside
      // it, which only works if <main> has a real height — see PageShell#fill.
      fill
      mainClassName="library-main"
      mainStyle={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}
      headerRight={<CompareSetButton onCompare={onCompareSet} />}
    >
      <div hidden={selected != null} style={{ flex: 1, display: selected ? 'none' : 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <LibraryToolbar
          all={all} visibleCount={visible.length}
          filters={filters} setFilters={setFilters}
          onToggleFacet={toggleFacet} onToggleTheme={toggleTheme} onReset={resetFilters}
          sort={sort} onSort={setSort} view={view} onView={setView} onExport={exportView}
        />

        {/* Say which kind of gap it is. A dash on a card is ambiguous on its own —
            it could mean "this study has no replicates", which is never true —
            so whenever any number is missing the reason is stated once, here. */}
        {(state === 'registry-only' || state === 'partial') && (
          <div style={{
            flexShrink: 0, padding: '7px 20px', background: COLOR_WARNING_BG,
            borderBottom: '1px solid rgba(217, 119, 6, 0.34)', fontSize: 12, color: COLOR_WARNING_TEXT,
          }}>
            {state === 'registry-only'
              ? 'Replicate and feature counts are unavailable because the catalog is missing or uses a different data version. You can still open each study.'
              : `${missingCount} of ${all.length} studies have no counts because the published catalog is older than this version. You can still open those studies.`}
          </div>
        )}

        <div ref={resultsRef} className="library-results" style={{ flex: 1, overflowY: 'auto', minHeight: 0, background: 'var(--bg-app)' }}>
          {visible.length === 0 ? (
            <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No studies match these filters.{' '}
              <button type="button" onClick={resetFilters}
                style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, textDecoration: 'underline' }}>
                Clear filters
              </button>
            </div>
          ) : view === 'table' ? (
            <LibraryTable cards={visible} selectedId={selectedId} onSelect={selectStudy}
              isInSet={isInSet} onToggleCompare={toggleCompare} />
          ) : (
            <div className="library-cards" style={{ padding: '14px 20px 28px' }}>
              {(sort === 'category' ? groupByCategory(visible) : [{ category: '', cards: visible }])
                .map((group) => (
                  <section key={group.category || 'all'} style={{ marginBottom: 20 }}>
                    {group.category && (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 9px',
                        ...eyebrow,
                      }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: categoryColor(group.category) }} />
                        <span>{group.category}</span>
                        <span style={{ fontFamily: FONT_MONO, fontWeight: 500, letterSpacing: 0 }}>{group.cards.length}</span>
                      </div>
                    )}
                    <div className="library-grid">
                      {group.cards.map((card) => (
                        <StudyCard key={card.dataset.id} card={card} scaleMax={scaleMax}
                          selected={card.dataset.id === selectedId}
                          inSet={isInSet(card.dataset)}
                          onSelect={() => selectStudy(card.dataset.id)}
                          onToggleCompare={() => toggleCompare(card.dataset)} />
                      ))}
                    </div>
                  </section>
                ))}
              {visible.some((c) => c.discoveries) && <ResultScaleLegend scaleMax={scaleMax} />}
            </div>
          )}
        </div>
      </div>

      {selected && (
        <StudyRecord
          card={selected}
          position={selectedIndex >= 0 ? { index: selectedIndex, total: visible.length } : null}
          onStep={(delta) => {
            const next = visible[selectedIndex + delta];
            if (next) selectStudy(next.dataset.id);
          }}
          onBack={() => selectStudy(null)}
          onOpen={() => onOpenInExplorer(selected.dataset.id)}
          onOpenTracker={onOpenTracker}
          inSet={isInSet(selected.dataset)}
          onToggleCompare={() => toggleCompare(selected.dataset)}
          volcanoWanted={volcanoWanted}
          onWantVolcano={wantVolcano}
        />
      )}
    </PageShell>
  );
}

// ── Card ──────────────────────────────────────────────────────────

/**
 * The design's N, demoted.
 *
 * It used to be the card's emphasised row. Counted across the corpus it earns
 * the corner and not much more: the two largest studies here (23v22, 18v18)
 * return one and two significant genes while a 3v4 translatome returns 491, so
 * N is context for the result bars rather than a stand-in for them. The two arm
 * dots keep the colours doing the labelling, so "3v4" reads without the words.
 */
function ArmCorner({ card }: { card: DatasetCard }) {
  const { baselineGroup, caseGroup, nBaseline, nCase } = card;
  if (!baselineGroup || !caseGroup || nBaseline == null || nCase == null) return null;
  const dot = (color: string) => (
    <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: color, flex: '0 0 auto' }} />
  );
  return (
    <span
      title={`${nBaseline} ${baselineGroup.label} vs ${nCase} ${caseGroup.label}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'help',
        fontFamily: FONT_MONO, fontVariantNumeric: 'tabular-nums', fontSize: 10,
        color: 'var(--text-mono)', whiteSpace: 'nowrap',
      }}
    >
      {dot(baselineGroup.color)}{nBaseline}
      <span style={{ color: 'var(--text-muted)', padding: '0 1px' }}>v</span>
      {nCase}{dot(caseGroup.color)}
      {card.nVaries && (
        <span title={`Counts vary across this study's ${card.dataset.trackNoun || 'track'}s`}
          style={{ color: COLOR_WARNING_TEXT }}>*</span>
      )}
    </span>
  );
}

/**
 * Preparation, then what there is to browse. One quiet mono line.
 *
 * A MULTI-TRACK study trades the preparation for how many of its tracks found
 * anything, because the bars above can only speak for the default one. The
 * macaque card reads 0 genes because POMC finds none, while 20 of its 60
 * populations do; without this the card understates the dataset by a factor of
 * twenty and looks like a dead end.
 */
function footMeta(card: DatasetCard): string {
  const d = card.dataset;
  const noun = d.trackNoun || 'track';
  const many = card.trackCount != null && card.trackCount > 1;
  if (many && card.discoveries) {
    return `${card.trackCount} ${noun}s · ${card.discoveries.tracksWithGenes} with DE`;
  }
  const tail = d.timeSeries
    ? 'time course'
    : card.trackCount == null
      ? null
      : card.trackCount === 1 ? `1 ${noun}` : `${card.trackCount} ${noun}s`;
  return tail ? `${d.preparation} · ${tail}` : d.preparation;
}

// A container holding THREE kinds of control, not one big button: the card's
// face opens the record, the compare toggle in its footer adds the study to the
// compare set, and each result bar opens its own detail panel. A button cannot
// contain a button, so none of them sit inside the face — which is also what
// freed the title from the padding-right that used to dodge a floating compare
// button.
function StudyCard({ card, selected, inSet, scaleMax, onSelect, onToggleCompare }: {
  card: DatasetCard; selected: boolean; inSet: boolean; scaleMax: number;
  onSelect: () => void; onToggleCompare: () => CompareSetAddResult;
}) {
  const d = card.dataset;
  return (
    <div style={{
      position: 'relative', display: 'flex', flexDirection: 'column', width: '100%',
      background: 'var(--bg-panel)', borderRadius: 6,
      border: `1px solid ${selected ? 'var(--color-selected)' : 'var(--border)'}`,
      boxShadow: selected ? '0 0 0 2px color-mix(in srgb, var(--color-selected) 22%, transparent)' : undefined,
    }}>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        data-study-id={d.id}
        style={{
          appearance: 'none', textAlign: 'left', width: '100%', fontFamily: 'inherit',
          cursor: 'pointer', background: 'transparent', border: 0, borderRadius: '6px 6px 0 0',
          display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px 0',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          {/* Two lines whatever the title, so a row of the grid lines up. */}
          <span style={{
            fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.32,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden', minHeight: 34,
          }}>
            {d.name}
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flex: '0 0 auto', paddingTop: 2 }}>
            {d.geo && (
              <span style={{
                fontFamily: FONT_MONO, fontVariantNumeric: 'tabular-nums', fontSize: 10.5,
                color: 'var(--text-muted)', whiteSpace: 'nowrap',
              }}>{d.geo}</span>
            )}
            <ArmCorner card={card} />
          </span>
        </span>

        <span style={{
          fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          <span style={{ fontStyle: 'italic' }}>{d.organism}</span>
          <span style={{ padding: '0 5px', opacity: 0.55 }} aria-hidden="true">·</span>
          {d.region}
        </span>
      </button>

      {/* Outside the face button, because each bar is itself a control. */}
      <div style={{ padding: '8px 14px 12px' }}>
        {card.discoveries
          ? <ResultBars dataset={d} discoveries={card.discoveries} scaleMax={scaleMax}
              trackNoun={d.trackNoun || 'track'} />
          : (
            // No counts in this index. Fall back to the design rather than to
            // empty bars: a card with nothing on it would read as a study with
            // nothing in it.
            <ArmPills
              baseline={card.baselineGroup} caseGroup={card.caseGroup}
              nBaseline={card.nBaseline} nCase={card.nCase}
              nVaries={card.nVaries} trackNoun={d.trackNoun || 'track'} size="sm"
            />
          )}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        padding: '6px 8px 6px 14px', borderTop: '1px solid var(--border)', minHeight: 32,
      }}>
        <span style={{
          fontFamily: FONT_MONO, fontSize: 10, color: 'var(--text-muted)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
        }}>
          {footMeta(card)}
        </span>
        <CompareSetToggle size="sm" inSet={inSet} name={d.name} onToggle={onToggleCompare} />
      </div>
    </div>
  );
}

// ── Table ───────────────────────────────────────────────────────────────────
//
// A record grid, after Attio's: hairline rules on every cell, a sticky header
// and a sticky Study column, and a count in the footer. Styling that the inline
// style props cannot express (sticky offsets, row hover, the column rules) lives
// in responsive.css under .library-table.

interface ColumnSpec {
  label: string;
  icon: IconName;
  align?: 'right';
  title?: string;
}

const COLUMNS: ColumnSpec[] = [
  { label: 'Study', icon: 'category' },
  { label: 'Region', icon: 'region' },
  { label: 'Contrast', icon: 'contrast' },
  { label: 'N', icon: 'power', align: 'right', title: 'Replicates, baseline v case, on the default track' },
  // The same two numbers the cards lead with. Without them the layout toggle
  // swaps not just the layout but the subject: cards about what a study found,
  // table about how big it was.
  // Counts of SIGNIFICANT results, not of genes measured; the header says so
  // because a bare "Genes" read as the size of the gene list.
  { label: 'Sig. genes', icon: 'hash', align: 'right',
    title: `Genes with FDR < ${DEFAULT_FDR_CUTOFF} in each study's default comparison, on its default track. Hover a count for how many were tested.` },
  { label: 'Sig. pathways', icon: 'hash', align: 'right',
    title: `Pathway terms with fgsea adjusted P < ${DEFAULT_FDR_CUTOFF} in each study's default comparison, on its default track, summed across its gene-set collections.` },
  { label: 'Tracks', icon: 'layers', align: 'right' },
  { label: 'Accession', icon: 'link' },
  { label: 'Validation', icon: 'shield' },
  { label: 'Compare set', icon: 'plus' },
];

/**
 * One result count in the table.
 *
 * Three states, and the table has to keep them apart exactly as the card does:
 * a number, a measured zero (printed 0 in the warning ink, because it is a
 * finding), and an em dash for a count this index does not carry.
 */
function DiscoveryCell({ card, kind }: { card: DatasetCard; kind: 'genes' | 'paths' }) {
  const d = card.discoveries;
  const n = !d ? null : kind === 'genes' ? d.genes : d.paths;
  const tested = !d ? null : kind === 'genes' ? d.genesTested : d.pathsTested;
  const title = n == null
    ? 'Not carried by this build of the query index'
    : kind === 'genes'
      ? `${n.toLocaleString()} of ${(tested ?? 0).toLocaleString()} tested genes with FDR < ${DEFAULT_FDR_CUTOFF}`
      : `${n.toLocaleString()} of ${(tested ?? 0).toLocaleString()} tested pathway terms with adjusted P < ${DEFAULT_FDR_CUTOFF}`;
  return (
    <td title={title} className="num" style={{
      color: n == null ? 'var(--text-muted)' : n === 0 ? COLOR_WARNING_TEXT : 'var(--text-mono)',
    }}>
      {n == null ? '—' : n.toLocaleString()}
    </td>
  );
}

function LibraryTable({ cards, selectedId, onSelect, isInSet, onToggleCompare }: {
  cards: DatasetCard[]; selectedId: string | null; onSelect: (id: string) => void;
  isInSet: (d: Dataset) => boolean; onToggleCompare: (d: Dataset) => CompareSetAddResult;
}) {
  return (
    <table className="library-table">
      <thead>
        <tr>
          {COLUMNS.map((col) => (
            <th key={col.label} title={col.title} className={col.align === 'right' ? 'num' : undefined}>
              <span className="library-th">
                <Icon name={col.icon} size={12} color="var(--text-muted)" />
                {col.label}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {cards.map((card) => {
          const d = card.dataset;
          const on = d.id === selectedId;
          const noun = d.trackNoun || 'track';
          return (
            <tr key={d.id} onClick={() => onSelect(d.id)} aria-selected={on} className={on ? 'is-selected' : undefined}>
              {/* The row's onClick is a mouse convenience; the real control is
                  this button. A row with only an onClick is unreachable by
                  keyboard, which would make the whole table view inoperable
                  without a pointer. */}
              <td className="library-study-cell">
                <button type="button" aria-pressed={on} data-study-id={d.id}
                  onClick={(e) => { e.stopPropagation(); onSelect(d.id); }}>
                  <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: categoryColor(d.category) }} />
                  {d.name}
                </button>
              </td>
              <td style={{ color: 'var(--text-muted)' }}><span className="clip" title={d.region}>{d.region}</span></td>
              {/* Baseline FIRST, with an arrow rather than "vs", so this column
                  reads in the same order as the N column beside it. Written
                  "HFD vs Chow" against an N of "7 v 8" it claimed HFD=7 — the
                  two columns disagreed, and on the symmetric 3v3 designs that
                  make up most of the corpus the reversal was invisible. */}
              <td className="mono">
                {card.baselineGroup && card.caseGroup
                  ? <span className="clip" title={`${card.baselineGroup.label} → ${card.caseGroup.label}`}>
                      {`${card.baselineGroup.label} → ${card.caseGroup.label}`}
                    </span>
                  : '—'}
              </td>
              <td className="num"
                title={card.baselineGroup && card.caseGroup && card.nBaseline != null && card.nCase != null
                  ? `${card.nBaseline} ${card.baselineGroup.label} vs ${card.nCase} ${card.caseGroup.label}`
                  : undefined}>
                {card.nBaseline == null || card.nCase == null ? '—' : `${card.nBaseline} v ${card.nCase}`}
                {card.nVaries && (
                  <span title={`Counts vary across this study's ${noun}s`} style={{ color: COLOR_WARNING_TEXT }}>*</span>
                )}
              </td>
              <DiscoveryCell card={card} kind="genes" />
              <DiscoveryCell card={card} kind="paths" />
              <td className="num" style={{ color: 'var(--text-muted)' }}>{card.trackCount ?? '—'}</td>
              <td className="mono" style={{ color: 'var(--accent)' }}>{d.geo || (d.doi ? 'DOI' : '—')}</td>
              <td><span className="library-validation"><AuthorValidationBadge record={card.validation} compact /><AuthorEvidenceLabel record={card.validation} /></span></td>
              {/* The toggle stops its click, so the row does not open the record. */}
              <td>
                <CompareSetToggle size="sm" inSet={isInSet(d)} name={d.name} onToggle={() => onToggleCompare(d)} />
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td className="library-study-cell num">
            <span className="library-count-cell">{cards.length}</span> {cards.length === 1 ? 'study' : 'studies'}
            {/* Visible, not only in the header tooltips, which touch screens never
                show; in the sticky Study cell so a sideways scroll cannot hide it. */}
            <span className="library-foot-note">
              Sig. = FDR &lt; {DEFAULT_FDR_CUTOFF}, default track and comparison
            </span>
          </td>
          <td colSpan={COLUMNS.length - 1} />
        </tr>
      </tfoot>
    </table>
  );
}
