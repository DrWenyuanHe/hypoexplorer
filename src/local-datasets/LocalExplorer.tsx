import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';
import { SortableTh } from '../common/SortableTh';
import { DOWN_COLOR, UP_COLOR } from '../styles/constants';
import { niceTicks } from '../utils/axes';
import {
  compareNullable,
  EVIDENCE_LABEL,
  geneEvidence,
  geneKey,
  geneStatus,
  pathwayEvidence,
  pathwayKey,
  pathwayStatus,
  sameOrganism,
} from './comparison';
import type { LocalEvidenceStatus } from './comparison';
import type { LocalDataset, LocalGene, LocalPathway } from './types';
import './LocalExplorer.css';

export interface LocalExplorerProps {
  datasets: LocalDataset[];
  activeId: string | null;
  onSelectDataset: (id: string) => void;
}

type Selection =
  | { kind: 'gene'; gene: string; organism: string; datasetId: string }
  | {
      kind: 'pathway';
      pathway: string;
      database: string;
      name: string;
      organism: string;
      datasetId: string;
    };
type GeneSort = 'gene' | 'logFC' | 'pvalue' | 'padj';
type PathwaySort = 'name' | 'nes' | 'padj' | 'size';
const PAGE_SIZE = 25;
const PLOT_MARGIN = { left: 62, right: 20, top: 22, bottom: 48 };
const rowKeys = new WeakMap<object, number>();
let nextRowKey = 0;
function rowKey(row: object) {
  if (!rowKeys.has(row)) rowKeys.set(row, nextRowKey++);
  return rowKeys.get(row)!;
}
const number = (value: number | null | undefined, signed = false) =>
  value == null ? 'Unavailable' : `${signed && value > 0 ? '+' : ''}${value.toFixed(3)}`;
const probability = (value: number | null | undefined) =>
  value == null
    ? 'Unavailable'
    : value === 0
      ? '0'
      : value < 0.001
        ? value.toExponential(2)
        : value.toPrecision(3);
const shortName = (name: string) =>
  name.replace(/^(?:GOBP|GO_BP|HALLMARK|REACTOME|KEGG)_/, '').replace(/_/g, ' ');
const effectClass = (value: number | null) =>
  value == null || value === 0 ? '' : value > 0 ? 'lx-up' : 'lx-down';

function EvidenceBadge({ status }: { status: LocalEvidenceStatus }) {
  return <span className={`lx-status lx-status-${status}`}>{EVIDENCE_LABEL[status]}</span>;
}

function Pager({
  count,
  page,
  onPage,
}: {
  count: number;
  page: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  return (
    <div className="lx-pager">
      <span>
        {count
          ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, count)} of ${count.toLocaleString()}`
          : '0 results'}
      </span>
      <div>
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous results page"
        >
          Previous
        </button>
        <span>
          {page} / {pages}
        </span>
        <button
          type="button"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label="Next results page"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="lx-empty">{children}</div>;
}

/** Canvas keeps a whole DE table interactive without thousands of DOM nodes. */
function LocalVolcano({
  genes,
  selectedGene,
  cutoff,
  minAbs,
  onGene,
}: {
  genes: LocalGene[];
  selectedGene: string | null;
  cutoff: number;
  minAbs: number;
  onGene: (gene: string) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const lastPointer = useRef(0);
  const [width, setWidth] = useState(620);
  const [metric, setMetric] = useState<'padj' | 'pvalue'>(() =>
    genes.some((g) => g.padj !== null) ? 'padj' : 'pvalue',
  );
  const [hover, setHover] = useState<LocalGene | null>(null);
  const h = 330,
    margin = PLOT_MARGIN;
  const w = width,
    cw = w - margin.left - margin.right,
    ch = h - margin.top - margin.bottom;
  useEffect(() => {
    if (!holder.current) return;
    const element = holder.current;
    const update = () => setWidth(Math.max(280, element.getBoundingClientRect().width));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const values = useMemo(
    () =>
      genes
        .filter((gene) => gene[metric] !== null)
        .map((gene) => ({ gene, y: -Math.log10(Math.max(1e-300, gene[metric]!)) })),
    [genes, metric],
  );
  const [xMax, yMax] = useMemo(() => {
    let x = Math.max(1, minAbs),
      y = -Math.log10(Math.max(1e-300, cutoff));
    for (const row of values) {
      x = Math.max(x, Math.abs(row.gene.logFC));
      y = Math.max(y, row.y);
    }
    return [x * 1.08, Math.max(1, y * 1.08)];
  }, [values, minAbs, cutoff]);
  const points = useMemo(
    () =>
      values.map((row) => ({
        ...row,
        x: PLOT_MARGIN.left + ((row.gene.logFC + xMax) / (2 * xMax)) * cw,
        py: PLOT_MARGIN.top + (1 - row.y / yMax) * ch,
      })),
    [values, xMax, yMax, cw, ch],
  );
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const dpr = window.devicePixelRatio || 1;
    element.width = Math.round(w * dpr);
    element.height = h * dpr;
    const context = element.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, w, h);
    for (const point of points) {
      const selected = selectedGene !== null && geneKey(selectedGene) === geneKey(point.gene.gene);
      const passes = point.gene[metric]! < cutoff && Math.abs(point.gene.logFC) > minAbs;
      context.fillStyle = selected
        ? '#7855a5'
        : passes
          ? point.gene.logFC > 0
            ? UP_COLOR
            : DOWN_COLOR
          : '#a8b2bf';
      context.globalAlpha = selected ? 1 : passes ? 0.78 : 0.38;
      context.beginPath();
      context.arc(point.x, point.py, selected ? 5.5 : passes ? 2.8 : 1.7, 0, Math.PI * 2);
      context.fill();
      if (selected) {
        context.strokeStyle = '#fff';
        context.lineWidth = 1.5;
        context.stroke();
      }
    }
    context.globalAlpha = 1;
  }, [points, w, selectedGene, metric, cutoff, minAbs]);
  const nearest = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left,
      y = event.clientY - rect.top;
    let closest: LocalGene | null = null,
      distance = 18 ** 2;
    for (const point of points) {
      const d = (point.x - x) ** 2 + (point.py - y) ** 2;
      if (d < distance) {
        distance = d;
        closest = point.gene;
      }
    }
    return closest;
  };
  const ty = (v: number) => margin.top + (1 - v / yMax) * ch;
  const tx = (v: number) => margin.left + ((v + xMax) / (2 * xMax)) * cw;
  return (
    <section className="lx-panel lx-volcano" aria-label="Local volcano plot">
      <div className="lx-panel-heading">
        <div>
          <h3>Differential expression</h3>
          <p>Click a point to explore its gene.</p>
        </div>
        <label className="lx-chart-metric">
          Y axis
          <select
            aria-label="Volcano P value metric"
            value={metric}
            onChange={(e) => {
              setMetric(e.target.value as 'padj' | 'pvalue');
              setHover(null);
            }}
          >
            <option value="padj">Adjusted P</option>
            <option value="pvalue">Raw P</option>
          </select>
        </label>
      </div>
      <div className="lx-plot-key">
        <span className="lx-up">● Positive effect</span>
        <span className="lx-down">● Negative effect</span>
        <span>● Below chart cutoffs</span>
        <span className="lx-selected-key">● Selected</span>
      </div>
      <div ref={holder} className="lx-plot-holder" style={{ height: h }}>
        {points.length === 0 ? (
          <Empty>
            No genes have a {metric === 'padj' ? 'mapped adjusted P value' : 'mapped raw P value'}{' '}
            to plot. The gene table still includes them.
          </Empty>
        ) : (
          <>
            <canvas ref={canvas} style={{ width: w, height: h }} />
            <svg
              width={w}
              height={h}
              role="img"
              aria-label="Volcano plot of local differential expression"
              aria-description="Select a point with the pointer, or choose a gene using the searchable table below."
              onPointerMove={(e) => {
                if (Date.now() - lastPointer.current < 35) return;
                lastPointer.current = Date.now();
                setHover(nearest(e));
              }}
              onPointerLeave={() => setHover(null)}
              onPointerDown={(e) => {
                const gene = nearest(e);
                if (gene) onGene(gene.gene);
              }}
            >
              <line
                x1={margin.left}
                x2={w - margin.right}
                y1={h - margin.bottom}
                y2={h - margin.bottom}
                stroke="#cbd5e0"
              />
              <line
                x1={margin.left}
                x2={margin.left}
                y1={margin.top}
                y2={h - margin.bottom}
                stroke="#cbd5e0"
              />
              {niceTicks(-xMax, xMax, 6).map((tick) => (
                <g key={tick}>
                  <line
                    x1={tx(tick)}
                    x2={tx(tick)}
                    y1={h - margin.bottom}
                    y2={h - margin.bottom + 4}
                    stroke="#cbd5e0"
                  />
                  <text x={tx(tick)} y={h - margin.bottom + 18} textAnchor="middle">
                    {tick}
                  </text>
                </g>
              ))}
              {niceTicks(0, yMax, 5).map((tick) => (
                <g key={tick}>
                  <line
                    x1={margin.left - 4}
                    x2={margin.left}
                    y1={ty(tick)}
                    y2={ty(tick)}
                    stroke="#cbd5e0"
                  />
                  <text x={margin.left - 9} y={ty(tick) + 4} textAnchor="end">
                    {tick}
                  </text>
                </g>
              ))}
              {[-minAbs, minAbs]
                .filter((v, i) => v !== 0 || i === 0)
                .map((v) => (
                  <line
                    key={v}
                    x1={tx(v)}
                    x2={tx(v)}
                    y1={margin.top}
                    y2={h - margin.bottom}
                    stroke="#c5cdd8"
                    strokeDasharray="4 4"
                  />
                ))}
              <line
                x1={margin.left}
                x2={w - margin.right}
                y1={ty(-Math.log10(Math.max(cutoff, 1e-300)))}
                y2={ty(-Math.log10(Math.max(cutoff, 1e-300)))}
                stroke="#c5cdd8"
                strokeDasharray="4 4"
              />
              <text x={margin.left + cw / 2} y={h - 5} textAnchor="middle">
                log₂ fold change, as supplied
              </text>
              <text
                x={16}
                y={margin.top + ch / 2}
                textAnchor="middle"
                transform={`rotate(-90 16 ${margin.top + ch / 2})`}
              >
                −log₁₀({metric === 'padj' ? 'adjusted P' : 'raw P'})
              </text>
            </svg>
          </>
        )}
      </div>
      <div className="lx-chart-foot" aria-live="polite">
        {hover ? (
          <>
            <strong>{hover.gene}</strong>
            <span>log₂FC {number(hover.logFC, true)}</span>
            <span>Adjusted P {probability(hover.padj)}</span>
          </>
        ) : (
          <span>
            {points.length.toLocaleString()} plotted ·{' '}
            {(genes.length - points.length).toLocaleString()} with unavailable{' '}
            {metric === 'padj' ? 'adjusted' : 'raw'} P
          </span>
        )}
      </div>
      {metric === 'pvalue' && (
        <p className="lx-note">
          Chart colors use raw P. Tables and dataset comparisons use adjusted P.
        </p>
      )}
      {values.some((v) => v.gene[metric] === 0) && (
        <p className="lx-note">Supplied P values of 0 are displayed at −log₁₀(P) = 300.</p>
      )}
    </section>
  );
}

export function LocalExplorer({ datasets, activeId, onSelectDataset }: LocalExplorerProps) {
  const active = datasets.find((dataset) => dataset.id === activeId) ?? datasets[0];
  const [tab, setTab] = useState<'genes' | 'pathways'>('genes');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [cutoff, setCutoff] = useState(0.05);
  const [minAbs, setMinAbs] = useState(0);
  const [query, setQuery] = useState('');
  const [onlyPassing, setOnlyPassing] = useState(false);
  const [page, setPage] = useState(1);
  const [geneSort, setGeneSort] = useState<{ key: GeneSort; direction: number }>({
    key: 'padj',
    direction: 1,
  });
  const [pathSort, setPathSort] = useState<{ key: PathwaySort; direction: number }>({
    key: 'padj',
    direction: 1,
  });
  const genes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (active?.genes ?? [])
      .filter(
        (g) =>
          (!needle ||
            g.gene.toLowerCase().includes(needle) ||
            g.geneId?.toLowerCase().includes(needle)) &&
          (!onlyPassing || ['up', 'down'].includes(geneStatus(g, cutoff, minAbs))),
      )
      .sort((a, b) =>
        geneSort.key === 'gene'
          ? a.gene.localeCompare(b.gene) * geneSort.direction
          : compareNullable(a[geneSort.key], b[geneSort.key], geneSort.direction),
      );
  }, [active, query, onlyPassing, cutoff, minAbs, geneSort]);
  const pathways = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (active?.pathways ?? [])
      .filter(
        (p) =>
          (!needle || `${p.name} ${p.pathway} ${p.database}`.toLowerCase().includes(needle)) &&
          (!onlyPassing || ['up', 'down', 'enriched'].includes(pathwayStatus(p, cutoff))),
      )
      .sort((a, b) =>
        pathSort.key === 'name'
          ? a.name.localeCompare(b.name) * pathSort.direction
          : compareNullable(a[pathSort.key], b[pathSort.key], pathSort.direction),
      );
  }, [active, query, onlyPassing, cutoff, pathSort]);
  const count = tab === 'genes' ? genes.length : pathways.length;
  const safePage = Math.min(page, Math.max(1, Math.ceil(count / PAGE_SIZE)));
  const geneCounts = useMemo(() => {
    const result = { up: 0, down: 0, unknown: 0 };
    for (const gene of active?.genes ?? []) {
      const status = geneStatus(gene, cutoff, minAbs);
      if (status === 'up' || status === 'down' || status === 'unknown') result[status]++;
    }
    return result;
  }, [active, cutoff, minAbs]);
  const pathwayCount = useMemo(
    () =>
      (active?.pathways ?? []).filter((p) =>
        ['up', 'down', 'enriched'].includes(pathwayStatus(p, cutoff)),
      ).length,
    [active, cutoff],
  );
  if (!active) return null;
  const pickGene = (gene: string) => {
    setSelection({ kind: 'gene', gene, organism: active.organism, datasetId: active.id });
  };
  const pickPathway = (pathway: LocalPathway) => {
    setSelection({
      kind: 'pathway',
      pathway: pathway.pathway,
      database: pathway.database,
      name: pathway.name,
      organism: active.organism,
      datasetId: active.id,
    });
  };
  const changeTab = (next: 'genes' | 'pathways') => {
    setTab(next);
    setQuery('');
    setPage(1);
  };
  const selectedGene =
    selection?.kind === 'gene' &&
    (selection.datasetId === active.id || sameOrganism(active.organism, selection.organism))
      ? selection.gene
      : null;
  const selectedPathway =
    selection?.kind === 'pathway' &&
    (selection.datasetId === active.id || sameOrganism(active.organism, selection.organism))
      ? pathwayKey(selection)
      : null;
  const sortGenes = (key: GeneSort) => {
    setGeneSort({
      key,
      direction: geneSort.key === key ? -geneSort.direction : key === 'logFC' ? -1 : 1,
    });
    setPage(1);
  };
  const sortPaths = (key: PathwaySort) => {
    setPathSort({
      key,
      direction:
        pathSort.key === key ? -pathSort.direction : key === 'nes' || key === 'size' ? -1 : 1,
    });
    setPage(1);
  };
  return (
    <div className="local-explorer">
      <section className="lx-toolbar" aria-label="Local dataset and significance controls">
        <label className="lx-dataset-picker">
          Explore dataset
          <select
            value={active.id}
            onChange={(e) => {
              onSelectDataset(e.target.value);
              setPage(1);
              setQuery('');
            }}
            aria-label="Explore local dataset"
          >
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <div className="lx-species">
          <span>Species</span>
          <strong>{active.organism || 'Unspecified'}</strong>
        </div>
        <label>
          Adjusted P &lt;
          <input
            aria-label="Adjusted P cutoff"
            type="number"
            value={cutoff}
            min={0.000000001}
            max={1}
            step="any"
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v > 0 && v <= 1) {
                setCutoff(v);
                setPage(1);
              }
            }}
          />
        </label>
        <label>
          |log₂FC| &gt;
          <input
            aria-label="Minimum absolute log2 fold change"
            type="number"
            value={minAbs}
            min={0}
            step={0.1}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 0) {
                setMinAbs(v);
                setPage(1);
              }
            }}
          />
        </label>
      </section>
      <section className="lx-summary" aria-label="Imported data summary">
        <div>
          <strong>{active.genes.length.toLocaleString()}</strong>
          <span>gene rows imported</span>
        </div>
        <div>
          <strong className="lx-up">{geneCounts.up.toLocaleString()} ↑</strong>
          <span>positive effect, passing</span>
        </div>
        <div>
          <strong className="lx-down">{geneCounts.down.toLocaleString()} ↓</strong>
          <span>negative effect, passing</span>
        </div>
        <div>
          <strong>
            {pathwayCount.toLocaleString()}{' '}
            <small>/ {active.pathways.length.toLocaleString()}</small>
          </strong>
          <span>pathways passing adjusted P</span>
        </div>
      </section>
      <div className="lx-workspace">
        {active.genes.length ? (
          <LocalVolcano
            key={`${active.id}:${geneCounts.unknown < active.genes.length ? 'adjusted' : 'raw'}`}
            genes={active.genes}
            selectedGene={selectedGene}
            cutoff={cutoff}
            minAbs={minAbs}
            onGene={pickGene}
          />
        ) : (
          <section className="lx-panel">
            <Empty>
              This dataset contains pathway results. Add its differential-expression table to see
              the volcano and gene statistics.
            </Empty>
          </section>
        )}
        <SelectionDetail
          active={active}
          selection={selection}
          cutoff={cutoff}
          minAbs={minAbs}
          onGene={(gene) => {
            pickGene(gene);
            changeTab('genes');
          }}
          onPathway={(p) => {
            pickPathway(p);
            changeTab('pathways');
          }}
          onClear={() => setSelection(null)}
        />
      </div>
      <section className="lx-panel lx-results" aria-label="Local results tables">
        <div className="lx-results-top">
          <div className="lx-tabs" role="tablist" aria-label="Local result type">
            {(['genes', 'pathways'] as const).map((kind) => (
              <button
                type="button"
                key={kind}
                role="tab"
                id={`local-${kind}-tab`}
                aria-selected={tab === kind}
                aria-controls="local-results-panel"
                onClick={() => changeTab(kind)}
              >
                {kind === 'genes' ? 'Genes' : 'Pathways'}
                <span>
                  {(kind === 'genes' ? active.genes : active.pathways).length.toLocaleString()}
                </span>
              </button>
            ))}
          </div>
          <div className="lx-table-controls">
            <input
              type="search"
              aria-label={tab === 'genes' ? 'Search local genes' : 'Search local pathways'}
              placeholder={
                tab === 'genes' ? 'Search gene symbol or ID…' : 'Search pathway or database…'
              }
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
            <label className="lx-check">
              <input
                type="checkbox"
                checked={onlyPassing}
                onChange={(e) => {
                  setOnlyPassing(e.target.checked);
                  setPage(1);
                }}
              />
              Passing only
            </label>
          </div>
        </div>
        <div id="local-results-panel" role="tabpanel" aria-labelledby={`local-${tab}-tab`}>
          {count === 0 ? (
            <Empty>
              {query || onlyPassing
                ? 'No results match these filters. Try another search or turn off Passing only.'
                : tab === 'genes'
                  ? 'No differential-expression rows imported for this dataset.'
                  : 'No pathway rows imported for this dataset. Add an FGSEA or enrichment table to connect genes and pathways.'}
            </Empty>
          ) : (
            <div className="lx-table-scroll">
              <table className="lx-table">
                {tab === 'genes' ? (
                  <>
                    <thead>
                      <tr>
                        {(
                          [
                            ['gene', 'Gene'],
                            ['logFC', 'log₂FC'],
                            ['pvalue', 'Raw P'],
                            ['padj', 'Adjusted P'],
                          ] as const
                        ).map(([key, label]) => (
                          <SortableTh
                            key={key}
                            active={geneSort.key === key}
                            dir={geneSort.direction}
                            onSort={() => sortGenes(key)}
                          >
                            {label}
                          </SortableTh>
                        ))}
                        <th scope="col">Evidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {genes.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE).map((gene) => (
                        <tr
                          key={rowKey(gene)}
                          className={
                            selectedGene !== null && geneKey(selectedGene) === geneKey(gene.gene)
                              ? 'lx-row-selected'
                              : ''
                          }
                        >
                          <td>
                            <button
                              type="button"
                              className="lx-text-button lx-gene"
                              onClick={() => pickGene(gene.gene)}
                              aria-pressed={
                                selectedGene !== null &&
                                geneKey(selectedGene) === geneKey(gene.gene)
                              }
                            >
                              {gene.gene}
                            </button>
                            {gene.geneId && gene.geneId !== gene.gene && (
                              <small className="lx-id">{gene.geneId}</small>
                            )}
                          </td>
                          <td className={effectClass(gene.logFC)}>{number(gene.logFC, true)}</td>
                          <td>{probability(gene.pvalue)}</td>
                          <td>{probability(gene.padj)}</td>
                          <td>
                            <EvidenceBadge status={geneStatus(gene, cutoff, minAbs)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                ) : (
                  <>
                    <thead>
                      <tr>
                        <SortableTh
                          active={pathSort.key === 'name'}
                          dir={pathSort.direction}
                          onSort={() => sortPaths('name')}
                        >
                          Pathway
                        </SortableTh>
                        <th scope="col">Database</th>
                        {(
                          [
                            ['nes', 'NES'],
                            ['padj', 'Adjusted P'],
                            ['size', 'Size'],
                          ] as const
                        ).map(([key, label]) => (
                          <SortableTh
                            key={key}
                            active={pathSort.key === key}
                            dir={pathSort.direction}
                            onSort={() => sortPaths(key)}
                          >
                            {label}
                          </SortableTh>
                        ))}
                        <th scope="col">Evidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pathways
                        .slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
                        .map((pathway) => (
                          <tr
                            key={rowKey(pathway)}
                            className={
                              selectedPathway === pathwayKey(pathway) ? 'lx-row-selected' : ''
                            }
                          >
                            <td>
                              <button
                                type="button"
                                className="lx-text-button lx-pathway"
                                onClick={() => pickPathway(pathway)}
                                aria-pressed={selectedPathway === pathwayKey(pathway)}
                                title={pathway.pathway}
                              >
                                {shortName(pathway.name)}
                              </button>
                            </td>
                            <td>{pathway.database || 'Unspecified'}</td>
                            <td className={effectClass(pathway.nes)}>
                              {number(pathway.nes, true)}
                            </td>
                            <td>{probability(pathway.padj)}</td>
                            <td>{pathway.size ?? 'Unavailable'}</td>
                            <td>
                              <EvidenceBadge status={pathwayStatus(pathway, cutoff)} />
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </>
                )}
              </table>
            </div>
          )}
          <Pager count={count} page={safePage} onPage={setPage} />
        </div>
        {geneCounts.unknown > 0 && tab === 'genes' && (
          <p className="lx-note">
            {geneCounts.unknown.toLocaleString()} gene rows have no adjusted P. They remain visible
            and are excluded from passing counts.
          </p>
        )}
      </section>
      {selection && (
        <CrossDatasetEvidence
          datasets={datasets}
          activeId={active.id}
          selection={selection}
          cutoff={cutoff}
          minAbs={minAbs}
          onSelectDataset={onSelectDataset}
        />
      )}
      <p className="lx-note lx-method-note">
        Effects retain the contrast direction in your files. Gene links use the supplied pathway
        gene lists; these are leading-edge genes for FGSEA, not complete pathway membership. A
        missing row or a value below the cutoff does not establish that a gene is unchanged.
      </p>
    </div>
  );
}

function SelectionDetail({
  active,
  selection,
  cutoff,
  minAbs,
  onGene,
  onPathway,
  onClear,
}: {
  active: LocalDataset;
  selection: Selection | null;
  cutoff: number;
  minAbs: number;
  onGene: (gene: string) => void;
  onPathway: (pathway: LocalPathway) => void;
  onClear: () => void;
}) {
  const [memberQuery, setMemberQuery] = useState('');
  const compatible =
    selection &&
    (selection.datasetId === active.id || sameOrganism(selection.organism, active.organism));
  const matchingGenes =
    selection?.kind === 'gene' && compatible
      ? active.genes
          .filter((g) => geneKey(g.gene) === geneKey(selection.gene))
          .sort((a, b) => compareNullable(a.padj, b.padj, 1))
      : [];
  const linkedPathways =
    selection?.kind === 'gene' && compatible
      ? active.pathways
          .filter((p) => p.genes.some((g) => geneKey(g) === geneKey(selection.gene)))
          .sort((a, b) => compareNullable(a.padj, b.padj, 1))
      : [];
  const pathway =
    selection?.kind === 'pathway' && compatible
      ? active.pathways
          .filter((p) => pathwayKey(p) === pathwayKey(selection))
          .sort((a, b) => compareNullable(a.padj, b.padj, 1))[0]
      : null;
  const gene = matchingGenes[0];
  const members =
    pathway?.genes.filter((g) => g.toLowerCase().includes(memberQuery.trim().toLowerCase())) ?? [];
  return (
    <section className="lx-panel lx-detail" aria-label="Selected local result">
      {!selection ? (
        <div className="lx-selection-empty">
          <div className="lx-selection-mark" aria-hidden="true">
            ↗
          </div>
          <h3>Follow a gene or pathway</h3>
          <p>
            Select a gene in the volcano or table to find its linked pathways. Select a pathway to
            inspect its supplied genes.
          </p>
          <p>Compare your selection across every dataset saved in this browser.</p>
        </div>
      ) : (
        <>
          <div className="lx-panel-heading">
            <div>
              <span className="lx-eyebrow">
                {selection.kind === 'gene' ? 'Selected gene' : 'Selected pathway'}
              </span>
              <h3
                className={selection.kind === 'gene' ? 'lx-selected-gene' : 'lx-selected-pathway'}
              >
                {selection.kind === 'gene' ? selection.gene : shortName(selection.name)}
              </h3>
            </div>
            <button type="button" onClick={onClear} aria-label="Clear selected result">
              Clear
            </button>
          </div>
          {!compatible ? (
            <Empty>
              This selection belongs to {selection.organism || 'an unspecified species'}. Choose a
              result from this dataset to inspect it.
            </Empty>
          ) : selection.kind === 'gene' ? (
            <>
              <div className="lx-detail-stats">
                <div>
                  <span>log₂FC</span>
                  <strong className={effectClass(gene?.logFC ?? null)}>
                    {number(gene?.logFC, true)}
                  </strong>
                </div>
                <div>
                  <span>Adjusted P</span>
                  <strong>{probability(gene?.padj)}</strong>
                </div>
                <EvidenceBadge status={geneStatus(gene, cutoff, minAbs)} />
              </div>
              {matchingGenes.length > 1 && (
                <p className="lx-note">
                  {matchingGenes.length} rows share this symbol. The smallest adjusted P is shown.
                </p>
              )}
              <h4>
                Linked pathways <span>{linkedPathways.length}</span>
              </h4>
              <p className="lx-note">Contains {selection.gene} in the supplied gene list.</p>
              <div className="lx-links">
                {linkedPathways.length ? (
                  linkedPathways.slice(0, 100).map((p) => (
                    <button
                      type="button"
                      className="lx-pathway-link"
                      key={rowKey(p)}
                      onClick={() => {
                        setMemberQuery('');
                        onPathway(p);
                      }}
                    >
                      <span>{shortName(p.name)}</span>
                      <small className={effectClass(p.nes)}>
                        NES {number(p.nes, true)} · adj. P {probability(p.padj)}
                      </small>
                    </button>
                  ))
                ) : (
                  <Empty>
                    {active.pathways.length
                      ? 'No supplied pathway gene list contains this gene symbol.'
                      : 'Import this dataset’s FGSEA or enrichment results to connect genes to pathways.'}
                  </Empty>
                )}
              </div>
              {linkedPathways.length > 100 && (
                <p className="lx-note">
                  Showing the first 100 of {linkedPathways.length} linked pathways, ordered by
                  adjusted P.
                </p>
              )}
            </>
          ) : pathway ? (
            <>
              <div className="lx-detail-stats">
                <div>
                  <span>NES</span>
                  <strong className={effectClass(pathway.nes)}>{number(pathway.nes, true)}</strong>
                </div>
                <div>
                  <span>Adjusted P</span>
                  <strong>{probability(pathway.padj)}</strong>
                </div>
                <EvidenceBadge status={pathwayStatus(pathway, cutoff)} />
              </div>
              <p className="lx-note lx-pathway-id">
                {pathway.database || 'Database unspecified'} · {pathway.pathway}
              </p>
              {pathway.nes === null && (
                <p className="lx-note">
                  No normalized enrichment score was supplied. Direction is unavailable.
                </p>
              )}
              <h4>
                Supplied genes <span>{pathway.genes.length}</span>
              </h4>
              {pathway.genes.length > 20 && (
                <input
                  type="search"
                  aria-label="Search selected pathway genes"
                  placeholder="Find a member gene…"
                  value={memberQuery}
                  onChange={(e) => setMemberQuery(e.target.value)}
                />
              )}
              <div className="lx-gene-chips">
                {members.length ? (
                  members.slice(0, 200).map((member) => (
                    <button
                      type="button"
                      key={member}
                      className="lx-gene"
                      onClick={() => {
                        setMemberQuery('');
                        onGene(member);
                      }}
                    >
                      {member}
                    </button>
                  ))
                ) : (
                  <p className="lx-note">
                    {memberQuery
                      ? 'No genes match this search.'
                      : 'No gene list was supplied for this pathway. Add a leading-edge or member-gene column during import.'}
                  </p>
                )}
              </div>
              {members.length > 200 && (
                <p className="lx-note">
                  Showing 200 of {members.length} genes. Search to find a specific gene.
                </p>
              )}
            </>
          ) : (
            <Empty>
              This pathway ID and database are not in the current dataset’s imported table.
            </Empty>
          )}
          <button
            type="button"
            className="lx-compare-jump"
            onClick={() => {
              document
                .getElementById('local-comparison')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          >
            Compare across {selection.organism || 'matching-species'} datasets ↓
          </button>
        </>
      )}
    </section>
  );
}

function CrossDatasetEvidence({
  datasets,
  activeId,
  selection,
  cutoff,
  minAbs,
  onSelectDataset,
}: {
  datasets: LocalDataset[];
  activeId: string;
  selection: Selection;
  cutoff: number;
  minAbs: number;
  onSelectDataset: (id: string) => void;
}) {
  const evidence = useMemo(
    () =>
      selection.kind === 'gene'
        ? geneEvidence(
            datasets,
            selection.gene,
            selection.organism,
            cutoff,
            minAbs,
            selection.datasetId,
          )
        : pathwayEvidence(datasets, selection, selection.organism, cutoff, selection.datasetId),
    [datasets, selection, cutoff, minAbs],
  );
  const passing = evidence.filter((row) => ['up', 'down', 'enriched'].includes(row.status)).length;
  return (
    <section
      className="lx-panel lx-comparison"
      id="local-comparison"
      aria-label="Cross-dataset local evidence"
    >
      <div className="lx-panel-heading">
        <div>
          <span className="lx-eyebrow">Across your local datasets</span>
          <h3>{selection.kind === 'gene' ? selection.gene : shortName(selection.name)}</h3>
          <p>
            {passing} of {evidence.filter((e) => e.status !== 'species-mismatch').length} compatible
            datasets pass the current cutoff.
          </p>
        </div>
        <span className="lx-local-label">Browser only</span>
      </div>
      <div className="lx-table-scroll">
        <table className="lx-table">
          <thead>
            <tr>
              <th scope="col">Dataset</th>
              <th scope="col">Species</th>
              <th scope="col">{selection.kind === 'gene' ? 'log₂FC' : 'NES'}</th>
              <th scope="col">Adjusted P</th>
              <th scope="col">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {evidence.map(({ dataset, row, status, matches }) => {
              const effect = row ? ('logFC' in row ? row.logFC : row.nes) : null;
              return (
                <tr key={dataset.id} className={dataset.id === activeId ? 'lx-row-selected' : ''}>
                  <td>
                    <button
                      type="button"
                      className="lx-text-button"
                      onClick={() => onSelectDataset(dataset.id)}
                      aria-pressed={dataset.id === activeId}
                    >
                      {dataset.name}
                    </button>
                    {dataset.id === activeId && <small className="lx-id">Current dataset</small>}
                    {matches > 1 && (
                      <small className="lx-id">{matches} matching rows; smallest adjusted P</small>
                    )}
                  </td>
                  <td>{dataset.organism || 'Unspecified'}</td>
                  <td className={effectClass(effect)}>{number(effect, true)}</td>
                  <td>{probability(row?.padj)}</td>
                  <td>
                    <EvidenceBadge status={status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="lx-note">
        {selection.kind === 'gene'
          ? 'Gene symbols are matched within the same species, ignoring letter case. The comparison does not infer aliases or orthologs. Identifier version suffixes are preserved.'
          : 'Exact pathway IDs and matching database labels are compared within the same species.'}{' '}
        An absent row is reported separately from a result below the cutoff.
      </p>
    </section>
  );
}
