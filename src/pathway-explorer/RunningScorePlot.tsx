import { useMemo } from 'react';
import { fmtP, fmtFDR, fmtSigned } from '../utils/format';
import { UP_COLOR, DOWN_COLOR, FONT_MONO, FONT_SANS } from '../styles/constants';
import type { GeneDERecord, PathwayRecordWithDb, PopData } from '../types';

interface RunningScorePlotProps {
  pathway: PathwayRecordWithDb;
  popData: PopData;
}

interface ScorePoint { x: number; y: number }
interface ScoreTick { gene: string; rank: number; logfc: number }

export function RunningScorePlot({ pathway, popData }: RunningScorePlotProps) {
  const { leadingEdge, NES, padj, pval, size } = pathway;

  const { pts, minES, maxES, ticks } = useMemo<{
    pts: ScorePoint[];
    minES: number;
    maxES: number;
    ticks: ScoreTick[];
  }>(() => {
    if (!leadingEdge?.length || !popData) return { pts: [], minES: 0, maxES: 0, ticks: [] };

    const leSet = new Set(leadingEdge);
    const leDE = leadingEdge.map((g) => popData.deByGene[g])
      .filter((d): d is GeneDERecord => !!d);
    const NR = leDE.reduce((s, d) => s + Math.abs(d.rank_score ?? 0), 0) || 1;
    // Miss decrement divides by the misses actually walked below: de rows NOT
    // in the leading edge. leDE.length (leading-edge genes present in de), not
    // leSet.size — a leading-edge gene absent from de never hits the else
    // branch, and counting it would deflate every miss step.
    const NMiss = popData.de.length - leDE.length || 1;

    let es = 0, minES = 0, maxES = 0;
    const pts: ScorePoint[] = [];
    const ticks: ScoreTick[] = [];

    // Rank is the 1-based position in the rank-ordered DE table — the table is
    // sorted by rank (optimized bundles no longer ship a rankPos field).
    popData.de.forEach((d, i) => {
      const rank = i + 1;
      if (leSet.has(d.gene)) {
        es += Math.abs(d.rank_score ?? 0) / NR;
        ticks.push({ gene: d.gene, rank, logfc: d.logFC });
        pts.push({ x: rank, y: es });
      } else {
        es -= 1 / NMiss;
        // Downsample background: every 25th point
        if (i % 25 === 0) pts.push({ x: rank, y: es });
      }
      if (es < minES) minES = es;
      if (es > maxES) maxES = es;
    });

    return { pts, minES, maxES, ticks };
  }, [leadingEdge, popData]);

  if (!pts.length) return null;

  // SVG layout
  const VW = 560, VH = 180;
  const ML = 48, MR = 12, MT = 22, MB = 28;
  const TICK_H = 18; // top area for gene ticks
  const plotY = MT + TICK_H;
  const plotH = VH - plotY - MB;
  const plotW = VW - ML - MR;
  const nGenes = popData.de.length;

  // Y range: pad 10%
  const yRange = (maxES - minES) || 1;
  const yLo = minES - yRange * 0.08;
  const yHi = maxES + yRange * 0.08;

  const toX = (rank: number) => ML + ((rank - 1) / Math.max(1, nGenes - 1)) * plotW;
  const toY = (es: number) => plotY + plotH - ((es - yLo) / (yHi - yLo)) * plotH;
  const zeroY = toY(0);
  const minY = toY(minES);

  // Build polyline points string (downsampled)
  const polyPts = pts.map((p) => `${toX(p.x).toFixed(1)},${toY(p.y).toFixed(1)}`).join(' ');

  // Y-axis ticks: 3 labeled rows (label is also the React key, so duplicate
  // values like minES === 0 don't collide).
  const yTicks = [
    { label: 'min', v: minES },
    { label: 'zero', v: 0 },
    { label: 'max', v: maxES },
  ].map((t) => ({ ...t, y: toY(t.v) }));

  return (
    <div style={{ marginTop: 14 }}>
      <svg
        width="100%"
        viewBox={`0 0 ${VW} ${VH}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="GSEA running enrichment score plot"
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* Gene tick marks */}
        {ticks.map((t) => (
          <rect
            key={t.gene}
            x={toX(t.rank) - 0.5}
            y={MT}
            width={1.5}
            height={TICK_H - 2}
            fill={t.logfc > 0 ? UP_COLOR : DOWN_COLOR}
            opacity={0.8}
          >
            <title>{`rank ${t.rank}, logFC ${t.logfc.toFixed(2)}`}</title>
          </rect>
        ))}

        {/* Plot background */}
        <rect x={ML} y={plotY} width={plotW} height={plotH} fill="#fafafa" stroke="var(--border)" strokeWidth={0.5} />

        {/* Zero line */}
        <line x1={ML} y1={zeroY} x2={ML + plotW} y2={zeroY} stroke="#bbb" strokeWidth={0.5} />

        {/* Min ES dashed red line */}
        <line x1={ML} y1={minY} x2={ML + plotW} y2={minY}
          stroke="#D62728" strokeWidth={1} strokeDasharray="4 2" />

        {/* Running score curve */}
        <polyline points={polyPts} fill="none" stroke="#2CA02C" strokeWidth={1.5} strokeLinejoin="round" />

        {/* Y-axis */}
        <line x1={ML} y1={plotY} x2={ML} y2={plotY + plotH} stroke="var(--border-dark)" strokeWidth={0.5} />
        {yTicks.map(({ label, v, y }) => (
          <g key={label}>
            <line x1={ML - 3} y1={y} x2={ML} y2={y} stroke="var(--border-dark)" strokeWidth={0.5} />
            <text x={ML - 5} y={y + 3.5} fontSize={8} textAnchor="end" fill="var(--text-muted)" fontFamily={FONT_MONO}>
              {v.toFixed(2)}
            </text>
          </g>
        ))}

        {/* Y-axis label */}
        <text
          x={10} y={plotY + plotH / 2}
          fontSize={9} fill="var(--text-muted)" fontFamily={FONT_SANS}
          textAnchor="middle"
          transform={`rotate(-90, 10, ${plotY + plotH / 2})`}
        >Enrichment score</text>

        {/* X-axis label */}
        <text x={ML + plotW / 2} y={VH - 2} fontSize={9} textAnchor="middle" fill="var(--text-muted)" fontFamily={FONT_SANS}>
          Ranked genes ({popData.contrast?.label ?? 'selected comparison'})
        </text>
        {/* X-axis ticks */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const rank = Math.round(f * (nGenes - 1)) + 1;
          const x = toX(rank);
          return (
            <g key={f}>
              <line x1={x} y1={plotY + plotH} x2={x} y2={plotY + plotH + 3} stroke="var(--border-dark)" strokeWidth={0.5} />
              <text x={x} y={plotY + plotH + 11} fontSize={8} textAnchor="middle" fill="var(--text-muted)" fontFamily={FONT_MONO}>
                {rank === 1 ? '1' : `${(rank / 1000).toFixed(0)}k`}
              </text>
            </g>
          );
        })}

        {/* Annotation box */}
        <rect x={ML + plotW - 88} y={plotY + 4} width={86} height={51} fill="white" stroke="var(--border)" strokeWidth={0.5} rx={2} />
        <text x={ML + plotW - 84} y={plotY + 14} fontSize={9} fontFamily={FONT_MONO} fill="var(--text-primary)">
          NES = {fmtSigned(NES, 3)}
        </text>
        <text x={ML + plotW - 84} y={plotY + 25} fontSize={9} fontFamily={FONT_MONO} fill="var(--text-muted)">
          FDR = {fmtFDR(padj)}
        </text>
        <text x={ML + plotW - 84} y={plotY + 36} fontSize={9} fontFamily={FONT_MONO} fill="var(--text-muted)">
          <tspan fontStyle="italic">p</tspan> = {fmtP(pval)}
        </text>
        <text x={ML + plotW - 84} y={plotY + 47} fontSize={9} fontFamily={FONT_MONO} fill="var(--text-muted)">
          n = {size} genes
        </text>
      </svg>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic' }}>
        Running enrichment score · leading-edge approx. (n={leadingEdge.length} of {size} pathway genes)
      </div>
    </div>
  );
}
