import { useState, useRef, useMemo, useCallback, useEffect, useId } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { fmtCutoff, fmtP, fmtFDR } from '../utils/format';
import { groupLabels } from '../utils/sampleValues';
import { niceTicks } from '../utils/axes';
import { EmptyState } from '../common/EmptyState';
import { MenuGroup, MenuItem, ToolbarPopover } from '../common/ToolbarPopover';
import { useExportAction } from '../utils/exportAction';
import { GENE_LIST_SAVE_FORMATS, saveGeneList } from '../utils/geneListFile';
import { UP_COLOR, DOWN_COLOR, UP_TEXT_COLOR, DOWN_TEXT_COLOR, FONT_MONO, FONT_SANS } from '../styles/constants';
import type { PopData, VolcanoPoint } from '../types';
import type { VolcanoView } from '../explorer/explorerSession';
import type { GeneListRow } from '../utils/geneListFile';
import { VolcanoTable } from './VolcanoTable';
import { VOLCANO_SELECTED_BACKGROUND, VOLCANO_SELECTED_COLOR } from './volcanoColors';
import './volcanoToolbar.css';

function readDpr(): number {
  return typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
}

// `top` is the floor of the top margin; the key line (counts and legend) sits
// in that margin and the component grows it to the line's measured height (see
// `legendH`), so a line that wraps on a phone pushes the plot down instead of
// covering it.
const VM = { top: 26, right: 20, bottom: 48, left: 58 };
// Below this plot width the key line starts at the panel edge rather than the
// y axis, and the click hint is dropped.
const NARROW_PLOT = 600;
const GRID_CELL = 40; // spatial index cell size in SVG px
const HIT_RADIUS_SQ = 28 * 28;

// `dx`/`dy` is the pointer's offset from the point, so the tooltip moves with
// the point when the plot resizes. `source` is the point list it was read from.
// `held` is where a click left the pointer.
interface PointerAt { clientX: number; clientY: number }
type Tooltip = (VolcanoPoint & { dx: number; dy: number; source: VolcanoPoint[]; held?: PointerAt }) | null;
interface PlacedPoint { pt: VolcanoPoint; px: number; py: number }

// Whether the pointer is still where a click left it, to the pixel: a click
// reports whole pixels, a pointer move may report fractions.
const isHeld = (tooltip: Tooltip, at: PointerAt): boolean => !!tooltip?.held
  && Math.abs(tooltip.held.clientX - at.clientX) < 1 && Math.abs(tooltip.held.clientY - at.clientY) < 1;

interface VolcanoPlotProps {
  selectedGenes: string[];
  /** Metric + thresholds as one value. `selectMetric` carries the pairing that
   *  used to live in this file's own onClick: the two metrics sit on different
   *  scales, so choosing one must also move the cutoff line. */
  volcano: VolcanoView;
  onAddGene: (gene: string) => void;
  onAddGenes?: (genes: string[]) => void;
  popData: PopData;
  /** Controls placed first on the toolbar row: the Gene Explorer's search and Gene list menu. */
  toolbarLead?: ReactNode;
  /** A strip under the toolbar row: the Gene Explorer's selection (count, views, chips). */
  toolbarBelow?: ReactNode;
}

export function VolcanoPlot({
  selectedGenes, volcano,
  onAddGene, onAddGenes, popData, toolbarLead, toolbarBelow,
}: VolcanoPlotProps) {
  const {
    metric: volcanoMetric, selectMetric,
    logFCThresh: volcanoLogFCThresh, setLogFCThresh: setVolcanoLogFCThresh,
    sigThresh: volcanoSigThresh, setSigThresh: setVolcanoSigThresh,
  } = volcano;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const [svgSize, setSvgSize] = useState({ w: 600, h: 360 });
  const [legendH, setLegendH] = useState(0);
  const [tooltip, setTooltip] = useState<Tooltip>(null);
  const [showPassList, setShowPassList] = useState(false);
  const [view, setView] = useState<'plot' | 'table'>('plot');
  // Device-pixel ratio drives the canvas backing-store scale. Tracked in state
  // (not read once at paint time) so dragging the window to a different-DPI
  // monitor or a browser zoom — neither of which necessarily resizes the
  // container — still repaints the point cloud crisply.
  const [dpr, setDpr] = useState(readDpr);
  const lastMove = useRef(0);
  const uid = useId();
  const { busy: savingPass, run: runSavePass } = useExportAction();
  const sigName = volcanoMetric === 'pval' ? 'P' : 'FDR';
  // The same figures as the dashed lines' own labels.
  const thresholdSummary = `${sigName} < ${fmtCutoff(10 ** -volcanoSigThresh)} · |log₂FC| > ${+volcanoLogFCThresh.toFixed(2)}`;
  const selectedSet = useMemo(() => new Set(selectedGenes), [selectedGenes]);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSvgSize({ w: Math.max(280, width), h: Math.max(180, height) });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // The legend's own height sets the plot's top margin. The legend is absent
  // in the table view and the empty state, so re-attach when either changes.
  const hasPoints = popData.volcanoPts.length > 0;
  useEffect(() => {
    const el = legendRef.current;
    if (!el || view !== 'plot' || !hasPoints) return;
    const obs = new ResizeObserver(() => setLegendH(Math.ceil(el.getBoundingClientRect().height)));
    obs.observe(el);
    return () => obs.disconnect();
  }, [view, hasPoints]);
  const M = useMemo(() => ({ ...VM, top: Math.max(VM.top, legendH + 4) }), [legendH]);

  // Watch for devicePixelRatio changes. A media query keyed to the current ratio
  // fires when it leaves that value (monitor switch / zoom); re-subscribe on each
  // change to re-arm for the new ratio. matchMedia is absent in jsdom — guard it.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const update = () => setDpr(readDpr());
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
    mq.addEventListener('change', update);
    window.addEventListener('resize', update);
    return () => {
      mq.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, [dpr]);

  const narrow = svgSize.w < NARROW_PLOT;
  const chartW = svgSize.w - M.left - M.right;
  const chartH = svgSize.h - M.top - M.bottom;
  // Dynamic per-pop range; floors at ±5 so common cases still show ticks at -5/+4.
  const { xMin, xMax } = useMemo(() => {
    let lo = 0, hi = 0;
    for (const pt of popData.volcanoPts) {
      if (pt.logfc < lo) lo = pt.logfc;
      if (pt.logfc > hi) hi = pt.logfc;
    }
    const bound = Math.max(Math.abs(lo), Math.abs(hi), 5) * 1.05;
    return { xMin: -bound, xMax: bound };
  }, [popData.volcanoPts]);
  const yMaxData = useMemo(() => {
    let m = 0;
    for (const pt of popData.volcanoPts) {
      const y = volcanoMetric === 'pval' ? pt.yPval : pt.yFdr;
      if (y > m) m = y;
    }
    return m;
  }, [popData.volcanoPts, volcanoMetric]);
  const yDomMax = (Math.max(yMaxData, volcanoSigThresh) || 1) * 1.08;

  const toSvgX = useCallback((v: number) => M.left + (v - xMin) / (xMax - xMin) * chartW, [M, chartW, xMin, xMax]);
  const toSvgY = useCallback((v: number) => M.top + (1 - v / yDomMax) * chartH, [M, chartH, yDomMax]);

  // Compute per-point render data + counts + spatial grid.
  // One pass replaces the old two-pass (ptColor + grey/colored partition).
  const { greyPts, colorPts, selectedPts, upGenes, downGenes, upCount, downCount, passCount, grid } = useMemo(() => {
    const greyPts: Array<{ px: number; py: number }> = [];
    const colorPts: Array<{ px: number; py: number; color: string }> = [];
    const selectedPts: PlacedPoint[] = [];
    const upGenes: string[] = [];
    const downGenes: string[] = [];
    const grid = new Map<string, PlacedPoint[]>(); // key `${gx}:${gy}` → array of {pt, px, py}
    for (const pt of popData.volcanoPts) {
      const y = volcanoMetric === 'pval' ? pt.yPval : pt.yFdr;
      const px = toSvgX(pt.logfc);
      const py = toSvgY(y);
      const gx = Math.floor(px / GRID_CELL);
      const gy = Math.floor(py / GRID_CELL);
      const key = `${gx}:${gy}`;
      let cell = grid.get(key);
      if (!cell) { cell = []; grid.set(key, cell); }
      cell.push({ pt, px, py });

      // Count pass-threshold genes regardless of selection state. Selected genes
      // that pass the threshold stay above the dashed lines on the plot, so the
      // "N genes pass" badge should include them even though they render purple.
      const passes = Math.abs(pt.logfc) > volcanoLogFCThresh && y > volcanoSigThresh;
      if (passes) {
        if (pt.logfc > 0) upGenes.push(pt.gene);
        else downGenes.push(pt.gene);
      }

      if (selectedSet.has(pt.gene)) {
        selectedPts.push({ pt, px, py });
        continue;
      }
      if (passes) {
        const color = pt.logfc > 0 ? UP_COLOR : DOWN_COLOR;
        colorPts.push({ px, py, color });
      } else {
        greyPts.push({ px, py });
      }
    }
    // Sort each direction by magnitude of logFC so the most extreme show first.
    const byMag = popData.deByGene;
    upGenes.sort((a, b) => Math.abs(byMag?.[b]?.logFC ?? 0) - Math.abs(byMag?.[a]?.logFC ?? 0));
    downGenes.sort((a, b) => Math.abs(byMag?.[b]?.logFC ?? 0) - Math.abs(byMag?.[a]?.logFC ?? 0));
    const upCount = upGenes.length;
    const downCount = downGenes.length;
    const passCount = upCount + downCount;
    return { greyPts, colorPts, selectedPts, upGenes, downGenes, upCount, downCount, passCount, grid };
  }, [popData.volcanoPts, popData.deByGene, volcanoMetric, volcanoLogFCThresh, volcanoSigThresh, selectedSet, toSvgX, toSvgY]);

  const totalCount = popData.volcanoPts.length;
  const passingGenes = useMemo(() => new Set([...upGenes, ...downGenes]), [upGenes, downGenes]);
  // Contrast direction labels (e.g. Obese/Normal, HFD/Chow) drive the axis +
  // up/down headings so non-macaque datasets aren't mislabelled.
  const { baselineLabel: baseLabel, caseLabel } = groupLabels(popData?.contrast);

  // The pass list as file rows: up first, then down, each with the statistics
  // it was judged on. Read from the DE table rather than the volcano points so
  // the file carries the untransformed p and FDR, not their -log10.
  const passRows = useMemo<GeneListRow[]>(() => {
    const row = (gene: string, direction: 'up' | 'down'): GeneListRow => {
      const de = popData.deByGene[gene];
      return { Gene: gene, Direction: direction, log2FC: de?.logFC ?? '', PValue: de?.PValue ?? '', FDR: de?.FDR ?? '' };
    };
    return [...upGenes.map((g) => row(g, 'up')), ...downGenes.map((g) => row(g, 'down'))];
  }, [upGenes, downGenes, popData.deByGene]);

  // Canvas paint: redraws on threshold / metric / size changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.round(svgSize.w * dpr);
    canvas.height = Math.round(svgSize.h * dpr);
    canvas.style.width = `${svgSize.w}px`;
    canvas.style.height = `${svgSize.h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom / headless envs without canvas
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, svgSize.w, svgSize.h);

    // Grey background layer (one fill color)
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#aaa';
    for (const p of greyPts) {
      ctx.beginPath();
      ctx.arc(p.px, p.py, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Colored pass-threshold points, grouped by color for fewer state switches
    ctx.globalAlpha = 0.8;
    let currentFill: string | null = null;
    for (const p of colorPts) {
      if (p.color !== currentFill) {
        ctx.fillStyle = p.color;
        currentFill = p.color;
      }
      ctx.beginPath();
      ctx.arc(p.px, p.py, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Purple diamonds stay distinct from red/blue circles, including without color.
    ctx.globalAlpha = 1;
    ctx.fillStyle = VOLCANO_SELECTED_COLOR;
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    for (const s of selectedPts) {
      ctx.beginPath();
      ctx.moveTo(s.px, s.py - 7);
      ctx.lineTo(s.px + 7, s.py);
      ctx.lineTo(s.px, s.py + 7);
      ctx.lineTo(s.px - 7, s.py);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }, [greyPts, colorPts, selectedPts, svgSize, dpr]);

  const pointAt = useCallback((e: MouseEvent<SVGSVGElement>): Tooltip => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    if (mx < M.left || mx > M.left + chartW || my < M.top || my > M.top + chartH) {
      return null;
    }
    // Spatial-index hit test: inspect only the 9 grid cells around the mouse.
    const gx = Math.floor(mx / GRID_CELL);
    const gy = Math.floor(my / GRID_CELL);
    let best: PlacedPoint | null = null, bestD = HIT_RADIUS_SQ;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = grid.get(`${gx + dx}:${gy + dy}`);
        if (!cell) continue;
        for (const placed of cell) {
          const d = (mx - placed.px) ** 2 + (my - placed.py) ** 2;
          if (d < bestD) { bestD = d; best = placed; }
        }
      }
    }
    return best ? { ...best.pt, dx: mx - best.px, dy: my - best.py, source: popData.volcanoPts } : null;
  }, [M, chartW, chartH, grid, popData.volcanoPts]);

  const handleMouseMove = useCallback((e: MouseEvent<SVGSVGElement>) => {
    if (isHeld(tooltip, e)) return;
    const now = Date.now();
    if (now - lastMove.current < 30) return;
    lastMove.current = now;
    setTooltip(pointAt(e));
  }, [pointAt, tooltip]);

  // Touch clicks have no preceding hover; always hit-test the actual tap.
  // Selecting a gene can add or grow a row above the plot (the host's selection
  // strip). Where the page scrolls, it scrolls by as much, so the plot stays
  // where the reader tapped it; a desktop plot fills a fixed-height view and
  // gives up the height instead, which no scroll can undo.
  const handleClick = useCallback((e: MouseEvent<SVGSVGElement>) => {
    const point = pointAt(e);
    const svg = e.currentTarget;
    const top = svg.getBoundingClientRect().top;
    flushSync(() => {
      setTooltip(point && { ...point, held: { clientX: e.clientX, clientY: e.clientY } });
      if (point) onAddGene(point.gene);
    });
    const shift = svg.getBoundingClientRect().top - top;
    if (shift !== 0) window.scrollBy({ top: shift, behavior: 'instant' });
  }, [pointAt, onAddGene]);

  // A layout change makes the browser work out again what its mouse is over. It
  // can then report a move at the click's own place, or a leave at wherever the
  // mouse last was, which after a tap is not where the finger was. Neither is
  // the reader leaving, so a clicked point's tooltip ignores both. It closes at
  // the next real move or press elsewhere on the page; a move inside the plot
  // returns it to following the pointer.
  useEffect(() => {
    if (!tooltip?.held) return;
    const onPointer = (e: PointerEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return;
      if (e.type === 'pointerdown' || !isHeld(tooltip, e)) setTooltip(null);
    };
    document.addEventListener('pointermove', onPointer);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('pointermove', onPointer);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [tooltip]);

  // A new track or contrast replaces the points, and the old tooltip would state
  // another comparison's figures. Compared by value, because a track's
  // late-loading pathways rebuild the same points.
  if (tooltip && tooltip.source !== popData.volcanoPts) {
    const unchanged = popData.volcanoPts.some((pt) => pt.gene === tooltip.gene
      && pt.logfc === tooltip.logfc && pt.pval === tooltip.pval && pt.fdr === tooltip.fdr);
    setTooltip(unchanged ? { ...tooltip, source: popData.volcanoPts } : null);
  }

  const xTicks = niceTicks(xMin, xMax, 8);
  const yTicks = niceTicks(0, yDomMax, 5);

  return (
    <div className="volcano-plot" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 4 }}>
      {/* One row: the host's lead (the Gene Explorer's search and Gene list
          menu), the view switch, the statistic, the thresholds summary, and
          the passing genes' menu at the far end. The counts and the key are
          the plot's own top line, not toolbar items. One control vocabulary
          (volcanoToolbar.css). */}
      <div className="volcano-controls gx-toolbar">
        {toolbarLead}
        <fieldset aria-label="Volcano view" className="gx-seg">
          {(['plot', 'table'] as const).map((value) => (
            <button type="button" key={value} aria-pressed={view === value} onClick={() => { setView(value); setTooltip(null); }}>
              {value === 'plot' ? 'Plot' : 'Table'}
            </button>
          ))}
        </fieldset>
        <fieldset className="gx-seg" aria-label="Significance statistic">
          {/* "P value" reads "P" on a phone, so the plot's settings share one line there. */}
          <button type="button" aria-pressed={volcanoMetric === 'pval'} onClick={() => selectMetric('pval')}>
            P<span className="gx-phone-hide"> value</span>
          </button>
          <button type="button" aria-pressed={volcanoMetric === 'fdr'} onClick={() => selectMetric('fdr')}>FDR</button>
        </fieldset>
        {/* The cutoffs as one summary, in the figures the dashed lines carry;
            the inputs that set them open under it. */}
        <ToolbarPopover kind="dialog" popupLabel="Plot thresholds"
          label={<span className="gx-num">{thresholdSummary}</span>}
          ariaLabel={`Thresholds: ${thresholdSummary}`}
          title="Change the significance and fold-change cutoffs">
          {() => (
            <div className="gx-thresholds">
              <label className="gx-label" htmlFor={`${uid}-lfc`}>|log₂FC| &gt;</label>
              <input type="range" className="gx-range" min={0} max={4} step={0.1} value={volcanoLogFCThresh}
                aria-label="|log₂FC| threshold slider"
                onChange={(e) => setVolcanoLogFCThresh(+e.target.value)} />
              <input id={`${uid}-lfc`} type="number" className="gx-input" min={0} step={0.1} value={volcanoLogFCThresh}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!Number.isNaN(v) && v >= 0) setVolcanoLogFCThresh(v);
                }}
                style={{ width: 56 }} />
              <label className="gx-label" htmlFor={`${uid}-sig`}>{sigName} &lt;</label>
              <input type="range" className="gx-range" min={0} max={5} step={0.05}
                aria-label={`${sigName} threshold slider (−log₁₀)`}
                value={volcanoSigThresh} onChange={(e) => setVolcanoSigThresh(+e.target.value)} />
              <input id={`${uid}-sig`} type="text" className="gx-input" value={fmtCutoff(10 ** -volcanoSigThresh)}
                inputMode="decimal"
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!Number.isNaN(v) && v > 0 && v <= 1) {
                    setVolcanoSigThresh(-Math.log10(v));
                  }
                }}
                style={{ width: 72 }} />
            </div>
          )}
        </ToolbarPopover>
        {/* The threshold-passing genes: list them, add them, or save them as a
            file (direction and statistics with each symbol, so the cutoff
            that produced them travels with them). Disabled, not hidden, when
            nothing passes. */}
        <ToolbarPopover kind="menu" align="right" popupLabel="Threshold-passing genes"
          label={<><span className="gx-num">{passCount.toLocaleString()}</span> pass</>}
          disabled={passCount === 0}
          busy={savingPass} busyLabel="Saving…"
          title={passCount === 0
            ? 'No genes pass the current threshold'
            : `The ${passCount.toLocaleString()} threshold-passing genes: show, add to the selection, or download`}>
          {(close) => (
            <>
              <MenuItem onSelect={() => { close(); setView('plot'); setShowPassList((v) => view === 'table' || !v); }}>
                {view === 'plot' && showPassList ? 'Hide list' : 'Show list'}
              </MenuItem>
              {onAddGenes && (
                <MenuItem onSelect={() => { close(); onAddGenes([...upGenes, ...downGenes]); }}
                  title={`Add all ${passCount.toLocaleString()} threshold-passing genes to the selection`}>
                  Add all {passCount.toLocaleString()} to selection
                </MenuItem>
              )}
              <MenuGroup heading="Download as">
                {GENE_LIST_SAVE_FORMATS.map((f) => (
                  <MenuItem key={f.format} hint={f.hint}
                    onSelect={() => { close(); runSavePass(() => saveGeneList([popData.meta?.code, 'threshold_genes'], passRows, f.format)); }}>
                    {f.label}
                  </MenuItem>
                ))}
              </MenuGroup>
            </>
          )}
        </ToolbarPopover>
      </div>
      {toolbarBelow}
      {/* Collapsible pass-threshold gene list */}
      {view === 'plot' && showPassList && passCount > 0 && (
        <div style={{
          flexShrink: 0, border: '1px solid var(--border)', borderRadius: 4,
          background: 'var(--bg-panel)', padding: '6px 8px', margin: '0 4px',
          maxHeight: 140, overflowY: 'auto', fontSize: 11,
          fontFamily: FONT_MONO,
        }}>
          {upGenes.length > 0 && (
            <div style={{ marginBottom: downGenes.length > 0 ? 6 : 0 }}>
              <div style={{ color: UP_TEXT_COLOR, fontWeight: 600, fontSize: 10, marginBottom: 2, fontFamily: FONT_SANS }}>
                ↑ Up in {caseLabel} ({upGenes.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {upGenes.map((g) => (
                  <button key={g} type="button" onClick={() => onAddGene?.(g)}
                    title={`Add ${g}`}
                    style={{
                      border: `1px solid ${UP_COLOR}44`, background: selectedSet.has(g) ? VOLCANO_SELECTED_BACKGROUND : 'white',
                      color: 'var(--text-primary)', borderRadius: 3,
                      padding: '1px 5px', fontSize: 11, cursor: 'pointer',
                      fontFamily: FONT_MONO,
                    }}>
                    {g}{selectedSet.has(g) ? ' ✓' : ''}
                  </button>
                ))}
              </div>
            </div>
          )}
          {downGenes.length > 0 && (
            <div>
              <div style={{ color: DOWN_TEXT_COLOR, fontWeight: 600, fontSize: 10, marginBottom: 2, fontFamily: FONT_SANS }}>
                ↓ Down in {caseLabel} ({downGenes.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {downGenes.map((g) => (
                  <button key={g} type="button" onClick={() => onAddGene?.(g)}
                    title={`Add ${g}`}
                    style={{
                      border: `1px solid ${DOWN_COLOR}44`, background: selectedSet.has(g) ? VOLCANO_SELECTED_BACKGROUND : 'white',
                      color: 'var(--text-primary)', borderRadius: 3,
                      padding: '1px 5px', fontSize: 11, cursor: 'pointer',
                      fontFamily: FONT_MONO,
                    }}>
                    {g}{selectedSet.has(g) ? ' ✓' : ''}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Canvas (point cloud) + SVG (axes, threshold, tooltip) stacked */}
      <div className="volcano-canvas" ref={containerRef} style={{ display: view === 'plot' ? 'block' : 'none', flex: 1, minHeight: 150, position: 'relative' }}>
        {totalCount === 0 ? (
          <EmptyState
            style={{ height: '100%' }}
            title="No differential-expression results to plot."
          hint="This track has no differential-expression table. Choose another track, or check that its data finished loading."
          />
        ) : (
        <>
        {/* The legend sits in the plot's top margin, which is sized to it, so
            it never covers a point. It stays truthful to the plot: selected
            points ARE drawn as VOLCANO_SELECTED_COLOR diamonds, so its key
            keeps that colour. Not part of any export: nothing snapshots this
            panel (the PNG export is the bar-chart grid). */}
        <div ref={legendRef} className="gx-legend"
          style={narrow ? { left: 8, right: 8 } : { left: M.left, right: M.right }}>
          <span style={{ color: UP_TEXT_COLOR }}>
            <span style={{ color: UP_COLOR }} aria-hidden="true">●</span>{' '}
            <span className="gx-num">{upCount.toLocaleString()}</span> up in {caseLabel}
          </span>
          <span style={{ color: DOWN_TEXT_COLOR }}>
            <span style={{ color: DOWN_COLOR }} aria-hidden="true">●</span>{' '}
            <span className="gx-num">{downCount.toLocaleString()}</span> down
          </span>
          <span style={{ color: 'var(--text-muted)' }}>
            of <span className="gx-num">{totalCount.toLocaleString()}</span> genes
          </span>
          {selectedPts.length > 0 && (
            <span style={{ color: VOLCANO_SELECTED_COLOR, fontWeight: 600 }}>
              <span aria-hidden="true">◆</span> <span className="gx-num">{selectedPts.length.toLocaleString()}</span> selected
            </span>
          )}
          {!narrow && selectedGenes.length === 0 && <span className="gx-legend-hint">Click a point to add the gene</span>}
        </div>
        <canvas
          ref={canvasRef}
          width={svgSize.w}
          height={svgSize.h}
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
        />
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users can select genes in the volcano table view */}
        <svg
          width={svgSize.w} height={svgSize.h}
          role="img"
          aria-label="Volcano plot of differential expression"
          aria-description="Selected genes are purple diamonds with white outlines; upregulated genes are red circles and downregulated genes are blue circles."
          onMouseMove={handleMouseMove}
          onMouseLeave={() => { if (!tooltip?.held) setTooltip(null); }}
          onClick={handleClick}
          style={{ position: 'absolute', top: 0, left: 0, cursor: tooltip ? 'pointer' : 'crosshair', display: 'block' }}
        >
          {/* X axis */}
          <line x1={M.left} y1={M.top + chartH} x2={M.left + chartW} y2={M.top + chartH} stroke="var(--border-dark)" strokeWidth={1} />
          {xTicks.map((t) => (
            <g key={t}>
              <line x1={toSvgX(t)} y1={M.top + chartH} x2={toSvgX(t)} y2={M.top + chartH + 4} stroke="var(--border-dark)" strokeWidth={1} />
              <text x={toSvgX(t)} y={M.top + chartH + 15} textAnchor="middle" fontSize={11} fill="var(--text-muted)" fontFamily={FONT_MONO}>{t}</text>
            </g>
          ))}
          <text x={M.left + chartW / 2} y={svgSize.h - 4} textAnchor="middle" fontSize={12} fill="var(--text-primary)">
            log₂ fold change ({caseLabel} / {baseLabel})
          </text>

          {/* Y axis */}
          <line x1={M.left} y1={M.top} x2={M.left} y2={M.top + chartH} stroke="var(--border-dark)" strokeWidth={1} />
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={M.left - 4} y1={toSvgY(t)} x2={M.left} y2={toSvgY(t)} stroke="var(--border-dark)" strokeWidth={1} />
              <text x={M.left - 6} y={toSvgY(t) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)" fontFamily={FONT_MONO}>{t}</text>
            </g>
          ))}
          <text
            x={14} y={M.top + chartH / 2} textAnchor="middle" fontSize={12} fill="var(--text-primary)"
            transform={`rotate(-90, 14, ${M.top + chartH / 2})`}
          >
            &minus;log₁₀({volcanoMetric === 'pval' ? 'P value' : 'FDR'})
          </text>

          {/* Threshold lines */}
          {volcanoLogFCThresh > 0 && (
            <>
              <line x1={toSvgX(volcanoLogFCThresh)} y1={M.top} x2={toSvgX(volcanoLogFCThresh)} y2={M.top + chartH} stroke="#bbb" strokeDasharray="4,3" strokeWidth={1} />
              <line x1={toSvgX(-volcanoLogFCThresh)} y1={M.top} x2={toSvgX(-volcanoLogFCThresh)} y2={M.top + chartH} stroke="#bbb" strokeDasharray="4,3" strokeWidth={1} />
            </>
          )}
          <line x1={M.left} y1={toSvgY(volcanoSigThresh)} x2={M.left + chartW} y2={toSvgY(volcanoSigThresh)} stroke="#bbb" strokeDasharray="4,3" strokeWidth={1} />

          {/* Threshold labels: each dashed line says what it is, in the same
              figures as the toolbar's inputs. A paper-coloured halo keeps them
              legible over a point cloud. The significance label sits at the
              line's right end, just above it (below it when the line is close
              to the top edge); the |log2FC| label at the top of the right line. */}
          {(() => {
            const sigY = toSvgY(volcanoSigThresh);
            const labelY = sigY - 4 - 10 < M.top ? sigY + 13 : sigY - 4;
            const halo = { paintOrder: 'stroke' as const, stroke: 'var(--bg-panel)', strokeWidth: 3, strokeLinejoin: 'round' as const };
            return (
              <g fontSize={10} fill="var(--text-muted)" fontFamily={FONT_MONO} pointerEvents="none">
                <text x={M.left + chartW - 2} y={labelY} textAnchor="end" style={halo}>
                  {volcanoMetric === 'pval' ? 'P' : 'FDR'} &lt; {fmtCutoff(10 ** -volcanoSigThresh)}
                </text>
                {volcanoLogFCThresh > 0 && toSvgX(volcanoLogFCThresh) < M.left + chartW - 70 && (
                  <text x={toSvgX(volcanoLogFCThresh) + 4} y={M.top + 10} textAnchor="start" style={halo}>
                    |log₂FC| &gt; {+volcanoLogFCThresh.toFixed(2)}
                  </text>
                )}
              </g>
            );
          })()}

          {/* Tooltip */}
          {tooltip && (() => {
            const mx = toSvgX(tooltip.logfc) + tooltip.dx;
            const my = toSvgY(volcanoMetric === 'pval' ? tooltip.yPval : tooltip.yFdr) + tooltip.dy;
            const tx = mx > svgSize.w * 0.6 ? mx - 210 : mx + 12;
            const ty = Math.max(M.top, Math.min(my - 40, svgSize.h - 90));
            return (
              <g>
                <rect x={tx} y={ty} width={200} height={80} fill="white" stroke="var(--border-dark)" strokeWidth={1} rx={3} />
                <text x={tx + 10} y={ty + 18} fontSize={12} fontWeight={600} fill="var(--text-primary)" fontFamily={FONT_MONO}>{tooltip.gene}</text>
                {/* Labels in sans, figures in mono (DESIGN.md "Numbers Are Mono"). */}
                <text x={tx + 10} y={ty + 34} fontSize={11} fill="var(--text-muted)" fontFamily={FONT_SANS}>logFC: <tspan fontFamily={FONT_MONO} fill="var(--text-mono)">{tooltip.logfc.toFixed(3)}</tspan></text>
                <text x={tx + 10} y={ty + 48} fontSize={11} fill="var(--text-muted)" fontFamily={FONT_SANS}>P = <tspan fontFamily={FONT_MONO} fill="var(--text-mono)">{fmtP(tooltip.pval)}</tspan></text>
                <text x={tx + 10} y={ty + 62} fontSize={11} fill="var(--text-muted)" fontFamily={FONT_SANS}>FDR = <tspan fontFamily={FONT_MONO} fill="var(--text-mono)">{fmtFDR(tooltip.fdr)}</tspan></text>
                <text x={tx + 10} y={ty + 74} fontSize={10} fill={VOLCANO_SELECTED_COLOR} fontFamily={FONT_SANS}>{selectedSet.has(tooltip.gene) ? '◆ Selected' : 'Click to add →'}</text>
              </g>
            );
          })()}
        </svg>
        </>
        )}
      </div>
      {view === 'table' && (
        <VolcanoTable points={popData.volcanoPts} passingGenes={passingGenes} selectedGenes={selectedSet}
          metric={volcanoMetric} logFCThresh={volcanoLogFCThresh} sigThresh={volcanoSigThresh}
          baselineLabel={baseLabel} caseLabel={caseLabel} onAddGene={onAddGene} />
      )}
    </div>
  );
}
