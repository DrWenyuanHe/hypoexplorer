import { useState, useMemo, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { fmtP, fmtFDR, fmtSigned, truncate } from '../utils/format';
import { writeWorkbook } from '../utils/workbook';
import { useExportAction } from '../utils/exportAction';
import { btnStyle, thStyle, FONT_MONO, FONT_SANS } from '../styles/constants';
import { PathwayDetailPanel } from './PathwayDetailPanel';
import { pathwayDetailWorkbook, pathwayTableWorkbook } from './pathwayExport';
import type { ContrastSlice } from '../gene-explorer/ContrastMatrix';
import { usePathwayTable, PATHWAY_SORTS, PATHWAY_SORT_DIRS } from './pathwayTable';
import { PathwayToolbar } from './PathwayToolbar';
import { Modal } from '../common/Modal';
import { PopWarningBadge } from '../common/PopWarningBadge';
import { EmptyState } from '../common/EmptyState';
import { SortableTh } from '../common/SortableTh';
import { ExportButton } from '../common/ExportButton';
import { DbPill } from '../common/DbPill';
import type { PathwayRecordWithDb, PopData } from '../types';
import type { PathwayView } from '../explorer/explorerSession';

interface PathwayExplorerTabProps {
  /** The pathway selection, search, DB filter, FDR cutoff and sort as one
   *  value. Owned by App so it survives a tab switch. */
  pathway: PathwayView<PathwayRecordWithDb>;
  popData: PopData;
  contrastSlices?: ContrastSlice[];
  onSendGenesToGeneExplorer?: (genes: string[]) => void;
}

export function PathwayExplorerTab({
  pathway,
  popData,
  contrastSlices,
  onSendGenesToGeneExplorer,
}: PathwayExplorerTabProps) {
  const {
    selected: selectedPathway, select: setSelectedPathway, deselect,
    search: pathwaySearch, setSearch: setPathwaySearch,
    dbFilter: pathwayDBFilter, setDatabaseEnabled,
    fdrThresh: pathwayFDRThresh, setFdrThresh: setPathwayFDRThresh,
    sortKey: pathwaySortKey, setSortKey: setPathwaySortKey,
    resetFilters,
  } = pathway;
  const { busy: exporting, run: runExport } = useExportAction();
  // The detail export's button is rendered by PathwayDetailPanel, so the seam's
  // busy flag is handed down as a prop: the panel disables the button and shows
  // the same Spinner + "Exporting…" label as its siblings, rather than looking
  // idle while the workbook is written.
  const { busy: exportingDetail, run: runDetailExport } = useExportAction();
  const [showGenes, setShowGenes] = useState(false);

  // Reset genes view when selected pathway changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedPathway is the reset trigger, not read inside.
  useEffect(() => { setShowGenes(false); }, [selectedPathway]);

  const closeDetail = useCallback(() => { deselect(); setShowGenes(false); }, [deselect]);

  // Export the full pathway detail — pathway metadata + leading-edge gene stats
  // + per-sample values, all through the shared sheet-row builders, named and
  // recorded by the export-provenance module.
  const exportPathwayDetail = useCallback(() => {
    if (!selectedPathway || !popData?.meta) return;
    const { filename, sheets } = pathwayDetailWorkbook(selectedPathway, popData, contrastSlices);
    runDetailExport(() => writeWorkbook(filename, sheets));
  }, [selectedPathway, popData, contrastSlices, runDetailExport]);

  // Rows below the FDR cutoff. A predicate rather than a threshold field, so the
  // shared table never has to know which statistic this view cuts on.
  const withinFDR = useCallback(
    (p: PathwayRecordWithDb) => p.padj <= pathwayFDRThresh,
    [pathwayFDRThresh],
  );
  const compare = useMemo(() => PATHWAY_SORTS[pathwaySortKey] ?? null, [pathwaySortKey]);


  const {
    filtered, displayed, setPage, pageSize, setPageSize, totalPages, safePage,
  } = usePathwayTable<PathwayRecordWithDb>({
    rows: popData.allPathways,
    search: pathwaySearch,
    dbFilter: pathwayDBFilter,
    include: withinFDR,
    compare: compare ?? undefined,
    initialPageSize: 100,
    selected: selectedPathway,
    onDeselect: deselect,
  });


  // One sortable column header. A render helper CALLED as a function, never
  // rendered as <Th/>: a component declared in the body is a new type on every
  // render, so React would rebuild the header and drop keyboard focus from the
  // sort button the moment it was used. The direction is the comparator's
  // (PATHWAY_SORT_DIRS) because this table selects a sort rather than toggling
  // one — the same click that the "By Magnitude" / "By P-value" / "Alphabetical"
  // buttons above make.
  const Th = (k: string, label: ReactNode, align: 'left' | 'right') => (
    <SortableTh active={pathwaySortKey === k} dir={PATHWAY_SORT_DIRS[k]}
      onSort={() => setPathwaySortKey(k)} style={thStyle(align)}>
      {label}
    </SortableTh>
  );

  const exportExcel = () => runExport(() => {
    const { filename, sheets } = pathwayTableWorkbook(popData, filtered, {
      search: pathwaySearch, dbFilter: pathwayDBFilter, fdrThresh: pathwayFDRThresh, sortKey: pathwaySortKey,
    });
    return writeWorkbook(filename, sheets);
  });

  return (
    <div className="explorer-tab" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Filter row — DB toggles + paging come from the shared toolbar; the
          controls below are this view's own. */}
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
          <ExportButton onClick={exportExcel} busy={exporting} busyLabel="Exporting…" spinnerSize={11}
            style={btnStyle}>
            Export Excel
          </ExportButton>
        }
      >
        {/* 2v3 warning — visible when current pop has is3v3=false */}
        {popData?.qc?.is3v3 === false && (
          <PopWarningBadge
            is3v3={false}
            nNormal={popData.qc.nNormal}
            nObese={popData.qc.nObese}
            samplesKept={popData.qc.samplesKept}
          />
        )}

        {/* Search */}
        <input
          type="text"
          value={pathwaySearch}
          onChange={(e) => setPathwaySearch(e.target.value)}
          placeholder="Search pathways…"
          style={{
            width: 220, padding: '4px 8px', fontSize: 12,
            border: '1px solid var(--border-dark)', borderRadius: 4,
            fontFamily: FONT_SANS,
          }}
        />

        {/* Sort */}
        <div style={{ display: 'flex', border: '1px solid var(--border-dark)', borderRadius: 4, overflow: 'hidden' }}>
          {[['nes', 'By magnitude'], ['pval', 'By p-value'], ['name', 'Alphabetical']].map(([k, label]) => (
            <button type="button" key={k} onClick={() => setPathwaySortKey(k)} style={{
              padding: '3px 8px', fontSize: 11, border: 'none', cursor: 'pointer',
              background: pathwaySortKey === k ? 'var(--text-primary)' : 'white',
              color: pathwaySortKey === k ? 'white' : 'var(--text-muted)',
            }}>{label}</button>
          ))}
        </div>

        {/* FDR filter */}
        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          FDR ≤
          <input type="range" min={0.05} max={1.0} step={0.05} value={pathwayFDRThresh}
            onChange={(e) => setPathwayFDRThresh(+e.target.value)} style={{ width: 70 }} />
          <span style={{ fontFamily: FONT_MONO, width: 30 }}>{pathwayFDRThresh.toFixed(2)}</span>
        </label>
      </PathwayToolbar>

      {/* Pathway table — always full width; detail opens in a modal */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* biome-ignore lint/a11y/useSemanticElements: div preserves existing flex/scroll layout; region role is intentional */}
        <div className="pathway-table-scroll" style={{ flex: 1, overflow: 'auto' }} role="region" aria-label="Pathway table">
          {displayed.length === 0 ? (
            <EmptyState
              style={{ height: '100%' }}
              title="No pathways match your filters."
              hint="Try broadening your search or enabling more databases."
              action={
                <button type="button" onClick={resetFilters} style={{ ...btnStyle, padding: '5px 14px' }}>Reset filters</button>
              }
            />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ background: 'var(--bg-app)', position: 'sticky', top: 0, zIndex: 2 }}>
                <tr>
                  {/* DB and Size do not sort — plain cells, with no button
                      offering a sort that does not exist. */}
                  <th style={thStyle('left')}>DB</th>
                  {Th('name', 'Pathway', 'left')}
                  {Th('nes', 'NES', 'right')}
                  {Th('pval', 'FDR', 'right')}
                  {Th('rawpval', <i>p</i>, 'right')}
                  <th style={thStyle('right')}>Size</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((p, i) => {
                  const isSel = selectedPathway?.pathway === p.pathway && selectedPathway?.db === p.db;
                  return (
                    <tr key={`${p.db}-${p.pathway}`}
                      onClick={() => setSelectedPathway(isSel ? null : p)}
                      style={{
                        cursor: 'pointer', borderBottom: '1px solid var(--border)',
                        background: isSel ? 'var(--chip-bg)' : i % 2 === 0 ? 'var(--bg-panel)' : 'var(--bg-app)',
                      }}>
                      <td style={{ padding: '3px 8px' }}>
                        <DbPill db={p.db} style={{ display: 'inline-block' }} />
                      </td>
                      <td style={{ padding: '3px 8px', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={p.pathway}>
                        {truncate(p.pathway, 48)}
                      </td>
                      <td style={{
                        padding: '3px 8px', textAlign: 'right', fontFamily: FONT_MONO,
                        fontWeight: 600, color: p.NES > 0 ? 'var(--accent-up)' : 'var(--accent-down)',
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {fmtSigned(p.NES, 3)}
                      </td>
                      <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: FONT_MONO, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtFDR(p.padj)}
                      </td>
                      <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: FONT_MONO, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtP(p.pval)}
                      </td>
                      <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: FONT_MONO, fontVariantNumeric: 'tabular-nums' }}>
                        {p.size}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Pathway detail modal — matches the Gene Explorer leading-edge modal.
          The panel brings its own header, title and close button, so the Modal
          renders none: no title, no headerRight, hence no second header. */}
      {selectedPathway && (
        <Modal ariaLabel={`Pathway detail: ${selectedPathway.pathway}`} onClose={closeDetail}>
          <PathwayDetailPanel
            pathway={selectedPathway}
            onClose={closeDetail}
            onExport={exportPathwayDetail}
            exportBusy={exportingDetail}
            popData={popData}
            contrastSlices={contrastSlices}
            showGenes={showGenes}
            setShowGenes={setShowGenes}
            onSendGenes={onSendGenesToGeneExplorer ? (genes) => { onSendGenesToGeneExplorer(genes); closeDetail(); } : undefined}
          />
        </Modal>
      )}
    </div>
  );
}
