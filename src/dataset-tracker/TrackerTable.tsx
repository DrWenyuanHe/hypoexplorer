import type { Dispatch, SetStateAction } from 'react';
import {
  STATUSES, statusDef, feasMeta, nState, firstN, speciesGroup, modGroup, validationForTrackerRow,
} from './trackerLogic';
import type { TrackerSort } from './trackerLogic';
import { NStateCell } from './TrackerCells';
import type { TrackerRow } from '../types';
import { AuthorValidationBadge, AuthorValidationNotInExplorerBadge, AuthorEvidenceLabel } from '../common/AuthorValidation';

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
  const sortBtn = (key: string, label: string) => (
    <th onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }))}>
      {label}
      {sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            {sortBtn('acc', 'Accession')}
            {sortBtn('sp', 'Species')}
            {sortBtn('reg', 'Region')}
            {sortBtn('mod', 'Modality')}
            {sortBtn('n', 'n')}
            {sortBtn('feas', 'Feasibility')}
            {sortBtn('nok', 'n≥3')}
            {sortBtn('fit', 'Fit score')}
            {sortBtn('validation', 'Verification')}
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
                <td className="acc">
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
                      ● in explorer
                    </span>
                  ) : r.related && r.match ? (
                    <span
                      className="intbadge rel"
                      title={`Same publication as ${r.match.id} (${r.match.via})`}
                    >
                      ↔ same paper
                    </span>
                  ) : null}
                  {r.searchTag ? <div className="sub2">{r.searchTag}</div> : null}
                </td>
                <td>{speciesGroup(r.species)}</td>
                <td title={r.region}>{(r.region || '').split(/[;.(]/)[0].slice(0, 40)}</td>
                <td>
                  <span className="pill">{modGroup(r.modality)}</span>
                </td>
                <td className="ctr">{firstN(r.n)}</td>
                <td>
                  <span className={`pill ${fm.cls}`} title={r.feas ? r.feas.pipeline : ''}>
                    {fm.label}
                  </span>
                </td>
                <td className="ctr">
                  <NStateCell row={r} variant="compact" />
                </td>
                <td className="ctr">
                  {r.score ? (
                    <span title={r.score.rec}>{r.score.fit}</span>
                  ) : (
                    <span className="sub2">—</span>
                  )}
                </td>
                <td>
                  {validation
                    ? <><AuthorValidationBadge record={validation} compact /><AuthorEvidenceLabel record={validation} /></>
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
