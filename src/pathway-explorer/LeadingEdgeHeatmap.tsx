import { displayUnit, groupLabels, sampleAxis, unitProvenance, valueAt } from '../utils/sampleValues';
import type { SampleSlot } from '../utils/sampleValues';
import { FONT_MONO } from '../styles/constants';
import type { Group, PopData } from '../types';

function zToColor(z: number): string {
  const t = Math.max(-1, Math.min(1, z / 2));
  if (t <= 0) {
    const f = 1 + t;
    return `rgb(${Math.round(76 + f * 179)},${Math.round(120 + f * 135)},${Math.round(168 + f * 87)})`;
  }
  return `rgb(255,${Math.round(255 - t * 168)},${Math.round(255 - t * 169)})`;
}

interface LeadingEdgeHeatmapProps {
  leadingEdge?: string[];
  popData: PopData;
  groups?: Group[];
}

// Group-bar colours: baseline grey, case gold — neutral so they don't clash with
// the z-score blue/red scale. (Matches the original macaque Normal/Obese bar.)
const BASE_COLOR = '#888888';
const CASE_COLOR = '#F0A500';

export function LeadingEdgeHeatmap({ leadingEdge, popData, groups }: LeadingEdgeHeatmapProps) {
  if (!leadingEdge?.length) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 8 }}>No leading edge genes.</div>;
  }

  // Explicit groups select the comparison's pair or every design condition.
  // Without them, retain the historical full sample axis, including unassigned
  // samples. Values stay indexed by their original sampleOrder positions.
  const axis = sampleAxis(popData, undefined, groups).filter((slot) => !groups || slot.group != null);
  // The value columns, as cpm indices. Normally one per axis slot (a slot's
  // index IS its cpm column — cpm arrays are parallel to sampleOrder). The
  // historical `|| 6` only fires when sampleOrder is empty, where there are no
  // slots to label but the first six cpm cells are still read, as before.
  const columns = axis.length ? axis.map((s) => s.index) : groups ? [] : [0, 1, 2, 3, 4, 5];
  const N = columns.length;

  // Leading-edge genes absent from this track's DE table are dropped (the flatMap
  // is the filter): deByGene is an index over the DE table, not over the pathway.
  const genes = leadingEdge
    .flatMap((g) => {
      const de = popData.deByGene[g];
      // Per-column values through the seam's one null-drop rule. Value-identical
      // to the old raw cpm[i] read: a gene missing from cpm, a short row and an
      // over-long row all read exactly as `?? new Array(N).fill(null)` plus the
      // `i < N` filter did.
      return de ? [{ gene: g, logFC: de.logFC, values: columns.map((i) => valueAt(popData, g, i)) }] : [];
    })
    .sort((a, b) => b.logFC - a.logFC);

  // Z-score per gene across the present (non-null) columns, so cells, column
  // headers, and the group bar all share one axis.
  const zData = genes.map(({ gene, logFC, values }) => {
    const present = values.filter((v): v is number => v != null);
    const m = present.length ? present.reduce((s, v) => s + v, 0) / present.length : 0;
    const variance = present.length ? present.reduce((s, v) => s + (v - m) ** 2, 0) / present.length : 0;
    const sd = Math.sqrt(variance) || 1;
    const z = values.map((v) => (v == null ? null : (v - m) / sd));
    return { gene, logFC, values, z };
  });

  // Per-sample group membership (baseline vs case) from the resolved contrast.
  const baseline = popData.groups[0] ?? null;
  const caseGroup = popData.groups[1] ?? null;
  // Legend labels through the group-label seam: identical to the groups' own
  // labels whenever the contrast resolved (groups IS [baseline, caseGroup]),
  // neutral 'Baseline'/'Case' on the degraded null-contrast path.
  const { baselineLabel, caseLabel } = groupLabels(popData.contrast);
  const legendGroups = groups ?? [
    { key: baseline?.key ?? 'baseline', label: baselineLabel, color: BASE_COLOR },
    { key: caseGroup?.key ?? 'case', label: caseLabel, color: CASE_COLOR },
  ];
  // The seam already answered "which arm"; all that is left is the bar colour —
  // baseline grey, case gold, neither-arm (and null-contrast) a lighter grey.
  const groupColor = (group: SampleSlot['group']) =>
    (group == null ? '#cccccc'
      : groups ? group.color
      : group.key === baseline?.key ? BASE_COLOR
      : group.key === caseGroup?.key ? CASE_COLOR
      : '#cccccc');

  const CELL_W = 38, CELL_H = 18;
  const LEFT = 10, GENE_W = 90;
  // Short sample labels: macaque "…S001" → "S001"; otherwise keep the tail.
  const SAMPLE_NAMES = axis.map(({ id }) => (id.length > 6 ? id.slice(-4) : id));
  const GROUP_H = 8, GAP = 4, HEADER_H = 28;
  const totalW = LEFT + CELL_W * N + GENE_W;
  const totalH = HEADER_H + GROUP_H + GAP + zData.length * CELL_H + 4;

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
        Leading-edge genes, n={zData.length}.{' '}
        <span title={unitProvenance(popData)} style={{ cursor: 'help', borderBottom: '1px dotted currentColor' }}>
          {displayUnit(popData)}
        </span>, z-scored per gene
      </div>
      <div style={{ border: '1px solid var(--border)', overflowX: 'auto' }}>
        <svg width={totalW} height={totalH} style={{ display: 'block', fontFamily: FONT_MONO }} role="img" aria-label="Leading edge gene heatmap">
          {/* Column headers */}
          {SAMPLE_NAMES.map((s, i) => (
            <text
              // biome-ignore lint/suspicious/noArrayIndexKey: sample column position is the identity
              key={`${s}-${i}`}
              x={LEFT + i * CELL_W + CELL_W / 2}
              y={HEADER_H - 2}
              fontSize={9}
              textAnchor="start"
              transform={`rotate(-45, ${LEFT + i * CELL_W + CELL_W / 2}, ${HEADER_H - 2})`}
              fill="var(--text-muted)"
            >{s}</text>
          ))}

          {/* Group colour bar — one cell per sample, coloured by its group. */}
          {axis.map((s, i) => (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: sample column position is the identity
              key={`grp-${s.id}-${i}`}
              x={LEFT + i * CELL_W} y={HEADER_H} width={CELL_W} height={GROUP_H} fill={groupColor(s.group)}
            ><title>{s.id} · {s.group?.label ?? 'Unassigned'}</title></rect>
          ))}

          {/* Heatmap cells — dropped-sample slots render as hatched grey */}
          {zData.map(({ gene, logFC, values, z }, gi) => {
            const y = HEADER_H + GROUP_H + GAP + gi * CELL_H;
            return (
              <g key={gene}>
                {z.map((zv, si) => {
                  const missing = zv == null;
                  return (
                    <rect
                      // biome-ignore lint/suspicious/noArrayIndexKey: cell column position is the identity
                      key={`${gene}-${si}`}
                      x={LEFT + si * CELL_W}
                      y={y}
                      width={CELL_W - 1}
                      height={CELL_H - 1}
                      fill={missing ? '#e5e7eb' : zToColor(zv)}
                      stroke={missing ? '#9ca3af' : 'none'}
                      strokeDasharray={missing ? '2,2' : 'none'}
                    >
                      <title>{gene} · {SAMPLE_NAMES[si] ?? si} · {missing ? 'dropped from QC' : `${(values[si] ?? 0).toFixed(1)} · z: ${(zv ?? 0).toFixed(2)}`}</title>
                    </rect>
                  );
                })}
                {/* Gene label */}
                <text
                  x={LEFT + CELL_W * N + 4}
                  y={y + CELL_H / 2 + 4}
                  fontSize={10}
                  fill={logFC > 0 ? '#C0392B' : '#2471A3'}
                  fontWeight={500}
                >{gene}</text>
              </g>
            );
          })}
        </svg>
      </div>
      {/* Color scale legend */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: 4, fontSize: 9, color: 'var(--text-muted)', fontFamily: FONT_MONO }}>
        <span>−2</span>
        <svg width={80} height={10} role="img" aria-label="Heatmap color scale from −2 to +2">
          <defs>
            <linearGradient id="hm-grad" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#4C78A8" />
              <stop offset="50%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#E45756" />
            </linearGradient>
          </defs>
          <rect x={0} y={0} width={80} height={10} fill="url(#hm-grad)" stroke="var(--border)" strokeWidth={0.5} />
        </svg>
        <span>+2 (z-score)</span>
        {legendGroups.map((group) => (
          <span key={group.key} style={{ marginLeft: 8 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, background: group.color, marginRight: 2, verticalAlign: 'middle' }} /> {group.label}
          </span>
        ))}
      </div>
    </div>
  );
}
