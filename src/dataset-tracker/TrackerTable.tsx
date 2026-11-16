import type { Dispatch, SetStateAction } from 'react';
import {
  STATUSES, statusDef, feasMeta, nState, firstN, speciesGroup, modGroup, validationForTrackerRow,
} from './trackerLogic';
import type { TrackerSort } from './trackerLogic';
import { NStateCell } from './TrackerCells';
import type { TrackerRow } from '../types';
import { AuthorValidationBadge, AuthorValidationNotInExplorerBadge, authorEvidenceText } from '../common/AuthorValidation';

interface TrackerTableProps {
  rows: TrackerRow[];
  statusOf: (acc: string) => string;
  sort: TrackerSort;
  setSort: Dispatch<SetStateAction<TrackerSort>>;
  selectedAcc: string | null;
  onSelect: (acc: string) => void;
  canEdit: boolean;
  onSetStatus: (acc: string, status: string) => void;
}

// Sortable, filterable table of candidate datasets. Status is an inline dropdown
// in dev (canEdit) and a read-only badge on the published site.
export function TrackerTable({
  rows,
  statusOf,
  sort,
  setSort,
  selectedAcc,
  onSelect,
  canEdit,
  onSetStatus,
}: TrackerTableProps) {
  const sortBtn = (key: string, label: string, title?: string) => (
    <th
      aria-sort={sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}
      title={title}
    >
      <button type="button" className="thsort" onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }))}>
        {label}
        <span aria-hidden="true">{sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</span>
      </button>
    </th>
  );

  // Fixed column widths keep every row on one line; long text is truncated with
  // its full value in a tooltip and in the detail drawer.
  return (
    <div className="tablewrap">
      <table className="tk-table">
        <colgroup>
          <col className="c-acc" />
          <col className="c-study" />
          <col className="c-mod" />
          <col className="c-n" />
          <col className="c-feas" />
          <col className="c-fit" />
          <col className="c-ver" />
          <col className="c-status" />
        </colgroup>
        <thead>
          <tr>
            {sortBtn('acc', 'Accession')}
            {sortBtn('sp', 'Species · region')}
            {sortBtn('mod', 'Modality')}
            {sortBtn('n', 'n', 'Total samples, then the smallest group and whether it reaches n≥3')}
            {sortBtn('feas', 'Feasibility')}
            {sortBtn('fit', 'Fit')}
            {sortBtn('validation', 'Verification', 'Pipeline QC · Experimental design · Author concordance')}
            {sortBtn('status', 'Status')}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ns = nState(r);
            const fm = feasMeta(r);
            const st = statusOf(r.acc);
            const validation = validationForTrackerRow(r);
            return (
              // biome-ignore lint/a11y/useSemanticElements: a <tr> cannot be a <button>; whole-row open is keyboard-operable via role + tabIndex + onKeyDown
              <tr
                key={r.acc}
                className={`row${selectedAcc === r.acc ? ' sel' : ''}${ns.s === 'excluded' ? ' exrow' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(r.acc)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(r.acc);
                  }
                }}
              >
                <td className="acc" title={r.searchTag ? `${r.acc} · ${r.searchTag}` : undefined}>
                  <span className="acc-line">
                    {r.repoUrl ? (
                      <a
                        href={r.repoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.acc}
                      </a>
                    ) : (
                      r.acc
                    )}
                    {r.integrated && r.match ? (
                      <span
                        className="intbadge"
                        title={`In HypoExplorer as ${r.match.id} (via ${r.match.via})`}
                      >
                        <span aria-hidden="true">●</span>
                        <span className="tk-sr-only">in explorer</span>
                      </span>
                    ) : r.related && r.match ? (
                      <span
                        className="intbadge rel"
                        title={`Same publication as ${r.match.id} (${r.match.via})`}
                      >
                        same paper
                      </span>
                    ) : null}
                  </span>
                </td>
                <td className="clip" title={[speciesGroup(r.species), r.region].filter(Boolean).join(' · ')}>
                  <span className="sp">{speciesGroup(r.species)}</span>
                  {r.region ? <span className="reg"> · {r.region}</span> : null}
                </td>
                <td className="clip">
                  <span className="pill">{modGroup(r.modality)}</span>
                </td>
                <td className="ncell">
                  {firstN(r.n)}
                  <span className="nmin"><NStateCell row={r} variant="compact" /></span>
                </td>
                <td className="clip">
                  {fm.cls === 'fz-drop'
                    ? <span className="feas-plain" title={r.feas?.pipeline || ''}>{fm.label}</span>
                    : <span className={`pill ${fm.cls}`} title={r.feas ? r.feas.pipeline : ''}>{fm.label}</span>}
                </td>
                <td className="ctr">
                  {r.score ? (
                    <span title={r.score.rec}>{r.score.fit}</span>
                  ) : (
                    <span className="sub2">—</span>
                  )}
                </td>
                <td className="vercell">
                  {validation
                    ? <span className="verline">
                        <AuthorValidationBadge record={validation} icon />
                        <span className="evnote" title={authorEvidenceText(validation)}>{authorEvidenceText(validation)}</span>
                      </span>
                    : <AuthorValidationNotInExplorerBadge />}
                </td>
                <td>
                  {canEdit ? (
                    <select
                      className={`statussel st-${st}`}
                      value={st}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onSetStatus(r.acc, e.target.value)}
                    >
                      {STATUSES.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={`stbadge ${st}`}>{statusDef(st).label}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
