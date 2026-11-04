import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Modal } from '../common/Modal';
import { DatasetQualityBadges } from '../common/QualityBadges';
import { getAuthorValidation } from '../data/authorValidation';
import { PopWarningBadge } from '../common/PopWarningBadge';
import { SortableTable } from '../common/SortableTable';
import type { SortableColumn } from '../common/SortableTable';
import { BUNDLE_BASE } from '../data/bundleBase';
import {
  commonSamplePrefix, stripSamplePrefix, trackGroupSamples, trackSamplesKept, partitionGroupSamples,
} from '../utils/sampleIds';
import { UP_TEXT_COLOR, DOWN_TEXT_COLOR, FONT_MONO, FONT_SANS } from '../styles/constants';
import type { Dataset, DatasetMeta, QcGlobal, RawTrack, ResolvedContrast } from '../types';
import {
  compositionTables, deTable, fgseaTable, qcKpis, qcVocabulary, reportTable, runTable, sizeTable,
  visibleQcSections,
} from './qcTables';
import type {
  QcCompositionRow, QcDeRow, QcReportRow, QcRunRow, QcSizeRow,
} from './qcTables';

const SCROLL_SPY_SECTION_IDS = ['runs', 'sizes', 'de', 'fgsea', 'composition', 'reports'] as const;

function withRenderers<Row>(
  columns: SortableColumn<Row>[],
  renderers: Partial<Record<string, (row: Row) => ReactNode>>,
): SortableColumn<Row>[] {
  return columns.map((column) => {
    const render = renderers[column.key];
    return render ? { ...column, render } : column;
  });
}

function KPICard({ number, label, detail }: { number: ReactNode; label: ReactNode; detail: ReactNode }) {
  return (
    <dl style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 4, padding: 14, margin: 0 }}>
      <dt style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-muted)', fontWeight: 600 }}>
        {label}
      </dt>
      <dd style={{ margin: 0, fontFamily: FONT_MONO, fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
        {number}
      </dd>
      <div style={{ height: 1, background: 'var(--border)', margin: '8px 0' }} />
      <dd style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        {detail}
      </dd>
    </dl>
  );
}

// One Sizes-row cell listing the track's replicate sample ids per arm. The ids
// live in the track bundle (groupSamples + samplesKept), which loads lazily — so
// a track the user hasn't opened renders an em-dash rather than forcing a fetch.
// A loaded track shows a kept-count toggle; expanding reveals the per-arm ids,
// with any QC-dropped ids struck through.
function SamplesCell({ track, groups, expanded, onToggle }: {
  track: RawTrack | undefined;
  groups: Array<{ key: string; label: string; color: string }>;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (!track) {
    return (
      <span title="Open this track to load its replicate sample ids."
        style={{ color: 'var(--text-muted)' }}>—</span>
    );
  }
  const groupSamples = trackGroupSamples(track);
  const samplesKept = trackSamplesKept(track);
  const parts = groups.map((g) => ({ ...g, ...partitionGroupSamples(groupSamples, samplesKept, g.key) }));
  const allIds = parts.flatMap((p) => [...p.kept, ...p.dropped]);
  if (allIds.length === 0) {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  }
  const prefix = commonSamplePrefix(allIds);
  const totalKept = parts.reduce((n, p) => n + p.kept.length, 0);
  const totalDropped = parts.reduce((n, p) => n + p.dropped.length, 0);
  const fmt = (ids: string[]) => ids.map((id) => stripSamplePrefix(id, prefix)).join(', ');

  return (
    <div>
      <button type="button"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        // Only swallow the keys the button itself acts on (Enter/Space), so the
        // toggle doesn't also trigger the row's jump-to-population handler; other
        // keys still bubble for any row-level navigation.
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
        aria-expanded={expanded}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: 11, fontFamily: FONT_MONO,
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          color: 'var(--text-primary)',
        }}>
        <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>{expanded ? '▾' : '▸'}</span>
        {totalDropped > 0 ? `${totalKept}/${totalKept + totalDropped} kept` : `${totalKept} sample${totalKept === 1 ? '' : 's'}`}
      </button>
      {expanded && (
        <div style={{ marginTop: 5, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {parts.map((p) => (
            <div key={p.key} style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.color, flexShrink: 0, alignSelf: 'center' }} />
              <span style={{ color: 'var(--text-muted)', minWidth: 46 }}>{p.label}</span>
              <span>
                {p.kept.length > 0 ? fmt(p.kept) : <span style={{ color: 'var(--text-muted)' }}>none</span>}
                {p.dropped.length > 0 && (
                  <span title="Dropped by QC"
                    style={{ color: 'var(--text-muted)', textDecoration: 'line-through', marginLeft: p.kept.length > 0 ? 6 : 0 }}>
                    {fmt(p.dropped)}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QAReportModal({ filename, label, baseUrl, onClose }: {
  popId?: string;
  filename: string;
  label: string;
  /** Origin the QC PDFs are served from — the dataset's bundle base (R2 when
   *  VITE_BUNDLE_BASE_URL is set), '' for same-origin. Same contract as the
   *  meta/qc_global/track loaders, so the PDFs travel with the data bundles. */
  baseUrl: string;
  onClose: () => void;
}) {
  return (
    <Modal
      ariaLabel={`QA report for ${label}`}
      title={<>
        {label}
        <span style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 400, marginLeft: 8 }}>/qc/{filename}</span>
      </>}
      headerRight={
        // target="_blank": cross-origin (R2) the browser ignores `download` and
        // navigates instead — without a new tab that navigation would replace
        // the app. Same-origin the download attribute still wins.
        <a href={`${baseUrl}/qc/${filename}`} download target="_blank" rel="noopener"
          style={{ fontSize: 12, color: 'var(--text-primary)', textDecoration: 'none', padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 3 }}>
          ↓ Download
        </a>
      }
      width="90vw" height="92vh"
      onClose={onClose}
    >
      <iframe
        title={`QA report: ${label}`}
        src={`${baseUrl}/qc/${filename}`}
        style={{ flex: 1, width: '100%', border: 'none' }}
      />
    </Modal>
  );
}

interface QAModalState {
  popId: string;
  filename: string;
  label: string;
}

interface QCTabProps {
  /**
   * Select a track. QC is a dataset-scoped tab, so the explorer position lands
   * the selection on the Gene Explorer — this tab never names a tab itself.
   */
  onSelectTrack: (popId: string) => void;
  qcData?: QcGlobal | null;
  meta?: DatasetMeta | null;
  dataset?: Dataset | null;
  contrast?: ResolvedContrast | null;
  /**
   * Loaded-track lookup for the active dataset (bare track id). Used by the
   * Sizes section to list each track's replicate sample ids; tracks the user
   * hasn't opened resolve undefined (bundles load lazily) and render an em-dash.
   */
  getTrack?: (trackId: string) => RawTrack | undefined;
}

export function QCTab({ onSelectTrack, qcData, meta, dataset, contrast, getTrack }: QCTabProps) {
  const [activeSection, setActiveSection] = useState('runs');
  const [deQuery, setDeQuery] = useState('');
  const [fgseaQuery, setFgseaQuery] = useState('');
  const [deShowAll, setDeShowAll] = useState(false);
  const [fgseaShowAll, setFgseaShowAll] = useState(false);
  const [compositionTab, setCompositionTab] = useState<'counts' | 'props'>('counts');
  const [modal, setModal] = useState<QAModalState | null>(null);
  // Sizes rows whose per-arm sample-id list is expanded (keyed by track id).
  const [expandedSamples, setExpandedSamples] = useState<Set<string>>(() => new Set());
  const toggleSamples = useCallback((id: string) => {
    setExpandedSamples((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const containerRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  // Scroll to a section (offset for sticky nav).
  const scrollTo = useCallback((sid: string) => {
    const el = sectionRefs.current[sid];
    const container = containerRef.current;
    if (!el || !container) return;
    container.scrollTo({
      top: el.offsetTop - 58,
      behavior: 'smooth',
    });
    setActiveSection(sid);
  }, []);

  // Active section on scroll.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => {
      const y = container.scrollTop + 80;
      let cur = 'runs';
      for (const sid of SCROLL_SPY_SECTION_IDS) {
        const el = sectionRefs.current[sid];
        if (el && el.offsetTop <= y) cur = sid;
      }
      setActiveSection(cur);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  // ── Derived data ───────────────────────────────────────────────────
  // QC + metadata arrive as props from App (loadDatasetQC / active dataset
  // meta). Null props (mid dataset-switch, or a load failure) render the empty
  // shell — there is no ambient-global fallback, so a stale previous-dataset
  // blob can never render against the new dataset's labels.
  const v = useMemo(() => qcVocabulary(dataset, contrast), [dataset, contrast]);
  const kpis = useMemo(() => qcKpis(qcData, meta), [qcData, meta]);

  // Pop click in any QC table → go back to Gene Explorer.
  const jumpToPop = (popId: string) => {
    if (!popId) return;
    if (!meta?.populations?.includes(popId)) return;
    onSelectTrack(popId);
  };

  // ── Run status rows ────────────────────────────────────────────────
  const run = useMemo(() => runTable(qcData, meta, v), [qcData, meta, v]);
  const runCols = withRenderers<QcRunRow>(run.columns, {
    status: (r) => <span style={{ color: r.status === 'ok' ? '#2F7D31' : '#C0392B', fontWeight: 600 }}>{r.status ?? '–'}</span>,
    message: (r) => <span style={{ color: 'var(--text-muted)' }}>{r.message || ''}</span>,
  });

  // ── Sizes rows ────────────────────────────────────────────────────
  const size = useMemo(() => sizeTable(meta, v), [meta, v]);
  const sizeCols = withRenderers<QcSizeRow>(size.columns, {
    is3v3: (r) => r.is3v3
      ? <span style={{ color: '#2F7D31' }}>3v3 ✓</span>
      : <PopWarningBadge is3v3={false} nNormal={r.nNormal as number | undefined} nObese={r.nObese as number | undefined} />,
    samples: (r) => (
      <SamplesCell
        track={getTrack?.(r.cluster)}
        groups={v.sampleGroups}
        expanded={expandedSamples.has(r.cluster)}
        onToggle={() => toggleSamples(r.cluster)}
      />
    ),
  });

  // ── DE summary ────────────────────────────────────────────────────
  const de = useMemo(
    () => deTable(qcData, meta, v, { query: deQuery, showAll: deShowAll }),
    [qcData, meta, v, deQuery, deShowAll],
  );
  const deCols = withRenderers<QcDeRow>(de.columns, {
    top5_up: (r) => <span style={{ color: UP_TEXT_COLOR }}>{r.top5_up}</span>,
    top5_down: (r) => <span style={{ color: DOWN_TEXT_COLOR }}>{r.top5_down}</span>,
  });

  // ── FGSEA summary (aggregate per pop) ─────────────────────────────
  const fgsea = useMemo(
    () => fgseaTable(qcData, meta, v, { query: fgseaQuery, showAll: fgseaShowAll }),
    [qcData, meta, v, fgseaQuery, fgseaShowAll],
  );

  // ── Composition rows ─────────────────────────────────────────────
  const composition = useMemo(
    () => compositionTables(qcData, meta, compositionTab),
    [qcData, meta, compositionTab],
  );

  // ── QA reports rows ───────────────────────────────────────────────
  const reports = useMemo(() => reportTable(meta, v), [meta, v]);
  const reportCols = withRenderers<QcReportRow>(reports.columns, {
    filename: (r) => {
      const filename = r.filename;
      return filename ? (
        <button type="button"
          onClick={(e) => { e.stopPropagation(); setModal({ popId: r.cluster, filename, label: r.label }); }}
          style={{
            fontSize: 11, padding: '2px 10px', border: '1px solid var(--border)',
            borderRadius: 3, background: 'var(--bg-panel)', cursor: 'pointer',
            fontFamily: FONT_SANS,
          }}
        >View report</button>
      ) : (
        <span title="No QA report was generated for this population."
          style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          No QA report
        </span>
      );
    },
  });

  const searchBox = (value: string, onChange: (v: string) => void, placeholder: string) => (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: 'min(220px, 100%)', minWidth: 0, padding: '4px 8px', fontSize: 12,
        border: '1px solid var(--border-dark)', borderRadius: 4,
        fontFamily: FONT_SANS,
      }}
    />
  );

  // A section renders only when its data exists / the dataset supports it.
  const showComposition = !v.hasDataset || composition.hasData;
  const visibleSections = useMemo(
    () => visibleQcSections(v, composition.hasData),
    [v, composition.hasData],
  );

  return (
    <div ref={containerRef} style={{
      height: '100%', overflowY: 'auto',
      background: 'var(--bg-app)',
      position: 'relative',
    }}>
      {/* Intro + KPI strip */}
      <div style={{ padding: '16px 24px 10px', background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>Quality control</h2>
        {dataset && getAuthorValidation(dataset.id) && <div style={{ marginTop: 10 }}>
          <DatasetQualityBadges record={getAuthorValidation(dataset.id)!} contrastId={contrast?.id} />
        </div>}
        <div style={{ marginTop: 4, fontSize: 13, color: 'var(--text-muted)' }}>
          Sample sizes, analysis status and QA reports for {kpis.pops} {kpis.pops === 1 ? v.trackNoun : v.trackNounPlural}.
        </div>
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <KPICard number={kpis.pops} label={`${v.trackNounCap}s`} detail={`${kpis.pops} ${v.trackNounPlural} in dataset`} />
          <KPICard number={kpis.statusOk} label="Ran OK" detail={`${kpis.statusFail} failed (no DE${v.supportsPathways ? '/FGSEA' : ''})`} />
          <KPICard number={kpis.lowPower} label="Low power" detail="Fewer than 3 replicates per arm" />
          <KPICard number={kpis.noQa} label="No QA report" detail="No PDF in the analysis output" />
        </div>
      </div>

      {/* Sticky section nav */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 5,
        background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)',
        padding: '6px 24px', display: 'flex', gap: 8, overflowX: 'auto',
      }}>
        {visibleSections.map((s) => (
          <button key={s.id} type="button" onClick={() => scrollTo(s.id)}
            style={{
              padding: '6px 12px', fontSize: 12, cursor: 'pointer',
              background: 'transparent', border: 'none',
              borderBottom: activeSection === s.id ? '2px solid var(--color-selected)' : '2px solid transparent',
              color: activeSection === s.id ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: activeSection === s.id ? 600 : 500,
              fontFamily: FONT_SANS,
              whiteSpace: 'nowrap',
            }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Runs ──────────────────────────────────────────────────── */}
      <section ref={(el) => { if (el) sectionRefs.current.runs = el; }} style={{ padding: '18px 24px' }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>Run status</h3>
        <SortableTable
          rows={run.rows}
          columns={runCols}
          onRowClick={(r) => jumpToPop(r.cluster)}
          rowBgFn={(r) => r.status && r.status !== 'ok' ? '#fff5f5' : undefined}
        />
      </section>

      {/* ── Sizes ─────────────────────────────────────────────────── */}
      <section ref={(el) => { if (el) sectionRefs.current.sizes = el; }} style={{ padding: '18px 24px' }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>Per-{v.trackNoun} sample sizes</h3>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 8px' }}>
          Expand &quot;Replicate samples&quot; to see retained and QC-dropped sample IDs in each arm.
          IDs are available for {v.trackNounPlural} you have opened.
        </div>
        <SortableTable rows={size.rows} columns={sizeCols} onRowClick={(r) => jumpToPop(r.cluster)} />
      </section>

      {/* ── DE ────────────────────────────────────────────────────── */}
      <section ref={(el) => { if (el) sectionRefs.current.de = el; }} style={{ padding: '18px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>DE summary</h3>
          {searchBox(deQuery, setDeQuery, `Search ${v.trackNoun} or label…`)}
          {de.hasExtraColumns && (
            <button type="button" onClick={() => setDeShowAll((v) => !v)}
              style={{ fontSize: 11, padding: '3px 10px', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', background: 'var(--bg-panel)' }}>
              {deShowAll ? 'Hide extra columns ▴' : 'Show all columns ▾'}
            </button>
          )}
        </div>
        <SortableTable rows={de.rows} columns={deCols} onRowClick={(r) => jumpToPop(r.cluster)} />
      </section>

      {/* ── FGSEA (only when the dataset supports pathway enrichment) ─ */}
      {v.supportsPathways && (
      <section ref={(el) => { sectionRefs.current.fgsea = el; }} style={{ padding: '18px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>FGSEA summary</h3>
          {searchBox(fgseaQuery, setFgseaQuery, `Search ${v.trackNoun} or label…`)}
          <button type="button" onClick={() => setFgseaShowAll((v) => !v)}
            style={{ fontSize: 11, padding: '3px 10px', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', background: 'var(--bg-panel)' }}>
            {fgseaShowAll ? 'Hide FDR 0.25 ▴' : 'Show FDR 0.25 ▾'}
          </button>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Pathways passing each FDR threshold, by database.</span>
        </div>
        <SortableTable rows={fgsea.rows} columns={fgsea.columns} onRowClick={(r) => jumpToPop(r.cluster)} />
      </section>
      )}

      {/* ── Composition (single-cell QC; hidden when there is no data) ─ */}
      {showComposition && (
      <section ref={(el) => { sectionRefs.current.composition = el; }} style={{ padding: '18px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Cell composition</h3>
          <div style={{ display: 'flex', border: '1px solid var(--border-dark)', borderRadius: 4, overflow: 'hidden' }}>
            {([['counts', 'Counts'], ['props', 'Proportions']] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setCompositionTab(k)}
                style={{
                  padding: '3px 10px', fontSize: 11, border: 'none', cursor: 'pointer',
                  background: compositionTab === k ? 'var(--text-primary)' : 'white',
                  color: compositionTab === k ? 'white' : 'var(--text-primary)',
                }}>{label}</button>
            ))}
          </div>
        </div>
        <SortableTable rows={composition.wide.rows} columns={composition.wide.columns} onRowClick={(r: QcCompositionRow) => jumpToPop(typeof r.cluster === 'string' ? r.cluster : '')} />
        <h4 style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px', color: 'var(--text-muted)' }}>
          Differential abundance (quasibinomial)
        </h4>
        <SortableTable rows={composition.daQuasi.rows} columns={composition.daQuasi.columns} onRowClick={(r: QcCompositionRow) => jumpToPop(typeof r.cluster === 'string' ? r.cluster : '')} />
      </section>
      )}

      {/* ── Reports ───────────────────────────────────────────────── */}
      <section ref={(el) => { if (el) sectionRefs.current.reports = el; }} style={{ padding: '18px 24px 40px' }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>QA reports</h3>
        <SortableTable rows={reports.rows} columns={reportCols} />
      </section>

      {modal && (
        <QAReportModal
          popId={modal.popId}
          filename={modal.filename}
          label={modal.label}
          baseUrl={dataset?.bundleBaseUrl ?? BUNDLE_BASE}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
