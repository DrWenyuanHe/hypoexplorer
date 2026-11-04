// The gene and pathway cards shared by the search page and the gene page:
// a gene's baseline expression in sorted mouse hypothalamic populations, its
// values in the human reference atlases (GTEx, HPA, Allen), the pathways
// enriched in the conditions where it changes, and reserved slots for data
// that is not built yet (mouse single-cell atlases, co-expression), so a
// layout does not shift when it arrives.
//
// Everything here reads cheap sources only: the query index (plus one small
// track-pathways file per followed condition), the same-origin NeuroSeq files
// and the same-origin external reference shards. See ./searchSummaries.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { dirGlyph } from '../crossdataset/forestReport';
import { DEFAULT_FDR_CUTOFF } from '../statistics/policy';
import { DOWN_TEXT_COLOR, NEUTRAL_TEXT_COLOR, UP_TEXT_COLOR } from '../styles/constants';
import { fmtFDR, fmtP, fmtSigned } from '../utils/format';
import { DbBadge } from './DbBadge';
import { describePathway } from './searchVocabulary';
import {
  loadBaselineTeaser, loadConditionPathways, loadReferenceAtlases,
  type BaselineTeaser, type ConditionPathway, type ConditionRef, type ReferenceAtlas, type ReferenceAtlases, type ReferenceLevel,
} from './searchSummaries';
import type { Dataset, Direction } from '../types';
import './search.css';

// ── Small async helper ──────────────────────────────────────────────────────

type Load<T> = { state: 'loading' } | { state: 'done'; value: T };

/** Run `load` whenever `key` changes; stale answers for an older key are dropped. */
export function useLoad<T>(key: string, load: (key: string) => Promise<T>): Load<T> {
  const [result, setResult] = useState<{ key: string; value: T } | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let live = true;
    loadRef.current(key).then((value) => { if (live) setResult({ key, value }); });
    return () => { live = false; };
  }, [key]);
  return result && result.key === key ? { state: 'done', value: result.value } : { state: 'loading' };
}

// ── Formatting ─────────────────────────────────────────────────────────────

export function dirColor(direction: Direction, significant: boolean): string {
  if (!significant) return NEUTRAL_TEXT_COLOR;
  return direction === 'up' ? UP_TEXT_COLOR : direction === 'down' ? DOWN_TEXT_COLOR : NEUTRAL_TEXT_COLOR;
}

export function Effect({ value, direction, significant }: { value: number; direction: Direction; significant: boolean }) {
  return (
    <span className="search-effect" style={{ color: dirColor(direction, significant) }}>
      <span aria-hidden="true">{dirGlyph(direction)} </span>{fmtSigned(value, 2)}
    </span>
  );
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
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

/** Never settles: a card whose study selection is not decided yet stays loading. */
const PENDING = new Promise<never>(() => {});

export function ConditionPathwaysSection({ symbol, studies, onShowPathway, onOpenPathway }: {
  symbol: string;
  /** Follow only these studies' conditions; omitted, every indexed study. null while still being decided. */
  studies?: readonly Dataset[] | null;
  onShowPathway: (pathwayId: string) => void;
  onOpenPathway: (pathwayId: string) => void;
}) {
  const key = studies === null ? '' : `${symbol}\u0000${studies ? studies.map((d) => d.id).sort().join(',') : '*'}`;
  const load = useLoad(key, (k) => (k ? loadConditionPathways(symbol, studies ?? undefined) : PENDING));
  const [expanded, setExpanded] = useState(false);
  const data = load.state === 'done' ? load.value : null;

  // An index without the track-pathways family (or one that cannot answer for
  // these studies) keeps the reserved slot, so the layout does not change.
  if (load.state === 'done' && !data) {
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
                          <span className="cp-cond-fc" style={{ color: dirColor(c.track.direction, true) }}>
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

// ── Baseline expression teaser ─────────────────────────────────────────────

const BASELINE_TOP = 5;

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

export function BaselineSection({ symbol }: { symbol: string }) {
  const load = useLoad<BaselineTeaser | null>(symbol, loadBaselineTeaser);
  const teaser = load.state === 'done' ? load.value : null;
  return (
    <section className="portal-source" data-section="baseline-expression" aria-labelledby="portal-baseline-title">
      <SourceTitle id="portal-baseline-title" name="NeuroSeq" method="sorted populations" />
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
            {teaser.populations.slice(0, BASELINE_TOP).map((p) => (
              <li key={p.id}>
                <span className="portal-bar-label">{p.label}</span>
                <span className="portal-bar-track" aria-hidden="true">
                  <span className="portal-bar" style={{ width: `${teaser.max > 0 ? Math.max(1, (p.meanTpm / teaser.max) * 100) : 0}%` }} />
                </span>
                <span className="portal-bar-value">{fmtTpm(p.meanTpm)}</span>
              </li>
            ))}
          </ul>
          <p className="portal-note">
            Mean TPM across sorted-neuron libraries; top {BASELINE_TOP} of {teaser.populationCount} populations.
          </p>
        </>
      )}
    </section>
  );
}

// ── Human reference atlases ────────────────────────────────────────────────
//
// GTEx, HPA and Allen values for the human gene of this symbol, each in its
// own unit. Nothing is converted, ranked across atlases or pooled with mouse
// data; a symbol that differs from the human gene's is shown as a match.

const REFERENCE_LEVELS_TOP = 4;
const CLUSTERS_TOP = 5;

function fmtLog2(value: number): string {
  return value.toFixed(2);
}

/** Why an atlas has no values for this gene, or null when it has them. */
function atlasGap(atlas: ReferenceAtlas, symbol: string): string | null {
  if (atlas.status === 'unavailable') return 'This atlas could not be loaded.';
  if (atlas.status === 'not-retained') return `${symbol} is not in this atlas.`;
  if (atlas.status === 'ambiguous') return `${symbol} matches more than one gene (${atlas.candidates.join(', ')}). Open the survey to choose one.`;
  return null;
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
            Median of {spread.donors} donors; interquartile {fmtTpm(spread.low)}–{fmtTpm(spread.high)}.
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
            Each row is one probe, a short DNA sequence on the array that detects{' '}
            {atlas.status === 'available' ? atlas.gene : symbol} RNA. Values are log2 signal: each donor's mean
            over their hypothalamic samples ({first.samples} across {first.donors} donors), then the median and
            the lowest to highest donor.
            Higher means more RNA; the scale is not comparable with TPM.
          </p>
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
 * The human column of the expression section: GTEx and Allen whole-tissue
 * readouts, then the HPA subregions and snRNA-seq clusters. One load serves
 * every atlas; a provider that fails leaves only its own block empty.
 */
export function ReferenceAtlasSection({ symbol }: { symbol: string }) {
  const load = useLoad<ReferenceAtlases | null>(symbol, loadReferenceAtlases);
  const atlases = load.state === 'done' ? load.value : null;
  const human = matchedGene(atlases, symbol);
  return (
    <section className="gene-expr-lane" data-section="reference-atlases" aria-labelledby="portal-ref-title">
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
          <div className="gene-expr-sources">
            <GtexAtlas atlas={atlases.gtex} symbol={symbol} />
            <AllenAtlas atlas={atlases.allen} symbol={symbol} />
            <SubregionAtlas atlas={atlases.subregions} symbol={symbol} />
            <ClustersAtlas atlas={atlases.clusters} symbol={symbol} />
          </div>
        </>
      )}
    </section>
  );
}

// ── Gene page groups ───────────────────────────────────────────────────────

/**
 * Where the gene is expressed, as one section: mouse sources beside the human
 * reference atlases, each source in its own unit, then the way to the survey.
 */
export function GeneExpressionCards({ symbol, onOpenExpression }: { symbol: string; onOpenExpression?: () => void }) {
  return (
    <section className="portal-card gene-expr" data-cards="expression" aria-labelledby="gene-expr-title">
      <h2 id="gene-expr-title" className="portal-card-title">Where {symbol} is expressed</h2>
      <div className="gene-expr-lanes">
        <section className="gene-expr-lane" data-species="mouse" aria-labelledby="gene-expr-mouse-title">
          <h3 id="gene-expr-mouse-title" className="gene-expr-lane-title">Mouse hypothalamus</h3>
          <BaselineSection symbol={symbol} />
          <section className="portal-source portal-source--soon" data-slot="single-cell-mouse" aria-label="Single-cell atlases (coming soon)">
            <h4 className="portal-source-title">Single-cell atlases <span className="portal-soon">Coming soon</span></h4>
            <p className="portal-note">{symbol} expression by cell type across mouse hypothalamic single-cell atlases.</p>
          </section>
        </section>
        <ReferenceAtlasSection symbol={symbol} />
      </div>
      <div className="gene-expr-foot">
        <p className="portal-note">
          Each source keeps its own published unit, and its bars are scaled to its own highest value. Every sample,
          probe and donor, with exports and sources: the expression survey, Tissue &amp; bulk → Reference atlases.
        </p>
        {onOpenExpression && (
          <button type="button" className="portal-secondary" onClick={onOpenExpression}>Open expression survey</button>
        )}
      </div>
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
      <PlaceholderSlot slot="coexpression" title="Co-expression" wide>
        Genes whose expression rises and falls with {symbol} across populations and studies.
      </PlaceholderSlot>
    </div>
  );
}
