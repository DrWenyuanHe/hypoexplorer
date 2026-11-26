import { useState } from 'react';
import { AtlasMap, regions } from './AtlasMap';
import {
  type AtlasTable, COHORT, type DatasetMetrics, datasetSummary, datasetTable, EXPRESSION_UNIT, loadAtlasGene, type MetricField, type Metrics,
  missMessage, type ReadyAtlas, spatialTable, WHOLE,
} from './atlas';
import { CsvDialog } from './CsvDialog';
import { useLoad } from '../../common/useLoad';
import { tabKeyTarget } from '../../utils/tabKeys';
import './preview.css';

const colors = ['#376592', '#a6632c', '#338071', '#96577f', '#577a32', '#785ca5', '#a94953', '#24758b', '#7d663a', '#58768c', '#5c6fc6', '#aa5835', '#3c8262', '#8e5272', '#777442', '#315f83', '#6578a2', '#a35c53'];
const count = new Intl.NumberFormat('en-US');
const views = [
  { id: 'spatial', label: 'Spatial', hint: 'Explore regions' },
  { id: 'datasets', label: 'By dataset', hint: 'Compare studies' },
] as const;

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
        <details className="hm-formula"><summary>Detection formula</summary>
          <div className="hm-equation" role="math" aria-label="Detected cells divided by eligible cells, times 100 percent">
            <span className="hm-fraction"><span>Cells with ≥1 stored count</span><span>Eligible cells</span></span>
            <span>× 100%</span>
          </div>
        </details>
      </div>
      <div>
        <strong>{value(row.mean)}</strong> mean when detected
        <small>{EXPRESSION_UNIT}</small>
        <details className="hm-formula"><summary>Expression formula</summary>
          <div className="hm-equation" role="math" aria-label="Natural logarithm of one plus 10,000 times gene count divided by total stored counts per cell">
            <span>ln</span><span className="hm-math-paren">(</span><span>1 + 10,000 ×</span>
            <span className="hm-fraction"><span>Gene count</span><span>Cell total</span></span>
            <span className="hm-math-paren">)</span>
          </div>
          <p className="hm-formula-note">Cell total = total stored counts per cell.<br />Averaged over detected cells only.</p>
        </details>
      </div>
    </div>
  );
}

function Chart({ rows, field, checked, onExport }: {
  rows: DatasetMetrics[];
  field: MetricField;
  checked: string[];
  onExport: () => void;
}) {
  const title = field === 'detection' ? '% detected' : 'Mean expression when detected';
  const { values, mean, sem } = datasetSummary(rows, field);
  const max = field === 'detection' ? 100 : Math.max(1, Math.ceil(Math.max(...values, (mean ?? 0) + (sem ?? 0))));
  const y = (n: number) => 190 - n / max * 170;
  return (
    <section className="hm-card">
      <h5>{title}</h5>
      <small>{field === 'mean' ? EXPRESSION_UNIT : 'Percent of eligible cells'}</small>
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


function AtlasViews({ data }: { data: ReadyAtlas }) {
  const [view, setView] = useState<(typeof views)[number]['id']>('spatial');
  const [region, setRegion] = useState(WHOLE);
  const [checked, setChecked] = useState<string[]>([]);
  const [table, setTable] = useState<AtlasTable | null>(null);
  const rows = data.byDataset(region);
  const summaries = data.pooled;
  const offPlane = data.namedRegions.filter(context => !Object.values<string>(regions).includes(context));
  const exportChart = (field: MetricField) => setTable(datasetTable(data, region, field, checked));

  return (
    <>
      <div className="hm-view-header">
        <div className="hm-tabs" role="tablist" aria-label="HypoMap view">
          {views.map((tab, i) => (
            <button key={tab.id} id={`hm-tab-${tab.id}`} type="button" role="tab"
              aria-selected={view === tab.id} aria-controls="hm-view-panel" tabIndex={view === tab.id ? 0 : -1}
              // Focus the tab explicitly: Safari does not focus a clicked button, which would leave the arrow keys inert.
              onClick={event => { event.currentTarget.focus(); setView(tab.id); }}
              onKeyDown={event => {
                const next = tabKeyTarget(event.key, i, views.length);
                if (next === null) return;
                event.preventDefault();
                setView(views[next].id);
                document.getElementById(`hm-tab-${views[next].id}`)?.focus();
              }}>
              <span>{tab.label}</span>
              <small>{tab.hint}</small>
            </button>
          ))}
        </div>
        {view === 'spatial' && <button className="hm-view-export" type="button" onClick={() => setTable(spatialTable(data))}>Preview spatial CSV <span aria-hidden="true">↗</span></button>}
      </div>
      <div id="hm-view-panel" role="tabpanel" aria-labelledby={`hm-tab-${view}`}>
      {view === 'spatial' ? (
        <div className="hm-grid">
          <section className="hm-card">
            <h5>Coronal hypothalamus schematic</h5>
            <AtlasMap summaries={summaries} region={region} onSelect={name => setRegion(region === name ? WHOLE : name)} />
            {!!offPlane.length && <details className="hm-other-regions"><summary><span>Regions off this plane</span><span className="hm-region-count">{offPlane.length}</span></summary>
              <div className="hm-controls">{offPlane.map(name => (
                <button key={name} type="button" className="portal-secondary" aria-pressed={region === name} onClick={() => setRegion(region === name ? WHOLE : name)}>
                  {name} · {value(summaries[name].detection, '%')}
                </button>
              ))}</div>
            </details>}
          </section>
          <section className="hm-card">
            <header className="hm-summary-header">
              <h5>{region}</h5>
              {region !== WHOLE && <button className="hm-scope-reset" type="button" onClick={() => setRegion(WHOLE)} aria-label="Reset to whole hypothalamus">← {WHOLE}</button>}
            </header>
            <Summary row={summaries[region]} />
          </section>
        </div>
      ) : (
        <>
          <label className="hm-region">Region <select value={region} onChange={event => setRegion(event.target.value)}>
            {[WHOLE, ...data.namedRegions].map(name => <option key={name}>{name}</option>)}
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
      </div>
      <p className="portal-note">Zero detection means no counts were stored for this scope. Per-study feature coverage is unavailable in the atlas export.</p>
      {table && <CsvDialog table={table} onClose={() => setTable(null)} />}
    </>
  );
}

export function HypoMapPreview({ symbol }: { symbol: string }) {
  const load = useLoad(symbol, () => loadAtlasGene(symbol));
  const result = load.state === 'loaded' ? load.value : null;

  return (
    <section className="hm-preview" id="hypomap-preview" aria-labelledby="hypomap-preview-title">
      <h3 id="hypomap-preview-title">Mouse single-cell expression in HypoMap</h3>
      <p className="portal-note">Among cells included in HypoMap · {count.format(COHORT.cells)} cells from {COHORT.datasets} contributing datasets.</p>
      {load.state === 'loading' && <p role="status">Loading HypoMap expression…</p>}
      {load.state === 'failed' && <p role="status">HypoMap preview data could not be loaded. <button type="button" className="portal-secondary" onClick={load.retry}>Retry</button></p>}
      {result && (result.state === 'ready' ? <AtlasViews data={result} /> : <p>{missMessage(result, symbol)}</p>)}
    </section>
  );
}
