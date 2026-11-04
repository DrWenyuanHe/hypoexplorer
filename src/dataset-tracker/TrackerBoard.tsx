import {
  STATUSES, STATUS_KEYS, feasMeta, speciesGroup, modGroup, validationForTrackerRow,
} from './trackerLogic';
import { nStateSuffix } from './TrackerCells';
import type { TrackerRow } from '../types';
import { AuthorEvidenceLabel, AuthorValidationBadge, AuthorValidationNotInExplorerBadge } from '../common/AuthorValidation';

interface TrackerBoardProps {
  rows: TrackerRow[];
  statusOf: (acc: string) => string;
  onSelect: (acc: string) => void;
  canEdit: boolean;
  onSetStatus: (acc: string, status: string) => void;
}

// Kanban board: one column per status. The ← / → / ✗ move buttons appear only in
// dev (canEdit); on the published site the board is a read-only grouping.
export function TrackerBoard({ rows, statusOf, onSelect, canEdit, onSetStatus }: TrackerBoardProps) {
  return (
    <div className="board">
      {STATUSES.map((col) => {
        const items = rows.filter((r) => statusOf(r.acc) === col.key);
        const idx = STATUS_KEYS.indexOf(col.key);
        return (
          <div className="col" key={col.key}>
            <div className="colhead">
              <span className={`dot ${col.cls}`} />
              {col.label}
              <span className="cnt">{items.length}</span>
            </div>
            <div className="cards">
              {items.length === 0 ? (
                <div className="empty">No matching candidates</div>
              ) : (
                items.map((r) => (
                  <div className="card" key={r.acc}>
                    <button type="button" className="card-open" onClick={() => onSelect(r.acc)}>
                      <div className="cacc">
                        {r.acc}
                        {r.integrated && r.match ? (
                          <span className="intbadge" title={`In HypoExplorer as ${r.match.id}`}>
                            ● in explorer
                          </span>
                        ) : r.related && r.match ? (
                          <span className="intbadge rel" title={`Same paper as ${r.match.id}`}>
                            ↔ same paper
                          </span>
                        ) : null}
                      </div>
                      <div className="cmeta">
                        {speciesGroup(r.species)} · {modGroup(r.modality)} · {feasMeta(r).label}
                        {nStateSuffix(r)}
                      </div>
                    </button>
                      <div style={{ marginTop: 6, padding: '0 10px 10px' }}>
                        {validationForTrackerRow(r)
                          ? <><AuthorValidationBadge record={validationForTrackerRow(r)!} compact /><AuthorEvidenceLabel record={validationForTrackerRow(r)!} /></>
                          : <AuthorValidationNotInExplorerBadge />}
                      </div>
                    {canEdit && (
                      <div className="cmove">
                        {idx > 0 && (
                          <button
                            type="button"
                            onClick={() => onSetStatus(r.acc, STATUS_KEYS[idx - 1])}
                            title={`← ${STATUSES[idx - 1].label}`}
                          >
                            ←
                          </button>
                        )}
                        {idx < STATUS_KEYS.length - 1 && (
                          <button
                            type="button"
                            onClick={() => onSetStatus(r.acc, STATUS_KEYS[idx + 1])}
                            title={`${STATUSES[idx + 1].label} →`}
                          >
                            →
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onSetStatus(r.acc, 'rejected')}
                          title="Reject"
                          style={{ color: 'var(--t-rejected)' }}
                        >
                          ✗
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
