import { ResponsiveDetails } from '../common/ResponsiveDetails';
import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import type { MouseEvent } from 'react';
import { fmtCutoff, fmtP, fmtFDR } from '../utils/format';
import { groupLabels } from '../utils/sampleValues';
import { niceTicks } from '../utils/axes';
import { EmptyState } from '../common/EmptyState';
import { SaveGeneListMenu } from '../common/GeneListTools';
import { UP_COLOR, DOWN_COLOR, UP_TEXT_COLOR, DOWN_TEXT_COLOR, FONT_MONO, FONT_SANS } from '../styles/constants';
import type { PopData, VolcanoPoint } from '../types';
import type { VolcanoView } from '../explorer/explorerSession';
import type { GeneListRow } from '../utils/geneListFile';
import { VolcanoTable } from './VolcanoTable';
import { VOLCANO_SELECTED_BACKGROUND, VOLCANO_SELECTED_COLOR } from './volcanoColors';

function readDpr(): number {
  return typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
}

const VM = { top: 24, right: 20, bottom: 48, left: 58 };
const GRID_CELL = 40; // spatial index cell size in SVG px
const HIT_RADIUS_SQ = 28 * 28;

type Tooltip = (VolcanoPoint & { mx: number; my: number }) | null;
interface PlacedPoint { pt: VolcanoPoint; px: number; py: number }

interface VolcanoPlotProps {
  selectedGenes: string[];
  /** Metric + thresholds as one value. `selectMetric` carries the pairing that
   *  used to live in this file's own onClick: the two metrics sit on different
   *  scales, so choosing one must also move the cutoff line. */
  volcano: VolcanoView;
  onAddGene: (gene: string) => void;
  onAddGenes?: (genes: string[]) => void;
  popData: PopData;
}

export function VolcanoPlot({
  selectedGenes, volcano,
  onAddGene, onAddGenes, popData,
}: VolcanoPlotProps) {
  const {
    metric: volcanoMetric, selectMetric,
    logFCThresh: volcanoLogFCThresh, setLogFCThresh: setVolcanoLogFCThresh,
    sigThresh: volcanoSigThresh, setSigThresh: setVolcanoSigThresh,
  } = volcano;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [svgSize, setSvgSize] = useState({ w: 600, h: 360 });
  const [tooltip, setTooltip] = useState<Tooltip>(null);
  const [showPassList, setShowPassList] = useState(false);
  const [view, setView] = useState<'plot' | 'table'>('plot');
  // Device-pixel ratio drives the canvas backing-store scale. Tracked in state
  // (not read once at paint time) so dragging the window to a different-DPI
  // monitor or a browser zoom — neither of which necessarily resizes the
  // container — still repaints the point cloud crisply.
  const [dpr, setDpr] = useState(readDpr);
  const lastMove = useRef(0);
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

  const chartW = svgSize.w - VM.left - VM.right;
  const chartH = svgSize.h - VM.top - VM.bottom;
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

  const toSvgX = useCallback((v: number) => VM.left + (v - xMin) / (xMax - xMin) * chartW, [chartW, xMin, xMax]);
  const toSvgY = useCallback((v: number) => VM.top + (1 - v / yDomMax) * chartH, [chartH, yDomMax]);

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
    if (mx < VM.left || mx > VM.left + chartW || my < VM.top || my > VM.top + chartH) {
      return null;
    }
    // Spatial-index hit test: inspect only the 9 grid cells around the mouse.
    const gx = Math.floor(mx / GRID_CELL);
    const gy = Math.floor(my / GRID_CELL);
    let best: VolcanoPoint | null = null, bestD = HIT_RADIUS_SQ;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = grid.get(`${gx + dx}:${gy + dy}`);
        if (!cell) continue;
        for (const { pt, px, py } of cell) {
          const d = (mx - px) ** 2 + (my - py) ** 2;
          if (d < bestD) { bestD = d; best = pt; }
        }
      }
    }
    return best ? { mx, my, ...best } : null;
  }, [chartW, chartH, grid]);

  const handleMouseMove = useCallback((e: MouseEvent<SVGSVGElement>) => {
    const now = Date.now();
    if (now - lastMove.current < 30) return;
    lastMove.current = now;
    setTooltip(pointAt(e));
  }, [pointAt]);

  // Touch clicks have no preceding hover; always hit-test the actual tap.
  const handleClick = useCallback((e: MouseEvent<SVGSVGElement>) => {
    const point = pointAt(e);
    setTooltip(point);
    if (point) onAddGene(point.gene);
  }, [pointAt, onAddGene]);

  const xTicks = niceTicks(xMin, xMax, 8);
  const yTicks = niceTicks(0, yDomMax, 5);

  return (
    <div className="volcano-plot" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 4 }}>
      <div className="volcano-controls">
      {/* The view switch stays visible; supporting controls fold on mobile. */}
      <div style={{ flexShrink: 0, alignSelf: 'flex-start' }}>
        <fieldset aria-label="Volcano view" style={{ display: 'flex', padding: 0, margin: 0, border: '1px solid var(--border-dark)', borderRadius: 4, overflow: 'hidden' }}>
          {(['plot', 'table'] as const).map((value) => (
            <button type="button" key={value} aria-pressed={view === value} onClick={() => { setView(value); setTooltip(null); }}
              style={{ padding: '3px 10px', fontSize: 12, border: 'none', cursor: 'pointer', background: view === value ? 'var(--text-primary)' : 'white', color: view === value ? 'white' : 'var(--text-primary)' }}>
              {value === 'plot' ? 'Plot' : 'Table'}
            </button>
          ))}
        </fieldset>
      </div>
      <ResponsiveDetails label="Plot thresholds & gene list">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 4px 0', flexWrap: 'wrap', flexShrink: 0 }}>
        <div style={{ display: 'flex', border: '1px solid var(--border-dark)', borderRadius: 4, overflow: 'hidden' }}>
          {([['pval', 'P value'], ['fdr', 'FDR']] as const).map(([val, label]) => (
            <button type="button" key={val}
              onClick={() => selectMetric(val)}
              style={{
                padding: '3px 10px', fontSize: 12, border: 'none', cursor: 'pointer',
                background: volcanoMetric === val ? 'var(--text-primary)' : 'white',
                color: volcanoMetric === val ? 'white' : 'var(--text-primary)',
              }}>{label}</button>
          ))}
        </div>
        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          |logFC| &gt;
          <input type="range" min={0} max={4} step={0.1} value={volcanoLogFCThresh}
            onChange={(e) => setVolcanoLogFCThresh(+e.target.value)} style={{ width: 70 }} />
          <input type="number" min={0} step={0.1} value={volcanoLogFCThresh}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!Number.isNaN(v) && v >= 0) setVolcanoLogFCThresh(v);
            }}
            style={{ width: 48, fontFamily: FONT_MONO, fontSize: 11, padding: '1px 3px' }} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          {volcanoMetric === 'pval' ? 'P' : 'FDR'} &lt;
          <input type="range" min={0} max={5} step={0.05}
            value={volcanoSigThresh} onChange={(e) => setVolcanoSigThresh(+e.target.value)} style={{ width: 70 }} />
          <input type="text" value={fmtCutoff(10 ** -volcanoSigThresh)}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!Number.isNaN(v) && v > 0 && v <= 1) {
                setVolcanoSigThresh(-Math.log10(v));
              }
            }}
            style={{ width: 72, fontFamily: FONT_MONO, fontSize: 11, padding: '1px 3px' }} />
          <span style={{ fontFamily: FONT_MONO, color: 'var(--text-muted)', fontSize: 10 }}>
            (−log₁₀ = {volcanoSigThresh.toFixed(2)})
          </span>
        </label>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto', fontFamily: FONT_MONO, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>
            <strong style={{ color: 'var(--text-primary)' }}>{passCount.toLocaleString()}</strong> genes
            {' '}(<span style={{ color: UP_TEXT_COLOR }}>{upCount.toLocaleString()} ↑</span>
            {' · '}<span style={{ color: DOWN_TEXT_COLOR }}>{downCount.toLocaleString()} ↓</span>)
            {' · '}{totalCount.toLocaleString()} total
          </span>
          {/* The threshold-passing list as a file: the symbols with their
              direction and statistics, so the cutoff that produced them
              travels with them. Disabled, not hidden, when nothing passes. */}
          <SaveGeneListMenu
            rows={passRows}
            filenameParts={[popData.meta?.code, 'threshold_genes']}
            label="Save"
            title={passCount === 0
              ? 'No genes pass the current threshold'
              : `Download the ${passCount.toLocaleString()} threshold-passing genes with their direction, log2FC, p and FDR`}
            style={{ fontSize: 10, padding: '2px 6px', fontWeight: 400, color: 'var(--text-primary)' }}
          />
          <button
            type="button"
            onClick={() => { setView('plot'); setShowPassList((v) => view === 'table' || !v); }}
            disabled={passCount === 0}
            title={passCount === 0 ? 'No genes pass the current threshold' : 'Show/hide gene list'}
            style={{
              fontSize: 10, padding: '2px 6px', border: '1px solid var(--border)',
              borderRadius: 3, background: showPassList ? '#4C78A8' : 'var(--bg-panel)',
              color: showPassList ? '#fff' : 'var(--text-primary)',
              cursor: passCount === 0 ? 'not-allowed' : 'pointer',
              opacity: passCount === 0 ? 0.5 : 1,
              fontFamily: FONT_SANS,
            }}
          >{view === 'plot' && showPassList ? 'Hide list' : 'Show list'}</button>
          <button
            type="button"
            onClick={() => { if (onAddGenes && passCount > 0) onAddGenes([...upGenes, ...downGenes]); }}
            disabled={passCount === 0 || !onAddGenes}
            title={passCount === 0 ? 'No genes pass the current threshold' : `Add all ${passCount.toLocaleString()} threshold-passing genes to the Gene Explorer`}
            style={{
              fontSize: 10, padding: '2px 8px', border: `1px solid ${VOLCANO_SELECTED_COLOR}`,
              borderRadius: 3, background: passCount === 0 ? 'var(--bg-panel)' : VOLCANO_SELECTED_BACKGROUND,
              color: VOLCANO_SELECTED_COLOR, fontWeight: 600,
              cursor: passCount === 0 ? 'not-allowed' : 'pointer',
              opacity: passCount === 0 ? 0.5 : 1,
              fontFamily: FONT_SANS,
            }}
          >+ Add all {passCount > 0 ? passCount.toLocaleString() : ''} →</button>
        </span>
      </div>

      </ResponsiveDetails>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '2px 4px', fontSize: 10, flexShrink: 0 }}>
        <span style={{ color: UP_TEXT_COLOR }}>● Up in {caseLabel}</span>
        <span style={{ color: DOWN_TEXT_COLOR }}>● Down in {caseLabel}</span>
        <span style={{ color: 'var(--text-muted)' }}>● Below thresholds</span>
        <span style={{ color: VOLCANO_SELECTED_COLOR, fontWeight: 600 }}>◆ Selected ({selectedPts.length.toLocaleString()})</span>
      </div>

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
          onMouseLeave={() => setTooltip(null)}
          onClick={handleClick}
          style={{ position: 'absolute', top: 0, left: 0, cursor: tooltip ? 'pointer' : 'crosshair', display: 'block' }}
        >
          {/* X axis */}
          <line x1={VM.left} y1={VM.top + chartH} x2={VM.left + chartW} y2={VM.top + chartH} stroke="var(--border-dark)" strokeWidth={1} />
          {xTicks.map((t) => (
            <g key={t}>
              <line x1={toSvgX(t)} y1={VM.top + chartH} x2={toSvgX(t)} y2={VM.top + chartH + 4} stroke="var(--border-dark)" strokeWidth={1} />
              <text x={toSvgX(t)} y={VM.top + chartH + 15} textAnchor="middle" fontSize={11} fill="var(--text-muted)" fontFamily={FONT_MONO}>{t}</text>
            </g>
          ))}
          <text x={VM.left + chartW / 2} y={svgSize.h - 4} textAnchor="middle" fontSize={12} fill="var(--text-primary)">
            log₂ fold change ({caseLabel} / {baseLabel})
          </text>

          {/* Y axis */}
          <line x1={VM.left} y1={VM.top} x2={VM.left} y2={VM.top + chartH} stroke="var(--border-dark)" strokeWidth={1} />
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={VM.left - 4} y1={toSvgY(t)} x2={VM.left} y2={toSvgY(t)} stroke="var(--border-dark)" strokeWidth={1} />
              <text x={VM.left - 6} y={toSvgY(t) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)" fontFamily={FONT_MONO}>{t}</text>
            </g>
          ))}
          <text
            x={14} y={VM.top + chartH / 2} textAnchor="middle" fontSize={12} fill="var(--text-primary)"
            transform={`rotate(-90, 14, ${VM.top + chartH / 2})`}
          >
            &minus;log₁₀({volcanoMetric === 'pval' ? 'P value' : 'FDR'})
          </text>

          {/* Threshold lines */}
          {volcanoLogFCThresh > 0 && (
            <>
              <line x1={toSvgX(volcanoLogFCThresh)} y1={VM.top} x2={toSvgX(volcanoLogFCThresh)} y2={VM.top + chartH} stroke="#bbb" strokeDasharray="4,3" strokeWidth={1} />
              <line x1={toSvgX(-volcanoLogFCThresh)} y1={VM.top} x2={toSvgX(-volcanoLogFCThresh)} y2={VM.top + chartH} stroke="#bbb" strokeDasharray="4,3" strokeWidth={1} />
            </>
          )}
          <line x1={VM.left} y1={toSvgY(volcanoSigThresh)} x2={VM.left + chartW} y2={toSvgY(volcanoSigThresh)} stroke="#bbb" strokeDasharray="4,3" strokeWidth={1} />

          {/* Tooltip */}
          {tooltip && (() => {
            const tx = tooltip.mx > svgSize.w * 0.6 ? tooltip.mx - 210 : tooltip.mx + 12;
            const ty = Math.max(VM.top, Math.min(tooltip.my - 40, svgSize.h - 90));
            return (
              <g>
                <rect x={tx} y={ty} width={200} height={80} fill="white" stroke="var(--border-dark)" strokeWidth={1} rx={3} />
                <text x={tx + 10} y={ty + 18} fontSize={12} fontWeight={600} fill="var(--text-primary)" fontFamily={FONT_MONO}>{tooltip.gene}</text>
                <text x={tx + 10} y={ty + 34} fontSize={11} fill="var(--text-muted)">logFC: {tooltip.logfc.toFixed(3)}</text>
                <text x={tx + 10} y={ty + 48} fontSize={11} fill="var(--text-muted)">P = {fmtP(tooltip.pval)}</text>
                <text x={tx + 10} y={ty + 62} fontSize={11} fill="var(--text-muted)">FDR = {fmtFDR(tooltip.fdr)}</text>
                <text x={tx + 10} y={ty + 74} fontSize={10} fill={VOLCANO_SELECTED_COLOR}>{selectedSet.has(tooltip.gene) ? '◆ Selected' : 'Click to add →'}</text>
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
