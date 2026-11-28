// The gene and pathway cards shared by the search page and the gene page:
// a gene's expression in sorted mouse hypothalamic populations, the study
// library's populations and tissue, its values in the human reference atlases
// (GTEx, HPA, Allen), each opening its full survey, the pathways
// enriched in the conditions where it changes, and reserved slots for data
// that is not built yet (mouse single-cell atlases, co-expression), so a
// layout does not shift when it arrives.
//
// Everything here reads cheap sources only: the query index (plus one small
// track-pathways file per followed condition), the same-origin NeuroSeq files,
// the expression index and the same-origin external reference shards. See
// ./searchSummaries.

import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { lazyView, ViewLoading } from '../common/lazyView';
import { useLoad } from '../common/useLoad';
import { barGeometry, type SurveyScope } from '../expression-survey/expressionSurvey';
import { dirGlyph, directionTextColor } from '../statistics/direction';
import { DEFAULT_FDR_CUTOFF, type SignificanceTier } from '../statistics/policy';
import { DOWN_TEXT_COLOR, UP_TEXT_COLOR } from '../styles/constants';
import { fmtFDR, fmtP, fmtSigned, plural } from '../utils/format';
import { DbBadge } from './DbBadge';
import { VisiumSectionsButton } from './VisiumSections';
import { describePathway } from './searchVocabulary';
import {
  loadBaselineTeaser, loadConditionPathways, loadFamilyTeaser, loadReferenceAtlases, REFERENCE_ATLAS_SOURCES,
  type BaselineTeaser, type ConditionPathway, type ConditionRef, type FamilyTeaser, type ReferenceAtlas, type ReferenceAtlases, type ReferenceRegion,
  type ReferenceLevel, type SourceFamily,
} from './searchSummaries';
import type { SurveyFocus } from '../expression-survey/GeneSurvey';
import type { Dataset, Direction, ExpressionSource } from '../types';
import './search.css';
import { Coexpression } from './hypomap/Coexpression';
import { HypoMapPreview } from './hypomap/HypoMapPreview';

// ── Formatting ─────────────────────────────────────────────────────────────

export function Effect({ value, direction, tier }: { value: number; direction: Direction; tier: SignificanceTier }) {
  return (
    <span className="search-effect" style={{ color: directionTextColor(direction, tier) }}>
      <span aria-hidden="true">{dirGlyph(direction)} </span>{fmtSigned(value, 2)}
    </span>
  );
}

/** A reserved slot for data that is not built yet. Replace by `data-slot`. */
export function PlaceholderSlot({ slot, title, wide, children }: { slot: string; title: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={wide ? 'portal-card portal-card--wide portal-slot' : 'portal-card portal-slot'} data-slot={slot} aria-label={`${title} (coming soon)`}>
      <h3 className="portal-card-title">{title} <span className="portal-soon">Coming soon</span></h3>
      <p className="portal-slot-text">{children}</p>
    </section>
  );
}

// ── Condition pathways ─────────────────────────────────────────────────────
//
// A matrix: one column per condition the gene is followed into, split by the
// way the gene moved there (lower in the comparison's first group, then
// higher), and one row per pathway, most specific to these conditions first.
// A filled cell is a pathway enriched in that condition (padj < 0.05), red for
// NES above 0 and blue below, darker for larger |NES|, with the NES printed.
// A condition without a pathway analysis keeps its column, marked, so an empty
// column is never mistaken for "not enriched".

/** Pathway rows shown before "Show more", and the most "Show more" reveals. */
const CONDITION_PATHWAYS_TOP = 10;
const CONDITION_PATHWAYS_MAX = 50;

const PLACEHOLDER_TITLE = 'Pathways changing in these conditions';

/** Enrichment over the corpus base rate, e.g. ×3.4 or ×12. */
function fmtEnrichment(ratio: number): string {
  return `×${ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)}`;
}

function specificityTitle(p: ConditionPathway): string | undefined {
  const s = p.specificity;
  if (!s || !p.corpus) return undefined;
  return `Enriched in ${p.hits.length} of ${s.draws} conditions here; at its rate across the corpus `
    + `(${p.corpus.significant} of ${p.corpus.tested} tracks) ${s.expected.toFixed(1)} were expected. `
    + `Hypergeometric tail ${fmtP(s.tail)}, used for ranking only.`;
}

function conditionStatus(c: ConditionRef): string {
  if (c.status === 'no-analysis') return 'no pathway analysis';
  if (c.status === 'unreadable') return 'could not be read';
  return plural(c.pathways, 'pathway');
}

/** The condition's column heading: the comparison's first group, the group the gene's change describes. */
function conditionLabel(c: ConditionRef): string {
  return c.contrast?.caseGroup.label ?? (c.track.label || c.track.trackId);
}

function conditionTitle(c: ConditionRef, symbol: string): string {
  const comparison = c.contrast?.label ? `: ${c.contrast.label}` : '';
  return `${c.dataset.name} · ${c.track.label || c.track.trackId}${comparison}. ${symbol} log2FC `
    + `${fmtSigned(c.track.logFC, 2)}, q ${fmtFDR(c.track.fdr)}. ${conditionStatus(c)}.`;
}

/** Cell fill: the direction's colour, stronger for larger |NES| (1.3 to 2.4 spans the range). */
function cellFill(nes: number): { background: string; color: string } {
  const alpha = 0.3 + 0.6 * Math.min(1, Math.max(0, (Math.abs(nes) - 1.3) / 1.1));
  return {
    background: nes > 0 ? `rgba(228, 87, 86, ${alpha.toFixed(2)})` : `rgba(76, 120, 168, ${alpha.toFixed(2)})`,
    color: alpha > 0.6 ? '#ffffff' : 'var(--text-primary)',
  };
}

export function ConditionPathwaysSection({ symbol, studies, onShowPathway, onOpenPathway }: {
  symbol: string;
  /** Follow only these studies' conditions; omitted, every indexed study. null while still being decided. */
  studies?: readonly Dataset[] | null;
  onShowPathway: (pathwayId: string) => void;
  onOpenPathway: (pathwayId: string) => void;
}) {
  // A study selection still being decided loads nothing yet (idle) and shows as loading.
  const key = studies === null ? null : `${symbol}\u0000${studies ? studies.map((d) => d.id).sort().join(',') : '*'}`;
  const load = useLoad(key, () => loadConditionPathways(symbol, studies ?? undefined));
  const [expanded, setExpanded] = useState(false);
  const data = load.state === 'loaded' ? load.value : null;

  // An index without the track-pathways family (or one that cannot answer for
  // these studies, or a load that failed) keeps the reserved slot, so the
  // layout does not change.
  if ((load.state === 'loaded' && !data) || load.state === 'failed') {
    return (
      <PlaceholderSlot slot="condition-pathways" title={PLACEHOLDER_TITLE} wide>
        The pathways enriched in the studies and conditions where {symbol} changes.
      </PlaceholderSlot>
    );
  }

  const shown = data ? data.pathways.slice(0, expanded ? CONDITION_PATHWAYS_MAX : CONDITION_PATHWAYS_TOP) : [];
  const recurring = data ? data.pathways.filter((p) => p.hits.length > 1).length : 0;
  const hidden = data ? Math.min(data.pathways.length, CONDITION_PATHWAYS_MAX) - shown.length : 0;
  // Columns: where the gene went down, then where it went up, each in followed (q) order.
  const indexed = data ? data.conditions.map((c, index) => ({ c, index })) : [];
  const groups = [
    { key: 'down', label: `${symbol} lower in the first group`, color: DOWN_TEXT_COLOR, columns: indexed.filter(({ c }) => c.track.direction === 'down') },
    { key: 'up', label: `${symbol} higher`, color: UP_TEXT_COLOR, columns: indexed.filter(({ c }) => c.track.direction !== 'down') },
  ].filter((g) => g.columns.length > 0);
  const columns = groups.flatMap((g) => g.columns.map((col, i) => ({ ...col, group: g.key, first: i === 0 })));
  return (
    <section className="portal-card portal-card--wide" data-section="condition-pathways" aria-labelledby="portal-cp-title">
      <h3 id="portal-cp-title" className="portal-card-title">{PLACEHOLDER_TITLE}</h3>
      {!data ? (
        <p className="portal-note" role="status">Reading the pathway results of these conditions…</p>
      ) : data.conditionsTotal === 0 ? (
        <p className="portal-note">
          {symbol} is not significant (FDR &lt; {DEFAULT_FDR_CUTOFF}) in any track{studies ? ' of the selected studies' : ''}, so
          there are no conditions to follow.
        </p>
      ) : (
        <>
          <p className="portal-verdict">
            {data.read === 0 ? (
              <>None of the conditions where {symbol} changes has a pathway analysis.</>
            ) : (
              <>
                In the <b>{data.read}</b> {data.read === 1 ? 'condition' : 'conditions'} where {symbol} changes
                with a pathway analysis, <b>{data.pathways.length}</b> {data.pathways.length === 1 ? 'pathway is' : 'pathways are'} enriched
                {data.read > 1 && <>; <b>{recurring}</b> in two or more</>}
                <span className="portal-cutoff"> (padj &lt; {DEFAULT_FDR_CUTOFF})</span>
              </>
            )}
          </p>
          {data.conditionsTotal > data.conditions.length && (
            <p className="portal-note">
              Following the {data.conditions.length} conditions where {symbol} changes most significantly,
              of {data.conditionsTotal}.
            </p>
          )}
          {data.pathways.length > 0 && (
            <>
              <div className="portal-table-wrap">
                <table className="cp-matrix">
                  <caption className="portal-sr">
                    Pathway enrichment (NES) in each condition where {symbol} changes, most specific pathways first
                  </caption>
                  <thead>
                    <tr className="cp-groups">
                      <td />
                      {groups.map((g) => (
                        <th key={g.key} scope="colgroup" colSpan={g.columns.length} className="cp-group" data-group={g.key}
                          style={{ color: g.color, borderBottomColor: g.color }}>
                          {g.label}
                        </th>
                      ))}
                      <td />
                    </tr>
                    <tr className="cp-heads">
                      <th scope="col" className="cp-pathway-head">Pathway</th>
                      {columns.map(({ c, index, group, first }) => (
                        <th key={index} scope="col" className="cp-cond" data-status={c.status}
                          data-first={first && group === 'up' ? true : undefined} title={conditionTitle(c, symbol)}>
                          <span className="cp-cond-label">{conditionLabel(c)}</span>
                          {/* Every condition column is an FDR result (searchSummaries.ts). */}
                          <span className="cp-cond-fc" style={{ color: directionTextColor(c.track.direction, 'fdr') }}>
                            {fmtSigned(c.track.logFC, 2)}
                          </span>
                        </th>
                      ))}
                      <th scope="col" className="cp-count-head">Conditions · over usual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((p) => {
                      const described = describePathway(p.id);
                      const byCondition = new Map(p.hits.map((h) => [h.condition, h]));
                      return (
                        <tr key={p.id}>
                          <th scope="row" className="cp-pathway">
                            <button type="button" className="portal-link" onClick={() => onShowPathway(p.id)}>{described.title}</button>
                            <DbBadge db={described.db} label={described.dbLabel} />
                          </th>
                          {columns.map(({ c, index, group, first }) => {
                            const hit = byCondition.get(index);
                            const label = conditionLabel(c);
                            const firstUp = first && group === 'up' ? true : undefined;
                            if (c.status !== 'read') {
                              return <td key={index} className="cp-cell cp-cell--na" data-first={firstUp} title={`${label}: ${conditionStatus(c)}`}><span className="portal-sr">{conditionStatus(c)}</span></td>;
                            }
                            if (!hit) {
                              return <td key={index} className="cp-cell" data-first={firstUp} title={`${described.title}: not enriched in ${label}`}><span className="portal-sr">not enriched</span></td>;
                            }
                            return (
                              <td key={index} className="cp-cell" data-first={firstUp} data-nes={hit.NES > 0 ? 'up' : 'down'}
                                title={`${described.title} in ${label}: NES ${fmtSigned(hit.NES, 2)}, padj ${fmtFDR(hit.padj)}`}>
                                <span className="cp-fill" style={cellFill(hit.NES)}>{hit.NES.toFixed(1)}</span>
                              </td>
                            );
                          })}
                          <td className="cp-count">
                            <span><b className="mono">{p.hits.length}</b> of {data.read}</span>
                            {p.specificity && p.corpus && (
                              <span title={specificityTitle(p)}> · <b className="mono">{fmtEnrichment(p.specificity.enrichment)}</b></span>
                            )}
                            <button type="button" className="portal-link portal-link--quiet" aria-label={`Open full pathway report for ${described.title}`}
                              onClick={() => onOpenPathway(p.id)}>
                              Report →
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="cp-legend">
                <span className="cp-key"><span className="cp-swatch" style={{ background: 'rgba(228, 87, 86, 0.75)' }} />NES above 0</span>
                <span className="cp-key"><span className="cp-swatch" style={{ background: 'rgba(76, 120, 168, 0.75)' }} />NES below 0</span>
                <span className="cp-key"><span className="cp-swatch cp-swatch--empty" />not enriched</span>
                <span>Darker is a larger |NES|. Over usual: how much more often than across all {data.corpusTracks} tracks with a pathway analysis.</span>
                <span className="cp-legend-gap" />
                {hidden > 0 && (
                  <button type="button" className="search-more" onClick={() => setExpanded(true)}>Show {hidden} more</button>
                )}
              </div>
              {data.pathways.length > shown.length && hidden === 0 && (
                <p className="portal-note">
                  Showing the top {shown.length} of {data.pathways.length}. Open a pathway for its result in every study.
                </p>
              )}
              <details className="cp-how">
                <summary>How is this ranked?</summary>
                <p className="portal-note">
                  Ranked by how specific each pathway is to these conditions: how often it is enriched here against
                  how often it is enriched across all {data.corpusTracks} tracks with a pathway analysis (a one-sided
                  hypergeometric tail). Sets enriched almost everywhere, such as ribosome or oxidative phosphorylation,
                  rank low however often they recur. Conditions is the raw recurrence; over usual is that recurrence
                  divided by the count the corpus rate predicts. The tail only orders the list. It is not a
                  significance test, because tracks of one study share animals and these conditions were chosen by
                  the gene. Ties fall back to studies, then conditions, direction agreement and padj.
                </p>
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}

// ── Where the gene is expressed: one tile per source ───────────────────────
//
// Each source shows its headline values in its own unit; its "Every …" button
// opens that source's full survey (every cohort, sample and export) under its
// row. Animal and human sources sit in separate rows and are never pooled.

const BASELINE_TOP = 3;
const FAMILY_TOP = 3;
const REFERENCE_LEVELS_TOP = 3;
const CLUSTERS_TOP = 3;

function fmtTpm(tpm: number): string {
  if (tpm >= 100) return tpm.toFixed(0);
  if (tpm >= 10) return tpm.toFixed(1);
  return tpm.toFixed(2);
}

/** One source inside the expression section: its name and method, then its readout. */
function SourceTitle({ id, name, method }: { id: string; name: string; method: string }) {
  return (
    <h4 id={id} className="portal-source-title">
      {name} <span className="portal-card-sub">{method}</span>
    </h4>
  );
}

/** The sources a tile can open, and the survey each one opens. */
export type SourceDrillId = 'neuroseq' | 'studies' | 'tissue' | 'single-cell' | 'gtex' | 'allen' | 'subregions' | 'clusters' | 'visium';
const MOUSE_DRILLS: readonly SourceDrillId[] = ['neuroseq', 'studies', 'tissue', 'single-cell'];

/** A tile's way into its source: the button that opens (or closes) the source's full survey. */
interface TileOpen {
  open: SourceDrillId | null;
  onOpen?: (id: SourceDrillId) => void;
  panelId: string;
}

function Tile({ id, label, slot, nav, wide, children }: {
  id: SourceDrillId;
  label?: string;
  slot?: string;
  nav?: TileOpen;
  /** Spans the whole row (the regional Visium tile). */
  wide?: boolean;
  children: ReactNode;
}) {
  const open = nav?.open === id;
  return (
    <div className={`gene-tile${wide ? ' gene-tile--wide' : ''}${open ? ' gene-tile--open' : ''}`} data-tile={id} data-slot={slot}>
      {children}
      {nav?.onOpen && label && (
        <button
          type="button"
          className="gene-tile-open"
          aria-expanded={open}
          aria-controls={open ? nav.panelId : undefined}
          onClick={() => nav.onOpen?.(id)}
        >
          {open ? 'Close' : `${label} →`}
        </button>
      )}
    </div>
  );
}

function LevelBars({ levels, top, unit, gene }: { levels: ReferenceLevel[]; top: number; unit: string; gene: string }) {
  const max = levels[0]?.value ?? 0;
  return (
    <ul className="portal-bars" aria-label={`Highest published ${unit} of ${gene}`}>
      {levels.slice(0, top).map((level) => (
        <li key={level.key}>
          <span className="portal-bar-label" title={level.label}>{level.label}</span>
          <span className="portal-bar-track" aria-hidden="true">
            <span className="portal-bar" style={{ width: `${max > 0 ? Math.max(1, (level.value / max) * 100) : 0}%` }} />
          </span>
          {/* As published (HPA gives one decimal); padding would claim precision. */}
          <span className="portal-bar-value">{String(level.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export function BaselineSection({ symbol }: { symbol: string }) {
  const load = useLoad<BaselineTeaser | null>(symbol, () => loadBaselineTeaser(symbol));
  const teaser = load.state === 'loaded' ? load.value : null;
  return (
    <section className="portal-source" data-section="baseline-expression" aria-labelledby="portal-baseline-title">
      <SourceTitle id="portal-baseline-title" name="NeuroSeq" method="sorted populations · TPM" />
      {load.state === 'loading' ? (
        <p className="portal-note" role="status">Loading population expression…</p>
      ) : !teaser ? (
        <p className="portal-note">Population expression could not be loaded.</p>
      ) : teaser.status === 'absent' ? (
        <p className="portal-note">{symbol} is not in the NeuroSeq gene list.</p>
      ) : teaser.status === 'ambiguous' ? (
        <p className="portal-note">{symbol} matches more than one NeuroSeq gene ({teaser.candidates.join(', ')}). Open the survey to choose one.</p>
      ) : (
        <>
          <ul className="portal-bars" aria-label={`Highest mean expression of ${teaser.gene}, TPM`}>
            {teaser.groups.slice(0, BASELINE_TOP).map((g) => (
              <li key={g.id}>
                <span className="portal-bar-label" title={g.group ? `${g.label}, source group ${g.group}` : g.label}>
                  {g.label}
                  {/* A population with several source groups gets a row per group, named as the survey names it. */}
                  {g.group && <span className="portal-card-sub" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.group}</span>}
                </span>
                <span className="portal-bar-track" aria-hidden="true">
                  <span className="portal-bar" style={{ width: `${teaser.max > 0 ? Math.max(1, (g.meanTpm / teaser.max) * 100) : 0}%` }} />
                </span>
                <span className="portal-bar-value">{fmtTpm(g.meanTpm)}</span>
              </li>
            ))}
          </ul>
          <p className="portal-note">
            Mean TPM of each source group's sorted-neuron libraries; top {Math.min(BASELINE_TOP, teaser.groups.length)} of{' '}
            {teaser.groups.length} source groups in {teaser.populationCount} populations, without the SFO boundary records.
          </p>
        </>
      )}
    </section>
  );
}

// Each study-library source is one population (GSE210311 has two), so the
// tile counts populations, not studies.
const FAMILY_TEXT: Record<SourceFamily, { name: string; method: string; noun: string }> = {
  studies: { name: 'Study library', method: 'sorted and tagged populations', noun: 'populations' },
  tissue: { name: 'Tissue & bulk', method: 'animal tissue', noun: 'sources' },
};

const COMMON_NAME: Record<string, string> = { 'Mus musculus': 'mouse', 'Rattus norvegicus': 'rat', 'Sus scrofa': 'pig' };

/** 'mouse, rat and pig': the species a family covers, by common name where one is set. */
export function speciesPhrase(species: readonly string[]): string {
  const names = species.map((name) => COMMON_NAME[name] ?? name);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '';
}

/** The study-library populations, or the animal tissue sources: each source's highest cohort mean. */
export function FamilySection({ symbol, family }: { symbol: string; family: SourceFamily }) {
  const load = useLoad<FamilyTeaser | null>(`${family}:${symbol}`, () => loadFamilyTeaser(symbol, family));
  const teaser = load.state === 'loaded' ? load.value : null;
  const text = FAMILY_TEXT[family];
  const titleId = `portal-family-${family}`;
  // The tissue tile names the species its sources come from, not a fixed list.
  const method = family === 'tissue' && teaser?.species.length ? speciesPhrase(teaser.species) : text.method;
  const read = teaser ? teaser.total - teaser.unread : 0;
  const unreadNote = teaser && teaser.unread > 0
    ? ` ${teaser.unread} of the ${teaser.total} ${text.noun} could not be read, so ${symbol} may be measured there.`
    : '';
  // One signed axis for the shown bars: a measured zero draws nothing, and a
  // negative value (the median-baselined rat tissue) is drawn left of zero.
  const shown = teaser?.levels.slice(0, FAMILY_TOP) ?? [];
  const maximum = Math.max(0, ...shown.map((level) => level.mean));
  const minimum = Math.min(0, ...shown.map((level) => level.mean));
  const axis = { minimum, maximum, range: maximum - minimum || 1 };
  return (
    <section className="portal-source" data-section={family === 'studies' ? 'study-populations' : 'tissue'} aria-labelledby={titleId}>
      <SourceTitle id={titleId} name={text.name} method={method} />
      {load.state === 'loading' ? (
        <p className="portal-note" role="status">Loading {text.noun}…</p>
      ) : !teaser ? (
        <p className="portal-note">These {text.noun} could not be loaded.</p>
      ) : !teaser.levels.length ? (
        <p className="portal-note">
          {teaser.unread > 0
            ? <>{symbol} is not among the genes the {read} {text.noun} that loaded retained.{unreadNote}</>
            : <>{symbol} is not among the genes these {teaser.total} {text.noun} retained.</>}
        </p>
      ) : (
        <>
          <ul className="portal-bars" aria-label={`Highest cohort mean of ${symbol} per source, ${teaser.unit}`}>
            {shown.map((level) => {
              const bar = barGeometry(level.mean, axis);
              return (
              <li key={level.sourceId}>
                <span className="portal-bar-label" title={`${level.label}, ${level.study}, ${level.cohort}, n = ${level.n}`}>
                  {level.label}
                  <span className="portal-card-sub" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{level.study} · {level.cohort}</span>
                </span>
                <span className="portal-bar-track portal-bar-track--signed" aria-hidden="true">
                  {minimum < 0 && <span className="portal-bar-zero" style={{ left: `${bar.zero}%` }} />}
                  <span className="portal-bar" style={{ marginLeft: `${bar.left}%`, width: `${bar.width}%` }} />
                </span>
                <span className="portal-bar-value">{fmtTpm(level.mean)}</span>
              </li>
              );
            })}
          </ul>
          <p className="portal-note">
            Highest cohort mean per source, {teaser.unit}. {teaser.inUnit} of the {teaser.measured} {text.noun} with {symbol} use
            this unit{teaser.measured > teaser.inUnit ? '; the rest are listed in their own units inside' : ''}.{unreadNote}
          </p>
        </>
      )}
    </section>
  );
}

// ── Human reference atlases ────────────────────────────────────────────────
//
// GTEx, HPA, Allen and HYPOMAP Visium values for the human gene of this
// symbol, each in its own unit. Nothing is converted, ranked across atlases or pooled with mouse
// data; a symbol that differs from the human gene's is shown as a match.

function fmtLog2(value: number): string {
  return value.toFixed(2);
}

/** Why an atlas has no values for this gene, or null when it has them. */
function atlasGap(atlas: ReferenceAtlas, symbol: string): string | null {
  if (atlas.status === 'unavailable') return 'This atlas could not be loaded.';
  if (atlas.status === 'not-retained') {
    const absent = atlas.source.absentLabel;
    return absent ? `${symbol}: ${absent.charAt(0).toLowerCase()}${absent.slice(1)}.` : `${symbol} is not in this atlas.`;
  }
  if (atlas.status === 'ambiguous') return `${symbol} matches more than one gene (${atlas.candidates.join(', ')}). Open the survey to choose one.`;
  return null;
}

function GtexAtlas({ atlas, symbol }: { atlas: ReferenceAtlas; symbol: string }) {
  const gap = atlasGap(atlas, symbol);
  const spread = atlas.status === 'available' ? atlas.rows[0]?.spread : null;
  return (
    <section className="portal-source" data-atlas="gtex" aria-labelledby="portal-gtex-title">
      <SourceTitle id="portal-gtex-title" name="GTEx v10" method="bulk RNA-seq" />
      {gap ? <p className="portal-note">{gap}</p> : !spread ? <p className="portal-note">No donor has a value.</p> : (
        <>
          <p className="portal-ref-value"><b className="mono">{fmtTpm(spread.median)}</b> TPM</p>
          <p className="portal-note">
            Median of {spread.donors} donors; interquartile {fmtTpm(spread.low)}–{fmtTpm(spread.high)}. The donor mean,{' '}
            {fmtTpm(spread.mean)} TPM, is what the full survey ranks.
          </p>
        </>
      )}
    </section>
  );
}

function SubregionAtlas({ atlas, symbol }: { atlas: ReferenceAtlas; symbol: string }) {
  const gap = atlasGap(atlas, symbol);
  const levels = atlas.status === 'available' ? atlas.rows[0]?.levels ?? [] : [];
  return (
    <section className="portal-source" data-atlas="subregions" aria-labelledby="portal-subregions-title">
      <SourceTitle id="portal-subregions-title" name="Human Protein Atlas" method="subregions" />
      {gap ? <p className="portal-note">{gap}</p> : (
        <>
          <LevelBars levels={levels} top={REFERENCE_LEVELS_TOP} unit="nTPM" gene={atlas.status === 'available' ? atlas.gene : symbol} />
          <p className="portal-note">Published nTPM; top {Math.min(REFERENCE_LEVELS_TOP, levels.length)} of {levels.length} subregions.</p>
        </>
      )}
    </section>
  );
}

/** Human single-cell: the HPA hypothalamus snRNA-seq clusters' published nCPM. */
function ClustersAtlas({ atlas, symbol }: { atlas: ReferenceAtlas; symbol: string }) {
  const gap = atlasGap(atlas, symbol);
  const levels = atlas.status === 'available' ? atlas.rows[0]?.levels ?? [] : [];
  return (
    <section className="portal-source" data-section="single-cell-human" aria-labelledby="portal-clusters-title">
      <SourceTitle id="portal-clusters-title" name="Human Protein Atlas" method="snRNA-seq clusters" />
      {gap ? <p className="portal-note">{gap}</p> : (
        <>
          <LevelBars levels={levels} top={CLUSTERS_TOP} unit="nCPM" gene={atlas.status === 'available' ? atlas.gene : symbol} />
          <p className="portal-note">Published cluster nCPM; top {Math.min(CLUSTERS_TOP, levels.length)} of {levels.length} clusters.</p>
        </>
      )}
    </section>
  );
}

function AllenAtlas({ atlas, symbol }: { atlas: ReferenceAtlas; symbol: string }) {
  const gap = atlasGap(atlas, symbol);
  const rows = atlas.status === 'available' ? atlas.rows.flatMap((row) => (row.spread ? [{ probe: row.probe ?? '', spread: row.spread }] : [])) : [];
  const first = rows[0]?.spread;
  return (
    <section className="portal-source" data-atlas="allen" aria-labelledby="portal-allen-title">
      <SourceTitle id="portal-allen-title" name="Allen Human Brain Atlas" method="microarray" />
      {gap ? <p className="portal-note">{gap}</p> : !first ? <p className="portal-note">No probe has a value.</p> : (
        <>
          <table className="portal-probes">
            <caption className="portal-sr">Signal per microarray probe, log2 intensity</caption>
            <thead>
              <tr>
                <th scope="col" className="portal-probe-col">Probe</th>
                <th scope="col" className="portal-probe-col portal-probe-num">Median</th>
                <th scope="col" className="portal-probe-col portal-probe-num">Donor range</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ probe, spread }) => (
                <tr key={probe}>
                  <th scope="row" className="portal-probe-cell portal-probe mono" title={probe}>{probe}</th>
                  <td className="portal-probe-cell portal-probe-num"><b className="mono">{fmtLog2(spread.median)}</b></td>
                  <td className="portal-probe-cell portal-probe-num portal-probe-range mono">{fmtLog2(spread.low)}–{fmtLog2(spread.high)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="portal-note">
            One row per probe for {atlas.status === 'available' ? atlas.gene : symbol}, in log2 signal: the median and range of
            each donor's mean over their hypothalamic samples ({first.samples} across {first.donors} donors). Not comparable with TPM.
          </p>
        </>
      )}
    </section>
  );
}

const VISIUM_TOP = 5;

function fmtCpm(value: number): string {
  if (value === 0) return '0';
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value >= 0.1 ? value.toFixed(2) : value.toPrecision(2);
}

/** One region: a bar at its pooled value, and a dot at each donor's own value on the same scale. */
function RegionBar({ region, max }: { region: ReferenceRegion; max: number }) {
  const at = (value: number) => `${max > 0 ? (value / max) * 100 : 0}%`;
  return (
    <li>
      <span className="portal-bar-label" title={region.label}>
        {region.key}<span className="portal-region-n"> · {region.donors.length}</span>
      </span>
      <span className="portal-bar-track portal-bar-track--dots" aria-hidden="true">
        <span className="portal-bar" style={{ width: max > 0 && region.value > 0 ? `max(2px, ${at(region.value)})` : 0 }} />
        {region.donors.map((donor) => (
          <span key={`${region.key}:${donor.donor}`} className="portal-bar-dot" style={{ left: at(donor.value) }} title={`${donor.donor}: ${fmtCpm(donor.value)}`} />
        ))}
      </span>
      <span className="portal-bar-value">{fmtCpm(region.value)}</span>
      <span className="portal-sr">
        {region.label}: pooled {fmtCpm(region.value)} CPM; {region.donors.map((donor) => `${donor.donor} ${fmtCpm(donor.value)}`).join(', ')}.
      </span>
    </li>
  );
}

/**
 * HYPOMAP Visium by region. Its groups are the authors' regional clusters and
 * its samples donors. It ranks regional clusters by their pooled value (every
 * spot summed, as the authors summarise regions) and draws each donor as a dot,
 * never summarizing regions as if they were donors. As in the authors' region
 * assignment, Unassigned spots are not ranked as a region.
 */
function VisiumAtlas({ atlas, symbol }: { atlas: ReferenceAtlas; symbol: string }) {
  const gap = atlasGap(atlas, symbol);
  const row = atlas.status === 'available' ? atlas.rows[0] : null;
  const ranked = (row?.regions ?? []).filter((region) => !region.unassigned);
  const shown = ranked.slice(0, VISIUM_TOP);
  const max = Math.max(0, ...shown.flatMap((region) => [region.value, ...region.donors.map((donor) => donor.value)]));
  const gene = atlas.status === 'available' ? atlas.gene : symbol;
  return (
    <section className="portal-source" data-atlas="visium" aria-labelledby="portal-visium-title">
      <SourceTitle id="portal-visium-title" name="HYPOMAP Visium" method="spatial, by region" />
      {gap ? <p className="portal-note">{gap}</p> : !shown.length ? <p className="portal-note">No region has a value.</p> : (
        <>
          <ul className="portal-bars portal-bars--regions" aria-label={`Regional clusters with the highest pooled ${gene}, FFPE Visium probe-count CPM`}>
            {shown.map((region) => <RegionBar key={region.key} region={region} max={max} />)}
          </ul>
          <p className="portal-note">
            FFPE Visium probe-count CPM, not comparable with TPM or nCPM. Regions are the authors' regional clusters of
            spots. Bars pool every spot in a region across donors and sections, as HYPOMAP summarises regions; dots are each
            donor ({row?.donors} donors in all; the number after a region is its donors). Top {shown.length} of {ranked.length} regions;
            unassigned spots are not ranked. A 55 µm spot mixes several cells, so values are tissue averages, not cell types.
          </p>
          <p className="portal-note portal-credit">
            Tadross et al. 2025, <a href="https://doi.org/10.1038/s41586-024-08504-8" target="_blank" rel="noreferrer">Nature</a>.
            Data <a href="https://doi.org/10.17863/CAM.111988" target="_blank" rel="noreferrer">doi:10.17863/CAM.111988</a>,{' '}
            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>, summed per donor and region and converted to CPM by HypoExplorer.
          </p>
          <VisiumSectionsButton gene={gene} />
        </>
      )}
    </section>
  );
}

/** The human gene the atlases matched, when it is spelled differently from the query. */
function matchedGene(atlases: ReferenceAtlases | null, symbol: string): string | null {
  if (!atlases) return null;
  const gene = Object.values(atlases).find((atlas) => atlas.status === 'available')?.gene;
  return gene && gene !== symbol ? gene : null;
}

/**
 * The human row of the expression section: GTEx and Allen whole-tissue
 * readouts, then the HPA subregions and snRNA-seq clusters, one tile each, and
 * HYPOMAP Visium by region across the row. One
 * load serves every atlas; a provider that fails leaves only its own tile empty.
 */
export function ReferenceAtlasSection({ symbol, nav }: { symbol: string; nav?: TileOpen }) {
  const load = useLoad<ReferenceAtlases | null>(symbol, () => loadReferenceAtlases(symbol));
  const atlases = load.state === 'loaded' ? load.value : null;
  const human = matchedGene(atlases, symbol);
  return (
    <section className="gene-expr-row" data-section="reference-atlases" aria-labelledby="portal-ref-title">
      <h3 id="portal-ref-title" className="gene-expr-lane-title">
        Human hypothalamus <span className="portal-card-sub">Reference atlases of postmortem adult tissue</span>
      </h3>
      {load.state === 'loading' ? (
        <p className="portal-note" role="status">Loading the reference atlases…</p>
      ) : !atlases ? (
        <p className="portal-note">The reference atlases could not be loaded.</p>
      ) : (
        <>
          {human && (
            <p className="portal-verdict">
              {symbol} → <b>{human}</b>, the human gene of the same symbol. Shown apart from the mouse data and never pooled with it.
            </p>
          )}
          <div className="gene-expr-tiles">
            <Tile id="gtex" label="Every donor" nav={nav}><GtexAtlas atlas={atlases.gtex} symbol={symbol} /></Tile>
            <Tile id="allen" label="Every probe and donor" nav={nav}><AllenAtlas atlas={atlases.allen} symbol={symbol} /></Tile>
            <Tile id="subregions" label="Every subregion" nav={nav}><SubregionAtlas atlas={atlases.subregions} symbol={symbol} /></Tile>
            <Tile id="clusters" label="Every cluster" nav={nav}><ClustersAtlas atlas={atlases.clusters} symbol={symbol} /></Tile>
            <Tile id="visium" label="Every region and donor" nav={nav} wide><VisiumAtlas atlas={atlases.visium} symbol={symbol} /></Tile>
          </div>
        </>
      )}
    </section>
  );
}

// ── Gene page groups ───────────────────────────────────────────────────────

// A source's full survey, in its own chunk: the search page imports this
// module, and its first paint should not pay for the survey's tables and exports.
const GenePageSurvey = lazyView(
  () => import('../expression-survey/GeneSurvey').then((module) => module.GenePageSurvey),
  <ViewLoading label="Loading every cohort…" />,
);

const isNonHuman = (source: ExpressionSource) => source.species !== 'Homo sapiens';
const onlySource = (id: string) => (source: ExpressionSource) => source.id === id;
const POPULATIONS: SurveyScope = {
  mode: 'populations', collection: 'neuroseq', region: 'all', includeSfo: false, selectedIds: null, tissueKind: 'whole', referenceOnly: false,
};
const TISSUE: SurveyScope = { ...POPULATIONS, mode: 'tissue', tissueKind: 'all' };
const REFERENCES: SurveyScope = { ...POPULATIONS, mode: 'tissue', tissueKind: 'external' };

/** What each tile opens: a title, the survey scope, and the sources it is held to. */
const DRILLS: Record<Exclude<SourceDrillId, 'single-cell'>, { title: string; scope: SurveyScope; focus: SurveyFocus }> = {
  neuroseq: { title: 'NeuroSeq sorted populations', scope: POPULATIONS, focus: {} },
  studies: { title: 'Study library populations', scope: { ...POPULATIONS, collection: 'existing' }, focus: {} },
  tissue: { title: 'Animal tissue', scope: TISSUE, focus: { include: isNonHuman } },
  gtex: { title: 'GTEx v10 hypothalamus', scope: REFERENCES, focus: { include: onlySource(REFERENCE_ATLAS_SOURCES.gtex) } },
  allen: { title: 'Allen Human Brain Atlas', scope: REFERENCES, focus: { include: onlySource(REFERENCE_ATLAS_SOURCES.allen) } },
  subregions: { title: 'Human Protein Atlas subregions', scope: REFERENCES, focus: { include: onlySource(REFERENCE_ATLAS_SOURCES.subregions) } },
  visium: { title: 'HYPOMAP Visium regions', scope: REFERENCES, focus: { include: onlySource(REFERENCE_ATLAS_SOURCES.visium) } },
  clusters: {
    title: 'Human Protein Atlas snRNA-seq clusters',
    scope: { ...POPULATIONS, collection: 'external' },
    focus: { include: onlySource(REFERENCE_ATLAS_SOURCES.clusters) },
  },
};

/**
 * The survey a tile (or the survey page's handover) opened, under its row. A
 * tile's survey is held to its source; "All sources and filters" releases it.
 */
function SourceDrill({ id, drill, symbol, panelId, onClose }: {
  id: SourceDrillId | 'handoff';
  drill: { title: string; scope?: SurveyScope; focus?: SurveyFocus };
  symbol: string;
  panelId: string;
  onClose: () => void;
}) {
  const [wide, setWide] = useState(false);
  // The scope "Use study library" reopened the survey on, with the tile released.
  const [libraryScope, setLibraryScope] = useState<SurveyScope | null>(null);
  const ref = useRef<HTMLElement>(null);
  // The panel opens below the tiles: bring it into view, and to the top when the survey page handed the gene over.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls once, when the panel opens.
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: id === 'handoff' ? 'start' : 'nearest' });
  }, []);
  const focused = Boolean(drill.focus) && !wide;
  return (
    <section ref={ref} id={panelId} className="gene-expr-drill" data-section="expression-survey" data-drill={id} aria-labelledby={`${panelId}-title`}>
      <div className="gene-expr-drill-head">
        <h3 id={`${panelId}-title`} className="gene-expr-lane-title">
          {focused ? drill.title : 'Every source and sample'}{' '}
          <span className="portal-card-sub">{symbol} in each cohort and sample, in the source's own unit</span>
        </h3>
        <div className="gene-expr-drill-actions">
          {id !== 'single-cell' && drill.focus && (
            <button type="button" className="portal-secondary" aria-pressed={wide} onClick={() => { setLibraryScope(null); setWide((value) => !value); }}>
              {wide ? `Only ${drill.title}` : 'All sources and filters'}
            </button>
          )}
          <button type="button" className="gene-expr-close" aria-label={`Close ${drill.title}`} onClick={onClose}>×</button>
        </div>
      </div>
      {id === 'single-cell'
        ? <HypoMapPreview key={symbol} symbol={symbol} />
        : <GenePageSurvey key={`${id}:${wide}`} symbol={symbol} initialScope={wide && libraryScope ? libraryScope : drill.scope}
            focus={focused ? drill.focus : undefined}
            onUseLibrary={(scope) => { setLibraryScope(scope); setWide(true); }} />}
    </section>
  );
}

/**
 * Where the gene is expressed, as one section: an animal row and a human row of
 * sources, each tile in its own unit. A tile opens that source's full survey
 * (every cohort, sample and export) under its row. `surveyScope` (set when the
 * survey page hands a gene over) opens the survey at once, in that scope.
 */
export function GeneExpressionCards({ symbol, surveyScope, onOpenExpression }: {
  symbol: string;
  surveyScope?: SurveyScope;
  onOpenExpression?: () => void;
}) {
  const showHypoMap = import.meta.env.VITE_HYPOMAP_EXPRESSION === '1';
  const [open, setOpen] = useState<SourceDrillId | 'handoff' | null>(surveyScope ? 'handoff' : null);
  const panelId = useId();
  const toggle = (id: SourceDrillId) => setOpen((current) => (current === id ? null : id));
  const nav: TileOpen = { open: open === 'handoff' ? null : open, onOpen: toggle, panelId };
  const drill = (id: SourceDrillId | 'handoff') => (id === 'handoff'
    ? { title: 'Every source and sample', scope: surveyScope }
    : id === 'single-cell' ? { title: 'HypoMap mouse single-cell atlas' } : DRILLS[id]);
  const panel = (where: 'mouse' | 'human' | 'handoff') => {
    if (!open) return null;
    const here = open === 'handoff' ? 'handoff' : MOUSE_DRILLS.includes(open) ? 'mouse' : 'human';
    return here === where
      ? <SourceDrill key={open} id={open} drill={drill(open)} symbol={symbol} panelId={panelId} onClose={() => setOpen(null)} />
      : null;
  };
  return (
    <section className="portal-card gene-expr" data-cards="expression" aria-labelledby="gene-expr-title">
      <div className="gene-expr-head">
        <h2 id="gene-expr-title" className="portal-card-title">Where {symbol} is expressed</h2>
        {onOpenExpression && (
          <button type="button" className="portal-link portal-link--quiet" onClick={onOpenExpression}>Compare with other genes →</button>
        )}
      </div>
      <section className="gene-expr-row" data-species="mouse" aria-labelledby="gene-expr-mouse-title">
        <h3 id="gene-expr-mouse-title" className="gene-expr-lane-title">Animal hypothalamus</h3>
        <div className="gene-expr-tiles">
          <Tile id="neuroseq" label="Every source group" nav={nav}><BaselineSection symbol={symbol} /></Tile>
          <Tile id="studies" label="Every study population" nav={nav}><FamilySection symbol={symbol} family="studies" /></Tile>
          <Tile id="tissue" label="Every tissue source" nav={nav}><FamilySection symbol={symbol} family="tissue" /></Tile>
          {showHypoMap ? (
            <Tile id="single-cell" label="Open the atlas" nav={nav}>
              <section className="portal-source" aria-labelledby="gene-expr-sc-title">
                <SourceTitle id="gene-expr-sc-title" name="HypoMap" method="mouse single-cell" />
                <p className="portal-note">{symbol} by cell type across the HypoMap mouse hypothalamus atlas.</p>
              </section>
            </Tile>
          ) : (
            <Tile id="single-cell" slot="single-cell-mouse">
              <section className="portal-source portal-source--soon" aria-label="Single-cell atlases (coming soon)">
                <h4 className="portal-source-title">Single-cell atlases <span className="portal-soon">Coming soon</span></h4>
                <p className="portal-note">{symbol} expression by cell type across mouse hypothalamic single-cell atlases.</p>
              </section>
            </Tile>
          )}
        </div>
        {panel('mouse')}
      </section>
      <ReferenceAtlasSection symbol={symbol} nav={nav} />
      {panel('human')}
      {panel('handoff')}
      <p className="portal-note gene-expr-foot-note">
        Each source keeps its own published unit, and its bars are scaled to its own highest value. Choose a source for
        every cohort, sample and export.
      </p>
    </section>
  );
}

/** What changes with the gene: pathways in its conditions, then co-expression to come. */
export function GeneContextCards({ symbol, studies, onShowPathway, onOpenPathway }: {
  symbol: string;
  studies?: readonly Dataset[] | null;
  onShowPathway: (pathwayId: string) => void;
  onOpenPathway: (pathwayId: string) => void;
}) {
  return (
    <div className="portal-grid" data-cards="context">
      <ConditionPathwaysSection key={symbol} symbol={symbol} studies={studies} onShowPathway={onShowPathway} onOpenPathway={onOpenPathway} />
      {import.meta.env.VITE_HYPOMAP_COEXPRESSION === '1' ? <Coexpression key={`coexpression-${symbol}`} symbol={symbol} /> : <PlaceholderSlot slot="coexpression" title="Co-expression" wide>
        Genes whose expression rises and falls with {symbol} across populations and studies.
      </PlaceholderSlot>}
    </div>
  );
}
