import type { Metrics } from './atlas';

export const regions = {
  PVN: 'Paraventricular hypothalamic nucleus',
  ZI: 'Zona incerta',
  LHA: 'Lateral hypothalamic area',
  DMH: 'Dorsomedial nucleus of the hypothalamus',
  VMH: 'Ventromedial hypothalamic nucleus',
  PVp: 'Periventricular hypothalamic nucleus, posterior part',
  ARC: 'Arcuate hypothalamic nucleus',
} as const;

const ellipses = [
  ['PVN', 436, 188, 50, 25, -14],
  ['ZI', 524, 174, 48, 21, -18],
  ['LHA', 550, 278, 54, 68, 6],
  ['DMH', 450, 252, 32, 48, 0],
  ['VMH', 448, 346, 41, 39, 0],
  ['PVp', 406, 302, 10, 92, 0],
] as const;

export function AtlasMap({ summaries, region, onSelect }: {
  summaries: Record<string, Metrics>;
  region: string;
  onSelect: (region: string) => void;
}) {
  const max = Math.max(0, ...Object.values(regions).map(name => summaries[name]?.mean ?? 0));
  const color = (fraction: number) => `rgb(${[231, 242, 251].map((light, i) =>
    Math.round(light + ([19, 73, 120][i] - light) * fraction)).join(', ')})`;
  const unavailable = '#a8adb5';
  const undetected = '#fffdf7';
  return (
    <>
      <svg className="hm-map" viewBox="105 80 550 465" role="group" aria-label="Coronal hypothalamus schematic">
        <path d="M380,96 C305,92 230,98 180,124 C130,150 112,208 120,262 C127,326 156,382 205,416 C224,430 244,433 258,428 C250,440 256,452 270,452 C286,452 296,438 312,444 C334,453 352,464 380,466 C408,464 426,453 448,444 C464,438 474,452 490,452 C504,452 510,440 502,428 C516,433 536,430 555,416 C604,382 633,326 640,262 C648,208 630,150 580,124 C530,98 455,92 380,96 Z" fill="#eeebe5" stroke="#ccc5ba" />
        <path d="M380 116l9 16-9 16-9-16z M380 148v304" fill="#c7c1b8" stroke="#c7c1b8" strokeWidth="2" />
        {([...ellipses, ['ARC', 380, 466, 0, 0, 0]] as const).map(([key, x, y, rx, ry, rotation]) => {
          const name = regions[key];
          const row = summaries[name];
          const mean = row?.mean;
          const fill = mean == null ? (row?.detection === 0 ? undetected : unavailable) : color(max ? mean / max : 0);
          const expression = mean != null ? `Mean when detected ${mean.toFixed(2)}`
            : row?.detection === 0 ? 'No detected cells' : 'Data unavailable';
          const detail = row?.detection != null ? `${expression} · ${row.detection.toFixed(2)}% detected` : expression;
          return (
            <g key={key} role="button" tabIndex={0} aria-label={`${key} · ${name}`} aria-pressed={region === name} aria-description={detail}
              onClick={() => onSelect(name)} onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(name);
                }
              }}>
              <title>{name} · {detail}</title>
              {key === 'ARC' ? <path d="M380 430c34 11 40 66 0 80-40-14-34-69 0-80z" fill={fill} /> :
                [x, 760 - x].map(cx => (
                  <ellipse key={cx} cx={cx} cy={y} rx={rx} ry={ry} transform={`rotate(${cx === x ? rotation : -rotation} ${cx} ${y})`} fill={fill} />
                ))}
              {(key === 'ARC' ? [x] : [x, 760 - x]).map(cx => (
                <text key={cx} x={cx} y={y + 4}>{key}</text>
              ))}
            </g>
          );
        })}
        <text x="380" y="530">ME (unavailable)</text>
      </svg>
      <div className="hm-map-legend" role="group" aria-label="Spatial heatmap legend">
        <strong>Mean expression among detected cells</strong>
        <small>ln(1 + counts per 10k)</small>
        {max > 0 ? (
          <>
            <div className="hm-map-ramp" style={{ background: `linear-gradient(90deg, ${color(0)}, ${color(1)})` }} />
            <div className="hm-map-ticks"><span>0</span><span>{max.toFixed(2)}</span></div>
            <small>Scale ends at the highest mean shown for this gene.</small>
          </>
        ) : <small>No positive means on this plane.</small>}
        <div className="hm-map-states">
          <span><i style={{ background: undetected }} />No detected cells</span>
          <span><i style={{ background: unavailable }} />Unavailable</span>
        </div>
      </div>
    </>
  );
}
