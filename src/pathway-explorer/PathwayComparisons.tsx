import type { ContrastSlice } from '../gene-explorer/ContrastMatrix';
import { fmtFDR, fmtP, fmtSigned } from '../utils/format';
import { DOWN_COLOR, FONT_MONO, UP_COLOR } from '../styles/constants';
import type { PathwayRecordWithDb } from '../types';
import { pathwayInSlice } from './pathwayExport';

/** Each bar is an independently fitted enrichment result, never an aggregate
 * of the conditions or of the selected comparison's leading-edge genes. */
export function PathwayComparisons({ pathway, slices, activeContrastId }: {
  pathway: PathwayRecordWithDb;
  slices: ContrastSlice[];
  activeContrastId?: string;
}) {
  const rows = slices.map((slice) => ({ contrast: slice.contrast, pathway: pathwayInSlice(pathway, slice) }));
  const limit = Math.max(1, ...rows.map((row) => Math.abs(row.pathway?.NES ?? 0)));
  return (
    <section aria-label="Pathway enrichment across comparisons" style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 5 }}>Enrichment across comparisons</div>
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead style={{ color: 'var(--text-muted)' }}>
            <tr>
              <th style={{ textAlign: 'left', padding: '5px 8px' }}>Comparison</th>
              <th style={{ width: 180 }}>NES</th>
              <th style={{ textAlign: 'right', padding: '5px 8px' }}>FDR</th>
              <th style={{ textAlign: 'right', padding: '5px 8px' }}>P-value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ contrast, pathway: row }) => (
              <tr key={contrast.id} style={{ borderTop: '1px solid var(--border)', background: contrast.id === activeContrastId ? 'var(--chip-bg)' : undefined }}>
                <th scope="row" style={{ textAlign: 'left', padding: '5px 8px', fontWeight: 500 }}>
                  {contrast.label}{contrast.id === activeContrastId ? ' (selected)' : ''}
                </th>
                {row ? <>
                  <td style={{ padding: '4px 8px', minWidth: 180 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <svg width={120} height={20} viewBox="0 0 120 20" role="img" aria-label={`${contrast.label}: NES ${fmtSigned(row.NES, 3)}`}>
                        <line x1={60} y1={0} x2={60} y2={20} stroke="var(--border-dark)" />
                        <rect x={row.NES < 0 ? 60 - Math.abs(row.NES) / limit * 58 : 60} y={3}
                          width={Math.abs(row.NES) / limit * 58} height={14} fill={row.NES < 0 ? DOWN_COLOR : UP_COLOR} />
                      </svg>
                      <span style={{ fontFamily: FONT_MONO }}>{fmtSigned(row.NES, 3)}</span>
                    </div>
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: FONT_MONO }}>{fmtFDR(row.padj)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: FONT_MONO }}>{fmtP(row.pval)}</td>
                </> : <td colSpan={3} style={{ padding: '5px 8px', color: 'var(--text-muted)' }}>Not available for this comparison</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
