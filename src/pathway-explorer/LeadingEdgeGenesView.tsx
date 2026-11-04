import { useState } from 'react';
import { useSortedRows } from '../common/useSortedRows';
import { mean } from '../utils/math';
import { pToStar, fmtP, fmtFDR, fmtSigned } from '../utils/format';
import { getValuesForGroups } from '../utils/sampleValues';
import { writeWorkbook } from '../utils/workbook';
import { useExportAction } from '../utils/exportAction';
import { ExportButton } from '../common/ExportButton';
import { ChartScaleToggle } from '../common/ChartScaleToggle';
import { SortableTh } from '../common/SortableTh';
import { UP_TEXT_COLOR, DOWN_TEXT_COLOR, FONT_MONO } from '../styles/constants';
import { BarSEMChart, type ChartComparison } from '../gene-explorer/BarSEMChart';
import type { ContrastSlice } from '../gene-explorer/ContrastMatrix';
import { leadingEdgeWorkbook } from './pathwayExport';
import type { Group, PathwayRecordWithDb, PopData } from '../types';

type StatKey = 'gene' | 'logFC' | 'PValue' | 'FDR' | 'star';
type SortKey = StatKey | `mean:${string}`;

interface GeneRow {
  gene: string;
  logFC: number | null;
  PValue: number | null;
  FDR: number | null;
  star: number | null;
  means: Record<string, number | null>;
}

// The gene summary's sort keys ARE its row keys, so the selector is a plain
// read: the old `if (sortKey === 'gene')` special case re-read the very field
// the index already resolved to.
const geneSortValue = (r: GeneRow, key: SortKey) => key.startsWith('mean:') ? r.means[key.slice(5)] : r[key as StatKey];

interface LeadingEdgeGenesViewProps {
  pathway: PathwayRecordWithDb;
  popData: PopData;
  groups?: Group[];
  contrastSlices?: ContrastSlice[];
}

export function LeadingEdgeGenesView({ pathway, popData, groups, contrastSlices }: LeadingEdgeGenesViewProps) {
  const { busy: exporting, run: runExport } = useExportAction(500);
  const [showAll, setShowAll] = useState(false);
  const allGenes = pathway.leadingEdge ?? [];
  const GENE_CAP = 50;
  const genes = showAll ? allGenes : allGenes.slice(0, GENE_CAP);

  const displayGroups = groups ?? popData.groups;
  const allConditions = displayGroups.length > 2;
  const comparisonsFor = (gene: string): ChartComparison[] => (contrastSlices ?? []).map((slice) => {
    const de = slice.popData.deByGene[gene];
    return {
      from: slice.contrast.baseline.key, to: slice.contrast.caseGroup.key,
      star: de ? pToStar(de.PValue) : 'n/a',
      title: de
        ? `${slice.contrast.label}: logFC ${fmtSigned(de.logFC, 3)} · P ${fmtP(de.PValue)} · FDR ${fmtFDR(de.FDR)}`
        : `${slice.contrast.label}: not detected`,
    };
  });

  // Built above the empty-leading-edge early return below, so the sort hook stays
  // unconditional; an empty leading edge simply yields no rows.
  const rows: GeneRow[] = genes.map((gene) => {
    const de = popData.deByGene[gene];
    return {
      gene,
      logFC: de?.logFC ?? null,
      PValue: de?.PValue ?? null,
      FDR: de?.FDR ?? null,
      star: de?.PValue ?? null,
      means: Object.fromEntries(getValuesForGroups(popData, gene, displayGroups).map((group) => [
        group.key, group.n ? mean(group.values) : null,
      ])),
    };
  });
  const { sortKey, sortDir, sorted: sortedRows, toggle } =
    useSortedRows<GeneRow, SortKey>(rows, geneSortValue, { key: 'PValue', dir: 1 });

  const exportXLSX = () => runExport(() => {
    const { filename, sheets } = leadingEdgeWorkbook(pathway, popData, allGenes, contrastSlices);
    return writeWorkbook(filename, sheets);
  });

  if (allGenes.length === 0) {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
        No leading-edge genes recorded for this pathway.
      </div>
    );
  }

  const columns: Array<[SortKey, string]> = [
    ['gene', 'Gene'], ['logFC', 'logFC'], ['PValue', 'P-value'], ['FDR', 'FDR'],
    ['star', 'Sig'], ...displayGroups.map((group): [SortKey, string] => [`mean:${group.key}`, `Mean ${group.label}`]),
  ];

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
          Leading-edge gene profiles ({allGenes.length} genes{!showAll && allGenes.length > GENE_CAP ? `, showing ${GENE_CAP}` : ''})
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ChartScaleToggle />
          <ExportButton onClick={exportXLSX} busy={exporting} busyLabel="Downloading…"
            style={{ fontSize: 10, padding: '2px 8px', border: '1px solid var(--border)',
              borderRadius: 3, background: 'var(--bg-panel)', cursor: 'pointer' }}>
            Export Excel
          </ExportButton>
        </div>
      </div>

      {/* BarSEMChart grid */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${allConditions ? 440 : 240}px), 1fr))`, gap: 8, marginBottom: 8 }}>
        {genes.map((gene) => (
          <BarSEMChart key={gene} gene={gene} popData={popData}
            groups={allConditions ? displayGroups : undefined}
            comparisons={allConditions ? comparisonsFor(gene) : undefined} />
        ))}
      </div>
      {!showAll && allGenes.length > GENE_CAP && (
        <div style={{ textAlign: 'center', padding: '8px 0', marginBottom: 12 }}>
          <button type="button" onClick={() => setShowAll(true)}
            style={{ fontSize: 11, padding: '3px 12px', border: '1px solid var(--border)',
              borderRadius: 3, background: 'var(--bg-panel)', cursor: 'pointer' }}>
            Show all ({allGenes.length}) genes
          </button>
        </div>
      )}

      {/* Summary table — sortable columns */}
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
        Gene summary{allConditions ? ` · statistics for ${popData.contrast?.label ?? 'the selected comparison'}` : ''}
      </div>
      <div style={{ border: '1px solid var(--border)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, fontFamily: FONT_MONO }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-panel)' }}>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {columns.map(([k, h]) => (
                <SortableTh key={k} active={sortKey === k} dir={sortDir} onSort={() => toggle(k)}
                  style={{ padding: '3px 6px', textAlign: k === 'gene' ? 'left' : 'right',
                    color: sortKey === k ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontWeight: sortKey === k ? 600 : 500, whiteSpace: 'nowrap', userSelect: 'none' }}>
                  {h}
                </SortableTh>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map(({ gene, logFC, PValue, FDR, means }) => (
              <tr key={gene} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '3px 6px' }}>{gene}</td>
                <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                  color: logFC != null ? (logFC > 0 ? UP_TEXT_COLOR : DOWN_TEXT_COLOR) : 'var(--text-muted)', fontWeight: 600 }}>
                  {logFC != null ? fmtSigned(logFC, 3) : '–'}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtP(PValue)}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtFDR(FDR)}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right' }}>
                  {pToStar(PValue ?? 1)}
                </td>
                {displayGroups.map((group) => (
                  <td key={group.key} style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {means[group.key]?.toFixed(2) ?? '–'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
