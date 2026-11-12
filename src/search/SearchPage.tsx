// The unified search results page (#/search/<query>[/genes|/pathways]).
//
// One query, looked up as a gene and as a pathway at once. The breakdown tabs
// (All / Genes / Pathways) narrow the lists; 'All' is the default. When the
// query decisively names one gene (searchAll's `best`), that gene leads the
// page, then the other genes the query matched. Every gene row summarizes how
// the gene changes across the studies and opens its gene page, which holds
// the full results. When the query names one pathway, the page opens on a
// portal for it: its enrichment across the studies, with the full report one
// click away.
//
// Everything this page reads is cheap: the query index, one small shard per
// gene row and two small requests per pathway. The gene and pathway pages
// hold everything else. See ./searchSummaries.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { PageShell } from '../common/PageShell';
import { listDatasets } from '../data/datasets';
import { contrastLabel } from '../crossdataset/forestReport';
import { DEFAULT_FDR_CUTOFF } from '../statistics/policy';
import { DOWN_TEXT_COLOR, UP_TEXT_COLOR } from '../styles/constants';
import { fmtFDR, fmtP, fmtSigned } from '../utils/format';
import { DbBadge } from './DbBadge';
import { searchAll, describePathway } from './searchVocabulary';
import { useSearchVocabulary } from './useSearchVocabulary';
import { UnifiedSearchBox } from './UnifiedSearchBox';
import { Effect, PlaceholderSlot, dirColor, plural, useLoad } from './portalCards';
import {
  loadGeneSummary, loadPathwaySummary, type CrossStudySummary, type GeneSummary, type SummaryRow,
} from './searchSummaries';
import type { GeneHit, PathwayHit, SearchFilter, SearchResults } from './searchTypes';
import type { PathwayTrackRow } from '../types';
import './search.css';

export interface SearchPageProps {
  /** The submitted query; '' shows the empty state. */
  query: string;
  filter: SearchFilter;
  /** Run a new search (also used to snap the page to one pathway). */
  onSearch: (query: string, filter?: SearchFilter) => void;
  onFilterChange: (filter: SearchFilter) => void;
  onHome: () => void;
  /** Open the gene page (the cross-dataset gene report) for an UPPERCASE symbol. */
  onOpenGene: (symbol: string) => void;
  /** Open the full cross-dataset pathway report for a stored pathway id. */
  onOpenPathway: (pathwayId: string) => void;
  headerRight?: ReactNode;
}

/** Example searches for the empty and no-result states. */
const EXAMPLES = ['insulin', 'oxytocin', 'POMC', 'leptin signaling'] as const;

/** Rows per group in the 'All' breakdown before "Show all"; also the gene rows summarized at once. */
const ALL_PREVIEW = 8;

/** Matches ranked per group; a full group reads "100+" rather than claiming an exact count. */
const RESULT_LIMIT = 100;

function fmtCount(n: number): string {
  return n >= RESULT_LIMIT ? `${RESULT_LIMIT}+` : String(n);
}

// ── Page ───────────────────────────────────────────────────────────────────

export function SearchPage({
  query, filter, onSearch, onFilterChange, onHome, onOpenGene, onOpenPathway, headerRight,
}: SearchPageProps) {
  const q = query.trim();
  const vocab = useSearchVocabulary(true);
  const results = useMemo(() => (vocab && q ? searchAll(vocab, q, { geneLimit: RESULT_LIMIT, pathwayLimit: RESULT_LIMIT }) : null), [vocab, q]);
  const nStudies = listDatasets().length;
  const search = (term: string) => onSearch(term, filter);

  return (
    <PageShell
      onHome={onHome}
      breadcrumbs={q ? [{ label: 'Search' }, { label: q, current: true, maxWidth: 280 }] : [{ label: 'Search', current: true }]}
      mainClassName="search-main"
      headerRight={headerRight}
    >
      <div className="search-top">
        <UnifiedSearchBox variant="page" initialQuery={q} onSearch={(term) => onSearch(term, filter)} />
      </div>

      {!q ? (
        <section className="search-intro" aria-labelledby="search-intro-title">
          <h1 id="search-intro-title" className="search-title">Search genes and pathways</h1>
          <p className="search-lede">
            One search covers {nStudies} studies. Type a gene symbol (POMC), a gene name (oxytocin) or a
            pathway term (insulin secretion), and the results break down into genes and pathways.
          </p>
          <Examples onSearch={search} />
        </section>
      ) : !results ? (
        <p className="search-loading" role="status">Loading gene and pathway names…</p>
      ) : (
        <Results
          results={results}
          query={q}
          filter={filter}
          onSearch={search}
          onFilterChange={onFilterChange}
          onOpenGene={onOpenGene}
          onOpenPathway={onOpenPathway}
        />
      )}
    </PageShell>
  );
}

function Examples({ onSearch, label = 'Try' }: { onSearch: (term: string) => void; label?: string }) {
  return (
    <div className="search-examples">
      <span className="search-examples-label">{label}</span>
      {EXAMPLES.map((term) => (
        <button key={term} type="button" className="search-chip" onClick={() => onSearch(term)}>{term}</button>
      ))}
    </div>
  );
}

const TABS: ReadonlyArray<{ filter: SearchFilter; label: string }> = [
  { filter: 'all', label: 'All' },
  { filter: 'gene', label: 'Genes' },
  { filter: 'pathway', label: 'Pathways' },
];

function Results({ results, query, filter, onSearch, onFilterChange, onOpenGene, onOpenPathway }: {
  results: SearchResults;
  query: string;
  filter: SearchFilter;
  onSearch: (term: string) => void;
  onFilterChange: (filter: SearchFilter) => void;
  onOpenGene: (symbol: string) => void;
  onOpenPathway: (pathwayId: string) => void;
}) {
  const tabsId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const { genes, pathways, best } = results;
  const counts: Record<SearchFilter, number> = { all: genes.length + pathways.length, gene: genes.length, pathway: pathways.length };
  const countLabel: Record<SearchFilter, string> = {
    all: genes.length >= RESULT_LIMIT || pathways.length >= RESULT_LIMIT ? `${counts.all}+` : String(counts.all),
    gene: fmtCount(genes.length),
    pathway: fmtCount(pathways.length),
  };

  if (counts.all === 0) {
    return (
      <section className="search-none" aria-labelledby="search-none-title">
        <h1 id="search-none-title" className="search-title">No genes or pathways match “{query}”</h1>
        <p className="search-lede">
          Try a gene symbol (POMC), a gene name (oxytocin) or a pathway term (insulin secretion).
          Names are matched from the start of a word, so a shorter term finds more.
        </p>
        <Examples onSearch={onSearch} />
      </section>
    );
  }

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.filter === filter);
    let next = -1;
    if (event.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    event.preventDefault();
    onFilterChange(TABS[next].filter);
    tabRefs.current[next]?.focus();
  };

  // A direct gene match leads; the genes the query also matched (POMCA and
  // POMCB for POMC) follow it.
  const match = best?.kind === 'gene' && filter !== 'pathway' ? best.hit : null;
  const others = match ? genes.filter((g) => g.entry.symbol !== match.entry.symbol) : genes;
  const showPathwayPortal = best?.kind === 'pathway' && filter !== 'gene';
  const currentPathway = best?.kind === 'pathway' ? best.hit.id : null;
  const activeTab = `${tabsId}-${filter}`;

  return (
    <>
      <h1 className="search-title search-title--results">Results for “{query}”</h1>
      <div role="tablist" aria-label="Result types" className="search-tabs" onKeyDown={onTabKey}>
        {TABS.map((tab, i) => (
          <button
            key={tab.filter}
            ref={(el) => { tabRefs.current[i] = el; }}
            id={`${tabsId}-${tab.filter}`}
            type="button"
            role="tab"
            aria-selected={filter === tab.filter}
            aria-controls={`${tabsId}-panel`}
            tabIndex={filter === tab.filter ? 0 : -1}
            onClick={() => onFilterChange(tab.filter)}
          >
            {tab.label} <span className="search-tab-count">{countLabel[tab.filter]}</span>
          </button>
        ))}
      </div>

      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={activeTab} className="search-panel">
        {match && (
          <GeneList title="Gene" className="search-list--match" featured genes={[match]} total={1} onOpenGene={onOpenGene} />
        )}
        {showPathwayPortal && best?.kind === 'pathway' && (
          <PathwayPortal hit={best.hit} onOpenPathway={onOpenPathway} />
        )}
        {!best && (
          <p className="search-hint">Pick a gene or pathway below for its result in each study.</p>
        )}

        {filter !== 'pathway' && (!match || others.length > 0) && (
          <GeneList
            title={match ? 'Also matching' : 'Genes'}
            genes={filter === 'all' ? others.slice(0, ALL_PREVIEW) : others}
            // A capped result list leaves more genes beyond these, so the count
            // must read "100+" here as on the Genes tab, not the visible remainder.
            total={genes.length >= RESULT_LIMIT ? RESULT_LIMIT : others.length}
            onOpenGene={onOpenGene}
            onShowAll={filter === 'all' && others.length > ALL_PREVIEW ? () => onFilterChange('gene') : undefined}
            showAllCount={genes.length}
          />
        )}
        {filter !== 'gene' && (
          <PathwayList
            pathways={filter === 'all' ? pathways.slice(0, ALL_PREVIEW) : pathways}
            total={pathways.length}
            current={currentPathway}
            onPick={onSearch}
            onShowAll={filter === 'all' && pathways.length > ALL_PREVIEW ? () => onFilterChange('pathway') : undefined}
          />
        )}
      </div>
    </>
  );
}

// ── Lists ──────────────────────────────────────────────────────────────────

function GeneList({ title, className, featured = false, genes, total, onOpenGene, onShowAll, showAllCount = total }: {
  title: string;
  className?: string;
  /** The direct match: one larger row, no count. */
  featured?: boolean;
  genes: GeneHit[];
  total: number;
  onOpenGene: (symbol: string) => void;
  onShowAll?: () => void;
  /** The Genes breakdown's count, when this list shows only part of it. */
  showAllCount?: number;
}) {
  const titleId = useId();
  return (
    <section className={className ? `search-list ${className}` : 'search-list'} aria-labelledby={titleId}>
      <h2 id={titleId} className="search-list-title">
        {title}{!featured && <> <span className="search-list-count">{fmtCount(total)}</span></>}
      </h2>
      {total === 0 ? (
        <p className="search-list-empty">No gene matches this search.</p>
      ) : (
        <ul>
          {genes.map((hit, i) => (
            <GeneRow key={hit.entry.symbol} hit={hit} featured={featured} eager={i < ALL_PREVIEW} onOpenGene={onOpenGene} />
          ))}
        </ul>
      )}
      {onShowAll && (
        <button type="button" className="search-more" onClick={onShowAll}>Show all {fmtCount(showAllCount)} genes</button>
      )}
    </section>
  );
}

/**
 * True once the element has come near the viewport; immediately when `eager`
 * or where IntersectionObserver is missing.
 */
function useSeen<T extends Element>(eager: boolean) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(() => eager || typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setSeen(true);
    }, { rootMargin: '200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen] as const;
}

const loadRowSummary = (symbol: string) => (symbol ? loadGeneSummary(symbol) : Promise.resolve(null));

/**
 * One matching gene and, once the row is near the viewport, how it changes
 * across the studies: one index shard per gene, the same rows the gene page
 * reads. The first rows load at once; the rest of a long Genes breakdown waits
 * until scrolled to. The row opens the gene page.
 */
function GeneRow({ hit, featured, eager, onOpenGene }: {
  hit: GeneHit;
  featured: boolean;
  eager: boolean;
  onOpenGene: (symbol: string) => void;
}) {
  const { symbol, name, datasets } = hit.entry;
  const [ref, seen] = useSeen<HTMLLIElement>(eager);
  const wanted = datasets > 0;
  const load = useLoad(wanted && seen ? symbol : '', loadRowSummary);
  // Off screen, the '' key resolves at once; the row is still waiting, not unavailable.
  const pending = wanted && (!seen || load.state === 'loading');
  const summary = !pending && load.state === 'done' ? load.value : null;
  return (
    <li ref={ref}>
      <button type="button" className={featured ? 'search-row search-row--featured' : 'search-row'} onClick={() => onOpenGene(symbol)}>
        <span className="search-row-sym">{symbol}</span>
        <span className="search-row-main">
          {name && <span className="search-row-name">{name}</span>}
        </span>
        <span className="search-row-meta">
          {featured ? <span className="search-row-open">Open gene page →</span> : !summary && datasets > 0 ? plural(datasets, 'dataset') : ''}
        </span>
        <span className="search-row-summary" data-summary={summary ? 'done' : pending ? 'loading' : 'none'}>
          {!wanted ? (
            <span className="search-row-note">Not measured in any indexed study.</span>
          ) : pending ? (
            <span className="search-row-note">Reading the cross-study index…</span>
          ) : !summary ? (
            <span className="search-row-note">Cross-study summary unavailable.</span>
          ) : (
            <GeneRowSummary summary={summary} />
          )}
        </span>
      </button>
    </li>
  );
}

function GeneRowSummary({ summary }: { summary: GeneSummary }) {
  const { studiesMeasured, studiesSignificant, tracksSignificant, up, down, significant, top } = summary;
  if (studiesMeasured === 0) return <span className="search-row-note">Not measured in any indexed study.</span>;
  if (tracksSignificant === 0) {
    const lowest = top[0]?.track.fdr;
    return (
      <span className="search-row-verdict">
        Not significant in {studiesMeasured === 1 ? 'its 1 dataset' : `any of ${studiesMeasured} datasets`}
        {lowest != null && <span className="portal-cutoff"> (lowest q {fmtFDR(lowest)})</span>}
      </span>
    );
  }
  const strongest = significant[0];
  return (
    <>
      <span className="search-row-verdict">
        Significant in <b>{studiesSignificant}</b> of <b>{studiesMeasured}</b> datasets
        {' · '}<span style={{ color: UP_TEXT_COLOR }}><b>{up}</b> {up === 1 ? 'track' : 'tracks'} up</span>
        {' · '}<span style={{ color: DOWN_TEXT_COLOR }}><b>{down}</b> down</span>
      </span>
      <span className="search-row-strongest">
        <span className="search-row-strongest-label">Strongest</span>
        {strongest.dataset.name} · {strongest.track.label || strongest.track.trackId}
        {/* The sign carries the direction, so the colour is not its only cue. */}
        {' '}<span className="mono" style={{ color: dirColor(strongest.track.direction, true) }}>log2FC {fmtSigned(strongest.track.logFC, 2)}</span>
        {' '}<span className="mono">q {fmtFDR(strongest.track.fdr)}</span>
      </span>
    </>
  );
}

function PathwayList({ pathways, total, current, onPick, onShowAll }: {
  pathways: PathwayHit[];
  total: number;
  current: string | null;
  onPick: (id: string) => void;
  onShowAll?: () => void;
}) {
  return (
    <section className="search-list" aria-labelledby="search-pathways-title">
      <h2 id="search-pathways-title" className="search-list-title">Pathways <span className="search-list-count">{fmtCount(total)}</span></h2>
      {total === 0 ? (
        <p className="search-list-empty">No pathway matches this search.</p>
      ) : (
        <ul>
          {pathways.map((hit) => {
            const isCurrent = hit.id === current;
            return (
              <li key={hit.id}>
                <button type="button" className="search-row search-row--pathway" aria-current={isCurrent || undefined} onClick={() => onPick(hit.id)}>
                  <span className="search-row-main">
                    <span className="search-row-title">{hit.title}</span>
                    <span className="search-row-id">{hit.id}</span>
                  </span>
                  <span className="search-row-meta">
                    {isCurrent ? 'Shown above' : <DbBadge db={hit.db} label={hit.dbLabel} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {onShowAll && (
        <button type="button" className="search-more" onClick={onShowAll}>Show all {fmtCount(total)} pathways</button>
      )}
    </section>
  );
}

// ── Portals ────────────────────────────────────────────────────────────────

function PathwayPortal({ hit, onOpenPathway }: { hit: PathwayHit; onOpenPathway: (id: string) => void }) {
  const described = describePathway(hit.id);
  const title = hit.title || described.title;
  return (
    <article className="portal portal--pathway" data-portal="pathway" aria-labelledby="portal-pathway-title">
      <header className="portal-head">
        <span className="portal-kind">Pathway <DbBadge db={hit.db} label={hit.dbLabel || described.dbLabel} /></span>
        <h2 id="portal-pathway-title" className="portal-title">{title}</h2>
        <p className="portal-id">{hit.id}</p>
      </header>
      <div className="portal-grid">
        <PathwaySection pathwayId={hit.id} onOpenPathway={onOpenPathway} />
        <PlaceholderSlot slot="pathway-members" title="Member genes">
          The genes in this set, and which of them change in each study.
        </PlaceholderSlot>
      </div>
    </article>
  );
}

// ── Cross-study sections ───────────────────────────────────────────────────

function SummaryTable<Row extends { trackId: string; label: string; lowPower?: boolean }>({ rows, effectHeader, effect, p, q, qHeader }: {
  rows: SummaryRow<Row>[];
  effectHeader: string;
  effect: (row: Row) => ReactNode;
  p: (row: Row) => number | null;
  q: (row: Row) => number | null;
  qHeader: string;
}) {
  return (
    <div className="portal-table-wrap">
      <table className="portal-table">
        <thead>
          <tr>
            <th scope="col">Study</th>
            <th scope="col">Population / track</th>
            <th scope="col">Comparison</th>
            <th scope="col" className="num">{effectHeader}</th>
            <th scope="col" className="num">p</th>
            <th scope="col" className="num">{qHeader}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ dataset, contrast, track }) => (
            <tr key={`${dataset.id}:${track.trackId}`}>
              <td>
                <span className="portal-study">{dataset.name}</span>
                {dataset.geo && <span className="portal-acc">{dataset.geo}</span>}
              </td>
              <td>
                {track.label || track.trackId}
                {track.lowPower && (
                  <span className="portal-lowpower" title="Fewer than 3 replicates in a group: treat this result with caution.">low power</span>
                )}
              </td>
              <td className="portal-contrast">{contrastLabel(contrast) || '–'}</td>
              <td className="num">{effect(track)}</td>
              <td className="num mono">{fmtP(p(track))}</td>
              <td className="num mono">{fmtFDR(q(track))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IndexUnavailable({ what }: { what: string }) {
  return (
    <p className="portal-note">
      The cross-study index is not available right now, so the {what} summary cannot be shown here.
      The full report can still read every study.
    </p>
  );
}

function moreNote<Row>(summary: CrossStudySummary<Row>): string | null {
  const hidden = summary.tracksSignificant - summary.top.length;
  return summary.tracksSignificant > 0 && hidden > 0 ? `${plural(hidden, 'more significant track')} in the full report.` : null;
}

function PathwaySection({ pathwayId, onOpenPathway }: { pathwayId: string; onOpenPathway: (id: string) => void }) {
  const load = useLoad(pathwayId, loadPathwaySummary);
  const summary = load.state === 'done' ? load.value : null;
  const more = summary ? moreNote(summary) : null;
  return (
    <section className="portal-card portal-card--wide" data-section="enrichment" aria-labelledby="portal-enrichment-title">
      <h3 id="portal-enrichment-title" className="portal-card-title">Enrichment across studies</h3>
      {load.state === 'loading' ? (
        <p className="portal-note" role="status">Reading the cross-study index…</p>
      ) : !summary ? (
        <IndexUnavailable what="enrichment" />
      ) : summary.tracksMeasured === 0 ? (
        <p className="portal-note">This pathway has no enrichment result in any indexed study.</p>
      ) : (
        <>
          <p className="portal-verdict">
            Enriched (FDR &lt; {DEFAULT_FDR_CUTOFF}) in <b>{summary.tracksSignificant}</b> of <b>{summary.tracksMeasured}</b> tracks
            across <b>{summary.studiesSignificant}</b> {summary.studiesSignificant === 1 ? 'study' : 'studies'}
            {summary.tracksSignificant > 0 && (
              <>
                {' · '}<span style={{ color: UP_TEXT_COLOR }}><b>{summary.up}</b> up</span>
                {' · '}<span style={{ color: DOWN_TEXT_COLOR }}><b>{summary.down}</b> down</span>
              </>
            )}
          </p>
          {summary.tracksSignificant === 0 && (
            <p className="portal-note">No track reaches FDR &lt; {DEFAULT_FDR_CUTOFF}. The lowest adjusted p-values are listed.</p>
          )}
          <SummaryTable<PathwayTrackRow>
            rows={summary.top}
            effectHeader="NES"
            effect={(t) => <Effect value={t.NES} direction={t.direction} significant={t.significant} />}
            p={(t) => t.pval}
            q={(t) => t.padj}
            qHeader="padj"
          />
          {more && <p className="portal-note">{more}</p>}
        </>
      )}
      <div className="portal-actions">
        <button type="button" className="portal-primary" onClick={() => onOpenPathway(pathwayId)}>Open full pathway report →</button>
      </div>
    </section>
  );
}
