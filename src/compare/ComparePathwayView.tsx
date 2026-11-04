import { Fragment, useState, useMemo, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { fmtP, fmtFDR, fmtSigned } from '../utils/format';
import { rawValueRows } from '../utils/excelExport';
import { writeWorkbook } from '../utils/workbook';
import { useExportAction } from '../utils/exportAction';
import { columnsSubject, exportName, exportProvenance, metadataSheet } from '../utils/exportProvenance';
import { BarSEMChart } from '../gene-explorer/BarSEMChart';
import { PopWarningBadge } from '../common/PopWarningBadge';
import { DbPill } from '../common/DbPill';
import { ExportButton } from '../common/ExportButton';
import { ChartScaleToggle } from '../common/ChartScaleToggle';
import { DEFAULT_FDR_CUTOFF, isFdrSignificant } from '../statistics/policy';
import { UP_TEXT_COLOR, DOWN_TEXT_COLOR, FONT_MONO, FONT_SANS } from '../styles/constants';
import { usePathwayTable } from '../pathway-explorer/pathwayTable';
import { PathwayToolbar } from '../pathway-explorer/PathwayToolbar';
import type { PopData } from '../types';
import { usePathwayView } from '../explorer/explorerSession';
import { POPULATION_NOUN, type ColumnNoun, type CompareColumn } from './compareColumns';
import { resolveGeneCI } from './resolveGene';

interface PopPathwayEntry {
  NES: number;
  padj: number;
  pval: number;
  leadingEdge?: string[];
}

interface UnifiedPathway {
  pathway: string;
  db: string;
  size: number;
  /** Keyed by column key. */
  pops: Record<string, PopPathwayEntry>;
  /**
   * The strongest |NES| this pathway reaches in ANY selected column — the
   * cross-column analogue of the single-track |NES| ranking.
   *
   * Precomputed while the row is built, not derived in the sort comparator: a
   * comparator that re-spread `Object.values(pops)` would turn an O(n log n)
   * sort into O(n log n × columns) on every keystroke.
   */
  maxAbsNES: number;
}

interface LeOverlapEntry {
  /** The first spelling seen; columns of different species may differ by case. */
  gene: string;
  count: number;
  /** Column keys whose leading edge carries the gene. */
  pops: string[];
}

interface ComparePathwayViewProps {
  /**
   * The columns to compare. Callers pass only columns that HAVE data: a
   * column still loading or failed would print as "not detected" here, which
   * is the one claim this matrix must never make about data nobody read.
   */
  columns: readonly CompareColumn[];
  /** Keyed by `column.key`. */
  popDataMap: Record<string, PopData | null>;
  /** How the columns are named in prose; populations unless told otherwise. */
  columnNoun?: ColumnNoun;
}

export function ComparePathwayView({ columns, popDataMap, columnNoun }: ComparePathwayViewProps) {
  const noun = columnNoun ?? POPULATION_NOUN;
  // The Compare view's own pathway view state — the second instance of the
  // slice, over its own row type.
  const pathwayView = usePathwayView<UnifiedPathway>();
  const {
    search: pathwaySearch, setSearch: setPathwaySearch,
    dbFilter: pathwayDBFilter, setDatabaseEnabled,
    selected: selectedPathway, select: setSelectedPathway, deselect,
  } = pathwayView;
  // One busy state per export button: the pathway table's and the leading-edge
  // panel's are different downloads on screen at the same time.
  const { busy: exporting, run: runExport } = useExportAction();
  const { busy: exportingLE, run: runLEExport } = useExportAction();
  const [leView, setLeView] = useState<'overlap' | 'genes'>('overlap');
  const [showAllProfiles, setShowAllProfiles] = useState(false);
  const PROFILE_CAP = 50;

  // Reset the leading-edge view + profile cap whenever the selected pathway changes
  // (a GO pathway can have 200-300 leading-edge genes; rendering a BarSEMChart per
  // gene per pop unbounded freezes the tab — same cap as LeadingEdgeGenesView).
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedPathway is the reset trigger, not read inside.
  useEffect(() => { setLeView('overlap'); setShowAllProfiles(false); }, [selectedPathway]);

  // Build unified pathway list across all selected columns.
  // Key by (db, pathway) — not by pathway alone — so same-named pathways in
  // different DBs (e.g. GO "Glycolysis" + Reactome "Glycolysis") stay separate.
  const unifiedPathways = useMemo<UnifiedPathway[]>(() => {
    const byKey: Record<string, UnifiedPathway> = {};
    for (const col of columns) {
      const pd = popDataMap[col.key];
      if (!pd) continue;
      for (const p of pd.allPathways) {
        const key = `${p.db}:${p.pathway}`;
        if (!byKey[key]) {
          byKey[key] = { pathway: p.pathway, db: p.db, size: p.size, pops: {}, maxAbsNES: 0 };
        }
        byKey[key].pops[col.key] = { NES: p.NES, padj: p.padj, pval: p.pval, leadingEdge: p.leadingEdge };
        const abs = Math.abs(p.NES);
        if (abs > byKey[key].maxAbsNES) byKey[key].maxAbsNES = abs;
      }
    }
    return Object.values(byKey);
  }, [columns, popDataMap]);

  // Rank by the strongest absolute NES the pathway reaches in ANY selected
  // column — the cross-column analogue of the single-track |NES| sort.
  // maxAbsNES is precomputed per pathway (above) so this stays O(1) per compare
  // instead of re-spreading Object.values on every comparison.
  const compare = useCallback(
    (a: UnifiedPathway, b: UnifiedPathway) => b.maxAbsNES - a.maxAbsNES,
    [],
  );

  const {
    filtered, displayed, setPage, pageSize, setPageSize, totalPages, safePage,
  } = usePathwayTable<UnifiedPathway>({
    rows: unifiedPathways,
    search: pathwaySearch,
    dbFilter: pathwayDBFilter,
    compare,
    initialPageSize: 50,
    selected: selectedPathway,
    onDeselect: deselect,
  });

  // Leading-edge overlap for selected pathway (declared before exports that use it).
  // Keyed case-insensitively, so a gene that one species writes Pomc and
  // another POMC counts as the same gene across the columns' leading edges.
  const leOverlap = useMemo<LeOverlapEntry[]>(() => {
    if (!selectedPathway) return [];
    const entries: Record<string, LeOverlapEntry> = {};
    for (const col of columns) {
      const d = selectedPathway.pops[col.key];
      if (!d?.leadingEdge) continue;
      for (const gene of d.leadingEdge) {
        const key = gene.toUpperCase();
        if (!entries[key]) entries[key] = { gene, count: 0, pops: [] };
        entries[key].count += 1;
        entries[key].pops.push(col.key);
      }
    }
    return Object.values(entries)
      .sort((a, b) => b.count - a.count || a.gene.localeCompare(b.gene));
  }, [selectedPathway, columns]);

  const exportPathwayExcel = () => runExport(() => {
    const rows = filtered.map((p) => {
      const row: Record<string, string | number> = { Pathway: p.pathway, DB: p.db, Size: p.size };
      for (const col of columns) {
        const d = p.pops[col.key];
        row[`${col.key}_NES`] = d ? d.NES : '';
        row[`${col.key}_padj`] = d ? d.padj : '';
      }
      return row;
    });
    const subject = columnsSubject(columns, popDataMap);
    return writeWorkbook(exportName(subject, ['pathway_compare'], 'xlsx'), [
      { name: 'PathwayCompare', rows },
      metadataSheet(exportProvenance('pathway_compare', subject, {
        search: pathwaySearch, dbFilter: { ...pathwayDBFilter }, rowCount: rows.length,
        rowSelection: 'Rows passing the database and search filters, ranked by the strongest |NES| in any column; paging does not limit the export.',
      })),
    ]);
  });

  const exportLeadingEdgeXLSX = () => selectedPathway && runLEExport(() => {
    const nPops = columns.filter((col) => selectedPathway.pops[col.key]).length;
    const rows = leOverlap.map(({ gene, count, pops: inPops }) => {
      const row: Record<string, string | number> = { Gene: gene, [noun.short]: `${count}/${nPops}` };
      for (const col of columns) {
        const de = resolveGeneCI(popDataMap[col.key], gene);
        row[`${col.key}_logFC`] = de?.logFC ?? '';
        row[`${col.key}_PValue`] = de?.PValue ?? '';
        row[`${col.key}_FDR`] = de?.FDR ?? '';
        row[`${col.key}_InLeadingEdge`] = inPops.includes(col.key) ? 'Yes' : 'No';
      }
      return row;
    });
    const rawRows: Array<Record<string, string | number>> = [];
    const genes = leOverlap.map(({ gene }) => gene);
    for (const col of columns) {
      const pd = popDataMap[col.key];
      if (!pd) continue;
      // Per-column tidy rows via the shared builder, in the column's own
      // spelling of each gene; prepend the column key. Column order (Pop, Gene,
      // Sample, Condition, <value>) is preserved by the spread.
      const own = genes.map((g) => resolveGeneCI(pd, g)?.gene ?? g);
      for (const r of rawValueRows(pd, own)) rawRows.push({ [noun.exportHeader]: col.key, ...r });
    }
    const subject = columnsSubject(columns, popDataMap);
    return writeWorkbook(exportName(subject, ['compare_leadingedge', selectedPathway.pathway], 'xlsx'), [
      { name: 'LeadingEdgeGenes', rows },
      { name: 'RawValues', rows: rawRows },
      metadataSheet(exportProvenance('compare_leadingedge', subject, {
        selectedPathway: { database: selectedPathway.db, pathway: selectedPathway.pathway },
        leadingEdgeGenes: genes.length,
      })),
    ]);
  });

  const btnStyle: CSSProperties = { fontSize: 11, padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg-panel)', cursor: 'pointer' };

  const shortLabel = (col: CompareColumn) => col.shortLabel ?? col.label;

  function renderPathwayDetail(p: UnifiedPathway) {
    const fullWidthGenes = leView === 'genes';
    const nDetected = columns.filter((col) => p.pops[col.key]).length;
    return (
      <div style={{ padding: '12px 16px', fontFamily: FONT_SANS }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <DbPill db={p.db} fontSize={9} padding="1px 5px" borderRadius={2} />
              <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>{p.pathway}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
              Size: {p.size} genes · {nDetected} / {columns.length} {noun.plural} detected
            </div>
          </div>
          <button type="button" onClick={() => setSelectedPathway(null)} aria-label="Close pathway detail"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)', padding: '0 4px', lineHeight: 1 }}>×</button>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: fullWidthGenes ? '1fr' : 'minmax(420px, 480px) 1fr',
          gap: 20,
        }}>
          {/* Left: NES chart + stats */}
          <div>
            <div style={{
              fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
              marginBottom: 6, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            }}>
              <span>NES across {noun.plural}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontWeight: 400, fontFamily: FONT_MONO, fontSize: 10 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 11, height: 11, background: columns[0]?.color || '#4C78A8', borderRadius: 2, border: '0.5px solid #1a202c' }} /> FDR &lt; {DEFAULT_FDR_CUTOFF}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 11, height: 11, background: '#CBD5E0', opacity: 0.5, borderRadius: 2 }} /> FDR ≥ {DEFAULT_FDR_CUTOFF}
                </span>
              </span>
            </div>
            {(() => {
              const bars = columns
                .map((col) => ({ col, data: p.pops[col.key] }))
                .filter((b): b is { col: CompareColumn; data: PopPathwayEntry } => !!b.data);
              if (!bars.length) return <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No data for selected {noun.plural}.</div>;

              const maxNES = Math.max(...bars.map((b) => Math.abs(b.data.NES)), 0.5);
              // The label gutter grows with the longest column label: a
              // population id fits in 40px, a dataset accession does not.
              const longest = Math.max(0, ...bars.map((b) => shortLabel(b.col).length));
              const padL = Math.min(160, Math.max(40, 8 + 6.2 * longest));
              const barH = 22, gap = 4, padR = 130;
              const chartW = 400 + padL, chartH = bars.length * (barH + gap) + gap;
              const centerX = padL + (chartW - padL - padR) / 2;
              const scale = (chartW - padL - padR) / 2 / maxNES;

              return (
                <svg width={chartW} height={chartH} style={{ display: 'block', fontFamily: FONT_MONO }} role="img" aria-label="Pathway NES comparison chart">
                  <line x1={centerX} y1={0} x2={centerX} y2={chartH} stroke="var(--border-dark)" strokeWidth={0.5} />
                  {bars.map((b, i) => {
                    const y = gap + i * (barH + gap);
                    const w = Math.abs(b.data.NES) * scale;
                    const x = b.data.NES >= 0 ? centerX : centerX - w;
                    const isSig = isFdrSignificant(b.data.padj);
                    const barFill = isSig ? b.col.color : '#CBD5E0';
                    const barOp = isSig ? 1 : 0.22;
                    return (
                      <g key={b.col.key}>
                        <text x={padL - 4} y={y + barH / 2 + 4} fontSize={10} textAnchor="end"
                          fill={b.col.color} fontWeight={isSig ? 600 : 400}
                          opacity={isSig ? 1 : 0.75}>
                          {shortLabel(b.col)}
                        </text>
                        <rect x={x} y={y} width={w} height={barH}
                          fill={barFill} opacity={barOp} rx={2}
                          stroke={isSig ? '#1a202c' : 'none'} strokeWidth={isSig ? 0.8 : 0}>
                          <title>{b.col.label}: NES={b.data.NES.toFixed(3)}, FDR={fmtFDR(b.data.padj)}{isSig ? ' (significant)' : ''}</title>
                        </rect>
                        <text x={b.data.NES >= 0 ? centerX + w + 5 : centerX + 5} y={y + barH / 2 + 4}
                          fontSize={9} textAnchor="start"
                          fill={isSig ? '#1a202c' : 'var(--text-muted)'}
                          fontWeight={isSig ? 600 : 400}>
                          {isSig ? '● ' : '○ '}{b.data.NES.toFixed(2)} · FDR {fmtFDR(b.data.padj)}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              );
            })()}

            {/* Per-column stats table */}
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                Per-{noun.singular} statistics
              </div>
              <table style={{ fontSize: 10, fontFamily: FONT_MONO, borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '2px 6px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'capitalize' }}>{noun.singular}</th>
                    <th style={{ padding: '2px 6px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 500 }}>NES</th>
                    <th style={{ padding: '2px 6px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 500 }}>p-value</th>
                    <th style={{ padding: '2px 6px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 500 }}>FDR</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map((col) => {
                    const d = p.pops[col.key];
                    const qc = col.qc;
                    const warn = qc && qc.is3v3 === false ? (
                      <span style={{ marginLeft: 4 }}>
                        <PopWarningBadge is3v3={false} nNormal={qc.nNormal} nObese={qc.nObese} samplesKept={qc.samplesKept} compact />
                      </span>
                    ) : null;
                    if (!d) return (
                      <tr key={col.key} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '2px 6px', color: col.color, fontWeight: 500 }}>{col.label}{warn}</td>
                        <td colSpan={3} style={{ padding: '2px 6px', textAlign: 'center', color: 'var(--text-muted)' }}>not detected</td>
                      </tr>
                    );
                    const isSig = isFdrSignificant(d.padj);
                    return (
                      <tr key={col.key} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '2px 6px', color: col.color, fontWeight: 500 }}>{col.label}{warn}</td>
                        <td style={{ padding: '2px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                          color: d.NES > 0 ? UP_TEXT_COLOR : DOWN_TEXT_COLOR, fontWeight: 600 }}>
                          {fmtSigned(d.NES, 3)}
                        </td>
                        <td style={{ padding: '2px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {fmtP(d.pval)}
                        </td>
                        <td style={{ padding: '2px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                          color: isSig ? '#1a202c' : 'var(--text-muted)', fontWeight: isSig ? 600 : 400 }}>
                          {fmtFDR(d.padj)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: Leading-edge (tabs) */}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                Leading-edge gene overlap ({leOverlap.length} genes{leView === 'overlap' && leOverlap.length > 100 ? ', showing 100' : ''})
              </span>
              <div role="tablist" style={{ display: 'flex', gap: 4 }}>
                {(['overlap', 'genes'] as const).map((v) => (
                  <button key={v} type="button" role="tab" aria-selected={leView === v} onClick={() => setLeView(v)}
                    style={{ fontSize: 10, padding: '1px 7px', cursor: 'pointer',
                      border: 'none', background: 'none',
                      borderBottom: leView === v ? '2px solid #4C78A8' : '2px solid transparent',
                      fontWeight: leView === v ? 600 : 400,
                      color: leView === v ? 'var(--text-primary)' : 'var(--text-muted)',
                      paddingBottom: 3 }}>
                    {v === 'overlap' ? 'Overlap' : 'Gene profiles'}
                  </button>
                ))}
              </div>
              {leView === 'genes' && (
                <>
                  <ChartScaleToggle style={{ marginLeft: 'auto' }} />
                  <ExportButton onClick={exportLeadingEdgeXLSX} busy={exportingLE} busyLabel="Downloading..."
                    style={{ fontSize: 10, padding: '1px 7px',
                      border: '1px solid var(--border)', borderRadius: 3,
                      background: 'var(--bg-panel)', cursor: 'pointer' }}>
                    Export Excel
                  </ExportButton>
                </>
              )}
            </div>

            {leView === 'overlap' ? (
              <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, fontFamily: FONT_MONO }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-panel)' }}>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '2px 4px', textAlign: 'left' }}>Gene</th>
                      <th style={{ padding: '2px 4px', textAlign: 'center' }}>{noun.short}</th>
                      {columns.map((col) => (
                        <th key={col.key} title={col.label} style={{ padding: '2px 4px', textAlign: 'center', color: col.color, fontSize: 9 }}>{shortLabel(col)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leOverlap.slice(0, 100).map(({ gene, count, pops }) => (
                      <tr key={gene} style={{ borderBottom: '1px solid var(--border)', background: count >= nDetected ? '#f0fdf4' : 'transparent' }}>
                        <td style={{ padding: '2px 4px' }}>{gene}</td>
                        <td style={{ padding: '2px 4px', textAlign: 'center', fontWeight: 600 }}>{count}/{nDetected}</td>
                        {columns.map((col) => (
                          <td key={col.key} style={{ padding: '2px 4px', textAlign: 'center' }}>
                            {pops.includes(col.key) ? '●' : '–'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div>
                {(() => {
                  const profileGenes = showAllProfiles ? leOverlap : leOverlap.slice(0, PROFILE_CAP);
                  return profileGenes.map(({ gene, count, pops: inPops }) => {
                    const inColumns = columns.filter((col) => inPops.includes(col.key));
                    return (
                      <div key={gene} style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4,
                          fontFamily: FONT_MONO, display: 'flex', alignItems: 'center', gap: 8 }}>
                          {gene}
                          <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 10 }}>
                            ({count}/{nDetected} {noun.plural})
                          </span>
                        </div>
                        <div style={{ display: 'grid',
                          gridTemplateColumns: `repeat(${inColumns.length}, minmax(220px,1fr))`,
                          gap: 8 }}>
                          {inColumns.map((col) => {
                            const pd = popDataMap[col.key];
                            return pd ? (
                              <BarSEMChart key={col.key} gene={resolveGeneCI(pd, gene)?.gene ?? gene}
                                popData={pd}
                                popLabel={col.chartLabel ?? col.label} />
                            ) : null;
                          })}
                        </div>
                      </div>
                    );
                  });
                })()}
                {!showAllProfiles && leOverlap.length > PROFILE_CAP && (
                  <button type="button" onClick={() => setShowAllProfiles(true)}
                    style={{ fontSize: 11, padding: '4px 12px', border: '1px solid var(--border)',
                      borderRadius: 4, background: 'var(--bg-panel)', cursor: 'pointer', margin: '4px 0 10px' }}>
                    Show all ({leOverlap.length}) gene profiles
                  </button>
                )}

                {/* Multi-column DE summary table */}
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', margin: '16px 0 4px' }}>
                  Gene summary
                </div>
                <div style={{ border: '1px solid var(--border)', overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', fontSize: 10, fontFamily: FONT_MONO, whiteSpace: 'nowrap' }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-panel)' }}>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        <th style={{ padding: '3px 6px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500 }}>Gene</th>
                        <th style={{ padding: '3px 6px', textAlign: 'center', color: 'var(--text-muted)', fontWeight: 500 }}>{noun.short}</th>
                        {columns.map((col) => (
                          <Fragment key={col.key}>
                            <th style={{ padding: '3px 6px', textAlign: 'right', color: col.color, fontWeight: 500 }}>{shortLabel(col)} logFC</th>
                            <th style={{ padding: '3px 6px', textAlign: 'right', color: col.color, fontWeight: 500 }}>{shortLabel(col)} p-val</th>
                            <th style={{ padding: '3px 6px', textAlign: 'right', color: col.color, fontWeight: 500 }}>{shortLabel(col)} FDR</th>
                          </Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {leOverlap.map(({ gene, count }) => (
                        <tr key={gene} style={{ borderBottom: '1px solid var(--border)',
                          background: count >= nDetected ? '#f0fdf4' : 'transparent' }}>
                          <td style={{ padding: '3px 6px' }}>{gene}</td>
                          <td style={{ padding: '3px 6px', textAlign: 'center', fontWeight: 600 }}>{count}/{nDetected}</td>
                          {columns.map((col) => {
                            const de = resolveGeneCI(popDataMap[col.key], gene);
                            const lfc = de?.logFC ?? null;
                            return (
                              <Fragment key={col.key}>
                                <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                                  color: lfc != null ? (lfc > 0 ? UP_TEXT_COLOR : DOWN_TEXT_COLOR) : 'var(--text-muted)', fontWeight: lfc != null ? 600 : 400 }}>
                                  {lfc != null ? fmtSigned(lfc, 3) : '–'}
                                </td>
                                <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                  {fmtP(de?.PValue)}
                                </td>
                                <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                  {fmtFDR(de?.FDR)}
                                </td>
                              </Fragment>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Pathway search — own fixed row so DB filters / pagination never push it around */}
      <div style={{ flexShrink: 0, padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
        <input
          type="text"
          value={pathwaySearch}
          onChange={(e) => setPathwaySearch(e.target.value)}
          placeholder="Search pathways..."
          style={{ width: '100%', maxWidth: 360, padding: '4px 8px', fontSize: 12, fontFamily: FONT_MONO, border: '1px solid var(--border-dark)', borderRadius: 4 }}
        />
      </div>
      {/* DB filters + pagination — the shared toolbar; this view adds no controls
          of its own between them, so it passes no children. */}
      <PathwayToolbar
        dbFilter={pathwayDBFilter}
        onDatabaseToggle={setDatabaseEnabled}
        pageSize={pageSize}
        setPageSize={setPageSize}
        setPage={setPage}
        totalPages={totalPages}
        safePage={safePage}
        total={filtered.length}
        actions={
          <ExportButton onClick={exportPathwayExcel} busy={exporting} busyLabel="Downloading..." style={btnStyle}>
            Export Excel
          </ExportButton>
        }
      />

      {/* Pathway comparison table — full-width with inline accordion row when selected */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {displayed.length === 0 ? (
          <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
            No pathways match your filters. Try broadening your search.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: FONT_MONO }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-panel)', zIndex: 2 }}>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '4px 6px', textAlign: 'left', fontSize: 10, color: 'var(--text-muted)' }}>Pathway</th>
                <th style={{ padding: '4px 4px', textAlign: 'center', fontSize: 10, color: 'var(--text-muted)' }}>DB</th>
                {columns.map((col) => (
                  <Fragment key={col.key}>
                    <th title={col.label} style={{ padding: '4px 4px', textAlign: 'right', fontSize: 10, borderBottom: `2px solid ${col.color}`, whiteSpace: 'nowrap' }}>
                      {shortLabel(col)} NES
                    </th>
                    <th style={{ padding: '4px 4px', textAlign: 'right', fontSize: 10, borderBottom: `2px solid ${col.color}` }}>
                      FDR
                    </th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayed.map((p) => {
                const isSel = selectedPathway?.pathway === p.pathway && selectedPathway?.db === p.db;
                return (
                  <Fragment key={`${p.db}:${p.pathway}`}>
                    <tr onClick={() => setSelectedPathway(isSel ? null : p)}
                      style={{
                        borderBottom: isSel ? 'none' : '1px solid var(--border)',
                        cursor: 'pointer',
                        background: isSel ? '#FFF8F0' : 'transparent',
                      }}>
                      <td style={{ padding: '3px 6px', maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={p.pathway}>{p.pathway}</td>
                      <td style={{ padding: '3px 4px', textAlign: 'center' }}>
                        <DbPill db={p.db} fontSize={9} padding="0 4px" borderRadius={2} />
                      </td>
                      {columns.map((col) => {
                        const d = p.pops[col.key];
                        return (
                          <Fragment key={col.key}>
                            <td style={{
                              padding: '3px 4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                              color: d ? (d.NES > 0 ? UP_TEXT_COLOR : DOWN_TEXT_COLOR) : 'var(--text-muted)',
                              fontWeight: d && isFdrSignificant(d.padj) ? 600 : 400,
                            }}>
                              {d ? fmtSigned(d.NES, 3) : '–'}
                            </td>
                            <td style={{ padding: '3px 4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                              {d ? fmtFDR(d.padj) : '–'}
                            </td>
                          </Fragment>
                        );
                      })}
                    </tr>
                    {isSel && (
                      <tr>
                        <td colSpan={2 + columns.length * 2}
                          style={{
                            padding: 0, background: '#FFF8F0',
                            borderTop: '2px solid var(--color-selected)',
                            borderBottom: '1px solid var(--border)',
                          }}>
                          {renderPathwayDetail(p)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
