import { useEffect, useState } from 'react';
import { AtlasMap, regions } from './AtlasMap';
import { type DatasetMetrics, datasetMetrics, loadAtlasGene, type Metrics, poolMetrics } from './atlas';
import { type Csv, CsvDialog } from './CsvDialog';
import './preview.css';

const whole = 'Whole hypothalamus';
const unit = 'ln(1 + counts per 10k)';
const colors = ['#376592', '#a6632c', '#338071', '#96577f', '#577a32', '#785ca5', '#a94953', '#24758b', '#7d663a', '#58768c', '#5c6fc6', '#aa5835', '#3c8262', '#8e5272', '#777442', '#315f83', '#6578a2', '#a35c53'];
const count = new Intl.NumberFormat('en-US');
type AtlasResult = Awaited<ReturnType<typeof loadAtlasGene>>;
type Ready = Extract<AtlasResult, { state: 'ready' }>;

function value(n: number | null, suffix = '') {
  return n === null ? '—' : n.toFixed(2) + suffix;
}

function Summary({ row }: { row: Metrics }) {
  return (
    <div className="hm-summary">
      <div className="hm-donut" style={{ background: `conic-gradient(#266997 ${row.detection ?? 0}%, #e1e8ed 0)` }}>
        <div><strong>{row.positive === null || !row.eligible ? '—' : count.format(row.positive)}</strong><small>of {count.format(row.eligible)} cells</small></div>
      </div>
      <div>
        <strong>{value(row.detection, '%')}</strong> detected
        <details><summary>Detection formula</summary>Cells with at least one stored count ÷ eligible cells × 100.</details>
      </div>
      <div>
        <strong>{value(row.mean)}</strong> mean when detected
        <small>{unit}</small>
        <details><summary>Expression formula</summary>Mean of ln(1 + 10,000 × gene count ÷ total stored counts per cell), over detected cells.</details>
      </div>
    </div>
  );
}

function Chart({ rows, field, checked, onExport }: {
  rows: DatasetMetrics[];
  field: 'detection' | 'mean';
  checked: string[];
  onExport: () => void;
}) {
  const title = field === 'detection' ? '% detected' : 'Mean expression when detected';
  const values = rows.flatMap(row => row[field] === null ? [] : [row[field]]);
  const mean = values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
  const sem = mean !== null && values.length > 1
    ? Math.sqrt(values.reduce((sum, n) => sum + (n - mean) ** 2, 0) / (values.length * (values.length - 1))) : null;
  const max = field === 'detection' ? 100 : Math.max(1, Math.ceil(Math.max(...values, (mean ?? 0) + (sem ?? 0))));
  const y = (n: number) => 190 - n / max * 170;
  return (
    <section className="hm-card">
      <h5>{title}</h5>
      <small>{field === 'mean' ? unit : 'Percent of eligible cells'}</small>
      <svg className="hm-chart" viewBox="0 0 235 215" aria-label={title}>
        {[0, .25, .5, .75, 1].map(tick => (
          <g key={tick}>
            <line x1="42" x2="222" y1={y(tick * max)} y2={y(tick * max)} stroke="#dbe2e8" />
            <text x="36" y={y(tick * max) + 4} textAnchor="end">{Number((tick * max).toFixed(2))}</text>
          </g>
        ))}
        {mean !== null && <rect x="84" y={y(mean)} width="96" height={190 - y(mean)} fill="#dce9f3" />}
        {mean !== null && sem !== null && <path d={`M116 ${y(mean + sem)}h32 M132 ${y(mean + sem)}V${y(mean - sem)} M116 ${y(mean - sem)}h32`} stroke="#18364e" strokeWidth="1.5" />}
        {rows.map((row, i) => {
          const n = row[field];
          if (n === null) return null;
          const label = `${row.label}: ${value(n, field === 'detection' ? '%' : '')}`;
          return <circle key={row.id} cx="132" cy={y(n)} r="4.5" fill={colors[i]} stroke={checked.includes(row.id) ? '#c69a1e' : 'white'}
            strokeWidth={checked.includes(row.id) ? 2.5 : 1} tabIndex={0} aria-label={label}><title>{label}</title></circle>;
        })}
        <text x="132" y="209" textAnchor="middle">Contributing datasets</text>
      </svg>
      <p>Dataset mean {value(mean)}{sem !== null && ` ± ${value(sem)} SEM`} · {values.length} with values</p>
      <button className="portal-secondary" type="button" disabled={!checked.length} onClick={onExport}>Preview CSV</button>
    </section>
  );
}


function AtlasViews({ data }: { data: Ready }) {
  const [view, setView] = useState<'spatial' | 'datasets'>('spatial');
  const [region, setRegion] = useState(whole);
  const [checked, setChecked] = useState<string[]>([]);
  const [csv, setCsv] = useState<Csv | null>(null);
  const { metadata, record, gene } = data;
  const rows = datasetMetrics(metadata, record, region);
  const summaries = Object.fromEntries(metadata.contexts.map(context => [context, poolMetrics(datasetMetrics(metadata, record, context))]));
  const named = metadata.contexts.filter(context => context !== whole && context !== 'No HypoMap region');
  const offPlane = named.filter(context => !Object.values<string>(regions).includes(context));

  function exportChart(field: 'detection' | 'mean') {
    setCsv({
      title: `${gene[1]} · ${region} · ${field === 'detection' ? 'Detection' : 'Mean expression'} by dataset`,
      headers: ['Dataset', 'Accession', 'Region', field === 'detection' ? '% detected' : unit],
      rows: rows.filter(row => checked.includes(row.id)).map(row => [row.label, row.id, region, row[field]]),
    });
  }

  return (
    <>
      <div className="hm-controls">
        <button className="portal-secondary" type="button" aria-pressed={view === 'spatial'} onClick={() => setView('spatial')}>Spatial</button>
        <button className="portal-secondary" type="button" aria-pressed={view === 'datasets'} onClick={() => setView('datasets')}>By dataset</button>
      </div>
      {view === 'spatial' ? (
        <div className="hm-grid">
          <section className="hm-card">
            <h5>Coronal hypothalamus schematic</h5>
            <AtlasMap summaries={summaries} region={region} onSelect={name => setRegion(region === name ? whole : name)} />
            {!!offPlane.length && <details><summary>Regions off this plane</summary>
              <div className="hm-controls">{offPlane.map(name => (
                <button key={name} type="button" className="portal-secondary" aria-pressed={region === name} onClick={() => setRegion(region === name ? whole : name)}>
                  {name} · {value(summaries[name].detection, '%')}
                </button>
              ))}</div>
            </details>}
          </section>
          <section className="hm-card">
            <h5>{region}</h5>
            <Summary row={summaries[region]} />
            <div className="hm-controls">
              {region !== whole && <button className="portal-secondary" type="button" onClick={() => setRegion(whole)}>Reset to whole hypothalamus</button>}
              <button className="portal-secondary" type="button" onClick={() => setCsv({
                title: `${gene[1]} · Spatial expression`,
                headers: ['Region', 'Eligible cells', 'Detected cells', '% detected', unit],
                rows: metadata.contexts.map(name => {
                  const row = summaries[name];
                  return [name, row.eligible, row.positive, row.detection, row.mean];
                }),
              })}>Preview spatial CSV</button>
            </div>
          </section>
        </div>
      ) : (
        <>
          <label className="hm-region">Region <select value={region} onChange={event => setRegion(event.target.value)}>
            {[whole, ...named].map(name => <option key={name}>{name}</option>)}
          </select></label>
          <div className="hm-grid">
            <Chart rows={rows} field="detection" checked={checked} onExport={() => exportChart('detection')} />
            <Chart rows={rows} field="mean" checked={checked} onExport={() => exportChart('mean')} />
          </div>
          <fieldset className="hm-legend">
            <legend>Datasets for detail cards and CSV</legend>
            {rows.map((row, i) => (
              <label key={row.id}>
                <input type="checkbox" checked={checked.includes(row.id)} onChange={event => {
                  const selected = event.target.checked;
                  setChecked(ids => selected ? [...ids, row.id] : ids.filter(id => id !== row.id));
                }} />
                <span className="hm-swatch" style={{ background: colors[i] }} />{row.label}
              </label>
            ))}
          </fieldset>
          <div className="hm-grid">{checked.map(id => {
            const row = rows.find(item => item.id === id);
            return row && <section className="hm-card" key={id}><h5>{row.label}</h5><small>{row.id}</small><Summary row={row} /></section>;
          })}</div>
        </>
      )}
      <p className="portal-note">Zero detection means no counts were stored for this scope. Per-study feature coverage is unavailable in the atlas export.</p>
      {csv && <CsvDialog csv={csv} onClose={() => setCsv(null)} />}
    </>
  );
}

export function HypoMapPreview({ symbol }: { symbol: string }) {
  const [result, setResult] = useState<AtlasResult | 'error' | null>(null);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the Retry trigger, not read inside.
  useEffect(() => {
    let active = true;
    loadAtlasGene(symbol).then(
      data => { if (active) setResult(data); },
      () => { if (active) setResult('error'); },
    );
    return () => { active = false; };
  }, [symbol, attempt]);

  return (
    <section className="hm-preview" id="hypomap-preview" aria-labelledby="hypomap-preview-title">
      <h3 id="hypomap-preview-title">Mouse single-cell expression in HypoMap</h3>
      <p className="portal-note">Among cells included in HypoMap · 384,925 cells from 18 contributing datasets.</p>
      {result === null && <p role="status">Loading HypoMap expression…</p>}
      {result === 'error' && <p role="status">HypoMap preview data could not be loaded. <button type="button" className="portal-secondary" onClick={() => {
        setResult(null);
        setAttempt(n => n + 1);
      }}>Retry</button></p>}
      {result && result !== 'error' && result.state === 'missing' && <p>No HypoMap feature matched {symbol}.</p>}
      {result && result !== 'error' && result.state === 'ambiguous' && <p>Multiple atlas features match {symbol}. Search a canonical symbol: {result.candidates.join(', ')}.</p>}
      {result && result !== 'error' && result.state === 'ready' && <AtlasViews data={result} />}
    </section>
  );
}
