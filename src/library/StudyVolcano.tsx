// The study record's volcano: the default track's result, drawn in place.
//
// Loading a track bundle here is NOT entering the explorer. It goes through the
// compare set's loader (useCompareSetColumns), which reads one bundle into its
// own state and never touches the explorer store, so looking at a record still
// resets nothing. The explorer is where a reader picks another track or
// contrast; this shows what the study found on the one it opens on.
//
// Nothing loads until the reader asks. The first "Show volcano" says they want
// plots, so the library remembers it and later records draw theirs on arrival,
// after a short settle so stepping through ten records fetches one bundle, not
// ten. The bundle cache makes a revisit free.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { VolcanoPlot } from '../gene-explorer/VolcanoPlot';
import { Spinner } from '../common/Spinner';
import { useVolcanoView } from '../explorer/explorerSession';
import { useCompareSetColumns } from '../compareset/useCompareSetColumns';
import type { CompareSetItem } from '../compareset/compareSetStore';
import type { DatasetCard } from '../data/datasetCatalog';
import type { PopData, VolcanoPoint } from '../types';
import { resolveGeneCI } from '../compare/resolveGene';
import { SaveGeneListMenu } from '../common/GeneListTools';
import type { GeneListRow } from '../utils/geneListFile';
import type { VolcanoView } from '../explorer/explorerSession';
import { fmtCutoff, fmtFDR, fmtP } from '../utils/format';
import { COLOR_WARNING_TEXT, DOWN_COLOR, FONT_MONO, UP_COLOR } from '../styles/constants';
import { DEFAULT_FDR_CUTOFF } from '../statistics/policy';

const SETTLE_MS = 350;
const PLOT_HEIGHT = 460;

interface StudyVolcanoProps {
  card: DatasetCard;
  onOpen: () => void;
  /** The reader has asked for volcanos in this library visit. */
  wanted: boolean;
  onWant: () => void;
}

export function StudyVolcano({ card, onOpen, wanted, onWant }: StudyVolcanoProps) {
  const d = card.dataset;

  // The item to load: none until wanted, then set once the record has held
  // still for a moment (at once when the reader has just clicked for it).
  const [item, setItem] = useState<CompareSetItem | null>(null);
  const [clicked, setClicked] = useState(false);
  useEffect(() => {
    if (!wanted) return;
    const t = setTimeout(() => setItem({ datasetId: d.id, trackId: d.defaultTrack }), clicked ? 0 : SETTLE_MS);
    return () => clearTimeout(t);
  }, [wanted, clicked, d.id, d.defaultTrack]);
  const items = useMemo(() => (item ? [item] : []), [item]);
  const { states } = useCompareSetColumns(items);
  const state = states[0] ?? null;

  // Thresholds and highlighted genes are this record's own, and start fresh on
  // each study (the record keys this component by study): a cutoff chosen for
  // one design says nothing about the next. It opens on FDR at the app's cutoff,
  // not the explorer's p-value default: the fact strip above counts the genes
  // that pass that cutoff, and a plot colouring a different set would
  // contradict it on the same page.
  const volcano = useVolcanoView({ metric: 'fdr', sigThresh: -Math.log10(DEFAULT_FDR_CUTOFF) });
  const [genes, setGenes] = useState<string[]>([]);
  const addGene = useCallback((g: string) => setGenes((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g])), []);
  const selectGene = useCallback((g: string) => setGenes((cur) => (cur.includes(g) ? cur : [...cur, g])), []);
  const addGenes = useCallback((gs: string[]) => setGenes((cur) => [...new Set([...cur, ...gs])]), []);

  // Each arm with its n, baseline first: which side is "up" is the most common
  // misreading of a volcano, so the heading states it before the axis does.
  const arm = (label: string, n: number | null) => (n == null ? label : `${label} (n=${n})`);
  const arms = card.baselineGroup && card.caseGroup
    ? `${arm(card.baselineGroup.label, card.nBaseline)} → ${arm(card.caseGroup.label, card.nCase)}`
    : null;
  const caseLabel = card.caseGroup?.label ?? 'case';
  const many = card.trackCount != null && card.trackCount > 1;
  const noun = d.trackNoun || 'track';

  return (
    <section aria-label="Volcano plot" className="study-record-card study-volcano">
      <div className="study-volcano-head">
        <span className="study-volcano-title">Volcano</span>
        {arms && <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: 'var(--text-mono)' }}>{arms}</span>}
        {card.trackLabel && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· {card.trackLabel}</span>
        )}
        {many && (
          <button type="button" className="study-volcano-more" onClick={onOpen}>
            {card.trackCount! - 1} more {noun}s in the explorer →
          </button>
        )}
      </div>
      {!wanted ? (
        <div className="study-volcano-offer">
          <button type="button" className="study-volcano-show" onClick={() => { setClicked(true); onWant(); }}>
            Show volcano plot
          </button>
          <span>and the top genes up and down</span>
        </div>
      ) : (
      <div className="study-volcano-frame" style={{ height: PLOT_HEIGHT }}>
        {state?.status === 'ready' && state.popData ? (
          <div className="study-volcano-split">
            <div className="study-volcano-plot">
              <VolcanoPlot selectedGenes={genes} volcano={volcano} onAddGene={addGene} onAddGenes={addGenes}
                popData={state.popData} />
            </div>
            <TopGenes popData={state.popData} volcano={volcano} caseLabel={caseLabel}
              fileStem={state.popData.meta?.code ?? d.id} selected={genes} onToggle={addGene} onSelect={selectGene} />
          </div>
        ) : state?.status === 'failed' || state?.status === 'unknown-track' ? (
          <div className="study-volcano-empty" style={{ color: COLOR_WARNING_TEXT }}>
            {state.status === 'failed'
              ? `The ${noun} could not be loaded${state.error ? `: ${state.error}` : ''}. The study still opens in the explorer.`
              : `This study has no ${noun} named ${d.defaultTrack}.`}
          </div>
        ) : (
          <div className="study-volcano-empty">
            <Spinner size={16} label={`Loading the ${noun}…`} />
          </div>
        )}
      </div>
      )}
    </section>
  );
}

const TOP_N = 8;
const SUGGEST_N = 6;

type Lookup =
  | { kind: 'found'; gene: string; logFC: number; pval: number; fdr: number | null; passes: 'up' | 'down' | null }
  | { kind: 'absent'; query: string };

/**
 * The strongest hits either way, beside the plot (after Single Cell Portal's and
 * iDEP's top-gene panels), with a gene search above them and the full pass list
 * as a download. The lists follow the plot's own thresholds, so they hold
 * exactly the coloured points; a click rings that gene on the plot.
 */
export function TopGenes({ popData, volcano, caseLabel, fileStem, selected, onToggle, onSelect }: {
  popData: PopData; volcano: VolcanoView; caseLabel: string; fileStem: string;
  selected: string[]; onToggle: (gene: string) => void; onSelect: (gene: string) => void;
}) {
  const points = popData.volcanoPts;
  const y = useCallback((p: VolcanoPoint) => (volcano.metric === 'pval' ? p.yPval : p.yFdr), [volcano.metric]);
  const passesPt = useCallback(
    (p: VolcanoPoint) => Math.abs(p.logfc) > volcano.logFCThresh && y(p) > volcano.sigThresh,
    [volcano.logFCThresh, volcano.sigThresh, y],
  );

  const { upAll, downAll } = useMemo(() => {
    const rank = (a: VolcanoPoint, b: VolcanoPoint) => y(b) - y(a) || Math.abs(b.logfc) - Math.abs(a.logfc);
    const pass = points.filter(passesPt);
    return { upAll: pass.filter((p) => p.logfc > 0).sort(rank), downAll: pass.filter((p) => p.logfc < 0).sort(rank) };
  }, [points, passesPt, y]);

  // The download: every passing gene, up then down in rank order, with the
  // untransformed statistics from the DE table, so the file says what the
  // lists and the plot say.
  const rows = useMemo<GeneListRow[]>(() => {
    const row = (p: VolcanoPoint, direction: 'up' | 'down'): GeneListRow => {
      const de = popData.deByGene[p.gene];
      return { Gene: p.gene, Direction: direction, log2FC: de?.logFC ?? p.logfc, PValue: de?.PValue ?? p.pval, FDR: de?.FDR ?? p.fdr ?? '' };
    };
    return [...upAll.map((p) => row(p, 'up')), ...downAll.map((p) => row(p, 'down'))];
  }, [upAll, downAll, popData.deByGene]);

  // ── Gene search ──
  const [query, setQuery] = useState('');
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const byGene = useMemo(() => new Map(points.map((p) => [p.gene, p])), [points]);
  const suggestions = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (q.length < 2 || lookup?.kind === 'found') return [];
    const out: string[] = [];
    for (const p of points) {
      if (p.gene.toUpperCase().startsWith(q)) out.push(p.gene);
      if (out.length >= SUGGEST_N) break;
    }
    return out;
  }, [query, points, lookup]);

  const find = (raw: string) => {
    const q = raw.trim();
    if (!q) { setLookup(null); return; }
    const de = resolveGeneCI(popData, q);
    const pt = de ? byGene.get(de.gene) : undefined;
    if (!de || !pt) { setLookup({ kind: 'absent', query: q }); return; }
    setQuery(de.gene);
    setLookup({
      kind: 'found', gene: de.gene, logFC: de.logFC, pval: de.PValue, fdr: de.FDR,
      passes: passesPt(pt) ? (pt.logfc > 0 ? 'up' : 'down') : null,
    });
    onSelect(de.gene);
  };

  const stat = volcano.metric === 'pval' ? 'P' : 'FDR';
  const cutoff = `${stat} < ${fmtCutoff(10 ** -volcano.sigThresh)}${volcano.logFCThresh > 0 ? `, |log2FC| > ${volcano.logFCThresh}` : ''}`;
  const list = (title: string, arrow: string, color: string, all: VolcanoPoint[]) => (
    <div className="study-top-genes-group">
      <div className="study-top-genes-head">
        <span style={{ color }}>{arrow}</span> {title}
        <span style={{ marginLeft: 'auto', fontFamily: FONT_MONO, color: 'var(--text-muted)' }}>{all.length.toLocaleString()}</span>
      </div>
      {all.length === 0 ? (
        <div className="study-top-genes-none">None pass {cutoff}.</div>
      ) : all.slice(0, TOP_N).map((p) => {
        const on = selected.includes(p.gene);
        return (
          <button key={p.gene} type="button" aria-pressed={on} onClick={() => onToggle(p.gene)}
            className="study-top-gene" title={`${p.gene}: log2FC ${p.logfc.toFixed(2)}, ${stat} ${volcano.metric === 'pval' ? fmtP(p.pval) : fmtFDR(p.fdr)}`}>
            <span className="study-top-gene-name">{p.gene}</span>
            <span style={{ color, fontFamily: FONT_MONO }}>{p.logfc > 0 ? '+' : ''}{p.logfc.toFixed(2)}</span>
            <span style={{ fontFamily: FONT_MONO, color: 'var(--text-muted)' }}>
              {volcano.metric === 'pval' ? fmtP(p.pval) : fmtFDR(p.fdr)}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <aside className="study-top-genes" aria-label="Top genes">
      <form className="study-gene-search" onSubmit={(e) => { e.preventDefault(); find(query); }}>
        <input type="search" aria-label="Find a gene in this study" placeholder="Find a gene…" value={query}
          spellCheck={false} autoComplete="off"
          onChange={(e) => { setQuery(e.target.value); setLookup(null); }} />
        {suggestions.length > 0 && (
          <div className="study-gene-suggest">
            {suggestions.map((g) => (
              <button key={g} type="button" onClick={() => find(g)}>{g}</button>
            ))}
          </div>
        )}
      </form>

      <div className="study-top-genes-foot">
        <SaveGeneListMenu rows={rows} filenameParts={[fileStem, 'passing_genes']} label="Download all"
          title={rows.length === 0 ? `No genes pass ${cutoff}` : `Download the ${rows.length.toLocaleString()} genes passing ${cutoff}, with direction, log2FC, P and FDR`}
          style={{ fontSize: 11.5, padding: '3px 8px' }} />
        <span>{rows.length.toLocaleString()} passing</span>
      </div>

      {lookup && (
        <output className="study-gene-result" aria-live="polite">
          {lookup.kind === 'absent' ? (
            // "Not tested" is a different claim from "not significant": the gene
            // is absent from this track's table (unexpressed or filtered), so
            // there is no statistic to show.
            <span><strong style={{ fontFamily: FONT_MONO }}>{lookup.query}</strong> is not in this track's results (not tested, or filtered out).</span>
          ) : (
            <>
              <span className="study-gene-result-line">
                <strong style={{ fontFamily: FONT_MONO }}>{lookup.gene}</strong>
                <span style={{ fontFamily: FONT_MONO, color: lookup.logFC > 0 ? UP_COLOR : DOWN_COLOR }}>
                  {lookup.logFC > 0 ? '+' : ''}{lookup.logFC.toFixed(2)}
                </span>
                <span style={{ fontFamily: FONT_MONO, color: 'var(--text-muted)' }}>P {fmtP(lookup.pval)} · FDR {fmtFDR(lookup.fdr)}</span>
              </span>
              <span style={{ color: 'var(--text-muted)' }}>
                {lookup.passes
                  ? <><span style={{ color: lookup.passes === 'up' ? UP_COLOR : DOWN_COLOR }}>{lookup.passes === 'up' ? '↑ Up' : '↓ Down'}</span> in {caseLabel} at {cutoff}; ringed on the plot.</>
                  : <>Tested, but does not pass {cutoff}; ringed on the plot.</>}
              </span>
            </>
          )}
        </output>
      )}

      <div className="study-top-genes-cols" aria-hidden="true">
        <span>Gene</span><span>log2FC</span><span>{stat}</span>
      </div>
      {list(`Up in ${caseLabel}`, '↑', UP_COLOR, upAll)}
      {list(`Down in ${caseLabel}`, '↓', DOWN_COLOR, downAll)}

    </aside>
  );
}
