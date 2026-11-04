// The across-comparisons view for multi-contrast (factorial) datasets: one row
// per selected gene, one column per declared contrast, so the same gene can be
// read from every angle of the design at once (e.g. GSE135639's 2×2 — the diet
// effect at each age, and the maturation axis per diet arm).
//
// This is the surface the contrast SELECTOR cannot provide: the selector shows
// one comparison at a time, and the question a factorial design begs — "is this
// diet gene age-specific?" — is a between-comparison question. Rendered only
// for datasets with >1 contrast (the toolbar button that opens it is gated the
// same way), so single-contrast datasets are untouched.
//
// Each slice's popData comes from the SAME raw track transformed under a
// different contrast (popCache keys on contrast id), so all tables are already
// in memory — no extra loads happen here.
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { pToStar, fmtP, fmtSigned } from '../utils/format';
import { btnStyle, UP_TEXT_COLOR, DOWN_TEXT_COLOR, NEUTRAL_TEXT_COLOR, FONT_MONO, FONT_SANS } from '../styles/constants';
import { SortableTh } from '../common/SortableTh';
import { downloadFile } from '../utils/exportAction';
import { exportCsvCell, exportName, provenanceColumns, provenanceColumnValues, trackSubject } from '../utils/exportProvenance';
import { geneExportProvenance } from './geneExport';
import type { GeneDERecord, PopData, ResolvedContrast } from '../types';
import { DEFAULT_FDR_CUTOFF, isFdrSignificant } from '../statistics/policy';

export interface ContrastSlice {
  contrast: ResolvedContrast;
  popData: PopData;
}

interface ContrastMatrixProps {
  selectedGenes: string[];
  slices: ContrastSlice[];
  /** Highlighted column (the contrast the explorer is currently showing). */
  activeContrastId?: string | null;
  onRemove: (gene: string) => void;
}

const TH: CSSProperties = {
  padding: '5px 10px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
  borderBottom: '1px solid var(--border-dark)', textAlign: 'right',
  verticalAlign: 'bottom',
};

function cellTitle(c: ResolvedContrast, de: GeneDERecord | undefined): string {
  if (!de) return `${c.label}: not detected`;
  const fdr = de.FDR == null ? 'n/a' : fmtP(de.FDR);
  return `${c.label}\nlogFC ${fmtSigned(de.logFC, 3)} · p ${fmtP(de.PValue)} · FDR ${fdr}`;
}

export function ContrastMatrix({ selectedGenes, slices, activeContrastId, onRemove }: ContrastMatrixProps) {
  // Sort by gene name or by any contrast's logFC (activate that column's header
  // control — see SortableTh).
  const [sortBy, setSortBy] = useState<string>('gene');
  const [sortDir, setSortDir] = useState(1);
  const toggleSort = (key: string) => {
    if (sortBy === key) setSortDir((d) => -d);
    else { setSortBy(key); setSortDir(key === 'gene' ? 1 : -1); }
  };

  const genes = useMemo(() => {
    const bySlice = new Map(slices.map((s) => [s.contrast.id, s.popData.deByGene]));
    return [...selectedGenes].sort((a, b) => {
      if (sortBy === 'gene') return sortDir * a.localeCompare(b);
      const t = bySlice.get(sortBy);
      return sortDir * ((t?.[a]?.logFC ?? 0) - (t?.[b]?.logFC ?? 0));
    });
  }, [selectedGenes, slices, sortBy, sortDir]);

  // Header optgroup band: adjacent slices sharing a contrast `group` merge into
  // one spanning cell, mirroring the selector's <optgroup> structure. `key` is
  // the band's first contrast id — stable, unlike an array index.
  const bands = useMemo(() => {
    const out: Array<{ group: string | null; span: number; key: string }> = [];
    for (const s of slices) {
      const g = s.contrast.group ?? null;
      const last = out[out.length - 1];
      if (last && last.group === g) last.span++;
      else out.push({ group: g, span: 1, key: s.contrast.id });
    }
    return out;
  }, [slices]);
  const hasBands = bands.some((b) => b.group !== null);

  const exportCSV = () => {
    const popData = (slices.find((slice) => slice.contrast.id === activeContrastId) ?? slices[0])?.popData;
    if (!popData) return;
    const contrasts = slices.map((slice) => slice.contrast);
    const metadata = provenanceColumns(geneExportProvenance('contrast_matrix', popData, genes.length, [], contrasts, {
      sort: { key: sortBy, direction: sortDir === 1 ? 'ascending' : 'descending' },
    }));
    const headers = ['Gene', ...slices.flatMap((s) => [
      `logFC (${s.contrast.label})`, `PValue (${s.contrast.label})`, `FDR (${s.contrast.label})`,
    ]), ...Object.keys(metadata)];
    const lines = [headers.map(exportCsvCell).join(','), ...genes.map((g, index) =>
      [g, ...slices.flatMap((s) => {
        const de = s.popData.deByGene[g];
        return de ? [de.logFC, de.PValue, de.FDR ?? ''] : ['', '', ''];
      }), ...provenanceColumnValues(metadata, index)].map(exportCsvCell).join(','),
    )].join('\n');
    downloadFile(
      exportName(trackSubject(popData, { contrasts }), ['contrast_matrix'], 'csv'),
      `data:text/csv;charset=utf-8,${encodeURIComponent(lines)}`,
    );
  };

  if (!slices.length) return null;

  return (
    <div style={{ background: 'var(--bg-panel)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: FONT_SANS }}>
          log₂ fold change of each selected gene in every comparison in this dataset.
          Stars follow each comparison's own p-value; hover a cell for exact stats.
        </span>
        <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
          <button type="button" onClick={exportCSV} style={btnStyle}>Export CSV</button>
        </div>
      </div>
      <div style={{ overflow: 'auto', maxHeight: '65vh' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, fontFamily: FONT_MONO, width: '100%' }}>
          <thead style={{ background: 'var(--bg-app)', position: 'sticky', top: 0, zIndex: 1 }}>
            {hasBands && (
              <tr>
                <th style={{ ...TH, borderBottom: 'none' }} />
                {bands.map((b) => (
                  <th
                    key={b.key}
                    colSpan={b.span}
                    style={{
                      ...TH, textAlign: 'center', borderBottom: 'none',
                      fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase',
                      fontFamily: FONT_SANS,
                    }}
                  >
                    {b.group ?? ''}
                  </th>
                ))}
                <th style={{ ...TH, borderBottom: 'none' }} />
              </tr>
            )}
            <tr>
              <SortableTh
                active={sortBy === 'gene'}
                dir={sortDir}
                onSort={() => toggleSort('gene')}
                style={{ ...TH, textAlign: 'left', color: sortBy === 'gene' ? 'var(--text-primary)' : 'var(--text-muted)' }}
              >
                Gene
              </SortableTh>
              {slices.map((s) => (
                <SortableTh
                  key={s.contrast.id}
                  active={sortBy === s.contrast.id}
                  dir={sortDir}
                  onSort={() => toggleSort(s.contrast.id)}
                  title={`${s.contrast.label}${s.contrast.description ? `\n${s.contrast.description}` : ''}\nSort by this comparison's logFC.`}
                  style={{
                    ...TH, maxWidth: 130, whiteSpace: 'normal',
                    fontFamily: FONT_SANS,
                    color: sortBy === s.contrast.id ? 'var(--text-primary)' : 'var(--text-muted)',
                    background: s.contrast.id === activeContrastId ? 'var(--chip-bg)' : undefined,
                  }}
                >
                  {s.contrast.label}
                </SortableTh>
              ))}
              <th style={TH} />
            </tr>
          </thead>
          <tbody>
            {genes.map((gene) => (
              <tr key={gene} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '4px 10px', color: 'var(--text-mono)', fontWeight: 500 }}>{gene}</td>
                {slices.map((s) => {
                  const de = s.popData.deByGene[gene];
                  const star = de ? pToStar(de.PValue) : '';
                  return (
                    <td
                      key={s.contrast.id}
                      title={cellTitle(s.contrast, de)}
                      style={{
                        padding: '4px 10px', textAlign: 'right', cursor: 'help',
                        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                        background: s.contrast.id === activeContrastId ? 'var(--chip-bg)' : undefined,
                      }}
                    >
                      {de ? (
                        <>
                          <span style={{ color: de.logFC > 0 ? UP_TEXT_COLOR : DOWN_TEXT_COLOR, fontWeight: isFdrSignificant(de.FDR) ? 700 : 400 }}>
                            {fmtSigned(de.logFC, 2)}
                          </span>
                          <span style={{ fontFamily: FONT_SANS, fontSize: 10, color: star === 'ns' ? NEUTRAL_TEXT_COLOR : 'var(--text-primary)', marginLeft: 4 }}>
                            {star}
                          </span>
                        </>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>–</span>
                      )}
                    </td>
                  );
                })}
                <td style={{ padding: '4px 6px' }}>
                  <button type="button" onClick={() => onRemove(gene)} aria-label={`Remove ${gene}`}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: NEUTRAL_TEXT_COLOR, padding: '0 4px' }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)', fontFamily: FONT_SANS, borderTop: '1px solid var(--border)' }}>
        Bold = FDR &lt; {DEFAULT_FDR_CUTOFF} in that comparison. Stars use raw p-values: *** p&lt;0.001 · ** p&lt;0.01 · * p&lt;0.05 · ns not significant.
      </div>
    </div>
  );
}
