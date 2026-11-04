import { useState, useMemo } from 'react';
import { mean } from '../utils/math';
import { pToStar, fmtP } from '../utils/format';
import { displayUnit, getGroupedValues, groupLabels, unitProvenance } from '../utils/sampleValues';
import { btnStyle, UP_TEXT_COLOR, DOWN_TEXT_COLOR, NEUTRAL_TEXT_COLOR, FONT_MONO, FONT_SANS } from '../styles/constants';
import { useExportAction } from '../utils/exportAction';
import { ExportButton } from '../common/ExportButton';
import { SortableTh } from '../common/SortableTh';
import { exportGenesCSV, exportGenesExcel } from './geneExport';
import { requireContrast } from '../data/contrasts';
import type { PopData } from '../types';
import type { ExportSettings } from '../utils/exportProvenance';

type SortKey = 'gene' | 'logFC' | 'PValue' | 'FDR' | 'meanN' | 'meanO';

interface Row {
  gene: string;
  logFC: number;
  PValue: number;
  FDR: number;
  meanN: number;
  meanO: number;
  star: string;
}

interface SummaryTableProps {
  selectedGenes: string[];
  onRemove: (gene: string) => void;
  popData: PopData;
  scrollMaxHeight?: number | string;
  exportSettings?: ExportSettings;
}

export function SummaryTable({ selectedGenes, onRemove, popData, scrollMaxHeight = 160, exportSettings }: SummaryTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('gene');
  const [sortDir, setSortDir] = useState(1);
  const { busy: exporting, run: runExport } = useExportAction();

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => -d);
    else { setSortKey(key); setSortDir(1); }
  };

  const contrast = requireContrast(popData.contrast);
  // Arm labels through the group-label seam — the one spelling of the fallback.
  const { baselineLabel, caseLabel } = groupLabels(contrast);
  // Display-only unit token for the visible header (spaced, human-readable).
  // NOT the export header form (meanColumnLabel) — that is camel-cased for CSV/XLSX.
  const unitLabel = displayUnit(popData);
  // Hover provenance on the mean columns: these are the one place in the app
  // where different genes' abundances sit side by side, so the "not
  // gene-length normalized" caveat matters most here.
  const unitTitle = unitProvenance(popData);

  const rows = useMemo<Row[]>(() => {
    return [...selectedGenes].map((gene) => {
      const de = popData.deByGene[gene];
      // Per-group means via the single value seam — follows the dataset's real
      // group membership, not a positional 3+3 slice.
      const [base, caseG] = getGroupedValues(popData, gene, contrast);
      return {
        gene,
        logFC: de?.logFC ?? 0,
        PValue: de?.PValue ?? 1,
        FDR: de?.FDR ?? 1,
        meanN: mean(base?.values ?? []),
        meanO: mean(caseG?.values ?? []),
        star: pToStar(de?.PValue ?? 1),
      };
    }).sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      if (sortKey === 'gene') return sortDir * (va as string).localeCompare(vb as string);
      return sortDir * ((va as number) - (vb as number));
    });
  }, [selectedGenes, sortKey, sortDir, popData, contrast]);

  // Export the genes in the table's current sort order, via the shared exporters
  // (also used by the Bar charts pop-up).
  const exportScope = { settings: { ...exportSettings, sort: { key: sortKey, direction: sortDir === 1 ? 'ascending' : 'descending' } } };
  const exportCSV = () => exportGenesCSV(rows.map((r) => r.gene), popData, exportScope);

  // The busy label follows the export: this used to start its reset timer
  // synchronously, so "Downloading…" was a fixed 1 s animation that could end
  // while the workbook was still being written.
  const exportExcel = () => runExport(() => exportGenesExcel(rows.map((r) => r.gene), popData, exportScope));

  // A render helper CALLED as a function, not a nested <Th/> component: a
  // component declared in the body is a new type on every render, so React
  // tears the header down and rebuilds it each time — which would drop keyboard
  // focus from the sort button the moment it was used, leaving a keyboard user
  // one sort per journey back through the table. Called, it returns the element
  // in place and the button survives the re-render.
  // biome-ignore lint/correctness/noComponentHookFactories: called as a function, never rendered as <Th/>; see above
  const Th = ({ label, k, title }: { label: string; k: SortKey; title?: string }) => (
    <SortableTh active={sortKey === k} dir={sortDir} onSort={() => toggleSort(k)} title={title} style={{
      padding: '4px 8px', fontSize: 11, fontWeight: 600,
      color: sortKey === k ? 'var(--text-primary)' : 'var(--text-muted)',
      whiteSpace: 'nowrap', userSelect: 'none', textAlign: k === 'gene' ? 'left' : 'right',
      borderBottom: '1px solid var(--border)',
    }}>
      {label}
    </SortableTh>
  );

  if (!selectedGenes.length) {
    return (
      <div style={{
        padding: '16px 20px', color: 'var(--text-muted)', fontSize: 13,
        borderTop: '1px solid var(--border)', background: 'var(--bg-panel)',
      }}>
        Search for a gene above to get started.
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--bg-panel)', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>Summary</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button type="button" onClick={exportCSV} style={btnStyle}>Export CSV</button>
          <ExportButton onClick={exportExcel} busy={exporting} busyLabel="Downloading…" style={btnStyle}>
            Export Excel
          </ExportButton>
        </div>
      </div>
      <div style={{ overflowX: 'auto', maxHeight: scrollMaxHeight, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: FONT_MONO }}>
          <thead style={{ background: 'var(--bg-app)', position: 'sticky', top: 0 }}>
            <tr>
              {Th({ label: 'Gene', k: 'gene' })}
              {Th({ label: 'logFC', k: 'logFC' })}
              {Th({ label: 'P value', k: 'PValue' })}
              {Th({ label: 'FDR', k: 'FDR' })}
              <th style={{ padding: '4px 8px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>Stars</th>
              {Th({ label: `Mean ${baselineLabel} ${unitLabel}`, k: 'meanN', title: unitTitle })}
              {Th({ label: `Mean ${caseLabel} ${unitLabel}`, k: 'meanO', title: unitTitle })}
              <th style={{ padding: '4px 8px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.gene} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '3px 8px', color: 'var(--text-mono)', fontWeight: 500 }}>{r.gene}</td>
                <td style={{ padding: '3px 8px', textAlign: 'right', color: r.logFC > 0 ? UP_TEXT_COLOR : r.logFC < 0 ? DOWN_TEXT_COLOR : NEUTRAL_TEXT_COLOR, fontVariantNumeric: 'tabular-nums' }}>{r.logFC.toFixed(3)}</td>
                <td style={{ padding: '3px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtP(r.PValue)}</td>
                <td style={{ padding: '3px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.FDR.toFixed(3)}</td>
                <td style={{ padding: '3px 8px', textAlign: 'center', fontFamily: FONT_SANS, color: r.star === 'ns' ? NEUTRAL_TEXT_COLOR : 'var(--text-primary)' }}>{r.star}</td>
                <td style={{ padding: '3px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.meanN.toFixed(2)}</td>
                <td style={{ padding: '3px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.meanO.toFixed(2)}</td>
                <td style={{ padding: '3px 4px' }}>
                  <button type="button" onClick={() => onRemove(r.gene)} aria-label={`Remove ${r.gene}`}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: NEUTRAL_TEXT_COLOR, padding: '0 4px' }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
