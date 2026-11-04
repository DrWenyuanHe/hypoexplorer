import { Modal } from '../common/Modal';
import { STATUSES, statusDef, feasMeta, linkChips, validationForTrackerRow } from './trackerLogic';
import { NStateCell } from './TrackerCells';
import type { ReviewState, TrackerRow } from '../types';
import { datasetQuality, QUALITY_STATUS } from '../data/datasetQualityR460';
import {
  AuthorValidationBadge, AuthorValidationNotInExplorerBadge, AuthorValidationPanel,
} from '../common/AuthorValidation';

interface TrackerDetailProps {
  row: TrackerRow;
  entry: ReviewState;
  status: string;
  canEdit: boolean;
  onSetStatus: (acc: string, status: string) => void;
  onSetNote: (acc: string, note: string) => void;
  onOpenInExplorer: (id: string) => void;
  onClose: () => void;
}

// The full dossier for one candidate, shown in a centered modal. Read-only by
// default; status buttons + a note field appear only when `canEdit` (dev).
export function TrackerDetail({
  row,
  entry,
  status,
  canEdit,
  onSetStatus,
  onSetNote,
  onOpenInExplorer,
  onClose,
}: TrackerDetailProps) {
  const r = row;
  const fm = feasMeta(r);
  const statusLabel = statusDef(status).label;
  const validation = validationForTrackerRow(r);
  const replication = validation ? datasetQuality(validation).experimentalDesign.checks.find(check => check.id === 'independent_replication') : undefined;
  const unresolvedReplication = replication && ['review', 'not_assessed', 'fail'].includes(replication.status);

  const headerRight = (
    <>
      <span className={`tk-headbadge stbadge ${status}`} style={{ marginRight: 4 }}>
        {statusLabel}
      </span>
      {validation
        ? <AuthorValidationBadge record={validation} compact />
        : <AuthorValidationNotInExplorerBadge />}
      {r.integrated && r.match && (
        <button
          type="button"
          className="open-explorer"
          onClick={() => { if (r.match) onOpenInExplorer(r.match.id); }}
        >
          Open in explorer →
        </button>
      )}
    </>
  );

  return (
    <Modal title={r.acc} onClose={onClose} headerRight={headerRight} width="1040px" height="88vh">
      <div className="tk-dossier">
        {/* integration relationship */}
        {r.integrated && r.match ? (
          <div className="intnote ok">
            Already in HypoExplorer as <b>{r.match.id}</b>, &quot;{r.match.name}&quot;.{' '}
            <span className="note-prose">Matched via {r.match.via}.</span>
          </div>
        ) : r.related && r.match ? (
          <div className="intnote rel">
            Shares a publication with <b>{r.match.id}</b>, matched via {r.match.via}.
            This appears to be a different dataset or series and is not currently in the explorer.
            Review it separately.
          </div>
        ) : (
          <div className="intnote none">
            Not yet in HypoExplorer.
            {canEdit
              ? ' Its integration status will update when it is added to the explorer registry.'
              : ''}
          </div>
        )}

        <div className="sectlabel">{r.title}</div>

        <div className="sectlabel">Data verification and evidence</div>
        {validation ? (
          <AuthorValidationPanel record={validation} />
        ) : (
          <div className="note-prose">
            This candidate is not in HypoExplorer yet. There is no local analysis result to validate.
          </div>
        )}

        {/* status — editable in dev, read-only badge otherwise */}
        {canEdit ? (
          <>
            <div className="sectlabel">Set status</div>
            <div className="statusbtns">
              {STATUSES.map((s) => (
                <button
                  type="button"
                  key={s.key}
                  className={status === s.key ? `on ${s.cls}` : ''}
                  onClick={() => onSetStatus(r.acc, s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="sectlabel">Review note</div>
            <textarea
              className="notearea"
              placeholder="Notes on this dataset…"
              defaultValue={entry.note || ''}
              key={r.acc}
              onBlur={(e) => onSetNote(r.acc, e.target.value)}
            />
            {entry.updated ? (
              <div className="sub2" style={{ marginTop: 4, color: 'var(--text-muted)' }}>
                last changed {new Date(entry.updated).toLocaleString()}
              </div>
            ) : null}
          </>
        ) : entry.note ? (
          <>
            <div className="sectlabel">Review note</div>
            <div className="note-prose">{entry.note}</div>
          </>
        ) : null}

        <div className="sectlabel">Source links</div>
        <div className="chips">
          {linkChips(r).map(([lab, url]) => (
            <a
              className="chip"
              key={`${lab}-${url}`}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {lab}
            </a>
          ))}
        </div>

        <div className="sectlabel">Recorded intake methods</div>
        <table className="metatbl">
          <tbody>
            <tr>
              <th>Species</th>
              <td>{r.species}</td>
            </tr>
            <tr>
              <th>Region</th>
              <td>{r.region}</td>
            </tr>
            <tr>
              <th>Modality</th>
              <td>{r.modality}</td>
            </tr>
            {r.platform ? (
              <tr>
                <th>Platform</th>
                <td>{r.platform}</td>
              </tr>
            ) : null}
            <tr>
              <th>Phenotype</th>
              <td>{r.phenotype}</td>
            </tr>
            <tr>
              <th>Design</th>
              <td>{r.design}</td>
            </tr>
            <tr>
              <th>Total n</th>
              <td>{r.n}</td>
            </tr>
          </tbody>
        </table>

        <div className="sectlabel">Recorded intake feasibility &amp; sample counts</div>
        <p className="note-prose">
          These screening notes may predate the current quality review.{' '}
          {validation
            ? 'Use the Experimental design assessment above for current evidence about biological replication.'
            : 'Recorded sample counts do not establish biological independence.'}
        </p>
        {unresolvedReplication ? (
          <div className="intnote rel" role="note" aria-label="Current biological replication assessment">
            <b>Current biological replication: {QUALITY_STATUS[replication.status].label}.</b>{' '}
            {replication.note}
          </div>
        ) : null}
        <table className="metatbl">
          <tbody>
            <tr>
              <th>Tier</th>
              <td>
                <span className={`pill ${fm.cls}`}>{fm.label}</span>
              </td>
            </tr>
            {r.feas ? (
              <>
                <tr>
                  <th>Pipeline</th>
                  <td>{r.feas.pipeline}</td>
                </tr>
                <tr>
                  <th>Access</th>
                  <td>{r.feas.access}</td>
                </tr>
                <tr>
                  <th>Raw data</th>
                  <td>
                    raw {r.feas.raw_present} · matrix {r.feas.processed_matrix} · FASTQ{' '}
                    {r.feas.fastq_sra}
                  </td>
                </tr>
                {r.feas.file_formats ? (
                  <tr>
                    <th>Files</th>
                    <td className="note-prose">{r.feas.file_formats}</td>
                  </tr>
                ) : null}
                {r.feas.blockers ? (
                  <tr>
                    <th>Recorded intake blockers</th>
                    <td className="risk">{r.feas.blockers}</td>
                  </tr>
                ) : null}
              </>
            ) : null}
            <tr>
              <th>Recorded n≥3 screen</th>
              <td>
                <NStateCell row={r} variant="full" />
                {r.nadeq?.perGroup ? `. ${r.nadeq.perGroup}` : ''}
              </td>
            </tr>
            {r.nadeq?.contrast ? (
              <tr>
                <th>Contrast</th>
                <td>{r.nadeq.contrast}</td>
              </tr>
            ) : null}
          </tbody>
        </table>

        {r.score ? (
          <>
            <div className="sectlabel">
              Recorded intake assessment (fit {r.score.fit}/100 · {r.score.rec})
            </div>
            <div className="note-prose">
              {r.score.rationale}
              {r.score.risks ? (
                <>
                  <br />
                  <br />
                  <b>Risks:</b> {r.score.risks}
                </>
              ) : null}
            </div>
          </>
        ) : null}

        {r.correctionNotes ? (
          <>
            <div className="sectlabel">Recorded intake verification notes</div>
            <div className="note-prose">{r.correctionNotes}</div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
