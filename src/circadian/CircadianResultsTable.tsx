// The Circadian tab's results: filter, row count, exports and the sortable
// table of every gene the scan scored.

import { type KeyboardEvent, useId, useMemo, useRef, useState } from 'react';
import { EmptyState } from '../common/EmptyState';
import { ExportButton } from '../common/ExportButton';
import { SortableTh } from '../common/SortableTh';
import { useSortedRows } from '../common/useSortedRows';
import { useExportAction } from '../utils/exportAction';
import { withExportEvidence } from '../utils/lazyExport';
import { fmtP } from '../utils/format';
import { FONT_MONO, btnStyle, thStyle } from '../styles/constants';
import type { Dataset, TimeSeriesBundle } from '../types';
import type { PeriodMode } from './CircadianControls';
import { type ExportContext, exportRawCSV, exportResultsCSV, exportWorkbook } from './circadianExport';
import type { AdjustMethod } from './multipleTesting';
import { hasEstimablePeak } from './peak';
import type { RhythmResult } from './rhythmicity';
import type { RhythmRow } from './scan';

type SortKey = 'gene' | 'p' | 'q' | 'acrophase' | 'amplitude' | 'mesor' | 'period' | 'stat' | 'n';

/** Rows the table renders. The scan scores every gene; the exports write them all. */
export const VISIBLE_ROW_CAP = 300;

export interface CircadianResultsTableProps {
  bundle: TimeSeriesBundle;
  dataset: Dataset;
  rows: RhythmRow[];
  running: boolean;
  total: number;
  selected: string | null;
  onSelect: (gene: string) => void;
  /** The value a row is judged on: adjusted q, or raw p when correction is off. */
  scoreOf: (row: RhythmRow) => number;
  threshold: number;
  adjust: AdjustMethod;
  qLabel: string;
  periodMode: PeriodMode;
  statLabel: string;
  unit: string;
  exportCtx: ExportContext;
}

/**
 * Amplitude and mesor to three significant figures. One decimal place is too
 * coarse on a log2 scale, where most amplitudes sit below 0.5 and would all
 * read 0.0 or 0.1. Values of 100 or more keep every integer digit rather than
 * switching to exponent notation, so a CPM mesor reads 12345, not 1.23e+4.
 */
export function fmtSig3(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs < 1e-4) return v.toExponential(2);
  return v.toPrecision(3);
}

/** Hidden from sight, read by assistive technology. */
export const visuallyHidden = {
  position: 'absolute', width: 1, height: 1, overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
} as const;

/**
 * The mark shown in place of a value a fit cannot support: a dash to the eye,
 * "no estimable peak" (or `label`) to a screen reader. The p-value beside it
 * still stands.
 */
export function NoPeakMark({ label = 'no estimable peak' }: { label?: string }) {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span style={visuallyHidden}>{label}</span>
    </>
  );
}

// Each column has its own rule, because each comes from a different part of
// the estimator and fails differently. The results table (display and sort)
// and the per-arm strip share these:
//   peak time   needs an estimable peak (positive period and amplitude, finite
//               acrophase; see peak.ts).
//   amplitude   shown whenever it is finite. JTK_CYCLE's canonical
//               Hodges–Lehmann amplitude can be exactly 0, and that 0 is the
//               estimate. A failed Lomb–Scargle cosine fit also records 0, as a
//               fallback (isFallbackAmplitude): shown as recorded, and marked as
//               not fitted.
//   period      shown whenever it is positive. Lomb–Scargle picks it by maximum
//               periodogram power before the cosine fit, so it exists even when
//               that fit fails. Canonical JTK_CYCLE reports 0 for a zero
//               amplitude: no estimable period.

/** True when the result has a peak time to report. */
export function hasPeakTime(r: RhythmResult): boolean {
  return hasEstimablePeak(r);
}

/** True when the result has a period to report (canonical JTK returns 0 for none). */
export function hasReportedPeriod(r: RhythmResult): boolean {
  return Number.isFinite(r.period) && r.period > 0;
}

/** True when the result has an amplitude to report, including JTK's estimated 0. */
export function hasAmplitude(r: RhythmResult): boolean {
  return Number.isFinite(r.amplitude);
}

/**
 * True when the amplitude is Lomb–Scargle's fallback 0 after a failed cosine
 * fit (rhythmicity.ts records 0 when that fit is singular), not a fitted value.
 */
export function isFallbackAmplitude(r: RhythmResult): boolean {
  return r.method === 'ls' && r.amplitude === 0 && !hasEstimablePeak(r);
}

/** Accessible and tooltip wording for a fallback amplitude. */
export const FALLBACK_AMPLITUDE_NOTE = 'recorded as 0 because the cosine fit failed; not a fitted amplitude';

/** An amplitude cell's content: the number, marked for a screen reader when it is a fallback. */
export function AmplitudeValue({ fit }: { fit: RhythmResult }) {
  if (!hasAmplitude(fit)) return <NoPeakMark label="no estimable amplitude" />;
  return (
    <>
      {fmtSig3(fit.amplitude)}
      {isFallbackAmplitude(fit) && <span style={visuallyHidden}> ({FALLBACK_AMPLITUDE_NOTE})</span>}
    </>
  );
}

/**
 * The table's sort value, by the same per-column rules as the display. A value
 * the column does not report sorts as missing (last, in both directions)
 * rather than as ZT0 or period 0; JTK's estimated zero amplitude sorts as 0.
 */
export function rhythmSortValue(row: RhythmRow, key: SortKey): string | number | null {
  if (key === 'gene') return row.gene;
  if (key === 'acrophase') return hasPeakTime(row) ? row.acrophase : null;
  if (key === 'period') return hasReportedPeriod(row) ? row.period : null;
  if (key === 'amplitude') return hasAmplitude(row) ? row.amplitude : null;
  return row[key] as number | null;
}

export function CircadianResultsTable({
  bundle, dataset: _dataset, rows, running, total, selected, onSelect,
  scoreOf, threshold, adjust, qLabel, periodMode, statLabel, unit, exportCtx,
}: CircadianResultsTableProps) {
  const [search, setSearch] = useState('');
  const countId = useId();
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  const csvExport = useExportAction();
  const rawExport = useExportAction();
  const xlsxExport = useExportAction();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.gene.toLowerCase().includes(q));
  }, [rows, search]);

  // A module-level function, so useSortedRows' memo does not re-sort on every render.
  const { sorted, toggle, sortKey, sortDir } = useSortedRows<RhythmRow, SortKey>(
    filtered, rhythmSortValue, { key: 'p', dir: 1 },
  );

  // Cap what the table renders. The scan scores every gene, but a 15,000-row
  // table is a scroll nobody finishes, and rendering it costs more than the scan
  // did. The exports write the full sorted list regardless.
  const visible = useMemo(() => sorted.slice(0, VISIBLE_ROW_CAP), [sorted]);
  const sortedGenes = useMemo(() => sorted.map((r) => r.gene), [sorted]);
  // Lomb–Scargle's period is the candidate with the most periodogram power.
  const maxPowerPeriod = rows.some((r) => r.method === 'ls');

  // One roving tab stop for the whole body: the selected row when it is on
  // screen, otherwise the first row. Tab enters the table there and leaves it
  // on the next Tab, rather than walking all 300 rows.
  const selectedIndex = selected == null ? -1 : visible.findIndex((r) => r.gene === selected);
  const tabStop = Math.max(selectedIndex, 0);

  const focusRow = (index: number) => {
    const row = tbodyRef.current?.rows[index];
    row?.focus();
  };

  const onRowKeyDown = (e: KeyboardEvent<HTMLTableRowElement>, index: number) => {
    let next: number;
    switch (e.key) {
      case 'ArrowDown': next = Math.min(index + 1, visible.length - 1); break;
      case 'ArrowUp': next = Math.max(index - 1, 0); break;
      case 'Home': next = 0; break;
      case 'End': next = visible.length - 1; break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onSelect(visible[index].gene);
        return;
      default:
        return;
    }
    e.preventDefault();
    if (next !== index || visible[next].gene !== selected) onSelect(visible[next].gene);
    focusRow(next);
  };

  // One sortable column header. A render helper CALLED as a function, not a
  // nested <Th/> component: a component declared in the body is a new type on
  // every render, so React tears the header down and rebuilds it each time —
  // which would drop keyboard focus from the sort button the moment it was
  // used, giving a keyboard user exactly one sort per trip through the table.
  const Th = (k: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <SortableTh active={sortKey === k} dir={sortDir} onSort={() => toggle(k)} style={thStyle(align)} scope="col">
      {label}
    </SortableTh>
  );

  return (
    <>
      <div style={{
        display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap',
      }}>
        <input
          type="search"
          aria-label="Filter genes"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Filter ${total.toLocaleString()} genes…`}
          style={{
            padding: '4px 8px', fontSize: 12, border: '1px solid var(--border-dark)',
            borderRadius: 4, width: 200, maxWidth: '100%', fontFamily: FONT_MONO,
            color: 'var(--text-primary)', background: 'var(--bg-panel)',
          }}
        />
        <span id={countId} style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          <span style={{ fontFamily: FONT_MONO }}>{sorted.length.toLocaleString()}</span> rows
          {sorted.length > visible.length && (
            <> · showing the first <span style={{ fontFamily: FONT_MONO }}>{visible.length}</span></>
          )}
        </span>
        <div style={{ flex: 1 }} />
        <ExportButton
          onClick={() => csvExport.run(() => withExportEvidence(() => exportResultsCSV(sorted, exportCtx)))}
          busy={csvExport.busy} busyLabel="Downloading…" disabled={running || !sorted.length}
          style={btnStyle} title="Every scored gene, with the settings that produced the p-values"
        >
          Results CSV
        </ExportButton>
        <ExportButton
          onClick={() => rawExport.run(() => withExportEvidence(() => exportRawCSV(bundle, sortedGenes, exportCtx)))}
          busy={rawExport.busy} busyLabel="Downloading…" disabled={running || !visible.length}
          style={btnStyle} title="Input values for every listed gene, one row per gene × library"
        >
          Raw values CSV
        </ExportButton>
        <ExportButton
          onClick={() => xlsxExport.run(() => withExportEvidence(() => exportWorkbook(sorted, sortedGenes, exportCtx)))}
          busy={xlsxExport.busy} busyLabel="Building…" spinnerSize={11} disabled={running || !sorted.length}
          style={btnStyle} title="Settings, results and raw values for every listed gene in one workbook"
        >
          Excel
        </ExportButton>
      </div>

      {running ? (
        // The scan's one progress indicator lives in the controls' count area;
        // the table only says why it is empty for now.
        <div role="status" style={{ padding: 'var(--sp-4)', fontSize: 12, color: 'var(--text-muted)' }}>
          Scanning…
        </div>
      ) : !sorted.length ? (
        <EmptyState
          title="No genes match"
          hint={search ? `No scored gene matches "${search}".` : 'The scan returned no scorable genes.'}
        />
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 4, overflow: 'auto', maxHeight: 460 }}>
          <table
            aria-label="Rhythm results"
            aria-describedby={countId}
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}
          >
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr>
                {Th('gene', 'Gene', 'left')}
                {Th('p', 'p')}
                {adjust !== 'none' && Th('q', qLabel)}
                {Th('acrophase', `peak (${unit || 'h'})`)}
                {Th('amplitude', 'amplitude')}
                {Th('mesor', 'mesor')}
                {periodMode === 'scan' && Th('period', maxPowerPeriod ? 'period (h, max power)' : 'period (h)')}
                {Th('stat', statLabel)}
                {Th('n', 'n')}
              </tr>
            </thead>
            <tbody ref={tbodyRef}>
              {visible.map((r, i) => {
                const isSel = r.gene === selected;
                const sig = scoreOf(r) < threshold;
                const peak = hasPeakTime(r);
                const period = hasReportedPeriod(r);
                const fallback = isFallbackAmplitude(r);
                return (
                  <tr
                    key={r.gene}
                    // hover-row (index.html) supplies the Row Hover wash and the
                    // 2px Signal Orange focus-visible outline; the inline
                    // selected tint below wins over its transparent rest state.
                    className="hover-row"
                    tabIndex={i === tabStop ? 0 : -1}
                    aria-selected={isSel}
                    onClick={() => onSelect(r.gene)}
                    onKeyDown={(e) => onRowKeyDown(e, i)}
                    style={{
                      cursor: 'pointer',
                      background: isSel ? 'var(--row-selected)' : undefined,
                      borderBottom: '1px solid var(--border)',
                      // Keep a row reached by the arrow keys clear of the sticky header.
                      scrollMarginTop: 28,
                    }}
                  >
                    <td style={{ ...cellStyle, textAlign: 'left', fontWeight: isSel ? 600 : 400 }}>{r.gene}</td>
                    <td style={{ ...cellStyle, color: sig ? 'var(--text-primary)' : 'var(--text-muted)' }}>{fmtP(r.p)}</td>
                    {adjust !== 'none' && (
                      <td style={{ ...cellStyle, color: sig ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: sig ? 600 : 400 }}>
                        {fmtP(r.q ?? 1)}
                      </td>
                    )}
                    {/* Per-column rules (see rhythmSortValue). The p-value
                        stands whether or not these are reported. */}
                    <td style={cellStyle} title={peak ? undefined : NO_PEAK_TITLE}>
                      {peak ? r.acrophase.toFixed(1) : <NoPeakMark />}
                    </td>
                    <td style={cellStyle} title={fallback ? FALLBACK_TITLE : undefined}>
                      <AmplitudeValue fit={r} />
                    </td>
                    <td style={cellStyle}>{fmtSig3(r.mesor)}</td>
                    {periodMode === 'scan' && (
                      <td style={cellStyle} title={period ? undefined : NO_PERIOD_TITLE}>
                        {period ? r.period : <NoPeakMark label="no estimable period" />}
                      </td>
                    )}
                    <td style={cellStyle}>{r.stat.toFixed(3)}</td>
                    <td style={cellStyle}>{r.n}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const NO_PEAK_TITLE = 'No estimable peak (zero rhythm amplitude, or a failed cosine fit). The p-value still stands.';
const NO_PERIOD_TITLE = 'No estimable period: canonical JTK_CYCLE reports period 0 when the rhythm amplitude is zero. The p-value still stands.';
const FALLBACK_TITLE = `Amplitude ${FALLBACK_AMPLITUDE_NOTE}. The p-value still stands.`;

const cellStyle = {
  padding: '3px 8px', textAlign: 'right' as const, fontFamily: FONT_MONO,
  whiteSpace: 'nowrap' as const, color: 'var(--text-primary)',
};
