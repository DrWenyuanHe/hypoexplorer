// The library card's result bars: what a study FOUND, not how big it was.
//
// WHY THIS REPLACED THE ARM PILLS AS THE CARD'S HEADLINE
// -----------------------------------------------------
// N was the card's lead number and in this corpus it is close to useless:
// counted across the 229 indexed tracks, the two largest studies on the shelf
// (23v22 and 18v18) return one and two significant genes, while a 3v4
// translatome returns 491 and a 4v4 rat study returns 7,029. N did not merely
// fail to predict the result, it pointed the wrong way. It is still on the card,
// in the corner, as context for these numbers rather than as a substitute.
//
// THE SCALE IS LOG, AND IT HAS TO BE
// ----------------------------------
// Across those tracks the median is 1 significant gene and the maximum is
// 10,154. On a linear axis three quarters of the corpus is a hairline. The bars
// are log1p, with visible ticks at the decades so the compression is stated
// rather than implied, and the count is always printed beside the bar because a
// log bar alone cannot be read to a number.
//
// ZERO IS A RESULT, NOT AN ABSENCE
// --------------------------------
// 38% of single-track datasets find no genes at FDR 0.05. That is a finding the
// old card hid completely, so it renders as words ("none at FDR 0.05") rather
// than as a stub bar a reader would mistake for "small". The null case - an
// index older than this feature - renders as nothing at all. Those two must
// never look alike; see DatasetCard.discoveries.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadCardDetail, type CardDetail, type DiscoverySummary } from '../data/queryIndex';
import { DEFAULT_FDR_CUTOFF } from '../statistics/policy';
import { FONT_MONO, FONT_SANS, UP_COLOR, DOWN_COLOR, UP_TEXT_COLOR, DOWN_TEXT_COLOR, COLOR_WARNING_TEXT } from '../styles/constants';
import type { Dataset } from '../types';

/** Announced on the document when any card opens a panel, so the others close. */
const SOLO_EVENT = 'result-popover-open';

/** Decades worth drawing a tick for. Anything above the corpus max is dropped. */
const DECADES = [10, 100, 1000, 10000];

/**
 * Bar length for a count on the shared log axis.
 *
 * log1p rather than log so zero maps to zero without a special case, and so a
 * count of 1 is visibly different from a count of 0 instead of both vanishing.
 */
export function barFraction(n: number, scaleMax: number): number {
  if (!(n > 0)) return 0;
  const top = Math.log1p(Math.max(scaleMax, 10));
  return Math.min(1, Math.log1p(n) / top);
}

/**
 * The axis maximum, from the whole corpus rather than the filtered view.
 *
 * Deliberately not recomputed per filter: a bar that grew when you ticked a
 * facet would be comparing studies against whatever else happened to be on
 * screen, and the point of a shared axis is that it does not do that.
 */
export function discoveryScaleMax(cards: ReadonlyArray<{ discoveries: DiscoverySummary | null }>): number {
  let max = 0;
  for (const c of cards) {
    const d = c.discoveries;
    if (!d) continue;
    if (d.genes > max) max = d.genes;
    if ((d.paths ?? 0) > max) max = d.paths as number;
  }
  return max;
}

const fmt = (n: number) => n.toLocaleString();

/**
 * What the bars mean, once, under the grid.
 *
 * Not optional decoration. A log axis is readable only if the reader knows it
 * is one, so the compression is carried by three things together: the decade
 * ticks inside each track, the count printed beside every bar, and this. Drop
 * any of the three and the bars start claiming a linear story.
 *
 * Reads its decades and its maximum from the same scale the bars use, so the
 * sentence cannot describe an axis the grid is not drawing.
 */
export function ResultScaleLegend({ scaleMax }: { scaleMax: number }) {
  const decades = DECADES.filter((d) => d <= Math.max(scaleMax, 10));
  const swatch = (color: string) => (
    <span aria-hidden="true" style={{ width: 14, height: 8, borderRadius: 1, background: color, flex: '0 0 auto' }} />
  );
  const item: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5 };
  return (
    <p style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px',
      margin: '12px 0 0', fontFamily: FONT_MONO, fontSize: 9.5, color: 'var(--text-muted)',
    }}>
      <span style={item}>{swatch(UP_COLOR)} up-regulated</span>
      <span style={item}>{swatch(DOWN_COLOR)} down-regulated</span>
      <span aria-hidden="true" style={{ flex: '1 1 60px', minWidth: 20, height: 1, background: 'var(--border)' }} />
      <span>
        Both bars read the same way: length is the count on a shared log axis, ticks at{' '}
        {decades.map((d) => fmt(d)).join(' \u00b7 ')}, full width at {fmt(scaleMax)}; the split
        inside is the up/down ratio. Counts are at FDR {DEFAULT_FDR_CUTOFF}.
      </span>
    </p>
  );
}

/**
 * The same two counts as a plain readout, for the study record.
 *
 * The modal used to drop them, so opening a card lost the numbers the reader
 * had just hovered to see.
 */
export function ResultSummaryRows({ discoveries }: { discoveries: DiscoverySummary | null }) {
  if (!discoveries) return null;
  const d = discoveries;
  const row = (label: string, n: number | null, tested: number | null, up: number | null, down: number | null) => (
    <div key={label} style={{
      display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
      padding: '5px 0', borderTop: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 74 }}>{label}</span>
      <span style={{ fontFamily: FONT_MONO, fontVariantNumeric: 'tabular-nums', fontSize: 12, color: n === 0 ? COLOR_WARNING_TEXT : 'var(--text-mono)' }}>
        {n == null ? '\u2014' : n === 0 ? 'none' : fmt(n)}
      </span>
      {n != null && n > 0 && (
        <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: 'var(--text-muted)' }}>
          of {fmt(tested ?? 0)} · <span style={{ color: UP_TEXT_COLOR }}>{fmt(up ?? 0)} up</span>
          {' '}<span style={{ color: DOWN_TEXT_COLOR }}>{fmt(down ?? 0)} down</span>
        </span>
      )}
      {n === 0 && (
        <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: 'var(--text-muted)' }}>of {fmt(tested ?? 0)} tested</span>
      )}
    </div>
  );
  return (
    <div style={{ marginTop: 6 }}>
      {row('Genes', d.genes, d.genesTested, d.genesUp, d.genesDown)}
      {row('Pathways', d.paths, d.pathsTested, d.pathsUp, d.pathsDown)}
      {d.tracksWithGenes > 1 && (
        <p style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
          Counts are for the default track. {d.tracksWithGenes} tracks in this study find genes.
        </p>
      )}
    </div>
  );
}

// ── The bars ────────────────────────────────────────────────────────────────

interface BarSpec {
  kind: 'genes' | 'paths';
  label: string;
  count: number | null;
  up: number | null;
  down: number | null;
  tested: number | null;
}

function specs(d: DiscoverySummary): BarSpec[] {
  return [
    { kind: 'genes', label: 'genes', count: d.genes, up: d.genesUp, down: d.genesDown, tested: d.genesTested },
    { kind: 'paths', label: 'pathways', count: d.paths, up: d.pathsUp, down: d.pathsDown, tested: d.pathsTested },
  ];
}

/**
 * Two bars, or nothing.
 *
 * Renders null when the index carries no counts, rather than a pair of empty
 * bars: an absent measurement and a measured zero are different claims.
 */
export function ResultBars({ dataset, discoveries, scaleMax, trackNoun }: {
  dataset: Dataset;
  discoveries: DiscoverySummary | null;
  scaleMax: number;
  trackNoun: string;
}) {
  const instanceId = useId();
  const [open, setOpen] = useState<'genes' | 'paths' | null>(null);
  const [pinned, setPinned] = useState(false);
  const anchors = useRef<Partial<Record<'genes' | 'paths', HTMLSpanElement | null>>>({});
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Escape returns focus to the bar, and the bar opens on focus. Without this
  // the panel reopens the instant it closes and Escape appears to do nothing.
  // The same guard QualityBadge carries, for the same reason.
  const suppressFocus = useRef(false);
  const cancelClose = useCallback(() => clearTimeout(closeTimer.current), []);
  const close = useCallback((returningFocus = false) => {
    cancelClose();
    suppressFocus.current = returningFocus;
    setOpen(null);
    setPinned(false);
  }, [cancelClose]);
  const scheduleClose = useCallback(() => {
    cancelClose();
    if (!pinned) closeTimer.current = setTimeout(() => setOpen(null), 180);
  }, [cancelClose, pinned]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  // One panel on screen at a time, across cards.
  //
  // Each card owns its own open state, so nothing stops two panels coexisting:
  // a pointer that jumps straight from one card's bar to another's leaves the
  // first open, and two floating panels over a grid is one too many. The same
  // document-level announcement QualityBadge uses, for the same reason.
  useEffect(() => {
    const otherOpened = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== instanceId) {
        clearTimeout(closeTimer.current);
        setOpen(null);
        setPinned(false);
      }
    };
    document.addEventListener(SOLO_EVENT, otherOpened);
    return () => document.removeEventListener(SOLO_EVENT, otherOpened);
  }, [instanceId]);

  const announce = useCallback(() => {
    document.dispatchEvent(new CustomEvent(SOLO_EVENT, { detail: instanceId }));
  }, [instanceId]);

  if (!discoveries) return null;

  return (
    <span style={{ display: 'grid', gap: 6, marginTop: 'auto', paddingTop: 5 }}>
      {specs(discoveries).map((spec) => (
        <ResultBar
          key={spec.kind}
          spec={spec}
          scaleMax={scaleMax}
          anchorRef={(el) => { anchors.current[spec.kind] = el; }}
          onOpen={(viaFocus) => {
            if (viaFocus && suppressFocus.current) { suppressFocus.current = false; return; }
            suppressFocus.current = false;
            cancelClose();
            announce();
            setOpen(spec.kind);
          }}
          onLeave={scheduleClose}
          onToggle={() => {
            if (pinned && open === spec.kind) close();
            else { cancelClose(); announce(); setPinned(true); setOpen(spec.kind); }
          }}
          expanded={open === spec.kind}
        />
      ))}
      {open && anchors.current[open] && (
        <ResultPanel
          anchor={anchors.current[open] as HTMLSpanElement}
          kind={open}
          dataset={dataset}
          discoveries={discoveries}
          trackNoun={trackNoun}
          onEnter={cancelClose}
          onLeave={scheduleClose}
          onClose={close}
        />
      )}
    </span>
  );
}

const BAR_ROW: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '52px minmax(0, 1fr) 46px',
  alignItems: 'center', gap: 8, borderRadius: 3, cursor: 'help',
};

/**
 * One bar.
 *
 * A <span> with a button role rather than a real button: the card's face is
 * already a button and a button cannot contain one. Same split the compare
 * toggle makes, for the same reason.
 */
function ResultBar({ spec, scaleMax, expanded, anchorRef, onOpen, onLeave, onToggle }: {
  spec: BarSpec; scaleMax: number; expanded: boolean;
  anchorRef: (el: HTMLSpanElement | null) => void;
  onOpen: (viaFocus: boolean) => void; onLeave: () => void; onToggle: () => void;
}) {
  const n = spec.count;
  // Null = not computed (no pathway sibling). Zero = computed and found none.
  const unmeasured = n == null;
  const none = n === 0;
  const frac = unmeasured ? 0 : barFraction(n, scaleMax);
  const upShare = !none && !unmeasured && (spec.up ?? 0) + (spec.down ?? 0) > 0
    ? ((spec.up ?? 0) / ((spec.up ?? 0) + (spec.down ?? 0))) * 100
    : 0;
  const title = unmeasured
    ? `No pathway enrichment was computed for this study`
    : none
      ? `No ${spec.label} reach FDR ${DEFAULT_FDR_CUTOFF} of ${fmt(spec.tested ?? 0)} tested`
      : `${fmt(n)} of ${fmt(spec.tested ?? 0)} ${spec.label} at FDR ${DEFAULT_FDR_CUTOFF} — ${fmt(spec.up ?? 0)} up, ${fmt(spec.down ?? 0)} down`;

  return (
    // biome-ignore lint/a11y/useSemanticElements: a <button> cannot nest inside the card's own button; the bar is keyboard-operable via role + tabIndex + onKeyDown
    <span
      ref={anchorRef}
      role="button"
      tabIndex={unmeasured ? -1 : 0}
      aria-expanded={unmeasured ? undefined : expanded}
      aria-label={title}
      title={title}
      style={{ ...BAR_ROW, cursor: unmeasured ? 'default' : 'help' }}
      onMouseEnter={unmeasured ? undefined : () => onOpen(false)}
      onMouseLeave={unmeasured ? undefined : onLeave}
      onFocus={unmeasured ? undefined : () => onOpen(true)}
      onBlur={unmeasured ? undefined : onLeave}
      // The card's face opens the study record; a bar must not also do that.
      onClick={unmeasured ? undefined : (e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (!unmeasured) onToggle(); }
      }}
    >
      <span style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: 'var(--text-muted)' }}>{spec.label}</span>
      <span style={{
        position: 'relative', height: 13, borderRadius: 2, overflow: 'hidden',
        background: 'var(--bg-app)', border: '1px solid var(--border)',
      }}>
        {!none && !unmeasured && DECADES.filter((d) => d <= Math.max(scaleMax, 10)).map((d) => (
          <span key={d} aria-hidden="true" style={{
            position: 'absolute', top: 0, bottom: 0, width: 1,
            left: `${barFraction(d, scaleMax) * 100}%`, background: 'var(--border)',
          }} />
        ))}
        {none && (
          <span style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 5,
            fontFamily: FONT_MONO, fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap',
          }}>
            none at FDR {String(DEFAULT_FDR_CUTOFF).replace(/^0/, '')}
          </span>
        )}
        {!none && !unmeasured && (
          // Length is the total on the log axis; the split inside it is the
          // up/down ratio. Two encodings, stated in the popover's legend.
          <span style={{
            position: 'absolute', top: 0, bottom: 0, left: 0, minWidth: 2,
            width: `${frac * 100}%`, background: DOWN_COLOR,
          }}>
            <span style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: `${upShare}%`, background: UP_COLOR }} />
          </span>
        )}
      </span>
      <span style={{
        fontFamily: FONT_MONO, fontVariantNumeric: 'tabular-nums', fontSize: 11,
        fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap',
        color: unmeasured ? 'var(--text-muted)' : 'var(--text-mono)',
      }}>
        {unmeasured ? '—' : fmt(n)}
      </span>
    </span>
  );
}

// ── The panel ───────────────────────────────────────────────────────────────

const PANEL_W = 272;

/**
 * The hover detail, in a portal.
 *
 * Portalled for the same reason QualityBadge is: the card sits in a scrolling
 * grid and an in-flow panel would be clipped by it. The placement rules are
 * that module's too — flip above when there is no room below, clamp to the
 * viewport, reposition on scroll and resize.
 */
function ResultPanel({ anchor, kind, dataset, discoveries, trackNoun, onEnter, onLeave, onClose }: {
  anchor: HTMLSpanElement;
  kind: 'genes' | 'paths';
  dataset: Dataset;
  discoveries: DiscoverySummary;
  trackNoun: string;
  onEnter: () => void;
  onLeave: () => void;
  onClose: (returningFocus?: boolean) => void;
}) {
  const id = useId();
  const panel = useRef<HTMLElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    const reposition = () => {
      const r = anchor.getBoundingClientRect();
      const h = panel.current?.offsetHeight ?? 220;
      const below = window.innerHeight - r.bottom - 10;
      const top = below >= h ? r.bottom + 6 : Math.max(8, r.top - h - 6);
      const left = Math.max(8, Math.min(r.left - 6, window.innerWidth - PANEL_W - 8));
      setPos({ top, left });
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault(); e.stopPropagation(); onClose(true);
        (anchor as HTMLElement).focus();
      }
    };
    // Capture, so the topmost panel closes before an enclosing dialog's handler.
    document.addEventListener('keydown', onEscape, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('keydown', onEscape, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: the panel is not a control; its onClick only stops the outside-click close from firing
    <section
      ref={panel}
      id={id}
      role="tooltip"
      aria-label={kind === 'genes' ? 'Differential expression detail' : 'Pathway enrichment detail'}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', zIndex: 9000, top: pos.top, left: pos.left, width: PANEL_W,
        background: 'var(--bg-panel)', border: '1px solid var(--border-dark)', borderRadius: 6,
        boxShadow: '0 8px 32px rgba(0,0,0,0.16)', padding: '11px 12px 10px',
        fontFamily: FONT_SANS, textAlign: 'left', color: 'var(--text-primary)',
      }}
    >
      {kind === 'genes'
        ? <GenePanel dataset={dataset} d={discoveries} trackNoun={trackNoun} />
        : <PathPanel d={discoveries} />}
    </section>,
    document.body,
  );
}

const HEAD: React.CSSProperties = {
  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
  gap: 8, marginBottom: 7,
};
const STAT: React.CSSProperties = {
  fontFamily: FONT_MONO, fontVariantNumeric: 'tabular-nums', fontSize: 10.5, color: 'var(--text-mono)',
};
const FOOT: React.CSSProperties = {
  marginTop: 8, paddingTop: 7, borderTop: '1px solid var(--border)',
  fontSize: 9.5, color: 'var(--text-muted)',
};

function Split({ up, down }: { up: number; down: number }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginTop: 5, fontFamily: FONT_MONO, fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-mono)' }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: UP_COLOR }} />{fmt(up)} up
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-mono)' }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: DOWN_COLOR }} />{fmt(down)} down
      </span>
    </div>
  );
}

function GenePanel({ dataset, d, trackNoun }: { dataset: Dataset; d: DiscoverySummary; trackNoun: string }) {
  const none = d.genes === 0;
  return <>
    <div style={HEAD}>
      <span style={{ fontSize: 11, fontWeight: 600 }}>Differential expression</span>
      <span style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        {dataset.geo || dataset.id}
      </span>
    </div>
    <div style={STAT}>
      {none
        ? <><span style={{ color: COLOR_WARNING_TEXT, fontWeight: 600 }}>No genes</span> reach FDR {DEFAULT_FDR_CUTOFF}
          <span style={{ color: 'var(--text-muted)' }}> of {fmt(d.genesTested)} tested</span></>
        : <><b style={{ fontSize: 14 }}>{fmt(d.genes)}</b> of {fmt(d.genesTested)} genes at FDR {DEFAULT_FDR_CUTOFF}</>}
    </div>
    {!none && <Split up={d.genesUp} down={d.genesDown} />}
    <Volcano dataset={dataset} />
    <p style={FOOT}>
      {none
        ? 'A flat cloud beneath the line is the result, not a missing one.'
        : 'Open the study for the full volcano and the gene table.'}
      {d.tracksWithGenes > 1 && ` ${d.tracksWithGenes} ${trackNoun}s in this study find genes.`}
    </p>
  </>;
}

/** Display names for the bundle's own database keys. */
const DB_LABEL: Record<string, string> = {
  GO_BP: 'GO:BP', GOBP: 'GO:BP', HALLMARK: 'Hallmark', KEGG: 'KEGG', REACTOME: 'Reactome',
};
const DB_ORDER = ['GO_BP', 'GOBP', 'HALLMARK', 'KEGG', 'REACTOME'];

function PathPanel({ d }: { d: DiscoverySummary }) {
  const dbs = Object.entries(d.pathsByDb ?? {})
    .sort((a, b) => DB_ORDER.indexOf(a[0]) - DB_ORDER.indexOf(b[0]));
  // Bars scale to the largest single count so a database that disagrees with
  // the study's overall direction shows as an arm crossing the centre.
  const peak = Math.max(1, ...dbs.map(([, c]) => Math.max(c.up, c.down)));
  return <>
    <div style={HEAD}>
      <span style={{ fontSize: 11, fontWeight: 600 }}>Pathway enrichment</span>
    </div>
    <div style={STAT}>
      {d.paths === 0
        ? <><span style={{ color: COLOR_WARNING_TEXT, fontWeight: 600 }}>No terms</span> reach FDR {DEFAULT_FDR_CUTOFF}
          <span style={{ color: 'var(--text-muted)' }}> of {fmt(d.pathsTested ?? 0)} tested</span></>
        : <><b style={{ fontSize: 14 }}>{fmt(d.paths ?? 0)}</b> of {fmt(d.pathsTested ?? 0)} terms at FDR {DEFAULT_FDR_CUTOFF}</>}
    </div>
    {(d.paths ?? 0) > 0 && <Split up={d.pathsUp ?? 0} down={d.pathsDown ?? 0} />}
    <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
      {dbs.map(([key, c]) => (
        <div key={key} style={{
          display: 'grid', gridTemplateColumns: '58px minmax(0, 1fr) 58px',
          alignItems: 'center', gap: 7, fontFamily: FONT_MONO, fontSize: 9.5,
        }}>
          <span style={{ color: 'var(--text-mono)', whiteSpace: 'nowrap' }}>{DB_LABEL[key] ?? key}</span>
          <span style={{
            position: 'relative', height: 11, background: 'var(--bg-app)',
            border: '1px solid var(--border)', borderRadius: 2,
          }}>
            <span aria-hidden="true" style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--border-dark)' }} />
            <span style={{ position: 'absolute', top: 1, bottom: 1, right: '50%', width: `${(c.down / peak) * 50}%`, background: DOWN_COLOR }} />
            <span style={{ position: 'absolute', top: 1, bottom: 1, left: '50%', width: `${(c.up / peak) * 50}%`, background: UP_COLOR }} />
          </span>
          <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            <span style={{ color: DOWN_TEXT_COLOR }}>{c.down}</span>
            <span style={{ color: 'var(--text-muted)' }}> · </span>
            <span style={{ color: UP_TEXT_COLOR }}>{c.up}</span>
          </span>
        </div>
      ))}
    </div>
    <p style={FOOT}>Down left of centre, up right. Bars scale to the largest single count.</p>
  </>;
}

// ── Volcano ─────────────────────────────────────────────────────────────────

const PLOT = { w: 246, h: 128, r: 1.35 };

/**
 * The cloud, on canvas.
 *
 * Canvas rather than ~900 SVG nodes, the same call VolcanoPlot.tsx makes for
 * the same reason. The dashed rule is the bar's own FDR cutoff, so the points
 * above it are exactly the number printed on the bar — the popover explains the
 * count rather than introducing a second one.
 */
function Volcano({ dataset }: { dataset: Dataset }) {
  const [detail, setDetail] = useState<CardDetail | null | 'pending' | 'absent'>('pending');
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cutY, setCutY] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    const buildId = typeof __QUERY_CATALOG_BUILD_ID__ === 'string' ? __QUERY_CATALOG_BUILD_ID__ : '';
    if (!buildId) { setDetail('absent'); return () => { live = false; }; }
    loadCardDetail(dataset, buildId)
      .then((d) => { if (live) setDetail(d ?? 'absent'); })
      .catch(() => { if (live) setDetail('absent'); });
    return () => { live = false; };
  }, [dataset]);

  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el || !detail || detail === 'pending' || detail === 'absent') return;
    const dpr = window.devicePixelRatio || 1;
    el.width = PLOT.w * dpr; el.height = PLOT.h * dpr;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, PLOT.w, PLOT.h);

    const pad = { l: 4, r: 4, t: 5, b: 4 };
    const W = PLOT.w - pad.l - pad.r, H = PLOT.h - pad.t - pad.b;
    const xlim = detail.xlim || 1;
    // biome-ignore lint/correctness/noComponentHookFactories: canvas x scale, not a component
    const X = (x: number) => pad.l + ((Math.max(-xlim, Math.min(xlim, x)) + xlim) / (2 * xlim)) * W;
    // biome-ignore lint/correctness/noComponentHookFactories: canvas y scale, not a component
    const Y = (y: number) => pad.t + H - (Math.min(y, detail.ymax) / detail.ymax) * H;

    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(0) + 0.5, pad.t); ctx.lineTo(X(0) + 0.5, pad.t + H); ctx.stroke();

    const yc = Y(detail.ycut);
    ctx.save();
    ctx.strokeStyle = '#D97706'; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(pad.l, yc + 0.5); ctx.lineTo(pad.l + W, yc + 0.5); ctx.stroke();
    ctx.restore();

    const dot = (p: [number, number], fill: string) => {
      ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), PLOT.r, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill();
    };
    // Null cloud first, so a discovery is never buried under it.
    ctx.globalAlpha = 0.5;
    for (const p of detail.pts) if (p[1] <= detail.ycut) dot(p, '#cbd5e0');
    ctx.globalAlpha = 0.72;
    for (const p of detail.pts) if (p[1] > detail.ycut) dot(p, p[0] > 0 ? UP_COLOR : DOWN_COLOR);
    ctx.globalAlpha = 1;
    setCutY(yc);
  }, [detail]);

  const frame: React.CSSProperties = {
    position: 'relative', height: PLOT.h, background: 'var(--bg-app)',
    border: '1px solid var(--border)', borderRadius: 3, overflow: 'hidden',
  };
  const note: React.CSSProperties = {
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: FONT_MONO, fontSize: 9.5, color: 'var(--text-muted)',
  };

  return (
    <figure style={{ marginTop: 8 }}>
      <div style={frame}>
        {detail === 'pending' && <span style={note}>loading…</span>}
        {detail === 'absent' && <span style={note}>plot unavailable</span>}
        {detail && detail !== 'pending' && detail !== 'absent' && <>
          <canvas ref={canvas} style={{ display: 'block', width: '100%', height: '100%' }} />
          <span style={{
            position: 'absolute', left: 3, top: 3, padding: '0 3px', borderRadius: 2,
            fontFamily: FONT_MONO, fontSize: 8.5, color: 'var(--text-muted)',
            background: 'color-mix(in srgb, var(--bg-app) 88%, transparent)',
          }}>−log₁₀ FDR</span>
          {cutY != null && (
            <span style={{
              position: 'absolute', right: 3, top: cutY, transform: 'translateY(-50%)',
              padding: '0 3px', borderRadius: 2, fontFamily: FONT_MONO, fontSize: 8.5,
              color: COLOR_WARNING_TEXT, background: 'color-mix(in srgb, var(--bg-app) 88%, transparent)',
            }}>FDR {String(DEFAULT_FDR_CUTOFF).replace(/^0/, '')}</span>
          )}
        </>}
      </div>
      {detail && detail !== 'pending' && detail !== 'absent' && (
        <figcaption style={{
          marginTop: 5, display: 'flex', justifyContent: 'space-between', gap: 8,
          fontFamily: FONT_MONO, fontSize: 9, color: 'var(--text-muted)',
        }}>
          <span>−{detail.xlim} logFC</span><span>0</span><span>+{detail.xlim}</span>
        </figcaption>
      )}
    </figure>
  );
}
