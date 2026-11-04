import { useEffect, useMemo, useState } from 'react';
import { SortableTh } from '../common/SortableTh';
import { useSortedRows } from '../common/useSortedRows';
import { fmtFDR, fmtP, fmtSigned } from '../utils/format';
import { btnStyle, DOWN_TEXT_COLOR, FONT_MONO, UP_TEXT_COLOR, NEUTRAL_TEXT_COLOR } from '../styles/constants';
import type { VolcanoPoint } from '../types';
import { VOLCANO_SELECTED_BACKGROUND, VOLCANO_SELECTED_COLOR } from './volcanoColors';

type SortKey = 'gene' | 'logfc' | 'pval' | 'fdr';
type Filter = 'all' | 'passing' | 'up' | 'down' | 'selected';
const PAGE_SIZE = 50;
const sortValue = (point: VolcanoPoint, key: SortKey) => point[key];

interface VolcanoTableProps {
  points: VolcanoPoint[];
  passingGenes: ReadonlySet<string>;
  selectedGenes: ReadonlySet<string>;
  metric: 'pval' | 'fdr';
  logFCThresh: number;
  sigThresh: number;
  baselineLabel: string;
  caseLabel: string;
  onAddGene: (gene: string) => void;
}

export function VolcanoTable({ points, passingGenes, selectedGenes, metric, logFCThresh, sigThresh, baselineLabel, caseLabel, onAddGene }: VolcanoTableProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return points.filter((point) => {
      if (!point.gene.toLocaleLowerCase().includes(query)) return false;
      if (filter === 'selected') return selectedGenes.has(point.gene);
      if (filter === 'all') return true;
      if (!passingGenes.has(point.gene)) return false;
      return filter === 'passing' || (filter === 'up' ? point.logfc > 0 : point.logfc < 0);
    });
  }, [points, search, filter, passingGenes, selectedGenes]);
  const { sorted, sortKey, sortDir, toggle } = useSortedRows<VolcanoPoint, SortKey>(filtered, sortValue, { key: metric, dir: 1 });

  // A new search, sort or threshold starts at the first result, including when
  // a contrast switch replaces the points while the table stays open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: changes in these values intentionally reset pagination.
  useEffect(() => { setPage(1); }, [points, search, filter, sortKey, sortDir, metric, logFCThresh, sigThresh]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * PAGE_SIZE;
  const pageRows = sorted.slice(start, start + PAGE_SIZE);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 6, padding: '0 4px 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11 }}>
        <input type="search" aria-label="Search volcano genes" placeholder="Search genes…" value={search}
          onChange={(event) => setSearch(event.target.value)}
          style={{ ...btnStyle, cursor: 'text', width: 170 }} />
        <select aria-label="Filter volcano genes" value={filter} onChange={(event) => setFilter(event.target.value as Filter)} style={btnStyle}>
          <option value="all">All genes</option>
          <option value="passing">Passing thresholds</option>
          <option value="up">Up in {caseLabel}</option>
          <option value="down">Down in {caseLabel}</option>
          <option value="selected">Selected genes</option>
        </select>
        <span style={{ color: 'var(--text-muted)' }}>log₂FC: {caseLabel} / {baselineLabel}</span>
      </div>
      <div style={{ overflow: 'auto', flex: 1, minHeight: 0, border: '1px solid var(--border)', borderRadius: 4 }}>
        <table aria-label="Volcano gene results" style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT_MONO, fontSize: 11 }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-app)' }}>
            <tr>
              {([['gene', 'Gene'], ['logfc', 'log₂FC'], ['pval', 'P value'], ['fdr', 'FDR']] as const).map(([key, label]) => (
                <SortableTh key={key} scope="col" active={sortKey === key} dir={sortDir} onSort={() => toggle(key)}
                  style={{ padding: '6px 8px', textAlign: key === 'gene' ? 'left' : 'right', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>
                  {label}
                </SortableTh>
              ))}
              <th scope="col" style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Threshold status</th>
              <th scope="col" style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Selection</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((point) => {
              const selected = selectedGenes.has(point.gene);
              const passing = passingGenes.has(point.gene);
              const color = passing ? (point.logfc > 0 ? UP_TEXT_COLOR : DOWN_TEXT_COLOR) : NEUTRAL_TEXT_COLOR;
              return (
                <tr key={point.gene} style={{ background: selected ? VOLCANO_SELECTED_BACKGROUND : 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '5px 8px', fontWeight: 500 }}>{point.gene}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color }}>{fmtSigned(point.logfc, 3)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtP(point.pval)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtFDR(point.fdr)}</td>
                  <td style={{ padding: '5px 8px', color, whiteSpace: 'nowrap' }}>
                    {passing ? (point.logfc > 0 ? `↑ Up in ${caseLabel}` : `↓ Down in ${caseLabel}`) : 'Below thresholds'}
                  </td>
                  <td style={{ padding: '3px 8px' }}>
                    <button type="button" disabled={selected} onClick={() => onAddGene(point.gene)}
                      aria-label={selected ? `${point.gene} selected` : `Add ${point.gene}`}
                      style={{ ...btnStyle, padding: '2px 7px', whiteSpace: 'nowrap', color: selected ? VOLCANO_SELECTED_COLOR : 'var(--text-primary)', cursor: selected ? 'default' : 'pointer' }}>
                      {selected ? '◆ Selected' : '+ Add'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>No genes match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
        <span aria-live="polite">{sorted.length ? `${start + 1}–${Math.min(start + PAGE_SIZE, sorted.length)} of ${sorted.length.toLocaleString()}` : '0'} genes</span>
        <button type="button" aria-label="Previous gene page" disabled={safePage === 1} onClick={() => setPage(safePage - 1)} style={{ ...btnStyle, marginLeft: 'auto' }}>Previous</button>
        <span>Page {safePage} of {pageCount}</span>
        <button type="button" aria-label="Next gene page" disabled={safePage === pageCount} onClick={() => setPage(safePage + 1)} style={btnStyle}>Next</button>
      </div>
    </div>
  );
}
